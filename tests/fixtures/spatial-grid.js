/** Bounded, allocation-free linked cell list. Cell width matches perception radius. */
export class SpatialGrid {
  constructor(halfSize, cellSize, capacity) {
    this.halfSize = typeof halfSize === 'number' ? [halfSize, halfSize, halfSize] : [...halfSize];
    this.cellSize = cellSize;
    this.size = this.halfSize.map(value => Math.ceil(value * 2 / cellSize));
    this.heads = new Int32Array(this.size[0] * this.size[1] * this.size[2]);
    this.next = new Int32Array(capacity);
  }
  coordinate(value, axis) {
    return Math.max(0, Math.min(this.size[axis] - 1, Math.floor((value + this.halfSize[axis]) / this.cellSize)));
  }
  key(x, y, z) { return x + this.size[0] * (y + this.size[1] * z); }
  /** Candidate cells intersect the sphere; exact per-point testing belongs to the rules. */
  query(x, y, z, radius, output) {
    const gx = this.coordinate(x, 0), gy = this.coordinate(y, 1), gz = this.coordinate(z, 2);
    const cells = Math.ceil(radius / this.cellSize), radiusSq = radius * radius;
    let count = 0;
    for (let iz = Math.max(0, gz - cells); iz <= Math.min(this.size[2] - 1, gz + cells); iz++) {
      const cellZ = iz * this.cellSize - this.halfSize[2];
      // Edge buckets also contain out-of-map agents in Soft mode. Their cells extend
      // to infinity outward; finite AABBs would incorrectly prune those neighbors.
      const dz = Math.max(iz === 0 ? 0 : cellZ - z, 0, iz === this.size[2] - 1 ? 0 : z - cellZ - this.cellSize);
      for (let iy = Math.max(0, gy - cells); iy <= Math.min(this.size[1] - 1, gy + cells); iy++) {
        const cellY = iy * this.cellSize - this.halfSize[1];
        const dy = Math.max(iy === 0 ? 0 : cellY - y, 0, iy === this.size[1] - 1 ? 0 : y - cellY - this.cellSize);
        const yz = dy * dy + dz * dz;
        if (yz >= radiusSq) continue;
        for (let ix = Math.max(0, gx - cells); ix <= Math.min(this.size[0] - 1, gx + cells); ix++) {
          const cellX = ix * this.cellSize - this.halfSize[0];
          const dx = Math.max(ix === 0 ? 0 : cellX - x, 0, ix === this.size[0] - 1 ? 0 : x - cellX - this.cellSize);
          if (dx * dx + yz >= radiusSq) continue;
          for (let index = this.heads[this.key(ix, iy, iz)]; index !== -1; index = this.next[index]) output[count++] = index;
        }
      }
    }
    return count;
  }
  rebuild(positions, count) {
    this.heads.fill(-1);
    for (let i = 0; i < count; i++) {
      const p = i * 3;
      const key = this.key(this.coordinate(positions[p], 0), this.coordinate(positions[p + 1], 1), this.coordinate(positions[p + 2], 2));
      this.next[i] = this.heads[key];
      this.heads[key] = i;
    }
  }
}

export class AllPairsSearch {
  rebuild(_positions, count) { this.count = count; }
  query(_x, _y, _z, _radius, output) {
    for (let i = 0; i < this.count; i++) output[i] = i;
    return this.count;
  }
}
