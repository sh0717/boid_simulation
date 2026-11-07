// Frozen pre-migration numerical reference. Test-only: never imported by the app.
import { DEFAULTS, DEFAULT_SEED, MAX_BOIDS, OBSTACLE_CLEARANCE, WORLD, validateSettings } from '../../src/config.js';
import { ObstacleLayout, obstacleSurface } from '../../src/simulation/obstacles.js';
import { SpatialGrid } from './spatial-grid.js';
import { KdTree } from './kd-tree.js';
import { evaluateFlocking } from './flocking.js';
import { sampleGoalPath, wrapGoalTime } from '../../src/simulation/goal-path.js';
import { createWorldBounds } from '../../src/simulation/world-bounds.js';
import { boundarySteering } from './boundary.js';

const EPSILON = 1e-8;
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure simulation: world units / seconds, no DOM or renderer ownership. */
export class BoidSimulation {
  constructor(settings = {}, mapSize = {}) {
    this.settings = { ...DEFAULTS, ...validateSettings(settings) };
    this.bounds = createWorldBounds(mapSize);
    this.boundsRevision = 0;
    this.obstacleLayout = new ObstacleLayout(this.bounds);
    this.obstacleNormal = new Float64Array(3);
    this.viewCosine = Math.cos(this.settings.fieldOfView * Math.PI / 360);
    this.positions = new Float32Array(MAX_BOIDS * 3);
    this.previousPositions = new Float32Array(MAX_BOIDS * 3);
    this.velocities = new Float32Array(MAX_BOIDS * 3);
    this.nextVelocities = new Float32Array(MAX_BOIDS * 3);
    this.neighborCounts = new Uint16Array(MAX_BOIDS);
    this.flockingForce = new Float64Array(5);
    this.boundaryForce = new Float64Array(4);
    this.inspectionForce = new Float64Array(5);
    this.inspection = { index: 0, version: 0, neighborCount: 0, closeCount: 0, neighbors: new Uint16Array(MAX_BOIDS), position: new Float32Array(3), velocity: new Float32Array(3), cohesion: new Float64Array(3), alignment: new Float64Array(3), separation: new Float64Array(3) };
    this.goal = new Float32Array(3);
    this.predator = new Float32Array(3);
    this.previousPredator = new Float32Array(3);
    this.predatorVelocity = new Float32Array(3);
    this.grid = new SpatialGrid(this.bounds.halfSize, WORLD.perception, MAX_BOIDS);
    this.kdTree = new KdTree(MAX_BOIDS);
    this.search = this.grid;
    this.candidates = new Int32Array(MAX_BOIDS);
    this.metrics = { neighborChecks: 0, meanSpeed: 0, alignment: 0, outsideCount: 0, maxExcursion: 0 };
    this.reset();
  }

  updateSettings(patch) {
    const obstaclesWereEnabled = this.settings.obstacles;
    const boundaryMode = this.settings.boundaryMode;
    Object.assign(this.settings, validateSettings(patch));
    this.search = this.settings.searchType === 'kd-tree' ? this.kdTree : this.grid;
    this.viewCosine = Math.cos(this.settings.fieldOfView * Math.PI / 360);
    if (!obstaclesWereEnabled && this.settings.obstacles) this.reconcileObstacles();
    if (boundaryMode === 'soft' && this.settings.boundaryMode !== 'soft') {
      this.reconcileBounds();
      this.snapInterpolation();
      this.measure();
    }
  }

  get obstacles() { return this.obstacleLayout.items; }
  get obstacleRevision() { return this.obstacleLayout.revision; }

  resizeWorld(patch, { resetObstacles = false } = {}) {
    const bounds = createWorldBounds(patch, this.bounds);
    if (!resetObstacles && ['width', 'height', 'depth'].every(key => bounds[key] === this.bounds[key])) return false;
    // Hidden obstacles still belong to the layout and must fit when re-enabled.
    const layout = resetObstacles ? new ObstacleLayout(bounds) : this.obstacleLayout;
    layout.validateBounds(bounds);
    const grid = new SpatialGrid(bounds.halfSize, WORLD.perception, MAX_BOIDS);
    this.bounds = bounds;
    if (resetObstacles) { layout.revision = this.obstacleRevision + 1; this.obstacleLayout = layout; }
    this.obstacleLayout.bounds = bounds;
    this.grid = grid;
    this.search = this.settings.searchType === 'kd-tree' ? this.kdTree : grid;
    this.reconcileBounds();
    this.updateGoal();
    this.snapInterpolation();
    this.search.rebuild(this.positions, this.count);
    this.measure();
    this.boundsRevision++;
    return true;
  }

  reconcileBounds() {
    if (this.settings.boundaryMode === 'soft') return;
    for (let p = 0; p < this.count * 3; p += 3) {
      this.constrainBoid(p);
      if (this.settings.obstacles) this.resolveObstacles(p);
      this.constrainBoid(p);
    }
    for (let axis = 0; axis < 3; axis++) {
      const bound = this.bounds.halfSize[axis] - 1;
      this.predator[axis] = Math.max(-bound, Math.min(bound, this.predator[axis]));
      if (Math.abs(this.predator[axis]) >= bound && this.predator[axis] * this.predatorVelocity[axis] > 0) this.predatorVelocity[axis] = 0;
    }
  }

  addObstacle(type = 'sphere') {
    const id = this.obstacleLayout.add(type);
    this.reconcileObstacles();
    return id;
  }

  moveObstacle(id, patch) { this.obstacleLayout.move(id, patch); this.reconcileObstacles(); }
  updateObstacle(id, patch) { this.obstacleLayout.update(id, patch); this.reconcileObstacles(); }
  removeObstacle(id) { this.obstacleLayout.remove(id); }
  resetObstacles() { this.obstacleLayout.reset(); this.reconcileObstacles(); }

  reconcileObstacles() {
    if (!this.settings.obstacles) return;
    for (let p = 0; p < this.count * 3; p += 3) this.resolveObstacles(p);
    this.previousPositions.set(this.positions);
    this.measure();
  }

  reset(seed = this.seed ?? DEFAULT_SEED) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new RangeError('Seed must be a uint32 integer');
    this.seed = seed >>> 0;
    this.time = 0;
    this.goalTime = 0;
    this.previousGoalTime = 0;
    this.goalAdvance = 0;
    this.updateSettings(this.settings);
    this.count = this.settings.count;
    this.settings.count = this.count;
    const random = seededRandom(this.seed);
    for (let i = 0; i < this.count; i++) {
      const p = i * 3;
      for (let axis = 0; axis < 3; axis++) {
        this.positions[p + axis] = (random() - 0.5) * (this.bounds.halfSize[axis] * 2 - 6);
        this.velocities[p + axis] = random() * 2 - 1;
      }
      this.limitVelocity(this.velocities, p);
      if (this.settings.obstacles) this.resolveObstacles(p);
    }
    this.previousPositions.set(this.positions);
    this.neighborCounts.fill(0);
    this.predator.set([-0.72 * this.bounds.halfSize[0], 0.32 * this.bounds.halfSize[1], 0.6 * this.bounds.halfSize[2]]);
    this.previousPredator.set(this.predator);
    const predatorScale = Math.min(1, this.settings.predatorSpeed / 5);
    this.predatorVelocity.set([4 * predatorScale, 0, -3 * predatorScale]);
    this.metrics.neighborChecks = 0;
    this.updateGoal();
    this.measure();
  }

  /** Diagnostic evaluation only. Never integrates state or changes metrics. */
  inspect(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) throw new RangeError('Invalid boid index');
    this.search.rebuild(this.positions, this.count);
    const detail = this.inspection;
    evaluateFlocking(this, index, this.inspectionForce, detail);
    detail.index = index;
    detail.time = this.time;
    detail.version++;
    for (let axis = 0; axis < 3; axis++) {
      detail.position[axis] = this.positions[index * 3 + axis];
      detail.velocity[axis] = this.velocities[index * 3 + axis];
    }
    return detail;
  }

  refreshNeighborhoodCounts() {
    this.search.rebuild(this.positions, this.count);
    for (let i = 0; i < this.count; i++) {
      evaluateFlocking(this, i, this.inspectionForce);
      this.neighborCounts[i] = this.inspectionForce[4];
    }
  }

  updateGoal() {
    sampleGoalPath(this.goalTime, this.goal, null, this.bounds);
  }

  snapInterpolation() {
    this.previousPositions.set(this.positions);
    this.previousPredator.set(this.predator);
    this.previousGoalTime = this.goalTime;
    this.goalAdvance = 0;
  }

  limitVelocity(buffer, p) {
    const length = Math.hypot(buffer[p], buffer[p + 1], buffer[p + 2]);
    if (length < EPSILON) {
      buffer[p] = WORLD.minSpeed; buffer[p + 1] = 0; buffer[p + 2] = 0;
      return;
    }
    const factor = Math.max(WORLD.minSpeed, Math.min(WORLD.maxSpeed, length)) / length;
    for (let axis = 0; axis < 3; axis++) buffer[p + axis] *= factor;
  }

  updatePredator(dt) {
    this.previousPredator.set(this.predator);
    if (!this.settings.predator) return;
    const targetSpeed = this.settings.predatorSpeed;
    if (targetSpeed === 0) { this.predatorVelocity.fill(0); return; }
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < this.count * 3; i += 3) {
      cx += this.positions[i]; cy += this.positions[i + 1]; cz += this.positions[i + 2];
    }
    // Arrival: desired speed falls with distance instead of crossing the center at full speed.
    // A 1/s position response and 4/s velocity response give critical damping near a static target.
    const bx = this.bounds.halfSize[0] - 1, by = this.bounds.halfSize[1] - 1, bz = this.bounds.halfSize[2] - 1;
    const dx = Math.max(-bx, Math.min(bx, cx / this.count)) - this.predator[0];
    const dy = Math.max(-by, Math.min(by, cy / this.count)) - this.predator[1];
    const dz = Math.max(-bz, Math.min(bz, cz / this.count)) - this.predator[2];
    const distance = Math.max(EPSILON, Math.hypot(dx, dy, dz));
    const desiredScale = Math.min(1, targetSpeed / distance);
    const vx = this.predatorVelocity[0], vy = this.predatorVelocity[1], vz = this.predatorVelocity[2];
    const ax = (dx * desiredScale - vx) * 4;
    const ay = (dy * desiredScale - vy) * 4;
    const az = (dz * desiredScale - vz) * 4;
    const accelerationScale = Math.min(1, 24 / Math.max(EPSILON, Math.hypot(ax, ay, az)));
    this.predatorVelocity[0] += ax * accelerationScale * dt;
    this.predatorVelocity[1] += ay * accelerationScale * dt;
    this.predatorVelocity[2] += az * accelerationScale * dt;
    const speed = Math.hypot(this.predatorVelocity[0], this.predatorVelocity[1], this.predatorVelocity[2]);
    const scale = Math.min(1, targetSpeed / Math.max(EPSILON, speed));
    for (let axis = 0; axis < 3; axis++) {
      this.predatorVelocity[axis] *= scale;
      const bound = this.bounds.halfSize[axis] - 1;
      const position = this.predator[axis] + this.predatorVelocity[axis] * dt;
      this.predator[axis] = this.settings.boundaryMode === 'soft' ? position : Math.max(-bound, Math.min(bound, position));
      // Hard contact removes outward motion, so velocity and displacement agree at the wall.
      if (this.settings.boundaryMode !== 'soft' && Math.abs(position) >= bound && position * this.predatorVelocity[axis] > 0) this.predatorVelocity[axis] = 0;
    }
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.05) throw new RangeError('dt must be in (0, 0.05] seconds');
    this.previousPositions.set(this.positions);
    this.time += dt;
    this.previousGoalTime = this.goalTime;
    this.goalAdvance = this.settings.goal ? dt * this.settings.goalSpeed : 0;
    this.goalTime = wrapGoalTime(this.goalTime + this.goalAdvance);
    this.updateGoal();
    this.updatePredator(dt);
    this.search.rebuild(this.positions, this.count);
    this.metrics.neighborChecks = 0;
    const { positions: pos, velocities: vel, nextVelocities: next, settings, flockingForce } = this;
    for (let i = 0; i < this.count; i++) {
      const p = i * 3, x = pos[p], y = pos[p + 1], z = pos[p + 2];
      evaluateFlocking(this, i, flockingForce);
      this.metrics.neighborChecks += flockingForce[3];
      this.neighborCounts[i] = flockingForce[4];
      let fx = flockingForce[0], fy = flockingForce[1], fz = flockingForce[2];
      if (settings.goal) {
        const goalForce = 0.28 * settings.goalStrength;
        fx += (this.goal[0] - x) * goalForce; fy += (this.goal[1] - y) * goalForce; fz += (this.goal[2] - z) * goalForce;
      }
      if (settings.predator) {
        const dx = x - this.predator[0], dy = y - this.predator[1], dz = z - this.predator[2];
        const distance = Math.hypot(dx, dy, dz);
        if (distance < settings.predatorRadius) {
          const strength = 65 * settings.predatorStrength;
          const force = (1 - distance / settings.predatorRadius) * strength / Math.max(distance, 0.1);
          fx += distance < EPSILON ? strength : dx * force; fy += dy * force; fz += dz * force;
        }
      }
      if (settings.obstacles) {
        for (const obstacle of this.obstacles) {
          // Look ahead to begin steering before contact; collision projection is a separate constraint.
          const distance = obstacleSurface(obstacle, x + vel[p] * 0.45, y + vel[p + 1] * 0.45, z + vel[p + 2] * 0.45, this.obstacleNormal);
          if (distance < 4) {
            const margin = obstacle.type === 'sphere' ? obstacle.radius + 4 : 4;
            const force = Math.min(1, (4 - distance) / margin) * 55;
            fx += this.obstacleNormal[0] * force; fy += this.obstacleNormal[1] * force; fz += this.obstacleNormal[2] * force;
          }
        }
      }
      if (settings.boundaryMode !== 'hard') {
        boundarySteering(pos, vel, p, this.bounds.halfSize, settings.boundaryMargin, settings.boundaryStrength, this.boundaryForce);
        const retained = 1 - this.boundaryForce[3];
        fx = fx * retained + this.boundaryForce[0];
        fy = fy * retained + this.boundaryForce[1];
        fz = fz * retained + this.boundaryForce[2];
      }
      const forceScale = Math.min(1, WORLD.maxForce / Math.max(EPSILON, Math.hypot(fx, fy, fz)));
      next[p] = vel[p] + fx * forceScale * dt;
      next[p + 1] = vel[p + 1] + fy * forceScale * dt;
      next[p + 2] = vel[p + 2] + fz * forceScale * dt;
      this.limitVelocity(next, p);
    }
    // Commit only after every agent has read the same state snapshot.
    this.velocities = next;
    this.nextVelocities = vel;
    for (let i = 0; i < this.count; i++) {
      const p = i * 3;
      for (let axis = 0; axis < 3; axis++) pos[p + axis] += next[p + axis] * dt;
      if (settings.obstacles) this.resolveObstacles(p);
      this.constrainBoid(p);
    }
    this.measure();
  }

  resolveObstacles(p) {
    for (const obstacle of this.obstacles) {
      const distance = obstacleSurface(obstacle, this.positions[p], this.positions[p + 1], this.positions[p + 2], this.obstacleNormal);
      if (distance >= OBSTACLE_CLEARANCE) continue;
      const dx = this.obstacleNormal[0], dy = this.obstacleNormal[1], dz = this.obstacleNormal[2];
      const correction = OBSTACLE_CLEARANCE - distance + 1e-5;
      this.positions[p] += dx * correction;
      this.positions[p + 1] += dy * correction;
      this.positions[p + 2] += dz * correction;
      if (this.settings.boundaryMode !== 'soft') for (let axis = 0; axis < 3; axis++) {
        this.positions[p + axis] = Math.max(-this.bounds.halfSize[axis], Math.min(this.bounds.halfSize[axis], this.positions[p + axis]));
      }
      const inward = this.velocities[p] * dx + this.velocities[p + 1] * dy + this.velocities[p + 2] * dz;
      if (inward < 0) {
        this.velocities[p] -= 1.5 * inward * dx;
        this.velocities[p + 1] -= 1.5 * inward * dy;
        this.velocities[p + 2] -= 1.5 * inward * dz;
      }
      this.limitVelocity(this.velocities, p);
    }
  }

  constrainBoid(p) {
    if (this.settings.boundaryMode !== 'soft') for (let axis = 0; axis < 3; axis++) {
      const k = p + axis, bound = this.bounds.halfSize[axis];
      if (Math.abs(this.positions[k]) > bound) {
        const sign = Math.sign(this.positions[k]);
        this.positions[k] = sign * bound;
        this.velocities[k] = -sign * Math.abs(this.velocities[k]);
      }
    }
    this.limitVelocity(this.velocities, p);
  }

  measure() {
    let speedSum = 0, dx = 0, dy = 0, dz = 0, outsideCount = 0, maxExcursion = 0;
    for (let p = 0; p < this.count * 3; p += 3) {
      const speed = Math.max(EPSILON, Math.hypot(this.velocities[p], this.velocities[p + 1], this.velocities[p + 2]));
      speedSum += speed; dx += this.velocities[p] / speed; dy += this.velocities[p + 1] / speed; dz += this.velocities[p + 2] / speed;
      const excursion = Math.max(0, Math.abs(this.positions[p]) - this.bounds.halfSize[0], Math.abs(this.positions[p + 1]) - this.bounds.halfSize[1], Math.abs(this.positions[p + 2]) - this.bounds.halfSize[2]);
      if (excursion > 0) outsideCount++;
      maxExcursion = Math.max(maxExcursion, excursion);
    }
    this.metrics.meanSpeed = speedSum / this.count;
    this.metrics.alignment = Math.hypot(dx, dy, dz) / this.count;
    this.metrics.outsideCount = outsideCount;
    this.metrics.maxExcursion = maxExcursion;
  }
}


