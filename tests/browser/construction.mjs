import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launchBrowser } from './launch-browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const markup = (await readFile(new URL('../../index.html', import.meta.url), 'utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/gi, '');
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ['tests/browser/construction-probe.js'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'chrome110',
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(markup);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(() => window.runConstructionProbe());
  assert.equal(results.length, 4);
  assert.deepEqual(errors, []);
  await mkdir(new URL('../../artifacts/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../../artifacts/construction-results.json', import.meta.url),
    JSON.stringify({ passed: true, browser: await browser.version(), results }, null, 2) + '\n',
  );
  console.log('PASS: 4 real-browser partial-construction and repeated-disposal checks');
} finally {
  await browser.close();
}
