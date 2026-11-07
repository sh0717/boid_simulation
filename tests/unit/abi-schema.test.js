import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABI_SCHEMA_HASH,
  assertCoreCompatibility,
  BoidsCoreBridge,
} from '../../src/simulation/core-bridge.js';

test('the rebuilt native ABI matches every host slot, selector, element size and capacity', () => {
  const bridge = new BoidsCoreBridge();
  try {
    assert.equal(bridge.core.boids_abi_schema() >>> 0, ABI_SCHEMA_HASH);
    assertCoreCompatibility(bridge.core);
    assert.equal(bridge.buffers.positions.length, 10000 * 3);
    assert.equal(bridge.buffers.obstacleBuffer.length, 16 * 8);
  } finally {
    bridge.dispose();
  }
});

test('a matching version with missing or changed layout metadata is rejected', () => {
  assert.throws(() => assertCoreCompatibility({ boids_abi_version: () => 2 }), /Unsupported/);
  for (const signature of [undefined, () => ABI_SCHEMA_HASH ^ 1, () => 0]) {
    assert.throws(
      () =>
        assertCoreCompatibility({
          boids_abi_version: () => 1,
          boids_abi_schema: signature,
        }),
      /layout/,
    );
  }
  assert.throws(
    () =>
      assertCoreCompatibility({
        boids_abi_version: () => 1,
        boids_abi_schema: () => ABI_SCHEMA_HASH,
      }),
    /neighbor limit/,
  );
  assert.throws(
    () =>
      assertCoreCompatibility({
        boids_abi_version: () => 1,
        boids_abi_schema: () => ABI_SCHEMA_HASH,
        boids_set_max_neighbors() {},
      }),
    /worker thread count/,
  );
});
