import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function checkGoalControls(page, artifacts, mobile = false) {
  const snapshot = async () =>
    JSON.parse(await page.locator('#viewport').getAttribute('data-goal'));
  const advance = async () => {
    const time = Number(await page.locator('#viewport').getAttribute('data-time'));
    await page.locator('#play-pause').click();
    await page.waitForFunction(
      (start) => Number(document.getElementById('viewport').dataset.time) > start + 1,
      time,
    );
    const live = await snapshot();
    const phase = live.previousTime + live.advance * live.alpha;
    const expected = [
      17 * Math.cos(0.18 * phase),
      3 + 12 * Math.sin(0.27 * phase),
      17 * Math.sin(0.18 * phase),
    ];
    assert.ok(
      Math.hypot(...live.rendered.map((value, axis) => value - expected[axis])) < 1e-5,
      'actual renderer interpolates goal phase',
    );
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  };
  const waitGoal = (condition) => page.waitForFunction(condition);
  await page.locator('#restart').click();
  await waitGoal(
    () =>
      document.getElementById('viewport').dataset.time === '0.0000' &&
      JSON.parse(document.getElementById('viewport').dataset.goal).time === 0,
  );
  await page.locator('#goal-settings summary').click();
  await page.locator('#goalSpeed').fill('2');
  await page.locator('#single-step').click();
  await waitGoal(
    () =>
      document.getElementById('viewport').dataset.time === '0.0167' &&
      JSON.parse(document.getElementById('viewport').dataset.goal).advance > 0.03,
  );
  const moving = await snapshot();
  assert.deepEqual(moving.rendered, moving.position);
  assert.equal(moving.arrowVisible, true);
  const geometries = await page.locator('#viewport').getAttribute('data-geometries');
  const before = await page.locator('canvas').screenshot();
  await page.locator('#goalPath').uncheck();
  await waitGoal(() => !JSON.parse(document.getElementById('viewport').dataset.goal).pathVisible);
  assert.equal(await page.locator('#goal-path-legend').isVisible(), false);
  assert.notEqual(
    createHash('sha256').update(before).digest('hex'),
    createHash('sha256')
      .update(await page.locator('canvas').screenshot())
      .digest('hex'),
  );
  assert.equal((await snapshot()).time, moving.time, 'path toggle never advances the target');
  await page.locator('#goalSpeed').fill('0');
  await page.locator('#goalStrength').fill('0');
  await waitGoal(() => !JSON.parse(document.getElementById('viewport').dataset.goal).arrowVisible);
  assert.equal(await page.locator('#goal-motion-state').textContent(), '고정 목표 · 추적 힘 0');
  if (!mobile) {
    await advance();
    const stopped = await snapshot();
    assert.deepEqual(stopped.position, moving.position);
    assert.equal(stopped.rotation, moving.rotation);
    assert.equal(stopped.ringScale, moving.ringScale);
  }
  await page.locator('#goalSpeed').fill('2');
  await page.locator('#goal').uncheck();
  await waitGoal(() => !JSON.parse(document.getElementById('viewport').dataset.goal).visible);
  assert.equal(await page.locator('#goal-legend').isVisible(), false);
  const disabled = await snapshot();
  if (!mobile) await advance();
  assert.equal((await snapshot()).time, disabled.time);
  await page.locator('#goal').check();
  await waitGoal(() => JSON.parse(document.getElementById('viewport').dataset.goal).visible);
  assert.deepEqual((await snapshot()).position, disabled.position);
  assert.equal(
    (await snapshot()).pathVisible,
    false,
    'path preference survives toggling the target',
  );
  await page.locator('#goalPath').check();
  await page.locator('#goalStrength').fill('1');
  await waitGoal(() => JSON.parse(document.getElementById('viewport').dataset.goal).pathVisible);
  assert.equal(await page.locator('#goal-path-legend').isVisible(), true);
  if (!mobile) {
    await advance();
    assert.notDeepEqual((await snapshot()).position, disabled.position);
    const paused = await snapshot();
    await page.waitForTimeout(650);
    assert.deepEqual(await snapshot(), paused);
  }
  await page.locator('#predator').check();
  await page.locator('#goal-settings').scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({
    path: path.join(artifacts, mobile ? 'goal-mobile.png' : 'goal-desktop.png'),
    fullPage: mobile,
  });
  assert.equal(await page.locator('#viewport').getAttribute('data-geometries'), geometries);
  await page.locator('#restore').click();
  await waitGoal(
    () =>
      document.getElementById('viewport').dataset.time === '0.0000' &&
      JSON.parse(document.getElementById('viewport').dataset.goal).time === 0,
  );
  const reset = await snapshot();
  assert.deepEqual(reset.position, [17, 3, 0]);
  assert.deepEqual(reset.rendered, reset.position);
  assert.equal(reset.rotation, 0);
  assert.equal(reset.ringScale, 1);
  await page.locator('#goal-settings summary').click();
  console.log(
    `PASS: ${mobile ? 'mobile' : 'desktop'} goal controls, interpolation, path/legend, direction, freeze/resume and reset`,
  );
}
