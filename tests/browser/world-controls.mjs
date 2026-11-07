import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkWorldControls(page, artifacts, mobile = false) {
  const data = () => page.locator('#viewport').evaluate((element) => ({ ...element.dataset }));
  const apply = async (size, enter = false) => {
    const before = await data();
    for (const [key, value] of Object.entries(size))
      await page.locator(`#world-${key}`).fill(String(value));
    if (enter) await page.locator('#world-depth').press('Enter');
    else await page.locator('#apply-world').click();
    await page.waitForFunction(
      (revision) => Number(document.getElementById('viewport').dataset.boundsRevision) > revision,
      Number(before.boundsRevision),
    );
    return data();
  };
  await page.locator('#world-settings summary').click();
  const initial = await data();
  await page.locator('#world-width').fill('');
  await page.locator('#apply-world').click();
  assert.equal(await page.locator('#world-feedback').getAttribute('data-error'), 'true');
  assert.equal((await data()).bounds, initial.bounds);
  await page.locator('#obstacles').uncheck();
  await page.locator('#world-width').fill('20');
  await page.locator('#apply-world').click();
  assert.match(await page.locator('#world-feedback').textContent(), /OBS 2/);
  assert.equal(
    (await data()).boundsRevision,
    initial.boundsRevision,
    'hidden obstacles also block invalid shrink',
  );
  await page.locator('#obstacles').check();
  const enlarged = await apply({ width: 100, height: 60, depth: 80 }, true);
  assert.deepEqual(JSON.parse(enlarged.bounds), {
    width: 100,
    height: 60,
    depth: 80,
    halfSize: [50, 30, 40],
  });
  assert.deepEqual(JSON.parse(enlarged.worldScale), [2, 1.2, 1.6]);
  assert.equal(enlarged.time, initial.time);
  assert.equal(enlarged.paused, 'true');
  assert.equal(enlarged.positionHash, initial.positionHash);
  assert.equal(enlarged.geometries, initial.geometries);
  assert.equal(enlarged.textures, initial.textures);
  assert.equal(await page.locator('#world-size-label').textContent(), '100 × 60 × 80');
  assert.equal(await page.locator('#obstacle-x').getAttribute('max'), '50');
  await page.locator('#restart').click();
  await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0000');
  assert.equal((await data()).bounds, enlarged.bounds);
  await page.locator('#world-settings').scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({
    path: path.join(artifacts, mobile ? 'world-mobile.png' : 'world-desktop.png'),
    fullPage: mobile,
  });
  await page.locator('#obstacle-settings summary').click();
  await page.locator('#selected-obstacle').selectOption('2');
  await page.locator('#remove-obstacle').click();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.obstacles).length === 1,
  );
  const small = await apply({ width: 20, height: 20, depth: 20 });
  assert.equal(small.time, '0.0000');
  assert.deepEqual(JSON.parse(small.worldScale), [0.4, 0.4, 0.4]);
  const goal = JSON.parse(small.goal);
  assert.ok(Math.abs(goal.position[0] - 6.8) < 1e-5 && Math.abs(goal.position[1] - 1.2) < 1e-5);
  assert.deepEqual(goal.rendered, goal.position);
  await page.locator('#reset-obstacles').click();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.obstacles).length === 2,
  );
  assert.equal(
    JSON.parse((await data()).obstacles)[0].radius,
    1.8,
    'small-map defaults fit inside its bounds',
  );
  if (!mobile) {
    await page.locator('button[data-count="160"]').click();
    await page.waitForFunction(() => document.getElementById('viewport').dataset.count === '160');
    assert.equal((await data()).bounds, small.bounds);
    await page.locator('#play-pause').click();
    await page.waitForFunction(
      () =>
        Number(document.getElementById('viewport').dataset.time) > 1 &&
        document.getElementById('viewport').dataset.paused === 'false',
    );
    const running = await data();
    const expanded = await apply({ width: 80, height: 40, depth: 60 });
    assert.equal(expanded.paused, 'false');
    assert.ok(Number(expanded.time) >= Number(running.time));
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  }
  await page.locator('#restore').click();
  await page.waitForFunction(
    () =>
      JSON.parse(document.getElementById('viewport').dataset.bounds).width === 50 &&
      document.getElementById('viewport').dataset.time === '0.0000',
  );
  const restored = await data();
  assert.equal(restored.bounds, initial.bounds);
  assert.equal(JSON.parse(restored.obstacles)[0].radius, 4.5);
  assert.equal(restored.paused, 'true');
  assert.equal(restored.geometries, initial.geometries);
  assert.equal(restored.textures, initial.textures);
  await page.locator('#obstacle-settings summary').click();
  await page.locator('#world-settings summary').click();
  console.log(
    `PASS: ${mobile ? 'mobile' : 'desktop'} map resize, validation, camera/guide, obstacle fit, goal fit, restart and restore`,
  );
}
