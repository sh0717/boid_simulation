import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { checkObstacleControls } from './obstacle-controls.mjs';
import { checkPredatorControls } from './predator-controls.mjs';
import { checkGoalControls } from './goal-controls.mjs';
import { checkWorldControls } from './world-controls.mjs';
import { checkBoundaryControls } from './boundary-controls.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  requests = [],
  measurements = [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await page.goto(pathToFileURL(path.join(root, 'yoosh.html')).href);
  await page.locator('#viewport[data-ready=true]').waitFor();
  assert.equal(await page.locator('#viewport').getAttribute('data-backend'), 'cpp17-wasm');
  await page.waitForFunction(() => Number(document.getElementById('viewport').dataset.time) > 5);
  await page.screenshot({ path: path.join(artifacts, 'desktop.png') });
  measurements.push({
    phase: '320 agents, trails on',
    ...(await page.locator('#viewport').evaluate((element) => ({ ...element.dataset }))),
  });
  assert.equal(await page.locator('#cohesion').inputValue(), '0.85');
  assert.equal(await page.locator('#cohesion-value').textContent(), '0.85');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  const pausedTime = await page.locator('#viewport').getAttribute('data-time');
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#viewport').getAttribute('data-time'), pausedTime);
  const idleFrames = await page.locator('#viewport').getAttribute('data-rendered-frames');
  await page.waitForTimeout(650);
  assert.equal(
    await page.locator('#viewport').getAttribute('data-rendered-frames'),
    idleFrames,
    'paused scene must not redraw without an interaction',
  );
  await checkObstacleControls(page, artifacts);
  await checkPredatorControls(page);
  await checkGoalControls(page, artifacts);
  await checkWorldControls(page, artifacts);
  await checkBoundaryControls(page, artifacts);
  await page.getByRole('button', { name: '시뮬레이션 다시 시작', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0000');
  await page.locator('#preset').selectOption('school');
  assert.equal(await page.locator('#cohesion').inputValue(), '1.6');
  assert.equal(await page.locator('#cohesion-value').textContent(), '1.60');
  await page.locator('#separation').fill('2.5');
  assert.equal(await page.locator('#preset').inputValue(), 'custom');
  for (const id of ['goal', 'predator', 'obstacles', 'trails', 'bounds']) {
    const toggle = page.locator(`#${id}`);
    const previous = await toggle.isChecked();
    await toggle.setChecked(!previous);
    assert.equal(await toggle.isChecked(), !previous);
    await toggle.setChecked(previous);
  }
  await page.locator('#predator').check();
  assert.ok(await page.locator('#predator-legend').isVisible());
  await page.locator('#restore').click();
  assert.equal(await page.locator('#cohesion').inputValue(), '0.85');
  assert.equal(await page.locator('#predator').isChecked(), false);
  await page.locator('#lab-section summary').click();
  await page.locator('#seed').fill('7');
  await page.locator('#apply-seed').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.seed === '7');
  const seededState = await page.locator('#viewport').getAttribute('data-position-hash');
  await page.locator('#single-step').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0167');
  await page.locator('#restart').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0000');
  assert.equal(await page.locator('#viewport').getAttribute('data-seed'), '7');
  assert.equal(
    await page.locator('#viewport').getAttribute('data-position-hash'),
    seededState,
    'same seed restart reproduces the complete position buffer',
  );
  console.log('PASS: seeded restart and fixed step');
  await page.locator('#seed').fill('-1');
  await page.locator('#apply-seed').click();
  assert.equal(await page.locator('#viewport').getAttribute('data-seed'), '7');
  await page.locator('#new-seed').click();
  const newSeed = Number(await page.locator('#seed').inputValue());
  assert.ok(Number.isInteger(newSeed) && newSeed >= 0 && newSeed <= 0xffffffff);
  await page.locator('#seed').fill('7');
  await page.locator('#apply-seed').click();
  await page.locator('#perception').fill('14');
  await page.locator('#fieldOfView').fill('180');
  assert.equal(await page.locator('#perception-value').textContent(), '14 u');
  assert.equal(await page.locator('#fieldOfView-value').textContent(), '180°');
  await page.locator('#inspect-toggle').click();
  assert.ok(await page.locator('#inspection-card').isVisible());
  await page.locator('#next-boid').click();
  assert.equal(await page.locator('#inspected-id').textContent(), '#0002');
  await page.locator('#selected-boid').fill('24');
  await page.locator('#selected-boid').press('Tab');
  assert.equal(await page.locator('#inspected-id').textContent(), '#0024');
  await page.locator('#search-type').selectOption('kd-tree');
  await page.locator('#single-step').click();
  await page.waitForFunction(
    () => document.getElementById('viewport').dataset.searchType === 'kd-tree',
  );
  await page.locator('#color-mode').selectOption('density');
  assert.equal(await page.locator('#color-legend-title').textContent(), 'VISIBLE NEIGHBORS');
  await page.locator('#goal-settings summary').click();
  await page.locator('#goalSpeed').fill('0');
  await page.locator('#goalStrength').fill('2');
  assert.equal(await page.locator('#goalSpeed-value').textContent(), '0.00×');
  assert.equal(await page.locator('#goalStrength-value').textContent(), '2.00×');
  await page.locator('#predator-settings summary').click();
  await page.locator('#predatorSpeed').fill('8');
  await page.locator('#predatorRadius').fill('18');
  await page.locator('#predatorStrength').fill('2');
  assert.equal(await page.locator('#predatorSpeed-value').textContent(), '8 u/s');
  assert.equal(await page.locator('#predatorRadius-value').textContent(), '18 u');
  await page.locator('#predator').check();
  await page.locator('#single-step').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0333');
  await page.locator('#lab-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, 'inspector.png') });
  const observedGeometryCount = await page.locator('#viewport').getAttribute('data-geometries');
  for (let i = 0; i < 4; i++) {
    await page.locator('#inspect-toggle').click();
    await page.locator('#inspect-toggle').click();
  }
  await page.waitForTimeout(600);
  assert.equal(
    await page.locator('#viewport').getAttribute('data-geometries'),
    observedGeometryCount,
  );
  await page.locator('#color-mode').selectOption('natural');
  assert.equal(await page.locator('#color-legend').isVisible(), false);
  await page.locator('#goalPath').uncheck();
  await page.locator('#goalPath').check();
  await page.locator('#restore').click();
  assert.equal(await page.locator('#goalSpeed').inputValue(), '1');
  assert.equal(await page.locator('#predatorSpeed').inputValue(), '14');
  assert.equal(await page.locator('#seed').inputValue(), '22823');
  assert.equal(await page.locator('#search-type').inputValue(), 'grid');
  await page.locator('#goal-settings summary').click();
  await page.locator('#predator-settings summary').click();
  await page.locator('#lab-section summary').click();
  await page.getByRole('button', { name: '카메라 자동 회전', exact: true }).click();
  assert.equal(await page.locator('#auto-rotate').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '카메라 초기화', exact: true }).click();
  assert.equal(await page.locator('#auto-rotate').getAttribute('aria-pressed'), 'false');
  await page.locator('#help-open').click();
  assert.ok(await page.locator('#help-dialog').isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#help-dialog').isVisible(), false);
  // Count changes reuse the same GPU allocation; compare before/after repeated resets.
  const geometries = await page.locator('#viewport').getAttribute('data-geometries');
  for (const count of [1200, 160, 640, 320, 1200])
    await page.locator(`button[data-count="${count}"]`).click();
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.getElementById('viewport').dataset.count === '1200' &&
      Number(document.getElementById('viewport').dataset.time) > 4,
  );
  assert.equal(await page.locator('#viewport').getAttribute('data-geometries'), geometries);
  measurements.push({
    phase: '1200 agents, trails on',
    ...(await page.locator('#viewport').evaluate((element) => ({ ...element.dataset }))),
  });
  await page.screenshot({ path: path.join(artifacts, 'population-1200.png') });
  await page.locator('#trails').uncheck();
  await page.waitForTimeout(1100);
  measurements.push({
    phase: '1200 agents, trails off',
    ...(await page.locator('#viewport').evaluate((element) => ({ ...element.dataset }))),
  });
  await page.locator('#lab-section summary').click();
  await page.locator('#search-type').selectOption('kd-tree');
  await page.waitForTimeout(1500);
  measurements.push({
    phase: '1200 agents, kd-tree, trails off',
    ...(await page.locator('#viewport').evaluate((element) => ({ ...element.dataset }))),
  });
  await page.locator('#search-type').selectOption('grid');
  await page.locator('#lab-section summary').click();
  // Mouse camera interaction must visibly change the rendered image.
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const beforeOrbit = digest(await page.locator('canvas').screenshot());
  await page.mouse.move(550, 440);
  await page.mouse.down();
  await page.mouse.move(670, 480, { steps: 10 });
  await page.mouse.up();
  const afterOrbit = digest(await page.locator('canvas').screenshot());
  assert.notEqual(beforeOrbit, afterOrbit);
  // Keyboard shortcuts act only outside form controls.
  await page.locator('body').click({ position: { x: 650, y: 750 } });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'false');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  await page.locator('#restore').click();
  console.log('PASS: desktop controls, inspector, actors, search strategies');
  await page.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await mobile.locator('#viewport[data-ready=true]').waitFor();
  await mobile.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await checkObstacleControls(mobile, artifacts, true);
  await checkGoalControls(mobile, artifacts, true);
  await checkWorldControls(mobile, artifacts, true);
  await checkBoundaryControls(mobile, artifacts, true);
  await mobile.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
  await mobile.locator('button[data-count="640"]').click();
  assert.equal(await mobile.locator('#count-value').textContent(), '640');
  await mobile.locator('#lab-section summary').click();
  await mobile.locator('#perception').fill('12');
  await mobile.locator('#inspect').check();
  await mobile.locator('#selected-boid').fill('4');
  await mobile.locator('#selected-boid').press('Tab');
  assert.equal(await mobile.locator('#inspected-id').textContent(), '#0004');
  await mobile.locator('#single-step').click();
  await mobile.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0167');
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await mobile.screenshot({ path: path.join(artifacts, 'mobile-inspector.png'), fullPage: true });
  await mobile.locator('#help-open').click();
  assert.ok(await mobile.locator('#help-dialog').isVisible());
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], 'the built app must not fetch external runtime assets');
  const result = {
    browser: browser.version(),
    viewport: '1440×1000 @ 1× DPR; headless Chrome on this host',
    errors,
    externalRequests: requests.length,
    measurements,
    checks: [
      'offline file launch for both HTML entries',
      'play/pause/restart',
      'paused idle scene does not redraw',
      'preset and slider synchronization',
      'all toggles',
      'camera reset and auto rotation',
      'camera drag',
      'help and Escape',
      'population changes without geometry growth',
      'keyboard shortcuts',
      '390px mobile overflow and controls',
      'reduced motion starts paused',
      'same custom seed reproduces complete position buffer',
      'single fixed step',
      'seed validation and new layout',
      'perception and field of view',
      'inspection selection and resource reuse',
      'color modes and legend',
      'goal/predator parameters',
      'kd-tree live switch',
      'mobile inspector and single step',
    ],
  };
  result.checks.push(
    'desktop/mobile sphere and box editor',
    'position and size apply including Enter',
    'paused and running edits preserve playback state',
    'blank size and overlapping layout rejection',
    'obstacle geometry reuse and deletion cleanup',
    'obstacle and global layout restoration',
  );
  result.checks.push(
    'predator motion and speed-zero freeze/resume',
    'predator paused interpolation and heading',
    'predator disabled motion, restart and single step',
  );
  result.checks.push(
    'goal phase interpolation and pause/reset',
    'goal disabled and zero-speed freeze/resume',
    'goal path visibility, legend and direction arrow',
    'goal desktop/mobile controls and resource reuse',
  );
  result.checks.push(
    'desktop/mobile rectangular map resize via Apply and Enter',
    'map resize preserves time and playback',
    'invalid or obstructed shrink is atomic',
    'map guide/camera/goal fit and GPU resource reuse',
    'restart/population retain map and full restore resets it',
  );
  result.checks.push(
    'desktop/mobile hard, soft and hybrid boundary modes',
    'margin/strength controls and hard-mode disabled state',
    'soft shrink preserves positions with outside telemetry',
    'hard transition reconciles immediately without restart',
    'mode switches preserve playback and restart/restore contracts',
  );
  await writeFile(path.join(artifacts, 'browser-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
