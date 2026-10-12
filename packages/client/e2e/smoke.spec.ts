import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import clientJson from '../../../config/client.json' with { type: 'json' };
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

test('loads, renders the greybox and reports ready', async ({ page }) => {
  const errors = await boot(page);
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

test('holding W + Shift for 1 s runs at ~8 m/s', async ({ page }) => {
  // Timed in simulation ticks, not wall time: headless Chromium renders on the CPU and can drop below
  // 30 / maxStepsPerFrame fps, where the fixed stepper drops time by design.
  await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const { start, tick0 } = await page.evaluate(() => ({ start: window.__dm!.player().position, tick0: window.__dm!.tick }));
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction((t0) => window.__dm!.tick - t0 >= 30, tick0); // 1 s of sim time
  const { p, ticks } = await page.evaluate((t0) => ({ p: window.__dm!.player(), ticks: window.__dm!.tick - t0 }), tick0);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  const speed = Math.hypot(p.velocity.x, p.velocity.z);
  const moved = Math.hypot(p.position.x - start.x, p.position.z - start.z);
  console.log(`run: speed ${speed.toFixed(2)} m/s, moved ${moved.toFixed(2)} m in ${ticks} ticks`);
  expect(speed).toBeGreaterThanOrEqual(7.5);
  expect(speed).toBeLessThanOrEqual(8.5);
  expect(moved).toBeGreaterThan(5);
});

test('draw calls stay under the budget', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`render: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(info.calls).toBeGreaterThan(0);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
});

test('a collected orb disappears', async ({ page }) => {
  await boot(page);
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
  const errors = await boot(page);
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

test('third-person view shows the courier', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // East edge of the plaza facing down the playground line, then a short sprint so the shot has motion.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: -1 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await waitTicks(page, 12);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await waitTicks(page, 2);
  const cam = await page.evaluate(() => window.__dm!.camera());
  console.log(`chase camera: distance ${cam.distance.toFixed(2)} m, courier at NDC (${cam.courierNdc.x.toFixed(2)}, ${cam.courierNdc.y.toFixed(2)})`);
  expect(cam.courierHidden).toBe(false);
  expect(cam.distance).toBeGreaterThan(clientJson.camera.chase.distance - 0.5);
  // R9: centre-bottom of the frame, horizontally central, the whole courier (head included) below the middle.
  expect(Math.abs(cam.courierNdc.x)).toBeLessThan(0.2);
  expect(cam.courierNdc.y).toBeLessThan(0);
  expect(cam.courierNdc.y).toBeGreaterThan(-0.8);
  expect(cam.courierTopNdc.y).toBeLessThan(0);
  // No centre crosshair in third person (R9).
  await expect(page.locator('.crosshair')).toHaveCount(0);
  expect(await page.evaluate(() => window.__dm!.cameraInsideSolid())).toBe(false);
  await page.screenshot({ path: `${artifacts}sp1-third-person.png` });
  expect(errors).toEqual([]);
});

test('camera stays outside geometry in the crouch tunnel and against a wall', async ({ page }) => {
  const errors = await boot(page);
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
  const errors = await boot(page);
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
  const errors = await boot(page);
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
  const errors = await boot(page);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  await airShot(page, { x: 0, y: 120, z: 200 }, { x: 0, y: 0, z: 0 }, 'sp1-city-overview.png');
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`city overview: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
  expect(errors).toEqual([]);
});

test('playground screenshot', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  // Above the plaza's south-east corner, looking along the playground line toward the tower.
  await airShot(page, { x: 40, y: 18, z: 42 }, { x: 92, y: 2, z: -2 }, 'sp1-playground.png');
  expect(errors).toEqual([]);
});

/**
 * Board seed for the delivery tests. With the Task 18 city (21 POIs) its first board's first Drop-off is an Express
 * drop-off to harbor-poi-05, a street door. Tests assert a Drop-off is present, so a map or generator change
 * fails here deterministically instead of flaking.
 */
const SEED = '&seed=3';

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
  await page.screenshot({ path: `${artifacts}sp1-order-board.png` });

  await page.locator(`[data-order-id="${drop.id}"] .accept`).click();
  await expect(page.locator('.board-active-row')).toHaveCount(1);
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
  const errors = await boot(page);
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
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction((t0) => window.__dm!.tick - t0 >= 45, tick0);
  const p = await page.evaluate(() => window.__dm!.player());
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('dev panel screenshot', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 10);
  await page.keyboard.press('Backquote');
  await page.locator('.dm-dev-panel .lil-title', { hasText: /^run$/ }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${artifacts}sp1-devpanel.png` });
});
