import test from 'node:test';
import assert from 'node:assert/strict';
import { BoidSimulation } from '../../src/simulation/boids.js';
import { BoidsCoreBridge } from '../../src/simulation/core-bridge.js';

test('simulation disposal is repeatable and rejects later commands and state queries', () => {
  const simulation = new BoidSimulation({ count: 16 });
  simulation.step(1 / 60);
  simulation.dispose();
  assert.doesNotThrow(() => simulation.dispose());

  for (const operation of [
    () => simulation.step(1 / 60),
    () => simulation.reset(),
    () => simulation.updateSettings({ cohesion: 1 }),
    () => simulation.resizeWorld({ width: 60 }),
    () => simulation.addObstacle('sphere'),
    () => simulation.inspect(0),
    () => simulation.refreshNeighborhoodCounts(),
    () => simulation.count,
    () => simulation.time,
    () => simulation.obstacles,
  ]) {
    assert.throws(operation, /disposed/i);
  }
});

test('disposing one simulation preserves existing and newly created independent instances', () => {
  const first = new BoidSimulation({ count: 16 });
  const second = new BoidSimulation({ count: 16 });
  first.step(1 / 60);
  first.dispose();
  const third = new BoidSimulation({ count: 16 });
  try {
    second.step(1 / 60);
    third.step(1 / 60);
    assert.equal(second.time, 1 / 60);
    assert.deepEqual(second.positions, third.positions);
    assert.ok(second.positions.every(Number.isFinite));
  } finally {
    second.dispose();
    third.dispose();
  }
});

test('a disposed core bridge rejects all later ABI reads and writes', () => {
  const bridge = new BoidsCoreBridge();
  bridge.dispose();
  assert.doesNotThrow(() => bridge.dispose());
  for (const operation of [
    () => bridge.count,
    () => bridge.time,
    () => bridge.goalTime,
    () => {
      bridge.goalTime = 1;
    },
    () => bridge.previousGoalTime,
    () => bridge.goalAdvance,
    () => bridge.writeConfig({}, {}, {}, {}, 0),
    () => bridge.writeObstacles([]),
    () => bridge.getVelocityBufferIndex(),
    () => bridge.readMetricsInto({}),
    () => bridge.readInspectionCounts(),
  ]) {
    assert.throws(operation, /disposed/i);
  }
});
