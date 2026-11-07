import { WORLD } from '../../src/config.js';

/**
 * Allocation-free rule evaluation from one immutable state snapshot.
 * Output: weighted force xyz, candidate checks, visible-neighbor count.
 * Separation uses the whole near sphere; cohesion/alignment obey field of view.
 */
export function evaluateFlocking(simulation, index, output, detail = null) {
  const { positions: pos, velocities: vel, search, settings } = simulation;
  const p = index * 3, x = pos[p], y = pos[p + 1], z = pos[p + 2];
  const radius = settings.perception, radiusSq = radius * radius;
  const separationSq = WORLD.separation ** 2;
  const vx = vel[p], vy = vel[p + 1], vz = vel[p + 2];
  const speedSq = vx * vx + vy * vy + vz * vz;
  const directional = settings.fieldOfView < 360 && speedSq > 1e-8;
  const cosine = simulation.viewCosine;
  let cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0, sx = 0, sy = 0, sz = 0;
  let neighbors = 0, checks = 0, close = 0;
  const candidateCount = search.query(x, y, z, radius, simulation.candidates);
  for (let candidate = 0; candidate < candidateCount; candidate++) {
    const j = simulation.candidates[candidate];
    if (index === j) continue;
    checks++;
    const q = j * 3, dx = x - pos[q], dy = y - pos[q + 1], dz = z - pos[q + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= radiusSq) continue;
    if (d2 < separationSq) {
      close++;
      if (d2 < 1e-8) sx += index < j ? -1 : 1;
      else { sx += dx / d2; sy += dy / d2; sz += dz / d2; }
    }
    // Offset is neighbor - self; dx/dy/dz above point in the opposite direction.
    if (directional && d2 >= 1e-8 && -(vx * dx + vy * dy + vz * dz) < cosine * Math.sqrt(speedSq * d2) - 1e-10) continue;
    cx += pos[q]; cy += pos[q + 1]; cz += pos[q + 2];
    ax += vel[q]; ay += vel[q + 1]; az += vel[q + 2];
    if (detail) detail.neighbors[neighbors] = j;
    neighbors++;
  }
  const cohesion = settings.cohesion * 0.6, separation = settings.separation * 13;
  if (neighbors) {
    cx = (cx / neighbors - x) * cohesion; cy = (cy / neighbors - y) * cohesion; cz = (cz / neighbors - z) * cohesion;
    ax = (ax / neighbors - vx) * settings.alignment; ay = (ay / neighbors - vy) * settings.alignment; az = (az / neighbors - vz) * settings.alignment;
  }
  sx *= separation; sy *= separation; sz *= separation;
  output[0] = sx + cx + ax; output[1] = sy + cy + ay; output[2] = sz + cz + az;
  output[3] = checks; output[4] = neighbors;
  if (detail) {
    detail.neighborCount = neighbors; detail.closeCount = close;
    detail.cohesion[0] = cx; detail.cohesion[1] = cy; detail.cohesion[2] = cz;
    detail.alignment[0] = ax; detail.alignment[1] = ay; detail.alignment[2] = az;
    detail.separation[0] = sx; detail.separation[1] = sy; detail.separation[2] = sz;
  }
}

