import test from 'node:test';
import assert from 'node:assert/strict';
import { BoidSimulation } from '../../src/simulation/boids.js';
import { ObstacleLayout, obstacleSurface } from '../../src/simulation/obstacles.js';
import { FIXED_DT, MAX_OBSTACLES, OBSTACLE_CLEARANCE, WORLD } from '../../src/config.js';

function emptyLayout() {
  const layout = new ObstacleLayout();
  for (const item of layout.items) layout.remove(item.id);
  return layout;
}

function singleObstacle(type) {
  const simulation = new BoidSimulation({ count: 1, goal: false });
  for (const item of simulation.obstacles) simulation.removeObstacle(item.id);
  const id = simulation.addObstacle(type);
  simulation.updateObstacle(id, {
    x: 0,
    y: 0,
    z: 0,
    ...(type === 'sphere' ? { radius: 3 } : { width: 6, height: 6, depth: 6 }),
  });
  return simulation;
}

// Independent nearest-point oracle, including explicit box-inside rejection.
function assertOutside(simulation) {
  for (let p = 0; p < simulation.count * 3; p += 3) {
    const position = Array.from(simulation.positions.slice(p, p + 3));
    assert.ok(
      position.every((value) => Number.isFinite(value) && Math.abs(value) <= WORLD.halfSize),
    );
    const speed = Math.hypot(...simulation.velocities.slice(p, p + 3));
    assert.ok(speed >= WORLD.minSpeed - 1e-4 && speed <= WORLD.maxSpeed + 1e-4);
    for (const item of simulation.obstacles) {
      let distance;
      if (item.type === 'sphere')
        distance =
          Math.hypot(position[0] - item.x, position[1] - item.y, position[2] - item.z) -
          item.radius;
      else {
        const center = [item.x, item.y, item.z],
          half = [item.width / 2, item.height / 2, item.depth / 2];
        const nearest = position.map((value, axis) =>
          Math.max(center[axis] - half[axis], Math.min(center[axis] + half[axis], value)),
        );
        distance = Math.hypot(...position.map((value, axis) => value - nearest[axis]));
      }
      assert.ok(distance >= OBSTACLE_CLEARANCE - 2e-5, `${item.type} penetration: ${distance}`);
    }
  }
}

test('box surface handles faces, edges, corners, interior and deterministic center ties', () => {
  const box = { type: 'box', x: 0, y: 0, z: 0, width: 6, height: 8, depth: 10 };
  const normal = new Float64Array(3);
  for (const [point, distance, direction] of [
    [[4, 0, 0], 1, [1, 0, 0]],
    [[-4, 0, 0], 1, [-1, 0, 0]],
    [[0, 3, 0], -1, [0, 1, 0]],
    [[3, 0, 0], 0, [1, 0, 0]],
    [[0, 0, 0], -3, [1, 0, 0]],
    [[4, 5, 5], Math.sqrt(2), [Math.SQRT1_2, Math.SQRT1_2, 0]],
    [[4, 5, 6], Math.sqrt(3), [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]],
  ]) {
    assert.ok(Math.abs(obstacleSurface(box, ...point, normal) - distance) < 1e-12);
    direction.forEach((value, axis) => assert.ok(Math.abs(normal[axis] - value) < 1e-12));
  }
});

test('add supports both types, stable IDs, immutable snapshots and the obstacle cap', () => {
  const layout = emptyLayout();
  for (let i = 0; i < MAX_OBSTACLES; i++) layout.add(i % 2 ? 'box' : 'sphere');
  assert.equal(new Set(layout.items.map((item) => item.id)).size, MAX_OBSTACLES);
  assert.throws(() => layout.add(), RangeError);
  const snapshot = layout.items,
    removed = snapshot[0].id;
  layout.remove(removed);
  const id = layout.add('box');
  assert.ok(id > Math.max(...snapshot.map((item) => item.id)));
  assert.ok(Object.isFrozen(snapshot) && snapshot.every(Object.isFrozen));
  assert.equal(snapshot.length, MAX_OBSTACLES);
});

test('invalid edits are atomic, including NaN, infinity, zero size, unknown fields and world edges', () => {
  for (const type of ['sphere', 'box']) {
    const layout = emptyLayout(),
      id = layout.add(type);
    const size = type === 'sphere' ? 'radius' : 'width';
    const items = layout.items,
      revision = layout.revision;
    for (const patch of [
      { x: NaN },
      { y: Infinity },
      { z: '3' },
      { [size]: 0 },
      { [size]: -1 },
      { [size]: NaN },
      { [size]: Infinity },
      { [size]: 30 },
      { x: 25 },
      { id: 20 },
      { type: 'box' },
      { typo: 1 },
    ]) {
      assert.throws(() => layout.update(id, patch));
      assert.equal(layout.items, items);
      assert.equal(layout.revision, revision);
    }
    assert.throws(() => layout.add('capsule'));
    assert.throws(() => layout.update(999, { x: 0 }));
    assert.throws(() => layout.remove(999));
    assert.equal(layout.revision, revision);
    const extent = type === 'sphere' ? items[0].radius : items[0].width / 2;
    layout.update(id, { x: WORLD.halfSize - extent - OBSTACLE_CLEARANCE });
  }
});

test('sphere/sphere, sphere/box and box/box layouts enforce clearance without bounding-sphere false positives', () => {
  for (const first of ['sphere', 'box'])
    for (const second of ['sphere', 'box']) {
      const layout = emptyLayout(),
        a = layout.add(first),
        b = layout.add(second);
      layout.update(a, { x: -12, y: 0, z: 0 });
      assert.throws(() => layout.update(b, { x: -12, y: 0, z: 0 }));
      layout.update(b, { x: 12, y: 0, z: 0 });
    }
  const layout = emptyLayout(),
    a = layout.add('box'),
    b = layout.add('sphere');
  layout.update(a, { x: -10, y: 0, z: 0, width: 1, height: 20, depth: 1 });
  layout.update(b, { x: -6, y: 0, z: 0, radius: 1 });
  assert.equal(layout.items.find((item) => item.id === b).x, -6);
});

test('sphere and box projection resolves centers, faces and corners without non-finite velocity', () => {
  for (const type of ['sphere', 'box']) {
    const simulation = singleObstacle(type);
    for (const point of [
      [0, 0, 0],
      [2.9, 0, 0],
      [-3.1, 0, 0],
      [0, 3.1, 0],
      [0, 0, -3.1],
      [3.2, 3.2, 0],
      [3.2, 3.2, 3.2],
    ]) {
      simulation.positions.set(point);
      simulation.velocities.fill(0);
      if (point.some((value) => value !== 0)) simulation.velocities.set([0, 0, 8]);
      simulation.reconcileObstacles();
      assertOutside(simulation);
      assert.deepEqual(simulation.previousPositions, simulation.positions);
    }
  }
});

test('box contact reflects inward velocity and lookahead steers before contact', () => {
  const simulation = singleObstacle('box');
  simulation.positions.set([3.2, 0, 0]);
  simulation.velocities.set([-8, 0, 0]);
  simulation.reconcileObstacles();
  assert.ok(simulation.velocities[0] > 0);
  simulation.positions.set([6, 0, 0]);
  simulation.velocities.set([-8, 0, 0]);
  simulation.step(FIXED_DT);
  assert.ok(simulation.velocities[0] > -8);
  assert.ok(simulation.positions[0] > 5, 'steering precedes projection');
});

test('minimum-size solids and obstacles touching the allowed world edge preserve collision and hard bounds', () => {
  for (const type of ['sphere', 'box'])
    for (const sign of [-1, 1]) {
      const simulation = singleObstacle(type),
        id = simulation.obstacles[0].id;
      simulation.updateObstacle(
        id,
        type === 'sphere' ? { radius: 0.5 } : { width: 1, height: 1, depth: 1 },
      );
      simulation.positions.set([-1.2, 0, 0]);
      simulation.velocities.set([12, 0, 0]);
      simulation.step(0.05);
      assertOutside(simulation);
      const x = sign * (WORLD.halfSize - 0.5 - OBSTACLE_CLEARANCE);
      simulation.updateObstacle(id, { x });
      simulation.positions.set([x + sign * 0.3, 0, 0]);
      simulation.velocities.set([sign * 8, 0, 0]);
      simulation.reconcileObstacles();
      assertOutside(simulation);
    }
});

test('editing size or position reconciles paused agents; enabling obstacles reconciles disabled edits', () => {
  for (const type of ['sphere', 'box']) {
    const simulation = singleObstacle(type),
      id = simulation.obstacles[0].id;
    simulation.positions.set([4, 0, 0]);
    simulation.velocities.set([-8, 0, 0]);
    simulation.updateObstacle(id, type === 'sphere' ? { radius: 5 } : { width: 10 });
    assertOutside(simulation);
    assert.equal(simulation.time, 0);
    simulation.updateSettings({ obstacles: false });
    simulation.positions.fill(0);
    simulation.updateObstacle(id, { x: 1 });
    assert.equal(simulation.positions[0], 0);
    simulation.updateSettings({ obstacles: true });
    assertOutside(simulation);
    assert.deepEqual(simulation.previousPositions, simulation.positions);
  }
});

test('custom layout and seed survive restarts and population changes; reset restores default spheres', () => {
  const simulation = singleObstacle('box');
  const id = simulation.obstacles[0].id;
  simulation.updateObstacle(id, { x: 5, width: 8, height: 2, depth: 10 });
  simulation.reset(7);
  const layout = simulation.obstacles,
    positions = simulation.positions.slice();
  simulation.step(FIXED_DT);
  simulation.reset();
  assert.deepEqual(simulation.positions, positions);
  assert.equal(simulation.obstacles, layout);
  simulation.updateSettings({ count: 160 });
  simulation.reset();
  assert.equal(simulation.obstacles, layout);
  simulation.resetObstacles();
  assert.equal(simulation.obstacles.length, 2);
  assert.ok(simulation.obstacles.every((item) => item.type === 'sphere'));
  assertOutside(simulation);
});

test('mixed resized layouts remain finite, bounded and outside solids under grid and kd-tree motion', () => {
  for (const searchType of ['grid', 'kd-tree']) {
    const simulation = new BoidSimulation({ count: 160, predator: true, searchType });
    const box = simulation.addObstacle('box');
    simulation.updateObstacle(box, { x: -13, y: 3, z: 0, width: 4, height: 12, depth: 8 });
    simulation.addObstacle('sphere');
    for (let step = 0; step < 480; step++) {
      simulation.step(FIXED_DT);
      if (step % 20 === 0) assertOutside(simulation);
    }
    assertOutside(simulation);
  }
});
