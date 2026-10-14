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

test('a package offer needs a car (or motorbike) as the last ride', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  expect(await page.evaluate(() => window.__dm!.capacityTier())).toBe('walk');
  /** Runs `seconds` of sim, never accepting; counts the distinct offers seen by kind. */
  const watch = (seconds: number): Promise<{ food: number; package: number; firstPackageAt: number }> =>
    page.evaluate(
      ([s, rate]) => {
        const seen = new Map<string, string>();
        let firstPackageAt = -1;
        for (let i = 0; i < s * rate; i++) {
          window.__dm!.advance(1);
          for (const o of window.__dm!.offers()) {
            seen.set(o.order.id, o.order.kind);
            if (o.order.kind === 'package' && firstPackageAt < 0) firstPackageAt = i / rate;
          }
        }
        const kinds = [...seen.values()];
        return { food: kinds.filter((k) => k === 'food').length, package: kinds.filter((k) => k === 'package').length, firstPackageAt };
      },
      [seconds, TICK_RATE] as const,
    );
  const walk = await watch(60);
  console.log(`walk, 60 s: ${walk.food} food offers, ${walk.package} package offers`);
  expect(walk.food).toBeGreaterThan(0); // offers did arrive, so "no packages" is not vacuous
  expect(walk.package).toBe(0);
  await page.evaluate(() => window.__dm!.setLastRide('car'));
  await page.evaluate(() => window.__dm!.advance(1)); // capacity follows the ride on the next tick
  expect(await page.evaluate(() => window.__dm!.capacityTier())).toBe('car');
  const car = await watch(120);
  console.log(`car, 120 s: ${car.food} food offers, ${car.package} package offers, first package at ${car.firstPackageAt.toFixed(2)} s`);
  expect(car.package).toBeGreaterThan(0);
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
