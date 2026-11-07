import { mkdir, writeFile } from 'node:fs/promises';
import { BoidSimulation } from '../src/simulation/boids.js';
import { FIXED_DT } from '../src/config.js';

const comparisons = [];
for (const boundaryMode of ['hard', 'soft', 'hybrid']) {
  const simulation = new BoidSimulation({
    count: 1,
    cohesion: 0,
    alignment: 0,
    separation: 0,
    goal: false,
    obstacles: false,
    boundaryMode,
  });
  simulation.positions.set([24.99, 0, 0]);
  simulation.velocities.set([12, 0, 0]);
  let maxExcursion = 0,
    maxVelocityChange = 0,
    returnTime = null;
  for (let tick = 0; tick < 600; tick++) {
    const velocity = simulation.velocities.slice(0, 3);
    simulation.step(FIXED_DT);
    maxExcursion = Math.max(maxExcursion, simulation.metrics.maxExcursion);
    maxVelocityChange = Math.max(
      maxVelocityChange,
      Math.hypot(...[0, 1, 2].map((axis) => simulation.velocities[axis] - velocity[axis])),
    );
    if (returnTime === null && simulation.positions[0] < 24) returnTime = simulation.time;
  }
  comparisons.push({
    boundaryMode,
    maxExcursion,
    maxVelocityChangePerStep: maxVelocityChange,
    firstReturnBelowX24Seconds: returnTime,
  });
}
const report = {
  scenario:
    '50^3 map, isolated boid, position (24.99,0,0), velocity (12,0,0), default margin/strength, 600 steps at 1/60s',
  comparisons,
};
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../artifacts/boundary-comparison.json', import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
