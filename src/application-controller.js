import { DEFAULTS, FIXED_DT } from './config.js';
import { BoidSimulation } from './simulation/boids.js';
import { SimulationClock } from './simulation/clock.js';
import { DEFAULT_MAP_SIZE } from './simulation/world-bounds.js';
import { BoidScene } from './rendering/scene.js';
import { ControlPanel } from './ui/controls.js';
import { publishDiagnostics } from './ui/diagnostics.js';

/** Owns application commands, fixed-step execution and resource lifetime.
 * Factories let tests inject construction failures without a second physics backend.
 */
export class ApplicationController {
  constructor(
    viewport,
    {
      createSimulation = () => new BoidSimulation(DEFAULTS),
      createScene = (container, settings) => new BoidScene(container, settings),
      createPanel = (settings, actions) => new ControlPanel(settings, actions),
      document: document_ = globalThis.document,
      window: window_ = globalThis.window,
      now = () => performance.now(),
      requestFrame = (callback) => requestAnimationFrame(callback),
      cancelFrame = (id) => cancelAnimationFrame(id),
      onError = (error) => console.error(error),
    } = {},
  ) {
    Object.assign(this, {
      viewport,
      document: document_,
      window: window_,
      now,
      requestFrame,
      cancelFrame,
      onError,
    });
    this.abort = new AbortController();
    this.clock = new SimulationClock();
    this.disposed = false;
    this.started = false;
    this.paused = window_.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.selectedIndex = 0;
    this.lastInspectionAt = -Infinity;
    this.fps = 0;
    this.stepMs = 0;
    this.frame = this.frame.bind(this);
    this.step = this.step.bind(this);
    this.resetFrameTiming();
    try {
      this.simulation = createSimulation();
      const positions = this.simulation.positions;
      this.positionBits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
      this.scene = createScene(viewport, this.simulation.settings);
      this.scene.resetTrails(this.simulation);
      this.scene.predatorPose.reset(this.simulation);
      this.panel = createPanel(this.simulation.settings, this.createActions());
      this.panel.setPaused(this.paused);
      this.bindEvents();
      this.scene.render(this.simulation, 1, 0);
    } catch (error) {
      throw this.disposeAfterFailure(error);
    }
  }

  start() {
    if (this.disposed) throw new Error('Application is disposed');
    if (this.started) return;
    this.started = true;
    try {
      this.frameId = this.requestFrame(this.frame);
    } catch (error) {
      throw this.disposeAfterFailure(error);
    }
  }

  createActions() {
    return {
      restart: (seed) => this.restart(seed),
      configure: (patch) => this.configure(patch),
      select: (index) => this.select(index),
      bounds: () => this.simulation.bounds,
      resizeWorld: (patch) => this.resizeWorld(patch),
      resetWorld: () => this.resetWorld(),
      obstacles: () => this.simulation.obstacles,
      selectObstacle: (id) => this.scene.selectObstacle(id),
      addObstacle: (type) => this.addObstacle(type),
      updateObstacle: (id, patch) => this.updateObstacle(id, patch),
      removeObstacle: (id) => this.removeObstacle(id),
      resetObstacles: () => this.resetObstacles(),
      selected: () => this.selectedIndex,
      seed: () => this.simulation.seed,
      singleStep: () => this.singleStep(),
      resetTrails: () => this.scene.resetTrails(this.simulation),
      resetCamera: () => this.resetCamera(),
      togglePause: () => this.togglePause(),
    };
  }

  refreshInspector() {
    if (!this.simulation.settings.inspect) return;
    this.simulation.inspect(this.selectedIndex);
    this.panel?.updateInspection(this.simulation);
    this.lastInspectionAt = this.now();
  }

  configure(patch) {
    const { simulation, scene } = this;
    const obstaclesWereEnabled = simulation.settings.obstacles;
    const boundaryMode = simulation.settings.boundaryMode;
    simulation.updateSettings(patch);
    if (!obstaclesWereEnabled && simulation.settings.obstacles) scene.resetTrails(simulation);
    if (boundaryMode !== simulation.settings.boundaryMode) {
      simulation.snapInterpolation();
      scene.predatorPose.snap();
      scene.resetTrails(simulation);
      simulation.refreshNeighborhoodCounts();
      this.panel?.updateMetrics(simulation, this.fps, this.stepMs);
    }
    if (
      simulation.settings.colorMode === 'density' &&
      ('colorMode' in patch || 'perception' in patch || 'fieldOfView' in patch)
    )
      simulation.refreshNeighborhoodCounts();
    scene.needsRender = true;
    scene.lastColorTime = -Infinity;
    this.refreshInspector();
  }

  restart(seed) {
    const { simulation, scene } = this;
    simulation.reset(seed);
    this.clock.reset();
    scene.resetTrails(simulation);
    scene.predatorPose.reset(simulation);
    this.selectedIndex = Math.min(this.selectedIndex, simulation.count - 1);
    if (simulation.settings.colorMode === 'density') simulation.refreshNeighborhoodCounts();
    this.refreshInspector();
    this.stepTotal = 0;
    this.stepCount = 0;
    this.stepMs = 0;
    this.panel?.updateMetrics(simulation, this.fps, this.stepMs);
    this.panel?.sync();
  }

  select(index) {
    this.selectedIndex = index;
    this.configure({ inspect: true });
    this.panel?.sync();
  }

  obstaclesChanged() {
    this.scene.resetTrails(this.simulation);
    if (this.simulation.settings.colorMode === 'density')
      this.simulation.refreshNeighborhoodCounts();
    this.refreshInspector();
    this.panel?.updateMetrics(this.simulation, this.fps, this.stepMs);
  }

  worldChanged() {
    this.scene.syncWorld(this.simulation);
    this.scene.predatorPose.snap();
    this.obstaclesChanged();
  }

  resizeWorld(patch) {
    if (this.simulation.resizeWorld(patch)) this.worldChanged();
  }

  resetWorld() {
    this.simulation.resizeWorld(DEFAULT_MAP_SIZE, { resetObstacles: true });
    this.worldChanged();
  }

  addObstacle(type) {
    const id = this.simulation.addObstacle(type);
    this.configure({ obstacles: true });
    this.obstaclesChanged();
    return id;
  }

  updateObstacle(id, patch) {
    this.simulation.updateObstacle(id, patch);
    this.obstaclesChanged();
  }
  removeObstacle(id) {
    this.simulation.removeObstacle(id);
    this.obstaclesChanged();
  }
  resetObstacles() {
    this.simulation.resetObstacles();
    this.obstaclesChanged();
  }

  singleStep() {
    if (!this.paused || this.disposed) return;
    this.step(FIXED_DT);
    this.clock.reset();
    this.refreshInspector();
    this.panel.updateMetrics(
      this.simulation,
      this.fps,
      this.stepTotal / Math.max(1, this.stepCount),
    );
  }

  resetCamera() {
    this.configure({ autoRotate: false });
    this.scene.resetCamera();
    this.panel?.sync();
  }

  togglePause() {
    this.paused = !this.paused;
    this.clock.reset();
    this.lastTime = this.now();
    this.simulation.snapInterpolation();
    this.scene.predatorPose.snap();
    this.refreshInspector();
    this.panel.setPaused(this.paused);
  }

  step(dt) {
    const started = this.now();
    this.simulation.step(dt);
    this.scene.predatorPose.advance(this.simulation, dt);
    this.stepTotal += this.now() - started;
    this.stepCount++;
    this.scene.sampleTrails(this.simulation);
  }

  resetFrameTiming() {
    this.lastTime = this.now();
    this.lastMetrics = this.lastTime;
    this.frameCount = 0;
    this.frameElapsed = 0;
    this.stepTotal = 0;
    this.stepCount = 0;
  }

  updateMetrics(now) {
    if (now - this.lastMetrics < 500) return;
    this.fps = this.frameCount / Math.max(this.frameElapsed, 0.001);
    this.stepMs = this.stepCount ? this.stepTotal / this.stepCount : 0;
    this.panel.updateMetrics(this.simulation, this.fps, this.stepMs);
    publishDiagnostics(this.viewport, this.simulation, this.scene, this.positionBits, {
      paused: this.paused,
      stepMs: this.stepMs,
      fps: this.fps,
      selectedIndex: this.selectedIndex,
      selectedObstacleId: this.panel.selectedObstacleId,
    });
    this.frameCount = 0;
    this.frameElapsed = 0;
    this.stepTotal = 0;
    this.stepCount = 0;
    this.lastMetrics = now;
  }

  frame(now) {
    if (this.disposed || this.document.hidden) return;
    try {
      const elapsed = Math.max(0, (now - this.lastTime) / 1000);
      this.lastTime = now;
      const alpha = this.paused
        ? 1
        : this.clock.advance(elapsed, this.simulation.settings.speed, this.step);
      if (!this.paused && this.simulation.settings.inspect && now - this.lastInspectionAt >= 100)
        this.refreshInspector();
      if (this.scene.render(this.simulation, alpha, elapsed)) this.frameCount++;
      this.frameElapsed += elapsed;
      this.updateMetrics(now);
      this.frameId = this.requestFrame(this.frame);
    } catch (error) {
      this.onError(this.disposeAfterFailure(error));
    }
  }

  resumeVisible() {
    this.cancelFrame(this.frameId);
    this.clock.reset();
    this.resetFrameTiming();
    this.simulation.snapInterpolation();
    this.scene.predatorPose.snap();
    if (!this.document.hidden && this.started && !this.disposed)
      this.frameId = this.requestFrame(this.frame);
  }

  bindEvents() {
    const on = (target, type, callback) =>
      target.addEventListener(type, callback, { signal: this.abort.signal });
    let pointerStart = null;
    on(this.scene.renderer.domElement, 'pointerdown', (event) => {
      if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY };
    });
    on(this.scene.renderer.domElement, 'pointerup', (event) => {
      if (
        pointerStart &&
        event.button === 0 &&
        Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 4
      ) {
        if (this.simulation.settings.inspect) {
          const index = this.scene.pickBoid(event.clientX, event.clientY);
          if (index !== null) this.select(index);
        } else {
          const id = this.scene.pickObstacle(event.clientX, event.clientY);
          if (id !== null) this.panel.selectObstacle(id);
        }
      }
      pointerStart = null;
    });
    on(this.scene.renderer.domElement, 'pointercancel', () => {
      pointerStart = null;
    });
    on(this.scene.renderer.domElement, 'webglcontextlost', (event) => {
      event.preventDefault();
      this.onError(this.disposeAfterFailure(new Error('WebGL context lost')));
    });
    on(this.document, 'visibilitychange', () => this.resumeVisible());
    on(this.window, 'pagehide', (event) => {
      if (!event.persisted) this.dispose();
    });
    on(this.window, 'pageshow', (event) => {
      if (event.persisted) this.resumeVisible();
    });
  }

  disposeAfterFailure(error) {
    try {
      this.dispose();
    } catch (cleanupError) {
      const message = error instanceof Error ? error.message : String(error);
      const cleanupErrors =
        cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
      return new AggregateError([error, ...cleanupErrors], message, { cause: error });
    }
    return error;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors = [];
    for (const release of [
      () => this.cancelFrame(this.frameId),
      () => this.abort.abort(),
      () => this.panel?.dispose(),
      () => this.scene?.dispose(),
      () => this.simulation?.dispose(),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    this.panel = null;
    this.scene = null;
    this.simulation = null;
    this.positionBits = null;
    if (errors.length) throw new AggregateError(errors, 'Application cleanup failed');
  }
}
