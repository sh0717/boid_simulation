const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

// Publishes a read-only snapshot for browser QA. The caller borrows positionBits
// from this simulation's fixed Wasm memory and must stop publishing before disposal.
export function publishDiagnostics(viewport, simulation, scene, positionBits, metrics) {
  const { paused, stepMs, fps, selectedIndex, selectedObstacleId } = metrics;
  // A DOM-visible, read-only diagnostic snapshot also supports repeatable browser QA.
  viewport.dataset.time = simulation.time.toFixed(4);
  viewport.dataset.count = simulation.count;
  viewport.dataset.drawCalls = scene.renderer.info.render.calls;
  viewport.dataset.geometries = scene.renderer.info.memory.geometries;
  viewport.dataset.textures = scene.renderer.info.memory.textures;
  viewport.dataset.neighborChecks = simulation.metrics.neighborChecks;
  viewport.dataset.paused = String(paused);
  viewport.dataset.stepMs = stepMs.toFixed(3);
  viewport.dataset.fps = fps.toFixed(1);
  viewport.dataset.renderedFrames = scene.renderedFrames;
  viewport.dataset.seed = simulation.seed;
  viewport.dataset.selected = selectedIndex;
  viewport.dataset.inspection = String(simulation.settings.inspect);
  viewport.dataset.colorMode = simulation.settings.colorMode;
  viewport.dataset.perception = simulation.settings.perception;
  viewport.dataset.fieldOfView = simulation.settings.fieldOfView;
  viewport.dataset.searchType = simulation.settings.searchType;
  viewport.dataset.obstacles = JSON.stringify(simulation.obstacles);
  viewport.dataset.obstacleRevision = simulation.obstacleRevision;
  viewport.dataset.selectedObstacle = selectedObstacleId ?? '';
  viewport.dataset.bounds = JSON.stringify(simulation.bounds);
  viewport.dataset.boundsRevision = simulation.boundsRevision;
  viewport.dataset.boundary = JSON.stringify({
    mode: simulation.settings.boundaryMode,
    margin: simulation.settings.boundaryMargin,
    strength: simulation.settings.boundaryStrength,
    outsideCount: simulation.metrics.outsideCount,
    maxExcursion: simulation.metrics.maxExcursion,
  });
  viewport.dataset.worldScale = JSON.stringify(scene.environment.scale.toArray());
  viewport.dataset.predator = JSON.stringify({
    position: [...simulation.predator],
    previous: [...simulation.previousPredator],
    velocity: [...simulation.predatorVelocity],
    rendered: scene.predator.position.toArray(),
    heading: scene.predator.quaternion.toArray(),
  });
  viewport.dataset.goal = JSON.stringify({
    time: simulation.goalTime,
    previousTime: simulation.previousGoalTime,
    advance: simulation.goalAdvance,
    alpha: scene.lastAlpha,
    position: [...simulation.goal],
    rendered: scene.goal.position.toArray(),
    visible: scene.goal.visible,
    pathVisible: scene.goalPath.visible,
    arrowVisible: scene.goal.visible && scene.goalVisual.arrow.visible,
    rotation: scene.goalVisual.body.rotation.y,
    ringScale: scene.goalVisual.ring.scale.x,
  });
  let positionHash = FNV_OFFSET_BASIS;
  for (let i = 0; i < simulation.count * 3; i++)
    positionHash = Math.imul(positionHash ^ positionBits[i], FNV_PRIME);
  viewport.dataset.positionHash = (positionHash >>> 0).toString(16);
}
