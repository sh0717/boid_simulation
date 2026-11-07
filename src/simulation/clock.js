import { FIXED_DT } from '../config.js';

/** Bounded catch-up prevents a suspended tab from producing an unbounded update burst. */
export class SimulationClock {
  constructor() {
    this.accumulator = 0;
  }
  reset() {
    this.accumulator = 0;
  }
  advance(elapsed, speed, step) {
    if (!Number.isFinite(elapsed) || !Number.isFinite(speed) || speed < 0 || speed > 2)
      throw new RangeError('Elapsed time and speed must be finite; speed must be in [0, 2]');
    this.accumulator += Math.min(Math.max(elapsed, 0), 0.1) * speed;
    let steps = 0;
    while (this.accumulator + 1e-10 >= FIXED_DT && steps < 12) {
      step(FIXED_DT);
      this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
      steps++;
    }
    if (steps === 12) this.accumulator %= FIXED_DT;
    return this.accumulator / FIXED_DT;
  }
}
