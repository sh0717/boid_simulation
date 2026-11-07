import * as THREE from 'three';
import { GOAL_PERIOD, sampleGoalPath } from '../simulation/goal-path.js';

/** Scene owns/disposes these GPU resources. Updates only read simulation state. */
export class GoalVisual {
  constructor(texture) {
    this.position = new Float32Array(3);
    this.tangent = new Float64Array(3);
    this.direction = new THREE.Vector3();
    this.goal = new THREE.Group();
    this.body = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.95),
      new THREE.MeshStandardMaterial({
        color: '#ffe0a1',
        emissive: '#f6ba53',
        emissiveIntensity: 2,
        metalness: 0.2,
        roughness: 0.3,
      }),
    );
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(2, 0.025, 6, 72),
      new THREE.MeshBasicMaterial({ color: '#e8c788', transparent: true, opacity: 0.6 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    const aura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: '#ffcf75',
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    aura.scale.set(8, 8, 1);
    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      2.8,
      '#ffe0a1',
      0.65,
      0.4,
    );
    this.goal.add(this.body, this.ring, aura, this.arrow);
    const vertices = new Float32Array(241 * 3);
    for (let i = 0; i <= 240; i++) {
      sampleGoalPath((i * GOAL_PERIOD) / 240, this.position);
      vertices.set(this.position, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.path = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({
        color: '#d7bd83',
        transparent: true,
        opacity: 0.32,
        dashSize: 0.6,
        gapSize: 0.6,
        depthWrite: false,
      }),
    );
    this.path.computeLineDistances();
  }

  update(simulation, alpha) {
    const { settings } = simulation;
    if (this.lastBounds !== simulation.bounds) {
      const vertices = this.path.geometry.attributes.position.array;
      const distances = this.path.geometry.attributes.lineDistance.array;
      for (let i = 0; i <= 240; i++) {
        sampleGoalPath((i * GOAL_PERIOD) / 240, this.position, null, simulation.bounds);
        vertices.set(this.position, i * 3);
        distances[i] =
          i === 0
            ? 0
            : distances[i - 1] +
              Math.hypot(
                vertices[i * 3] - vertices[(i - 1) * 3],
                vertices[i * 3 + 1] - vertices[(i - 1) * 3 + 1],
                vertices[i * 3 + 2] - vertices[(i - 1) * 3 + 2],
              );
      }
      this.path.geometry.attributes.position.needsUpdate = true;
      this.path.geometry.attributes.lineDistance.needsUpdate = true;
      this.path.geometry.computeBoundingSphere();
      this.lastBounds = simulation.bounds;
    }
    // Interpolate phase, not a straight chord, so the displayed target stays on its path.
    // The advance is stored separately to cross the periodic seam without interpolating backwards.
    const time =
      alpha === 1
        ? simulation.goalTime
        : simulation.previousGoalTime + simulation.goalAdvance * alpha;
    sampleGoalPath(time, this.position, this.tangent, simulation.bounds);
    this.goal.position.fromArray(this.position);
    this.goal.visible = settings.goal;
    this.path.visible = settings.goal && settings.goalPath;
    this.arrow.visible = settings.goalSpeed > 0;
    this.direction.fromArray(this.tangent).normalize();
    this.arrow.position.copy(this.direction).multiplyScalar(1.2);
    this.arrow.setDirection(this.direction);
    // Whole cycles at the path seam; speed zero also freezes decorative animation.
    const phase = time * 0.09;
    this.body.rotation.y = phase * 8;
    this.ring.scale.setScalar(1 + Math.sin(phase * 22) * 0.12);
  }
}
