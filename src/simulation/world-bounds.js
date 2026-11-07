export const MAP_SIZE_RANGE = Object.freeze([20, 200]);
export const DEFAULT_MAP_SIZE = Object.freeze({ width: 50, height: 50, depth: 50 });

/** Immutable origin-centered box. Validate a complete resize before committing any state. */
export function createWorldBounds(patch = {}, previous = DEFAULT_MAP_SIZE) {
  for (const key of Object.keys(patch))
    if (!Object.hasOwn(DEFAULT_MAP_SIZE, key)) throw new TypeError(`Unknown map dimension: ${key}`);
  const dimensions = {
    width: previous.width,
    height: previous.height,
    depth: previous.depth,
    ...patch,
  };
  for (const value of Object.values(dimensions)) {
    if (!Number.isInteger(value) || value < MAP_SIZE_RANGE[0] || value > MAP_SIZE_RANGE[1]) {
      throw new RangeError(
        `맵 크기는 각 축 ${MAP_SIZE_RANGE[0]}~${MAP_SIZE_RANGE[1]} u 사이의 정수여야 합니다.`,
      );
    }
  }
  return Object.freeze({
    ...dimensions,
    halfSize: Object.freeze([dimensions.width / 2, dimensions.height / 2, dimensions.depth / 2]),
  });
}

export const DEFAULT_WORLD_BOUNDS = createWorldBounds();
