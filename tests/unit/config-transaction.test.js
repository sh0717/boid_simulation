import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, FIXED_DT } from '../../src/config.js';
import { BoidSimulation } from '../../src/simulation/boids.js';

function bytes(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

test('rejected search layouts leave every ABI config byte unchanged', () => {
  const simulation = new BoidSimulation({ count: 16 });
  try {
    const before = bytes(simulation.configBuffer);
    for (const [bounds, search, obstacleCount] of [
      [simulation.bounds, { cellSize: 0 }, simulation.obstacles.length],
      [simulation.bounds, { cellSize: 0.01 }, simulation.obstacles.length],
      [{ halfSize: [25, NaN, 25] }, simulation.grid, simulation.obstacles.length],
      [simulation.bounds, simulation.grid, 17],
    ]) {
      assert.throws(
        () =>
          simulation.bridge.writeConfig(
            { ...DEFAULTS, count: 32 },
            bounds,
            search,
            simulation.kdTree,
            obstacleCount,
          ),
        RangeError,
      );
      assert.deepEqual(bytes(simulation.configBuffer), before);
    }
  } finally {
    simulation.dispose();
  }
});

test('failed settings transition preserves settings identity, search choice and future motion', () => {
  const settings = { count: 16, searchType: 'kd-tree' };
  const simulation = new BoidSimulation(settings);
  const control = new BoidSimulation(settings);
  try {
    const settingsObject = simulation.settings;
    const beforeSettings = { ...settingsObject };
    const beforeConfig = bytes(simulation.configBuffer);
    const beforeSearch = simulation.search;
    simulation.grid.cellSize = 0;
    assert.throws(
      () => simulation.updateSettings({ cohesion: 1.5, searchType: 'grid' }),
      RangeError,
    );
    assert.equal(simulation.settings, settingsObject, 'UI keeps the same settings object');
    assert.deepEqual(simulation.settings, beforeSettings);
    assert.equal(simulation.search, beforeSearch);
    assert.deepEqual(bytes(simulation.configBuffer), beforeConfig);
    simulation.grid.cellSize = 10;
    for (let frame = 0; frame < 30; frame++) {
      simulation.step(FIXED_DT);
      control.step(FIXED_DT);
      assert.deepEqual(simulation.positions, control.positions);
      assert.deepEqual(simulation.velocities, control.velocities);
    }
  } finally {
    simulation.dispose();
    control.dispose();
  }
});

test('rejected obstacle records never partially overwrite the ABI obstacle buffer', () => {
  const simulation = new BoidSimulation({ count: 16 });
  try {
    const before = bytes(simulation.obstacleBuffer);
    const first = { type: 'sphere', x: 1, y: 2, z: 3, radius: 1 };
    for (const invalid of [
      { ...first, x: NaN },
      { type: 'box', x: 0, y: 0, z: 0, width: 1, height: 0, depth: 1 },
      { ...first, type: 'unknown' },
    ]) {
      assert.throws(() => simulation.bridge.writeObstacles([first, invalid]), RangeError);
      assert.deepEqual(bytes(simulation.obstacleBuffer), before);
    }
    assert.throws(() => simulation.bridge.writeObstacles(Array(17).fill(first)), RangeError);
    assert.deepEqual(bytes(simulation.obstacleBuffer), before);
  } finally {
    simulation.dispose();
  }
});
