import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Track executable inputs so a verification run cannot silently span source edits.
export async function sourceFingerprint(root) {
  const files = [];
  const excluded = new Set(['c_cpp_properties.json', 'CMakeUserPresets.json']);
  const extensions =
    /\.(?:[cm]?js|cpp|h|hpp|json|txt|cmake|ps1|py|html|css|yml|yaml|wasm|toml|cmd)$/;
  async function visit(directory) {
    if (!existsSync(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['__pycache__', 'generated'].includes(entry.name) || excluded.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (extensions.test(entry.name)) files.push(absolute);
    }
  }
  for (const directory of [
    'src',
    'native',
    'tools',
    'tests/unit',
    'tests/native',
    'tests/browser',
    'tests/desktop',
    'tests/fixtures',
    'desktop',
    '.github',
    '.vscode',
  ]) {
    await visit(path.join(root, directory));
  }
  for (const name of [
    'package.json',
    'package-lock.json',
    'CMakeLists.txt',
    'CMakePresets.json',
    'index.html',
    'styles.css',
    'Boids-Lab.code-workspace',
    '.clang-format',
    '.gitignore',
    '.gitattributes',
    '.editorconfig',
    '.prettierignore',
    '.prettierrc.json',
  ]) {
    const absolute = path.join(root, name);
    if (existsSync(absolute)) files.push(absolute);
  }
  const hash = createHash('sha256');
  const relativeFiles = [];
  for (const file of [...new Set(files)].sort()) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    relativeFiles.push(relative);
    const bytes = await readFile(file);
    const content = file.endsWith('.wasm')
      ? bytes
      : bytes.toString('utf8').replaceAll('\r\n', '\n');
    hash.update(relative).update('\0').update(content).update('\0');
  }
  return { sha256: hash.digest('hex'), files: relativeFiles };
}

// Generated runtime bytes must also remain fixed throughout the verification run.
export async function runtimeFingerprint(root) {
  const files = [];
  for (const directory of ['src/simulation/generated', 'wasm', 'dist']) {
    const absolute = path.join(root, directory);
    if (!existsSync(absolute)) continue;
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (entry.isFile()) files.push(path.join(absolute, entry.name));
    }
  }
  if (existsSync(path.join(root, 'yoosh.html'))) files.push(path.join(root, 'yoosh.html'));
  const hash = createHash('sha256');
  const relativeFiles = [];
  for (const file of files.sort()) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    relativeFiles.push(relative);
    hash
      .update(relative)
      .update('\0')
      .update(await readFile(file))
      .update('\0');
  }
  return { sha256: hash.digest('hex'), files: relativeFiles };
}
