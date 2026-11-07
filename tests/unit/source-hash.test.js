import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { coreSourceHash } from '../../tools/core-sources.mjs';

test('source fingerprints survive LF/CRLF checkout while detecting actual source edits', async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'boids-source-hash-'));
  try {
    await cp(new URL('../../native/', import.meta.url), path.join(temporaryRoot, 'native'), {
      recursive: true,
    });
    await mkdir(path.join(temporaryRoot, 'tools'));
    for (const file of ['CMakeLists.txt', 'tools/build-core.mjs', 'tools/core-sources.mjs']) {
      await cp(new URL(`../../${file}`, import.meta.url), path.join(temporaryRoot, file));
    }
    const staged = await import(pathToFileURL(path.join(temporaryRoot, 'tools/core-sources.mjs')));
    const originalHash = await coreSourceHash();
    assert.equal(await staged.coreSourceHash(), originalHash);

    for (const file of await readdir(temporaryRoot, { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue;
      const target = path.join(file.parentPath, file.name);
      const source = await readFile(target, 'utf8');
      await writeFile(target, source.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    }
    assert.equal(await staged.coreSourceHash(), originalHash);
    const implementation = path.join(temporaryRoot, staged.CORE_SOURCES[0]);
    await writeFile(
      implementation,
      (await readFile(implementation, 'utf8')) + '// changed source\r\n',
    );
    assert.notEqual(await staged.coreSourceHash(), originalHash);
  } finally {
    assert.equal(path.dirname(temporaryRoot), path.resolve(tmpdir()));
    assert.ok(path.basename(temporaryRoot).startsWith('boids-source-hash-'));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
