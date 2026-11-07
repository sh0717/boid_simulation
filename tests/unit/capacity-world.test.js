import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BOIDS, FIXED_DT } from '../../src/config.js';
import { BoidSimulation } from '../../src/simulation/boids.js';

for (const searchType of ['grid', 'kd-tree']) {
  test(`10,000 boids advance, inspect and resize with ${searchType}`, () => {
    assert.equal(MAX_BOIDS, 10000);
    const simulation = new BoidSimulation(
      { count: MAX_BOIDS, searchType },
      { width: 200, height: 200, depth: 200 },
    );
    try {
      const memory = simulation.positions.buffer;
      assert.equal(memory.byteLength, 2097152);
      assert.equal(simulation.positions.length, MAX_BOIDS * 3);
      assert.equal(simulation.neighborCounts.length, MAX_BOIDS);
      assert.equal(simulation.inspection.neighbors.length, MAX_BOIDS);
      assert.equal(simulation.count, MAX_BOIDS);
      simulation.step(FIXED_DT);
      const time = simulation.time;
      const inspection = simulation.inspect(MAX_BOIDS - 1);
      assert.equal(inspection.index, MAX_BOIDS - 1);
      for (const component of inspection.position) assert.ok(Number.isFinite(component));
      assert.equal(simulation.resizeWorld({ width: 500, height: 500, depth: 500 }), true);
      assert.equal(simulation.time, time);
      assert.equal(simulation.count, MAX_BOIDS);
      assert.equal(simulation.positions.buffer, memory);
      assert.deepEqual(simulation.bounds.halfSize, [250, 250, 250]);
      assert.equal(simulation.grid.cellSize, 25);
      assert.equal(simulation.grid.heads.length, 8000);
      simulation.step(FIXED_DT);
      for (const index of [0, 1, MAX_BOIDS - 1]) {
        for (let axis = 0; axis < 3; axis++)
          assert.ok(Number.isFinite(simulation.positions[index * 3 + axis]));
      }
      assert.throws(() => simulation.inspect(MAX_BOIDS), RangeError);
      assert.equal(simulation.resizeWorld({ width: 180, height: 160, depth: 140 }), true);
      assert.equal(simulation.count, MAX_BOIDS);
      assert.deepEqual(simulation.bounds.halfSize, [90, 80, 70]);
    } finally {
      simulation.dispose();
    }
  });

  test(`10,000 coincident boids keep every inspection index with ${searchType}`, () => {
    const simulation = new BoidSimulation({ count: MAX_BOIDS, searchType, obstacles: false });
    try {
      simulation.positions.fill(0);
      simulation.rebuildSearch();
      const inspection = simulation.inspect(MAX_BOIDS - 1);
      assert.equal(inspection.neighborCount, MAX_BOIDS - 1);
      const neighbors = [...inspection.neighbors.subarray(0, inspection.neighborCount)];
      assert.equal(new Set(neighbors).size, MAX_BOIDS - 1);
      assert.ok(neighbors.every((index) => index >= 0 && index < MAX_BOIDS - 1));
      simulation.updateSettings({ maxNeighbors: 32 });
      const limited = simulation.inspect(MAX_BOIDS - 1);
      assert.equal(limited.neighborCount, 32);
      assert.deepEqual(
        [...limited.neighbors.subarray(0, 32)],
        Array.from({ length: 32 }, (_, index) => index),
      );
    } finally {
      simulation.dispose();
    }
  });
}
