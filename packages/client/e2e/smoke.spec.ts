import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import clientJson from '../../../config/client.json' with { type: 'json' };
import ordersJson from '../../../config/orders.json' with { type: 'json' };
import poiTableJson from '../../../map/city.poi.json' with { type: 'json' };
import type {} from '../src/game/debugHooks';

const artifacts = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });

/** Opens the game in debug mode and waits for the first frame; returns the console errors seen. */
async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`?debug=1${query}`);
  await page.waitForFunction(() => window.__dm?.ready === true, undefined, { timeout: 30_000 });
  return errors;
}

/** Average frames per second over `ms` of wall time. */
const measureFps = (page: Page, ms: number): Promise<number> =>
  page.evaluate(
    (dur) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const count = (t: number): void => {
          frames++;
          if (t - t0 < dur) requestAnimationFrame(count);
          else resolve((frames * 1000) / (t - t0));
        };
        requestAnimationFrame(count);
      }),
    ms,
  );

// ---- SP1: the greybox (?map=greybox; the city is the default map since SP2 Task 15) ----

/** The SP1 tests run on the greybox: they use its playground, crouch tunnel, zip lines, orbs and POIs. */
const GREYBOX = '&map=greybox';

test('loads, renders the greybox and reports ready', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await expect(page.locator('canvas.game-canvas')).toBeVisible();
  // Let the player settle onto the plaza and a few frames draw.
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 10);
  const p = await page.evaluate(() => window.__dm!.player());
  expect(p.mode).toBe('ground');
  const fps = await measureFps(page, 2000);
  console.log(`headless fps: ${fps.toFixed(1)}`);
  await page.screenshot({ path: `${artifacts}sp1-spawn.png` });
  expect(errors).toEqual([]);
});

test('W then a Shift tap runs at ~8 m/s', async ({ page }) => {
  // Timed in simulation ticks, not wall time: headless Chromium renders on the CPU and can drop below
  // 30 / maxStepsPerFrame fps, where the fixed stepper drops time by design.
  await boot(page, GREYBOX);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const { start, tick0 } = await page.evaluate(() => ({ start: window.__dm!.player().position, tick0: window.__dm!.tick }));
  await page.keyboard.down('KeyW');
  await page.keyboard.press('ShiftLeft'); // Shift toggles sprint on; it stays on while W is held
  await page.waitForFunction((t0) => window.__dm!.tick - t0 >= 30, tick0); // 1 s of sim time
  const { p, ticks } = await page.evaluate((t0) => ({ p: window.__dm!.player(), ticks: window.__dm!.tick - t0 }), tick0);
  await page.keyboard.up('KeyW');
  const speed = Math.hypot(p.velocity.x, p.velocity.z);
  const moved = Math.hypot(p.position.x - start.x, p.position.z - start.z);
  console.log(`run: speed ${speed.toFixed(2)} m/s, moved ${moved.toFixed(2)} m in ${ticks} ticks`);
  expect(speed).toBeGreaterThanOrEqual(7.5);
  expect(speed).toBeLessThanOrEqual(8.5);
  expect(moved).toBeGreaterThan(5);
});

test('draw calls stay under the budget', async ({ page }) => {
  await boot(page, GREYBOX);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`render: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(info.calls).toBeGreaterThan(0);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
});

test('a collected orb disappears', async ({ page }) => {
  await boot(page, GREYBOX);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  expect(await page.evaluate(() => window.__dm!.orbVisible('hub-orb-01'))).toBe(true);
  // Feet 1 m below the orb centre, so the capsule centre is on it.
  await page.evaluate(() => {
    const o = window.__dm!.featurePosition('hub-orb-01');
    window.__dm!.teleport({ x: o.x, y: o.y - 1, z: o.z });
  });
  await page.waitForFunction(() => window.__dm!.orbVisible('hub-orb-01') === false, undefined, { timeout: 10_000 });
});

test('feature screenshot', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // Stand at the plaza's east edge looking down the playground line: orbs, mantle blocks, wall-run alley.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 22, y: 0, z: 5 }, { x: 70, y: 2, z: -1 }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${artifacts}sp1-features.png` });
  expect(errors).toEqual([]);
});

/** Waits until `n` more simulation ticks have run (frames are drawn alongside them). */
async function waitTicks(page: Page, n: number): Promise<void> {
  const tick0 = await page.evaluate(() => window.__dm!.tick);
  await page.waitForFunction(([t0, k]) => window.__dm!.tick - t0 >= k, [tick0, n] as const);
}

/**
 * Waits until the chase camera has come to rest: the courier is released from the sprint (it decelerates over several
 * ticks) and the camera follow eases toward it, so a fixed tick count races the framing. Settled = the camera moved
 * less than `eps` metres across `n` successive 3-tick windows.
 */
async function waitCameraSettled(page: Page, eps = 1e-3, n = 3): Promise<void> {
  let prev = await page.evaluate(() => window.__dm!.camera().position);
  let still = 0;
  for (let i = 0; i < 40 && still < n; i++) {
    await waitTicks(page, 3);
    const cur = await page.evaluate(() => window.__dm!.camera().position);
    still = Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z) < eps ? still + 1 : 0;
    prev = cur;
  }
  expect(still, 'chase camera never settled').toBe(n);
}

test('third-person view shows the courier', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // East edge of the plaza facing down the playground line, then a short sprint so the shot has motion.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: -1 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.keyboard.down('KeyW');
  await page.keyboard.press('ShiftLeft');
  await waitTicks(page, 12);
  await page.keyboard.up('KeyW');
  await waitCameraSettled(page);
  const cam = await page.evaluate(() => window.__dm!.camera());
  console.log(`chase camera: distance ${cam.distance.toFixed(2)} m, courier at NDC (${cam.courierNdc.x.toFixed(2)}, ${cam.courierNdc.y.toFixed(2)})`);
  expect(cam.courierHidden).toBe(false);
  expect(cam.distance).toBeGreaterThan(clientJson.camera.chase.distance - 0.5);
  // R9: centre-bottom of the frame, horizontally central. The camera aims at lookAtHeight (1.9 m, above the 1.8 m
  // courier's head), so the head top sits just under NDC 0 and a few thousandths either side is normal; the centre of the
  // body must be clearly in the lower half, and the head top no higher than a small margin above the middle.
  expect(Math.abs(cam.courierNdc.x)).toBeLessThan(0.2);
  expect(cam.courierNdc.y).toBeLessThan(0);
  expect(cam.courierNdc.y).toBeGreaterThan(-0.8);
  expect(cam.courierTopNdc.y).toBeLessThan(0.05);
  // No centre crosshair in third person (R9).
  await expect(page.locator('.crosshair')).toHaveCount(0);
  expect(await page.evaluate(() => window.__dm!.cameraInsideSolid())).toBe(false);
  await page.screenshot({ path: `${artifacts}sp1-third-person.png` });
  expect(errors).toEqual([]);
});

test('camera stays outside geometry in the crouch tunnel and against a wall', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const deg = Math.PI / 180;
  const { pitchMinDeg, pitchMaxDeg } = clientJson.camera.chase;
  /**
   * Every 45° yaw step plus `extraYaws`, at level, lowest, highest and a mid-low pitch: no part of the camera's near
   * plane may end up inside a solid.
   */
  const sweep = async (label: string, extraYaws: number[] = []): Promise<void> => {
    const yaws = [...Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4), ...extraYaws];
    for (const pitch of [0, pitchMinDeg * deg, pitchMaxDeg * deg, -20 * deg]) {
      for (const yaw of yaws) {
        await page.evaluate(([y, p]) => window.__dm!.setLook(y, p), [yaw, pitch] as const);
        await waitTicks(page, 2);
        const inside = await page.evaluate(() => window.__dm!.cameraInsideSolid());
        expect(inside, `${label}: yaw ${(yaw / deg).toFixed(0)}°, pitch ${(pitch / deg).toFixed(0)}°`).toBe(false);
      }
    }
  };

  // Crouch tunnel (hub-tunnel-*: roof underside 1.4 m, x 92..104). Crouch first, then go in.
  await page.keyboard.down('KeyC');
  await waitTicks(page, 4);
  await page.evaluate(() => window.__dm!.teleport({ x: 98, y: 0.05, z: 0 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await sweep('tunnel');
  await page.evaluate(() => window.__dm!.setLook(Math.PI / 2, -20 * (Math.PI / 180)));
  await waitTicks(page, 3);
  await page.screenshot({ path: `${artifacts}sp1-camera-tunnel.png` });
  await page.keyboard.up('KeyC');

  // Back pressed against the south face (z = −56) of building b-0--2-2, facing away from it.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 14.5, y: 0.3, z: -55 }, { x: 14.5, y: 1.6, z: -30 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.keyboard.down('KeyS');
  await waitTicks(page, 15);
  await page.keyboard.up('KeyS');
  const z = await page.evaluate(() => window.__dm!.player().position.z);
  expect(z).toBeLessThan(-55.5); // flush with the wall
  // Grazing yaws: the boom runs almost along the wall (the review's see-through case at π ± 1.3).
  await sweep('wall', [Math.PI + 1.3, Math.PI - 1.3, Math.PI + 1.45, Math.PI - 1.45]);
  // The review's see-through case exactly: flush with the wall, looking at π + 1.3. The pivot is only ~0.37 m from the
  // wall, so R12 shifts it wallPivotOffset away from the wall: the boom has room and the courier stays in view.
  await page.evaluate(() => window.__dm!.setLook(Math.PI + 1.3, -15 * (Math.PI / 180)));
  await waitTicks(page, 3);
  const flush = await page.evaluate(() => window.__dm!.camera());
  console.log(
    `flush with the wall at π+1.3: boom ${flush.distance.toFixed(2)} m, camera ${flush.courierDistance.toFixed(2)} m from the courier, hidden ${flush.courierHidden}`,
  );
  expect(flush.courierDistance).toBeGreaterThanOrEqual(clientJson.camera.chase.minDistance);
  expect(flush.courierHidden).toBe(false);
  expect(await page.evaluate(() => window.__dm!.cameraInsideSolid())).toBe(false);
  await page.screenshot({ path: `${artifacts}sp1-camera-wall.png` });

  // One metre off the same wall at the same grazing yaw: the boom is pulled in short of the wall and the courier stays
  // in view, with the wall running beside the camera.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 14.5, y: 0.3, z: -55 }, { x: 14.5, y: 1.6, z: -30 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.evaluate(() => window.__dm!.setLook(Math.PI + 1.3, -15 * (Math.PI / 180)));
  await waitTicks(page, 3);
  const graze = await page.evaluate(() => window.__dm!.camera());
  console.log(
    `1 m off the wall at π+1.3: boom ${graze.distance.toFixed(2)} m, camera ${graze.courierDistance.toFixed(2)} m from the courier, hidden ${graze.courierHidden}`,
  );
  expect(graze.distance).toBeLessThan(clientJson.camera.chase.distance);
  expect(graze.courierDistance).toBeGreaterThan(clientJson.camera.chase.minDistance);
  expect(graze.courierHidden).toBe(false);
  expect(await page.evaluate(() => window.__dm!.cameraInsideSolid())).toBe(false);
  await page.screenshot({ path: `${artifacts}sp1-camera-wall-graze.png` });
  expect(errors).toEqual([]);
});

test('wall-run: the courier stays in view at look offsets from the wall, hidden only when the camera is that close (R12, R10)', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const deg = Math.PI / 180;
  const { minDistance } = clientJson.camera.chase;
  // hub-wall-01's north face (z = −2, normal +Z) runs x 68..88 along the playground alley. Each check starts a fresh
  // run: airborne beside the face at 8 m/s toward −X (look yaw π/2 runs along it), W held.
  const alongYaw = Math.PI / 2;
  await page.keyboard.down('KeyW');
  for (const offset of [0, 15, -15, 30, -30, 60, -60]) {
    await page.evaluate((y) => {
      window.__dm!.setLook(y, 0);
      window.__dm!.teleport({ x: 86, y: 2, z: -1.5 }, { x: -8, y: 0, z: 0 });
    }, alongYaw);
    await page.waitForFunction(() => window.__dm!.player().mode === 'wallrun', undefined, { timeout: 10_000 });
    await page.evaluate((y) => window.__dm!.setLook(y, 0), alongYaw + offset * deg);
    await waitTicks(page, 2);
    const { mode, cam, inside } = await page.evaluate(() => ({
      mode: window.__dm!.player().mode,
      cam: window.__dm!.camera(),
      inside: window.__dm!.cameraInsideSolid(),
    }));
    console.log(
      `wall-run, look ${offset}° off the wall: boom ${cam.distance.toFixed(2)} m, camera ${cam.courierDistance.toFixed(2)} m from the courier, hidden ${cam.courierHidden}`,
    );
    expect(mode, `offset ${offset}°`).toBe('wallrun');
    expect(inside, `offset ${offset}°`).toBe(false);
    // Hiding follows the camera's real distance to the courier, not the boom from the shifted pivot.
    expect(cam.courierHidden, `offset ${offset}°`).toBe(cam.courierDistance < minDistance);
    // Positive offsets look away from the wall, so the boom swings back toward it. At +60° the boom from the shifted
    // pivot meets the wall beside the courier (about 0.5 m from it), so R10 hides the courier there; everywhere else
    // it is in view.
    if (offset === 60) expect(cam.courierHidden, 'offset 60°').toBe(true);
    else expect(cam.courierDistance, `offset ${offset}°`).toBeGreaterThanOrEqual(minDistance);
    const shot = { 30: 'sp1-camera-wallrun.png', [-30]: 'sp1-camera-wallrun-m30.png', 60: 'sp1-camera-wallrun-60.png', [-60]: 'sp1-camera-wallrun-m60.png' }[offset];
    if (shot) await page.screenshot({ path: `${artifacts}${shot}` });
  }
  await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});

test('camera stays outside geometry on a zip line beside a building', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // downtown-zip-03 runs from (43.8, 23, −92) down to (50, 2.8, −160) and passes about 1.1 m from the east face
  // (x = 44) of building b-0--3-3 a fifth of the way along. Hang under the top end facing down the line and press E.
  await page.evaluate(() => {
    const a = { x: 43.8, y: 23, z: -92 };
    const b = { x: 50, y: 2.8, z: -160 };
    const t = 0.02;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    window.__dm!.viewpoint({ x: p.x, y: p.y - 2, z: p.z }, { x: b.x, y: b.y, z: b.z });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
  });
  await page.waitForFunction(() => window.__dm!.player().mode === 'zipline', undefined, { timeout: 10_000 });
  const deg = Math.PI / 180;
  const rideYaw = Math.atan2(-(50 - 43.8), -(-160 - -92));
  // Orbit while riding, with extra weight on yaws that swing the boom west toward the building.
  const yaws = [rideYaw - 1.3, rideYaw - 1.6, rideYaw - 1.0, rideYaw, rideYaw - 2.2, rideYaw + 1.3];
  let checks = 0;
  let shot = false;
  for (let i = 0; i < 80; i++) {
    const p = await page.evaluate(() => window.__dm!.player());
    if (p.mode !== 'zipline') break;
    await page.evaluate(([y, pitch]) => window.__dm!.setLook(y, pitch), [yaws[i % yaws.length]!, (i % 3 === 0 ? -25 : 0) * deg] as const);
    await waitTicks(page, 1);
    const inside = await page.evaluate(() => window.__dm!.cameraInsideSolid());
    const at = await page.evaluate(() => window.__dm!.player().position);
    expect(inside, `zip ride at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)}), check ${i}`).toBe(false);
    checks++;
    // Screenshot beside the building (its east face spans z −123..−106), boom swung toward it.
    if (!shot && at.z < -104 && at.z > -118) {
      await page.evaluate(([y, pitch]) => window.__dm!.setLook(y, pitch), [rideYaw - 1.3, -10 * deg] as const);
      await waitTicks(page, 1);
      expect(await page.evaluate(() => window.__dm!.cameraInsideSolid())).toBe(false);
      await page.screenshot({ path: `${artifacts}sp1-camera-zip.png` });
      shot = true;
    }
  }
  console.log(`zip ride: ${checks} camera checks, screenshot beside the building: ${shot}`);
  expect(shot).toBe(true);
  expect(errors).toEqual([]);
});

test('courier model loads and animates (mixer time advances)', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const c0 = await page.evaluate(() => window.__dm!.courier());
  expect(c0.loaded).toBe(true);
  expect(c0.clip).toBe('Idle');
  await waitTicks(page, 6);
  const c1 = await page.evaluate(() => window.__dm!.courier());
  expect(c1.time).toBeGreaterThan(c0.time);
  await page.evaluate(() => window.__dm!.viewpoint({ x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: -1 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  // W + D, then a Shift tap: a diagonal sprint, so the chase camera sees the courier three-quarters from behind.
  for (const k of ['KeyW', 'KeyD']) await page.keyboard.down(k);
  await page.keyboard.press('ShiftLeft');
  await page.waitForFunction(() => window.__dm!.courier().clip === 'Running', undefined, { timeout: 10_000 });
  await waitTicks(page, 8);
  await page.screenshot({ path: `${artifacts}sp1-courier-run.png` });
  // Still sprinting: crouch into a slide.
  await page.keyboard.down('KeyC');
  await page.waitForFunction(() => window.__dm!.player().mode === 'slide', undefined, { timeout: 10_000 });
  await waitTicks(page, 4);
  expect(await page.evaluate(() => window.__dm!.courier().pose)).toBe('slide');
  await page.screenshot({ path: `${artifacts}sp1-courier-slide.png` });
  for (const k of ['KeyC', 'KeyD', 'KeyW']) await page.keyboard.up(k);
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`courier model: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
  expect(errors).toEqual([]);
});

test('courier poses: wall-run, zip line and board', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const deg = Math.PI / 180;

  // Wall-run along hub-wall-01's north face (as in the camera test), looking 30° off the wall toward it.
  await page.keyboard.down('KeyW');
  await page.evaluate(() => {
    window.__dm!.setLook(Math.PI / 2, 0);
    window.__dm!.teleport({ x: 86, y: 2, z: -1.5 }, { x: -8, y: 0, z: 0 });
  });
  await page.waitForFunction(() => window.__dm!.player().mode === 'wallrun', undefined, { timeout: 10_000 });
  await page.evaluate((y) => window.__dm!.setLook(y, -10 * (Math.PI / 180)), Math.PI / 2 - 30 * deg);
  await waitTicks(page, 3);
  expect(await page.evaluate(() => window.__dm!.player().mode)).toBe('wallrun');
  expect(await page.evaluate(() => window.__dm!.courier().pose)).toMatch(/^wallrun[LR]$/);
  await page.screenshot({ path: `${artifacts}sp1-courier-wallrun.png` });
  await page.keyboard.up('KeyW');

  // Zip line: downtown-zip-03 from its top end, the camera swung out to the side.
  await page.evaluate(() => {
    const a = { x: 43.8, y: 23, z: -92 };
    const b = { x: 50, y: 2.8, z: -160 };
    const t = 0.02;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    window.__dm!.viewpoint({ x: p.x, y: p.y - 2, z: p.z }, { x: b.x, y: b.y, z: b.z });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
  });
  await page.waitForFunction(() => window.__dm!.player().mode === 'zipline', undefined, { timeout: 10_000 });
  const rideYaw = Math.atan2(-(50 - 43.8), -(-160 - -92));
  await page.evaluate((y) => window.__dm!.setLook(y, -5 * (Math.PI / 180)), rideYaw + 0.7);
  // W held with the camera swung out turns the heading off the line; the courier still faces the ride (R14).
  await page.keyboard.down('KeyW');
  await waitTicks(page, 4);
  expect(await page.evaluate(() => window.__dm!.courier().pose)).toBe('zip');
  const zipYaw = await page.evaluate(() => ({ heading: window.__dm!.player().heading, drawn: window.__dm!.courier().yaw }));
  expect(Math.abs(Math.sin(zipYaw.heading - rideYaw))).toBeGreaterThan(0.5);
  expect(Math.abs(Math.sin(zipYaw.drawn - rideYaw))).toBeLessThan(0.05);
  expect(Math.cos(zipYaw.drawn - rideYaw)).toBeGreaterThan(0.99);
  await page.screenshot({ path: `${artifacts}sp1-courier-zip.png` });
  await page.keyboard.up('KeyW');

  // Board: back on the plaza, Q, then roll forward and a little right.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: -1 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => window.__dm!.player().onBoard === true, undefined, { timeout: 10_000 });
  await page.keyboard.down('KeyW');
  await waitTicks(page, 15);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => window.__dm!.setLook(Math.PI / 2 - 0.6, -10 * (Math.PI / 180)));
  await waitTicks(page, 3);
  expect(await page.evaluate(() => window.__dm!.courier().pose)).toBe('board');
  await page.screenshot({ path: `${artifacts}sp1-courier-board.png` });
  expect(errors).toEqual([]);
});

test('a missing model falls back to the capsule without console errors (Review Focus 4)', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  // A wrong Pages base path: the .glb request 404s. Chromium itself logs the failed fetch; any other error fails.
  await page.route('**/*.glb', (r) => r.fulfill({ status: 404, body: 'not found' }));
  const errors = await boot(page, GREYBOX);
  const ours = errors.filter((e) => !/^Failed to load resource: .*404/.test(e));
  expect(ours).toEqual([]);
  expect(await page.evaluate(() => window.__dm!.courier().loaded)).toBe(false);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  expect(await page.evaluate(() => window.__dm!.player().mode)).toBe('ground');
  const courierWarnings = warnings.filter((w) => w.startsWith('Courier model unavailable'));
  expect(courierWarnings).toHaveLength(1);
  expect(await page.evaluate(() => window.__dm!.camera().courierHidden)).toBe(false);
  await page.screenshot({ path: `${artifacts}sp1-courier-fallback.png` });
});

test('a corrupt model file falls back to the capsule with one warning and no errors', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.route('**/*.glb', (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: 'this is not a glb' }));
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  expect(await page.evaluate(() => window.__dm!.courier().loaded)).toBe(false);
  expect(warnings.filter((w) => w.startsWith('Courier model unavailable'))).toHaveLength(1);
  expect(errors).toEqual([]);
});

/**
 * Viewpoints in the air: the player starts falling at once, so the screenshot is taken after a few frames
 * (a fall of well under a metre) rather than after a fixed settle time.
 */
async function airShot(page: Page, feet: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, file: string): Promise<void> {
  await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [feet, target] as const);
  const tick0 = await page.evaluate(() => window.__dm!.tick);
  await page.waitForFunction((t0) => window.__dm!.tick - t0 >= 3, tick0);
  await page.screenshot({ path: `${artifacts}${file}` });
}

test('city overview screenshot', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  await airShot(page, { x: 0, y: 120, z: 200 }, { x: 0, y: 0, z: 0 }, 'sp1-city-overview.png');
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`city overview: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
  expect(errors).toEqual([]);
});

test('playground screenshot', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // Above the plaza's south-east corner, looking along the playground line toward the tower.
  await airShot(page, { x: 40, y: 18, z: 42 }, { x: 92, y: 2, z: -2 }, 'sp1-playground.png');
  expect(errors).toEqual([]);
});

/**
 * Greybox and board seed for the SP1 delivery tests. With the greybox (21 POIs) and the SP2 board rules (Task 15:
 * spread, district weights, Chain weight 4) its first board's first Drop-off is an Express drop-off to harbor-poi-05,
 * a street door. Tests assert a Drop-off is present, so a map or generator change fails here deterministically
 * instead of flaking.
 */
const SEED = `${GREYBOX}&seed=35`;

/** Waits for the player to settle, then returns the first Drop-off on the board. */
async function firstDropoff(page: Page): Promise<{ id: string; poiId: string }> {
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const board = await page.evaluate(() => window.__dm!.orders.board());
  const drop = board.find((o) => o?.type === 'dropoff');
  expect(drop, `seed board has no drop-off: ${JSON.stringify(board.map((o) => o?.type))}`).toBeTruthy();
  const step = drop!.steps[0]!;
  if (step.kind !== 'poi') throw new Error('drop-off without a POI step');
  return { id: drop!.id, poiId: step.poiId };
}

/** Teleports onto a POI's zone (feet at its ground point). */
async function goToPoi(page: Page, poiId: string): Promise<void> {
  await page.evaluate((id) => {
    const p = window.__dm!.poiPosition(id);
    window.__dm!.teleport({ x: p.x, y: p.y + 0.2, z: p.z });
  }, poiId);
}

test('accept a drop-off at the kiosk and deliver it', async ({ page }) => {
  const errors = await boot(page, SEED);
  const drop = await firstDropoff(page);
  // Stand at the kiosk and press E.
  const kiosk = await page.evaluate(() => window.__dm!.kiosk());
  await page.evaluate((k) => window.__dm!.viewpoint({ x: k.x, y: k.y, z: k.z + 2 }, { x: k.x, y: 1.5, z: k.z }), kiosk);
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.keyboard.press('KeyE');
  await expect(page.locator('.board-overlay')).toBeVisible();
  await expect(page.locator(`[data-order-id="${drop.id}"] .accept`)).toBeEnabled();
  // Every card carries its par time and the par bonus as its own line.
  const card = page.locator(`.board-card[data-order-id="${drop.id}"]`);
  await expect(card.locator('.board-facts')).toContainText(/Par \d+:\d{2}/);
  // This seed's first Drop-off is Express: its own timer chip is labelled.
  await expect(card.locator('.board-facts')).toContainText(/Express \d+:\d{2}/);
  await expect(card.locator('.board-facts')).not.toContainText('limit');
  await expect(card.locator('.board-bonus', { hasText: 'coins within par' })).toHaveText('+1 pt · +10 coins within par');
  await page.screenshot({ path: `${artifacts}sp1-order-board.png` });

  await page.locator(`[data-order-id="${drop.id}"] .accept`).click();
  await expect(page.locator('.board-active-row')).toHaveCount(1);
  // A drop-off is collected at accept: one box on the courier's back.
  await page.waitForFunction(() => window.__dm!.courier().packages === 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__dm!.boardOpen())).toBe(false);
  expect((await page.evaluate(() => window.__dm!.orders.active())).map((a) => a.order.id)).toEqual([drop.id]);

  // Walk-in stand-in: land inside the POI zone (radius 3 m), 2.5 m toward the HUB, and look down the street at eye
  // height, about 24 degrees right of the post, so the post sits left of the popup instead of behind it.
  await page.evaluate((id) => {
    const p = window.__dm!.poiPosition(id);
    const d = Math.hypot(p.x, p.z);
    const ux = p.x / d;
    const uz = p.z / d;
    window.__dm!.viewpoint({ x: p.x - ux * 2.5, y: p.y, z: p.z - uz * 2.5 }, { x: p.x + ux * 20 - uz * 10, y: p.y + 1.6, z: p.z + uz * 20 + ux * 10 });
  }, drop.poiId);
  const popup = page.locator('.popup').filter({ hasText: /Delivered!\s+\+\d+ pts?\b/ });
  await expect(popup).toBeVisible({ timeout: 10_000 });
  // toBeVisible counts opacity 0; wait for the fade-in to finish before the screenshot.
  await expect(popup).toHaveCSS('opacity', '1');
  await expect(popup.locator('.popup-line', { hasText: /^Within par\s+\+1 pt · \+10 coins$/ })).toBeVisible();
  const totals = await page.evaluate(() => window.__dm!.orders.totals());
  expect(totals.points).toBeGreaterThanOrEqual(1);
  expect(totals.deliveries).toBe(1);
  expect(await page.evaluate(() => window.__dm!.orders.active())).toEqual([]);
  await page.screenshot({ path: `${artifacts}sp1-delivered.png` });
  expect(errors).toEqual([]);
});

test('progress survives a reload', async ({ page }) => {
  await boot(page, SEED);
  const drop = await firstDropoff(page);
  expect(await page.evaluate((id) => window.__dm!.orders.accept(id), drop.id)).toBe('ok');
  await goToPoi(page, drop.poiId);
  await page.waitForFunction(() => window.__dm!.orders.totals().deliveries === 1, undefined, { timeout: 10_000 });
  const before = await page.evaluate(() => window.__dm!.orders.totals());
  expect(before.points).toBeGreaterThanOrEqual(1);
  await page.reload();
  await page.waitForFunction(() => window.__dm?.ready === true, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__dm!.orders.totals())).toEqual(before);
  await expect(page.locator('.hud-coins .hud-stat-value')).toHaveText(String(before.coins));
});

test('HUD shows the active order with distance', async ({ page }) => {
  const errors = await boot(page, SEED);
  const drop = await firstDropoff(page);
  expect(await page.evaluate((id) => window.__dm!.orders.accept(id), drop.id)).toBe('ok');
  const order = page.locator(`.hud-order[data-order-id="${drop.id}"]`);
  await expect(order).toBeVisible();
  await expect(order.locator('.hud-stage')).toContainText('Deliver to');
  await expect(order.locator('.hud-distance')).toHaveText(/^\d+ m$/);
  // Par counts down on every order; this seed's first Drop-off is Express, so its own timer shows beside it.
  await expect(order.locator('.hud-par')).toHaveText(/^Par \d+:\d{2} left$/);
  await expect(order.locator('.hud-timer:not(.hud-par)')).toHaveText(/^Express \d+:\d{2} left$/);
  const shown = Number((await order.locator('.hud-distance').textContent())!.replace(' m', ''));
  const { p, target } = await page.evaluate(
    (id) => ({ p: window.__dm!.player().position, target: window.__dm!.poiPosition(id) }),
    drop.poiId,
  );
  expect(Math.abs(shown - Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z))).toBeLessThanOrEqual(2);
  // Face the waypoint beam from the far side of the plaza for the screenshot.
  await page.evaluate((id) => {
    const t = window.__dm!.poiPosition(id);
    const d = Math.hypot(t.x, t.z);
    window.__dm!.viewpoint({ x: (-t.x / d) * 18, y: 0, z: (-t.z / d) * 18 + 4 }, { x: t.x, y: 10, z: t.z });
  }, drop.poiId);
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`render with HUB, POIs and a waypoint: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
  await page.screenshot({ path: `${artifacts}sp1-hud.png` });
  expect(errors).toEqual([]);
});

test('dev panel: backtick opens it, a sprintSpeed edit applies live, typing does not move the player', async ({ page }) => {
  const errors = await boot(page, GREYBOX);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const panel = page.locator('.dm-dev-panel');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(panel).toBeVisible();
  await expect(page.locator('.debug-overlay')).toBeVisible(); // ?debug=1 shows the overlay by default

  await panel.locator('.lil-title', { hasText: /^run$/ }).click();
  const field = panel.locator('.lil-controller', { hasText: 'sprintSpeed' }).locator('input');
  const before = await page.evaluate(() => window.__dm!.player().position);
  await field.fill('12');
  await field.press('KeyW'); // typed into the field: must not move the player
  await field.press('Enter');
  const typed = await page.evaluate(() => window.__dm!.player().position);
  expect(Math.hypot(before.x - typed.x, before.z - typed.z)).toBeLessThan(0.05);
  await page.keyboard.press('F3');
  await expect(page.locator('.debug-overlay')).toBeHidden();
  await page.keyboard.press('F3');
  await page.keyboard.press('Backquote');
  await expect(panel).toBeHidden();

  const tick0 = await page.evaluate(() => window.__dm!.tick);
  await page.keyboard.down('KeyW');
  await page.keyboard.press('ShiftLeft');
  await page.waitForFunction((t0) => window.__dm!.tick - t0 >= 45, tick0);
  const p = await page.evaluate(() => window.__dm!.player());
  await page.keyboard.up('KeyW');
  expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('dev panel screenshot', async ({ page }) => {
  await boot(page, GREYBOX);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 10);
  await page.keyboard.press('Backquote');
  await page.locator('.dm-dev-panel .lil-title', { hasText: /^run$/ }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${artifacts}sp1-devpanel.png` });
});

// ---- SP2: the generated city (the default map; ?map=city names it explicitly) ----

const CITY = '&map=city';

/** Lets the sim run `ticks` ticks, then waits for two more drawn frames (the city re-sorts and culls per frame). */
async function settle(page: Page, ticks = 3): Promise<void> {
  await waitTicks(page, ticks);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

test('city loads, renders and reports ready with no console errors', async ({ page }) => {
  const errors = await boot(page, CITY);
  await expect(page.locator('canvas.game-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 10);
  const p = await page.evaluate(() => window.__dm!.player());
  expect(p.mode).toBe('ground');
  expect(p.position.y).toBeGreaterThan(-0.05); // on the plaza paving, colliders paged in around the spawn
  const chunks = await page.evaluate(() => window.__dm!.loadedChunks());
  expect(chunks).toContain('0,0');
  expect(chunks.length).toBeLessThan(40); // paged: only the chunks around the player, not the whole 20 × 20 grid
  const stats = await page.evaluate(() => window.__dm!.cityStats());
  console.log(`city at spawn: rings ${JSON.stringify(stats)}, ${chunks.length} collider chunks`);
  expect(stats!.lod0).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__dm!.cityBoundsOk())).toBe(true);
  await page.screenshot({ path: `${artifacts}sp2-city-spawn.png` });
  expect(errors).toEqual([]);
});

test('draw calls ≤ drawCallBudget and triangles ≤ triangleBudget at every perf-route viewpoint', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  const { drawCallBudget, triangleBudget } = clientJson.graphics;
  const results: { feet: string; calls: number; triangles: number }[] = [];
  for (const [i, { feet, target }] of clientJson.perf.route.entries()) {
    await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [feet, target] as const);
    await settle(page);
    const info = await page.evaluate(() => window.__dm!.renderInfo());
    results.push({ feet: `${feet.x},${feet.y},${feet.z}`, ...info });
    console.log(`perf viewpoint ${i} (${feet.x}, ${feet.y}, ${feet.z}): ${info.calls} draw calls, ${info.triangles} triangles`);
    await page.screenshot({ path: `${artifacts}sp2-perf-${i}.png` });
  }
  for (const r of results) {
    expect(r.calls, `draw calls at ${r.feet}`).toBeLessThanOrEqual(drawCallBudget);
    expect(r.triangles, `triangles at ${r.feet}`).toBeLessThanOrEqual(triangleBudget);
    expect(r.calls, `nothing drawn at ${r.feet}`).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});

test('Review Focus 5: after teleporting 1,500 m, each LOD0 InstancedMesh bounding sphere contains all its active instance positions', async ({ page }) => {
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  const from = { x: -600, y: 0.02, z: -800 }; // a Hillside arterial crossing
  const to = { x: 400, y: 0.02, z: 400 }; // 1,562 m away
  await page.evaluate(([f]) => window.__dm!.viewpoint(f, { x: f.x + 100, y: 5, z: f.z }), [from] as const);
  await settle(page);
  expect(await page.evaluate(() => window.__dm!.cityBoundsOk())).toBe(true);
  await page.evaluate(([t]) => window.__dm!.viewpoint(t, { x: t.x + 300, y: 3, z: t.z }), [to] as const);
  await settle(page);
  expect(await page.evaluate(() => window.__dm!.cityStats()!.lod0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__dm!.cityBoundsOk())).toBe(true);
  const chunks = await page.evaluate(() => window.__dm!.loadedChunks());
  expect(chunks).toContain('4,4');
  expect(chunks).not.toContain('-7,-7');
  // Review Focus 1 on the way: the player lands on the street at the far end, not through unloaded ground.
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  expect((await page.evaluate(() => window.__dm!.player())).position.y).toBeGreaterThan(-0.05);
  expect(errors).toEqual([]);
});

test('sp2 city overview screenshot (high over the plaza)', async ({ page }) => {
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // High over the plaza's south side, looking north across it toward Downtown (NE) and Hillside (NW).
  await airShot(page, { x: 0, y: 90, z: 140 }, { x: 0, y: 0, z: -80 }, 'sp2-city-overview.png');
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`sp2 city overview: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(errors).toEqual([]);
});

test('sp2 Downtown screenshot (on a wall-run alley roof, looking along the alley)', async ({ page }) => {
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // On the north wall of downtown-alley-5 (roofs 20.69 m, alley floor x 554.8–575.2, z −502 to −498), at its west
  // end, looking east along the alley and down into it, with the rooftop rows and the plaza's zip lines beyond.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 556, y: 20.7, z: -503 }, { x: 590, y: -16, z: -500 }));
  await settle(page, 10);
  const p = await page.evaluate(() => window.__dm!.player());
  expect(p.mode).toBe('ground');
  expect(p.position.y).toBeGreaterThan(20); // standing on the roof
  await page.screenshot({ path: `${artifacts}sp2-downtown.png` });
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`sp2 downtown: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(errors).toEqual([]);
});

test('sp2 Harbor screenshot (on a crane jib, looking along its zip line over the container yards)', async ({ page }) => {
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // On the jib of harbor-crane-2 (top 35.69 m, x 250–253, z 908–960) near its inland end, looking west along its
  // zip line down to a yard stack at (79.35, 898), with the south quay apron and the water on the left.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 251.5, y: 35.7, z: 912 }, { x: 79.35, y: 0, z: 898 }));
  await settle(page, 10);
  const p = await page.evaluate(() => window.__dm!.player());
  expect(p.mode).toBe('ground');
  expect(p.position.y).toBeGreaterThan(35); // standing on the jib
  await page.screenshot({ path: `${artifacts}sp2-harbor.png` });
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`sp2 harbor: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(errors).toEqual([]);
});

test('sp2 Hillside screenshot (at the foot of a chute, looking up it to the top terrace)', async ({ page }) => {
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // In the chute lane of cell c1-1 (x −790 to −783), 8 m below the foot of hillside-c1-1-chute (which runs from the
  // 27 m top terrace's front edge at z −740 down to the ground at z −620), looking north up the slide; the terraces
  // (9, 18, 27 m) step up on the right.
  await page.evaluate(() => window.__dm!.viewpoint({ x: -786.5, y: 0, z: -612 }, { x: -786.5, y: 27, z: -740 }));
  await settle(page, 10);
  const p = await page.evaluate(() => window.__dm!.player());
  expect(p.mode).toBe('ground');
  expect(Math.abs(p.position.y)).toBeLessThan(0.05); // standing on the ground below the chute
  await page.screenshot({ path: `${artifacts}sp2-hillside.png` });
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`sp2 hillside: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(errors).toEqual([]);
});

test('sp2 Suburbs screenshot (high over the skatepark)', async ({ page }) => {
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // High over the skatepark's north-east part (its paving fills x −186…−14, z 214…386), looking south-west across
  // it: a funbox with its deck rail in front, the bowl on the right, the rail garden beyond, quarter pipes at the edges.
  await airShot(page, { x: -40, y: 28, z: 230 }, { x: -130, y: 0, z: 300 }, 'sp2-suburbs-skatepark.png');
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`sp2 suburbs skatepark: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(errors).toEqual([]);
});

test('sp2 POI screenshots (a balcony kit, a roof pad-and-zip kit, a street stall)', async ({ page }) => {
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // Generation-dependent ids (Task 13, re-picked by Task 14). poi-suburbs-05: a balcony 3.5 m up a house's south
  // facade, its two crate steps along the facade to the east of it; seen from the front yard to the south-east.
  const shots: [string, string, { x: number; y: number; z: number }, { x: number; y: number; z: number }][] = [
    ['poi-suburbs-05', 'sp2-poi-balcony.png', { x: 9, y: 0, z: 11 }, { x: 2, y: -1, z: 0 }],
    // poi-downtown-12: a 13.5 m roof, its pad on the sidewalk in front and its zip line running down the street
    ['poi-downtown-12', 'sp2-poi-pad-zip.png', { x: -12, y: 0, z: 20 }, { x: 0, y: -3.5, z: 0 }],
    // poi-harbor-01: a stall (counter) just beyond the sidewalk, the POI on the sidewalk in front of it
    ['poi-harbor-01', 'sp2-poi-stall.png', { x: 0, y: 0, z: 8.5 }, { x: 0, y: 0.35, z: 0 }],
  ];
  for (const [id, file, from, look] of shots) {
    const p = await page.evaluate((x) => window.__dm!.poiPosition(x), id);
    const feet = { x: p.x + from.x, y: from.y, z: p.z + from.z };
    await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [feet, { x: p.x + look.x, y: p.y + look.y, z: p.z + look.z }] as const);
    await settle(page, 10);
    await page.screenshot({ path: `${artifacts}${file}` });
  }
  expect(errors).toEqual([]);
});

test('the default (no ?map) loads the city; ?map=greybox loads the SP1 greybox', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  expect(await page.evaluate(() => window.__dm!.cityStats())).not.toBeNull();
  expect(await page.evaluate(() => window.__dm!.loadedChunks())).toContain('0,0');
  expect(errors).toEqual([]);

  const greyErrors = await boot(page, GREYBOX);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  expect(await page.evaluate(() => window.__dm!.cityStats())).toBeNull();
  expect(await page.evaluate(() => window.__dm!.loadedChunks())).toEqual([]);
  // A greybox-only feature: the city has no boost orbs yet.
  expect(await page.evaluate(() => window.__dm!.featurePosition('hub-orb-01'))).toBeTruthy();
  expect(greyErrors).toEqual([]);
});

/**
 * City board seed: its first board's first Drop-off goes to poi-suburbs-01, a street-level door 1,008 m from the HUB
 * by navmesh path (Medium on the city bands). Tests assert a Drop-off is present, so a map or generator change fails
 * here deterministically instead of flaking.
 */
const CITY_SEED = '&seed=2';

test('city: accept a drop-off at the kiosk and deliver it (navmesh distances, city bands)', async ({ page }) => {
  const errors = await boot(page, CITY_SEED); // no ?map: the city is the default
  const board = await page.evaluate(() => window.__dm!.orders.board());
  // Every card is priced from the navmesh POI table and banded on the city limits (500 / 1,200 m).
  const rows = new Map(poiTableJson.pois.map((r) => [r.id, r]));
  const ids = poiTableJson.pois.map((r) => r.id);
  const between = (a: string, b: string): number => poiTableJson.between[ids.indexOf(a)]![ids.indexOf(b)]!;
  const { shortMax, mediumMax } = ordersJson.bands.city;
  expect(board.length).toBe(ordersJson.board.size);
  for (const o of board) {
    const [a, b] = o!.steps.flatMap((s) => (s.kind === 'poi' ? [s.poiId] : []));
    const ra = rows.get(a!)!;
    const route =
      o!.type === 'dropoff' ? ra.fromHub : o!.type === 'pickup' ? ra.fromHub + ra.toHub : ra.fromHub + between(a!, b!) + rows.get(b!)!.toHub;
    expect(o!.routeDistance, `${o!.type} ${a}`).toBeCloseTo(route, 6);
    if (o!.type !== 'chain') {
      expect(o!.band).toBe(ra.fromHub < shortMax ? 'short' : ra.fromHub <= mediumMax ? 'medium' : 'long');
    }
  }
  const drop = await firstDropoff(page);
  expect(drop.poiId).toBe('poi-suburbs-01');

  // The HUB kiosk (0, 0, −8): stand at it and press E.
  const kiosk = await page.evaluate(() => window.__dm!.kiosk());
  expect(kiosk).toEqual({ x: 0, y: 0, z: -8 });
  await page.evaluate((k) => window.__dm!.viewpoint({ x: k.x, y: k.y, z: k.z + 2 }, { x: k.x, y: 1.5, z: k.z }), kiosk);
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.keyboard.press('KeyE');
  await expect(page.locator('.board-overlay')).toBeVisible();
  const card = page.locator(`.board-card[data-order-id="${drop.id}"]`);
  await expect(card.locator('.board-facts')).toContainText('Medium');
  await expect(card.locator('.board-facts')).toContainText(`${Math.round(rows.get(drop.poiId)!.fromHub)} m route`);
  await page.screenshot({ path: `${artifacts}sp2-city-order-board.png` });
  await card.locator('.accept').click();
  await expect(page.locator('.board-active-row')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-overlay')).toBeHidden();
  expect((await page.evaluate(() => window.__dm!.orders.active())).map((a) => a.order.id)).toEqual([drop.id]);

  // Teleport onto the POI (the pager loads its colliders first) and deliver.
  await goToPoi(page, drop.poiId);
  const popup = page.locator('.popup').filter({ hasText: /Delivered!\s+\+\d+ pts?\b/ });
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await expect(popup).toHaveCSS('opacity', '1');
  const totals = await page.evaluate(() => window.__dm!.orders.totals());
  expect(totals.deliveries).toBe(1);
  expect(await page.evaluate(() => window.__dm!.orders.active())).toEqual([]);
  expect((await page.evaluate(() => window.__dm!.player())).position.y).toBeGreaterThan(-0.05); // stood on the street
  await page.screenshot({ path: `${artifacts}sp2-city-delivered.png` });
  expect(errors).toEqual([]);
});

test('sp2 side view: the 700 m LOD cutoff is fogged out at the screen sides', async ({ page }) => {
  const errors = await boot(page, CITY);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // Above the Suburbs arterial looking east along it: the screen sides look ~56° off-axis, where props and render
  // regions end at 700 m horizontally (view depth only ~390 m). Radial fog must already be full there.
  await airShot(page, { x: -400, y: 60, z: 400 }, { x: 400, y: 0, z: 400 }, 'sp2-city-side.png');
  expect(errors).toEqual([]);
});

test('?perf=1 completes a short run (seconds=5) and reports a result', async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await boot(page, '&perf=1&perfSeconds=5'); // the city: the default map
  await expect(page.locator('.perf-overlay')).toContainText('Running');
  await page.waitForFunction(() => window.__dm?.perf() != null, undefined, { timeout: 60_000 });
  const r = await page.evaluate(() => window.__dm!.perf()!);
  console.log(`perf result (swiftshader): ${JSON.stringify(r)}`);
  expect(r.seconds).toBe(5);
  expect(r.frames).toBeGreaterThan(0);
  expect(r.viewpointSeconds).toBeCloseTo(5 / clientJson.perf.route.length, 9);
  expect(r.p95TargetMs).toBe(clientJson.perf.p95TargetMs);
  // Five seconds can't reach minFrames: the result says so rather than passing or failing.
  expect(r.minFrames).toBe(clientJson.perf.minFrames);
  expect(r.tooFewFrames).toBe(r.frames < r.minFrames);
  expect(r.tooFewFrames).toBe(true);
  expect(r.pass).toBe(false);
  expect(r.elapsedSeconds).toBeGreaterThanOrEqual(5);
  expect(r.hiddenDuringRun).toBe(false);
  expect(r.canvas.width).toBeGreaterThan(0);
  expect(r.canvas.height).toBeGreaterThan(0);
  expect(r.warmupSeconds).toBe(clientJson.perf.warmupSeconds);
  expect(r.teleportSkipFrames).toBe(clientJson.perf.teleportSkipFrames);
  // One entry per route viewpoint; the counted frames add up (very slow headless frames may leave some entries empty).
  expect(r.viewpoints.map((v) => v.feet)).toEqual(clientJson.perf.route.map((v) => v.feet));
  expect(r.viewpoints.reduce((n, v) => n + v.frames, 0)).toBe(r.frames);
  expect(r.p50Ms).toBeGreaterThan(0);
  expect(r.p50Ms).toBeLessThanOrEqual(r.p95Ms);
  expect(r.p95Ms).toBeLessThanOrEqual(r.p99Ms);
  expect(r.p99Ms).toBeLessThanOrEqual(r.maxMs);
  expect(r.fpsAtP95).toBeCloseTo(1000 / r.p95Ms, 6);
  expect(r.maxDrawCalls).toBeGreaterThan(0);
  expect(r.maxDrawCalls).toBeLessThanOrEqual(clientJson.graphics.drawCallBudget);
  expect(r.maxTriangles).toBeGreaterThan(0);
  expect(r.cityUpdateP95Ms).toBeGreaterThan(0); // the city map was loaded and timed
  expect(r.gpu.length).toBeGreaterThan(0);
  expect(r.url).toContain('perf=1');
  expect(r.pixelRatio).toBeGreaterThan(0);
  // The run ended at the last viewpoint (not left at the spawn): the courier stands near its feet, glided toward its target.
  const last = clientJson.perf.route.at(-1)!;
  const at = (await page.evaluate(() => window.__dm!.player())).position;
  expect(Math.hypot(at.x - last.feet.x, at.z - last.feet.z)).toBeLessThan(0.625 * clientJson.perf.speed + 1);
  expect(at.x).toBeLessThanOrEqual(last.feet.x + 1e-6); // the last entry's target is toward -x
  const panel = page.locator('.perf-overlay');
  await expect(panel.locator('.perf-title')).toContainText('TOO FEW FRAMES');
  await expect(panel).toContainText('dropped frame');
  await expect(panel).toContainText('warm-up');
  await expect(panel).toContainText('p95 by viewpoint');
  await page.screenshot({ path: `${artifacts}sp2-perf-result.png` });
  await page.getByRole('button', { name: 'Copy result' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as typeof r;
  expect(copied.frames).toBe(r.frames);
  expect(errors).toEqual([]);
});
