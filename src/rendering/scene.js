import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MAX_BOIDS, OBSTACLE_CLEARANCE, WORLD } from '../config.js';
import { seededRandom } from '../simulation/boids.js';
import { BoidInspector } from './inspector.js';
import { PredatorPose } from './predator-pose.js';
import { GoalVisual } from './goal-visual.js';

const TRAIL_LENGTH = 12;
const UP = new THREE.Vector3(0, 1, 0);

function releaseAll(actions) {
  let failed = false;
  let firstError;
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}

function createWingGeometry() {
  // An origami dart points along +Y. One shared geometry for the whole flock.
  const vertices = new Float32Array([
    0, 1.15, 0, -0.72, -0.68, 0.12, 0, -0.22, 0.28, 0, 1.15, 0, 0, -0.22, 0.28, 0.72, -0.68, 0.12,
    0, 1.15, 0, 0, -0.62, -0.16, -0.72, -0.68, 0.12, 0, 1.15, 0, 0.72, -0.68, 0.12, 0, -0.62, -0.16,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function obstacleLabel(number) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(8, 22, 25, 0.9)';
  context.fillRect(0, 0, 128, 48);
  context.strokeStyle = '#bda57d';
  context.strokeRect(1, 1, 126, 46);
  context.font = '22px Consolas, monospace';
  context.fillStyle = '#e5d4aa';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`OBS ${String(number).padStart(2, '0')}`, 64, 25);
  return new THREE.CanvasTexture(canvas);
}

/** Owns all GPU resources; simulation data is read-only here. */
export class BoidScene {
  constructor(
    container,
    settings,
    {
      createRenderer = (options) => new THREE.WebGLRenderer(options),
      createControls = (camera, element) => new OrbitControls(camera, element),
      createResizeObserver = (callback) => new ResizeObserver(callback),
    } = {},
  ) {
    this.container = container;
    this.settings = settings;
    this.disposed = false;
    try {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color('#071315');
      this.scene.fog = new THREE.FogExp2('#071315', 0.0065);
      this.camera = new THREE.PerspectiveCamera(43, 1, 0.1, 400);
      this.camera.position.set(69, 48, 75);
      this.renderer = createRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.35;
      this.renderer.domElement.setAttribute(
        'aria-label',
        '3D 군집 시뮬레이션. 드래그하여 회전, 휠로 확대합니다.',
      );
      this.renderer.domElement.setAttribute('role', 'img');
      container.prepend(this.renderer.domElement);
      this.controls = createControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.target.set(0, -2, 0);
      this.controls.minDistance = 45;
      this.controls.maxDistance = 170;
      this.controls.maxPolarAngle = Math.PI * 0.84;
      this.controls.autoRotateSpeed = 0.32;
      this.controls.saveState();
      this.needsRender = true;
      this.onCameraChange = () => {
        this.needsRender = true;
      };
      this.controls.addEventListener('change', this.onCameraChange);
      this.renderedFrames = 0;
      this.transform = new THREE.Object3D();
      this.direction = new THREE.Vector3();
      this.texture = glowTexture();
      this.trailHistory = new Float32Array(MAX_BOIDS * TRAIL_LENGTH * 3);
      this.trailHead = 0;
      this.trailTick = 0;
      this.createEnvironment();
      this.createFlock();
      this.createActors();
      this.predatorPose = new PredatorPose();
      this.inspector = new BoidInspector(this.scene);
      this.raycaster = new THREE.Raycaster();
      this.pointer = new THREE.Vector2();
      this.color = new THREE.Color();
      this.palette = { speed: [], density: [] };
      for (const [mode, stops] of Object.entries({
        speed: ['#5b92b5', '#93eacb', '#f3c97d'],
        density: ['#477e96', '#a3e2c3', '#f69b84'],
      })) {
        const colors = stops.map((value) => new THREE.Color(value));
        for (let i = 0; i < 128; i++) {
          const value = i / 127;
          this.palette[mode].push(
            new THREE.Color().lerpColors(
              colors[value < 0.5 ? 0 : 1],
              colors[value < 0.5 ? 1 : 2],
              value < 0.5 ? value * 2 : value * 2 - 1,
            ),
          );
        }
      }
      this.lastColorTime = -Infinity;
      this.resizeObserver = createResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
      this.resize();
    } catch (error) {
      try {
        this.dispose();
      } catch {
        // Preserve the construction error after attempting all cleanup actions.
      }
      throw error;
    }
  }

  createEnvironment() {
    this.scene.add(new THREE.HemisphereLight('#baf6ed', '#17252d', 2.3));
    const key = new THREE.DirectionalLight('#ccfff3', 3);
    key.position.set(15, 35, 20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#397eb5', 2);
    rim.position.set(-20, 5, -30);
    this.scene.add(rim);
    this.environment = new THREE.Group();
    this.scene.add(this.environment);
    const grid = new THREE.GridHelper(80, 32, '#214b47', '#163331');
    grid.position.y = -25.3;
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    this.environment.add(grid);
    const box = new THREE.BoxGeometry(50, 50, 50);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const bounds = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: '#4c978b', transparent: true, opacity: 0.17 }),
    );
    this.environment.add(bounds);
    for (const radius of [12.5, 25, 36]) {
      const points = Array.from(
        { length: 129 },
        (_, i) =>
          new THREE.Vector3(
            Math.cos((i / 128) * Math.PI * 2) * radius,
            -25.2,
            Math.sin((i / 128) * Math.PI * 2) * radius,
          ),
      );
      this.environment.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: '#4ba692', transparent: true, opacity: 0.15 }),
        ),
      );
    }
    const corners = [];
    for (const x of [-25, 25])
      for (const y of [-25, 25])
        for (const z of [-25, 25]) {
          corners.push(
            x,
            y,
            z,
            x - Math.sign(x) * 3,
            y,
            z,
            x,
            y,
            z,
            x,
            y - Math.sign(y) * 3,
            z,
            x,
            y,
            z,
            x,
            y,
            z - Math.sign(z) * 3,
          );
        }
    const cornerGeometry = new THREE.BufferGeometry();
    cornerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    this.environment.add(
      new THREE.LineSegments(
        cornerGeometry,
        new THREE.LineBasicMaterial({ color: '#78b8a9', transparent: true, opacity: 0.5 }),
      ),
    );
    const random = seededRandom(17),
      stars = new Float32Array(160 * 3);
    for (let i = 0; i < stars.length; i++) stars[i] = (random() - 0.5) * 200;
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.scene.add(
      new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
          color: '#60938b',
          size: 0.13,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        }),
      ),
    );
  }

  createFlock() {
    this.flock = new THREE.InstancedMesh(
      createWingGeometry(),
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.42,
        metalness: 0.32,
        emissive: '#2ba88b',
        emissiveIntensity: 0.45,
        side: THREE.DoubleSide,
      }),
      MAX_BOIDS,
    );
    this.flock.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flock.frustumCulled = false;
    const color = new THREE.Color();
    for (let i = 0; i < MAX_BOIDS; i++) {
      color.setHSL(0.39 + ((i % 17) / 17) * 0.13, 0.5, 0.53 + (i % 5) * 0.06);
      this.flock.setColorAt(i, color);
    }
    this.flock.instanceColor.needsUpdate = true;
    this.scene.add(this.flock);
    const trailGeometry = new THREE.BufferGeometry();
    this.trailVertices = new Float32Array(MAX_BOIDS * (TRAIL_LENGTH - 1) * 6);
    const colors = new Float32Array(this.trailVertices.length);
    for (let i = 0; i < MAX_BOIDS; i++)
      for (let segment = 0; segment < TRAIL_LENGTH - 1; segment++) {
        const fade = (1 - segment / (TRAIL_LENGTH - 1)) ** 1.8;
        const offset = (i * (TRAIL_LENGTH - 1) + segment) * 6;
        for (let end = 0; end < 2; end++) {
          colors[offset + end * 3] = 0.12 * fade;
          colors[offset + end * 3 + 1] = 0.58 * fade;
          colors[offset + end * 3 + 2] = 0.42 * fade;
        }
      }
    trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailVertices, 3).setUsage(THREE.DynamicDrawUsage),
    );
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.trails = new THREE.LineSegments(
      trailGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.trails.frustumCulled = false;
    this.scene.add(this.trails);
    this.glowPositions = new Float32Array(MAX_BOIDS * 3);
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.glowPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.glow = new THREE.Points(
      glowGeometry,
      new THREE.PointsMaterial({
        map: this.texture,
        color: '#57ffcf',
        size: 2.8,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.frustumCulled = false;
    this.scene.add(this.glow);
  }

  createActors() {
    this.obstacleGroup = new THREE.Group();
    this.obstacleMeshes = new Map();
    this.scene.add(this.obstacleGroup);
    this.createGoalAndPredator();
  }

  syncObstacles(simulation) {
    if (this.lastObstacleRevision === simulation.obstacleRevision) return;
    const items = new Map(simulation.obstacles.map((obstacle) => [obstacle.id, obstacle]));
    for (const [id, group] of this.obstacleMeshes) {
      if (items.get(id)?.type === group.userData.type) continue;
      group.traverse((object) => {
        object.geometry?.dispose();
        if (object.material) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      this.obstacleGroup.remove(group);
      this.obstacleMeshes.delete(id);
    }
    for (const obstacle of simulation.obstacles) {
      let group = this.obstacleMeshes.get(obstacle.id);
      const box = obstacle.type === 'box';
      if (!group) {
        group = new THREE.Group();
        group.userData.type = obstacle.type;
        const geometry = box ? new THREE.BoxGeometry(1, 1, 1) : new THREE.IcosahedronGeometry(1, 2);
        const body = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: box ? '#787060' : '#506d78',
            roughness: 0.57,
            metalness: 0.25,
            emissive: '#173942',
            emissiveIntensity: 0.3,
            flatShading: true,
          }),
        );
        body.userData.obstacleId = obstacle.id;
        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: '#b4d5d0', transparent: true, opacity: 0.44 }),
        );
        group.add(body, wire);
        const haloMaterial = new THREE.LineBasicMaterial({
          color: '#e4ba79',
          transparent: true,
          opacity: 0.7,
        });
        if (box) group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), haloMaterial));
        else {
          const points = [];
          for (let i = 0; i <= 96; i++) {
            const angle = (i / 96) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
          }
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), haloMaterial));
        }
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: obstacleLabel(obstacle.id),
            transparent: true,
            depthTest: false,
            depthWrite: false,
          }),
        );
        label.scale.set(6, 2.25, 1);
        group.add(label);
        this.obstacleGroup.add(group);
        this.obstacleMeshes.set(obstacle.id, group);
      }
      const [body, wire, halo, label] = group.children;
      if (box) {
        body.scale.set(obstacle.width, obstacle.height, obstacle.depth);
        halo.scale.set(
          obstacle.width + 2 * OBSTACLE_CLEARANCE,
          obstacle.height + 2 * OBSTACLE_CLEARANCE,
          obstacle.depth + 2 * OBSTACLE_CLEARANCE,
        );
      } else {
        body.scale.setScalar(obstacle.radius);
        halo.scale.setScalar(obstacle.radius + OBSTACLE_CLEARANCE);
      }
      wire.scale.copy(body.scale).multiplyScalar(1.006);
      label.position.y = (box ? obstacle.height / 2 : obstacle.radius) + 2.3;
      group.position.set(obstacle.x, obstacle.y, obstacle.z);
    }
    this.lastObstacleRevision = simulation.obstacleRevision;
    this.highlightObstacle();
    this.needsRender = true;
  }

  selectObstacle(id) {
    this.selectedObstacleId = id;
    this.highlightObstacle();
    this.needsRender = true;
  }

  highlightObstacle() {
    for (const [id, group] of this.obstacleMeshes) {
      const selected = id === this.selectedObstacleId;
      group.children[0].material.emissive.set(selected ? '#896022' : '#173942');
      group.children[1].material.color.set(selected ? '#ffe0a1' : '#b4d5d0');
      group.children[1].material.opacity = selected ? 0.85 : 0.44;
    }
  }

  createGoalAndPredator() {
    this.goalVisual = new GoalVisual(this.texture);
    this.goal = this.goalVisual.goal;
    this.goalPath = this.goalVisual.path;
    this.scene.add(this.goal, this.goalPath);
    this.predator = new THREE.Mesh(
      createWingGeometry(),
      new THREE.MeshStandardMaterial({
        color: '#ff897f',
        emissive: '#d74b3e',
        emissiveIntensity: 0.8,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    this.predator.scale.setScalar(2.5);
    this.scene.add(this.predator);
    const dangerSphere = new THREE.SphereGeometry(1, 20, 12);
    this.predatorRange = new THREE.LineSegments(
      new THREE.WireframeGeometry(dangerSphere),
      new THREE.LineBasicMaterial({
        color: '#ff8c7a',
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    dangerSphere.dispose();
    this.scene.add(this.predatorRange);
  }

  resetTrails(simulation) {
    this.needsRender = true;
    this.lastColorTime = -Infinity;
    this.trailHead = 0;
    this.trailTick = 0;
    for (let i = 0; i < simulation.count; i++)
      for (let j = 0; j < TRAIL_LENGTH; j++) {
        const p = i * 3,
          t = (i * TRAIL_LENGTH + j) * 3;
        this.trailHistory[t] = simulation.positions[p];
        this.trailHistory[t + 1] = simulation.positions[p + 1];
        this.trailHistory[t + 2] = simulation.positions[p + 2];
      }
  }

  sampleTrails(simulation) {
    if (++this.trailTick % 3) return;
    this.trailHead = (this.trailHead + 1) % TRAIL_LENGTH;
    for (let i = 0; i < simulation.count; i++) {
      const p = i * 3,
        t = (i * TRAIL_LENGTH + this.trailHead) * 3;
      this.trailHistory[t] = simulation.positions[p];
      this.trailHistory[t + 1] = simulation.positions[p + 1];
      this.trailHistory[t + 2] = simulation.positions[p + 2];
    }
  }

  render(simulation, alpha, elapsed) {
    this.syncWorld(simulation);
    this.syncObstacles(simulation);
    const { positions, previousPositions, velocities, count, settings } = simulation;
    this.controls.autoRotate = settings.autoRotate;
    this.controls.update(Math.min(elapsed, 0.1));
    const displayFlags =
      Number(settings.trails) |
      (Number(settings.bounds) << 1) |
      (Number(settings.obstacles) << 2) |
      (Number(settings.goal) << 3) |
      (Number(settings.predator) << 4) |
      (Number(settings.goalPath) << 5) |
      (Number(settings.inspect) << 6);
    const inspectionChanged =
      settings.inspect && this.lastInspectionVersion !== simulation.inspection.version;
    if (
      !this.needsRender &&
      !inspectionChanged &&
      this.lastColorMode === settings.colorMode &&
      this.lastRenderedTime === simulation.time &&
      this.lastAlpha === alpha &&
      this.lastCount === count &&
      this.lastDisplayFlags === displayFlags
    )
      return false;
    this.updateColors(simulation);
    this.flock.count = count;
    for (let i = 0; i < count; i++) {
      const p = i * 3;
      this.transform.position.set(
        THREE.MathUtils.lerp(previousPositions[p], positions[p], alpha),
        THREE.MathUtils.lerp(previousPositions[p + 1], positions[p + 1], alpha),
        THREE.MathUtils.lerp(previousPositions[p + 2], positions[p + 2], alpha),
      );
      this.direction.set(velocities[p], velocities[p + 1], velocities[p + 2]);
      if (this.direction.lengthSq() > 1e-8)
        this.transform.quaternion.setFromUnitVectors(UP, this.direction.normalize());
      this.transform.scale.setScalar(0.65 + (i % 7) * 0.035);
      this.transform.updateMatrix();
      this.flock.setMatrixAt(i, this.transform.matrix);
      this.transform.position.toArray(this.glowPositions, p);
      if (!settings.trails) continue;
      for (let segment = 0; segment < TRAIL_LENGTH - 1; segment++) {
        const offset = (i * (TRAIL_LENGTH - 1) + segment) * 6;
        for (let end = 0; end < 2; end++) {
          const index = (this.trailHead - segment - end + TRAIL_LENGTH) % TRAIL_LENGTH;
          const t = (i * TRAIL_LENGTH + index) * 3;
          for (let axis = 0; axis < 3; axis++)
            this.trailVertices[offset + end * 3 + axis] =
              segment === 0 && end === 0
                ? this.glowPositions[p + axis]
                : this.trailHistory[t + axis];
        }
      }
    }
    this.flock.instanceMatrix.needsUpdate = true;
    this.glow.geometry.attributes.position.needsUpdate = true;
    this.glow.geometry.setDrawRange(0, count);
    this.trails.visible = settings.trails;
    if (settings.trails) {
      this.trails.geometry.attributes.position.needsUpdate = true;
      this.trails.geometry.setDrawRange(0, count * (TRAIL_LENGTH - 1) * 2);
    }
    this.environment.visible = settings.bounds;
    this.obstacleGroup.visible = settings.obstacles;
    this.goalVisual.update(simulation, alpha);
    this.predator.visible = settings.predator;
    this.predatorPose.apply(this.predator, simulation, alpha);
    this.predatorRange.visible = settings.predator && settings.inspect;
    this.predatorRange.position.copy(this.predator.position);
    this.predatorRange.scale.setScalar(settings.predatorRadius);
    this.inspector.update(simulation, this.glowPositions);
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
    this.lastRenderedTime = simulation.time;
    this.lastAlpha = alpha;
    this.lastCount = count;
    this.lastDisplayFlags = displayFlags;
    this.lastInspectionVersion = simulation.inspection.version;
    this.renderedFrames++;
    return true;
  }

  resize() {
    this.needsRender = true;
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.fov = width / Math.max(1, height) < 0.8 ? 60 : 43;
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
  }

  syncWorld(simulation) {
    if (this.lastBoundsRevision === simulation.boundsRevision) return;
    const { width, height, depth } = simulation.bounds;
    this.environment.scale.set(width / 50, height / 50, depth / 50);
    let scale = Math.max(width, height, depth) / 50;
    // A Soft shrink leaves actors outside the smaller guide. Include their current
    // extents when fitting once, rather than zooming through the existing flock.
    if (simulation.settings.boundaryMode === 'soft') {
      for (let p = 0; p < simulation.count * 3; p++)
        scale = Math.max(scale, Math.abs(simulation.positions[p]) / 25);
      if (simulation.settings.predator)
        for (const position of simulation.predator)
          scale = Math.max(scale, Math.abs(position) / 25);
    }
    const ratio = scale / (this.viewScale ?? 1);
    this.camera.position.multiplyScalar(ratio);
    this.controls.target.multiplyScalar(ratio);
    this.controls.minDistance = 45 * scale;
    this.controls.maxDistance = 170 * scale;
    this.controls.position0.set(69 * scale, 48 * scale, 75 * scale);
    this.controls.target0.set(0, -2 * scale, 0);
    this.camera.far = 400 * scale;
    this.camera.updateProjectionMatrix();
    this.scene.fog.density = 0.0065 / scale;
    this.viewScale = scale;
    this.lastBoundsRevision = simulation.boundsRevision;
    this.needsRender = true;
  }

  resetCamera() {
    this.controls.reset();
  }

  updateColors(simulation) {
    const mode = simulation.settings.colorMode;
    if (
      mode === this.lastColorMode &&
      simulation.count === this.lastColorCount &&
      Math.abs(simulation.time - this.lastColorTime) < 0.1
    )
      return;
    for (let i = 0; i < simulation.count; i++) {
      if (mode === 'natural')
        this.color.setHSL(0.39 + ((i % 17) / 17) * 0.13, 0.5, 0.53 + (i % 5) * 0.06);
      else {
        const p = i * 3;
        const ratio =
          mode === 'density'
            ? simulation.neighborCounts[i] / 64
            : (Math.hypot(
                simulation.velocities[p],
                simulation.velocities[p + 1],
                simulation.velocities[p + 2],
              ) -
                WORLD.minSpeed) /
              (WORLD.maxSpeed - WORLD.minSpeed);
        this.color.copy(this.palette[mode][Math.max(0, Math.min(127, Math.round(ratio * 127)))]);
      }
      this.flock.setColorAt(i, this.color);
    }
    this.flock.instanceColor.needsUpdate = true;
    this.lastColorMode = mode;
    this.lastColorTime = simulation.time;
    this.lastColorCount = simulation.count;
  }

  pickBoid(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // InstancedMesh raycasting uses its bounding sphere even with frustum culling disabled.
    this.flock.computeBoundingSphere();
    return this.raycaster.intersectObject(this.flock, false)[0]?.instanceId ?? null;
  }

  pickObstacle(clientX, clientY) {
    if (!this.settings.obstacles) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const bodies = Array.from(this.obstacleMeshes.values(), (group) => group.children[0]);
    return this.raycaster.intersectObjects(bodies, false)[0]?.object.userData.obstacleId ?? null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set(),
      materials = new Set(),
      textures = new Set(this.texture ? [this.texture] : []),
      instances = new Set();
    releaseAll([
      () => this.resizeObserver?.disconnect(),
      () => this.controls?.removeEventListener('change', this.onCameraChange),
      () => this.controls?.dispose(),
      () => {
        this.scene?.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry);
          if (object.material)
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material])
              materials.add(material);
          if (object.isInstancedMesh) instances.add(object);
        });
        for (const material of materials)
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      },
      () => releaseAll(Array.from(instances, (instance) => () => instance.dispose())),
      () => releaseAll(Array.from(geometries, (geometry) => () => geometry.dispose())),
      () => releaseAll(Array.from(materials, (material) => () => material.dispose())),
      () => releaseAll(Array.from(textures, (texture) => () => texture.dispose())),
      () => this.renderer?.dispose(),
      () => this.renderer?.domElement.remove(),
    ]);
  }
}
