import { writeFile, mkdir } from 'node:fs/promises';
import { BoidSimulation } from '../src/simulation/boids.js';
import { FIXED_DT } from '../src/config.js';
import { GoalVisual } from '../src/rendering/goal-visual.js';

const baseline = process.argv.includes('--baseline');
const simulation = new BoidSimulation({ count: 1, obstacles: false });
for (let i = 0; i < 60; i++) simulation.step(FIXED_DT);
const before = simulation.goal.slice();
simulation.updateSettings({ goal: false });
for (let i = 0; i < 300; i++) {
  simulation.step(FIXED_DT);
  // The pre-fix clock advanced even while the goal was disabled.
  if (baseline) {
    simulation.goalTime += FIXED_DT * simulation.settings.goalSpeed;
    simulation.updateGoal();
  }
}
const disabledDisplacement = Math.hypot(
  ...simulation.goal.map((value, axis) => value - before[axis]),
);
const period = (2 * Math.PI) / 0.09;
const position = (time) => [
  17 * Math.cos(0.18 * time),
  3 + 12 * Math.sin(0.27 * time),
  17 * Math.sin(0.18 * time),
];
let pathMaxDeviation = 0,
  oldMaxSampleJump = 0;
for (let i = 0; i < 240; i++) {
  const a = position((i * period) / 240),
    b = position(((i + 1) * period) / 240);
  const midpoint = position(((i + 0.5) * period) / 240);
  pathMaxDeviation = Math.max(
    pathMaxDeviation,
    Math.hypot(...midpoint.map((value, axis) => value - (a[axis] + b[axis]) / 2)),
  );
}
for (let i = 0; i < Math.ceil(period / (2 * FIXED_DT)); i++) {
  const a = position(i * 2 * FIXED_DT),
    b = position((i + 1) * 2 * FIXED_DT);
  oldMaxSampleJump = Math.max(
    oldMaxSampleJump,
    Math.hypot(...a.map((value, axis) => value - b[axis])),
  );
}
const display = new GoalVisual(null),
  moving = new BoidSimulation({ count: 1, goalSpeed: 2, obstacles: false });
let maxHalfStepDisplayError = 0;
for (let i = 0; i < Math.ceil(period / (2 * FIXED_DT)); i++) {
  moving.step(FIXED_DT);
  display.update(moving, 0.5);
  const expected = position((i + 0.5) * 2 * FIXED_DT);
  const actual = baseline ? moving.goal : display.goal.position.toArray();
  maxHalfStepDisplayError = Math.max(
    maxHalfStepDisplayError,
    Math.hypot(...actual.map((value, axis) => value - expected[axis])),
  );
}
const result = {
  disabledForSeconds: 5,
  disabledDisplacement,
  pathPeriodAt1x: period,
  path240SegmentMaxMidpointDeviation: pathMaxDeviation,
  maximum60HzGoalPositionJumpAt2xWithoutInterpolation: oldMaxSampleJump,
  maxHalfStepDisplayError,
};
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(
  new URL(`../artifacts/goal-${baseline ? 'before' : 'after'}.json`, import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
