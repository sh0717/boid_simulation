import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, Vector3 } from 'three';
import { BoidSimulation } from '../../src/simulation/boids.js';
import { SimulationClock } from '../../src/simulation/clock.js';
import { PredatorPose } from '../../src/rendering/predator-pose.js';
import { FIXED_DT } from '../../src/config.js';

function isolated(speed = 14) {
  const simulation = new BoidSimulation({
    count: 1,
    predator: true,
    predatorSpeed: speed,
    obstacles: false,
  });
  simulation.positions.fill(0);
  simulation.velocities.fill(0);
  simulation.predator.set([-10, 0, 0]);
  simulation.predatorVelocity.fill(0);
  return simulation;
}

test('predator arrives at a stationary centroid without repeated crossings at supported time steps', () => {
  for (const dt of [0.05, 1 / 30, FIXED_DT, 1 / 120])
    for (const speed of [2, 14, 24]) {
      const simulation = isolated(speed);
      for (let i = 0; i < Math.round(20 / dt); i++) {
        const previousX = simulation.predator[0];
        simulation.updatePredator(dt);
        assert.ok(simulation.predator[0] <= 1e-6, 'must not oscillate across the target');
        assert.ok(simulation.predator[0] >= previousX, 'distance must decrease from rest');
      }
      assert.ok(Math.hypot(...simulation.predator) < 0.001);
      assert.ok(Math.hypot(...simulation.predatorVelocity) < 0.001);
    }
});

test('predator acceleration is bounded on departure and abrupt target reversal', () => {
  const simulation = isolated(24);
  for (let i = 0; i < 180; i++) {
    simulation.positions.set([i < 90 ? 20 : -20, 8, -6]);
    const velocity = simulation.predatorVelocity.slice();
    simulation.updatePredator(FIXED_DT);
    const acceleration = Math.hypot(
      ...velocity.map((value, axis) => (simulation.predatorVelocity[axis] - value) / FIXED_DT),
    );
    assert.ok(acceleration <= 24.0002, `acceleration ${acceleration}`);
    assert.ok(Math.hypot(...simulation.predatorVelocity) <= 24.00001);
  }
});

test('predator wall contact clears only outward velocity on all faces and releases toward an interior target', () => {
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const simulation = isolated();
      simulation.predator.fill(0);
      simulation.predator[axis] = sign * 24;
      simulation.positions[axis] = sign * 25;
      simulation.predatorVelocity[axis] = sign * 14;
      simulation.predatorVelocity[(axis + 1) % 3] = 1;
      simulation.updatePredator(FIXED_DT);
      assert.equal(simulation.predator[axis], sign * 24);
      assert.equal(simulation.predatorVelocity[axis], 0);
      assert.ok(simulation.predatorVelocity[(axis + 1) % 3] > 0, 'preserve tangential movement');
      simulation.positions.fill(0);
      simulation.updatePredator(FIXED_DT);
      assert.ok(Math.abs(simulation.predator[axis]) < 24);
    }
});

test('predator follows a moving centroid without stopping pursuit after arrival', () => {
  const simulation = isolated();
  let maxError = 0;
  for (let i = 0; i < 1200; i++) {
    const phase = i * FIXED_DT * 0.2;
    simulation.positions.set([10 * Math.cos(phase), 0, 10 * Math.sin(phase)]);
    simulation.updatePredator(FIXED_DT);
    if (i > 600) {
      maxError = Math.max(
        maxError,
        Math.hypot(...simulation.predator.map((value, axis) => value - simulation.positions[axis])),
      );
      assert.ok(
        simulation.predatorVelocity[0] * -Math.sin(phase) +
          simulation.predatorVelocity[2] * Math.cos(phase) >
          1.8,
      );
    }
  }
  assert.ok(maxError < 2.1, `tracking distance ${maxError}`);
});

test('zero speed, disabled motion, coincident target and restart preserve valid predator snapshots', () => {
  const simulation = isolated(0);
  simulation.predatorVelocity.set([4, 0, -3]);
  const position = simulation.predator.slice();
  simulation.updatePredator(FIXED_DT);
  assert.deepEqual(simulation.predator, position);
  assert.deepEqual(simulation.previousPredator, position);
  assert.equal(Math.hypot(...simulation.predatorVelocity), 0);
  simulation.updateSettings({ predator: false, predatorSpeed: 14 });
  simulation.updatePredator(FIXED_DT);
  assert.deepEqual(simulation.predator, position);
  simulation.updateSettings({ predator: true });
  simulation.predator.fill(0);
  simulation.updatePredator(FIXED_DT);
  assert.deepEqual([...simulation.predator], [0, 0, 0]);
  for (const speed of [0, 2, 24]) {
    simulation.updateSettings({ predatorSpeed: speed });
    simulation.reset(7);
    assert.ok(Math.hypot(...simulation.predatorVelocity) <= speed + 1e-6);
    assert.deepEqual(simulation.previousPredator, simulation.predator);
  }
});

test('predator simulation and visual heading reproduce the same state at 30, 60 and 144 Hz', () => {
  for (const seed of [0, 7, 22823]) {
    const results = [30, 60, 144].map((hz) => {
      const simulation = new BoidSimulation({ count: 80, predator: true });
      simulation.reset(seed);
      const clock = new SimulationClock(),
        pose = new PredatorPose(),
        object = new Object3D();
      pose.reset(simulation);
      for (let frame = 0; frame < hz * 4; frame++) {
        const alpha = clock.advance(1 / hz, 1, (dt) => {
          simulation.step(dt);
          pose.advance(simulation, dt);
        });
        pose.apply(object, simulation, alpha);
      }
      return {
        position: [...simulation.predator],
        velocity: [...simulation.predatorVelocity],
        heading: pose.current.toArray(),
      };
    });
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[1], results[2]);
  }
});

test('predator interpolation uses both endpoints and does not mutate simulation state', () => {
  const simulation = isolated(),
    pose = new PredatorPose(),
    object = new Object3D();
  simulation.predatorVelocity.set([8, 0, 0]);
  pose.reset(simulation);
  const before = simulation.predator.slice();
  simulation.updatePredator(FIXED_DT);
  pose.advance(simulation, FIXED_DT);
  const after = simulation.predator.slice(),
    velocity = simulation.predatorVelocity.slice();
  for (const alpha of [0, 0.25, 0.5, 1]) {
    pose.apply(object, simulation, alpha);
    assert.ok(Math.abs(object.position.x - (before[0] * (1 - alpha) + after[0] * alpha)) < 1e-10);
  }
  assert.deepEqual(simulation.predator, after);
  assert.deepEqual(simulation.predatorVelocity, velocity);
  simulation.previousPredator.set(simulation.predator);
  pose.snap();
  pose.apply(object, simulation, 0);
  assert.deepEqual(object.position.toArray(), [...simulation.predator]);
  const rotation = object.quaternion.toArray();
  pose.apply(object, simulation, 1);
  assert.deepEqual(object.quaternion.toArray(), rotation);
});

test('long-running predator motion stays finite and bounded across seeds and maximum speed', () => {
  for (const seed of [0, 7, 22823]) {
    const simulation = new BoidSimulation({ count: 160, predator: true, predatorSpeed: 24 });
    simulation.reset(seed);
    for (let i = 0; i < 1800; i++) {
      simulation.step(FIXED_DT);
      for (const value of simulation.predator)
        assert.ok(Number.isFinite(value) && Math.abs(value) <= 24);
      assert.ok(Math.hypot(...simulation.predatorVelocity) <= 24.00001);
    }
  }
});

test('predator heading limits reversals and retains its orientation at rest', () => {
  const simulation = isolated(),
    pose = new PredatorPose();
  simulation.predatorVelocity.set([8, 0, 0]);
  pose.reset(simulation);
  simulation.predatorVelocity.set([-8, 0, 0]);
  for (let i = 0; i < 70; i++) {
    const before = pose.current.clone();
    pose.advance(simulation, FIXED_DT);
    assert.ok(before.angleTo(pose.current) <= Math.PI * FIXED_DT + 1e-6);
  }
  assert.ok(new Vector3(0, 1, 0).applyQuaternion(pose.current).x < -0.999);
  const rest = pose.current.toArray();
  for (const speed of [0, 1e-8, -0.01]) {
    simulation.predatorVelocity.set([speed, 0, 0]);
    pose.advance(simulation, FIXED_DT);
    assert.deepEqual(pose.current.toArray(), rest);
  }
});

test('transported predator heading stays smooth around the world down-axis singularity', () => {
  const simulation = isolated(),
    pose = new PredatorPose();
  simulation.predatorVelocity.set([0.01, -10, 0]);
  pose.reset(simulation);
  for (let i = 1; i <= 120; i++) {
    const phase = (i / 120) * Math.PI * 2,
      before = pose.current.clone();
    simulation.predatorVelocity.set([0.01 * Math.cos(phase), -10, 0.01 * Math.sin(phase)]);
    pose.advance(simulation, FIXED_DT);
    assert.ok(
      before.angleTo(pose.current) < 0.001,
      'small direction changes must not cause a large roll',
    );
    assert.ok(Math.abs(pose.current.length() - 1) < 1e-10);
  }
});
