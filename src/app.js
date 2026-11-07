import { ApplicationController } from './application-controller.js';

const viewport = document.getElementById('viewport');
// Reload remains available after failure cleanup; its lifetime is the document.
document.getElementById('reload-scene').addEventListener('click', () => location.reload());

function showError(error) {
  document.getElementById('loading').hidden = true;
  document.getElementById('error').hidden = false;
  document.getElementById('error-message').textContent =
    location.protocol === 'boids:'
      ? '그래픽 드라이버와 WebGL 2 지원을 확인한 후 다시 불러오세요.'
      : 'Chrome 또는 Edge에서 하드웨어 가속과 WebGL 2 지원을 확인한 후 다시 불러오세요.';
  document.getElementById('engine-status').textContent = 'RENDERER UNAVAILABLE';
  document.getElementById('simulation-status').textContent = 'UNAVAILABLE';
  for (const id of ['settings', 'play-pause', 'restart', 'single-step']) {
    document.getElementById(id).disabled = true;
  }
  console.error(error);
}

try {
  const application = new ApplicationController(viewport, { onError: showError });
  document.getElementById('loading').hidden = true;
  document.getElementById('engine-status').textContent = 'SYSTEM ONLINE';
  viewport.dataset.ready = 'true';
  viewport.dataset.backend = application.simulation.backend;
  application.start();
} catch (error) {
  showError(error);
}
