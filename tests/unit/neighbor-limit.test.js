import test from 'node:test';
import assert from 'node:assert/strict';
import { BoidSimulation } from '../../src/simulation/boids.js';

function neighborIds(simulation, index = 0) {
  const inspection = simulation.inspect(index);
  return [...inspection.neighbors.subarray(0, inspection.neighborCount)];
}

for (const searchType of ['grid', 'kd-tree']) {
  test(`${searchType} selects closest neighbors and breaks equal distances by index`, () => {
    const simulation = new BoidSimulation({ count: 7, searchType, obstacles: false });
    try {
      simulation.positions.set([0, 0, 0, 4, 0, 0, -1, 0, 0, 1, 0, 0, 2, 0, 0, 10, 0, 0, 0, 0, 0]);
      assert.equal(simulation.settings.maxNeighbors, 0);
      assert.deepEqual(
        neighborIds(simulation).sort((a, b) => a - b),
        [1, 2, 3, 4, 6],
      );
      simulation.updateSettings({ maxNeighbors: 2 });
      assert.deepEqual(neighborIds(simulation), [6, 2]);
      simulation.updateSettings({ maxNeighbors: 3 });
      assert.deepEqual(neighborIds(simulation), [6, 2, 3]);
      simulation.updateSettings({ maxNeighbors: 9 });
      assert.deepEqual(neighborIds(simulation), [6, 2, 3, 4, 1]);
      simulation.updateSettings({ maxNeighbors: 0 });
      assert.deepEqual(
        neighborIds(simulation).sort((a, b) => a - b),
        [1, 2, 3, 4, 6],
      );
    } finally {
      simulation.dispose();
    }
  });

  test(`${searchType} selects by distance before FOV and separation`, () => {
    const simulation = new BoidSimulation({
      count: 3,
      searchType,
      obstacles: false,
      fieldOfView: 60,
      maxNeighbors: 1,
    });
    try {
      simulation.positions.set([0, 0, 0, -1, 0, 0, 2, 0, 0]);
      simulation.velocities.set([5, 0, 0, 5, 0, 0, 5, 0, 0]);
      const inspection = simulation.inspect(0);
      assert.equal(inspection.neighborCount, 0, 'nearest neighbor is behind the viewing cone');
      assert.equal(inspection.closeCount, 1, 'nearest neighbor still contributes to separation');
      simulation.updateSettings({ maxNeighbors: 2 });
      assert.deepEqual(neighborIds(simulation), [2]);
      assert.equal(simulation.inspection.closeCount, 2);
    } finally {
      simulation.dispose();
    }
  });
}

test('an invalid direct limit write leaves the prior limit and ABI config untouched', () => {
  const simulation = new BoidSimulation({ count: 3, obstacles: false, maxNeighbors: 1 });
  try {
    simulation.positions.set([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const before = simulation.configBuffer.slice();
    assert.throws(
      () =>
        simulation.bridge.writeConfig(
          { ...simulation.settings, maxNeighbors: -1 },
          simulation.bounds,
          simulation.search,
          simulation.kdTree,
          simulation.obstacles.length,
        ),
      RangeError,
    );
    assert.deepEqual(simulation.configBuffer, before);
    assert.deepEqual(neighborIds(simulation), [1]);
  } finally {
    simulation.dispose();
  }
});
