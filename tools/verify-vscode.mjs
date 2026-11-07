// Exercise the installed C++ debugger inside an isolated VS Code extension host.
// This does not install an extension or alter the user's VS Code profile.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runId = Date.now().toString(36);
const work = path.join(root, 'build/vscode-check');
const extension = path.join(work, 'extension');
const profile = path.join(work, 'profile');
const report = path.join(root, 'artifacts/vscode-debug-results.json');
const source = path.join(root, 'native/bindings/Simulation.cpp');
const lines = (await readFile(source, 'utf8')).split('\n');
const signature = lines.findIndex((line) => line.trimStart().startsWith('void FSimulation::Step('));
if (signature < 0) throw new Error('FSimulation::Step not found');
const body = lines.findIndex((line, index) => index >= signature && line.includes('{'));
const breakpointLine = lines.findIndex(
  (line, index) => index > body && line.trim() && !line.trimStart().startsWith('//'),
);
if (body < 0 || breakpointLine < 0) throw new Error('FSimulation::Step body not found');
await mkdir(extension, { recursive: true });
await mkdir(path.join(profile, 'User'), { recursive: true });
await mkdir(path.dirname(report), { recursive: true });
await writeFile(
  path.join(profile, 'User/settings.json'),
  JSON.stringify({
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
  }),
);
await writeFile(
  path.join(extension, 'package.json'),
  JSON.stringify({
    name: 'boids-debug-verification',
    publisher: 'local',
    version: '1.0.0',
    engines: { vscode: '^1.90.0' },
    main: './extension.cjs',
    activationEvents: ['onStartupFinished'],
  }),
);
await writeFile(
  path.join(extension, 'extension.cjs'),
  `
const vscode = require('vscode');
const fs = require('node:fs');
exports.activate = async () => {
  const result = { runId: ${JSON.stringify(runId)}, passed: false, mode: 'isolated VS Code extension-host debugger verification' };
  let session, tracker, breakpoint;
  const stops = [], waiters = [];
  const nextStop = () => stops.length ? Promise.resolve(stops.shift()) : new Promise(resolve => waiters.push(resolve));
  const timeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Debugger timeout')), ms))]);
  try {
    await vscode.extensions.getExtension('ms-vscode.cpptools').activate();
    tracker = vscode.debug.registerDebugAdapterTrackerFactory('cppvsdbg', { createDebugAdapterTracker: () => ({ onDidSendMessage: message => {
      if (message.type === 'event' && message.event === 'stopped') {
        if (waiters.length) waiters.shift()(message.body); else stops.push(message.body);
      }
    } }) });
    // This isolated profile may retain source breakpoints from a previous verification run.
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(${JSON.stringify(source)}), new vscode.Position(${breakpointLine}, 0)));
    vscode.debug.addBreakpoints([breakpoint]);
    const folder = vscode.workspace.workspaceFolders[0];
    const config = vscode.workspace.getConfiguration('launch', folder.uri).get('configurations').find(c => c.name === 'C++: Simulation (Grid)');
    const started = await vscode.debug.startDebugging(folder, { ...config, preLaunchTask: undefined, console: 'internalConsole', stopAtEntry: false });
    if (!started) throw new Error('VS Code refused the debug session');
    session = vscode.debug.activeDebugSession;
    const stopped = await timeout(nextStop(), 45000);
    const trace = await session.customRequest('stackTrace', { threadId: stopped.threadId, startFrame: 0, levels: 1 });
    const frame = trace.stackFrames[0];
    const dt = await session.customRequest('evaluate', { expression: 'DeltaTime', frameId: frame.id, context: 'watch' });
    const count = await session.customRequest('evaluate', { expression: 'this->Config.RequestedBirdCount', frameId: frame.id, context: 'watch' });
    result.breakpoint = { reason: stopped.reason, source: frame.source.path, line: frame.line, function: frame.name, dt: dt.result, count: count.result };
    if (!frame.name.includes('FSimulation::Step') || Math.abs(Number(dt.result) - 1 / 60) > 1e-8 || Number(count.result) !== 32) throw new Error('Unexpected source frame or variables');
    await session.customRequest('next', { threadId: stopped.threadId });
    const stepped = await timeout(nextStop(), 15000);
    result.step = { reason: stepped.reason };
    result.passed = true;
  } catch (error) { result.error = error.stack; }
  finally {
    if (session) await vscode.debug.stopDebugging(session);
    if (breakpoint) vscode.debug.removeBreakpoints([breakpoint]);
    tracker?.dispose();
    fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify(result, null, 2));
    setTimeout(() => vscode.commands.executeCommand('workbench.action.closeWindow'), 500);
  }
};
`,
);
const found = spawnSync('where.exe', ['code.cmd'], { encoding: 'utf8', windowsHide: true });
const cli = found.stdout.trim().split(/\r?\n/)[0];
if (!cli) throw new Error('VS Code CLI not found');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  path.resolve(path.dirname(cli), '../Code.exe'),
  [
    '--new-window',
    '--wait',
    '--skip-welcome',
    '--skip-release-notes',
    '--user-data-dir',
    profile,
    '--extensionDevelopmentPath',
    extension,
    path.join(root, 'Boids-Lab.code-workspace'),
  ],
  { cwd: root, env, windowsHide: true, stdio: 'ignore' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  const current = await readFile(report, 'utf8').catch(() => null);
  if (current && JSON.parse(current).runId === runId) {
    const result = JSON.parse(current);
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (Date.now() >= deadline) {
  console.error('VS Code verification timed out; close the isolated verification window.');
  process.exitCode = 1;
}
child.unref();
