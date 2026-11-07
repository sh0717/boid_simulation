import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { BoidSimulation } from '../../src/simulation/boids.js';
import { SimulationClock } from '../../src/simulation/clock.js';
import { GOAL_PERIOD, sampleGoalPath, wrapGoalTime } from '../../src/simulation/goal-path.js';
import { GoalVisual } from '../../src/rendering/goal-visual.js';
import { FIXED_DT, WORLD } from '../../src/config.js';

const createSimulation = (settings) =>
  new BoidSimulation({
    count: 1,
    goal: true,
    obstacles: false,
    predator: false,
    cohesion: 0,
    alignment: 0,
    separation: 0,
    ...settings,
  });
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));

test('goal follows its closed 2:3 path and analytic tangent within world bounds', () => {
  const position = new Float64Array(3),
    tangent = new Float64Array(3),
    before = new Float64Array(3),
    after = new Float64Array(3);
  for (let i = 0; i <= 720; i++) {
    const phase = (i / 720) * 2 * Math.PI,
      time = (i * GOAL_PERIOD) / 720;
    sampleGoalPath(time, position, tangent);
    assert.ok(
      distance(position, [
        17 * Math.cos(2 * phase),
        3 + 12 * Math.sin(3 * phase),
        17 * Math.sin(2 * phase),
      ]) < 1e-12,
    );
    assert.ok(
      Math.abs(position[0]) <= 17 &&
        Math.abs(position[2]) <= 17 &&
        position[1] >= -9 &&
        position[1] <= 15,
    );
    sampleGoalPath(time - 1e-4, before);
    sampleGoalPath(time + 1e-4, after);
    for (let axis = 0; axis < 3; axis++)
      assert.ok(Math.abs(tangent[axis] - (after[axis] - before[axis]) / 2e-4) < 1e-8);
  }
  sampleGoalPath(0, before);
  sampleGoalPath(GOAL_PERIOD, after);
  assert.deepEqual(before, after);
});

test('disabled goal holds its phase and resumes without changing position at toggle time', () => {
  const simulation = createSimulation();
  for (let i = 0; i < 60; i++) simulation.step(FIXED_DT);
  const position = simulation.goal.slice(),
    time = simulation.goalTime;
  simulation.updateSettings({ goal: false });
  for (let i = 0; i < 300; i++) simulation.step(FIXED_DT);
  assert.equal(simulation.goalTime, time);
  assert.deepEqual(simulation.goal, position);
  simulation.updateSettings({ goal: true });
  assert.deepEqual(simulation.goal, position);
  simulation.step(FIXED_DT);
  assert.ok(distance(simulation.goal, position) > 0 && distance(simulation.goal, position) < 0.08);
});

test('goal speed changes preserve phase and the periodic seam crosses forward', () => {
  const simulation = createSimulation({ goalSpeed: 2 });
  simulation.goalTime = GOAL_PERIOD - FIXED_DT / 2;
  simulation.updateGoal();
  const before = simulation.goal.slice();
  simulation.step(FIXED_DT);
  assert.ok(Math.abs(simulation.goalTime - FIXED_DT * 1.5) < 1e-12);
  assert.ok(distance(before, simulation.goal) < 0.15);
  assert.equal(simulation.goalAdvance, FIXED_DT * 2);
  const time = simulation.goalTime,
    position = simulation.goal.slice();
  simulation.updateSettings({ goalSpeed: 0 });
  for (let i = 0; i < 30; i++) simulation.step(FIXED_DT);
  assert.equal(simulation.goalTime, time);
  assert.deepEqual(simulation.goal, position);
  simulation.updateSettings({ goalSpeed: 0.3 });
  simulation.step(FIXED_DT);
  assert.ok(Math.abs(simulation.goalTime - time - FIXED_DT * 0.3) < 1e-12);
  assert.ok(wrapGoalTime(1e9) >= 0 && wrapGoalTime(1e9) < GOAL_PERIOD);
});

test('goal force points toward the target, scales with strength and respects the final acceleration limit', () => {
  for (const strength of [0, 0.5, 1, 3]) {
    const simulation = createSimulation({ goalStrength: strength, goalSpeed: 0 });
    simulation.positions.set([0, 0, 0]);
    simulation.velocities.set([0, 0, 8]);
    simulation.step(FIXED_DT);
    assert.ok(Math.abs(simulation.velocities[0] - 17 * 0.28 * strength * FIXED_DT) < 1e-6);
    assert.ok(Math.abs(simulation.velocities[1] - 3 * 0.28 * strength * FIXED_DT) < 1e-6);
    assert.equal(simulation.velocities[2], 8);
  }
  const limited = createSimulation({ goalStrength: 3, goalSpeed: 0 });
  limited.positions.set([-19, -19, 0]);
  limited.velocities.set([0, 0, 8]);
  limited.step(FIXED_DT);
  assert.ok(
    Math.abs(Math.hypot(limited.velocities[0], limited.velocities[1]) / FIXED_DT - WORLD.maxForce) <
      1e-5,
  );
});

test('coinciding with a stationary goal preserves finite flight rather than forcing a boid to stop', () => {
  const simulation = createSimulation({ goalSpeed: 0, goalStrength: 3 });
  simulation.positions.set(simulation.goal);
  simulation.velocities.fill(0);
  for (let i = 0; i < 1200; i++) {
    simulation.step(FIXED_DT);
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Number.isFinite(simulation.positions[axis]) &&
          Math.abs(simulation.positions[axis]) <= WORLD.halfSize,
      );
    const speed = Math.hypot(...simulation.velocities.subarray(0, 3));
    assert.ok(speed >= 4.99999 && speed <= 12.00001);
  }
});

test('goal rendering interpolates phase along the exact path including the seam without mutating state', () => {
  const simulation = createSimulation({ goalSpeed: 2 }),
    visual = new GoalVisual(null),
    expected = new Float32Array(3);
  for (const start of [0, 12.3, GOAL_PERIOD - 0.01]) {
    simulation.goalTime = start;
    simulation.updateGoal();
    simulation.step(FIXED_DT);
    const position = simulation.goal.slice(),
      time = simulation.goalTime;
    let previous;
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      visual.update(simulation, alpha);
      sampleGoalPath(start + 2 * FIXED_DT * alpha, expected);
      assert.ok(distance(visual.goal.position.toArray(), expected) < 1e-5);
      if (previous) assert.ok(visual.goal.position.distanceTo(previous) < 0.04);
      previous = visual.goal.position.clone();
    }
    assert.deepEqual(simulation.goal, position);
    assert.equal(simulation.goalTime, time);
  }
});

test('rendered orbit geometry closes and its chord error is below 0.012 world units', () => {
  const visual = new GoalVisual(null),
    vertices = visual.path.geometry.attributes.position.array;
  assert.deepEqual([...vertices.slice(0, 3)], [...vertices.slice(-3)]);
  const expected = new Float64Array(3);
  for (let i = 0; i < 240; i++) {
    sampleGoalPath(((i + 0.5) * GOAL_PERIOD) / 240, expected);
    const midpoint = [0, 1, 2].map(
      (axis) => (vertices[i * 3 + axis] + vertices[(i + 1) * 3 + axis]) / 2,
    );
    assert.ok(distance(expected, midpoint) < 0.012);
  }
});

test('goal arrow follows the actual tangent; goal, path and stationary indicators follow settings', () => {
  const simulation = createSimulation(),
    visual = new GoalVisual(null),
    next = new Float64Array(3),
    before = new Float64Array(3);
  for (const time of [0, 6, 22, GOAL_PERIOD - 0.001]) {
    simulation.goalTime = time;
    simulation.updateGoal();
    simulation.snapInterpolation();
    visual.update(simulation, 1);
    sampleGoalPath(time + 0.0001, next);
    sampleGoalPath(time - 0.0001, before);
    const tangent = new Vector3(...next).sub(new Vector3(...before)).normalize();
    const forward = new Vector3(0, 1, 0).applyQuaternion(visual.arrow.quaternion);
    assert.ok(tangent.dot(forward) > 0.999999);
  }
  simulation.updateSettings({ goalPath: false });
  visual.update(simulation, 1);
  assert.equal(visual.goal.visible, true);
  assert.equal(visual.path.visible, false);
  simulation.updateSettings({ goal: false, goalPath: true });
  visual.update(simulation, 1);
  assert.equal(visual.goal.visible, false);
  assert.equal(visual.path.visible, false);
  simulation.updateSettings({ goal: true, goalSpeed: 0 });
  visual.update(simulation, 1);
  assert.equal(visual.arrow.visible, false);
  const rotation = visual.body.rotation.y,
    scale = visual.ring.scale.x;
  for (let i = 0; i < 60; i++) {
    simulation.step(FIXED_DT);
    visual.update(simulation, 0.5);
  }
  assert.equal(visual.body.rotation.y, rotation);
  assert.equal(visual.ring.scale.x, scale);
});

test('goal snapshots snap on pause and reset to their initial position and visual phase on restart', () => {
  const simulation = createSimulation(),
    visual = new GoalVisual(null);
  simulation.step(FIXED_DT);
  simulation.snapInterpolation();
  for (const alpha of [0, 0.5, 1]) {
    visual.update(simulation, alpha);
    assert.deepEqual(visual.goal.position.toArray(), [...simulation.goal]);
  }
  simulation.reset(7);
  visual.update(simulation, 0);
  assert.equal(simulation.goalTime, 0);
  assert.equal(simulation.previousGoalTime, 0);
  assert.equal(simulation.goalAdvance, 0);
  assert.deepEqual(visual.goal.position.toArray(), [17, 3, 0]);
  assert.equal(visual.body.rotation.y, 0);
  assert.equal(visual.ring.scale.x, 1);
});

test('goal and boid states are deterministic across refresh rates with seed, speed and toggle changes', () => {
  const states = [30, 60, 144].map((hz) => {
    const simulation = createSimulation({ count: 32, goalSpeed: 2 }),
      clock = new SimulationClock();
    simulation.reset(7);
    let ticks = 0;
    for (let i = 0; i < hz * 4; i++)
      clock.advance(1 / hz, 1, (dt) => {
        if (ticks === 60) simulation.updateSettings({ goal: false });
        if (ticks === 120) simulation.updateSettings({ goal: true, goalSpeed: 0.3 });
        simulation.step(dt);
        ticks++;
      });
    return {
      position: [...simulation.goal],
      time: simulation.goalTime,
      boids: [...simulation.positions],
    };
  });
  assert.deepEqual(states[0], states[1]);
  assert.deepEqual(states[1], states[2]);
});
