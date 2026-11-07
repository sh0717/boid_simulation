import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { BoidSimulation, seededRandom } from '../../src/simulation/boids.js';
import { SpatialGrid, AllPairsSearch } from '../fixtures/spatial-grid.js';
import { SimulationClock } from '../../src/simulation/clock.js';
import { createWorldBounds, DEFAULT_MAP_SIZE } from '../../src/simulation/world-bounds.js';
import { sampleGoalPath } from '../../src/simulation/goal-path.js';
import { GoalVisual } from '../../src/rendering/goal-visual.js';
import { BoidScene } from '../../src/rendering/scene.js';
import { FIXED_DT, WORLD } from '../../src/config.js';

function clearObstacles(simulation) {
  for (const item of simulation.obstacles) simulation.removeObstacle(item.id);
}
function checkBounds(simulation) {
  for (let p = 0; p < simulation.count * 3; p += 3) {
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Number.isFinite(simulation.positions[p + axis]) &&
          Math.abs(simulation.positions[p + axis]) <= simulation.bounds.halfSize[axis],
      );
    const speed = Math.hypot(...simulation.velocities.subarray(p, p + 3));
    assert.ok(speed >= 4.99999 && speed <= 12.00001);
    for (const obstacle of simulation.obstacles) {
      const relative = [
        simulation.positions[p] - obstacle.x,
        simulation.positions[p + 1] - obstacle.y,
        simulation.positions[p + 2] - obstacle.z,
      ];
      const gap =
        obstacle.type === 'sphere'
          ? Math.hypot(...relative) - obstacle.radius
          : Math.hypot(
              ...relative.map((value, axis) =>
                Math.max(
                  0,
                  Math.abs(value) - [obstacle.width, obstacle.height, obstacle.depth][axis] / 2,
                ),
              ),
            );
      assert.ok(gap >= 0.6499, `obstacle gap ${gap}`);
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(
      Number.isFinite(simulation.predator[axis]) &&
        Math.abs(simulation.predator[axis]) <= simulation.bounds.halfSize[axis] - 1,
    );
    assert.ok(
      Number.isFinite(simulation.goal[axis]) &&
        Math.abs(simulation.goal[axis]) < simulation.bounds.halfSize[axis],
    );
  }
}

test('world bounds validate full dimensions atomically and expose immutable half extents', () => {
  const bounds = createWorldBounds({ width: 21, height: 200, depth: 20 });
  assert.deepEqual(bounds.halfSize, [10.5, 100, 10]);
  assert.ok(Object.isFrozen(bounds) && Object.isFrozen(bounds.halfSize));
  for (const value of [NaN, Infinity, -Infinity, '50', null, 0, -20, 19, 501, 30.5])
    assert.throws(() => createWorldBounds({ width: value }), RangeError);
  assert.throws(() => createWorldBounds({ x: 50 }), TypeError);
});

test('world enlargement preserves time, seed, positions, obstacles and control settings without restarting', () => {
  const simulation = new BoidSimulation({ count: 64, predator: true });
  simulation.reset(7);
  simulation.step(FIXED_DT);
  const positions = simulation.positions.slice(),
    items = simulation.obstacles,
    phase = simulation.goalTime,
    goal = simulation.goal.slice();
  const settings = { ...simulation.settings },
    time = simulation.time,
    oldGrid = simulation.grid;
  assert.equal(simulation.resizeWorld({ width: 100, height: 70, depth: 200 }), true);
  assert.deepEqual(simulation.positions, positions);
  assert.equal(simulation.obstacles, items);
  assert.equal(simulation.time, time);
  assert.equal(simulation.goalTime, phase);
  assert.equal(simulation.seed, 7);
  assert.deepEqual(simulation.settings, settings);
  assert.deepEqual(simulation.goal, goal);
  assert.notEqual(simulation.grid, oldGrid);
  assert.deepEqual(simulation.grid.size, [10, 7, 20]);
  assert.equal(simulation.grid.heads.length, 1400);
  assert.deepEqual(simulation.previousPositions, simulation.positions);
  const revision = simulation.boundsRevision,
    grid = simulation.grid;
  assert.equal(simulation.resizeWorld({ width: 100 }), false);
  assert.equal(simulation.boundsRevision, revision);
  assert.equal(simulation.grid, grid);
});

test('invalid or obstructed resize leaves all state and indexes unchanged including hidden obstacles', () => {
  const simulation = new BoidSimulation({ count: 16, obstacles: false });
  simulation.step(FIXED_DT);
  const bounds = simulation.bounds,
    grid = simulation.grid,
    items = simulation.obstacles;
  const positions = simulation.positions.slice(),
    predator = simulation.predator.slice(),
    goal = simulation.goal.slice();
  const time = simulation.time,
    revision = simulation.boundsRevision;
  for (const patch of [
    { width: 20, height: 100 },
    { width: 100, depth: NaN },
    { height: 999 },
    { width: 40.5 },
  ])
    assert.throws(() => simulation.resizeWorld(patch), RangeError);
  assert.equal(simulation.bounds, bounds);
  assert.equal(simulation.grid, grid);
  assert.equal(simulation.search, grid);
  assert.equal(simulation.obstacles, items);
  assert.equal(simulation.obstacleLayout.bounds, bounds);
  assert.equal(simulation.time, time);
  assert.equal(simulation.boundsRevision, revision);
  assert.deepEqual(simulation.positions, positions);
  assert.deepEqual(simulation.predator, predator);
  assert.deepEqual(simulation.goal, goal);
});

test('shrinking reconciles boids and predator per axis and synchronizes interpolation without advancing time', () => {
  const simulation = new BoidSimulation({ count: 2, predator: true });
  clearObstacles(simulation);
  simulation.positions.set([24, -24, 24, -24, 24, -24]);
  simulation.velocities.set([6, -6, 6, -6, 6, -6]);
  simulation.predator.set([24, -24, 24]);
  simulation.predatorVelocity.set([7, -7, 7]);
  simulation.resizeWorld({ width: 20, height: 30, depth: 40 });
  assert.deepEqual([...simulation.positions.slice(0, 6)], [10, -15, 20, -10, 15, -20]);
  assert.deepEqual([...simulation.velocities.slice(0, 6)], [-6, 6, -6, 6, -6, 6]);
  assert.deepEqual([...simulation.predator], [9, -14, 19]);
  assert.deepEqual([...simulation.predatorVelocity], [0, 0, 0]);
  assert.deepEqual(simulation.predator, simulation.previousPredator);
  assert.deepEqual(simulation.positions, simulation.previousPositions);
  assert.equal(simulation.goalAdvance, 0);
  assert.equal(simulation.time, 0);
  checkBounds(simulation);
});

test('rectangular grids find every exact neighbor at cell faces and outer boundaries', () => {
  for (const halves of [
    [10, 100, 15],
    [100, 10.5, 100],
    [25, 25, 25],
  ]) {
    const random = seededRandom(9),
      positions = new Float32Array(256 * 3),
      grid = new SpatialGrid(halves, 10, 256),
      output = new Int32Array(256);
    for (let i = 0; i < positions.length; i++) positions[i] = (random() * 2 - 1) * halves[i % 3];
    positions.set(halves);
    positions.set(
      halves.map((value) => -value),
      3,
    );
    grid.rebuild(positions, 256);
    for (const radius of [4, 10, 16, 32])
      for (let index = 0; index < 256; index += 11) {
        const p = index * 3,
          count = grid.query(positions[p], positions[p + 1], positions[p + 2], radius, output);
        const within = (i) =>
          Math.hypot(
            positions[i * 3] - positions[p],
            positions[i * 3 + 1] - positions[p + 1],
            positions[i * 3 + 2] - positions[p + 2],
          ) < radius;
        const actual = [...output.slice(0, count)].filter(within).sort((a, b) => a - b);
        const expected = Array.from({ length: 256 }, (_, i) => i).filter(within);
        assert.deepEqual(actual, expected);
      }
  }
});

test('resized grid and kd-tree trajectories agree with exhaustive search', () => {
  const simulations = ['grid', 'kd-tree', 'all-pairs'].map((searchType) => {
    const simulation = new BoidSimulation({
      count: 80,
      predator: true,
      searchType: searchType === 'kd-tree' ? searchType : 'grid',
    });
    simulation.resizeWorld({ width: 120, height: 40, depth: 70 });
    simulation.reset(19);
    if (searchType === 'all-pairs') simulation.search = new AllPairsSearch();
    return simulation;
  });
  for (let tick = 0; tick < 90; tick++)
    for (const simulation of simulations) simulation.step(FIXED_DT);
  for (const simulation of simulations.slice(0, 2)) {
    for (let i = 0; i < 80 * 3; i++)
      assert.ok(Math.abs(simulation.positions[i] - simulations[2].positions[i]) < 0.0002);
  }
});

test('minimum, maximum and thin maps preserve collision and boundary invariants during long motion', () => {
  for (const map of [
    { width: 20, height: 20, depth: 20 },
    { width: 200, height: 200, depth: 200 },
    { width: 21, height: 200, depth: 30 },
    { width: 500, height: 500, depth: 500 },
    { width: 500, height: 20, depth: 300 },
  ])
    for (const searchType of ['grid', 'kd-tree']) {
      const simulation = new BoidSimulation(
        { count: 96, predator: true, goalSpeed: 2, searchType },
        map,
      );
      simulation.reset(7);
      for (let tick = 0; tick < 600; tick++) {
        simulation.step(0.05);
        if (tick % 30 === 0) checkBounds(simulation);
      }
      checkBounds(simulation);
      assert.ok(simulation.grid.heads.length <= 8000);
    }
});

test('obstacle editing, defaults and complete restoration use the current map bounds', () => {
  const simulation = new BoidSimulation();
  simulation.resizeWorld({ width: 200, height: 100, depth: 100 });
  const id = simulation.addObstacle('box');
  simulation.updateObstacle(id, { x: 80, y: 0, z: 0, width: 12 });
  assert.throws(() => simulation.resizeWorld(DEFAULT_MAP_SIZE), /OBS/);
  const revision = simulation.obstacleRevision;
  simulation.resizeWorld(DEFAULT_MAP_SIZE, { resetObstacles: true });
  assert.equal(simulation.obstacles.length, 2);
  assert.equal(simulation.bounds.width, 50);
  assert.ok(simulation.obstacleRevision > revision);
  clearObstacles(simulation);
  simulation.resizeWorld({ width: 20, height: 24, depth: 30 });
  simulation.resetObstacles();
  simulation.obstacleLayout.validateBounds(simulation.bounds);
  for (const item of simulation.obstacles) simulation.obstacleLayout.validate(item, item.id);
  checkBounds(simulation);
});

test('restart and population changes retain map size and seed reproducibility', () => {
  const simulation = new BoidSimulation({ count: 32 });
  simulation.resizeWorld({ width: 100, height: 80, depth: 60 });
  simulation.reset(13);
  const positions = simulation.positions.slice(),
    bounds = simulation.bounds;
  simulation.step(FIXED_DT);
  simulation.reset();
  assert.deepEqual(simulation.positions, positions);
  assert.equal(simulation.bounds, bounds);
  assert.equal(simulation.seed, 13);
  simulation.updateSettings({ count: 160 });
  simulation.reset();
  assert.equal(simulation.bounds, bounds);
  assert.equal(simulation.count, 160);
  checkBounds(simulation);
});

test('goal path, position and tangent fit smaller axes and reuse existing geometry buffers', () => {
  const simulation = new BoidSimulation(),
    visual = new GoalVisual(null);
  const geometry = visual.path.geometry,
    vertices = geometry.attributes.position.array,
    distances = geometry.attributes.lineDistance.array;
  clearObstacles(simulation);
  simulation.resizeWorld({ width: 20, height: 30, depth: 200 });
  simulation.goalTime = 3;
  simulation.updateGoal();
  simulation.snapInterpolation();
  visual.update(simulation, 1);
  const base = new Float64Array(3);
  sampleGoalPath(3, base);
  assert.ok(
    visual.goal.position.distanceTo(new Vector3(base[0] * 0.4, base[1] * 0.6, base[2])) < 1e-5,
  );
  assert.equal(visual.path.geometry, geometry);
  assert.equal(geometry.attributes.position.array, vertices);
  assert.equal(geometry.attributes.lineDistance.array, distances);
  for (let i = 0; i < vertices.length; i++)
    assert.ok(Math.abs(vertices[i]) < simulation.bounds.halfSize[i % 3]);
  for (let i = 1; i < distances.length; i++) assert.ok(distances[i] > distances[i - 1]);
});

test('environment scaling and camera fit/reset defaults follow map dimensions without rebuilding objects', () => {
  const simulation = new BoidSimulation();
  const scene = {
    environment: new Object3D(),
    camera: new PerspectiveCamera(43, 1, 0.1, 400),
    scene: { fog: { density: 0.0065 } },
    controls: { target: new Vector3(0, -2, 0), position0: new Vector3(), target0: new Vector3() },
  };
  scene.camera.position.set(69, 48, 75);
  BoidScene.prototype.syncWorld.call(scene, simulation);
  simulation.resizeWorld({ width: 200, height: 100, depth: 50 });
  BoidScene.prototype.syncWorld.call(scene, simulation);
  assert.deepEqual(scene.environment.scale.toArray(), [4, 2, 1]);
  assert.deepEqual(scene.camera.position.toArray(), [276, 192, 300]);
  assert.deepEqual(scene.controls.position0.toArray(), [276, 192, 300]);
  assert.equal(scene.camera.far, 1600);
  assert.equal(scene.controls.maxDistance, 680);
  simulation.resizeWorld(DEFAULT_MAP_SIZE);
  BoidScene.prototype.syncWorld.call(scene, simulation);
  assert.deepEqual(scene.camera.position.toArray(), [69, 48, 75]);
  simulation.updateSettings({ boundaryMode: 'soft' });
  clearObstacles(simulation);
  simulation.positions.fill(0);
  simulation.positions[0] = 40;
  simulation.resizeWorld({ width: 20, height: 20, depth: 20 });
  BoidScene.prototype.syncWorld.call(scene, simulation);
  assert.deepEqual(scene.environment.scale.toArray(), [0.4, 0.4, 0.4]);
  assert.deepEqual(
    scene.camera.position.toArray(),
    [69 * 1.6, 48 * 1.6, 75 * 1.6],
    'soft shrink includes the existing flock when fitting',
  );
});

test('resize sequences reproduce the same state under 30, 60 and 144 Hz playback', () => {
  const states = [30, 60, 144].map((hz) => {
    const simulation = new BoidSimulation({ count: 64, predator: true }),
      clock = new SimulationClock();
    clearObstacles(simulation);
    simulation.reset(0);
    let tick = 0;
    for (let frame = 0; frame < hz * 3; frame++)
      clock.advance(1 / hz, 1, (dt) => {
        if (tick === 30) simulation.resizeWorld({ width: 100, height: 40, depth: 80 });
        if (tick === 80) simulation.resizeWorld({ width: 20, height: 30, depth: 40 });
        simulation.step(dt);
        tick++;
      });
    return {
      positions: simulation.positions,
      predator: simulation.predator,
      goal: simulation.goal,
      time: simulation.time,
      bounds: simulation.bounds,
    };
  });
  assert.deepEqual(states[0], states[1]);
  assert.deepEqual(states[1], states[2]);
});
