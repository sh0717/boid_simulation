/** Balanced median kd-tree, rebuilt from moving points into reusable typed arrays. */
export class KdTree {
  constructor(capacity) {
    this.indices = new Int32Array(capacity);
    this.left = new Int32Array(capacity);
    this.right = new Int32Array(capacity);
    this.axes = new Uint8Array(capacity);
    this.stack = new Int32Array(capacity);
    this.root = -1;
  }
  rebuild(positions, count) {
    this.positions = positions;
    for (let i = 0; i < count; i++) this.indices[i] = i;
    this.root = this.buildBranch(0, count - 1, 0);
  }
  less(a, b, axis) {
    const delta = this.positions[a * 3 + axis] - this.positions[b * 3 + axis];
    return delta < 0 || (delta === 0 && a < b);
  }
  selectMedian(start, end, median, axis) {
    while (start < end) {
      const pivot = this.indices[(start + end) >>> 1];
      let low = start, high = end;
      while (low <= high) {
        while (this.less(this.indices[low], pivot, axis)) low++;
        while (this.less(pivot, this.indices[high], axis)) high--;
        if (low <= high) {
          const item = this.indices[low]; this.indices[low] = this.indices[high]; this.indices[high] = item;
          low++; high--;
        }
      }
      if (median <= high) end = high;
      else if (median >= low) start = low;
      else return;
    }
  }
  buildBranch(start, end, depth) {
    if (start > end) return -1;
    const median = (start + end) >>> 1, axis = depth % 3;
    this.selectMedian(start, end, median, axis);
    this.axes[median] = axis;
    this.left[median] = this.buildBranch(start, median - 1, depth + 1);
    this.right[median] = this.buildBranch(median + 1, end, depth + 1);
    return median;
  }
  /** Candidate superset; shared rules perform exact distance/FOV tests. */
  query(x, y, z, radius, output) {
    if (this.root < 0) return 0;
    let stackSize = 1, count = 0;
    this.stack[0] = this.root;
    while (stackSize) {
      const node = this.stack[--stackSize], index = this.indices[node], axis = this.axes[node];
      output[count++] = index;
      const delta = (axis === 0 ? x : axis === 1 ? y : z) - this.positions[index * 3 + axis];
      if (this.left[node] !== -1 && delta <= radius) this.stack[stackSize++] = this.left[node];
      if (this.right[node] !== -1 && delta >= -radius) this.stack[stackSize++] = this.right[node];
    }
    return count;
  }
}
