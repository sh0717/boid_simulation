import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_GRID_CELLS } from '../../src/config.js';
import { createGridLayout } from '../../src/simulation/grid-layout.js';
import { BoidSimulation } from '../../src/simulation/boids.js';

test('grid width fits capacity and keeps the smallest integer width for asymmetric worlds', () => {
  for (const width of [20, 199, 200, 201, 350, 500])
    for (const height of [20, 200, 500])
      for (const depth of [20, 200, 500]) {
        const dimensions = [width, height, depth];
        const layout = createGridLayout(dimensions.map((value) => value / 2));
        assert.ok(layout.cellCount <= MAX_GRID_CELLS);
        assert.deepEqual(
          layout.size,
          dimensions.map((value) => Math.ceil(value / layout.cellSize)),
        );
        if (dimensions.every((value) => value <= 200)) assert.equal(layout.cellSize, 10);
        for (let candidate = 10; candidate < layout.cellSize; candidate++) {
          const size = dimensions.map((value) => Math.ceil(value / candidate));
          assert.ok(size[0] * size[1] * size[2] > MAX_GRID_CELLS);
        }
      }
  assert.deepEqual(createGridLayout([250, 250, 250]), {
    cellSize: 25,
    size: [20, 20, 20],
    cellCount: 8000,
  });
  assert.equal(createGridLayout([250, 10, 10]).cellSize, 10);
});

for (const searchType of ['grid', 'kd-tree']) {
  test(`large asymmetric world finds exact neighbors with ${searchType}`, () => {
    const simulation = new BoidSimulation(
      { count: 128, searchType, obstacles: false, fieldOfView: 360 },
      { width: 500, height: 300, depth: 400 },
    );
    try {
      for (let index = 0; index < simulation.count; index++) {
        simulation.positions.set(
          [((index * 37) % 100) - 50, ((index * 23) % 80) - 40, ((index * 17) % 60) - 30],
          index * 3,
        );
      }
      simulation.positions.set([249, 0, 0, 248, 0, 0, -249, 0, 0, -248, 0, 0]);
      simulation.rebuildSearch();
      for (const index of [0, 1, 2, 3, 64, 127]) {
        const inspection = simulation.inspect(index);
        const actual = [...inspection.neighbors.subarray(0, inspection.neighborCount)].sort(
          (a, b) => a - b,
        );
        const offset = index * 3;
        const expected = Array.from({ length: simulation.count }, (_, other) => other).filter(
          (other) => {
            if (other === index) return false;
            const otherOffset = other * 3;
            return (
              Math.hypot(
                simulation.positions[offset] - simulation.positions[otherOffset],
                simulation.positions[offset + 1] - simulation.positions[otherOffset + 1],
                simulation.positions[offset + 2] - simulation.positions[otherOffset + 2],
              ) < simulation.settings.perception
            );
          },
        );
        assert.deepEqual(actual, expected);
      }
    } finally {
      simulation.dispose();
    }
  });
}
