import { chromium } from 'playwright';
import { PerspectiveCamera, Vector3 } from 'three';
import { BoidSimulation } from '../../src/simulation/boids.js';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('../../index.html', import.meta.url).href);
  await page.locator('#viewport[data-ready=true]').waitFor();
  await page.locator('#inspect-toggle').click();
  const bounds = await page.locator('canvas').boundingBox();
  // Project the deterministic initial state, then exercise the actual pointer/raycast path.
  const simulation = new BoidSimulation();
  const camera = new PerspectiveCamera(43, bounds.width / bounds.height, 0.1, 400);
  camera.position.set(69, 48, 75);
  camera.lookAt(0, -2, 0);
  camera.updateMatrixWorld();
  let picked = false;
  for (const index of [17, 32, 71, 107]) {
    const point = new Vector3().fromArray(simulation.positions, index * 3).project(camera);
    await page.mouse.click(
      bounds.x + ((point.x + 1) * bounds.width) / 2,
      bounds.y + ((1 - point.y) * bounds.height) / 2,
    );
    if ((await page.locator('#inspected-id').textContent()) !== '#0001') {
      picked = true;
      break;
    }
  }
  assert.ok(picked, 'clicking a projected Boid must select an instance');
  await page.locator('#inspect-toggle').click();
  const clickWorld = async (x, y, z) => {
    const currentBounds = await page.locator('canvas').boundingBox();
    const point = new Vector3(x, y, z).project(camera);
    await page.mouse.click(
      currentBounds.x + ((point.x + 1) * currentBounds.width) / 2,
      currentBounds.y + ((1 - point.y) * currentBounds.height) / 2,
    );
  };
  await clickWorld(15, 11, -10);
  assert.equal(
    await page.locator('#selected-obstacle').inputValue(),
    '2',
    'sphere click selects its stable ID',
  );
  assert.ok(await page.locator('#selected-obstacle').isVisible());
  await page.locator('#add-box').click();
  await page.waitForFunction(() =>
    JSON.parse(document.getElementById('viewport').dataset.obstacles).some(
      (item) => item.type === 'box',
    ),
  );
  await page.locator('#selected-obstacle').selectOption('1');
  await page.screenshot({
    path: fileURLToPath(new URL('../../artifacts/obstacle-picking.png', import.meta.url)),
  });
  await clickWorld(-12, 0, 0);
  assert.equal(
    await page.locator('#selected-obstacle').inputValue(),
    '3',
    'box click selects its stable ID',
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: canvas raycast selection ${await page.locator('#inspected-id').textContent()}, sphere and box`,
  );
} finally {
  await browser.close();
}
