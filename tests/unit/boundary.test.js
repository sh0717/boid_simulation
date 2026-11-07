import test from 'node:test';
import assert from 'node:assert/strict';
import { BoidSimulation, seededRandom } from '../../src/simulation/boids.js';
import { boundarySteering } from '../fixtures/boundary.js';
import { SpatialGrid, AllPairsSearch } from '../fixtures/spatial-grid.js';
import { SimulationClock } from '../../src/simulation/clock.js';
import { obstacleSurface } from '../../src/simulation/obstacles.js';
import { FIXED_DT, DEFAULTS } from '../../src/config.js';

function isolated(boundaryMode = 'soft', settings = {}) {
  return new BoidSimulation({
    count: 1,
    cohesion: 0,
    alignment: 0,
    separation: 0,
    goal: false,
    obstacles: false,
    boundaryMode,
    ...settings,
  });
}
function finiteState(simulation) {
  for (let p = 0; p < simulation.count * 3; p += 3) {
    for (let axis = 0; axis < 3; axis++) assert.ok(Number.isFinite(simulation.positions[p + axis]));
    const speed = Math.hypot(...simulation.velocities.subarray(p, p + 3));
    assert.ok(speed >= 4.99999 && speed <= 12.00001);
  }
  assert.ok([...simulation.predator, ...simulation.predatorVelocity].every(Number.isFinite));
}

test('boundary settings validate transactions and default to hybrid', () => {
  const simulation = isolated();
  assert.equal(DEFAULTS.boundaryMode, 'hybrid');
  const original = { ...simulation.settings },
    positions = simulation.positions.slice();
  for (const patch of [
    { boundaryMode: 'wrap', cohesion: 3 },
    { boundaryMargin: NaN, boundaryMode: 'hard' },
    { boundaryStrength: Infinity },
  ])
    assert.throws(() => simulation.updateSettings(patch));
  assert.deepEqual(simulation.settings, original);
  assert.deepEqual(simulation.positions, positions);
  simulation.updateSettings({ boundaryMargin: 100, boundaryStrength: 0 });
  assert.equal(simulation.settings.boundaryMargin, 10);
  assert.equal(simulation.settings.boundaryStrength, 0.25);
});

test('hard has no pre-contact steering while soft and hybrid turn before contact', () => {
  for (const mode of ['hard', 'soft', 'hybrid']) {
    const simulation = isolated(mode);
    simulation.positions.set([22, 0, 0]);
    simulation.velocities.set([10, 0, 0]);
    simulation.step(FIXED_DT);
    if (mode === 'hard') assert.deepEqual([...simulation.velocities.slice(0, 3)], [10, 0, 0]);
    else {
      assert.ok(simulation.velocities[0] < 10);
      assert.ok(simulation.velocities[1] > 0);
    }
  }
});

test('soft crosses each face continuously then turns back even in an exact head-on approach', () => {
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1])
      for (const strength of [0.25, 1, 3]) {
        const simulation = isolated('soft', { boundaryStrength: strength });
        simulation.positions.fill(0);
        simulation.velocities.fill(0);
        simulation.positions[axis] = sign * 24.99;
        simulation.velocities[axis] = sign * 12;
        simulation.step(FIXED_DT);
        assert.ok(simulation.positions[axis] * sign > 25, 'no hard position clamp');
        assert.ok(simulation.velocities[axis] * sign > 0, 'no instantaneous reflection');
        assert.equal(simulation.metrics.outsideCount, 1);
        let returned = false;
        for (let tick = 0; tick < 600; tick++) {
          const before = simulation.positions.slice(0, 3);
          simulation.step(FIXED_DT);
          assert.ok(
            Math.hypot(...[0, 1, 2].map((i) => simulation.positions[i] - before[i])) <=
              12 * FIXED_DT + 1e-5,
            'bounded continuous displacement',
          );
          if (Math.abs(simulation.positions[axis]) < 24) returned = true;
          finiteState(simulation);
        }
        assert.ok(returned, `return on axis ${axis}, sign ${sign}, strength ${strength}`);
      }
});

test('soft steering has a neutral interior, scales with strength and prioritizes return outside', () => {
  const output = new Float64Array(4),
    position = new Float64Array([0, 0, 0]),
    velocity = new Float64Array([12, 0, 0]);
  boundarySteering(position, velocity, 0, [25, 15, 10], 5, 1, output);
  assert.ok([...output].every((value) => value === 0));
  position[0] = 23;
  boundarySteering(position, velocity, 0, [25, 15, 10], 5, 1, output);
  const first = [...output];
  assert.ok(first[0] < 0 && first[1] > 0);
  assert.equal(first[3], 0);
  boundarySteering(position, velocity, 0, [25, 15, 10], 5, 2, output);
  for (let axis = 0; axis < 3; axis++) assert.equal(output[axis], first[axis] * 2);
  position[0] = 31;
  boundarySteering(position, velocity, 0, [25, 15, 10], 5, 1, output);
  assert.equal(output[3], 1);
});

test('soft resize preserves actors and switching to hard or hybrid reconciles without advancing time', () => {
  for (const mode of ['hard', 'hybrid']) {
    const simulation = isolated('soft');
    for (const item of simulation.obstacles) simulation.removeObstacle(item.id);
    simulation.positions.set([24, -23, 22]);
    simulation.velocities.set([6, -6, 6]);
    simulation.predator.set([24, -23, 22]);
    simulation.predatorVelocity.set([10, -10, 10]);
    const positions = simulation.positions.slice(),
      velocity = simulation.velocities.slice(),
      predator = simulation.predator.slice();
    simulation.resizeWorld({ width: 20, height: 30, depth: 40 });
    assert.deepEqual(simulation.positions, positions);
    assert.deepEqual(simulation.velocities, velocity);
    assert.deepEqual(simulation.predator, predator);
    assert.equal(simulation.metrics.outsideCount, 1);
    assert.equal(simulation.metrics.maxExcursion, 14);
    simulation.updateSettings({ boundaryMode: mode });
    assert.equal(simulation.time, 0);
    assert.equal(simulation.metrics.outsideCount, 0);
    assert.deepEqual([...simulation.positions.slice(0, 3)], [10, -15, 20]);
    assert.deepEqual([...simulation.velocities.slice(0, 3)], [-6, 6, -6]);
    assert.deepEqual([...simulation.predator], [9, -14, 19]);
    assert.deepEqual([...simulation.predatorVelocity], [0, 0, 0]);
    assert.deepEqual(simulation.previousPositions, simulation.positions);
    assert.deepEqual(simulation.previousPredator, simulation.predator);
  }
});

test('out-of-map grid candidates match independent neighbor oracles including corners and distant points', () => {
  const random = seededRandom(33),
    halves = [10.5, 100, 15],
    count = 250;
  const positions = new Float32Array(count * 3),
    grid = new SpatialGrid(halves, 10, count),
    output = new Int32Array(count);
  for (let i = 0; i < positions.length; i++)
    positions[i] = (random() * 2 - 1) * (halves[i % 3] + 30);
  positions.set([
    1000, 1000, 1000, 1001, 1001, 1001, -1000, -1000, -1000, -999, -999, -999, 10.5, 100, 15,
  ]);
  grid.rebuild(positions, count);
  for (const radius of [4, 10, 16, 32])
    for (let i = 0; i < count; i++) {
      const p = i * 3,
        found = grid.query(positions[p], positions[p + 1], positions[p + 2], radius, output);
      const within = (j) =>
        Math.hypot(...[0, 1, 2].map((axis) => positions[j * 3 + axis] - positions[p + axis])) <
        radius;
      const actual = [...output.subarray(0, found)].filter(within).sort((a, b) => a - b);
      assert.deepEqual(actual, Array.from({ length: count }, (_, j) => j).filter(within));
    }
});

test('soft grid and kd-tree trajectories outside the map agree with exhaustive search', () => {
  const simulations = ['grid', 'kd-tree', 'all-pairs'].map((type) => {
    const simulation = isolated('soft', {
      count: 64,
      cohesion: 1,
      alignment: 1,
      separation: 1,
      searchType: type === 'kd-tree' ? type : 'grid',
    });
    simulation.reset(7);
    for (let p = 0; p < simulation.count * 3; p++) simulation.positions[p] *= 3;
    if (type === 'all-pairs') simulation.search = new AllPairsSearch();
    return simulation;
  });
  for (let tick = 0; tick < 180; tick++)
    for (const simulation of simulations) simulation.step(FIXED_DT);
  for (const simulation of simulations.slice(0, 2))
    for (let i = 0; i < 64 * 3; i++)
      assert.ok(Math.abs(simulation.positions[i] - simulations[2].positions[i]) < 0.0005);
});

test('soft predator keeps continuous motion at the wall and arrives back at an interior target', () => {
  const simulation = isolated('soft', { predator: true, predatorSpeed: 24 });
  simulation.positions.set([100, 0, 0]);
  simulation.predator.set([23.99, 0, 0]);
  simulation.predatorVelocity.set([24, 0, 0]);
  let maximum = 0;
  for (let i = 0; i < 900; i++) {
    simulation.updatePredator(FIXED_DT);
    maximum = Math.max(maximum, simulation.predator[0]);
  }
  assert.ok(maximum > 25);
  assert.ok(Math.abs(simulation.predator[0] - 24) < 0.001);
  simulation.updateSettings({ predatorSpeed: 0 });
  const stationary = simulation.predator.slice();
  simulation.updatePredator(FIXED_DT);
  assert.deepEqual(simulation.predator, stationary);
});

test('obstacles remain solid in all modes and enabling them never clamps unrelated soft agents', () => {
  const normal = new Float64Array(3);
  for (const mode of ['hard', 'soft', 'hybrid']) {
    const simulation = isolated(mode, { count: 2 });
    simulation.positions.set([0, 0, 0, 40, 0, 0]);
    simulation.updateSettings({ obstacles: true });
    assert.ok(
      obstacleSurface(simulation.obstacles[0], ...simulation.positions.subarray(0, 3), normal) >=
        0.64999,
    );
    if (mode === 'soft') assert.equal(simulation.positions[3], 40);
  }
});

test('soft minimum and thin maps stay finite and retain obstacle clearance in extended motion', () => {
  const normal = new Float64Array(3);
  for (const searchType of ['grid', 'kd-tree'])
    for (const width of [20, 200]) {
      const simulation = new BoidSimulation(
        {
          count: 80,
          boundaryMode: 'soft',
          boundaryStrength: 0.25,
          boundaryMargin: 1,
          predator: true,
          predatorSpeed: 24,
          searchType,
        },
        { width, height: 20, depth: 30 },
      );
      simulation.reset(0);
      for (let tick = 0; tick < 1800; tick++) {
        simulation.step(FIXED_DT);
        if (tick % 60 !== 0) continue;
        finiteState(simulation);
        assert.ok(simulation.metrics.maxExcursion < 60, 'no runaway head-on flight');
        for (let p = 0; p < simulation.count * 3; p += 3)
          for (const obstacle of simulation.obstacles)
            assert.ok(
              obstacleSurface(obstacle, ...simulation.positions.subarray(p, p + 3), normal) >=
                0.6499,
            );
      }
    }
});

test('mode switches and soft resizes reproduce exactly at 30, 60 and 144 Hz', () => {
  const states = [30, 60, 144].map((hz) => {
    const simulation = isolated('hybrid', { count: 32, predator: true }),
      clock = new SimulationClock();
    for (const item of simulation.obstacles) simulation.removeObstacle(item.id);
    simulation.reset(0);
    let tick = 0;
    for (let frame = 0; frame < hz * 4; frame++)
      clock.advance(1 / hz, 1, (dt) => {
        if (tick === 20) simulation.updateSettings({ boundaryMode: 'soft' });
        if (tick === 40) simulation.resizeWorld({ width: 20, height: 20, depth: 20 });
        if (tick === 150) simulation.updateSettings({ boundaryMode: 'hard' });
        simulation.step(dt);
        tick++;
      });
    return {
      positions: simulation.positions,
      velocities: simulation.velocities,
      predator: simulation.predator,
      time: simulation.time,
    };
  });
  assert.deepEqual(states[0], states[1]);
  assert.deepEqual(states[1], states[2]);
});
