import * as THREE from 'three';

const LINK_LIMIT = 64;
const UP = new THREE.Vector3(0, 1, 0);

/** Fixed-size diagnostic geometry; parent BoidScene owns disposal. */
export class BoidInspector {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.direction = new THREE.Vector3();
    this.origin = new THREE.Vector3();
    const unitSphere = new THREE.SphereGeometry(1, 20, 12);
    const wire = new THREE.WireframeGeometry(unitSphere);
    unitSphere.dispose();
    this.radius = new THREE.LineSegments(
      wire,
      new THREE.LineBasicMaterial({
        color: '#81c9e0',
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    );
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 12, 8),
      new THREE.MeshBasicMaterial({
        color: '#fff2b8',
        wireframe: true,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
      }),
    );
    this.group.add(this.radius, this.marker);
    this.fov = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: '#d9c080',
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    this.fovPoints = new Float32Array(48 * 12);
    this.fov.geometry.setAttribute('position', new THREE.BufferAttribute(this.fovPoints, 3));
    this.fov.frustumCulled = false;
    this.group.add(this.fov);
    this.linkPositions = new Float32Array(LINK_LIMIT * 6);
    const linksGeometry = new THREE.BufferGeometry();
    linksGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.linkPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.links = new THREE.LineSegments(
      linksGeometry,
      new THREE.LineBasicMaterial({
        color: '#a7dabe',
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    this.links.frustumCulled = false;
    this.group.add(this.links);
    this.arrows = {};
    for (const [key, color] of Object.entries({
      cohesion: '#7eddb7',
      alignment: '#eacb7d',
      separation: '#f4938c',
      velocity: '#8bbefa',
    })) {
      const arrow = new THREE.ArrowHelper(UP, this.origin, 1, color, 0.5, 0.28);
      arrow.line.material.depthTest = false;
      arrow.cone.material.depthTest = false;
      arrow.renderOrder = 5;
      this.group.add(arrow);
      this.arrows[key] = arrow;
    }
  }

  update(simulation, renderedPositions) {
    this.group.visible = simulation.settings.inspect;
    if (!this.group.visible) return;
    const info = simulation.inspection;
    const p = info.index * 3;
    this.group.position.fromArray(renderedPositions, p);
    this.radius.scale.setScalar(simulation.settings.perception);
    this.updateFieldOfView(simulation.settings.perception, simulation.settings.fieldOfView);
    this.direction.fromArray(info.velocity);
    if (this.direction.lengthSq() > 1e-8)
      this.fov.quaternion.setFromUnitVectors(UP, this.direction.normalize());
    const count = Math.min(info.neighborCount, LINK_LIMIT);
    for (let i = 0; i < count; i++) {
      const q = info.neighbors[i] * 3,
        offset = i * 6;
      for (let axis = 0; axis < 3; axis++) {
        this.linkPositions[offset + axis] = 0;
        this.linkPositions[offset + 3 + axis] =
          renderedPositions[q + axis] - renderedPositions[p + axis];
      }
    }
    this.links.geometry.attributes.position.needsUpdate = true;
    this.links.geometry.setDrawRange(0, count * 2);
    for (const [key, arrow] of Object.entries(this.arrows)) {
      this.direction.fromArray(info[key]);
      const magnitude = this.direction.length();
      arrow.visible = magnitude > 1e-6;
      if (!arrow.visible) continue;
      arrow.setDirection(this.direction.normalize());
      // Display scale is intentionally bounded; numeric magnitudes remain available in the panel.
      const length =
        key === 'velocity' ? Math.min(7, magnitude * 0.45) : Math.min(8, magnitude * 0.45);
      arrow.setLength(
        Math.max(0.12, length),
        Math.min(0.5, length * 0.3),
        Math.min(0.28, length * 0.2),
      );
    }
  }

  updateFieldOfView(radius, degrees) {
    this.fov.visible = degrees < 360;
    if (radius === this.lastRadius && degrees === this.lastDegrees) return;
    this.lastRadius = radius;
    this.lastDegrees = degrees;
    const angle = (degrees * Math.PI) / 360,
      ring = Math.sin(angle) * radius,
      height = Math.cos(angle) * radius;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2,
        b = ((i + 1) / 48) * Math.PI * 2,
        o = i * 12;
      this.fovPoints[o] = Math.cos(a) * ring;
      this.fovPoints[o + 1] = height;
      this.fovPoints[o + 2] = Math.sin(a) * ring;
      this.fovPoints[o + 3] = Math.cos(b) * ring;
      this.fovPoints[o + 4] = height;
      this.fovPoints[o + 5] = Math.sin(b) * ring;
      this.fovPoints[o + 6] = 0;
      this.fovPoints[o + 7] = 0;
      this.fovPoints[o + 8] = 0;
      this.fovPoints[o + 9] = i % 6 === 0 ? Math.cos(a) * ring : 0;
      this.fovPoints[o + 10] = i % 6 === 0 ? height : 0;
      this.fovPoints[o + 11] = i % 6 === 0 ? Math.sin(a) * ring : 0;
    }
    this.fov.geometry.attributes.position.needsUpdate = true;
  }
}
