import assert from 'node:assert/strict';
import test from 'node:test';
import { BoidScene } from '../../src/rendering/scene.js';

test('scene cleanup attempts all releases after an observer or resource failure', () => {
  const calls = [];
  const firstError = new Error('observer failed');
  const resource = (name, error) => ({
    dispose() {
      calls.push(name);
      if (error) throw error;
    },
  });
  const geometry = resource('geometry', new Error('geometry failed'));
  const texture = { ...resource('texture'), isTexture: true };
  const material = { ...resource('material'), map: texture };
  const scene = Object.create(BoidScene.prototype);
  scene.resizeObserver = {
    disconnect: () => {
      calls.push('observer');
      throw firstError;
    },
  };
  scene.controls = { removeEventListener: () => calls.push('listener'), ...resource('controls') };
  scene.scene = {
    traverse(visit) {
      visit({ geometry, material });
      visit({ geometry, material });
    },
  };
  scene.renderer = { ...resource('renderer'), domElement: { remove: () => calls.push('canvas') } };
  assert.throws(
    () => scene.dispose(),
    (error) => error === firstError,
  );
  assert.deepEqual(calls, [
    'observer',
    'listener',
    'controls',
    'geometry',
    'material',
    'texture',
    'renderer',
    'canvas',
  ]);
  scene.dispose();
  assert.equal(calls.length, 8);
});

test('scene construction retains its failure when renderer cleanup also fails', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  const failure = new Error('controls failed');
  const calls = [];
  const canvas = {
    setAttribute() {},
    remove() {
      calls.push('canvas');
    },
  };
  try {
    assert.throws(
      () =>
        new BoidScene(
          {
            prepend() {
              calls.push('append');
            },
          },
          {},
          {
            createRenderer: () => ({
              domElement: canvas,
              setPixelRatio() {},
              dispose() {
                calls.push('renderer');
                throw new Error('cleanup failed');
              },
            }),
            createControls() {
              throw failure;
            },
          },
        ),
      (error) => error === failure,
    );
    assert.deepEqual(calls, ['append', 'renderer', 'canvas']);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
