import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function checkObstacleControls(page, artifacts, mobile = false) {
  const dataset = () => page.locator('#viewport').evaluate((element) => ({ ...element.dataset }));
  const items = async () => JSON.parse((await dataset()).obstacles);
  const waitRevision = (previous) =>
    page.waitForFunction(
      (previous) => Number(document.getElementById('viewport').dataset.obstacleRevision) > previous,
      previous,
    );
  const clickEdit = async (id) => {
    const before = Number((await dataset()).obstacleRevision);
    await page.locator(`#${id}`).click();
    await waitRevision(before);
  };
  const screenshotHash = async () =>
    createHash('sha256')
      .update(await page.locator('canvas').screenshot())
      .digest('hex');
  await page.locator('#obstacle-settings summary').click();
  const time = (await dataset()).time;
  const initialGeometries = (await dataset()).geometries;
  const initialTextures = (await dataset()).textures;
  await clickEdit('add-box');
  assert.equal((await items()).length, 3);
  assert.equal(await page.locator('#selected-obstacle').inputValue(), '3');
  assert.ok(await page.locator('#box-size').isVisible());
  assert.equal(await page.locator('#sphere-size').isVisible(), false);
  const beforeImage = mobile ? null : await screenshotHash();
  const boxGeometries = (await dataset()).geometries;
  for (const [key, value] of Object.entries({ x: -13, y: 3, z: 1, width: 8, height: 10, depth: 4 }))
    await page.locator(`#obstacle-${key}`).fill(String(value));
  await clickEdit('apply-obstacle');
  assert.deepEqual((await items())[2], {
    id: 3,
    type: 'box',
    x: -13,
    y: 3,
    z: 1,
    width: 8,
    height: 10,
    depth: 4,
  });
  assert.equal((await dataset()).time, time, 'paused edits must not advance time');
  assert.equal((await dataset()).geometries, boxGeometries, 'resize reuses geometries');
  if (!mobile)
    assert.notEqual(await screenshotHash(), beforeImage, 'move/resize must change rendered pixels');
  const valid = await items();
  await page.locator('#obstacle-x').fill('0');
  await page.locator('#obstacle-y').fill('0');
  await page.locator('#obstacle-z').fill('0');
  await page.locator('#apply-obstacle').click();
  assert.equal(await page.locator('#obstacle-feedback').getAttribute('data-error'), 'true');
  assert.deepEqual(await items(), valid, 'overlap cannot partially commit');
  await page.locator('#obstacle-width').fill('');
  await page.locator('#apply-obstacle').click();
  assert.equal(await page.locator('#obstacle-feedback').getAttribute('data-error'), 'true');
  assert.deepEqual(await items(), valid, 'blank size cannot poison state');
  // Reselect discards the invalid draft and shows the committed values.
  await page.locator('#selected-obstacle').selectOption('1');
  await page.locator('#obstacle-radius').fill('3.5');
  const revision = Number((await dataset()).obstacleRevision);
  await page.locator('#obstacle-radius').press('Enter');
  await waitRevision(revision);
  assert.equal((await items())[0].radius, 3.5);
  await clickEdit('add-sphere');
  assert.equal((await items()).length, 4);
  await page.locator('#obstacle-radius').fill('2');
  await clickEdit('apply-obstacle');
  await page.screenshot({
    path: path.join(artifacts, mobile ? 'obstacles-mobile.png' : 'obstacles-desktop.png'),
    fullPage: mobile,
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  if (!mobile) {
    const layout = await items();
    await page.locator('#restart').click();
    await page.waitForFunction(() => document.getElementById('viewport').dataset.time === '0.0000');
    assert.deepEqual(await items(), layout);
    await page.locator('#obstacles').uncheck();
    await page.locator('#obstacle-radius').fill('2.5');
    await clickEdit('apply-obstacle');
    assert.ok(await page.locator('#obstacle-disabled').isVisible());
    await page.locator('#obstacles').check();
    assert.equal((await items())[3].radius, 2.5);
    await page.locator('#play-pause').click();
    await page.waitForFunction(
      () =>
        document.getElementById('viewport').dataset.paused === 'false' &&
        Number(document.getElementById('viewport').dataset.time) > 0,
    );
    const runningTime = Number((await dataset()).time);
    await page.locator('#obstacle-radius').fill('2.6');
    await clickEdit('apply-obstacle');
    assert.equal((await dataset()).paused, 'false');
    assert.ok(Number((await dataset()).time) >= runningTime, 'running edits must not reset time');
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.getElementById('viewport').dataset.paused === 'true');
    for (let i = 0; i < 4; i++) await clickEdit('remove-obstacle');
    assert.equal((await items()).length, 0);
    assert.equal(await page.locator('#apply-obstacle').isEnabled(), false);
    assert.equal(await page.locator('#remove-obstacle').isEnabled(), false);
    await clickEdit('add-box');
    assert.ok(await page.locator('#box-size').isVisible());
  }
  await clickEdit('reset-obstacles');
  assert.equal((await items()).length, 2);
  assert.equal(
    (await dataset()).geometries,
    initialGeometries,
    'deleted meshes release geometries',
  );
  assert.equal((await dataset()).textures, initialTextures, 'deleted labels release textures');
  if (!mobile) {
    await clickEdit('add-box');
    await clickEdit('restore');
    assert.equal((await items()).length, 2, 'global restore must restore the layout');
    assert.ok((await items()).every((item) => item.type === 'sphere'));
  }
  await page.locator('#obstacle-settings summary').click();
  console.log(
    `PASS: ${mobile ? 'mobile' : 'desktop'} obstacle creation, selection, position, dimensions, validation and reset`,
  );
}
