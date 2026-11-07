// Shared path contract in world units and phase seconds; no rendering dependency.
export const GOAL_PERIOD = (Math.PI * 2) / 0.09;

export function wrapGoalTime(time) {
  return time >= GOAL_PERIOD || time < 0
    ? ((time % GOAL_PERIOD) + GOAL_PERIOD) % GOAL_PERIOD
    : time;
}

/** Position and optional tangent at 1x speed. Callers own/reuse the output buffers. */
export function sampleGoalPath(time, position, tangent, bounds) {
  const phaseTime = wrapGoalTime(time);
  const horizontal = phaseTime * 0.18,
    vertical = phaseTime * 0.27;
  position[0] = Math.cos(horizontal) * 17;
  position[1] = Math.sin(vertical) * 12 + 3;
  position[2] = Math.sin(horizontal) * 17;
  if (tangent) {
    tangent[0] = -Math.sin(horizontal) * 3.06;
    tangent[1] = Math.cos(vertical) * 3.24;
    tangent[2] = Math.cos(horizontal) * 3.06;
  }
  // Shrink the default route to fit a smaller map; enlargement keeps its speed and reach unchanged.
  if (bounds)
    for (let axis = 0; axis < 3; axis++) {
      const scale = Math.min(1, bounds.halfSize[axis] / 25);
      position[axis] *= scale;
      if (tangent) tangent[axis] *= scale;
    }
}
