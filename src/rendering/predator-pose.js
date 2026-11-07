import { Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const MAX_TURN_RATE = Math.PI; // Visual heading: 180 degrees per simulation second.

/** Fixed-step visual orientation; no mutation of simulation state or frame-rate-dependent roll. */
export class PredatorPose {
  constructor() {
    this.previous = new Quaternion();
    this.current = new Quaternion();
    this.rotation = new Quaternion();
    this.target = new Quaternion();
    this.forward = new Vector3();
    this.direction = new Vector3();
  }

  reset(simulation) {
    this.current.identity();
    this.direction.fromArray(simulation.predatorVelocity);
    if (this.direction.lengthSq() > 0.0025)
      this.current.setFromUnitVectors(UP, this.direction.normalize());
    this.snap();
  }

  snap() {
    this.previous.copy(this.current);
  }

  advance(simulation, dt) {
    this.snap();
    if (!simulation.settings.predator) return;
    this.direction.fromArray(simulation.predatorVelocity);
    // Retain heading at rest; tiny numerical velocities must not turn the mesh around.
    if (this.direction.lengthSq() <= 0.0025) return;
    this.direction.normalize();
    this.forward.copy(UP).applyQuaternion(this.current);
    // Transport the existing orientation: using world +Y every frame introduces a roll singularity.
    this.rotation.setFromUnitVectors(this.forward, this.direction);
    this.target.copy(this.current).premultiply(this.rotation).normalize();
    this.current.rotateTowards(this.target, MAX_TURN_RATE * dt);
  }

  apply(object, simulation, alpha) {
    for (let axis = 0; axis < 3; axis++) {
      object.position.setComponent(
        axis,
        simulation.previousPredator[axis] * (1 - alpha) + simulation.predator[axis] * alpha,
      );
    }
    object.quaternion.slerpQuaternions(this.previous, this.current, alpha);
  }
}
