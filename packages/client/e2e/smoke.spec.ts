import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import clientJson from '../../../config/client.json' with { type: 'json' };
import type {} from '../src/game/debugHooks';

const artifacts = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });
/** SP3 playtest screenshots are committed (plan Global Constraints: the phone, a delivery, the hospital spawn). */
const sp3 = fileURLToPath(new URL('../../../docs/playtest/sp3/', import.meta.url));
mkdirSync(sp3, { recursive: true });
/** SP4 playtest screenshots are committed too (the four rides, the HUD arrow and fuel, the Map routes, Garage, a pump). */
const sp4 = fileURLToPath(new URL('../../../docs/playtest/sp4/', import.meta.url));
mkdirSync(sp4, { recursive: true });

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
  // Let the player settle at the hospital spawn and a few frames draw.
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
  await boot(page);
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
  await boot(page);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`render: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(info.calls).toBeGreaterThan(0);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
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
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // Open ground east of the map centre, facing east, then a short sprint so the shot has motion.
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

test('camera stays outside geometry against a wall', async ({ page }) => {
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

test('courier model loads and animates (mixer time advances)', async ({ page }) => {
  const errors = await boot(page);
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

test('a missing model falls back to the capsule without console errors (Review Focus 4)', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  // A wrong Pages base path: the .glb request 404s. Chromium itself logs the failed fetch; any other error fails.
  await page.route('**/*.glb', (r) => r.fulfill({ status: 404, body: 'not found' }));
  const errors = await boot(page);
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
  const errors = await boot(page);
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
  const errors = await boot(page);
  await page.waitForFunction(() => (window.__dm?.tick ?? 0) > 5);
  await airShot(page, { x: 0, y: 120, z: 200 }, { x: 0, y: 0, z: 0 }, 'sp1-city-overview.png');
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`city overview: ${info.calls} draw calls, ${info.triangles} triangles`);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
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
  await page.keyboard.press('ShiftLeft');
  await page.waitForFunction((t0) => window.__dm!.tick - t0 >= 45, tick0);
  const p = await page.evaluate(() => window.__dm!.player());
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

// ---------------------------------------------------------------------------------------------------------------------
// SP3: the core loop. Long sim windows run synchronously through __dm.advance (no rendering in between), so they do not
// depend on headless frame rate. A fixed ?seed keeps the offer stream reproducible.
// ---------------------------------------------------------------------------------------------------------------------

const TICK_RATE = 30;
const SEED = '&seed=7';
/** The first offer arrives within offers.maxIntervalSeconds (30 s); a little slack on top. */
const FIRST_OFFER_S = 35;
/** Ticks to stand at a food pickup: the prep countdown (orders.json prep.foodSeconds, 6 s) plus a second of slack. */
const PICKUP_TICKS = 7 * TICK_RATE;

/** Runs sim ticks until an offer is on the phone (at most `maxSeconds`); returns the sim seconds it took, or -1. */
const advanceUntilOffer = (page: Page, maxSeconds: number): Promise<number> =>
  page.evaluate(
    ([max, rate]) => {
      for (let i = 0; i < max * rate; i++) {
        if (window.__dm!.offers().length > 0) return i / rate;
        window.__dm!.advance(1);
      }
      return window.__dm!.offers().length > 0 ? max : -1;
    },
    [maxSeconds, TICK_RATE] as const,
  );

/** Hides the ?debug overlay (F3) so the SP3 playtest shots don't show headless fps. */
async function hideOverlay(page: Page): Promise<void> {
  await page.keyboard.press('F3');
  await expect(page.locator('.debug-overlay')).toBeHidden();
}

/** Waits for an offer and accepts it with Y; returns the accepted order id. */
async function acceptWithY(page: Page): Promise<string> {
  expect(await advanceUntilOffer(page, FIRST_OFFER_S)).toBeGreaterThanOrEqual(0);
  const id = await page.evaluate(() => window.__dm!.offers()[0]!.order.id);
  await page.keyboard.press('KeyY');
  await page.waitForFunction(() => window.__dm!.active().length === 1);
  return id;
}

/** Stands the courier on a POI's ground point (inside its zone), looking diagonally past it. */
async function standAt(page: Page, poiId: string): Promise<void> {
  await page.evaluate((id) => {
    const p = window.__dm!.poiPosition(id);
    window.__dm!.viewpoint(p, { x: p.x + 6, y: p.y + 1.2, z: p.z + 6 });
  }, poiId);
}

test('spawns at a hospital inside its safe zone', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  const { hospitals, zone, pos } = await page.evaluate(() => ({
    hospitals: window.__dm!.hospitals(),
    zone: window.__dm!.safeZone(),
    pos: window.__dm!.player().position,
  }));
  expect(hospitals.length).toBe(4);
  const first = hospitals[0]!;
  expect(zone).toBe(first.id);
  expect(Math.hypot(pos.x - first.center.x, pos.z - first.center.z)).toBeLessThan(first.safeRadius);
  await expect(page.locator('.hud-safe')).toBeVisible();
  // The courier spawns facing the street (spawnYaw); turn the camera back so the shot shows the hospital block.
  await page.evaluate(([c, p]) => window.__dm!.setLook(Math.atan2(-(c.x - p.x), -(c.z - p.z)), 0), [first.center, pos] as const);
  await waitCameraSettled(page);
  await page.screenshot({ path: `${sp3}sp3-hospital-spawn.png` });
  expect(errors).toEqual([]);
});

test('an offer appears within one arrival interval of sim time and Y accepts it', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const took = await advanceUntilOffer(page, FIRST_OFFER_S);
  console.log(`first offer after ${took.toFixed(2)} s of sim`);
  expect(took).toBeGreaterThanOrEqual(0);
  const id = await page.evaluate(() => window.__dm!.offers()[0]!.order.id);
  await page.keyboard.press('KeyY');
  await page.waitForFunction(() => window.__dm!.active().length === 1);
  expect(await page.evaluate(() => window.__dm!.active()[0]!.order.id)).toBe(id);
  await expect(page.locator('.popup-title', { hasText: 'Offer accepted' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('teleport to the pickup then the dropoff completes the order with points', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  await acceptWithY(page);
  const order = await page.evaluate(() => window.__dm!.active()[0]!.order);
  await standAt(page, order.pickupPoiId);
  await page.evaluate((n) => window.__dm!.advance(n), PICKUP_TICKS);
  expect(await page.evaluate(() => window.__dm!.active()[0]?.pickedUpAt ?? null)).not.toBeNull();
  // Let the "accepted" and "picked up" popups expire (wall-clock, 3.5 s) so the delivery popup stands alone in the shot.
  await expect(page.locator('.popup')).toHaveCount(0, { timeout: 10_000 });
  // Teleport 7 m short of the dropoff (on the pickup's side, along the street axis: doors face axis-aligned streets),
  // facing it, then walk in: the chase camera frames the courier in front of the marker rather than inside it.
  await page.evaluate(([drop, pick]) => {
    const t = window.__dm!.poiPosition(drop);
    const p = window.__dm!.poiPosition(pick);
    const alongX = Math.abs(p.x - t.x) >= Math.abs(p.z - t.z);
    const feet = alongX ? { x: t.x + Math.sign(p.x - t.x) * 7, y: t.y, z: t.z } : { x: t.x, y: t.y, z: t.z + Math.sign(p.z - t.z) * 7 };
    window.__dm!.viewpoint(feet, { x: t.x, y: t.y + 1.2, z: t.z });
  }, [order.dropoffPoiId, order.pickupPoiId] as const);
  await page.keyboard.down('KeyW');
  const walked = await page.evaluate(
    ([rate]) => {
      for (let i = 0; i < 5 * rate; i++) {
        window.__dm!.advance(1);
        if (window.__dm!.totals().deliveries > 0) return i / rate;
      }
      return -1;
    },
    [TICK_RATE] as const,
  );
  await page.keyboard.up('KeyW');
  console.log(`walked into the dropoff zone in ${walked.toFixed(2)} s`);
  expect(walked).toBeGreaterThanOrEqual(0);
  const totals = await page.evaluate(() => window.__dm!.totals());
  console.log(`delivered ${order.kind} ${order.id}: ${totals.points} points, ${totals.coins} coins`);
  expect(totals.deliveries).toBe(1);
  expect(totals.points).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__dm!.active().length)).toBe(0);
  const delivered = page.locator('.popup', { hasText: 'Delivered!' });
  await expect(delivered).toBeVisible();
  await expect(page.locator('.popup')).toHaveCount(1);
  await waitTicks(page, 4);
  // Fully faded in (the popup animation's first 8 %).
  await expect.poll(() => delivered.evaluate((e) => getComputedStyle(e).opacity), { timeout: 3_000 }).toBe('1');
  await page.screenshot({ path: `${sp3}sp3-delivered.png` });
  expect(errors).toEqual([]);
});

test('cancelling starts the lockout and no offer appears for 45 s', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const id = await acceptWithY(page);
  // The lockout runs from the sim time of the cancel; the render loop keeps ticking between evaluate calls, so the
  // window below is anchored to the cancel's tick, not to when the check starts.
  const cancel = await page.evaluate(
    (o) => ({ result: window.__dm!.cancel(o), tick: window.__dm!.tick, offers: window.__dm!.offers().map((x) => x.order.id) }),
    id,
  );
  expect(cancel.result).toBe('ok');
  await expect(page.locator('.popup-title', { hasText: 'Order cancelled' })).toBeVisible();
  await expect(page.locator('.hud-lockout')).toBeVisible();
  const r = await page.evaluate(
    ([rate, t0, before]) => {
      // Offers already on the phone at the cancel may stay until they expire; anything else is new.
      const seen = new Set(before);
      const fresh = new Set<string>(window.__dm!.offers().filter((o) => !seen.has(o.order.id)).map((o) => o.order.id));
      // The rest of the 45 s lockout, tick by tick (offers live 25 s, so one that came while the render loop ran the
      // first ticks would still be on the phone above).
      while (window.__dm!.tick < t0 + 45 * rate) {
        window.__dm!.advance(1);
        for (const o of window.__dm!.offers()) if (!seen.has(o.order.id)) fresh.add(o.order.id);
      }
      const lockedTicks = window.__dm!.tick - t0;
      // Not vacuous: at the same spot offers do arrive once the lockout is over (within one arrival interval).
      let resumedAfter = -1;
      for (let i = 0; i < 20 * rate; i++) {
        window.__dm!.advance(1);
        if (window.__dm!.offers().some((o) => !seen.has(o.order.id))) {
          resumedAfter = i / rate;
          break;
        }
      }
      return { fresh: fresh.size, lockedTicks, resumedAfter };
    },
    [TICK_RATE, cancel.tick, cancel.offers] as const,
  );
  console.log(`lockout: ${r.fresh} new offers in its ${r.lockedTicks} ticks, offers resumed ${r.resumedAfter.toFixed(2)} s after`);
  expect(r.lockedTicks).toBe(45 * TICK_RATE);
  expect(r.fresh).toBe(0);
  expect(r.resumedAfter).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.hud-lockout')).toBeHidden();
  expect(errors).toEqual([]);
});

test('dev panel Vehicles: Owned boxes, locked while riding; debug hooks ride, vehicles, setCoins, route', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  expect(await page.evaluate(() => window.__dm!.vehicles().map((v) => v.tier))).toEqual(['skateboard', 'bicycle', 'motorbike', 'car']);
  await page.evaluate(() => window.__dm!.ride('motorbike'));
  expect(await page.evaluate(() => window.__dm!.player().riding)).toBe('motorbike');
  await page.evaluate(() => window.__dm!.setCoins(40));
  expect(await page.evaluate(() => window.__dm!.totals().coins)).toBe(40);
  expect(await page.evaluate(() => window.__dm!.route().points)).toEqual([]);
  await page.keyboard.press('Backquote');
  const box = (tier: string) => page.locator('.dm-dev-panel .lil-controller', { hasText: `Owned · ${tier}` }).locator('input');
  await expect(box('motorbike')).toBeDisabled();
  await expect(box('motorbike')).toBeChecked();
  await expect(box('car')).toBeEnabled();
  await box('car').uncheck();
  expect(await page.evaluate(() => window.__dm!.vehicles().map((v) => v.tier))).toEqual(['skateboard', 'bicycle', 'motorbike']);
  await box('car').check();
  expect(await page.evaluate(() => window.__dm!.vehicles().find((v) => v.tier === 'car')?.fuel)).toBe(1);
  await page.locator('.dm-dev-panel .lil-controller', { hasText: '+500 coins' }).locator('button, .lil-name').first().click();
  expect(await page.evaluate(() => window.__dm!.totals().coins)).toBe(540);
  await page.locator('.dm-dev-panel .lil-controller', { hasText: 'Reset progress' }).locator('button, .lil-name').first().click();
  expect(await page.evaluate(() => window.__dm!.player().riding)).toBeNull();
  expect(await page.evaluate(() => window.__dm!.totals().coins)).toBe(0);
  expect(await page.evaluate(() => window.__dm!.vehicles().map((v) => v.spot))).toEqual(['carried', 'parked', 'parked', 'parked']);
  expect(errors).toEqual([]);
});

test('phone: Tab opens Orders, Map and Wallet render; Esc closes', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  expect(await advanceUntilOffer(page, FIRST_OFFER_S)).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__dm!.phoneOpen());
  await expect(page.locator('.phone')).toBeVisible();
  await expect(page.locator('.phone-title')).toHaveText('Orders');
  await expect(page.locator('.hud')).toBeVisible(); // behind the dimmed backdrop
  await expect(page.locator('.phone-offer').first()).toBeVisible();
  // The player stands still while the phone is up.
  const { start, tick0 } = await page.evaluate(() => ({ start: window.__dm!.player().position, tick0: window.__dm!.tick }));
  await page.keyboard.down('KeyW');
  await page.waitForFunction((t0) => window.__dm!.tick - t0 >= 15, tick0);
  await page.keyboard.up('KeyW');
  const end = await page.evaluate(() => window.__dm!.player().position);
  expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeLessThan(0.05);
  await page.screenshot({ path: `${sp3}sp3-phone-orders.png` });
  // Accept from the phone: the order moves to Active and the Map shows its target.
  await page.locator('.phone-offer').first().locator('.phone-accept').click();
  await expect(page.locator('.phone-active-order')).toHaveCount(1);
  await page.locator('.phone-nav-btn[data-app="map"]').click();
  await expect(page.locator('.phone-title')).toHaveText('Map');
  await expect(page.locator('.phone-map-canvas')).toBeVisible();
  await waitTicks(page, 6);
  await page.screenshot({ path: `${sp3}sp3-phone-map.png` });
  await page.locator('.phone-nav-btn[data-app="wallet"]').click();
  await expect(page.locator('.phone-title')).toHaveText('Wallet');
  await expect(page.locator('.phone-note')).toHaveText('GAME rewards arrive with the reward program (spec §9)');
  await page.screenshot({ path: `${sp3}sp3-phone-wallet.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());
  await expect(page.locator('.phone')).toBeHidden();
  // Tab again opens it (on Orders), and Tab in the phone closes it without reopening.
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__dm!.phoneOpen());
  await expect(page.locator('.phone-title')).toHaveText('Orders');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());
  const t1 = await page.evaluate(() => window.__dm!.tick);
  await page.waitForFunction((t) => window.__dm!.tick - t >= 10, t1);
  expect(await page.evaluate(() => window.__dm!.phoneOpen())).toBe(false);
  expect(errors).toEqual([]);
});

test('HUD screenshot with an active order', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  await acceptWithY(page);
  // Picked up, so the HUD shows the order's timer and the beam leads to the dropoff.
  const order = await page.evaluate(() => window.__dm!.active()[0]!.order);
  await standAt(page, order.pickupPoiId);
  await page.evaluate((n) => window.__dm!.advance(n), PICKUP_TICKS);
  expect(await page.evaluate(() => window.__dm!.active()[0]?.pickedUpAt ?? null)).not.toBeNull();
  // A few metres on from the pickup toward the dropoff, looking at it, so the pickup's marker is behind the camera.
  await page.evaluate((id) => {
    const me = window.__dm!.player().position;
    const t = window.__dm!.poiPosition(id);
    const d = Math.hypot(t.x - me.x, t.z - me.z);
    const feet = { x: me.x + ((t.x - me.x) / d) * 6, y: me.y, z: me.z + ((t.z - me.z) / d) * 6 };
    window.__dm!.viewpoint(feet, { x: t.x, y: me.y + 1.6, z: t.z });
  }, order.dropoffPoiId);
  expect(await page.evaluate(() => window.__dm!.active()[0]?.pickedUpAt ?? null)).not.toBeNull();
  await expect(page.locator('.hud-active')).not.toBeEmpty();
  await waitCameraSettled(page);
  await page.screenshot({ path: `${sp3}sp3-hud.png` });
  expect(errors).toEqual([]);
});

test('no parkour: speed never exceeds 12 m/s on foot over a 10 s sprint', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // Open ground east of the map centre, facing east (as the third-person test).
  await page.evaluate(() => window.__dm!.viewpoint({ x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: -1 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.keyboard.down('KeyW');
  await page.keyboard.press('ShiftLeft');
  // Every tick of the 10 s is sampled: one synchronous run, nothing steps in between.
  const speeds = await page.evaluate(([rate]) => window.__dm!.advance(10 * rate), [TICK_RATE] as const);
  await page.keyboard.up('KeyW');
  const max = Math.max(...speeds);
  console.log(`10 s sprint: ${speeds.length} ticks, max horizontal speed ${max.toFixed(3)} m/s`);
  expect(speeds.length).toBe(10 * TICK_RATE);
  expect(max).toBeGreaterThan(7); // it did run
  expect(max).toBeLessThanOrEqual(12 + 1e-6);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// SP4: vehicles. Driving is timed in sim ticks (__dm.advance with the keys held), never in wall time.
// ---------------------------------------------------------------------------------------------------------------------

type P = { x: number; y: number; z: number };
/** The look yaw facing from `a` toward `b` (yaw 0 faces −Z, as the chase camera's lookDirection). */
const yawTo = (a: P, b: P): number => Math.atan2(-(b.x - a.x), -(b.z - a.z));
const flat = (a: P, b: P): number => Math.hypot(a.x - b.x, a.z - b.z);
const player = (page: Page) => page.evaluate(() => window.__dm!.player());
const vehicle = (page: Page, tier: string) =>
  page.evaluate((t) => window.__dm!.vehicles().find((v) => v.tier === t)!, tier);

/** On foot at `feet` looking at `target`, then on `tier` (parked just ahead and mounted), settled on the ground. */
async function rideFrom(page: Page, tier: 'skateboard' | 'bicycle' | 'motorbike' | 'car', feet: P, target: P): Promise<void> {
  await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [feet, target] as const);
  await page.evaluate(() => window.__dm!.advance(3)); // land on foot
  await page.evaluate((t) => window.__dm!.ride(t), tier);
  await page.evaluate(() => window.__dm!.advance(3)); // the ride settles on the ground
  expect((await player(page)).riding).toBe(tier);
}

/** Holds `keys` for `ticks` sim ticks (synchronous); returns the horizontal speed after each tick. */
async function hold(page: Page, keys: string[], ticks: number): Promise<number[]> {
  for (const k of keys) await page.keyboard.down(k);
  const speeds = await page.evaluate((n) => window.__dm!.advance(n), ticks);
  for (const k of keys) await page.keyboard.up(k);
  return speeds;
}

/** Handbrake (Space) until the ride is stopped (riding.stoppedSpeed, 0.5 m/s), at most 10 s of sim. */
async function brakeToStop(page: Page): Promise<void> {
  await page.keyboard.down('Space');
  const stopped = await page.evaluate(
    ([rate]) => {
      for (let i = 0; i < 10 * rate; i++) {
        window.__dm!.advance(1);
        const v = window.__dm!.player().velocity;
        if (Math.hypot(v.x, v.z) <= 0.05) return true;
      }
      return false;
    },
    [TICK_RATE] as const,
  );
  await page.keyboard.up('Space');
  expect(stopped).toBe(true);
}

/** Presses F and waits until the courier rides `want` (null: on foot); F mounts and dismounts on the next tick. */
async function pressF(page: Page, want: string | null): Promise<void> {
  await page.keyboard.press('KeyF');
  await page.waitForFunction((w) => window.__dm!.player().riding === w, want);
}

/**
 * Runs sim until a package offer (Fragile ones only when `fragile`) is on the phone, at most `maxSeconds`; returns its
 * id, or null.
 */
const advanceUntilPackageOffer = (page: Page, maxSeconds: number, fragile = false): Promise<string | null> =>
  page.evaluate(
    ([max, rate, onlyFragile]) => {
      for (let i = 0; i < max * rate; i++) {
        const hit = window.__dm!
          .offers()
          .find((o) => o.order.kind === 'package' && (!onlyFragile || o.order.modifier === 'fragile'));
        if (hit) return hit.order.id;
        window.__dm!.advance(1);
      }
      return null;
    },
    [maxSeconds, TICK_RATE, fragile] as const,
  );

/**
 * Rides the current vehicle into a POI's zone: placed 2 m from the door on the road side (from `fromPoi`, along the
 * street axis as the SP3 delivery test walks in), facing the door, stopped.
 */
async function rideInto(page: Page, poiId: string, fromPoiId: string): Promise<void> {
  await page.evaluate(
    ([id, from]) => {
      const t = window.__dm!.poiPosition(id);
      const p = window.__dm!.poiPosition(from);
      const alongX = Math.abs(p.x - t.x) >= Math.abs(p.z - t.z);
      const at = alongX ? { x: t.x + Math.sign(p.x - t.x) * 2, y: t.y + 0.05, z: t.z } : { x: t.x, y: t.y + 0.05, z: t.z + Math.sign(p.z - t.z) * 2 };
      window.__dm!.teleport(at);
    },
    [poiId, fromPoiId] as const,
  );
  await page.evaluate(() => window.__dm!.advance(10));
}

test('F at the spawn bay mounts the car; 12 s of W reaches 28 m/s and never more', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const car = await vehicle(page, 'car');
  expect(car.spot).toBe('parked');
  const hospital = (await page.evaluate(() => window.__dm!.hospitals()))[0]!;
  expect(flat(car.position, hospital.center)).toBeLessThan(hospital.safeRadius + 10); // at the spawn hospital's bay
  // On foot 2 m off the car's side (nearer the car than the motorbike in the next slot), then F.
  const feet = { x: car.position.x, y: 0, z: car.position.z - 2 };
  await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [feet, { ...car.position, y: 1 }] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  await pressF(page, 'car');
  // Down the street (+Z: camera-relative steering, so the look points the way), 12 s of W, every tick sampled.
  await page.evaluate((y) => window.__dm!.setLook(y, -0.2), yawTo(car.position, { x: car.position.x, y: 0, z: 300 }));
  const speeds = await hold(page, ['KeyW'], 12 * TICK_RATE);
  const max = Math.max(...speeds);
  const reachedAt = speeds.findIndex((s) => s >= 28 - 1e-3) / TICK_RATE;
  console.log(`car, 12 s of W: max ${max.toFixed(4)} m/s, 28 m/s from ${reachedAt.toFixed(2)} s, end ${speeds.at(-1)!.toFixed(3)} m/s`);
  expect(speeds.length).toBe(12 * TICK_RATE);
  expect(reachedAt).toBeGreaterThan(0);
  expect(speeds.at(-1)!).toBeGreaterThanOrEqual(28 - 1e-3);
  expect(max).toBeLessThanOrEqual(28 + 1e-6);
  expect(errors).toEqual([]);
});

test('the car stops at an alley mouth; the motorbike rides through', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // alley-1--2-d (expandGreybox, seed 1): x 75..94, z −77..−73, buildings on both sides; its mouth (x = 94) opens on
  // the avenue at x = 100, beside the spawn bay. Start on the avenue facing west into it.
  const start = { x: 101, y: 0, z: -75 };
  const west = { x: 60, y: 1.6, z: -75 };
  // The motorbike first (the car left at the mouth would block it): through the mouth and well into the alley.
  await rideFrom(page, 'motorbike', start, west);
  await hold(page, ['KeyW'], 2 * TICK_RATE);
  const bike = await player(page);
  console.log(`motorbike after 2 s: x ${bike.position.x.toFixed(2)}, z ${bike.position.z.toFixed(2)}, speed ${Math.hypot(bike.velocity.x, bike.velocity.z).toFixed(2)} m/s`);
  expect(bike.position.x).toBeLessThan(88);
  expect(bike.position.x).toBeGreaterThan(75);
  expect(Math.abs(bike.position.z + 75)).toBeLessThan(1.5);
  await brakeToStop(page);
  await pressF(page, null); // parked inside the alley, past the mouth

  // The car from the same spot: held at the mouth by the access wall, however long W is held.
  await rideFrom(page, 'car', start, west);
  await hold(page, ['KeyW'], 5 * TICK_RATE);
  const car = await player(page);
  console.log(`car at the alley mouth: x ${car.position.x.toFixed(3)}, speed ${Math.hypot(car.velocity.x, car.velocity.z).toFixed(3)} m/s`);
  expect(car.position.x).toBeGreaterThanOrEqual(94);
  expect(car.position.x).toBeLessThan(95);
  expect(Math.hypot(car.velocity.x, car.velocity.z)).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('the bicycle climbs the steep lane; the skateboard is stopped by it', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // town-steep-lane: x −260.5..−253.5, z −230.5..−193.5, rising 5 m to the terrace toward −Z.
  const start = { x: -257, y: 0, z: -188 };
  const up = { x: -257, y: 5, z: -240 };
  await rideFrom(page, 'skateboard', start, up);
  await hold(page, ['KeyW'], 5 * TICK_RATE);
  const board = await player(page);
  console.log(`skateboard at the lane: z ${board.position.z.toFixed(3)}, y ${board.position.y.toFixed(3)}`);
  expect(board.position.z).toBeGreaterThan(-193.5);
  expect(board.position.y).toBeLessThan(0.2);

  await page.evaluate((s) => window.__dm!.teleport({ ...s, y: 0.05 }), start); // back to the start, still on the board
  await page.evaluate(() => window.__dm!.advance(5));
  await page.evaluate((t) => window.__dm!.ride(t), 'bicycle' as const);
  await page.evaluate(() => window.__dm!.advance(3));
  expect((await player(page)).riding).toBe('bicycle');
  await page.keyboard.down('KeyW');
  const took = await page.evaluate(
    ([rate]) => {
      for (let i = 0; i < 20 * rate; i++) {
        window.__dm!.advance(1);
        const p = window.__dm!.player().position;
        if (p.z < -231 && p.y > 4.8) return i / rate;
      }
      return -1;
    },
    [TICK_RATE] as const,
  );
  await page.keyboard.up('KeyW');
  const top = await player(page);
  console.log(`bicycle up the steep lane in ${took.toFixed(2)} s: at (${top.position.x.toFixed(1)}, ${top.position.y.toFixed(2)}, ${top.position.z.toFixed(1)})`);
  expect(took).toBeGreaterThan(0);
  expect(top.riding).toBe('bicycle');
  expect(errors).toEqual([]);
});

test('a package offer appears on the motorbike and is delivered on foot after getting off', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  await page.evaluate(() => window.__dm!.ride('motorbike'));
  expect(await page.evaluate(() => window.__dm!.capacityTier())).toBe('motorbike');
  const id = await advanceUntilPackageOffer(page, 180);
  expect(id, 'no package offer on the motorbike in 180 s').not.toBeNull();
  expect(await page.evaluate((o) => window.__dm!.accept(o), id!)).toBe('ok');
  const order = await page.evaluate(() => window.__dm!.active()[0]!.order);
  console.log(`package ${order.id}: ${order.weightKg} kg, ${order.pickupPoiId} → ${order.dropoffPoiId}`);

  // The HUD while riding with an order: the next-stop arrow over the route distance, speed and the fuel gauge.
  await page.evaluate(() => window.__dm!.setFuel('motorbike', 0.65));
  const heading = (await player(page)).heading;
  await page.evaluate((y) => window.__dm!.setLook(y, -0.15), heading);
  await page.keyboard.down('KeyW');
  await waitTicks(page, 20);
  await expect(page.locator('.hud-next')).toBeVisible();
  await expect(page.locator('.hud-fuel')).toBeVisible();
  await page.screenshot({ path: `${sp4}hud-arrow-fuel.png` });
  await page.keyboard.up('KeyW');
  await brakeToStop(page);

  // Riding into the pickup's zone picks nothing up (every delivery ends on foot) ...
  await rideInto(page, order.pickupPoiId, order.dropoffPoiId);
  await page.evaluate((n) => window.__dm!.advance(n), TICK_RATE);
  expect(await page.evaluate(() => window.__dm!.active()[0]!.pickedUpAt)).toBeNull();
  await expect(page.locator('.popup-title', { hasText: 'Get off to pick up' })).toBeVisible();
  // ... getting off does.
  await pressF(page, null);
  await page.evaluate(() => window.__dm!.advance(3));
  expect(await page.evaluate(() => window.__dm!.active()[0]!.pickedUpAt)).not.toBeNull();

  // Back on (F: the motorbike is parked beside the courier) and into the dropoff's zone: no hand-over while riding.
  await pressF(page, 'motorbike');
  await rideInto(page, order.dropoffPoiId, order.pickupPoiId);
  await page.evaluate((n) => window.__dm!.advance(n), TICK_RATE);
  expect(await page.evaluate(() => window.__dm!.totals().deliveries)).toBe(0);
  await expect(page.locator('.popup-title', { hasText: 'Get off to hand over' })).toBeVisible();
  await pressF(page, null);
  await page.evaluate(() => window.__dm!.advance(3));
  const totals = await page.evaluate(() => window.__dm!.totals());
  console.log(`delivered on foot: ${totals.points} points, ${totals.coins} coins`);
  expect(totals.deliveries).toBe(1);
  expect((await player(page)).riding).toBeNull();
  expect(await page.evaluate(() => window.__dm!.active().length)).toBe(0);
  expect(errors).toEqual([]);
});

test('Fragile package: a 12 m/s wall crash shows the bonus-lost popup', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // Off the motorbike at once: package offers follow the last ride, and pickups are on foot.
  await page.evaluate(() => window.__dm!.ride('motorbike'));
  await pressF(page, null);
  const id = await advanceUntilPackageOffer(page, 600, true);
  expect(id, 'no Fragile package offer in 600 s').not.toBeNull();
  expect(await page.evaluate((o) => window.__dm!.accept(o), id!)).toBe('ok');
  const order = await page.evaluate(() => window.__dm!.active()[0]!.order);
  await standAt(page, order.pickupPoiId);
  await page.evaluate(() => window.__dm!.advance(5));
  expect(await page.evaluate(() => window.__dm!.active()[0]!.pickedUpAt)).not.toBeNull();
  // On the motorbike in front of the spawn hospital's block (its north face at z = −98), 12 m/s straight at it.
  const hospital = (await page.evaluate(() => window.__dm!.hospitals()))[0]!;
  const block = { x: hospital.center.x, y: 1, z: hospital.center.z };
  await rideFrom(page, 'motorbike', { x: block.x, y: 0, z: block.z + 12 }, block);
  await page.evaluate(([b]) => window.__dm!.teleport({ x: b.x, y: 0.02, z: b.z + 5 }, { x: 0, y: 0, z: -12 }), [block] as const);
  await page.evaluate((n) => window.__dm!.advance(n), TICK_RATE);
  const a = await page.evaluate(() => window.__dm!.active()[0]!);
  console.log(`Fragile ${a.order.id} after the crash: intact ${a.fragileIntact}`);
  expect(a.fragileIntact).toBe(false);
  await expect(page.locator('.popup-title', { hasText: 'Crashed · Fragile bonus lost' })).toBeVisible();
  expect((await player(page)).riding).toBe('motorbike'); // a crash does not knock the rider off (until SP7)
  expect(errors).toEqual([]);
});

test('refuel at the town pump: coins drop, the fuel gauge fills', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  // Hilltop Fuel Stop: the west pump at (−173, −274.5); the car parks 2.25 m short of it, facing it.
  await rideFrom(page, 'car', { x: -173, y: 0, z: -278 }, { x: -173, y: 1, z: -260 });
  await page.evaluate(() => {
    window.__dm!.setFuel('car', 0.5);
    window.__dm!.setCoins(100);
  });
  await expect(page.locator('.hud-fuel')).toHaveAttribute('aria-valuenow', '50');
  await hold(page, ['KeyE'], 3 * TICK_RATE);
  const car = await vehicle(page, 'car');
  const coins = await page.evaluate(() => window.__dm!.totals().coins);
  console.log(`refuelled the car from 50 %: tank ${(car.fuel * 100).toFixed(1)} %, coins 100 → ${coins}`);
  expect(car.fuel).toBeCloseTo(1, 6);
  expect(coins).toBe(60); // half of the 80-coin full tank
  await expect(page.locator('.popup-title', { hasText: 'Refuelled · −40 coins' })).toBeVisible();
  await expect(page.locator('.hud-fuel')).toHaveAttribute('aria-valuenow', '100');
  // Three-quarter view of the canopy, the pumps and the car.
  await page.evaluate(() => window.__dm!.setLook(Math.PI + 0.7, -0.3));
  await waitCameraSettled(page);
  await page.screenshot({ path: `${sp4}gas-station.png` });
  expect(errors).toEqual([]);
});

test('Garage app summons the car 200 m away to the player', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  const parked = await vehicle(page, 'car');
  // On foot on the avenue at x = 100, 200 m down from the bay.
  const feet = { x: parked.position.x - 3.6, y: 0, z: parked.position.z + 200 };
  await page.evaluate(([f]) => window.__dm!.viewpoint(f, { x: f.x, y: 1.6, z: f.z + 20 }), [feet] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  const me = (await player(page)).position;
  expect(flat(me, parked.position)).toBeGreaterThan(199);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__dm!.phoneOpen());
  await page.locator('.phone-nav-btn[data-app="garage"]').click();
  await expect(page.locator('.phone-title')).toHaveText('Garage');
  const row = page.locator('.phone-garage-row[data-tier="car"]');
  await expect(row.locator('.phone-garage-status')).toHaveText(/Parked · 20\d m/);
  await expect(row.locator('.phone-summon')).toBeEnabled();
  await page.screenshot({ path: `${sp4}garage-app.png` });
  await row.locator('.phone-summon').click();
  await expect(page.locator('.popup-title', { hasText: 'Car is here' })).toBeVisible();
  const car = await vehicle(page, 'car');
  console.log(`summoned the car ${flat(parked.position, me).toFixed(1)} m: now ${flat(car.position, me).toFixed(2)} m from the player`);
  expect(car.spot).toBe('parked');
  expect(flat(car.position, me)).toBeLessThan(15);
  await expect(row.locator('.phone-summon')).toBeDisabled(); // nearby, and the cooldown runs
  expect(errors).toEqual([]);
});

test('Tab while driving shows the hint; stopped, the phone opens', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  // An order first, so the Map app has a route to show.
  await acceptWithY(page);
  await rideFrom(page, 'car', { x: 100, y: 0, z: -60 }, { x: 100, y: 1, z: 0 });
  await page.keyboard.down('KeyW');
  await page.evaluate((n) => window.__dm!.advance(n), 2 * TICK_RATE);
  await page.keyboard.press('Tab');
  await waitTicks(page, 3);
  await page.keyboard.up('KeyW');
  await expect(page.locator('.popup-title', { hasText: 'Stop to use the phone' })).toBeVisible();
  expect(await page.evaluate(() => window.__dm!.phoneOpen())).toBe(false);
  await brakeToStop(page);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__dm!.phoneOpen());
  await expect(page.locator('.phone-title')).toHaveText('Orders');
  // The Map app routes for the ride: by road on the car ...
  await page.locator('.phone-nav-btn[data-app="map"]').click();
  await expect(page.locator('.phone-title')).toHaveText('Map');
  await waitTicks(page, 6);
  await page.screenshot({ path: `${sp4}map-route-car.png` });
  const carRoute = await page.evaluate(() => window.__dm!.route().points.length);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());
  // ... and on foot after getting off.
  await pressF(page, null);
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__dm!.phoneOpen());
  await expect(page.locator('.phone-title')).toHaveText('Map');
  await waitTicks(page, 6);
  await page.screenshot({ path: `${sp4}map-route-foot.png` });
  const footRoute = await page.evaluate(() => window.__dm!.route().points.length);
  console.log(`route points: car ${carRoute}, on foot ${footRoute}`);
  expect(carRoute).toBeGreaterThan(1);
  expect(footRoute).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('draw calls stay under the budget with all four vehicles in view', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // On the skateboard in front of the spawn bay, looking at the bicycle, motorbike and car parked in it.
  const bay = await page.evaluate(() => window.__dm!.vehicles().filter((v) => v.spot === 'parked').map((v) => v.position));
  expect(bay.length).toBe(3);
  const mid = { x: bay[1]!.x, y: 0.8, z: bay[1]!.z };
  await rideFrom(page, 'skateboard', { x: mid.x - 4, y: 0, z: mid.z + 14 }, mid);
  await waitCameraSettled(page);
  const info = await page.evaluate(() => window.__dm!.renderInfo());
  console.log(`four vehicles in view: ${info.calls} draw calls, ${info.triangles} triangles`);
  await page.screenshot({ path: `${artifacts}sp4-four-vehicles.png` });
  expect(info.calls).toBeGreaterThan(0);
  expect(info.calls).toBeLessThan(clientJson.graphics.drawCallBudget);
  // Headless frame time (software WebGL): a regression signal only; 60 fps is checked in the playtest.
  const ms = await page.evaluate(
    (n) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        let t0 = 0;
        const count = (t: number): void => {
          if (frames === 0) t0 = t;
          if (frames++ < n) requestAnimationFrame(count);
          else resolve((t - t0) / n);
        };
        requestAnimationFrame(count);
      }),
    600,
  );
  console.log(`average frame time over 600 headless frames: ${ms.toFixed(2)} ms (${(1000 / ms).toFixed(1)} fps)`);
  expect(ms).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('playtest screenshots: the four rides and the test town', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // The greybox test town from above, on foot: ramp, steep lane, stairs, park path and boardwalk, with the F3 overlay's
  // access-zone volumes (shown while the overlay is on; its text panel is hidden by CSS for the shot only).
  await expect(page.locator('.debug-overlay')).toBeVisible();
  const hidePanel = await page.addStyleTag({ content: '.debug-overlay { visibility: hidden !important; }' });
  await page.evaluate(() => window.__dm!.viewpoint({ x: -178, y: 42, z: -188 }, { x: -212, y: 0, z: -228 }));
  await page.screenshot({ path: `${sp4}test-town.png` });
  await hidePanel.evaluate((e) => (e as Element).remove());
  // Each ride on a fresh page (saved progress cleared), so no vehicle parked by the last shot stands in the frame.
  // Open ground east of the map centre, facing east (as the SP1 shots): a short run, the handbrake, then a view
  // that shows the ride.
  for (const tier of ['skateboard', 'bicycle', 'motorbike', 'car'] as const) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.__dm?.ready === true, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
    await hideOverlay(page);
    await rideFrom(page, tier, { x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: 3 });
    await hold(page, ['KeyW'], 20);
    await brakeToStop(page);
    const heading = (await player(page)).heading;
    // The skateboard is ridden side-on (the courier faces across the deck), so it is seen from above and behind, its
    // deck in view; the others side-on, the camera low.
    const look = tier === 'skateboard' ? [heading + 0.4, 0.1] : [heading + Math.PI / 2, 0.05];
    await page.evaluate(([y, p]) => window.__dm!.setLook(y!, p!), look);
    await waitCameraSettled(page);
    await page.screenshot({ path: `${sp4}${tier}.png` });
  }
  expect(errors).toEqual([]);
});
