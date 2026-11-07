import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeWorkspaceConfiguration } from '../../tools/workspace.mjs';
import { sourceFingerprint } from '../../tools/validation-fingerprint.mjs';

test('tool discovery updates ignored local settings while preserving tracked files and source identity', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'boids-workspace-'));
  try {
    await mkdir(path.join(project, '.vscode'));
    const sharedSettings = '{"editor.tabSize":2,"cmake.configureOnOpen":false}\n';
    const sharedWorkspace = '{"folders":[{"path":".","name":"공유 작업 영역"}]}\n';
    await writeFile(path.join(project, '.vscode/settings.json'), sharedSettings);
    await writeFile(path.join(project, 'Boids-Lab.code-workspace'), sharedWorkspace);
    const before = await sourceFingerprint(project);
    for (const installation of ['First installation', 'Updated installation']) {
      const tools = {
        compiler: `C:\\${installation}\\cl.exe`,
        cmake: `C:\\${installation}\\cmake.exe`,
      };
      await writeWorkspaceConfiguration(project, tools);
      assert.equal(
        await readFile(path.join(project, '.vscode/settings.json'), 'utf8'),
        sharedSettings,
      );
      assert.equal(
        await readFile(path.join(project, 'Boids-Lab.code-workspace'), 'utf8'),
        sharedWorkspace,
      );
      const local = JSON.parse(
        await readFile(path.join(project, 'Boids-Lab.local.code-workspace'), 'utf8'),
      );
      const properties = JSON.parse(
        await readFile(path.join(project, '.vscode/c_cpp_properties.json'), 'utf8'),
      );
      assert.equal(local.settings['cmake.cmakePath'], tools.cmake.replaceAll('\\', '/'));
      assert.deepEqual(local.folders, JSON.parse(sharedWorkspace).folders);
      assert.equal(properties.configurations[0].compilerPath, tools.compiler.replaceAll('\\', '/'));
      assert.equal(properties.configurations[0].cppStandard, 'c++20');
      assert.equal(
        (await sourceFingerprint(project)).sha256,
        before.sha256,
        'changing installed tool paths must not invalidate project source identity',
      );
    }
    const ignores = await readFile(new URL('../../.gitignore', import.meta.url), 'utf8');
    assert.ok(ignores.split(/\r?\n/).includes('Boids-Lab.local.code-workspace'));
    assert.ok(ignores.split(/\r?\n/).includes('.vscode/c_cpp_properties.json'));
  } finally {
    assert.equal(path.dirname(project), path.resolve(tmpdir()));
    assert.ok(path.basename(project).startsWith('boids-workspace-'));
    await rm(project, { recursive: true, force: true });
  }
});
