import assert from 'node:assert/strict';

export async function checkPredatorControls(page) {
  const snapshot = async () =>
    JSON.parse(await page.locator('#viewport').getAttribute('data-predator'));
  const advance = async () => {
    const time = Number(await page.locator('#viewport').getAttribute('data-time'));
    await page.locator('#play-pause').click();
    await page.waitForFunction(
      (start) => Number(document.getElementById('viewport').dataset.time) > start + 2,
      time,
    );
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  };
  await page.locator('#predator').check();
  await page.locator('#predator-settings summary').click();
  const start = await snapshot();
  await advance();
  const moved = await snapshot();
  assert.notDeepEqual(moved.position, start.position, 'enabled predator moves');
  assert.deepEqual(
    moved.rendered,
    moved.position,
    'pause snaps the interpolated pose to its committed position',
  );
  const idleFrames = await page.locator('#viewport').getAttribute('data-rendered-frames');
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#viewport').getAttribute('data-rendered-frames'), idleFrames);
  assert.deepEqual(await snapshot(), moved, 'paused position and heading remain fixed');
  await page.locator('#predatorSpeed').fill('0');
  await advance();
  const stopped = await snapshot();
  assert.deepEqual(stopped.position, moved.position, 'zero-speed predator does not drift');
  assert.deepEqual(stopped.velocity, [0, 0, 0]);
  assert.deepEqual(stopped.heading, moved.heading, 'stopped predator retains its heading');
  await page.locator('#predatorSpeed').fill('24');
  await advance();
  const resumed = await snapshot();
  assert.notDeepEqual(resumed.position, stopped.position);
  assert.ok(Math.hypot(...resumed.velocity) <= 24.00001);
  await page.locator('#predator').uncheck();
  await advance();
  assert.deepEqual(
    (await snapshot()).position,
    resumed.position,
    'disabled predator remains still',
  );
  await page.locator('#predator').check();
  await page.locator('#restart').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0000');
  const reset = await snapshot();
  assert.deepEqual(reset.position, [-18, 8, 15]);
  assert.deepEqual(reset.previous, reset.position);
  assert.deepEqual(reset.rendered, reset.position);
  await page.locator('#single-step').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0167');
  const stepped = await snapshot();
  assert.deepEqual(stepped.previous, reset.position);
  assert.notDeepEqual(stepped.position, reset.position);
  assert.deepEqual(stepped.rendered, stepped.position);
  await page.locator('#restore').click();
  await page.locator('#predator-settings summary').click();
  console.log(
    'PASS: predator motion, stop/resume, paused pose, disabled motion, restart and single step',
  );
}
