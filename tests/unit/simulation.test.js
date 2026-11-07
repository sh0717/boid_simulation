import test from 'node:test';
import assert from 'node:assert/strict';
import { BoidSimulation } from '../../src/simulation/boids.js';
import { SpatialGrid } from '../fixtures/spatial-grid.js';
import { SimulationClock } from '../../src/simulation/clock.js';
import { FIXED_DT, MAX_BOIDS, OBSTACLES, WORLD } from '../../src/config.js';

function checkInvariants(simulation) {
  for (let p = 0; p < simulation.count * 3; p += 3) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Number.isFinite(simulation.positions[p + axis]), 'position must be finite');
      assert.ok(Math.abs(simulation.positions[p + axis]) <= WORLD.halfSize + 1e-5, 'hard bound');
    }
    const speed = Math.hypot(...simulation.velocities.subarray(p, p + 3));
    assert.ok(speed >= WORLD.minSpeed - 1e-5 && speed <= WORLD.maxSpeed + 1e-5, `speed ${speed}`);
    if (simulation.settings.obstacles)
      for (const obstacle of OBSTACLES) {
        assert.ok(
          Math.hypot(
            simulation.positions[p] - obstacle.x,
            simulation.positions[p + 1] - obstacle.y,
            simulation.positions[p + 2] - obstacle.z,
          ) >=
            obstacle.radius + 0.6499,
          'sphere penetration',
        );
      }
  }
}

test('same seed and settings reproduce identical trajectories; restart resets actors and time', () => {
  const first = new BoidSimulation({ count: 160, predator: true });
  const second = new BoidSimulation({ count: 160, predator: true });
  for (let i = 0; i < 180; i++) {
    first.step(FIXED_DT);
    second.step(FIXED_DT);
  }
  assert.deepEqual(first.positions, second.positions);
  first.reset();
  second.reset();
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.predator, second.predator);
  assert.equal(first.time, 0);
});

test('grid neighbor search agrees with exhaustive all-pairs simulation', () => {
  const grid = new BoidSimulation({ count: 160, predator: true });
  const exhaustive = new BoidSimulation({ count: 160, predator: true });
  exhaustive.search = new SpatialGrid(WORLD.halfSize, WORLD.halfSize * 2, MAX_BOIDS);
  for (let step = 0; step < 90; step++) {
    grid.step(FIXED_DT);
    exhaustive.step(FIXED_DT);
  }
  let difference = 0;
  for (let i = 0; i < grid.count * 3; i++)
    difference = Math.max(difference, Math.abs(grid.positions[i] - exhaustive.positions[i]));
  assert.ok(difference < 0.0001, `maximum grid vs exhaustive deviation: ${difference}`);
  assert.ok(grid.metrics.neighborChecks < exhaustive.metrics.neighborChecks * 0.65);
});

test('30, 60 and 144 Hz rendering produce the same fixed-step state', () => {
  const simulations = [30, 60, 144].map((hz) => {
    const simulation = new BoidSimulation({ count: 80 });
    const clock = new SimulationClock();
    for (let frame = 0; frame < hz * 3; frame++)
      clock.advance(1 / hz, 1, (dt) => simulation.step(dt));
    return simulation;
  });
  assert.deepEqual(simulations[0].positions, simulations[1].positions);
  assert.deepEqual(simulations[1].positions, simulations[2].positions);
});

test('long-running 640-agent predator simulation stays finite, bounded and outside obstacles', () => {
  const simulation = new BoidSimulation({ count: 640, predator: true });
  for (let i = 0; i < 1200; i++) {
    simulation.step(FIXED_DT);
    if (i % 60 === 0) checkInvariants(simulation);
  }
  checkInvariants(simulation);
});

test('coincident boids, zero velocity, predator overlap and obstacle center are finite', () => {
  const simulation = new BoidSimulation({ count: 2, predator: true });
  simulation.positions.fill(0);
  simulation.velocities.fill(0);
  simulation.predator.fill(0);
  for (let i = 0; i < 30; i++) simulation.step(FIXED_DT);
  checkInvariants(simulation);
});

test('hard bounds clamp and reflect outward velocity', () => {
  const simulation = new BoidSimulation({ count: 1, goal: false, obstacles: false });
  simulation.positions.set([24.99, 0, 0]);
  simulation.velocities.set([12, 0, 0]);
  simulation.step(FIXED_DT);
  assert.equal(simulation.positions[0], 25);
  assert.ok(simulation.velocities[0] < 0);
});

test('turning each behavioral rule off remains stable', () => {
  const simulation = new BoidSimulation({
    count: 80,
    cohesion: 0,
    alignment: 0,
    separation: 0,
    goal: false,
    predator: false,
    obstacles: false,
  });
  for (let i = 0; i < 300; i++) simulation.step(FIXED_DT);
  checkInvariants(simulation);
});

test('disabled goal and predator do not change boid state when their positions differ', () => {
  const a = new BoidSimulation({ count: 80, goal: false, predator: false });
  const b = new BoidSimulation({ count: 80, goal: false, predator: false });
  b.predator.set([0, 0, 0]);
  a.step(FIXED_DT);
  b.step(FIXED_DT);
  assert.deepEqual(a.positions, b.positions);
});

test('count is bounded and the maximum population advances', () => {
  const simulation = new BoidSimulation({ count: 99999 });
  assert.equal(simulation.count, MAX_BOIDS);
  simulation.step(FIXED_DT);
  checkInvariants(simulation);
  simulation.settings.count = 0;
  simulation.reset();
  assert.ok(simulation.count > 0 && simulation.count <= MAX_BOIDS);
});

test('invalid timestep is rejected and long frame catch-up is bounded', () => {
  const simulation = new BoidSimulation({ count: 2 });
  for (const dt of [0, -1, Infinity, NaN, 0.1])
    assert.throws(() => simulation.step(dt), RangeError);
  const clock = new SimulationClock();
  let steps = 0;
  const alpha = clock.advance(100, 2, () => steps++);
  assert.ok(steps <= 12);
  assert.ok(alpha >= 0 && alpha < 1);
  clock.reset();
  assert.equal(clock.accumulator, 0);
});
