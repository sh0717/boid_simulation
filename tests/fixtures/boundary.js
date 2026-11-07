/** Inward steering plus a head-on turn; no position projection or velocity reflection. */
export function boundarySteering(positions, velocities, p, halfSize, margin, strength, output) {
  let outside = 0;
  for (let axis = 0; axis < 3; axis++) {
    const position = positions[p + axis], width = Math.min(margin, halfSize[axis] * 0.5);
    output[axis] = -Math.sign(position) * Math.max(0, Math.abs(position) - halfSize[axis] + width);
    outside = Math.max(outside, (Math.abs(position) - halfSize[axis]) / width);
  }
  // Outside by one steering-zone width: prioritize returning over other behavioral forces.
  output[3] = Math.min(1, outside);
  const length = Math.hypot(output[0], output[1], output[2]);
  if (length < 1e-8) return;
  const nx = output[0] / length, ny = output[1] / length, nz = output[2] / length;
  const speed = Math.hypot(velocities[p], velocities[p + 1], velocities[p + 2]);
  const cosine = speed > 1e-8 ? (nx * velocities[p] + ny * velocities[p + 1] + nz * velocities[p + 2]) / speed : 0;
  const force = length * 3.5 * strength;
  output[0] = nx * force; output[1] = ny * force; output[2] = nz * force;
  // A purely opposite force cannot turn a minimum-speed boid. Supply a deterministic
  // perpendicular component only near a head-on approach, fading out during the turn.
  const turn = Math.max(0, (-cosine - 0.8) / 0.2);
  if (turn === 0) return;
  const axis = Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz) ? 0 : Math.abs(ny) <= Math.abs(nz) ? 1 : 2;
  const component = axis === 0 ? nx : axis === 1 ? ny : nz;
  const scale = force * turn / Math.sqrt(Math.max(1e-8, 1 - component * component));
  output[0] += ((axis === 0 ? 1 : 0) - nx * component) * scale;
  output[1] += ((axis === 1 ? 1 : 0) - ny * component) * scale;
  output[2] += ((axis === 2 ? 1 : 0) - nz * component) * scale;
}
