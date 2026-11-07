import test from 'node:test';
import assert from 'node:assert/strict';
import { BoidSimulation } from '../../src/simulation/boids.js';

test('Wasm reports actual zero workers before and after simulation updates', () => {
  const simulation = new BoidSimulation({ count: 32 });
  try {
    const assertNoWorkers = () => {
      assert.equal(simulation.core.boids_get_worker_thread_count(), 0);
      assert.equal(simulation.metrics.workerThreadCount, 0);
    };
    assertNoWorkers();
    simulation.step(1 / 60);
    assertNoWorkers();
    simulation.reconcileObstacles();
    assertNoWorkers();
    simulation.reconcileBounds();
    simulation.syncMetrics();
    assertNoWorkers();
    simulation.reset();
    assertNoWorkers();
  } finally {
    simulation.dispose();
  }
});
