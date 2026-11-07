import test from 'node:test';
import assert from 'node:assert/strict';
import { BoidSimulation, CORE_METADATA } from '../../src/simulation/boids.js';
import { CORE_BASE64 } from '../../src/simulation/generated/core-binary.js';
import { BoidSimulation as ReferenceSimulation } from '../fixtures/boids.js';
import { checkCore } from '../../tools/check-core.mjs';
import { FIXED_DT } from '../../src/config.js';

test('C++20 binary matches source hashes and has no host numerical imports', async () => {
  await checkCore();
  const module = new WebAssembly.Module(Buffer.from(CORE_BASE64, 'base64'));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.equal(CORE_METADATA.standard, 'C++20');
  const simulation = new BoidSimulation();
  assert.equal(simulation.backend, 'cpp17-wasm');
  assert.equal(simulation.core.boids_abi_version(), 1);
});

test('renderer views keep their fixed memory and reuse the two velocity buffers across commits', () => {
  const simulation = new BoidSimulation({ count: 32 });
  const memory = simulation.positions.buffer,
    positions = simulation.positions;
  const first = simulation.velocities,
    second = simulation.nextVelocities;
  assert.equal(memory, simulation.core.memory.buffer);
  assert.equal(memory.byteLength, 2097152);
  assert.ok(positions.byteOffset > 0, 'views must respect the C++ array byte offset');
  simulation.step(FIXED_DT);
  assert.equal(simulation.velocities, second);
  assert.equal(simulation.nextVelocities, first);
  simulation.step(FIXED_DT);
  assert.equal(simulation.velocities, first);
  assert.equal(simulation.nextVelocities, second);
  simulation.resizeWorld({ width: 100 });
  simulation.updateSettings({ count: 1200 });
  simulation.reset(0);
  for (let i = 0; i < 20; i++) simulation.step(FIXED_DT);
  assert.equal(simulation.positions, positions);
  assert.equal(simulation.positions.buffer, memory);
  assert.equal(memory.byteLength, 2097152);
});

test('independent C++ instances never share state or random initialization', () => {
  const a = new BoidSimulation({ count: 32 }),
    b = new BoidSimulation({ count: 32 });
  const snapshot = b.positions.slice();
  a.reset(7);
  a.step(FIXED_DT);
  assert.notEqual(a.positions.buffer, b.positions.buffer);
  assert.deepEqual(b.positions, snapshot);
  assert.equal(b.time, 0);
  b.reset(7);
  b.step(FIXED_DT);
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.velocities, b.velocities);
});

test('ABI entries import external state edits and preserve bytes outside their publication slots', () => {
  const entries = [
    ['reset', (core) => core.boids_reset(7), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
    ['step', (core) => core.boids_step(FIXED_DT), [1, 2, 3, 4, 5, 6, 7, 8, 9]],
    ['snap', (core) => core.boids_snap(), [3, 4]],
    ['measure', (core) => core.boids_measure(), [6, 7, 8, 9]],
    ['goal', (core) => core.boids_goal(), []],
    ['predator', (core) => core.boids_predator(FIXED_DT), []],
    ['rebuild', (core) => core.boids_rebuild(), []],
    ['inspect', (core) => core.boids_inspect(3), []],
    ['neighbors', (core) => core.boids_refresh_neighbors(), []],
    ['bounds', (core) => core.boids_reconcile_bounds(), []],
    ['obstacles disabled', (core) => core.boids_reconcile_obstacles(), []],
    ['obstacles enabled', (core) => core.boids_reconcile_obstacles(), [6, 7, 8, 9]],
    [
      'buffer and version',
      (core) => {
        for (let selector = 0; selector < 14; selector++) core.boids_buffer(selector);
        assert.equal(core.boids_abi_version(), 1);
      },
      [],
    ],
  ];
  for (const [name, invoke, written] of entries) {
    const simulation = new BoidSimulation({ count: 32, obstacles: false, predator: true });
    const state = simulation.state;
    // Requested count stays 32; all non-reset entries must use the external active count 16.
    state.set([16, 8.25, 11.75, -0, 2.5, -0, -0, 0.25, -0, 2]);
    if (name === 'obstacles enabled') simulation.configBuffer[13] = 1;
    const bytes = new Uint8Array(state.buffer, state.byteOffset, state.byteLength);
    const before = bytes.slice(),
      positions = simulation.positions.slice();
    invoke(simulation.core);
    for (let slot = 0; slot < state.length; slot++) {
      if (!written.includes(slot))
        assert.deepEqual(
          bytes.slice(slot * 8, slot * 8 + 8),
          before.slice(slot * 8, slot * 8 + 8),
          `${name}: state slot ${slot}`,
        );
    }
    if (name === 'reset') {
      assert.equal(state[0], 32);
      assert.equal(state[1], 0);
      assert.equal(state[2], 0);
    } else if (name === 'step') {
      assert.equal(state[0], 16);
      assert.equal(state[1], 8.25 + FIXED_DT);
      assert.equal(state[2], 11.75 + FIXED_DT);
      assert.equal(state[3], 11.75);
      assert.equal(state[4], FIXED_DT);
      assert.deepEqual(simulation.positions.slice(16 * 3), positions.slice(16 * 3));
    } else if (name === 'snap') {
      assert.equal(state[3], 11.75);
      assert.equal(state[4], 0);
    } else if (name === 'goal') {
      const reference = new ReferenceSimulation({ count: 32 });
      reference.goalTime = 11.75;
      reference.updateGoal();
      for (let axis = 0; axis < 3; axis++)
        assert.ok(Math.abs(simulation.goal[axis] - reference.goal[axis]) < 1e-4);
    }
  }
});

test('inspection and neighborhood refresh preserve persistent state and future trajectories for every search strategy', () => {
  const persistentState = (simulation) => ({
    ...Object.fromEntries(
      [
        'state',
        'positions',
        'previousPositions',
        'velocities',
        'nextVelocities',
        'goal',
        'predator',
        'previousPredator',
        'predatorVelocity',
        'obstacleBuffer',
      ].map((key) => [key, simulation[key].slice()]),
    ),
    metrics: { ...simulation.metrics },
    velocityAddress: simulation.core.boids_buffer(4),
    nextVelocityAddress: simulation.core.boids_buffer(5),
  });
  for (const searchType of ['grid', 'kd-tree', 'all-pairs']) {
    const settings = {
      count: 64,
      fieldOfView: 120,
      predator: true,
      searchType: searchType === 'kd-tree' ? 'kd-tree' : 'grid',
    };
    const observed = new BoidSimulation(settings),
      control = new BoidSimulation(settings);
    for (const simulation of [observed, control]) {
      simulation.reset(7);
      // A descriptor without a finite cellSize selects the existing internal all-pairs path.
      if (searchType === 'all-pairs') simulation.search = {};
    }
    for (let tick = 0; tick < 40; tick++) {
      const before = persistentState(observed);
      observed.neighborCounts.fill(0xffff);
      observed.refreshNeighborhoodCounts();
      assert.deepEqual(
        persistentState(observed),
        before,
        `${searchType}/${tick}: refresh mutated persistent state`,
      );
      for (const index of [0, 17, 63]) {
        const detail = observed.inspect(index);
        assert.equal(detail.neighborCount, observed.neighborCounts[index]);
      }
      for (let index = 0; index < observed.count; index++)
        assert.ok(observed.neighborCounts[index] < observed.count);
      assert.deepEqual(
        persistentState(observed),
        before,
        `${searchType}/${tick}: inspection mutated persistent state`,
      );
      observed.step(FIXED_DT);
      control.step(FIXED_DT);
      assert.deepEqual(
        persistentState(observed),
        persistentState(control),
        `${searchType}/${tick}: diagnostics changed the next step`,
      );
    }
  }
});

test('C++ motion and inspection match the previous JS core across search, boundaries and live edits', () => {
  for (const seed of [0, 7, 22823])
    for (const searchType of ['grid', 'kd-tree'])
      for (const boundaryMode of ['hard', 'soft', 'hybrid']) {
        const settings = {
          count: 64,
          predator: true,
          perception: 14,
          fieldOfView: 220,
          searchType,
          boundaryMode,
        };
        const a = new BoidSimulation(settings),
          b = new ReferenceSimulation(settings);
        for (const simulation of [a, b]) {
          simulation.reset(seed);
          simulation.addObstacle('box');
        }
        for (let tick = 0; tick < 180; tick++) {
          for (const simulation of [a, b]) {
            if (tick === 30) simulation.resizeWorld({ width: 100, height: 70, depth: 60 });
            if (tick === 60)
              simulation.updateSettings({ goalSpeed: 0, fieldOfView: 60, obstacles: false });
            if (tick === 90) simulation.updateObstacle(3, { width: 3, x: -16 });
            if (tick === 120)
              simulation.updateSettings({ goalSpeed: 2, obstacles: true, boundaryMode: 'hybrid' });
            simulation.step(FIXED_DT);
          }
          for (const key of ['positions', 'velocities', 'goal', 'predator', 'predatorVelocity']) {
            let maximum = 0;
            for (let i = 0; i < a[key].length; i++)
              maximum = Math.max(maximum, Math.abs(a[key][i] - b[key][i]));
            assert.ok(
              maximum < 1e-4,
              `${seed}/${searchType}/${boundaryMode} tick ${tick} ${key}: ${maximum}`,
            );
          }
          assert.equal(a.time, b.time);
          assert.equal(a.goalTime, b.goalTime);
          assert.equal(a.metrics.neighborChecks, b.metrics.neighborChecks);
          if (tick % 30 === 0) {
            const x = a.inspect(17),
              y = b.inspect(17);
            assert.deepEqual(
              [...x.neighbors.slice(0, x.neighborCount)],
              [...y.neighbors.slice(0, y.neighborCount)],
            );
            assert.equal(x.closeCount, y.closeCount);
            for (const rule of ['cohesion', 'alignment', 'separation'])
              for (let axis = 0; axis < 3; axis++)
                assert.ok(Math.abs(x[rule][axis] - y[rule][axis]) < 1e-8);
          }
        }
      }
});
