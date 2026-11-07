import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BoidScene } from '../../src/rendering/scene.js';
import { ControlPanel } from '../../src/ui/controls.js';
import { DEFAULTS } from '../../src/config.js';
import { DEFAULT_WORLD_BOUNDS } from '../../src/simulation/world-bounds.js';

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function expectFailure(operation, message) {
  let caught;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  require(caught?.message === message, `expected failure: ${message}, received ${caught?.message}`);
}

function sceneConstructionFailure(late) {
  const viewport = document.getElementById('viewport');
  const counts = { renderer: 0, controls: 0, observer: 0, resources: 0 };
  const observed = new Set();
  let expected = 0;
  let sceneRoot;
  const originalAdd = THREE.Scene.prototype.add;
  THREE.Scene.prototype.add = function (...objects) {
    sceneRoot = this;
    return originalAdd.apply(this, objects);
  };
  const options = {
    createRenderer: (settings) => {
      const renderer = new THREE.WebGLRenderer(settings);
      const dispose = renderer.dispose.bind(renderer);
      renderer.dispose = () => {
        counts.renderer++;
        dispose();
      };
      return renderer;
    },
    createControls: (camera, element) => {
      if (!late) throw new Error('controls construction');
      const controls = new OrbitControls(camera, element);
      const dispose = controls.dispose.bind(controls);
      controls.dispose = () => {
        counts.controls++;
        dispose();
      };
      return controls;
    },
    createResizeObserver: (callback) => {
      // Observe actual attached resources before the deliberately failing final stage.
      sceneRoot.traverse((object) => {
        if (object.geometry) observed.add(object.geometry);
        for (const material of object.material
          ? Array.isArray(object.material)
            ? object.material
            : [object.material]
          : []) {
          observed.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) observed.add(value);
        }
      });
      expected = observed.size;
      for (const resource of observed)
        resource.addEventListener('dispose', () => {
          counts.resources++;
        });
      const observer = new ResizeObserver(callback);
      return {
        observe: (target) => {
          observer.observe(target);
          throw new Error('observer attachment');
        },
        disconnect: () => {
          counts.observer++;
          observer.disconnect();
        },
      };
    },
  };
  try {
    expectFailure(
      () => new BoidScene(viewport, { ...DEFAULTS }, options),
      late ? 'observer attachment' : 'controls construction',
    );
    require(viewport.querySelectorAll('canvas').length === 0, 'failed scene retained its canvas');
    require(counts.renderer === 1, 'failed scene did not dispose the renderer once');
    if (late) {
      require(counts.controls === 1 && counts.observer === 1, 'controls/observer rollback failed');
      require(expected > 20 &&
        counts.resources === expected, 'GPU resources were leaked or disposed twice');
    }
    return {
      stage: late ? 'observer attachment' : 'controls construction',
      ...counts,
      expectedResources: expected,
    };
  } finally {
    THREE.Scene.prototype.add = originalAdd;
  }
}

function controlConstructionFailure(late) {
  let commands = 0;
  const actions = {
    obstacles: () => [],
    bounds: () => DEFAULT_WORLD_BOUNDS,
    selected: () => 0,
    seed: () => 7,
    selectObstacle() {},
    configure: () => {
      commands++;
    },
  };
  const alignment = document.getElementById('alignment');
  const originalListen = alignment.addEventListener;
  const originalSync = ControlPanel.prototype.sync;
  if (late)
    ControlPanel.prototype.sync = () => {
      throw new Error('panel initial sync');
    };
  else
    alignment.addEventListener = () => {
      throw new Error('panel event binding');
    };
  try {
    expectFailure(
      () => new ControlPanel({ ...DEFAULTS }, actions),
      late ? 'panel initial sync' : 'panel event binding',
    );
    document.getElementById('cohesion').dispatchEvent(new Event('input'));
    document.getElementById('predator').dispatchEvent(new Event('change'));
    require(commands === 0, 'failed panel retained an input listener');
  } finally {
    alignment.addEventListener = originalListen;
    ControlPanel.prototype.sync = originalSync;
  }
  const panel = new ControlPanel({ ...DEFAULTS }, actions);
  panel.dispose();
  panel.dispose();
  document.getElementById('cohesion').dispatchEvent(new Event('input'));
  require(commands === 0, 'disposed panel retained an input listener');
  return { stage: late ? 'panel initial sync' : 'panel event binding', retainedCommands: commands };
}

window.runConstructionProbe = () => [
  sceneConstructionFailure(false),
  sceneConstructionFailure(true),
  controlConstructionFailure(false),
  controlConstructionFailure(true),
];
