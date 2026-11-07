export const WORLD = Object.freeze({
  halfSize: 25,
  perception: 10,
  separation: 3.2,
  minSpeed: 5,
  maxSpeed: 12,
  maxForce: 16,
});
export const MAX_BOIDS = 1200;
export const MAX_OBSTACLES = 16;
export const GRID_CELL_SIZE = 10; // World units per search cell; shared with the ABI descriptor.
export const OBSTACLE_CLEARANCE = 0.65;
export const OBSTACLE_SIZE_RANGES = Object.freeze({
  radius: [0.5, 10],
  width: [1, 20],
  height: [1, 20],
  depth: [1, 20],
});
export const FIXED_DT = 1 / 60;
export const DEFAULT_SEED = 22823;
export const DEFAULTS = Object.freeze({
  count: 320,
  cohesion: 0.85,
  alignment: 1.2,
  separation: 1.65,
  speed: 1,
  perception: 10,
  fieldOfView: 360,
  goal: true,
  goalSpeed: 1,
  goalStrength: 1,
  predator: false,
  predatorSpeed: 14,
  predatorRadius: 13,
  predatorStrength: 1,
  obstacles: true,
  trails: true,
  bounds: true,
  autoRotate: false,
  inspect: false,
  searchType: 'grid',
  colorMode: 'speed',
  goalPath: true,
  boundaryMode: 'hybrid',
  boundaryMargin: 5,
  boundaryStrength: 1,
});
export const SETTING_RANGES = Object.freeze({
  count: [1, MAX_BOIDS],
  cohesion: [0, 3],
  alignment: [0, 3],
  separation: [0, 3],
  speed: [0.25, 2],
  perception: [4, 16],
  fieldOfView: [60, 360],
  goalSpeed: [0, 2],
  goalStrength: [0, 3],
  predatorSpeed: [0, 24],
  predatorRadius: [4, 24],
  predatorStrength: [0, 3],
  boundaryMargin: [1, 10],
  boundaryStrength: [0.25, 3],
});

/** Validate at API/input boundaries. Return a complete transaction before applying it. */
export function validateSettings(patch) {
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new TypeError(`Unknown setting: ${key}`);
    if (Object.hasOwn(SETTING_RANGES, key)) {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new RangeError(`${key} must be finite`);
      const [min, max] = SETTING_RANGES[key];
      result[key] = Math.max(min, Math.min(max, key === 'count' ? Math.round(value) : value));
    } else if (key === 'searchType') {
      if (!['grid', 'kd-tree'].includes(value)) throw new RangeError('Invalid search type');
      result[key] = value;
    } else if (key === 'boundaryMode') {
      if (!['hard', 'soft', 'hybrid'].includes(value))
        throw new RangeError('Invalid boundary mode');
      result[key] = value;
    } else if (key === 'colorMode') {
      if (!['natural', 'speed', 'density'].includes(value))
        throw new RangeError('Invalid color mode');
      result[key] = value;
    } else {
      if (typeof value !== 'boolean') throw new TypeError(`${key} must be boolean`);
      result[key] = value;
    }
  }
  return result;
}
export const PRESETS = Object.freeze({
  balanced: { label: '균형 비행', cohesion: 0.85, alignment: 1.2, separation: 1.65 },
  school: { label: '밀집 군집', cohesion: 1.6, alignment: 1.8, separation: 0.85 },
  scatter: { label: '자유 확산', cohesion: 0.25, alignment: 0.45, separation: 2.4 },
});
export const OBSTACLES = Object.freeze([
  Object.freeze({ type: 'sphere', x: 0, y: 0, z: 0, radius: 4.5 }),
  Object.freeze({ type: 'sphere', x: 15, y: 11, z: -10, radius: 3.3 }),
]);
