// Opt-in packaged-binary QA. Runs in the main process; never exposed to page content.
const { app } = require('electron');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

exports.runSmokeTest = async (window, output, diagnostics) => {
  const report = {
    passed: false,
    packaged: app.isPackaged,
    mode: 'hidden-window functional smoke test (not an FPS benchmark)',
    versions: process.versions,
    checks: [],
    ...diagnostics,
  };
  const contents = window.webContents;
  const evaluate = (fn, ...args) =>
    contents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
  async function waitFor(fn, label) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await evaluate(fn)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${label}`);
  }
  const snapshot = () => evaluate(() => ({ ...document.getElementById('viewport').dataset }));
  const click = (id) => evaluate((id) => document.getElementById(id).click(), id);
  const change = (id, value) =>
    evaluate(
      (id, value) => {
        const input = document.getElementById(id);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      id,
      value,
    );
  try {
    assert.equal(app.isPackaged, true, 'test must run the built app');
    await waitFor(
      () => document.getElementById('viewport').dataset.ready === 'true',
      'WebGL initialization',
    );
    assert.equal(
      await evaluate(() => document.getElementById('viewport').dataset.backend),
      'cpp17-wasm',
    );
    const isolation = await evaluate(() => ({
      require: typeof require,
      process: typeof process,
      origin: location.origin,
    }));
    assert.deepEqual(isolation, {
      require: 'undefined',
      process: 'undefined',
      origin: 'boids://lab',
    });
    report.checks.push('Packaged assets loaded; renderer has no Node.js API');
    await waitFor(
      () => document.getElementById('viewport').dataset.paused !== undefined,
      'first diagnostic sample',
    );
    if ((await snapshot()).paused === 'true') await click('play-pause');
    assert.equal((await snapshot()).workerThreadCount, '0');
    assert.equal(await evaluate(() => document.getElementById('worker-count').textContent), '0');
    assert.equal(
      await evaluate(() => document.getElementById('thread-mode').textContent),
      '단일 스레드',
    );
    report.checks.push('Worker telemetry reports zero simulation workers in the Wasm EXE');
    // Windows may throttle composition of an invisible native window to 1 FPS.
    // Require simulation progress without treating wall time as a performance measurement.
    await waitFor(
      () => Number(document.getElementById('viewport').dataset.time) > 0.1,
      'simulation progress',
    );
    report.initial = await snapshot();
    assert.equal(report.initial.count, '320');
    assert.ok(Number(report.initial.drawCalls) > 0);
    const screenshot = await contents.capturePage();
    assert.equal(screenshot.isEmpty(), false);
    await writeFile(path.join(output, 'desktop.png'), screenshot.toPNG());
    report.checks.push('320 agents animate and render with WebGL');

    await click('play-pause');
    await waitFor(() => document.getElementById('viewport').dataset.paused === 'true', 'pause');
    const paused = await snapshot();
    await delay(650);
    assert.equal((await snapshot()).time, paused.time);
    await click('restart');
    await waitFor(() => document.getElementById('viewport').dataset.time === '0.0000', 'restart');
    await click('single-step');
    await waitFor(
      () => document.getElementById('viewport').dataset.time === '0.0167',
      'fixed step',
    );
    report.checks.push('Pause, restart and exactly one fixed step');

    await click('add-box');
    await waitFor(
      () => JSON.parse(document.getElementById('viewport').dataset.obstacles).length === 3,
      'add box',
    );
    await change('obstacle-x', '-13');
    await change('obstacle-y', '3');
    await change('obstacle-width', '8');
    await change('obstacle-height', '10');
    await change('obstacle-depth', '4');
    await click('apply-obstacle');
    await waitFor(
      () =>
        JSON.parse(document.getElementById('viewport').dataset.obstacles).some(
          (item) => item.type === 'box' && item.width === 8,
        ),
      'resize box',
    );
    const box = JSON.parse((await snapshot()).obstacles).find((item) => item.type === 'box');
    assert.deepEqual(box, {
      id: 3,
      type: 'box',
      x: -13,
      y: 3,
      z: 0,
      width: 8,
      height: 10,
      depth: 4,
    });
    await click('add-sphere');
    await change('obstacle-radius', '2');
    await click('apply-obstacle');
    await waitFor(
      () =>
        JSON.parse(document.getElementById('viewport').dataset.obstacles).some(
          (item) => item.id === 4 && item.radius === 2,
        ),
      'resize sphere',
    );
    await click('remove-obstacle');
    await click('reset-obstacles');
    await waitFor(
      () => JSON.parse(document.getElementById('viewport').dataset.obstacles).length === 2,
      'reset obstacles',
    );
    assert.equal((await snapshot()).time, '0.0167');
    report.checks.push(
      'Sphere/box creation, position and size editing, removal and layout reset while paused',
    );

    await change('goalSpeed', '0');
    await change('goalStrength', '2');
    await change('predatorSpeed', '8');
    await change('predatorRadius', '18');
    await change('predatorStrength', '2');
    await click('predator');
    await click('inspect-toggle');
    await change('search-type', 'kd-tree');
    await change('color-mode', 'density');
    await click('single-step');
    await waitFor(
      () => document.getElementById('viewport').dataset.time === '0.0333',
      'parameter changes',
    );
    const controls = await evaluate(() => ({
      goal: document.getElementById('goalStrength-value').textContent,
      predator: document.getElementById('predatorSpeed-value').textContent,
      range: document.getElementById('predatorRadius-value').textContent,
      inspector: !document.getElementById('inspection-card').hidden,
      predatorLegend: !document.getElementById('predator-legend').hidden,
    }));
    assert.deepEqual(controls, {
      goal: '2.00×',
      predator: '8 u/s',
      range: '18 u',
      inspector: true,
      predatorLegend: true,
    });
    assert.equal((await snapshot()).searchType, 'kd-tree');
    await writeFile(path.join(output, 'inspector.png'), (await contents.capturePage()).toPNG());
    report.checks.push('Goal/predator settings, inspector, density colors and kd-tree');

    const movingPredator = JSON.parse((await snapshot()).predator);
    assert.notDeepEqual(movingPredator.position, [-18, 8, 15]);
    assert.deepEqual(movingPredator.rendered, movingPredator.position);
    await change('predatorSpeed', '0');
    await click('single-step');
    await waitFor(
      () => document.getElementById('viewport').dataset.time === '0.0500',
      'predator zero speed',
    );
    const stoppedPredator = JSON.parse((await snapshot()).predator);
    assert.deepEqual(stoppedPredator.position, movingPredator.position);
    assert.deepEqual(stoppedPredator.velocity, [0, 0, 0]);
    assert.deepEqual(stoppedPredator.heading, movingPredator.heading);
    await change('predatorSpeed', '8');
    report.checks.push(
      'Predator movement, paused pose interpolation and speed-zero heading retention',
    );

    const stationaryGoal = JSON.parse((await snapshot()).goal);
    assert.deepEqual(stationaryGoal.rendered, stationaryGoal.position);
    assert.equal(stationaryGoal.arrowVisible, false);
    await change('goalSpeed', '2');
    await click('goal');
    await click('single-step');
    await waitFor(
      () => document.getElementById('viewport').dataset.time === '0.0667',
      'disabled goal',
    );
    const hiddenGoal = JSON.parse((await snapshot()).goal);
    assert.deepEqual(hiddenGoal.position, stationaryGoal.position);
    assert.equal(hiddenGoal.visible, false);
    assert.equal(hiddenGoal.pathVisible, false);
    await click('goal');
    await click('single-step');
    await waitFor(
      () => document.getElementById('viewport').dataset.time === '0.0833',
      'goal resume',
    );
    const resumedGoal = JSON.parse((await snapshot()).goal);
    assert.notDeepEqual(resumedGoal.position, hiddenGoal.position);
    assert.deepEqual(resumedGoal.rendered, resumedGoal.position);
    assert.equal(resumedGoal.arrowVisible, true);
    assert.equal(resumedGoal.pathVisible, true);
    report.checks.push('Goal interpolation, stationary direction, disabled freeze and resume');

    await change('world-width', '100');
    await change('world-height', '60');
    await change('world-depth', '80');
    await click('apply-world');
    await waitFor(
      () => JSON.parse(document.getElementById('viewport').dataset.bounds).width === 100,
      'map enlargement',
    );
    const resized = await snapshot();
    assert.equal(resized.time, '0.0833');
    assert.equal(resized.paused, 'true');
    assert.deepEqual(JSON.parse(resized.worldScale), [2, 1.2, 1.6]);
    await change('world-width', '20');
    await click('apply-world');
    assert.equal(
      await evaluate(() => document.getElementById('world-feedback').dataset.error),
      'true',
    );
    assert.equal((await snapshot()).bounds, resized.bounds);
    await click('restore');
    await waitFor(
      () =>
        JSON.parse(document.getElementById('viewport').dataset.bounds).width === 50 &&
        document.getElementById('viewport').dataset.time === '0.0000',
      'map restoration',
    );
    report.checks.push(
      'Rectangular map resize, paused state, invalid shrink and complete restoration',
    );

    const beforeBoundary = await snapshot();
    await change('boundaryMode', 'soft');
    await change('boundaryMargin', '7');
    await change('boundaryStrength', '1.5');
    await waitFor(
      () => JSON.parse(document.getElementById('viewport').dataset.boundary).mode === 'soft',
      'soft boundary',
    );
    const softBoundary = await snapshot();
    assert.equal(softBoundary.time, beforeBoundary.time);
    assert.equal(softBoundary.positionHash, beforeBoundary.positionHash);
    assert.equal(JSON.parse(softBoundary.boundary).margin, 7);
    assert.equal(JSON.parse(softBoundary.boundary).strength, 1.5);
    await change('boundaryMode', 'hard');
    await waitFor(
      () => JSON.parse(document.getElementById('viewport').dataset.boundary).mode === 'hard',
      'hard boundary',
    );
    assert.equal(await evaluate(() => document.getElementById('boundaryMargin').disabled), true);
    await click('restore');
    await waitFor(
      () => JSON.parse(document.getElementById('viewport').dataset.boundary).mode === 'hybrid',
      'boundary restoration',
    );
    report.checks.push('Hard/soft/hybrid boundary switching, paused state and default restoration');

    await evaluate(() => document.querySelector('button[data-count="1200"]').click());
    await click('play-pause');
    await waitFor(
      () =>
        document.getElementById('viewport').dataset.count === '1200' &&
        Number(document.getElementById('viewport').dataset.time) > 0.1,
      '1200 agents',
    );
    report.largeFlock = await snapshot();
    await click('play-pause');
    await waitFor(
      () => document.getElementById('viewport').dataset.paused === 'true',
      'pause before 10000 agents',
    );
    for (const axis of ['width', 'height', 'depth']) await change(`world-${axis}`, '500');
    await click('apply-world');
    await waitFor(
      () => JSON.parse(document.getElementById('viewport').dataset.bounds).width === 500,
      '500-unit world',
    );
    await evaluate(() => {
      const trails = document.getElementById('trails');
      trails.checked = false;
      trails.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await change('population-count', '10000');
    await click('apply-population');
    await waitFor(
      () => document.getElementById('viewport').dataset.count === '10000',
      '10000 agents',
    );
    await change('max-neighbors', '32');
    await click('apply-max-neighbors');
    assert.equal(await evaluate(() => document.getElementById('max-neighbors').value), '32');
    await click('single-step');
    await waitFor(
      () => document.getElementById('viewport').dataset.time === '0.0167',
      '10000-agent step',
    );
    await change('world-width', '450');
    await click('apply-world');
    await waitFor(
      () => JSON.parse(document.getElementById('viewport').dataset.bounds).width === 450,
      '10000-agent dynamic world resize',
    );
    const maximumFlock = await snapshot();
    assert.equal(maximumFlock.count, '10000');
    assert.equal(maximumFlock.time, '0.0167');
    assert.equal(maximumFlock.paused, 'true');
    report.checks.push(
      '10000 agents, nearest-neighbor limit, fixed step and runtime world resize to 450-500 units',
    );
    await click('restore');
    await waitFor(
      () =>
        document.getElementById('viewport').dataset.count === '320' &&
        document.getElementById('viewport').dataset.searchType === 'grid',
      'restore defaults',
    );
    await click('help-open');
    assert.equal(await evaluate(() => document.getElementById('help-dialog').open), true);
    report.checks.push('1200 agents, default restoration and help dialog');
    report.gpu = app.getGPUFeatureStatus();
    assert.equal(await evaluate(() => document.getElementById('error').hidden), true);
    assert.deepEqual(diagnostics.errors, []);
    assert.deepEqual(diagnostics.blockedRequests, [], 'runtime must not attempt external requests');
    report.checks.push('No renderer errors or external resource requests');
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    report.lastSnapshot = await snapshot().catch(() => null);
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  return report.passed;
};
