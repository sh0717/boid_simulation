import { BoidSimulation } from '../src/simulation/boids.js';
import { FIXED_DT } from '../src/config.js';
import { mkdir, writeFile } from 'node:fs/promises';

const baseline = process.argv.includes('--baseline');
function createSimulation(settings) {
  const simulation = new BoidSimulation(settings);
  // Frozen copy of the pre-fix pursuit rule, used only to reproduce the comparison.
  if (baseline)
    simulation.updatePredator = function (dt) {
      if (!this.settings.predator) return;
      const speed = this.settings.predatorSpeed;
      if (speed === 0) {
        this.predatorVelocity.fill(0);
        return;
      }
      let x = 0,
        y = 0,
        z = 0;
      for (let i = 0; i < this.count * 3; i += 3) {
        x += this.positions[i];
        y += this.positions[i + 1];
        z += this.positions[i + 2];
      }
      const dx = x / this.count - this.predator[0],
        dy = y / this.count - this.predator[1],
        dz = z / this.count - this.predator[2];
      const distance = Math.max(1e-8, Math.hypot(dx, dy, dz)),
        blend = 1 - Math.exp(-1.6 * dt);
      this.predatorVelocity[0] += ((dx / distance) * speed - this.predatorVelocity[0]) * blend;
      this.predatorVelocity[1] += ((dy / distance) * speed - this.predatorVelocity[1]) * blend;
      this.predatorVelocity[2] += ((dz / distance) * speed - this.predatorVelocity[2]) * blend;
      const scale = Math.min(1, speed / Math.max(1e-8, Math.hypot(...this.predatorVelocity)));
      for (let axis = 0; axis < 3; axis++) this.predatorVelocity[axis] *= scale;
      for (let axis = 0; axis < 3; axis++)
        this.predator[axis] = Math.max(
          -24,
          Math.min(24, this.predator[axis] + this.predatorVelocity[axis] * dt),
        );
    };
  return simulation;
}

// Controlled targets isolate pursuit from the flock's feedback loop.
function stationary(dt, speed = 14) {
  const simulation = createSimulation({
    count: 1,
    predator: true,
    predatorSpeed: speed,
    obstacles: false,
  });
  simulation.positions.fill(0);
  simulation.predator.set([-10, 0, 0]);
  simulation.predatorVelocity.fill(0);
  let crossings = 0,
    tailMaxDistance = 0,
    tailMaxSpeed = 0,
    maxAcceleration = 0;
  for (let i = 0; i < Math.round(20 / dt); i++) {
    const x = simulation.predator[0],
      velocity = simulation.predatorVelocity.slice();
    simulation.updatePredator(dt);
    if (x * simulation.predator[0] < 0) crossings++;
    maxAcceleration = Math.max(
      maxAcceleration,
      Math.hypot(...velocity.map((value, axis) => simulation.predatorVelocity[axis] - value)) / dt,
    );
    if (i * dt >= 10) {
      tailMaxDistance = Math.max(tailMaxDistance, Math.hypot(...simulation.predator));
      tailMaxSpeed = Math.max(tailMaxSpeed, Math.hypot(...simulation.predatorVelocity));
    }
  }
  return {
    dt,
    speed,
    crossings,
    tailMaxDistance,
    tailMaxSpeed,
    maxAcceleration,
    finalPosition: [...simulation.predator],
  };
}

const wall = createSimulation({ count: 1, predator: true, obstacles: false });
wall.positions.set([25, 0, 0]);
wall.predator.set([24, 0, 0]);
wall.predatorVelocity.set([14, 0, 0]);
wall.updatePredator(FIXED_DT);
const moving = createSimulation({ count: 1, predator: true, obstacles: false });
moving.predator.set([-10, 0, 0]);
moving.predatorVelocity.fill(0);
let movingTailError = 0;
for (let i = 0; i < 1200; i++) {
  const t = i * FIXED_DT;
  moving.positions.set([10 * Math.cos(t * 0.2), 0, 10 * Math.sin(t * 0.2)]);
  moving.velocities.set([-2 * Math.sin(t * 0.2), 0, 2 * Math.cos(t * 0.2)]);
  moving.updatePredator(FIXED_DT);
  if (t >= 10)
    movingTailError = Math.max(
      movingTailError,
      Math.hypot(...moving.predator.map((value, axis) => value - moving.positions[axis])),
    );
}
const result = {
  stationary: [1 / 30, FIXED_DT, 1 / 120].map((dt) => stationary(dt)),
  maximumSpeed: stationary(FIXED_DT, 24),
  wall: { position: [...wall.predator], velocity: [...wall.predatorVelocity] },
  movingTarget: { speed: 2, radius: 10, tailMaxError: movingTailError },
};
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
const name = baseline ? 'before' : 'after';
await writeFile(
  new URL(`../artifacts/predator-${name}.json`, import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
