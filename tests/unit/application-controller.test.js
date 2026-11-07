import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationController } from '../../src/application-controller.js';
import { BoidSimulation } from '../../src/simulation/boids.js';
import { FIXED_DT } from '../../src/config.js';

function fixture(overrides = {}) {
  const document = new EventTarget();
  document.hidden = false;
  const window = new EventTarget();
  window.matchMedia = () => ({ matches: true });
  const calls = [];
  const queued = new Map();
  let nextFrame = 1;
  let now = 0;
  const simulation = new BoidSimulation({ count: 8 });
  const originalDispose = simulation.dispose.bind(simulation);
  simulation.dispose = () => {
    calls.push('simulation');
    originalDispose();
  };
  const scene = {
    renderer: { domElement: new EventTarget() },
    predatorPose: { reset() {}, snap() {}, advance() {} },
    resetTrails() {},
    sampleTrails() {},
    syncWorld() {},
    resetCamera() {},
    selectObstacle() {},
    render() {
      return true;
    },
    dispose() {
      calls.push('scene');
    },
  };
  const panel = {
    setPaused() {},
    sync() {},
    updateMetrics() {},
    updateInspection() {},
    dispose() {
      calls.push('panel');
    },
  };
  const options = {
    document,
    window,
    now: () => now,
    createSimulation: () => simulation,
    createScene: () => scene,
    createPanel: () => panel,
    requestFrame: (callback) => {
      const id = nextFrame++;
      queued.set(id, callback);
      return id;
    },
    cancelFrame: (id) => queued.delete(id),
    onError: (error) => calls.push(error.message),
    ...overrides,
  };
  return {
    simulation,
    scene,
    panel,
    document,
    window,
    calls,
    queued,
    options,
    create: () => new ApplicationController({ dataset: {} }, options),
    advanceTime: (milliseconds) => {
      now += milliseconds;
    },
  };
}

test('named application commands own pause, single step and seeded restart', () => {
  const f = fixture();
  const application = f.create();
  try {
    application.singleStep();
    assert.equal(f.simulation.time, FIXED_DT);
    application.restart(7);
    const initial = f.simulation.positions.slice();
    application.singleStep();
    application.restart(7);
    assert.deepEqual(f.simulation.positions, initial);
    application.togglePause();
    application.singleStep();
    assert.equal(f.simulation.time, 0, 'single step is accepted only while paused');
    application.start();
    application.start();
    assert.equal(f.queued.size, 1, 'start owns one RAF chain');
    f.advanceTime(1000 / 60);
    application.frame(1000 / 60);
    assert.equal(f.simulation.time, FIXED_DT);
  } finally {
    application.dispose();
  }
});

test('partial application initialization rolls back completed resources in reverse order', () => {
  for (const stage of ['scene', 'panel', 'event binding']) {
    const f = fixture();
    if (stage === 'scene')
      f.options.createScene = () => {
        throw new Error(stage);
      };
    if (stage === 'panel')
      f.options.createPanel = () => {
        throw new Error(stage);
      };
    if (stage === 'event binding')
      f.document.addEventListener = () => {
        throw new Error(stage);
      };
    assert.throws(f.create, new RegExp(stage));
    assert.deepEqual(
      f.calls,
      stage === 'scene'
        ? ['simulation']
        : stage === 'panel'
          ? ['scene', 'simulation']
          : ['panel', 'scene', 'simulation'],
    );
    assert.equal(f.simulation.disposed, true);
    assert.equal(f.queued.size, 0);
  }
});

test('visibility and repeated disposal stop the frame chain and remove document listeners', () => {
  const f = fixture();
  const application = f.create();
  application.start();
  const oldFrame = f.queued.values().next().value;
  f.document.hidden = true;
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.queued.size, 0);
  f.document.hidden = false;
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.queued.size, 1);
  application.dispose();
  application.dispose();
  assert.deepEqual(f.calls, ['panel', 'scene', 'simulation']);
  assert.equal(f.queued.size, 0);
  f.document.dispatchEvent(new Event('visibilitychange'));
  f.window.dispatchEvent(new Event('pageshow'));
  oldFrame(100);
  assert.equal(f.queued.size, 0, 'a retained callback cannot resurrect a disposed application');
  assert.throws(() => application.start(), /disposed/);
});

test('a frame failure disposes ownership before reporting the error', () => {
  const f = fixture();
  const application = f.create();
  application.start();
  f.scene.render = () => {
    throw new Error('render failure');
  };
  application.frame(16);
  assert.deepEqual(f.calls, ['panel', 'scene', 'simulation', 'render failure']);
  assert.equal(f.queued.size, 0);
});

test('failure to schedule the initial frame releases the completed application', () => {
  const f = fixture({
    requestFrame: () => {
      throw new Error('RAF unavailable');
    },
  });
  const application = f.create();
  assert.throws(() => application.start(), /RAF unavailable/);
  assert.deepEqual(f.calls, ['panel', 'scene', 'simulation']);
  assert.equal(application.positionBits, null);
});

test('cleanup failures do not skip later owners or hide the triggering frame failure', () => {
  const f = fixture();
  const application = f.create();
  application.start();
  f.panel.dispose = () => {
    f.calls.push('panel');
    throw new Error('panel cleanup failed');
  };
  f.scene.render = () => {
    throw new Error('render failure');
  };
  let reported;
  application.onError = (error) => {
    reported = error;
  };
  application.frame(16);
  assert.deepEqual(f.calls, ['panel', 'scene', 'simulation']);
  assert.equal(f.simulation.disposed, true);
  assert.equal(f.queued.size, 0);
  assert.equal(reported.cause.message, 'render failure');
  assert.match(String(reported.errors[1]), /panel cleanup failed/);
  assert.equal(application.positionBits, null);
  application.dispose();
});

test('initialization failure remains available when rollback also fails', () => {
  const f = fixture();
  f.scene.dispose = () => {
    f.calls.push('scene');
    throw new Error('scene cleanup failed');
  };
  f.options.createPanel = () => {
    throw new Error('panel construction failed');
  };
  assert.throws(f.create, (error) => {
    assert.equal(error.cause.message, 'panel construction failed');
    assert.match(String(error.errors[1]), /scene cleanup failed/);
    return true;
  });
  assert.deepEqual(f.calls, ['scene', 'simulation']);
  assert.equal(f.simulation.disposed, true);
});

test('explicit disposal reports all release failures after trying every owner', () => {
  const f = fixture();
  const application = f.create();
  f.panel.dispose = () => {
    f.calls.push('panel');
    throw new Error('panel cleanup failed');
  };
  f.scene.dispose = () => {
    f.calls.push('scene');
    throw new Error('scene cleanup failed');
  };
  assert.throws(
    () => application.dispose(),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(
        error.errors.map((failure) => failure.message),
        ['panel cleanup failed', 'scene cleanup failed'],
      );
      return true;
    },
  );
  assert.deepEqual(f.calls, ['panel', 'scene', 'simulation']);
  assert.equal(f.simulation.disposed, true);
  assert.equal(application.positionBits, null);
  application.dispose();
});
