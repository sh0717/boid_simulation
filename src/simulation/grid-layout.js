import { GRID_CELL_SIZE, MAX_GRID_CELLS } from '../config.js';

/** Choose the smallest integer cell width that fits the native direct-address grid. */
export function createGridLayout(halfSize) {
  if (!Array.isArray(halfSize) || halfSize.length !== 3)
    throw new RangeError('World bounds must have three half extents');
  const dimensions = halfSize.map((extent) => {
    if (!Number.isFinite(extent) || extent <= 0 || extent * 2 > Number.MAX_SAFE_INTEGER)
      throw new RangeError('World half extents must be finite and positive');
    return extent * 2;
  });
  const cellCounts = (cellSize) => dimensions.map((dimension) => Math.ceil(dimension / cellSize));
  const countCells = (size) => size[0] * size[1] * size[2];
  let first = GRID_CELL_SIZE;
  const guaranteedCellsPerAxis = Math.floor(Math.cbrt(MAX_GRID_CELLS));
  let last = Math.max(first, Math.ceil(Math.max(...dimensions) / guaranteedCellsPerAxis));
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (countCells(cellCounts(middle)) <= MAX_GRID_CELLS) last = middle;
    else first = middle + 1;
  }
  const size = cellCounts(first);
  return { cellSize: first, size, cellCount: countCells(size) };
}
