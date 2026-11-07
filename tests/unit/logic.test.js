import test from 'node:test';
import assert from 'node:assert/strict';
import { BoidSimulation } from '../../src/simulation/boids.js';
import { SimulationClock } from '../../src/simulation/clock.js';
import { FIXED_DT } from '../../src/config.js';
import { SpatialGrid } from '../fixtures/spatial-grid.js';
import { KdTree } from '../fixtures/kd-tree.js';

function isolated(settings = {}) {
  return new BoidSimulation({
    count: 2,
    cohesion: 0,
    alignment: 0,
    separation: 0,
    goal: false,
    predator: false,
    obstacles: false,
    ...settings,
  });
}
function pair(simulation, positions = [-2, 0, 0, 2, 0, 0], velocities = [0, 0, 8, 0, 0, 8]) {
  simulation.positions.set(positions);
  simulation.velocities.set(velocities);
  simulation.previousPositions.set(simulation.positions);
  return simulation;
}

test('cohesion turns symmetric agents toward their local centroid', () => {
  const simulation = pair(isolated({ cohesion: 1 }));
  simulation.step(FIXED_DT);
  assert.ok(simulation.velocities[0] > 0);
  assert.ok(simulation.velocities[3] < 0);
  assert.equal(simulation.velocities[0], -simulation.velocities[3]);
});

test('separation turns nearby agents away from each other', () => {
  const simulation = pair(isolated({ separation: 1 }), [-1, 0, 0, 1, 0, 0]);
  simulation.step(FIXED_DT);
  assert.ok(simulation.velocities[0] < 0);
  assert.ok(simulation.velocities[3] > 0);
});

test('alignment reduces velocity difference without cohesion', () => {
  const simulation = pair(isolated({ alignment: 1 }), undefined, [0, 0, 8, 0, 8, 0]);
  const difference = () =>
    Math.hypot(
      ...[0, 1, 2].map((axis) => simulation.velocities[axis] - simulation.velocities[axis + 3]),
    );
  const before = difference();
  simulation.step(FIXED_DT);
  assert.ok(difference() < before);
});

test('neighbors at and beyond the strict perception radius contribute no flocking', () => {
  for (const distance of [10, 10.001, 18]) {
    const simulation = pair(isolated({ cohesion: 3, alignment: 3, separation: 3 }), [
      -distance / 2,
      0,
      0,
      distance / 2,
      0,
      0,
    ]);
    simulation.step(FIXED_DT);
    assert.deepEqual(Array.from(simulation.velocities.slice(0, 6)), [0, 0, 8, 0, 0, 8]);
  }
});

test('permuting non-overlapping agents preserves their corresponding trajectories', () => {
  const a = pair(
    isolated({ cohesion: 1, alignment: 1, separation: 1 }),
    [-1, 2, 0, 1, -2, 0],
    [3, 4, 5, -4, 3, 5],
  );
  const b = pair(
    isolated({ cohesion: 1, alignment: 1, separation: 1 }),
    [1, -2, 0, -1, 2, 0],
    [-4, 3, 5, 3, 4, 5],
  );
  for (let step = 0; step < 60; step++) {
    a.step(FIXED_DT);
    b.step(FIXED_DT);
  }
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(a.positions[axis] - b.positions[axis + 3]) < 1e-5);
    assert.ok(Math.abs(a.positions[axis + 3] - b.positions[axis]) < 1e-5);
  }
});

test('restart retains a caller-selected seed', () => {
  const simulation = isolated();
  simulation.reset(7);
  const initial = simulation.positions.slice();
  simulation.step(FIXED_DT);
  simulation.reset();
  assert.equal(simulation.seed, 7);
  assert.deepEqual(simulation.positions, initial);
});

test('non-finite settings are rejected before producing invalid motion', () => {
  assert.throws(() => isolated({ separation: NaN }), /finite|유한/);
  assert.throws(() => isolated({ cohesion: Infinity }), /finite|유한/);
});

test('invalid clock input cannot poison the accumulator', () => {
  const clock = new SimulationClock();
  for (const elapsed of [NaN, Infinity])
    assert.throws(() => clock.advance(elapsed, 1, () => {}), RangeError);
  for (const speed of [NaN, Infinity, -1])
    assert.throws(() => clock.advance(0.02, speed, () => {}), RangeError);
  assert.equal(clock.accumulator, 0);
});

test('180-degree field of view accepts ahead/side and excludes behind for cohesion', () => {
  const simulation = isolated({ count: 4, cohesion: 1, fieldOfView: 180 });
  simulation.positions.set([0, 0, 0, 0, 0, 5, 0, 0, -5, 5, 0, 0]);
  simulation.velocities.set([0, 0, 8, 0, 0, 8, 0, 0, 8, 0, 0, 8]);
  const info = simulation.inspect(0);
  assert.deepEqual(Array.from(info.neighbors.slice(0, info.neighborCount)).sort(), [1, 3]);
  assert.deepEqual(Array.from(info.cohesion), [1.5, 0, 1.5]);
});

test('rear close neighbor still causes separation outside a narrow field of view', () => {
  const simulation = pair(
    isolated({ cohesion: 1, separation: 1, fieldOfView: 60 }),
    [0, 0, 0, 0, 0, -1],
  );
  const info = simulation.inspect(0);
  assert.equal(info.neighborCount, 0);
  assert.equal(info.closeCount, 1);
  assert.deepEqual(Array.from(info.cohesion), [0, 0, 0]);
  assert.ok(info.separation[2] > 0);
});

test('variable perception spans multiple cells and agrees with exhaustive search', () => {
  for (const radius of [4, 9.5, 10, 10.5, 16])
    for (const angle of [60, 180, 270, 360]) {
      const a = new BoidSimulation({ count: 80, perception: radius, fieldOfView: angle });
      const b = new BoidSimulation({ count: 80, perception: radius, fieldOfView: angle });
      b.search = new SpatialGrid(25, 50, 1200);
      for (let step = 0; step < 20; step++) {
        a.step(FIXED_DT);
        b.step(FIXED_DT);
      }
      for (let i = 0; i < 80 * 3; i++)
        assert.ok(Math.abs(a.positions[i] - b.positions[i]) < 0.0001);
    }
  const simulation = pair(isolated({ perception: 16, cohesion: 1 }), [-6, 0, 0, 6, 0, 0]);
  assert.equal(simulation.inspect(0).neighborCount, 1);
});

test('inspector agrees with a separate all-pairs geometric neighbor oracle', () => {
  const simulation = new BoidSimulation({ count: 160, perception: 14, fieldOfView: 220 });
  for (const index of [0, 17, 64, 159]) {
    const expected = [],
      p = index * 3;
    const v = Array.from(simulation.velocities.slice(p, p + 3));
    for (let j = 0; j < simulation.count; j++) {
      if (j === index) continue;
      const delta = [0, 1, 2].map(
        (axis) => simulation.positions[j * 3 + axis] - simulation.positions[p + axis],
      );
      const distance = Math.hypot(...delta);
      const angle = Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            delta.reduce((sum, d, axis) => sum + d * v[axis], 0) / (distance * Math.hypot(...v)),
          ),
        ),
      );
      if (distance < 14 && angle <= (110 * Math.PI) / 180) expected.push(j);
    }
    const info = simulation.inspect(index);
    assert.deepEqual(
      Array.from(info.neighbors.slice(0, info.neighborCount)).sort((a, b) => a - b),
      expected,
    );
  }
});

test('diagnostics do not mutate motion, random state or performance counters', () => {
  const a = new BoidSimulation({ count: 80, fieldOfView: 120, predator: true });
  const b = new BoidSimulation({ count: 80, fieldOfView: 120, predator: true });
  for (let step = 0; step < 80; step++) {
    const counters = { ...a.metrics };
    const positions = a.positions.slice(),
      velocities = a.velocities.slice();
    a.inspect(step % 80);
    assert.deepEqual(a.metrics, counters);
    assert.deepEqual(a.positions, positions);
    assert.deepEqual(a.velocities, velocities);
    a.step(FIXED_DT);
    b.step(FIXED_DT);
  }
  assert.deepEqual(a.positions, b.positions);
});

test('settings transactions validate all fields before committing and clamp finite ranges', () => {
  const simulation = isolated();
  const before = { ...simulation.settings };
  assert.throws(() => simulation.updateSettings({ cohesion: 2, fieldOfView: NaN }));
  assert.deepEqual(simulation.settings, before);
  assert.throws(() => simulation.updateSettings({ goal: 'yes' }));
  assert.throws(() => simulation.updateSettings({ typo: 1 }));
  simulation.updateSettings({ perception: 100, fieldOfView: 0 });
  assert.equal(simulation.settings.perception, 16);
  assert.equal(simulation.settings.fieldOfView, 60);
});

test('seed zero is valid; invalid seeds fail before changing state', () => {
  const simulation = isolated();
  simulation.reset(0);
  const snapshot = simulation.positions.slice();
  for (const seed of [NaN, -1, 0x100000000, 2.5])
    assert.throws(() => simulation.reset(seed), RangeError);
  assert.equal(simulation.seed, 0);
  assert.deepEqual(simulation.positions, snapshot);
  simulation.reset();
  assert.deepEqual(simulation.positions, snapshot);
});

test('diagnostic neighborhood evaluation handles zero velocity and coincident agents', () => {
  const simulation = pair(
    isolated({ fieldOfView: 60, separation: 1 }),
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  );
  const first = simulation.inspect(0).separation.slice();
  const second = simulation.inspect(1).separation.slice();
  assert.deepEqual(Array.from(first), [-13, 0, 0]);
  assert.deepEqual(Array.from(second), [13, 0, 0]);
});

test('goal speed zero freezes the target and a speed change preserves phase', () => {
  const simulation = isolated({ goal: true });
  for (let i = 0; i < 60; i++) simulation.step(FIXED_DT);
  const position = simulation.goal.slice();
  simulation.updateSettings({ goalSpeed: 0 });
  for (let i = 0; i < 60; i++) simulation.step(FIXED_DT);
  assert.deepEqual(simulation.goal, position);
  simulation.updateSettings({ goalSpeed: 2 });
  assert.deepEqual(simulation.goal, position);
  simulation.step(FIXED_DT);
  const displacement = Math.hypot(
    ...[0, 1, 2].map((axis) => simulation.goal[axis] - position[axis]),
  );
  assert.ok(displacement > 0 && displacement < 0.2, `phase discontinuity: ${displacement}`);
});

test('goal strength zero matches disabled goal; positive weight steers toward target', () => {
  const a = pair(isolated({ goal: true, goalStrength: 0 }));
  const b = pair(isolated({ goal: false }));
  a.step(FIXED_DT);
  b.step(FIXED_DT);
  assert.deepEqual(a.positions, b.positions);
  const c = pair(isolated({ goal: true, goalStrength: 2 }));
  c.step(FIXED_DT);
  assert.ok(c.velocities[0] > 0);
});

test('predator speed is bounded and zero freezes its position', () => {
  const simulation = isolated({ predator: true });
  simulation.updateSettings({ predatorSpeed: 2 });
  simulation.step(FIXED_DT);
  assert.ok(Math.hypot(...simulation.predatorVelocity) <= 2.00001);
  const position = simulation.predator.slice();
  simulation.updateSettings({ predatorSpeed: 0 });
  for (let i = 0; i < 10; i++) simulation.step(FIXED_DT);
  assert.deepEqual(simulation.predator, position);
  assert.equal(Math.hypot(...simulation.predatorVelocity), 0);
});

test('predator avoidance obeys its radius and strength and points away from predator', () => {
  const create = (radius, strength) => {
    const s = pair(
      isolated({
        predator: true,
        predatorSpeed: 0,
        predatorRadius: radius,
        predatorStrength: strength,
      }),
      [0, 0, 0, 15, 0, 0],
    );
    s.predator.set([6, 0, 0]);
    return s;
  };
  const outside = create(4, 1),
    zero = create(12, 0),
    inside = create(12, 1);
  outside.step(FIXED_DT);
  zero.step(FIXED_DT);
  inside.step(FIXED_DT);
  assert.equal(outside.velocities[0], 0);
  assert.equal(zero.velocities[0], 0);
  assert.ok(inside.velocities[0] < 0);
});

test('kd-tree queries match grid and independent neighbor oracle for dynamic points', () => {
  for (const count of [1, 80, 320, 1200]) {
    const simulation = new BoidSimulation({
      count,
      searchType: 'kd-tree',
      fieldOfView: 240,
      perception: 16,
    });
    for (let step = 0; step < 10; step++) simulation.step(FIXED_DT);
    for (const index of [0, Math.floor(count / 2), count - 1]) {
      const kd = simulation.inspect(index);
      const expected = Array.from(kd.neighbors.slice(0, kd.neighborCount)).sort((a, b) => a - b);
      simulation.updateSettings({ searchType: 'grid' });
      const grid = simulation.inspect(index);
      assert.deepEqual(
        Array.from(grid.neighbors.slice(0, grid.neighborCount)).sort((a, b) => a - b),
        expected,
      );
      simulation.updateSettings({ searchType: 'kd-tree' });
    }
  }
});

test('kd-tree handles empty, coincident and split-plane points without missing or duplicating candidates', () => {
  const tree = new KdTree(100),
    points = new Float32Array(300),
    output = new Int32Array(100);
  tree.rebuild(points, 0);
  assert.equal(tree.query(0, 0, 0, 1, output), 0);
  tree.rebuild(points, 100);
  assert.equal(tree.query(0, 0, 0, 1, output), 100);
  assert.equal(new Set(output).size, 100);
  for (let i = 0; i < 100; i++) points[i * 3 + 1] = i / 10;
  tree.rebuild(points, 100);
  const count = tree.query(0, 5, 0, 2, output);
  const exact = Array.from(output.slice(0, count))
    .filter((i) => Math.abs(points[i * 3 + 1] - 5) < 2)
    .sort((a, b) => a - b);
  const brute = Array.from({ length: 100 }, (_, i) => i).filter(
    (i) => Math.abs(points[i * 3 + 1] - 5) < 2,
  );
  assert.deepEqual(exact, brute);
});

test('grid and kd-tree produce equivalent trajectories within floating-point tolerance', () => {
  const grid = new BoidSimulation({ count: 320, predator: true, fieldOfView: 210 });
  const kd = new BoidSimulation({
    count: 320,
    predator: true,
    fieldOfView: 210,
    searchType: 'kd-tree',
  });
  for (let step = 0; step < 180; step++) {
    grid.step(FIXED_DT);
    kd.step(FIXED_DT);
  }
  let error = 0;
  for (let i = 0; i < 320 * 3; i++)
    error = Math.max(error, Math.abs(grid.positions[i] - kd.positions[i]));
  assert.ok(error < 0.0001, `maximum deviation ${error}`);
});
