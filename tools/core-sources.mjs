import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Native and Wasm builds consume the same ordered implementation manifest.
export const CORE_SOURCES = readFileSync(new URL('../native/sources.txt', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

export async function coreSourceHash() {
  const nativeFiles = await readdir(new URL('../native/', import.meta.url), { recursive: true });
  const headers = nativeFiles
    .filter((file) => file.endsWith('.h'))
    .map((file) => `native/${file.replaceAll('\\', '/')}`)
    .sort();
  const files = [
    ...CORE_SOURCES,
    ...headers,
    'native/sources.txt',
    'CMakeLists.txt',
    'native/CMakeLists.txt',
    'tools/build-core.mjs',
    'tools/core-sources.mjs',
  ];
  const blocks = await Promise.all(
    files.map(async (file) =>
      Buffer.concat([
        Buffer.from(`${file}\n`),
        // Git checkout may rewrite text EOLs. Hash the same UTF-8/LF source on
        // Windows and Linux; the compiled Wasm checksum remains byte-exact.
        Buffer.from(
          (await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n'),
        ),
        Buffer.from('\n'),
      ]),
    ),
  );
  return createHash('sha256').update(Buffer.concat(blocks)).digest('hex');
}
