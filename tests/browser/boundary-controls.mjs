import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkBoundaryControls(page, artifacts, mobile = false) {
  const data = () => page.locator('#viewport').evaluate((element) => ({ ...element.dataset }));
  const mode = async (value) => {
    await page.locator('#boundaryMode').selectOption(value);
    await page.waitForFunction(
      (value) => JSON.parse(document.getElementById('viewport').dataset.boundary).mode === value,
      value,
    );
    return data();
  };
  await page.locator('#world-settings summary').click();
  const initial = await data();
  assert.equal(JSON.parse(initial.boundary).mode, 'hybrid');
  const soft = await mode('soft');
  assert.equal(soft.time, initial.time);
  assert.equal(soft.positionHash, initial.positionHash);
  await page.locator('#boundaryMargin').fill('6.5');
  await page.locator('#boundaryStrength').fill('1.75');
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.boundary).strength === 1.75,
  );
  assert.equal(JSON.parse((await data()).boundary).margin, 6.5);
  assert.equal(await page.locator('#boundaryMargin-value').textContent(), '6.5 u');
  assert.equal(await page.locator('#boundaryStrength-value').textContent(), '1.75×');
  await page.locator('#bounds').uncheck();
  assert.equal(JSON.parse((await data()).boundary).mode, 'soft', 'guide visibility is independent');
  await page.locator('#bounds').check();
  await page.locator('#obstacle-settings summary').click();
  await page.locator('#remove-obstacle').click();
  await page.locator('#remove-obstacle').click();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.obstacles).length === 0,
  );
  const beforeShrink = await data();
  for (const key of ['width', 'height', 'depth']) await page.locator(`#world-${key}`).fill('20');
  await page.locator('#apply-world').click();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.bounds).width === 20,
  );
  const outside = await data();
  assert.equal(outside.time, beforeShrink.time);
  assert.equal(outside.paused, 'true');
  assert.equal(
    outside.positionHash,
    beforeShrink.positionHash,
    'soft shrinking preserves positions',
  );
  assert.ok(JSON.parse(outside.boundary).outsideCount > 0);
  assert.match(await page.locator('#boundary-outside').textContent(), /영역 밖 Boid [1-9]/);
  await page.locator('#obstacle-settings summary').click();
  await page.locator('#boundaryMode').scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({
    path: path.join(artifacts, mobile ? 'boundary-mobile.png' : 'boundary-desktop.png'),
    fullPage: mobile,
  });
  const hard = await mode('hard');
  assert.equal(hard.time, outside.time);
  assert.equal(JSON.parse(hard.boundary).outsideCount, 0);
  assert.notEqual(hard.positionHash, outside.positionHash);
  assert.equal(hard.geometries, outside.geometries);
  assert.equal(hard.textures, outside.textures);
  assert.equal(await page.locator('#boundaryMargin').isDisabled(), true);
  assert.equal(await page.locator('#boundaryStrength').isDisabled(), true);
  assert.equal(JSON.parse(hard.boundary).margin, 6.5, 'inactive parameters are retained');
  await mode('hybrid');
  assert.equal(await page.locator('#boundaryMargin').isDisabled(), false);
  await mode('soft');
  await page.locator('#restart').click();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById('viewport').dataset.boundary).outsideCount === 0,
  );
  assert.equal(JSON.parse((await data()).boundary).mode, 'soft');
  if (!mobile) {
    await page.locator('#play-pause').click();
    await page.waitForFunction(
      () => Number(document.getElementById('viewport').dataset.time) > 0.5,
    );
    const running = await data(),
      changed = await mode('hard');
    assert.equal(changed.paused, 'false');
    assert.ok(Number(changed.time) >= Number(running.time));
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
  }
  await page.locator('#restore').click();
  await page.waitForFunction(
    () =>
      JSON.parse(document.getElementById('viewport').dataset.bounds).width === 50 &&
      document.getElementById('viewport').dataset.time === '0.0000',
  );
  assert.deepEqual(JSON.parse((await data()).boundary), {
    mode: 'hybrid',
    margin: 5,
    strength: 1,
    outsideCount: 0,
    maxExcursion: 0,
  });
  await page.locator('#world-settings summary').click();
  console.log(
    `PASS: ${mobile ? 'mobile' : 'desktop'} hard/soft/hybrid controls, continuous soft resize, outside telemetry, hard reconciliation and restore`,
  );
}
