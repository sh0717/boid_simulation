import { MAX_OBSTACLES, OBSTACLES, OBSTACLE_CLEARANCE, OBSTACLE_SIZE_RANGES } from '../config.js';
import { DEFAULT_WORLD_BOUNDS } from './world-bounds.js';

/** Signed distance to the solid and outward unit normal. Caller owns the reusable output. */
export function obstacleSurface(obstacle, x, y, z, normal) {
  const dx = x - obstacle.x,
    dy = y - obstacle.y,
    dz = z - obstacle.z;
  if (obstacle.type === 'sphere') {
    const length = Math.hypot(dx, dy, dz);
    normal[0] = length > 1e-8 ? dx / length : 1;
    normal[1] = length > 1e-8 ? dy / length : 0;
    normal[2] = length > 1e-8 ? dz / length : 0;
    return length - obstacle.radius;
  }
  const qx = Math.abs(dx) - obstacle.width / 2;
  const qy = Math.abs(dy) - obstacle.height / 2;
  const qz = Math.abs(dz) - obstacle.depth / 2;
  const ox = Math.max(qx, 0),
    oy = Math.max(qy, 0),
    oz = Math.max(qz, 0);
  const outside = Math.hypot(ox, oy, oz);
  normal[0] = normal[1] = normal[2] = 0;
  if (outside > 0) {
    normal[0] = (dx < 0 ? -ox : ox) / outside;
    normal[1] = (dy < 0 ? -oy : oy) / outside;
    normal[2] = (dz < 0 ? -oz : oz) / outside;
    return outside;
  }
  // Interior/face/center ties choose X, then Y, then Z deterministically.
  if (qx >= qy && qx >= qz) normal[0] = dx < 0 ? -1 : 1;
  else if (qy >= qz) normal[1] = dy < 0 ? -1 : 1;
  else normal[2] = dz < 0 ? -1 : 1;
  return Math.max(qx, qy, qz);
}

function obstacleGap(a, b, normal) {
  if (a.type === 'sphere') return obstacleSurface(b, a.x, a.y, a.z, normal) - a.radius;
  if (b.type === 'sphere') return obstacleSurface(a, b.x, b.y, b.z, normal) - b.radius;
  return Math.hypot(
    Math.max(0, Math.abs(a.x - b.x) - (a.width + b.width) / 2),
    Math.max(0, Math.abs(a.y - b.y) - (a.height + b.height) / 2),
    Math.max(0, Math.abs(a.z - b.z) - (a.depth + b.depth) / 2),
  );
}

/** Immutable snapshots; all layout edits validate before committing. */
export class ObstacleLayout {
  constructor(bounds = DEFAULT_WORLD_BOUNDS) {
    this.bounds = bounds;
    this.revision = 0;
    this.normal = new Float64Array(3);
    this.reset();
  }

  reset() {
    const scale = Math.min(1, ...this.bounds.halfSize.map((value) => value / 25));
    this.items = Object.freeze(
      OBSTACLES.map((obstacle, index) =>
        Object.freeze({
          ...obstacle,
          x: obstacle.x * scale,
          y: obstacle.y * scale,
          z: obstacle.z * scale,
          radius: obstacle.radius * scale,
          id: index + 1,
        }),
      ),
    );
    this.nextId = this.items.length + 1;
    this.revision++;
  }

  validate(obstacle, excludedId = null) {
    if (!['sphere', 'box'].includes(obstacle.type))
      throw new RangeError('장애물 종류는 sphere 또는 box여야 합니다.');
    const dimensions = obstacle.type === 'sphere' ? ['radius'] : ['width', 'height', 'depth'];
    for (const key of dimensions) {
      const [min, max] = OBSTACLE_SIZE_RANGES[key];
      if (!Number.isFinite(obstacle[key]) || obstacle[key] < min || obstacle[key] > max) {
        throw new RangeError(`크기는 ${min}~${max} u 사이의 유한한 숫자여야 합니다.`);
      }
    }
    this.validatePlacement(obstacle, this.bounds);
    for (const other of this.items) {
      if (other.id === excludedId) continue;
      if (obstacleGap(obstacle, other, this.normal) < 2 * OBSTACLE_CLEARANCE + 0.1) {
        throw new RangeError('다른 장애물과 너무 가깝습니다. 위치나 크기를 조절하세요.');
      }
    }
  }

  validatePlacement(obstacle, bounds) {
    for (const [index, axis, dimension] of [
      [0, 'x', 'width'],
      [1, 'y', 'height'],
      [2, 'z', 'depth'],
    ]) {
      const extent = obstacle.type === 'sphere' ? obstacle.radius : obstacle[dimension] / 2;
      const limit = bounds.halfSize[index] - extent - OBSTACLE_CLEARANCE;
      if (!Number.isFinite(obstacle[axis]))
        throw new RangeError('좌표에는 유한한 숫자를 입력하세요.');
      if (Math.abs(obstacle[axis]) > limit)
        throw new RangeError(
          `OBS ${obstacle.id}: ${axis.toUpperCase()}축 맵 크기가 최소 ${Math.ceil(2 * (Math.abs(obstacle[axis]) + extent + OBSTACLE_CLEARANCE))} u 필요합니다. 장애물을 이동·축소·삭제하세요.`,
        );
    }
  }

  validateBounds(bounds) {
    for (const obstacle of this.items) this.validatePlacement(obstacle, bounds);
  }

  add(type = 'sphere') {
    if (!['sphere', 'box'].includes(type))
      throw new RangeError('장애물 종류는 sphere 또는 box여야 합니다.');
    if (this.items.length >= MAX_OBSTACLES)
      throw new RangeError(`장애물은 최대 ${MAX_OBSTACLES}개까지 추가할 수 있습니다.`);
    const size = type === 'sphere' ? { radius: 3.3 } : { width: 6, height: 6, depth: 6 };
    for (const y of [0, 12, -12])
      for (const z of [0, 12, -12])
        for (const x of [-12, 0, 12]) {
          const obstacle = Object.freeze({
            id: this.nextId,
            type,
            x: (x * this.bounds.width) / 50,
            y: (y * this.bounds.height) / 50,
            z: (z * this.bounds.depth) / 50,
            ...size,
          });
          try {
            this.validate(obstacle);
          } catch (error) {
            if (error instanceof RangeError) continue;
            throw error;
          }
          this.items = Object.freeze([...this.items, obstacle]);
          this.nextId++;
          this.revision++;
          return obstacle.id;
        }
    throw new RangeError('추가할 빈 공간이 없습니다. 기존 장애물을 이동하거나 삭제하세요.');
  }

  update(id, patch) {
    const obstacle = this.items.find((item) => item.id === id);
    if (!obstacle) throw new RangeError('편집할 장애물을 선택하세요.');
    const keys =
      obstacle.type === 'sphere'
        ? ['x', 'y', 'z', 'radius']
        : ['x', 'y', 'z', 'width', 'height', 'depth'];
    for (const key of Object.keys(patch))
      if (!keys.includes(key)) throw new TypeError(`Unknown obstacle property: ${key}`);
    const next = Object.freeze({ ...obstacle, ...patch });
    this.validate(next, id);
    this.items = Object.freeze(this.items.map((item) => (item.id === id ? next : item)));
    this.revision++;
  }

  move(id, patch) {
    for (const key of Object.keys(patch))
      if (!['x', 'y', 'z'].includes(key))
        throw new TypeError(`Unknown obstacle coordinate: ${key}`);
    this.update(id, patch);
  }

  remove(id) {
    if (!this.items.some((item) => item.id === id))
      throw new RangeError('삭제할 장애물을 선택하세요.');
    this.items = Object.freeze(this.items.filter((item) => item.id !== id));
    this.revision++;
  }
}
