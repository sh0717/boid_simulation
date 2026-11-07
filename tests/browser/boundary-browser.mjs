// Focused UI regression after boundary presentation changes; build the web bundle first.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { checkBoundaryControls } from './boundary-controls.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(new URL('../../index.html', import.meta.url).href);
    await page.locator('#viewport[data-ready=true][data-paused=true]').waitFor();
    await checkBoundaryControls(
      page,
      fileURLToPath(new URL('../../artifacts/', import.meta.url)),
      mobile,
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('../../artifacts/boundary-browser-results.json', import.meta.url),
    JSON.stringify(
      { browser: browser.version(), passed: true, errors, viewports: ['1440x1000', '390x844'] },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
