import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkCore } from './check-core.mjs';
import { CORE_BASE64, CORE_METADATA } from '../src/simulation/generated/core-binary.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const development = process.argv.includes('--dev');
await checkCore();
await mkdir(path.join(root, 'dist'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/app.js'],
  outfile: 'dist/app.js',
  bundle: true,
  minify: !development,
  sourcemap: development ? 'inline' : false,
  format: 'iife',
  target: ['chrome110', 'edge110', 'firefox115', 'safari16'],
  legalComments: 'eof',
});
await copyFile(path.join(root, 'src/styles/app.css'), path.join(root, 'dist/styles.css'));
const sourceHtml = await readFile(path.join(root, 'src/index.html'), 'utf8');
const distributionHtml = sourceHtml
  .replace('./styles/app.css', './styles.css')
  .replace('../dist/app.js', './app.js');
await writeFile(path.join(root, 'dist/index.html'), distributionHtml);
const rootHtml = distributionHtml
  .replace('./styles.css', './dist/styles.css')
  .replace('./app.js', './dist/app.js');
await writeFile(path.join(root, 'index.html'), rootHtml);
await writeFile(path.join(root, 'yoosh.html'), rootHtml);
await mkdir(path.join(root, 'wasm'), { recursive: true });
await writeFile(path.join(root, 'wasm/boids-core.wasm'), Buffer.from(CORE_BASE64, 'base64'));
await writeFile(
  path.join(root, 'wasm/build-manifest.json'),
  JSON.stringify(CORE_METADATA, null, 2) + '\n',
);
const license = await readFile(path.join(root, 'node_modules/three/LICENSE'), 'utf8');
await writeFile(path.join(root, 'dist/THREE-LICENSE.txt'), license);
await copyFile(
  path.join(root, 'src/simulation/generated/core-licenses.txt'),
  path.join(root, 'dist/CORE-LICENSES.txt'),
);
console.log('Built dist/, exported wasm/, and refreshed compatible root HTML entries.');
