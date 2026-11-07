import { MAX_BOIDS, MAX_NEIGHBORS, MAX_OBSTACLES, MAX_GRID_CELLS } from '../config.js';
import { createGridLayout } from './grid-layout.js';
import { CORE_BASE64, CORE_METADATA } from './generated/core-binary.js';

export { CORE_METADATA };

// ABI v1 layout: native/include/boids/boids.h. Numeric slots stay in this boundary.
const CONFIG = Object.freeze({
  count: 0,
  cohesion: 1,
  alignment: 2,
  separation: 3,
  perception: 4,
  fieldOfView: 5,
  goal: 6,
  goalSpeed: 7,
  goalStrength: 8,
  predator: 9,
  predatorSpeed: 10,
  predatorRadius: 11,
  predatorStrength: 12,
  obstacles: 13,
  boundaryMode: 14,
  boundaryMargin: 15,
  boundaryStrength: 16,
  searchType: 17,
  halfX: 18,
  halfY: 19,
  halfZ: 20,
  cellSize: 21,
  obstacleCount: 22,
});
const STATE = Object.freeze({
  count: 0,
  time: 1,
  goalTime: 2,
  previousGoalTime: 3,
  goalAdvance: 4,
  neighborChecks: 5,
  meanSpeed: 6,
  alignment: 7,
  outsideCount: 8,
  maxExcursion: 9,
});
const BUFFER = Object.freeze({
  config: 0,
  state: 1,
  positions: 2,
  previousPositions: 3,
  velocities: 4,
  nextVelocities: 5,
  neighborCounts: 6,
  goal: 7,
  predator: 8,
  previousPredator: 9,
  predatorVelocity: 10,
  obstacles: 11,
  inspection: 12,
  neighbors: 13,
});
const OBSTACLE = Object.freeze({
  type: 0,
  x: 1,
  y: 2,
  z: 3,
  radius: 4,
  width: 5,
  height: 6,
  depth: 7,
});
const BOUNDARY_MODES = Object.freeze(['hard', 'soft', 'hybrid']);
const AXIS_COUNT = 3;
const OBSTACLE_STRIDE = 8;
// ABI v1 lengths are element counts, independent of the active bird/obstacle counts.
const CONFIG_VALUE_COUNT = 23;
const STATE_VALUE_COUNT = 10;
const INSPECTION = Object.freeze({
  neighborCount: 0,
  closeCount: 1,
  cohesion: 2,
  alignment: 5,
  separation: 8,
  valueCount: 11,
});

// The native signature uses the same named slots and (element bytes, capacity)
// records. It detects a valid version with an incompatible layout before lending views.
const birdComponents = MAX_BOIDS * AXIS_COUNT;
const BUFFER_LAYOUT = [
  [8, CONFIG_VALUE_COUNT],
  [8, STATE_VALUE_COUNT],
  [4, birdComponents],
  [4, birdComponents],
  [4, birdComponents],
  [4, birdComponents],
  [2, MAX_BOIDS],
  [4, AXIS_COUNT],
  [4, AXIS_COUNT],
  [4, AXIS_COUNT],
  [4, AXIS_COUNT],
  [8, MAX_OBSTACLES * OBSTACLE_STRIDE],
  [8, INSPECTION.valueCount],
  [2, MAX_BOIDS],
];
const schemaWords = [
  1,
  MAX_BOIDS,
  MAX_OBSTACLES,
  CONFIG_VALUE_COUNT,
  STATE_VALUE_COUNT,
  OBSTACLE_STRIDE,
  INSPECTION.valueCount,
  ...Object.values(CONFIG),
  ...Object.values(STATE),
  ...Object.values(BUFFER),
  ...BUFFER_LAYOUT.flat(),
  ...Object.values(OBSTACLE),
  INSPECTION.neighborCount,
  INSPECTION.closeCount,
  INSPECTION.cohesion,
  INSPECTION.alignment,
  INSPECTION.separation,
];
export const ABI_SCHEMA_HASH = schemaWords.reduce(
  (hash, word) => Math.imul(hash ^ word, 16777619) >>> 0,
  2166136261,
);

export function assertCoreCompatibility(core) {
  if (core.boids_abi_version() !== 1) throw new Error('Unsupported C++ simulation ABI');
  if (
    typeof core.boids_abi_schema !== 'function' ||
    core.boids_abi_schema() >>> 0 !== ABI_SCHEMA_HASH
  ) {
    throw new Error('C++ simulation ABI layout does not match its JavaScript adapter');
  }
  if (typeof core.boids_set_max_neighbors !== 'function')
    throw new Error('C++ simulation core does not support the neighbor limit');
  if (typeof core.boids_get_worker_thread_count !== 'function')
    throw new Error('C++ simulation core does not report its worker thread count');
}
let compiledCore;

// Settings are validated by BoidSimulation. The bridge additionally owns the
// storage-layout preconditions that must hold before any ABI slot is written.
function validateConfigLayout(bounds, search, obstacleCount) {
  const cellSize = search.cellSize ?? createGridLayout(bounds.halfSize).cellSize;
  if (!Number.isFinite(cellSize) || cellSize <= 0)
    throw new RangeError('Search cell size must be finite and positive');
  let cells = 1;
  for (let axis = 0; axis < AXIS_COUNT; axis++) {
    const halfExtent = bounds.halfSize[axis];
    if (!Number.isFinite(halfExtent) || halfExtent <= 0)
      throw new RangeError('World half extents must be finite and positive');
    cells *= Math.ceil((halfExtent * 2) / cellSize);
  }
  if (cells > MAX_GRID_CELLS) throw new RangeError('Search grid exceeds its cell capacity');
  if (!Number.isInteger(obstacleCount) || obstacleCount < 0 || obstacleCount > MAX_OBSTACLES)
    throw new RangeError('Obstacle count exceeds its ABI capacity');
  return cellSize;
}

function validateObstacleRecords(obstacles) {
  if (!Array.isArray(obstacles) || obstacles.length > MAX_OBSTACLES)
    throw new RangeError('Obstacle records exceed their ABI capacity');
  for (const obstacle of obstacles) {
    if (!obstacle || (obstacle.type !== 'sphere' && obstacle.type !== 'box'))
      throw new RangeError('Unsupported obstacle shape');
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isFinite(obstacle[axis]))
        throw new RangeError('Obstacle coordinates must be finite');
    }
    const dimensions = obstacle.type === 'sphere' ? ['radius'] : ['width', 'height', 'depth'];
    for (const dimension of dimensions) {
      if (!Number.isFinite(obstacle[dimension]) || obstacle[dimension] <= 0)
        throw new RangeError('Obstacle dimensions must be finite and positive');
    }
  }
}

function createCore() {
  if (!compiledCore) {
    const bytes = Uint8Array.from(atob(CORE_BASE64), (character) => character.charCodeAt(0));
    compiledCore = new WebAssembly.Module(bytes);
  }
  const core = new WebAssembly.Instance(compiledCore).exports;
  core._initialize();
  assertCoreCompatibility(core);
  return core;
}

/** Owns one WASM instance and lends fixed views; C++ owns their numeric storage.
 * Unlike the PBD adapter, memory cannot grow here. Re-query only the velocity roles.
 */
export class BoidsCoreBridge {
  constructor() {
    this.disposed = false;
    this.core = createCore();
    const view = (Type, selector, length) =>
      new Type(this.core.memory.buffer, this.core.boids_buffer(selector), length);
    const birdComponents = MAX_BOIDS * AXIS_COUNT;
    this.buffers = {
      configBuffer: view(Float64Array, BUFFER.config, CONFIG_VALUE_COUNT),
      state: view(Float64Array, BUFFER.state, STATE_VALUE_COUNT),
      positions: view(Float32Array, BUFFER.positions, birdComponents),
      previousPositions: view(Float32Array, BUFFER.previousPositions, birdComponents),
      velocityBuffers: [
        view(Float32Array, BUFFER.velocities, birdComponents),
        view(Float32Array, BUFFER.nextVelocities, birdComponents),
      ],
      neighborCounts: view(Uint16Array, BUFFER.neighborCounts, MAX_BOIDS),
      goal: view(Float32Array, BUFFER.goal, AXIS_COUNT),
      predator: view(Float32Array, BUFFER.predator, AXIS_COUNT),
      previousPredator: view(Float32Array, BUFFER.previousPredator, AXIS_COUNT),
      predatorVelocity: view(Float32Array, BUFFER.predatorVelocity, AXIS_COUNT),
      obstacleBuffer: view(Float64Array, BUFFER.obstacles, MAX_OBSTACLES * OBSTACLE_STRIDE),
      inspectionBuffer: view(Float64Array, BUFFER.inspection, INSPECTION.valueCount),
    };
    const inspection = this.buffers.inspectionBuffer;
    this.inspection = {
      index: 0,
      version: 0,
      neighborCount: 0,
      closeCount: 0,
      neighbors: view(Uint16Array, BUFFER.neighbors, MAX_BOIDS),
      position: new Float32Array(AXIS_COUNT),
      velocity: new Float32Array(AXIS_COUNT),
      cohesion: inspection.subarray(INSPECTION.cohesion, INSPECTION.cohesion + AXIS_COUNT),
      alignment: inspection.subarray(INSPECTION.alignment, INSPECTION.alignment + AXIS_COUNT),
      separation: inspection.subarray(INSPECTION.separation, INSPECTION.separation + AXIS_COUNT),
    };
  }

  get count() {
    this.assertActive();
    return this.buffers.state[STATE.count];
  }
  get time() {
    this.assertActive();
    return this.buffers.state[STATE.time];
  }
  get goalTime() {
    this.assertActive();
    return this.buffers.state[STATE.goalTime];
  }
  set goalTime(value) {
    this.assertActive();
    this.buffers.state[STATE.goalTime] = value;
  }
  get previousGoalTime() {
    this.assertActive();
    return this.buffers.state[STATE.previousGoalTime];
  }
  get goalAdvance() {
    this.assertActive();
    return this.buffers.state[STATE.goalAdvance];
  }

  writeConfig(settings, bounds, search, kdTree, obstacleCount) {
    this.assertActive();
    const cellSize = validateConfigLayout(bounds, search, obstacleCount);
    if (
      !Number.isInteger(settings.maxNeighbors) ||
      settings.maxNeighbors < 0 ||
      settings.maxNeighbors > MAX_NEIGHBORS
    )
      throw new RangeError('Maximum neighbor count is outside its supported range');
    this.core.boids_set_max_neighbors(settings.maxNeighbors);
    const config = this.buffers.configBuffer;
    config[CONFIG.count] = settings.count;
    config[CONFIG.cohesion] = settings.cohesion;
    config[CONFIG.alignment] = settings.alignment;
    config[CONFIG.separation] = settings.separation;
    config[CONFIG.perception] = settings.perception;
    config[CONFIG.fieldOfView] = settings.fieldOfView;
    config[CONFIG.goal] = +settings.goal;
    config[CONFIG.goalSpeed] = settings.goalSpeed;
    config[CONFIG.goalStrength] = settings.goalStrength;
    config[CONFIG.predator] = +settings.predator;
    config[CONFIG.predatorSpeed] = settings.predatorSpeed;
    config[CONFIG.predatorRadius] = settings.predatorRadius;
    config[CONFIG.predatorStrength] = settings.predatorStrength;
    config[CONFIG.obstacles] = +settings.obstacles;
    config[CONFIG.boundaryMode] = BOUNDARY_MODES.indexOf(settings.boundaryMode);
    config[CONFIG.boundaryMargin] = settings.boundaryMargin;
    config[CONFIG.boundaryStrength] = settings.boundaryStrength;
    config[CONFIG.searchType] = search === kdTree ? 1 : Number.isFinite(search.cellSize) ? 0 : 2;
    config[CONFIG.halfX] = bounds.halfSize[0];
    config[CONFIG.halfY] = bounds.halfSize[1];
    config[CONFIG.halfZ] = bounds.halfSize[2];
    config[CONFIG.cellSize] = cellSize;
    config[CONFIG.obstacleCount] = obstacleCount;
  }

  writeObstacles(obstacles) {
    this.assertActive();
    // Check every record first: an invalid later obstacle cannot corrupt earlier slots.
    validateObstacleRecords(obstacles);
    const buffer = this.buffers.obstacleBuffer;
    for (let index = 0; index < obstacles.length; index++) {
      const obstacle = obstacles[index],
        offset = index * OBSTACLE_STRIDE;
      buffer[offset + OBSTACLE.type] = obstacle.type === 'sphere' ? 0 : 1;
      buffer[offset + OBSTACLE.x] = obstacle.x;
      buffer[offset + OBSTACLE.y] = obstacle.y;
      buffer[offset + OBSTACLE.z] = obstacle.z;
      buffer[offset + OBSTACLE.radius] = obstacle.radius ?? 0;
      buffer[offset + OBSTACLE.width] = obstacle.width ?? 0;
      buffer[offset + OBSTACLE.height] = obstacle.height ?? 0;
      buffer[offset + OBSTACLE.depth] = obstacle.depth ?? 0;
    }
  }

  getVelocityBufferIndex() {
    this.assertActive();
    return Number(
      this.core.boids_buffer(BUFFER.velocities) !== this.buffers.velocityBuffers[0].byteOffset,
    );
  }

  readMetricsInto(metrics) {
    this.assertActive();
    const state = this.buffers.state;
    metrics.neighborChecks = state[STATE.neighborChecks];
    metrics.meanSpeed = state[STATE.meanSpeed];
    metrics.alignment = state[STATE.alignment];
    metrics.outsideCount = state[STATE.outsideCount];
    metrics.maxExcursion = state[STATE.maxExcursion];
    metrics.workerThreadCount = this.core.boids_get_worker_thread_count();
  }

  readInspectionCounts() {
    this.assertActive();
    this.inspection.neighborCount = this.buffers.inspectionBuffer[INSPECTION.neighborCount];
    this.inspection.closeCount = this.buffers.inspectionBuffer[INSPECTION.closeCount];
  }

  assertActive() {
    if (this.disposed) throw new Error('BoidsCoreBridge is disposed');
  }

  // ABI v1 has no destroy export. Drop this owner's references; collection waits for
  // external borrowed views/exports to become unreachable. It does not detach memory.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.core = null;
    this.buffers = null;
    this.inspection = null;
  }
}
