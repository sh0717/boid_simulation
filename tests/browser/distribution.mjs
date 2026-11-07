import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { launchBrowser } from './launch-browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = createRequire(import.meta.url)('../../desktop/config.cjs');
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Outside project');
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': config.csp,
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const errors = [],
  external = [],
  checks = [];
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !url.startsWith(`${base}/`)) {
      external.push(url);
      await route.abort();
    } else await route.continue();
  });
  for (const entry of [
    'dist/index.html',
    ...(config.scheme === 'pbd'
      ? ['index.html', 'pbd_model.html']
      : config.scheme === 'boids'
        ? ['index.html', 'yoosh.html']
        : ['SPH-Fluid-Lab.html']),
  ]) {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${base}/${entry}`);
    await page.waitForFunction(
      (scheme) =>
        scheme === 'pbd'
          ? Boolean(window.softLab)
          : scheme === 'sph'
            ? window.sphApp?.getState().ready
            : document.getElementById('viewport')?.dataset.ready === 'true',
      config.scheme,
      { timeout: 60000 },
    );
    assert.ok((await page.locator('canvas').count()) > 0, `${entry}: WebGL canvas`);
    if (config.scheme === 'pbd') {
      await page.evaluate(() => {
        window.softLab.setRunning(false);
        window.softLab.world.step();
      });
      assert.ok(
        await page.evaluate(() =>
          window.softLab.world.bodies.every((body) =>
            Array.from(body.positions).every(Number.isFinite),
          ),
        ),
      );
    } else if (config.scheme === 'sph') {
      const before = await page.evaluate(() => window.sphApp.getState().snapshot.step_index);
      await page.evaluate(() => window.sphApp.advanceSteps(1));
      assert.equal(
        await page.evaluate(() => window.sphApp.getState().snapshot.step_index),
        before + 1,
      );
    } else assert.equal(await page.locator('#viewport').getAttribute('data-backend'), 'cpp17-wasm');
    checks.push(`${entry}: initialized and exercised under desktop CSP`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await writeFile(
    path.join(root, 'artifacts/distribution-results.json'),
    JSON.stringify({ passed: true, checks, errors, external }, null, 2) + '\n',
  );
  console.log(
    `PASS: ${checks.length} offline distribution/compatibility entries under desktop CSP`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
