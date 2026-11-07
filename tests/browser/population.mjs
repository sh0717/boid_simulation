import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { launchBrowser } from './launch-browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.locator('#viewport[data-ready=true]').waitFor();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  await page.locator('#inspect-toggle').click();
  const unlimitedNeighbors = Number(await page.locator('#inspected-neighbors').textContent());
  assert.ok(unlimitedNeighbors > 1, 'the default seeded bird must have neighbors for this test');
  await page.locator('#lab-section summary').click();
  await page.locator('#max-neighbors').fill('1');
  await page.locator('#max-neighbors').press('Enter');
  assert.equal(await page.locator('#max-neighbors').inputValue(), '1');
  assert.equal(await page.locator('#inspected-neighbors').textContent(), '1');
  await page.screenshot({ path: path.join(root, 'artifacts/neighbor-limit.png') });
  await page.locator('#max-neighbors').fill('-1');
  await page.locator('#apply-max-neighbors').click();
  assert.equal(await page.locator('#inspected-neighbors').textContent(), '1');
  await page.locator('#max-neighbors').fill('0');
  await page.locator('#apply-max-neighbors').click();
  assert.equal(
    Number(await page.locator('#inspected-neighbors').textContent()),
    unlimitedNeighbors,
  );
  await page.locator('#inspect-toggle').click();
  await page.locator('#lab-section summary').click();
  await page.locator('#world-settings summary').click();
  for (const axis of ['width', 'height', 'depth']) await page.locator(`#world-${axis}`).fill('500');
  await page.locator('#apply-world').click();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.bounds).width === 500,
  );
  await page.locator('#population-count').fill('10000');
  await page.locator('#population-count').press('Enter');
  await page.waitForFunction(() => document.getElementById('viewport').dataset.count === '10000');
  assert.equal(await page.locator('#count-value').textContent(), '10,000');
  assert.equal(await page.locator('#selected-boid').getAttribute('max'), '10000');
  assert.equal(
    await page.locator('button[data-count="10000"]').getAttribute('aria-pressed'),
    'true',
  );
  await page.screenshot({ path: path.join(root, 'artifacts/population-10000.png') });
  for (const invalid of ['0', '10001', '1.5', '']) {
    await page.locator('#population-count').fill(invalid);
    await page.locator('#apply-population').click();
    assert.equal(await page.locator('#viewport').getAttribute('data-count'), '10000');
    assert.match(await page.locator('#toast').textContent(), /10,000/);
  }
  await page.locator('#trails').uncheck();
  await page.locator('#single-step').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0167');
  await page.locator('#world-width').fill('480');
  await page.locator('#world-height').fill('460');
  await page.locator('#world-depth').fill('440');
  await page.locator('#apply-world').click();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.bounds).width === 480,
  );
  assert.equal(await page.locator('#viewport').getAttribute('data-count'), '10000');
  assert.equal(await page.locator('#viewport').getAttribute('data-time'), '0.0167');
  assert.equal(await page.locator('#viewport').getAttribute('data-paused'), 'true');
  await page.locator('#play-pause').click();
  await page.waitForFunction(
    () => Number(document.getElementById('viewport').dataset.time) > 0.0167,
  );
  await page.locator('#world-width').fill('470');
  await page.locator('#apply-world').click();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.bounds).width === 470,
  );
  assert.equal(await page.locator('#viewport').getAttribute('data-count'), '10000');
  assert.equal(await page.locator('#viewport').getAttribute('data-paused'), 'false');
  await page.locator('#play-pause').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  await page.locator('#population-count').fill('4321');
  await page.locator('#apply-population').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.count === '4321');
  assert.equal(await page.locator('#population-count').inputValue(), '4321');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: nearest-neighbor limit, 10,000 boids, invalid input, single step and paused/running world resize',
  );
} finally {
  await browser.close();
}
