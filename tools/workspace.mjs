import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] || 'setup';
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}).`);
}
async function findTools() {
  if (process.platform !== 'win32')
    throw new Error('The native VS Code profile requires Windows and MSVC.');
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
    'Microsoft Visual Studio/Installer/vswhere.exe',
  );
  const found = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (found.error || found.status !== 0 || !found.stdout.trim())
    throw new Error('Install Visual Studio C++ desktop development tools.');
  const installation = found.stdout.trim();
  const version = (
    await readFile(
      path.join(installation, 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt'),
      'utf8',
    )
  ).trim();
  const compiler = path.join(installation, 'VC/Tools/MSVC', version, 'bin/Hostx64/x64/cl.exe');
  const fromPath = spawnSync('where.exe', ['cmake.exe'], { encoding: 'utf8', windowsHide: true });
  const cmake = [
    process.env.CMAKE,
    ...(fromPath.stdout || '').trim().split(/\r?\n/),
    path.join(installation, 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'),
  ].find((file) => file && existsSync(file));
  if (!cmake || !existsSync(compiler))
    throw new Error('CMake or the x64 MSVC compiler could not be found.');
  return { compiler, cmake };
}
export async function writeWorkspaceConfiguration(projectRoot, tools) {
  await mkdir(path.join(projectRoot, '.vscode'), { recursive: true });
  // Absolute discovery results belong only in ignored, generated local files.
  // Checked-in workspace/settings remain byte-for-byte unchanged on every setup.
  const workspace = JSON.parse(
    await readFile(path.join(projectRoot, 'Boids-Lab.code-workspace'), 'utf8'),
  );
  workspace.settings = {
    ...workspace.settings,
    'cmake.cmakePath': tools.cmake.replaceAll('\\', '/'),
  };
  await writeFile(
    path.join(projectRoot, 'Boids-Lab.local.code-workspace'),
    JSON.stringify(workspace, null, 2) + '\n',
  );
  const properties = {
    version: 4,
    configurations: [
      {
        name: 'Windows C++20',
        compilerPath: tools.compiler.replaceAll('\\', '/'),
        intelliSenseMode: 'windows-msvc-x64',
        cppStandard: 'c++20',
        cStandard: 'c17',
        includePath: [
          '${workspaceFolder}/native/bindings/include',
          '${workspaceFolder}/native/src',
          '${workspaceFolder}/native/bindings',
        ],
        configurationProvider: 'ms-vscode.cmake-tools',
      },
    ],
  };
  await writeFile(
    path.join(projectRoot, '.vscode/c_cpp_properties.json'),
    JSON.stringify(properties, null, 2) + '\n',
  );
  console.log(`VS Code C++20 configured.\nMSVC: ${tools.compiler}\nCMake: ${tools.cmake}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (mode === 'web') {
      run(process.execPath, ['tools/build-core.mjs']);
      run(process.execPath, ['tools/build.mjs', '--dev']);
    } else if (
      ['setup', 'native-debug', 'native-release', 'native-run', 'native-test'].includes(mode)
    ) {
      const tools = await findTools();
      await writeWorkspaceConfiguration(root, tools);
      const configuration = mode === 'native-release' ? 'Release' : 'Debug';
      run(tools.cmake, ['-S', '.', '-B', 'build/native', '-A', 'x64']);
      if (mode !== 'setup') {
        run(tools.cmake, ['--build', 'build/native', '--config', configuration]);
        if (mode === 'native-run')
          run(path.join(root, 'build/native/Debug/boids_debug.exe'), process.argv.slice(3));
        if (mode === 'native-test')
          run(path.join(path.dirname(tools.cmake), 'ctest.exe'), [
            '--test-dir',
            'build/native',
            '-C',
            configuration,
            '--output-on-failure',
          ]);
      }
    } else throw new Error(`Unknown workspace task: ${mode}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
