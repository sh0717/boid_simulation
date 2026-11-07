import { DEFAULTS, DEFAULT_SEED, validateSettings } from '../config.js';
import { ObstacleLayout } from './obstacles.js';
import { createWorldBounds } from './world-bounds.js';
import { createGridLayout } from './grid-layout.js';
import { BoidsCoreBridge, CORE_METADATA } from './core-bridge.js';

export { CORE_METADATA };
// Visual decoration uses this PRNG too. Simulation initialization runs in C++.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Descriptors preserve the inspection API; actual searches run in C++.
function gridDescriptor(bounds) {
  const { cellSize, size, cellCount } = createGridLayout(bounds.halfSize);
  return {
    kind: 'grid',
    cellSize,
    size,
    heads: { length: cellCount },
  };
}

/** JS input adapter. C++ owns numeric state; Three.js reads fixed WASM memory views. */
export class BoidSimulation {
  constructor(settings = {}, mapSize = {}) {
    this.disposed = false;
    this.settings = { ...DEFAULTS, ...validateSettings(settings) };
    this.bounds = createWorldBounds(mapSize);
    this.boundsRevision = 0;
    this.obstacleLayout = new ObstacleLayout(this.bounds);
    this.bridge = new BoidsCoreBridge();
    this.core = this.bridge.core;
    this.backend = 'cpp17-wasm';
    Object.assign(this, this.bridge.buffers);
    this.inspection = this.bridge.inspection;
    this.syncVelocities();
    this.grid = gridDescriptor(this.bounds);
    this.kdTree = { kind: 'kd-tree' };
    this.search = this.settings.searchType === 'kd-tree' ? this.kdTree : this.grid;
    this.metrics = {
      neighborChecks: 0,
      meanSpeed: 0,
      alignment: 0,
      outsideCount: 0,
      maxExcursion: 0,
      workerThreadCount: 0,
    };
    this.reset();
  }

  get count() {
    this.assertActive();
    return this.bridge.count;
  }
  get time() {
    this.assertActive();
    return this.bridge.time;
  }
  get goalTime() {
    this.assertActive();
    return this.bridge.goalTime;
  }
  set goalTime(value) {
    this.assertActive();
    if (!Number.isFinite(value)) throw new RangeError('Goal time must be finite');
    this.bridge.goalTime = value;
  }
  get previousGoalTime() {
    this.assertActive();
    return this.bridge.previousGoalTime;
  }
  get goalAdvance() {
    this.assertActive();
    return this.bridge.goalAdvance;
  }
  get obstacles() {
    this.assertActive();
    return this.obstacleLayout.items;
  }
  get obstacleRevision() {
    this.assertActive();
    return this.obstacleLayout.revision;
  }

  syncConfig(settings = this.settings, search = this.search) {
    this.assertActive();
    this.bridge.writeConfig(settings, this.bounds, search, this.kdTree, this.obstacles.length);
    if (this.lastObstacleRevision !== this.obstacleRevision) {
      this.bridge.writeObstacles(this.obstacles);
      this.lastObstacleRevision = this.obstacleRevision;
    }
  }

  syncVelocities() {
    this.assertActive();
    const currentIndex = this.bridge.getVelocityBufferIndex();
    this.velocities = this.velocityBuffers[currentIndex];
    this.nextVelocities = this.velocityBuffers[1 - currentIndex];
  }

  syncMetrics() {
    this.assertActive();
    this.bridge.readMetricsInto(this.metrics);
  }

  updateSettings(patch) {
    this.assertActive();
    const nextSettings = { ...this.settings, ...validateSettings(patch) };
    const nextSearch = nextSettings.searchType === 'kd-tree' ? this.kdTree : this.grid;
    const obstaclesWereEnabled = this.settings.obstacles,
      boundaryMode = this.settings.boundaryMode;
    // ABI layout checks can reject a custom search descriptor. Commit only after
    // they succeed, keeping the settings object borrowed by the UI stable.
    this.syncConfig(nextSettings, nextSearch);
    Object.assign(this.settings, nextSettings);
    this.search = nextSearch;
    if (!obstaclesWereEnabled && this.settings.obstacles) this.reconcileObstacles();
    if (boundaryMode === 'soft' && this.settings.boundaryMode !== 'soft') {
      this.reconcileBounds();
      this.snapInterpolation();
      this.measure();
    }
  }

  resizeWorld(patch, { resetObstacles = false } = {}) {
    this.assertActive();
    const bounds = createWorldBounds(patch, this.bounds);
    if (
      !resetObstacles &&
      ['width', 'height', 'depth'].every((key) => bounds[key] === this.bounds[key])
    )
      return false;
    const layout = resetObstacles ? new ObstacleLayout(bounds) : this.obstacleLayout;
    layout.validateBounds(bounds);
    const grid = gridDescriptor(bounds);
    this.bounds = bounds;
    if (resetObstacles) {
      layout.revision = this.obstacleRevision + 1;
      this.obstacleLayout = layout;
    }
    this.obstacleLayout.bounds = bounds;
    this.grid = grid;
    this.search = this.settings.searchType === 'kd-tree' ? this.kdTree : grid;
    this.syncConfig();
    this.reconcileBounds();
    this.updateGoal();
    this.snapInterpolation();
    this.measure();
    this.boundsRevision++;
    return true;
  }

  addObstacle(type = 'sphere') {
    this.assertActive();
    const id = this.obstacleLayout.add(type);
    this.reconcileObstacles();
    return id;
  }
  moveObstacle(id, patch) {
    this.assertActive();
    this.obstacleLayout.move(id, patch);
    this.reconcileObstacles();
  }
  updateObstacle(id, patch) {
    this.assertActive();
    this.obstacleLayout.update(id, patch);
    this.reconcileObstacles();
  }
  removeObstacle(id) {
    this.assertActive();
    this.obstacleLayout.remove(id);
    this.syncConfig();
  }
  resetObstacles() {
    this.assertActive();
    this.obstacleLayout.reset();
    this.reconcileObstacles();
  }
  reconcileObstacles() {
    this.assertActive();
    this.syncConfig();
    this.core.boids_reconcile_obstacles();
    this.syncMetrics();
  }
  reconcileBounds() {
    this.assertActive();
    this.syncConfig();
    this.core.boids_reconcile_bounds();
  }

  reset(seed = this.seed ?? DEFAULT_SEED) {
    this.assertActive();
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new RangeError('Seed must be a uint32 integer');
    this.updateSettings(this.settings);
    this.seed = seed >>> 0;
    this.core.boids_reset(this.seed);
    this.syncVelocities();
    this.syncMetrics();
  }

  inspect(index) {
    this.assertActive();
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new RangeError('Invalid boid index');
    this.syncConfig();
    this.core.boids_inspect(index);
    const detail = this.inspection;
    detail.index = index;
    detail.time = this.time;
    detail.version++;
    this.bridge.readInspectionCounts();
    for (let axis = 0; axis < 3; axis++) {
      detail.position[axis] = this.positions[index * 3 + axis];
      detail.velocity[axis] = this.velocities[index * 3 + axis];
    }
    return detail;
  }

  refreshNeighborhoodCounts() {
    this.assertActive();
    this.syncConfig();
    this.core.boids_refresh_neighbors();
  }
  rebuildSearch() {
    this.assertActive();
    this.syncConfig();
    this.core.boids_rebuild();
  }
  updateGoal() {
    this.assertActive();
    this.syncConfig();
    this.core.boids_goal();
  }
  snapInterpolation() {
    this.assertActive();
    this.core.boids_snap();
  }
  measure() {
    this.assertActive();
    this.core.boids_measure();
    this.syncMetrics();
  }
  updatePredator(dt) {
    this.assertActive();
    this.validateStep(dt);
    this.syncConfig();
    this.core.boids_predator(dt);
  }
  validateStep(dt) {
    this.assertActive();
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.05)
      throw new RangeError('dt must be in (0, 0.05] seconds');
  }
  step(dt) {
    this.assertActive();
    this.validateStep(dt);
    this.syncConfig();
    this.core.boids_step(dt);
    this.syncVelocities();
    this.syncMetrics();
  }

  assertActive() {
    if (this.disposed) throw new Error('BoidSimulation is disposed');
  }

  // Data properties become invalid (null). Previously borrowed views cannot be
  // revoked by JavaScript and must no longer be used after their owner is disposed.
  dispose() {
    if (this.disposed) return;
    this.bridge.dispose();
    for (const key of Object.keys(this)) this[key] = null;
    this.disposed = true;
  }
}
