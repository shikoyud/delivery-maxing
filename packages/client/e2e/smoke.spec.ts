import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import clientJson from '../../../config/client.json' with { type: 'json' };
import perfJson from '../../../config/perf.json' with { type: 'json' };
import ridingJson from '../../../config/riding.json' with { type: 'json' };
import cityLayout from '../../../map/city.layout.json' with { type: 'json' };
import type {} from '../src/game/debugHooks';

const artifacts = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });
/** SP3 playtest screenshots are committed (plan Global Constraints: the phone, a delivery, the hospital spawn). */
const sp3 = fileURLToPath(new URL('../../../docs/playtest/sp3/', import.meta.url));
mkdirSync(sp3, { recursive: true });
/** SP4 playtest screenshots are committed too (the four rides, the HUD arrow and fuel, the Map routes, Garage, a pump). */
const sp4 = fileURLToPath(new URL('../../../docs/playtest/sp4/', import.meta.url));
mkdirSync(sp4, { recursive: true });
/** SP6 playtest screenshots are committed too (the map screen, the prep bar, the ollie, the Shop, Wallet, Wardrobe and Garage). */
const sp6 = fileURLToPath(new URL('../../../docs/playtest/sp6/', import.meta.url));
mkdirSync(sp6, { recursive: true });

/** Opens the SP4 greybox town (?map=greybox) in debug mode and waits for the first frame; returns the console errors seen. */
async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`?debug=1&map=greybox${query}`);
  await page.waitForFunction(() => window.__dm?.ready === true, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__dm!.mapKind())).toBe('greybox');
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

type Line = 'vehicle' | 'bag' | 'shoes' | 'dispatcher';

/**
 * Sets a line's tier on the mock chain (the dev panel's tier slider). A new player owns tier 0 of every line
 * (Decision 2: on foot, the free Bag of one slot and no packages); a granted vehicle tier owns the tiers below it and
 * parks them at the nearest hospital's bay (the skateboard is carried).
 */
async function grant(page: Page, line: Line, tier: number): Promise<void> {
  await page.evaluate(([l, t]) => window.__dm!.devChain.grantTier(l, t), [line, tier] as const);
  await page.evaluate(() => window.__dm!.advance(1));
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
  // A new player owns no vehicle (Decision 2); ride() grants the motorbike's line (skateboard and bicycle with it).
  expect(await page.evaluate(() => window.__dm!.vehicles().map((v) => v.tier))).toEqual([]);
  await page.evaluate(() => window.__dm!.ride('motorbike'));
  expect(await page.evaluate(() => window.__dm!.player().riding)).toBe('motorbike');
  expect(await page.evaluate(() => window.__dm!.vehicles().map((v) => v.tier))).toEqual(['skateboard', 'bicycle', 'motorbike']);
  await page.evaluate(() => window.__dm!.setCoins(40));
  expect(await page.evaluate(() => window.__dm!.totals().coins)).toBe(40);
  expect(await page.evaluate(() => window.__dm!.route().points)).toEqual([]);
  await page.keyboard.press('Backquote');
  const box = (tier: string) => page.locator('.dm-dev-panel .lil-controller', { hasText: `Owned · ${tier}` }).locator('input');
  await expect(box('motorbike')).toBeDisabled();
  await expect(box('motorbike')).toBeChecked();
  await expect(box('car')).toBeEnabled();
  await expect(box('car')).not.toBeChecked();
  // The boxes grant and revoke on the mock chain.
  await box('car').check();
  expect(await page.evaluate(() => window.__dm!.vehicles().find((v) => v.tier === 'car')?.fuel)).toBe(1);
  expect(await page.evaluate(() => window.__dm!.chain().ownership.lines.vehicle)).toBe(4);
  await box('car').uncheck();
  expect(await page.evaluate(() => window.__dm!.vehicles().map((v) => v.tier))).toEqual(['skateboard', 'bicycle', 'motorbike']);
  await box('car').check();
  await page.locator('.dm-dev-panel .lil-controller', { hasText: '+500 coins' }).locator('button, .lil-name').first().click();
  expect(await page.evaluate(() => window.__dm!.totals().coins)).toBe(540);
  await page.locator('.dm-dev-panel .lil-controller', { hasText: 'Reset progress' }).locator('button, .lil-name').first().click();
  expect(await page.evaluate(() => window.__dm!.player().riding)).toBeNull();
  expect(await page.evaluate(() => window.__dm!.totals().coins)).toBe(0);
  expect(await page.evaluate(() => window.__dm!.vehicles().map((v) => v.spot))).toEqual(['carried', 'parked', 'parked', 'parked']);
  expect(errors).toEqual([]);
});

test('phone: Tab opens Orders and Wallet renders (no Map tab); Esc closes', async ({ page }) => {
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
  // Accept from the phone: the order moves to Active (the map is its own screen now, M: Decision 11).
  await page.locator('.phone-offer').first().locator('.phone-accept').click();
  await expect(page.locator('.phone-active-order')).toHaveCount(1);
  await expect(page.locator('.phone-nav-btn[data-app="map"]')).toHaveCount(0);
  await page.locator('.phone-nav-btn[data-app="wallet"]').click();
  await expect(page.locator('.phone-title')).toHaveText('Wallet');
  await expect(page.locator('.phone-wallet-address-text')).toHaveText('DEV-WALLET');
  await expect(page.locator('.phone-wallet-vault-usd')).toHaveText('$50.00');
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
  // The two-wheelers bought at another hospital, then the car at the spawn: it takes the spawn bay's front slot (bought
  // together, the car would take the last slot, nose to tail behind the motorbike).
  const hospitals = await page.evaluate(() => window.__dm!.hospitals());
  for (const [h, tier] of [[hospitals[1]!, 3], [hospitals[0]!, 4]] as const) {
    await page.evaluate((id) => window.__dm!.teleportTo(id), h.id);
    await page.evaluate(() => window.__dm!.advance(10)); // landed: purchases park at the bay nearest the feet
    await grant(page, 'vehicle', tier);
  }
  const car = await vehicle(page, 'car');
  expect(car.spot).toBe('parked');
  const hospital = hospitals[0]!;
  expect(flat(car.position, hospital.bay)).toBeLessThan(0.5); // in the spawn hospital's bay, slot 0
  // On foot 2 m off the car's side (bays face along the street, Decision 6: its side is x), then F.
  const feet = { x: car.position.x - 2, y: 0, z: car.position.z };
  await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [feet, { ...car.position, y: 1 }] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  await pressF(page, 'car');
  // Down the street: the bay faces +Z (bayYaw π), and W drives along the heading (Decision 7). 12 s of W, every tick sampled.
  expect(Math.abs(wrap((await player(page)).heading - Math.PI))).toBeLessThan(0.01);
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
  // The nose probe (SP5 Task 1) holds the car's nose, halfLength + radius ahead of its centre, at the mouth.
  const c = ridingJson.rides.car.collider;
  const nose = car.position.x - (c.halfLength + c.radius);
  console.log(`car at the alley mouth: x ${car.position.x.toFixed(3)}, nose ${nose.toFixed(3)}, speed ${Math.hypot(car.velocity.x, car.velocity.z).toFixed(3)} m/s`);
  expect(nose).toBeGreaterThanOrEqual(94);
  expect(nose).toBeLessThan(95);
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
  await grant(page, 'bag', 5); // the free Bag takes no packages: the motorbike's cap (3 slots, 25 kg) rules
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
  // Off the motorbike at once: package offers follow the last ride, and pickups are on foot. A Bag for packages.
  await grant(page, 'bag', 5);
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
  await grant(page, 'vehicle', 4); // parked at the spawn hospital's bay
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
  // An order first, so the map has a route to show.
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
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());
  // The map routes for the ride: by road on the car ...
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__dm!.mapOpen());
  await waitTicks(page, 6);
  await page.screenshot({ path: `${sp4}map-route-car.png` });
  const carRoute = await page.evaluate(() => window.__dm!.route().points.length);
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => !window.__dm!.mapOpen());
  // ... and on foot after getting off.
  await pressF(page, null);
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__dm!.mapOpen());
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
  await grant(page, 'vehicle', 4); // all four bought at the spawn: three in its bay, the skateboard carried
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
  // The game saves on pagehide, so storage is cleared as each new page starts (an init script), not before the reload.
  // Open ground east of the map centre, facing east (as the SP1 shots): a short run, the handbrake, then a view
  // that shows the ride.
  await page.addInitScript(() => localStorage.clear());
  for (const tier of ['skateboard', 'bicycle', 'motorbike', 'car'] as const) {
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

// ---------------------------------------------------------------------------------------------------------------------
// SP5: the city (the default map). Run with the packs absent (Review Focus 1): every lot is a category-coloured box.
// Driving and walking are timed in sim ticks (__dm.advance with the keys held), as the SP4 tests.
// ---------------------------------------------------------------------------------------------------------------------

/** SP5 playtest screenshots are committed: placeholder boxes only (no pack model appears in them). */
const sp5 = fileURLToPath(new URL('../../../docs/playtest/sp5/', import.meta.url));
mkdirSync(sp5, { recursive: true });

type Facing = 'N' | 'S' | 'E' | 'W';
const lots = new Map(cityLayout.lots.map((l) => [l.id, l]));
const connector = (id: string) => cityLayout.connectors.find((c) => c.id === id)!;
const road = (name: string) => cityLayout.roads.find((r) => r.name === name)!;
const midZ = (r: { rect: { minZ: number; maxZ: number } }): number => (r.rect.minZ + r.rect.maxZ) / 2;
/** Outward (street-side) unit vector of a lot's door side. */
const OUT: Record<Facing, { x: number; z: number }> = { N: { x: 0, z: 1 }, S: { x: 0, z: -1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } };
const EAST_YAW = yawTo({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
const WEST_YAW = yawTo({ x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
const NORTH_YAW = yawTo({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Opens the city (the default map) in debug mode and waits for the first frame; returns the console errors and
 * warnings seen, and every HTTP response of 400 or more.
 */
async function bootCity(page: Page, query = ''): Promise<{ errors: string[]; warnings: string[]; failed: string[] }> {
  const out = { errors: [] as string[], warnings: [] as string[], failed: [] as string[] };
  page.on('console', (m) => {
    if (m.type() === 'error') out.errors.push(m.text());
    if (m.type() === 'warning') out.warnings.push(m.text());
  });
  page.on('pageerror', (e) => out.errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) out.failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`?debug=1${query}`);
  await page.waitForFunction(() => window.__dm?.ready === true, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__dm!.mapKind())).toBe('city');
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  return out;
}

/** Ground point `m` metres out from a lot's door on its street side, and the door itself. */
function doorApproach(lotId: string, m: number): { feet: P; door: P } {
  const lot = lots.get(lotId)!;
  const door = lot.door!;
  const o = OUT[lot.facing as Facing];
  return { feet: { x: door.x + o.x * m, y: door.y, z: door.z + o.z * m }, door: { ...door } };
}

/**
 * On foot `m` m out from a lot's door, facing it, then W for at most `maxSeconds` (the building stops the courier at
 * the door); with `untilDelivered`, only until a delivery is counted. Returns the seconds walked, or −1 when
 * `untilDelivered` and nothing was delivered.
 */
async function walkToDoor(page: Page, lotId: string, m: number, maxSeconds: number, untilDelivered = false): Promise<number> {
  const { feet, door } = doorApproach(lotId, m);
  await page.evaluate(([f, d]) => window.__dm!.viewpoint(f, { ...d, y: d.y + 1.2 }), [feet, door] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  await page.keyboard.down('KeyW');
  const took = await page.evaluate(
    ([rate, max, until]) => {
      const before = window.__dm!.totals().deliveries;
      for (let i = 0; i < max * rate; i++) {
        window.__dm!.advance(1);
        if (until && window.__dm!.totals().deliveries > before) return i / rate;
      }
      return until ? -1 : max;
    },
    [TICK_RATE, maxSeconds, untilDelivered] as const,
  );
  await page.keyboard.up('KeyW');
  return took;
}

/** Sets the held movement keys to exactly `keys` (W, A, S, D, Space), changing only what differs. */
async function setKeys(page: Page, held: Set<string>, keys: string[]): Promise<void> {
  for (const k of [...held]) {
    if (!keys.includes(k)) {
      await page.keyboard.up(k);
      held.delete(k);
    }
  }
  for (const k of keys) {
    if (!held.has(k)) {
      await page.keyboard.down(k);
      held.add(k);
    }
  }
}

/** Heading error (rad) inside which driveUntil holds neither A nor D. */
const STEER_DEADBAND = 0.02;

/**
 * Drives the current ride toward the heading `yaw` with WASD (Decision 7: the mouse never steers): A or D while the
 * heading is off by more than STEER_DEADBAND (A turns left, toward a larger yaw), W up to `vmax`, coasting above it and
 * S well above it, one sim tick at a time, until `until(position)` holds (at most `maxSeconds`). The camera looks along
 * `yaw`. Returns every position passed.
 */
async function driveUntil(page: Page, yaw: number, vmax: number, until: (p: P) => boolean, maxSeconds = 30): Promise<P[]> {
  const held = new Set<string>();
  const path: P[] = [];
  await page.evaluate((y) => window.__dm!.setLook(y, -0.2), yaw);
  try {
    for (let i = 0; i < maxSeconds * TICK_RATE; i++) {
      const s = await player(page);
      path.push(s.position);
      if (until(s.position)) return path;
      const v = Math.hypot(s.velocity.x, s.velocity.z);
      const err = wrap(yaw - s.heading);
      const steer = err > STEER_DEADBAND ? ['KeyA'] : err < -STEER_DEADBAND ? ['KeyD'] : [];
      await setKeys(page, held, [...(v > vmax + 2 ? ['KeyS'] : v > vmax ? [] : ['KeyW']), ...steer]);
      await page.evaluate(() => window.__dm!.advance(1));
    }
  } finally {
    await setKeys(page, held, []);
  }
  throw new Error(`driveUntil: not there after ${maxSeconds} s (at ${JSON.stringify(path.at(-1))})`);
}

/** A shot from the air: the player is put at `feet` and falls; taken after a few frames (a fall well under a metre). */
async function cityAirShot(page: Page, feet: P, target: P, file: string): Promise<void> {
  await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [feet, target] as const);
  await waitTicks(page, 3);
  await page.screenshot({ path: `${sp5}${file}` });
}

/** A shot on the ground: on foot at `feet` looking at `target`, once the camera has settled. */
async function cityGroundShot(page: Page, feet: P, target: P, file: string): Promise<void> {
  await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [feet, target] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  await waitCameraSettled(page);
  await page.screenshot({ path: `${sp5}${file}` });
}

test('the default URL loads the city; ?map=greybox loads the SP4 test town', async ({ page }) => {
  const { errors } = await bootCity(page);
  const hospitals = await page.evaluate(() => window.__dm!.hospitals().map((h) => h.name));
  expect(hospitals).toEqual(cityLayout.hospitals.map((h) => h.name));
  expect((await page.evaluate(() => window.__dm!.loadedChunks())).length).toBeGreaterThan(0);
  await page.goto('?debug=1&map=greybox');
  await page.waitForFunction(() => window.__dm?.ready === true, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__dm!.mapKind())).toBe('greybox');
  expect(await page.evaluate(() => window.__dm!.loadedChunks())).toEqual([]);
  expect(await page.evaluate(() => window.__dm!.cityStats())).toBeNull();
  expect(errors).toEqual([]);
});

test('city: loads, renders and reports ready with no console errors and at most one "model missing" warning per id (Review Focus 1)', async ({ page }) => {
  test.setTimeout(120_000);
  const { errors, warnings, failed } = await bootCity(page);
  await expect(page.locator('canvas.game-canvas')).toBeVisible();
  // Spawn at Bayview General, inside its safe zone; then a few places around the city, so more lots come into view.
  const spawn = cityLayout.hospitals[0]!;
  const p = (await player(page)).position;
  expect(flat(p, spawn.spawn)).toBeLessThan(1);
  expect(p.y).toBeCloseTo(spawn.spawn.y, 1);
  expect(await page.evaluate(() => window.__dm!.safeZone())).toBe(spawn.id);
  for (const id of ['gas-ridge-fuel', 'hospital-midtown-medical', 'gas-dockside-fuel', 'bayview-general']) {
    await page.evaluate((t) => window.__dm!.teleportTo(t), id);
    await waitTicks(page, 6);
    expect((await player(page)).mode).toBe('ground');
  }
  const stats = await page.evaluate(() => window.__dm!.cityStats());
  console.log(`city: ${JSON.stringify(stats)}; warnings ${JSON.stringify(warnings)}`);
  // The packs are absent: no model is loaded and every lot is a box, without one request for a model file.
  expect(stats!.models).toBe(0);
  expect(stats!.blocks).toBeGreaterThan(0);
  const missing = warnings.filter((w) => w.startsWith('model missing:'));
  expect(new Set(missing).size).toBe(missing.length);
  expect(warnings.filter((w) => w.startsWith('pack models not installed'))).toHaveLength(1);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('city: draw calls and triangles within the config budgets at every perf-route viewpoint', async ({ page }) => {
  test.setTimeout(120_000);
  const { errors } = await bootCity(page);
  for (const [i, vp] of perfJson.route.entries()) {
    await page.evaluate(([f, t]) => window.__dm!.viewpoint(f, t), [vp.feet, vp.target] as const);
    await waitTicks(page, 4);
    const info = await page.evaluate(() => window.__dm!.renderInfo());
    console.log(`perf viewpoint ${i} (${vp.feet.x}, ${vp.feet.y}, ${vp.feet.z}): ${info.calls} draw calls, ${info.triangles} triangles`);
    expect(info.calls).toBeGreaterThan(0);
    expect(info.calls).toBeLessThanOrEqual(clientJson.graphics.drawCallBudget);
    expect(info.triangles).toBeLessThanOrEqual(clientJson.graphics.triangleBudget);
  }
  expect(errors).toEqual([]);
});

test('city: an offer appears, the car drives Bayview Avenue to the pickup, the courier delivers on foot (names and addresses in the Orders app)', async ({ page }) => {
  test.setTimeout(180_000);
  const { errors } = await bootCity(page, SEED);
  await hideOverlay(page);
  // The first offer whose pickup is on Bayview's level (L1, y 10), so the avenue leads to it.
  const id = await page.evaluate(
    ([rate]) => {
      for (let i = 0; i < 120 * rate; i++) {
        const o = window.__dm!.offers().find((x) => window.__dm!.poiPosition(x.order.pickupPoiId).y === 10);
        if (o) return o.order.id;
        window.__dm!.advance(1);
      }
      return null;
    },
    [TICK_RATE] as const,
  );
  expect(id, 'no offer with a pickup on L1 in 120 s').not.toBeNull();
  // The Orders app names the business and the addressee and gives the street addresses.
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__dm!.phoneOpen());
  const offer = await page.evaluate((o) => window.__dm!.offers().find((x) => x.order.id === o)!.order, id!);
  const pickupLot = lots.get(offer.pickupPoiId)!;
  const dropLot = lots.get(offer.dropoffPoiId)!;
  const card = page.locator('.phone-offer').filter({ hasText: pickupLot.name! });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.phone-card-text').first()).toContainText(`from ${pickupLot.name}, ${pickupLot.address}`);
  await expect(card.locator('.phone-card-name')).toHaveText(dropLot.name!);
  await expect(card.locator('.phone-card-address')).toContainText(dropLot.address!);
  console.log(`offer ${offer.id}: ${offer.kind} from ${pickupLot.name}, ${pickupLot.address} to ${dropLot.name}, ${dropLot.address}`);
  await page.screenshot({ path: `${sp5}orders-app.png` });
  await card.locator('.phone-accept').click();
  await page.waitForFunction(() => window.__dm!.active().length === 1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());

  // In the car on Bayview Avenue beside the hospital, toward the pickup, flat out along the avenue until level with it.
  const avenue = road('Bayview Avenue');
  const pickupX = pickupLot.door!.x;
  const startX = cityLayout.hospitals[0]!.spawn.x;
  const dir = Math.sign(pickupX - startX) || 1;
  await rideFrom(page, 'car', { x: startX, y: avenue.y, z: midZ(avenue) }, { x: startX + dir * 50, y: avenue.y + 1, z: midZ(avenue) });
  const path = await driveUntil(page, dir > 0 ? EAST_YAW : WEST_YAW, 28, (q) => dir * (q.x - pickupX) > -30, 40);
  await brakeToStop(page);
  const car = await player(page);
  console.log(`drove ${flat(path[0]!, car.position).toFixed(1)} m along ${avenue.name} to x ${car.position.x.toFixed(1)}`);
  expect(car.riding).toBe('car');
  expect(car.position.z).toBeGreaterThan(avenue.rect.minZ);
  expect(car.position.z).toBeLessThan(avenue.rect.maxZ);
  expect(Math.min(...path.map((q) => q.y))).toBeGreaterThanOrEqual(avenue.y - 0.1);
  // Every pickup is on foot: off, then walk to the door and wait the prep time.
  await pressF(page, null);
  await walkToDoor(page, offer.pickupPoiId, 5, 2);
  await page.evaluate((n) => window.__dm!.advance(n), PICKUP_TICKS);
  expect(await page.evaluate(() => window.__dm!.active()[0]!.pickedUpAt)).not.toBeNull();
  // The dropoff on foot: walked in from the street to its door.
  const walked = await walkToDoor(page, offer.dropoffPoiId, 6, 6, true);
  const totals = await page.evaluate(() => window.__dm!.totals());
  console.log(`delivered to ${dropLot.name} on foot after ${walked.toFixed(2)} s: ${totals.points} points, ${totals.coins} coins`);
  expect(walked).toBeGreaterThanOrEqual(0);
  expect(totals.deliveries).toBe(1);
  expect((await player(page)).riding).toBeNull();
  await expect(page.locator('.popup', { hasText: 'Delivered!' })).toBeVisible();
  expect(errors).toEqual([]);
});

/**
 * Band B's connectors (Bayview, L1 at y 10, up to Midtown, L2 at y 24, over z 560..620). Their geometry is
 * terrainSolids.ts's (switchbackGeometry, steepLaneGeometry) for the committed layout, copied here because the e2e
 * runner cannot load the shared config modules: conn-B-switchback-0 (x 228, legLength 80) has its legs from x 234 over
 * a 77.8 m run at z 574 and 606; conn-B-steepLane-0 (x 52) starts at (52, 562.51) and runs (0.8352, 0.5499).
 */
const BAND_B = cityLayout.bands.B;
const SW_B0 = { id: 'conn-B-switchback-0', xs: 234, run: 77.78, legZ: [574, 606] as const };
const LANE_B0 = { id: 'conn-B-steepLane-0', start: { x: 52, z: 562.51 }, dir: { x: 0.8352, z: 0.5499 } };
const STAIRS_B1 = { id: 'conn-B-stairs-1' };

test('city: a staircase is walked, a steep lane ridden on the bicycle, a switchback driven in the car', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors } = await bootCity(page);
  const L1 = BAND_B.y0;
  const L2 = BAND_B.y1;
  const above = (p: P) => p.z > BAND_B.z1 + 5;

  // Stairs: on foot from Bayview Terrace straight north up the steps onto Midtown.
  const stairs = connector(STAIRS_B1.id);
  expect(stairs.kind).toBe('stairs');
  await page.evaluate(([x, y, z]) => window.__dm!.viewpoint({ x, y, z }, { x, y: y + 1.6, z: z + 20 }), [stairs.x, L1, BAND_B.z0 - 5] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  await page.keyboard.down('KeyW');
  const walked = await page.evaluate(
    ([rate, z1]) => {
      for (let i = 0; i < 40 * rate; i++) {
        window.__dm!.advance(1);
        if (window.__dm!.player().position.z > z1 + 5) return i / rate;
      }
      return -1;
    },
    [TICK_RATE, BAND_B.z1] as const,
  );
  await page.keyboard.up('KeyW');
  const top = await player(page);
  console.log(`walked up ${stairs.id} in ${walked.toFixed(2)} s to (${top.position.x.toFixed(1)}, ${top.position.y.toFixed(2)}, ${top.position.z.toFixed(1)})`);
  expect(walked).toBeGreaterThan(0);
  expect(top.position.y).toBeCloseTo(L2, 1);
  expect(top.riding).toBeNull();

  // Steep lane: on the bicycle from 14 m before its foot, along the lane onto Midtown.
  const lane = connector(LANE_B0.id);
  expect(lane.kind).toBe('steepLane');
  expect(lane.x).toBe(LANE_B0.start.x);
  const { start, dir } = LANE_B0;
  const before = { x: start.x - 14 * dir.x, y: L1, z: start.z - 14 * dir.z };
  await rideFrom(page, 'bicycle', before, { x: before.x + 30 * dir.x, y: L1 + 3, z: before.z + 30 * dir.z });
  const lanePath = await driveUntil(page, yawTo({ x: 0, y: 0, z: 0 }, { x: dir.x, y: 0, z: dir.z }), 12, above, 40);
  const bike = await player(page);
  console.log(`bicycle up ${lane.id}: ${lanePath.length} ticks, at (${bike.position.x.toFixed(1)}, ${bike.position.y.toFixed(2)}, ${bike.position.z.toFixed(1)})`);
  expect(bike.riding).toBe('bicycle');
  expect(bike.position.y).toBeCloseTo(L2, 1);
  await brakeToStop(page);
  await page.evaluate(() => window.__dm!.setLook(2.4, -0.25));
  await waitCameraSettled(page);
  await hideOverlay(page);
  await page.screenshot({ path: `${artifacts}sp5-steep-lane-top.png` });
  await page.keyboard.press('F3');

  // Switchback: in the car, east up the first leg onto the hairpin, north across it, west up the second leg, north
  // onto Midtown. Each leg climbs at 9 %.
  const sw = connector(SW_B0.id);
  expect(sw.kind).toBe('switchback');
  await rideFrom(page, 'car', { x: sw.x, y: L1, z: SW_B0.legZ[0] }, { x: sw.x + 30, y: L1 + 1, z: SW_B0.legZ[0] });
  const leg = await driveUntil(page, EAST_YAW, 12, (p) => p.x > SW_B0.xs + SW_B0.run + 3);
  const climb = leg.filter((p) => p.x > SW_B0.xs + 10 && p.x < SW_B0.xs + SW_B0.run - 10);
  const grade = (climb.at(-1)!.y - climb[0]!.y) / (climb.at(-1)!.x - climb[0]!.x);
  console.log(`car up the first leg of ${sw.id}: grade ${(grade * 100).toFixed(2)} %, hairpin at y ${leg.at(-1)!.y.toFixed(2)}`);
  expect(grade).toBeCloseTo(0.09, 2);
  expect(leg.at(-1)!.y).toBeCloseTo((L1 + L2) / 2, 1);
  await brakeToStop(page);
  await driveUntil(page, NORTH_YAW, 4, (p) => p.z > SW_B0.legZ[1] - 1);
  await driveUntil(page, WEST_YAW, 12, (p) => p.x < SW_B0.xs - 1);
  await brakeToStop(page);
  await driveUntil(page, NORTH_YAW, 6, above);
  const car = await player(page);
  console.log(`car on Midtown at (${car.position.x.toFixed(1)}, ${car.position.y.toFixed(2)}, ${car.position.z.toFixed(1)})`);
  expect(car.riding).toBe('car');
  expect(car.position.y).toBeCloseTo(L2, 1);
  expect(errors).toEqual([]);
});

test('city: Review Focus 5 — the car crosses the avenue at top speed without falling through', async ({ page }) => {
  test.setTimeout(180_000);
  const { errors } = await bootCity(page);
  const avenue = road('Bayview Avenue');
  const z = midZ(avenue);
  await rideFrom(page, 'car', { x: 20, y: avenue.y, z }, { x: 80, y: avenue.y + 1, z });
  await page.evaluate((y) => window.__dm!.setLook(y, -0.2), EAST_YAW);
  // Full throttle east, every tick sampled in one synchronous run: the chunks page in ahead of the car as it goes.
  await page.keyboard.down('KeyW');
  const run = await page.evaluate(
    ([rate, endX]) => {
      let minY = Infinity;
      let maxSpeed = 0;
      let ticks = 0;
      const chunks = new Set<string>();
      for (; ticks < 80 * rate; ticks++) {
        const v = window.__dm!.advance(1)[0]!;
        const p = window.__dm!.player();
        if (p.riding !== 'car') break;
        minY = Math.min(minY, p.position.y);
        maxSpeed = Math.max(maxSpeed, v);
        for (const c of window.__dm!.loadedChunks()) chunks.add(c);
        if (p.position.x >= endX) break;
      }
      return { minY, maxSpeed, ticks, x: window.__dm!.player().position.x, chunks: chunks.size, riding: window.__dm!.player().riding };
    },
    [TICK_RATE, avenue.rect.maxX - 60] as const,
  );
  await page.keyboard.up('KeyW');
  await brakeToStop(page);
  const end = await player(page);
  console.log(`Bayview Avenue at full throttle: ${run.ticks} ticks to x ${run.x.toFixed(1)}, max ${run.maxSpeed.toFixed(3)} m/s, min y ${run.minY.toFixed(3)}, ${run.chunks} chunks loaded on the way, stopped at x ${end.position.x.toFixed(1)}`);
  expect(run.riding).toBe('car');
  expect(run.x).toBeGreaterThanOrEqual(avenue.rect.maxX - 60);
  expect(run.maxSpeed).toBeGreaterThan(27.9);
  expect(run.maxSpeed).toBeLessThanOrEqual(28 + 1e-6);
  expect(run.minY).toBeGreaterThanOrEqual(avenue.y - 0.1);
  expect(end.position.y).toBeCloseTo(avenue.y, 1);
  expect(end.position.x).toBeLessThanOrEqual(avenue.rect.maxX);
  // The colliders were paged along the way: the chunks at the start are unloaded behind the car.
  expect(await page.evaluate(() => window.__dm!.loadedChunks().length)).toBeLessThanOrEqual(25);
  expect(run.chunks).toBeGreaterThan(25);
  expect(errors).toEqual([]);
});

/** Counts the map screen canvas's pixels of each colour (#rrggbb). */
const canvasColours = (page: Page, colours: string[]): Promise<number[]> =>
  page.locator('.map-screen-canvas').evaluate((c, cols) => {
    const canvas = c as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const want = cols.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    const n = cols.map(() => 0);
    for (let i = 0; i < data.length; i += 4) {
      want.forEach(([r, g, b], k) => {
        if (data[i] === r && data[i + 1] === g && data[i + 2] === b) n[k]!++;
      });
    }
    return n;
  }, colours);

test('city: F4 shows the debug view with lot labels; the map shows hospitals, gas stations and a parked car', async ({ page }) => {
  test.setTimeout(120_000);
  const { errors } = await bootCity(page);
  await hideOverlay(page);
  expect(await page.evaluate(() => window.__dm!.mapDebugVisible())).toBe(false);
  // F4, standing on Bayview Avenue in front of the hospital: labels for the lots within 80 m.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 139.5, y: 10, z: 316 }, { x: 139.5, y: 14, z: 345 }));
  await page.keyboard.press('F4');
  await page.waitForFunction(() => window.__dm!.mapDebugVisible());
  await waitTicks(page, 4);
  const dbg = await page.evaluate(() => window.__dm!.mapDebug()!);
  console.log(`F4: ${dbg.labels.length} labels (${dbg.labels.slice(0, 3).join(' | ')} ...), ${dbg.beams} beams, ${dbg.chunks} chunks, zones ${JSON.stringify(dbg.zones)}`);
  expect(dbg.visible).toBe(true);
  expect(dbg.labels.length).toBeGreaterThan(0);
  expect(dbg.labels.every((l) => /lot-L1-/.test(l))).toBe(true);
  const me = (await player(page)).position;
  const near = cityLayout.lots.filter((l) => flat(me, { x: (l.rect.minX + l.rect.maxX) / 2, y: 0, z: (l.rect.minZ + l.rect.maxZ) / 2 }) < 60);
  expect(dbg.labels.some((l) => near.some((n) => l.includes(n.id)))).toBe(true);
  await waitCameraSettled(page);
  await page.screenshot({ path: `${sp5}debug-view.png` });
  await page.keyboard.press('F4');
  await page.waitForFunction(() => !window.__dm!.mapDebugVisible());

  // The map at the spawn: the red crosses, the fuel icons and the car parked in the bay (bought there).
  await page.evaluate((h) => window.__dm!.teleportTo(h), cityLayout.hospitals[0]!.id);
  await waitTicks(page, 3);
  await grant(page, 'vehicle', 4);
  expect((await vehicle(page, 'car')).spot).toBe('parked');
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__dm!.mapOpen());
  await waitTicks(page, 6);
  const [hospital, fuel, parked] = await canvasColours(page, ['#d63a3a', '#f2a33a', '#2f8f83']);
  console.log(`Map pixels: hospital ${hospital}, fuel ${fuel}, parked vehicles ${parked}`);
  expect(hospital).toBeGreaterThan(0);
  expect(fuel).toBeGreaterThan(0);
  expect(parked).toBeGreaterThan(0);
  await page.screenshot({ path: `${sp5}map-app.png` });
  expect(errors).toEqual([]);
});

/** Whether any pixel within `r` px of each CSS-px point on the map screen canvas has colour `hex`. */
const mapColourNear = (page: Page, points: { x: number; y: number }[], hex: string, r = 6): Promise<boolean[]> =>
  page.locator('.map-screen-canvas').evaluate(
    (c, [pts, col, rad]) => {
      const canvas = c as HTMLCanvasElement;
      const k = canvas.width / canvas.clientWidth;
      const ctx = canvas.getContext('2d')!;
      const want = [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)];
      return pts.map((p) => {
        const x0 = Math.max(0, Math.round((p.x - rad) * k));
        const y0 = Math.max(0, Math.round((p.y - rad) * k));
        const side = Math.round(2 * rad * k);
        const data = ctx.getImageData(x0, y0, side, side).data;
        for (let i = 0; i < data.length; i += 4) if (data[i] === want[0] && data[i + 1] === want[1] && data[i + 2] === want[2]) return true;
        return false;
      });
    },
    [points, hex, r] as const,
  );

test('city: M shows the whole city with hospitals and gas stations; wheel zooms; Esc closes', async ({ page }) => {
  test.setTimeout(120_000);
  const { errors } = await bootCity(page);
  await hideOverlay(page);
  const vp = page.viewportSize()!;
  const size = cityLayout.size;
  /** MapView's projection: zoom `z` about the world centre `c` (CSS px). */
  const project = (p: { x: number; z: number }, z = 1, c = { x: size / 2, z: size / 2 }) => {
    const s = (Math.min(vp.width, vp.height) / size) * z;
    return { x: vp.width / 2 + (p.x - c.x) * s, y: vp.height / 2 + (p.z - c.z) * s };
  };
  const hospitals = cityLayout.hospitals.map((h) => h.center);
  const gas = cityLayout.gasStations.map((g) => g.position);

  // Riding the car at speed on Bayview Avenue: M opens the map anyway (Decision 11) ...
  await rideFrom(page, 'car', { x: 139.5, y: 10, z: 316 }, { x: 170, y: 11, z: 316 });
  await page.evaluate((y) => window.__dm!.setLook(y, -0.2), EAST_YAW);
  const fast = await hold(page, ['KeyW'], 3 * TICK_RATE);
  expect(fast.at(-1)!).toBeGreaterThan(8);
  await page.keyboard.down('KeyW');
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__dm!.mapOpen());
  await expect(page.locator('.map-screen')).toBeVisible();
  await expect(page.locator('.map-legend-item')).toHaveText(['You', 'Orders', 'Offers', 'Hospitals', 'Gas stations', 'Your vehicles']);
  // ... and the sim gets no move input: with W still held the car only coasts.
  const v0 = Math.hypot((await player(page)).velocity.x, (await player(page)).velocity.z);
  const coast = await page.evaluate((n) => window.__dm!.advance(n), TICK_RATE);
  await page.keyboard.up('KeyW');
  console.log(`map open at ${v0.toFixed(1)} m/s; 1 s later ${coast.at(-1)!.toFixed(1)} m/s`);
  expect(coast.at(-1)!).toBeLessThan(v0);
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => !window.__dm!.mapOpen());
  await brakeToStop(page);
  await pressF(page, null);

  // On foot at the first hospital (its parked car in the bay), M again.
  await page.evaluate((h) => window.__dm!.teleportTo(h), cityLayout.hospitals[0]!.id);
  await page.evaluate(() => window.__dm!.advance(3));
  await waitCameraSettled(page);
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__dm!.mapOpen());
  await waitTicks(page, 6);

  // The whole city at zoom 1: every hospital's cross and every gas station's icon on screen.
  const nearRed = await mapColourNear(page, hospitals.map((h) => project(h)), '#d63a3a');
  const nearFuel = await mapColourNear(page, gas.map((g) => project(g)), '#f2a33a');
  console.log(`map: hospitals ${JSON.stringify(nearRed)}, gas stations ${JSON.stringify(nearFuel)}`);
  expect(nearRed.every(Boolean)).toBe(true);
  expect(nearFuel.every(Boolean)).toBe(true);
  await page.screenshot({ path: `${sp6}map-city.png` });

  // The wheel zooms toward the cursor: five notches over the first hospital keep it under the cursor.
  const h0 = project(hospitals[0]!);
  const cam0 = await page.evaluate(() => window.__dm!.camera().position);
  await page.mouse.move(h0.x, h0.y);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  await waitTicks(page, 2);
  const zoom = clientJson.ui.map.wheelStep ** 5;
  // The world point under the cursor stays put: the new centre is that point minus its offset at the new scale.
  const s1 = (Math.min(vp.width, vp.height) / size) * zoom;
  const centre = { x: hospitals[0]!.x - (h0.x - vp.width / 2) / s1, z: hospitals[0]!.z - (h0.y - vp.height / 2) / s1 };
  const zoomed = hospitals.map((h) => project(h, zoom, centre));
  const onScreen = zoomed.map((p) => p.x > 8 && p.x < vp.width - 8 && p.y > 8 && p.y < vp.height - 8);
  expect((await mapColourNear(page, [h0], '#d63a3a'))[0]).toBe(true);
  const visible = zoomed.filter((_, i) => onScreen[i]);
  expect(visible.length).toBeLessThan(hospitals.length); // zoomed in: some of the city is off screen
  expect((await mapColourNear(page, visible, '#d63a3a')).every(Boolean)).toBe(true);
  await page.screenshot({ path: `${sp6}map-zoomed.png` });

  // A drag pans the map with the pointer, and never turns the camera.
  await page.mouse.down();
  await page.mouse.move(h0.x + 60, h0.y + 40, { steps: 6 });
  await page.mouse.up();
  await waitTicks(page, 2);
  expect((await mapColourNear(page, [{ x: h0.x + 60, y: h0.y + 40 }], '#d63a3a'))[0]).toBe(true);
  const cam1 = await page.evaluate(() => window.__dm!.camera().position);
  expect(Math.hypot(cam1.x - cam0.x, cam1.z - cam0.z)).toBeLessThan(0.05);

  // Esc closes it; M opens it again fitted to the whole city.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.mapOpen());
  await expect(page.locator('.map-screen')).toBeHidden();
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__dm!.mapOpen());
  await waitTicks(page, 3);
  expect((await mapColourNear(page, hospitals.map((h) => project(h)), '#d63a3a')).every(Boolean)).toBe(true);
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => !window.__dm!.mapOpen());
  expect(errors).toEqual([]);
});

test('prompts: "F · Ride the car" at the bay, "Hold E · Refuel" at a pump, "No Coins for fuel" with 0 Coins', async ({ page }) => {
  const { errors } = await bootCity(page);
  await hideOverlay(page);
  // On foot beside the car parked in Bayview General's bay (bought at the spawn: its third slot, after the bicycle and
  // the motorbike, bays.spacing apart).
  await grant(page, 'vehicle', 4);
  const car = await vehicle(page, 'car');
  expect(flat(car.position, cityLayout.hospitals[0]!.bay)).toBeLessThan(2 * ridingJson.bays.spacing + 0.5);
  await page.evaluate(([c]) => window.__dm!.viewpoint({ x: c.x, y: c.y, z: c.z - 2 }, { ...c, y: c.y + 1 }), [car.position] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  expect(await page.evaluate(() => window.__dm!.prompt())).toBe('F · Ride the car');
  await expect(page.locator('.hud-prompt')).toHaveText('F · Ride the car');
  await pressF(page, 'car');

  // In the car, stopped beside Bayview Fuel's west pump, with a half tank and no Coins.
  const station = cityLayout.gasStations.find((g) => g.id === 'gas-bayview-fuel')!;
  const pump = station.pumps[0]!;
  await page.evaluate(([p]) => window.__dm!.teleport({ x: p.x, y: p.y + 0.05, z: p.z - 2.5 }), [pump] as const);
  await page.evaluate(() => {
    window.__dm!.advance(10);
    window.__dm!.setFuel('car', 0.5);
    window.__dm!.setCoins(0);
  });
  expect(await page.evaluate(() => window.__dm!.prompt())).toBe('Hold E · Refuel');
  await expect(page.locator('.hud-prompt')).toHaveText('Hold E · Refuel');
  await hold(page, ['KeyE'], TICK_RATE);
  await expect(page.locator('.popup-title', { hasText: 'No Coins for fuel' })).toBeVisible();
  expect((await vehicle(page, 'car')).fuel).toBeCloseTo(0.5, 6);
  // With Coins the same pump fills the tank.
  await page.evaluate(() => window.__dm!.setCoins(100));
  await hold(page, ['KeyE'], 3 * TICK_RATE);
  expect((await vehicle(page, 'car')).fuel).toBeCloseTo(1, 6);
  await expect(page.locator('.popup-title', { hasText: 'Refuelled' })).toBeVisible();
  await page.evaluate((y) => window.__dm!.setLook(y, -0.3), yawTo({ x: pump.x + 9, y: 0, z: pump.z - 12 }, pump));
  await waitCameraSettled(page);
  await page.screenshot({ path: `${sp5}gas-station.png` });
  expect(errors).toEqual([]);
});

test('a stopped motorbike beside the parked car turns around with W and D and drives away (playtest issue 1)', async ({ page }) => {
  const { errors } = await bootCity(page);
  await grant(page, 'vehicle', 4);
  const car = await vehicle(page, 'car');
  const c = ridingJson.rides.car.collider;
  const m = ridingJson.rides.motorbike.collider;
  // On the motorbike alongside the car in the bay, both facing west, 0.3 m between them.
  const beside = { x: car.position.x, y: car.position.y, z: car.position.z - (c.radius + m.radius + 0.3) };
  await rideFrom(page, 'motorbike', { x: beside.x + 3, y: beside.y, z: beside.z }, { x: beside.x - 20, y: beside.y + 1, z: beside.z });
  await page.evaluate(([b]) => window.__dm!.teleport({ ...b, y: b.y + 0.05 }), [beside] as const);
  await page.evaluate(() => window.__dm!.advance(5));
  const start = await player(page);
  expect(start.riding).toBe('motorbike');
  expect(Math.abs(wrap(start.heading - WEST_YAW))).toBeLessThan(0.1);
  // The camera looks back east, but only A / D turn the bike (the mouse never steers).
  await page.evaluate((y) => window.__dm!.setLook(y, -0.2), EAST_YAW);
  // W and D (Decision 7): a right-hand U-turn away from the car, then W alone rides off east.
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  const turned = await page.evaluate(
    ([rate, east]) => {
      for (let i = 0; i < 8 * rate; i++) {
        window.__dm!.advance(1);
        const h = window.__dm!.player().heading;
        if (Math.abs(Math.atan2(Math.sin(h - east), Math.cos(h - east))) < 0.15) return i / rate;
      }
      return -1;
    },
    [TICK_RATE, EAST_YAW] as const,
  );
  await page.keyboard.up('KeyD');
  const mid = await player(page);
  await hold(page, ['KeyW'], 2 * TICK_RATE);
  await page.keyboard.up('KeyW');
  const end = await player(page);
  console.log(`U-turn in ${turned.toFixed(2)} s`);
  expect(turned).toBeGreaterThan(0);
  const moved = flat(end.position, start.position);
  console.log(`motorbike beside the car: heading ${start.heading.toFixed(2)} → ${end.heading.toFixed(2)}, moved ${moved.toFixed(2)} m to x ${end.position.x.toFixed(1)}`);
  expect(Math.abs(wrap(end.heading - EAST_YAW))).toBeLessThan(0.2);
  expect(end.position.x - mid.position.x).toBeGreaterThan(3);
  expect(flat((await vehicle(page, 'car')).position, car.position)).toBeLessThan(0.01); // the car did not move
  expect(errors).toEqual([]);
});

test('playtest screenshots: city overview, each avenue, a switchback, a steep lane, stairs, the docks, the beach, Old Harbor, Hillcrest, a hospital bay, a gas station, the Map app, the debug view', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors } = await bootCity(page);
  await hideOverlay(page);
  await grant(page, 'vehicle', 4); // bought at the spawn, so the hospital bay shot shows them parked
  // The gas station (with the pump prompt), the Map app and the debug view are taken by the tests above.
  const air: [string, P, P][] = [
    ['city-overview.png', { x: 600, y: 250, z: 5 }, { x: 600, y: 0, z: 650 }],
    ['switchback.png', { x: 250, y: 45, z: 530 }, { x: 285, y: 12, z: 592 }], // conn-B-switchback-0
    ['steep-lane.png', { x: 115, y: 34, z: 548 }, { x: 95, y: 16, z: 592 }], // conn-B-steepLane-0
    ['stairs.png', { x: 182, y: 30, z: 554 }, { x: 170, y: 17, z: 596 }], // conn-B-stairs-1
    ['docks.png', { x: 200, y: 45, z: 300 }, { x: 150, y: 0, z: 120 }],
    ['old-harbor.png', { x: 985, y: 25, z: 150 }, { x: 1100, y: 0, z: 70 }], // the pier and the lighthouse on the breakwater
  ];
  for (const [file, feet, target] of air) await cityAirShot(page, feet, target, file);
  const along = (name: string, file: string): [string, P, P] => {
    const r = road(name);
    return [file, { x: 40, y: r.y, z: midZ(r) }, { x: 600, y: r.y + 1.5, z: midZ(r) }];
  };
  const hillcrest = cityLayout.curvedRoads[0]!.polyline;
  const ground: [string, P, P][] = [
    along('Harbor Road', 'avenue-harbor-road.png'),
    along('Bayview Avenue', 'avenue-bayview.png'),
    along('Midtown Avenue', 'avenue-midtown.png'),
    along('Uptown Avenue', 'avenue-uptown.png'),
    ['beach-boardwalk.png', { x: 420, y: 2, z: 204 }, { x: 800, y: 3, z: 120 }],
    ['hillcrest-drive.png', hillcrest[10]!, { ...hillcrest[20]!, y: hillcrest[20]!.y + 2 }],
    // Bayview General from the avenue: the hospital and the car, motorbike and bicycle parked in its bay.
    ['hospital-bay.png', { x: 145, y: 10, z: 315 }, { x: 158, y: 11.5, z: 327 }],
  ];
  for (const [file, feet, target] of ground) await cityGroundShot(page, feet, target, file);
  expect(await page.evaluate(() => window.__dm!.cityStats()!.models)).toBe(0); // placeholder boxes only
  expect(errors).toEqual([]);
});

test('on the car the mouse looks around but W drives along the heading (Review Focus 5)', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await page.evaluate(() => window.__dm!.ride('car'));
  expect(await page.evaluate(() => window.__dm!.player().riding)).toBe('car');
  const before = await page.evaluate(() => window.__dm!.player());
  // The mouse looks behind the car.
  await page.evaluate((h) => window.__dm!.setLook(h + Math.PI, 0), before.heading);
  await page.keyboard.down('KeyW');
  const t0 = await page.evaluate(() => window.__dm!.tick);
  await page.waitForFunction(([t, n]) => window.__dm!.tick - t >= 2 * n, [t0, TICK_RATE] as const);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => window.__dm!.player());
  expect(Math.abs(Math.atan2(Math.sin(after.heading - before.heading), Math.cos(after.heading - before.heading)))).toBeLessThan(0.01);
  const dx = after.position.x - before.position.x;
  const dz = after.position.z - before.position.z;
  expect(Math.hypot(dx, dz)).toBeGreaterThan(2);
  // Yaw 0 faces −Z: the car moved along (−sin h, −cos h).
  const along = (dx * -Math.sin(before.heading) + dz * -Math.cos(before.heading)) / Math.hypot(dx, dz);
  expect(along).toBeGreaterThan(0.98);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// SP6: the economy on the browser mock chain (Decision 1). Each test starts with fresh storage: a new player on foot
// at tier 0 of every line with 600,000 mock GAME (Decision 2). GAME amounts from __dm.chain() are base units.
// ---------------------------------------------------------------------------------------------------------------------

/** Base units per GAME (6 decimals). */
const GAME = 1_000_000;
const START_GAME = 600_000 * GAME;

/** Purchases confirm on the next tick instead of after the mock's 2 s (the dev panel's Confirm delay). */
const instantConfirm = (page: Page): Promise<void> => page.evaluate(() => window.__dm!.devChain.setConfirmSeconds(0));

/** Buys a GAME item at the current quote and lets the chain confirm it (instantConfirm first); returns the tx status. */
async function buyNow(page: Page, itemId: string): Promise<string> {
  const r = await page.evaluate((id) => window.__dm!.buy(id), itemId);
  expect(r, `buy ${itemId}`).toMatchObject({ ok: true });
  await page.evaluate(() => window.__dm!.advance(1));
  return page.evaluate(() => window.__dm!.chain().history.at(-1)!.status);
}

/** A shop row by item id. */
const shopRow = (page: Page, id: string) => page.evaluate((x) => window.__dm!.shop().find((r) => r.itemId === x)!, id);

/** Runs sim until a food offer is on the phone (at most `maxSeconds`) and accepts it; returns the order. */
async function acceptFood(page: Page, maxSeconds = 120) {
  const id = await page.evaluate(
    ([max, rate]) => {
      for (let i = 0; i < max * rate; i++) {
        const o = window.__dm!.offers().find((x) => x.order.kind === 'food');
        if (o) return o.order.id;
        window.__dm!.advance(1);
      }
      return null;
    },
    [maxSeconds, TICK_RATE] as const,
  );
  expect(id, `no food offer in ${maxSeconds} s`).not.toBeNull();
  expect(await page.evaluate((o) => window.__dm!.accept(o), id!)).toBe('ok');
  return page.evaluate((o) => window.__dm!.active().find((a) => a.order.id === o)!.order, id!);
}

/**
 * Delivers an accepted food order on foot: stands at the pickup through the prep, then at the dropoff (with `alone`,
 * once the pickup's popups have expired, so the delivery popup stands alone in a shot).
 */
async function deliver(page: Page, order: { id: string; pickupPoiId: string; dropoffPoiId: string }, alone = false): Promise<void> {
  await standAt(page, order.pickupPoiId);
  await page.evaluate((n) => window.__dm!.advance(n), PICKUP_TICKS);
  expect(await page.evaluate((o) => window.__dm!.active().find((a) => a.order.id === o)?.pickedUpAt ?? null, order.id)).not.toBeNull();
  if (alone) await expect(page.locator('.popup')).toHaveCount(0, { timeout: 10_000 });
  const before = await page.evaluate(() => window.__dm!.totals().deliveries);
  await standAt(page, order.dropoffPoiId);
  const done = await page.evaluate(
    ([n, rate]) => {
      for (let i = 0; i < 3 * rate; i++) {
        window.__dm!.advance(1);
        if (window.__dm!.totals().deliveries > n) return true;
      }
      return false;
    },
    [before, TICK_RATE] as const,
  );
  expect(done, `order ${order.id} not delivered`).toBe(true);
}

/** Waits for the popups on screen to expire (wall-clock), so the next one stands alone in a shot. */
const popupsGone = (page: Page) => expect(page.locator('.popup')).toHaveCount(0, { timeout: 10_000 });

test('a new player starts on foot at tier 0 of every line with 600,000 mock GAME', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  const c = await page.evaluate(() => window.__dm!.chain());
  expect(c.balance).toBe(START_GAME);
  expect(c.accrued).toBe(0);
  expect(c.ownership).toEqual({ lines: { vehicle: 0, bag: 0, shoes: 0, dispatcher: 0 }, skins: [] });
  expect(c.lock).toBeNull();
  expect(c.history).toEqual([]);
  // The vault starts with $50 of GAME at the mock rate ($0.00024 per GAME).
  expect((c.vault / GAME) * 0.00024).toBeCloseTo(50, 6);
  expect(await page.evaluate(() => window.__dm!.vehicles())).toEqual([]);
  expect((await player(page)).riding).toBeNull();
  expect(await page.evaluate(() => window.__dm!.capacityTier())).toBe('walk');
  // F with nothing to ride does nothing.
  await page.keyboard.press('KeyF');
  await waitTicks(page, 3);
  expect((await player(page)).riding).toBeNull();
  // The HUD's GAME figure carries the Mock wallet badge; the Shop shows the balance and each ladder at tier 1.
  await expect(page.locator('.hud-mock-badge')).toBeVisible();
  await page.evaluate(() => window.__dm!.openPhone('shop'));
  await expect(page.locator('.phone-shop-balance')).toHaveText('600,000 GAME · 0 Coins');
  for (const line of ['vehicle', 'bag', 'shoes', 'dispatcher']) {
    expect((await shopRow(page, `line.${line}.1`)).state).toBe('buy');
    expect((await shopRow(page, `line.${line}.2`)).state).toBe('locked');
  }
  expect(errors).toEqual([]);
});

test('buying the skateboard then the bicycle: confirm sheet, "Confirming…", then each is parked or carried and F rides it; the motorbike is locked until then', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  expect((await shopRow(page, 'line.vehicle.3')).state).toBe('locked');
  await page.evaluate(() => window.__dm!.openPhone('shop'));
  await expect(page.locator('.phone-title')).toHaveText('Shop');
  // The skateboard at the mock's 2 s confirm: Buy opens the confirm sheet with the price, the cap and the split.
  const board = page.locator('.phone-shop-row[data-id="line.vehicle.1"]');
  await board.locator('.phone-shop-buy').click();
  const sheet = page.locator('.phone-shop-sheet');
  await expect(sheet).toBeVisible();
  // $2 ÷ $0.00024 = 8,333.33 GAME (whole GAME shown), at most 2% more.
  await expect(sheet.locator('.phone-shop-sheet-price')).toHaveText('$2 ≈ 8,333 GAME');
  await expect(sheet.locator('.phone-shop-sheet-max')).toHaveText('You pay at most 8,500 GAME');
  await expect(sheet.locator('.phone-shop-sheet-split')).toHaveText('80% burned · 20% to the reward vault');
  await expect(sheet.locator('.phone-mock-badge')).toBeVisible();
  await page.screenshot({ path: `${sp6}shop-confirm.png` });
  await sheet.locator('.phone-shop-confirm').click();
  await expect(board.locator('.phone-shop-buy')).toHaveText('Confirming…');
  expect(await page.evaluate(() => window.__dm!.chain().ownership.lines.vehicle)).toBe(0); // nothing until confirmed
  await page.screenshot({ path: `${sp6}purchase-pending.png` });
  await expect(board.locator('.phone-shop-buy')).toHaveText('✓ Owned', { timeout: 5_000 });
  await expect(page.locator('.popup-title', { hasText: 'Skateboard bought' })).toBeVisible();
  await page.screenshot({ path: `${sp6}purchase-confirmed.png` });
  const c1 = await page.evaluate(() => window.__dm!.chain());
  expect(c1.ownership.lines.vehicle).toBe(1);
  const paid = c1.history[0]!;
  expect(paid).toMatchObject({ itemId: 'line.vehicle.1', status: 'confirmed' });
  expect(paid.game / GAME).toBeCloseTo(2 / 0.00024, 5);
  expect(paid.burned + paid.vault).toBe(paid.game);
  expect(paid.vault).toBe(Math.floor(paid.game * 0.2)); // 80% burned, 20% to the vault
  expect(c1.balance).toBe(START_GAME - paid.game);
  expect(await page.evaluate(() => window.__dm!.vehicles().map((v) => [v.tier, v.spot]))).toEqual([['skateboard', 'carried']]);
  expect((await shopRow(page, 'line.vehicle.3')).state).toBe('locked');

  // The bicycle, confirmed on the next tick: parked at the nearest hospital's bay, named in the popup.
  await instantConfirm(page);
  await page.locator('.phone-shop-row[data-id="line.vehicle.2"] .phone-shop-buy').click();
  await sheet.locator('.phone-shop-confirm').click();
  await expect(page.locator('.popup-title', { hasText: 'Bicycle bought · parked at Downtown General' })).toBeVisible();
  expect((await shopRow(page, 'line.vehicle.3')).state).toBe('buy');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());
  const bike = await vehicle(page, 'bicycle');
  expect(bike.spot).toBe('parked');
  const hospital = (await page.evaluate(() => window.__dm!.hospitals()))[0]!;
  expect(flat(bike.position, hospital.bay)).toBeLessThan(0.5);

  // F puts the carried skateboard down and rides it; F again picks it up; beside the bicycle F rides the bicycle.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: 3 }));
  await page.evaluate(() => window.__dm!.advance(3));
  await pressF(page, 'skateboard');
  await pressF(page, null);
  expect((await vehicle(page, 'skateboard')).spot).toBe('carried');
  await page.evaluate(([b]) => window.__dm!.viewpoint({ x: b.x - 2, y: 0, z: b.z }, { ...b, y: 1 }), [bike.position] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  await pressF(page, 'bicycle');
  expect(errors).toEqual([]);
});

test('the price rising past the slippage before confirmation fails the purchase and charges nothing', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // Sent at the mock's 2 s confirm (quoted $2 ≈ 8,334 GAME, at most 8,501) ...
  const sent = await page.evaluate(() => window.__dm!.buy('line.vehicle.1'));
  expect(sent).toMatchObject({ ok: true, tx: { status: 'pending' } });
  // ... then the dev panel moves the rate 20% down (the item costs 20% more GAME): far past the 2% slippage.
  expect(await page.evaluate(() => window.__dm!.devChain.setRate(0.0002))).toBe(true);
  await page.waitForFunction(() => window.__dm!.chain().history[0]!.status !== 'pending', undefined, { timeout: 10_000 });
  const c = await page.evaluate(() => window.__dm!.chain());
  expect(c.history[0]).toMatchObject({ status: 'failed', error: 'slippage', game: 0, burned: 0, vault: 0 });
  expect(c.balance).toBe(START_GAME);
  expect(c.ownership.lines.vehicle).toBe(0);
  expect(await page.evaluate(() => window.__dm!.vehicles())).toEqual([]);
  await expect(page.locator('.popup-title', { hasText: 'The price moved. Nothing was charged; check the new price.' })).toBeVisible();
  // The Shop shows the new price: $2 ÷ $0.0002 = 10,000 GAME.
  expect((await shopRow(page, 'line.vehicle.1')).price.text).toBe('$2 ≈ 10,000 GAME');
  await page.evaluate(() => window.__dm!.openPhone('wallet'));
  await expect(page.locator('.phone-wallet-tx').first()).toContainText('Failed');
  expect(errors).toEqual([]);
});

test('a stale rate shows "Prices updating, purchases paused"', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await page.evaluate(() => window.__dm!.devChain.makeRateStale());
  await page.evaluate(() => window.__dm!.openPhone('shop'));
  await expect(page.locator('.phone-shop-paused')).toHaveText('Prices updating, purchases paused');
  await expect(page.locator('.phone-shop-paused')).toBeVisible();
  const token = (await page.evaluate(() => window.__dm!.shop())).filter((r) => r.tab === 'token');
  expect(token.filter((r) => r.state === 'buy')).toEqual([]);
  expect((await shopRow(page, 'line.vehicle.1')).state).toBe('paused');
  await expect(page.locator('.phone-shop-row[data-id="line.vehicle.1"] .phone-shop-buy')).toBeDisabled();
  expect(await page.evaluate(() => window.__dm!.buy('line.vehicle.1'))).toEqual({ ok: false, message: 'Prices updating, purchases paused' });
  expect((await page.evaluate(() => window.__dm!.chain())).balance).toBe(START_GAME);
  // A keeper update makes the rate live again.
  expect(await page.evaluate(() => window.__dm!.devChain.setRate(0.00024))).toBe(true);
  await expect(page.locator('.phone-shop-paused')).toBeHidden();
  expect((await shopRow(page, 'line.vehicle.1')).state).toBe('buy');
  expect(errors).toEqual([]);
});

/** Offers that arrive over the next `seconds` of sim (ids not on the phone now). */
const freshOffers = async (page: Page, seconds: number): Promise<number> => {
  const seen = await page.evaluate(() => window.__dm!.offers().map((o) => o.order.id));
  return page.evaluate(
    ([n, before]) => {
      const fresh = new Set<string>();
      for (let i = 0; i < n; i++) {
        window.__dm!.advance(1);
        for (const o of window.__dm!.offers()) if (!before.includes(o.order.id)) fresh.add(o.order.id);
      }
      return fresh.size;
    },
    [seconds * TICK_RATE, seen] as const,
  );
};

test('Bag 2 on the bicycle takes two food orders; Shoes 1 and 2 make the sprint 8.56 m/s', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await instantConfirm(page);
  for (const id of ['line.vehicle.1', 'line.vehicle.2']) expect(await buyNow(page, id)).toBe('confirmed');
  await page.evaluate(() => window.__dm!.ride('bicycle'));
  await pressF(page, null); // capacity follows the last ride
  expect(await page.evaluate(() => window.__dm!.capacityTier())).toBe('bicycle');
  // The free Bag (1 slot): one order fills it, and no offer arrives while it is full.
  const a = await acceptFood(page);
  expect(await freshOffers(page, 40)).toBe(0);
  // Bag 2 (3 slots, 25 kg) on the bicycle (cap 3 slots, 25 kg): a second food order, and a third, fit.
  for (const id of ['line.bag.1', 'line.bag.2']) expect(await buyNow(page, id)).toBe('confirmed');
  const b = await acceptFood(page);
  expect(b.id).not.toBe(a.id);
  expect(await page.evaluate(() => window.__dm!.active().length)).toBe(2);
  await acceptFood(page);
  expect(await page.evaluate(() => window.__dm!.active().length)).toBe(3);
  expect(await freshOffers(page, 40)).toBe(0);

  // Shoes 1 and 2: +3.5% each on the 8 m/s sprint.
  for (const id of ['line.shoes.1', 'line.shoes.2']) expect(await buyNow(page, id)).toBe('confirmed');
  await page.evaluate(() => window.__dm!.viewpoint({ x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: -1 }));
  await page.waitForFunction(() => window.__dm!.player().mode === 'ground');
  await page.keyboard.down('KeyW');
  await page.keyboard.press('ShiftLeft');
  const speeds = await page.evaluate(([rate]) => window.__dm!.advance(3 * rate), [TICK_RATE] as const);
  await page.keyboard.up('KeyW');
  const end = speeds.at(-1)!;
  console.log(`Shoes 2 sprint: ${end.toFixed(3)} m/s (max ${Math.max(...speeds).toFixed(3)})`);
  expect(end).toBeCloseTo(8.56, 2);
  expect(errors).toEqual([]);
});

test('a delivery pays GAME in the bicycle range and the Wallet lists it; with the vault emptied the popup says "Vault empty · no GAME"', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  await grant(page, 'vehicle', 2);
  await page.evaluate(() => window.__dm!.setLastRide('bicycle'));
  expect(await page.evaluate(() => window.__dm!.capacityTier())).toBe('bicycle');
  const vault0 = (await page.evaluate(() => window.__dm!.chain())).vault;
  await deliver(page, await acceptFood(page), true);
  const c = await page.evaluate(() => window.__dm!.chain());
  const p = c.payouts[0]!;
  console.log(`payout: $${(p.usdMicro / 1e6).toFixed(4)} = ${p.game / GAME} GAME (luck ${p.luck.toFixed(3)}, quality ${p.quality.toFixed(3)})`);
  expect(c.payouts.length).toBe(1);
  expect(p.paid).toBe(true);
  expect(p.detail).toMatchObject({ tier: 'bicycle', kind: 'food' });
  expect(p.usdMicro).toBeGreaterThanOrEqual(20_000); // $0.02–0.12 per order on the bicycle
  expect(p.usdMicro).toBeLessThanOrEqual(120_000);
  expect(p.usdMicro).toBe(Math.round(20_000 + 100_000 * (0.6 * p.quality + 0.4 * p.luck)));
  expect(p.boost).toBe(1);
  expect(c.accrued).toBe(p.game);
  expect(c.vault).toBe(vault0 - p.game);
  const popup = page.locator('.popup', { hasText: 'Delivered!' });
  await expect(popup).toContainText(`≈ ${Math.floor(p.game / GAME).toLocaleString('en-US')} GAME`);
  await expect.poll(() => popup.evaluate((e) => getComputedStyle(e).opacity), { timeout: 3_000 }).toBe('1');
  await page.screenshot({ path: `${sp6}delivery-game.png` });
  await page.evaluate(() => window.__dm!.openPhone('wallet'));
  await expect(page.locator('.phone-wallet-payout')).toHaveCount(1);
  await expect(page.locator('.phone-wallet-accrued')).toContainText(Math.floor(p.game / GAME).toLocaleString('en-US'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());

  // The dev panel empties the vault: the next order pays points and Coins but no GAME.
  await page.evaluate(() => window.__dm!.devChain.setVaultUsd(0));
  await popupsGone(page);
  const totals = await page.evaluate(() => window.__dm!.totals());
  await deliver(page, await acceptFood(page));
  const after = await page.evaluate(() => ({ chain: window.__dm!.chain(), totals: window.__dm!.totals() }));
  expect(after.chain.payouts[1]).toMatchObject({ paid: false, game: 0 });
  expect(after.chain.accrued).toBe(p.game);
  expect(after.totals.points).toBeGreaterThan(totals.points);
  expect(after.totals.coins).toBeGreaterThan(totals.coins);
  await expect(page.locator('.popup', { hasText: 'Delivered!' })).toContainText('Vault empty · no GAME');
  expect(errors).toEqual([]);
});

test('locking $100 of GAME shows ×1.3 and the next payout is boosted', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  // $100 at $0.00024 per GAME: 416,667 GAME, locked from the Wallet's form.
  await page.evaluate(() => window.__dm!.openPhone('wallet'));
  await page.locator('.phone-wallet-amount').fill('416,667');
  await expect(page.locator('.phone-wallet-preview')).toContainText('×1.30');
  await page.locator('.phone-wallet-lock-btn').click();
  await expect(page.locator('.phone-wallet-lock-boost')).toContainText('×1.30');
  const c = await page.evaluate(() => window.__dm!.chain());
  expect(c.lock).toMatchObject({ game: 416_667 * GAME });
  expect(c.lock!.usdMicroAtLock).toBeGreaterThanOrEqual(100_000_000);
  expect(c.balance).toBe(START_GAME - 416_667 * GAME);
  expect(c.lock!.unlocksAt - c.lock!.lockedAt).toBe(7 * 24 * 3600 * 1000);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());
  await popupsGone(page);

  await deliver(page, await acceptFood(page));
  const p = (await page.evaluate(() => window.__dm!.chain())).payouts[0]!;
  console.log(`boosted payout: $${(p.usdMicro / 1e6).toFixed(4)} ×${p.boost}`);
  expect(p.boost).toBeCloseTo(1.3, 9);
  // On foot (walk, $0.005–0.03), times 1.3.
  expect(p.usdMicro).toBe(Math.round((5_000 + 25_000 * (0.6 * p.quality + 0.4 * p.luck)) * 1.3));
  await expect(page.locator('.popup', { hasText: 'Delivered!' })).toContainText('×1.3 boost');
  // The Wallet with the vault, the lock and the payout history.
  await popupsGone(page);
  await page.evaluate(() => window.__dm!.openPhone('wallet'));
  await expect(page.locator('.phone-wallet-payout')).toHaveCount(1);
  await page.screenshot({ path: `${sp6}wallet.png` });
  await page.locator('.phone-wallet-lock').scrollIntoViewIfNeeded();
  await page.locator('.phone-wallet-payouts').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sp6}wallet-lock-payouts.png` });
  expect(errors).toEqual([]);
});

test('Dispatcher 5 shows five offers', async ({ page }) => {
  // Ruling (Task 20): offers live 25 s and Dispatcher 5 sends one every 9–15 s (18–30 s × 0.5), so at most three are
  // ever on the phone together; the test proves the tier's cap (5, from the Shop's row) and its arrival rate.
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await grant(page, 'bag', 5);
  await grant(page, 'dispatcher', 5);
  expect((await shopRow(page, 'line.dispatcher.5')).detail).toBe('5 offers · every 18–30 s × 0.5');
  expect((await shopRow(page, 'line.dispatcher.5')).state).toBe('owned');
  const r = await page.evaluate(
    ([rate]) => {
      const seen = new Map<string, number>();
      let most = 0;
      for (let i = 0; i < 300 * rate; i++) {
        window.__dm!.advance(1);
        const offers = window.__dm!.offers();
        most = Math.max(most, offers.length);
        for (const o of offers) if (!seen.has(o.order.id)) seen.set(o.order.id, i / rate);
      }
      const at = [...seen.values()];
      return { most, gaps: at.slice(1).map((t, k) => t - at[k]!), count: at.length };
    },
    [TICK_RATE] as const,
  );
  const sorted = [...r.gaps].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  console.log(`Dispatcher 5: ${r.count} offers in 300 s, at most ${r.most} at once, gaps ${sorted.map((g) => g.toFixed(1)).join(' ')}`);
  expect(Math.min(...r.gaps)).toBeGreaterThanOrEqual(9 - 1 / TICK_RATE);
  expect(median).toBeLessThanOrEqual(15 + 1 / TICK_RATE);
  expect(r.count).toBeGreaterThanOrEqual(18); // tier 0 sends one every 18–30 s: at most 17 in 300 s
  expect(r.most).toBeGreaterThanOrEqual(2);
  expect(r.most).toBeLessThanOrEqual(5);
  expect(errors).toEqual([]);
});

test('cancelling an order, then buying the lockout skip, brings an offer within one arrival interval', async ({ page }) => {
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await instantConfirm(page);
  const id = await acceptWithY(page);
  expect(await page.evaluate((o) => window.__dm!.cancel(o), id)).toBe('ok');
  await expect(page.locator('.hud-lockout')).toBeVisible();
  const before = await page.evaluate(() => window.__dm!.offers().map((o) => o.order.id));
  // The Orders app's Skip opens the GAME confirm sheet ($0.50, 100% burned).
  await page.evaluate(() => window.__dm!.openPhone('orders'));
  await page.locator('.phone-skip').click();
  const sheet = page.locator('.phone-shop-sheet:visible');
  await expect(sheet.locator('.phone-shop-sheet-split')).toHaveText('100% burned');
  await sheet.locator('.phone-shop-confirm').click();
  await expect(page.locator('.popup-title', { hasText: 'Offer lockout skipped' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());
  const tx = (await page.evaluate(() => window.__dm!.chain())).history.at(-1)!;
  expect(tx).toMatchObject({ itemId: 'lockoutSkip', status: 'confirmed', vault: 0 });
  expect(tx.burned).toBe(tx.game);
  await expect(page.locator('.hud-lockout')).toBeHidden();
  const took = await page.evaluate(
    ([rate, seen]) => {
      for (let i = 0; i < 31 * rate; i++) {
        if (window.__dm!.offers().some((o) => !seen.includes(o.order.id))) return i / rate;
        window.__dm!.advance(1);
      }
      return -1;
    },
    [TICK_RATE, before] as const,
  );
  console.log(`offer ${took.toFixed(2)} s after the skip (lockout was 45 s)`);
  expect(took).toBeGreaterThanOrEqual(0);
  expect(took).toBeLessThanOrEqual(30);
  expect(errors).toEqual([]);
});

test('a Coin outfit and a car paint are bought and equipped; the courier and car show them', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await grant(page, 'vehicle', 4);
  await page.evaluate(() => window.__dm!.setCoins(500));
  // The free items are worn at the start: Teal outfit, Factory paint (each ride's own colours).
  expect(await page.evaluate(() => window.__dm!.look())).toMatchObject({ outfit: { color: 0x1f9e93 }, vehicle: { color: null } });
  await page.evaluate(() => window.__dm!.openPhone('shop'));
  await page.locator('.phone-shop-tab[data-tab="coins"]').click();
  for (const id of ['cosmetic.outfit.coral', 'cosmetic.vehicle.cherry']) {
    const row = page.locator(`.phone-shop-row[data-id="${id}"]`);
    await expect(row.locator('.phone-shop-price')).toHaveText('50 Coins');
    await row.locator('.phone-shop-buy').click();
    await expect(row.locator('.phone-shop-buy')).toHaveText('✓ Owned');
  }
  expect(await page.evaluate(() => window.__dm!.totals().coins)).toBe(400);
  // Bought is not worn: the Wardrobe's Equip wears them.
  expect(await page.evaluate(() => window.__dm!.look())).toMatchObject({ outfit: { color: 0x1f9e93 } });
  await page.locator('.phone-nav-btn[data-app="wardrobe"]').click();
  await expect(page.locator('.phone-title')).toHaveText('Wardrobe');
  for (const id of ['cosmetic.outfit.coral', 'cosmetic.vehicle.cherry']) {
    const row = page.locator(`.phone-wardrobe-row[data-id="${id}"]`);
    await row.locator('.phone-wardrobe-equip').click();
    await expect(row.locator('.phone-wardrobe-equip')).toHaveText('Equipped');
  }
  expect(await page.evaluate(() => window.__dm!.look())).toMatchObject({ outfit: { color: 0xf27166 }, vehicle: { color: 0xc8323c } });
  // Not owned: greyed in the Wardrobe.
  await expect(page.locator('.phone-wardrobe-row[data-id="cosmetic.outfit.sky"] .phone-wardrobe-equip')).toBeDisabled();
  // Saved: a reload wears them again.
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => window.__dm?.ready === true, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__dm!.look())).toMatchObject({ outfit: { color: 0xf27166 }, vehicle: { color: 0xc8323c } });
  expect(errors).toEqual([]);
});

test('a fuel can adds 25% to the car’s tank and costs 30 Coins', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  // Not for sale with nothing to fill.
  expect((await shopRow(page, 'fuelCan')).state).toBe('locked');
  await page.evaluate(() => window.__dm!.ride('car'));
  await page.evaluate(() => window.__dm!.setFuel('car', 0.5));
  await pressF(page, null); // the last-ridden car, wherever it is
  await page.evaluate(() => window.__dm!.setCoins(100));
  await page.evaluate(() => window.__dm!.openPhone('shop'));
  await page.locator('.phone-shop-tab[data-tab="coins"]').click();
  const row = page.locator('.phone-shop-row[data-id="fuelCan"]');
  await expect(row.locator('.phone-shop-price')).toHaveText('30 Coins'); // 1.5 × the car's 20 Coins per quarter tank
  await page.screenshot({ path: `${sp6}shop-coins.png` });
  await row.locator('.phone-shop-buy').click();
  await expect(page.locator('.popup-title', { hasText: 'Fuel can · car tank 75 %' })).toBeVisible();
  expect(await page.evaluate(() => window.__dm!.totals().coins)).toBe(70);
  expect((await vehicle(page, 'car')).fuel).toBeCloseTo(0.75, 9);
  expect(errors).toEqual([]);
});

test('Garage Switch to the car makes package offers appear on foot', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  await grant(page, 'vehicle', 4);
  await grant(page, 'bag', 5);
  expect(await page.evaluate(() => window.__dm!.capacityTier())).toBe('walk'); // on foot, never ridden: 10 kg at most
  await page.evaluate(() => window.__dm!.openPhone('garage'));
  await expect(page.locator('.phone-title')).toHaveText('Garage');
  const car = page.locator('.phone-garage-row[data-tier="car"]');
  await car.locator('.phone-switch').click();
  await expect(car.locator('.phone-switch')).toHaveText('For offers');
  await expect(car.locator('.phone-garage-range')).toContainText('$0.05–0.60 per order');
  expect(await page.evaluate(() => window.__dm!.capacityTier())).toBe('car');
  expect((await player(page)).riding).toBeNull();
  await page.screenshot({ path: `${sp6}garage.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());
  // A package heavier than anything on foot (10 kg) is offered while the courier stands on foot.
  const heavy = await page.evaluate(
    ([rate]) => {
      for (let i = 0; i < 900 * rate; i++) {
        const o = window.__dm!.offers().find((x) => x.order.kind === 'package' && (x.order.weightKg ?? 0) > 10);
        if (o) return o.order;
        window.__dm!.advance(1);
      }
      return null;
    },
    [TICK_RATE] as const,
  );
  expect(heavy, 'no package over 10 kg in 900 s').not.toBeNull();
  console.log(`on foot, switched to the car: ${heavy!.id} ${heavy!.weightKg} kg`);
  expect(await page.evaluate((o) => window.__dm!.accept(o), heavy!.id)).toBe('ok');
  expect((await player(page)).riding).toBeNull();
  expect(errors).toEqual([]);
});

test('the skateboard ollies over a curb; F at 28 m/s in the car gets off on foot', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  // The long side of suburbs-ramp-01 (x −112..−104, z 72..78, sloping up toward +x) at x = −110 is a 0.3 m kerb face
  // at z = 78 (the board only steps 0.2 m); its top is a 6 m deck down to the ground at z = 72. Toward −Z.
  const start = { x: -110, y: 0, z: 90 };
  const face = 78;
  const r = ridingJson.rides.skateboard.collider.radius;
  await rideFrom(page, 'skateboard', start, { x: -110, y: 0.5, z: 40 });
  await hold(page, ['KeyW'], 3 * TICK_RATE);
  const stopped = await player(page);
  console.log(`skateboard without an ollie: z ${stopped.position.z.toFixed(3)}, y ${stopped.position.y.toFixed(3)}`);
  expect(stopped.position.z - r).toBeGreaterThan(face - 0.05);
  expect(stopped.position.y).toBeLessThan(0.1);
  await page.evaluate((s) => window.__dm!.teleport({ ...s, y: 0.05 }), start); // back, still on the board
  await page.evaluate(() => window.__dm!.advance(5));
  await page.keyboard.down('KeyW');
  const at = await page.evaluate(
    ([rate, z]) => {
      for (let i = 0; i < 5 * rate; i++) {
        window.__dm!.advance(1);
        if (window.__dm!.player().position.z <= z) return window.__dm!.player();
      }
      return null;
    },
    [TICK_RATE, face + r + 1.6] as const,
  );
  expect(at).not.toBeNull();
  await page.keyboard.down('Space');
  await page.evaluate(() => window.__dm!.advance(1));
  await page.keyboard.up('Space');
  expect((await player(page)).mode).not.toBe('ground');
  const flight = await page.evaluate(() =>
    Array.from({ length: 2 * 30 }, () => {
      window.__dm!.advance(1);
      return window.__dm!.player().position;
    }),
  );
  const top = Math.max(...flight.map((p) => p.y));
  await page.keyboard.up('KeyW');
  const over = await player(page);
  console.log(`ollie at ${Math.hypot(at!.velocity.x, at!.velocity.z).toFixed(2)} m/s: top ${top.toFixed(2)} m, then z ${over.position.z.toFixed(3)}, y ${over.position.y.toFixed(3)}, ${over.mode}`);
  expect(top).toBeGreaterThan(0.6);
  expect(over.riding).toBe('skateboard');
  expect(over.mode).toBe('ground');
  expect(over.position.z).toBeLessThan(face - 6); // over the kerb, across the deck and down the far side
  expect(over.position.y).toBeLessThan(0.1);

  // The car flat out down the avenue, then F with W still held: off on foot at once, at most 12 m/s.
  await pressF(page, null); // off the board (picked up), so the car is parked facing the look
  await rideFrom(page, 'car', { x: 100, y: 0, z: -60 }, { x: 100, y: 1, z: 0 });
  await page.keyboard.down('KeyW');
  const fast = await page.evaluate(([rate]) => window.__dm!.advance(5 * rate).at(-1)!, [TICK_RATE] as const);
  expect(fast).toBeGreaterThanOrEqual(28 - 1e-3);
  await page.keyboard.down('KeyF');
  const after = await page.evaluate(() => window.__dm!.advance(1)[0]!);
  await page.keyboard.up('KeyF');
  await page.keyboard.up('KeyW');
  const off = await player(page);
  console.log(`F at ${fast.toFixed(2)} m/s: on foot at ${after.toFixed(2)} m/s`);
  expect(off.riding).toBeNull();
  expect(after).toBeLessThanOrEqual(12 + 1e-6);
  const car = await vehicle(page, 'car');
  expect(car.spot).toBe('parked');
  await page.evaluate((n) => window.__dm!.advance(n), 2 * TICK_RATE);
  const settled = await player(page);
  expect(settled.mode).toBe('ground');
  expect(settled.position.y).toBeCloseTo(0, 1);
  expect(flat(settled.position, car.position)).toBeGreaterThan(1); // beside the car, not inside it
  expect(errors).toEqual([]);
});

test('an order not reached in 3 min fails with the popup and no offer appears for 3 min', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  const id = await acceptWithY(page);
  const item = await page.evaluate(() => window.__dm!.active()[0]!.order.item);
  await popupsGone(page);
  // The courier waits at the spawn: the pickup deadline (180 s from the accept) passes.
  const miss = await page.evaluate(
    ([rate, o]) => {
      const t0 = window.__dm!.tick;
      while (window.__dm!.active().some((a) => a.order.id === o)) {
        if (window.__dm!.tick - t0 > 200 * rate) return null;
        window.__dm!.advance(1);
      }
      return { tick: window.__dm!.tick, offers: window.__dm!.offers().map((x) => x.order.id) };
    },
    [TICK_RATE, id] as const,
  );
  expect(miss, 'the order never failed').not.toBeNull();
  expect(await page.evaluate(() => window.__dm!.totals().deliveries)).toBe(0);
  const popup = page.locator('.popup', { hasText: `Missed the pickup · ${item}` });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('No new offers for 3 min');
  await expect(page.locator('.hud-lockout')).toBeVisible();
  await expect.poll(() => popup.evaluate((e) => getComputedStyle(e).opacity), { timeout: 3_000 }).toBe('1');
  await page.screenshot({ path: `${sp6}missed-pickup.png` });
  const r = await page.evaluate(
    ([rate, t0, before]) => {
      const fresh = new Set<string>();
      // The miss came in the last tick run above, so the lockout's end is one tick before t0 + 180 s.
      while (window.__dm!.tick < t0 - 1 + 180 * rate) {
        window.__dm!.advance(1);
        for (const o of window.__dm!.offers()) if (!before.includes(o.order.id)) fresh.add(o.order.id);
      }
      let resumedAfter = -1;
      for (let i = 0; i < 35 * rate; i++) {
        window.__dm!.advance(1);
        if (window.__dm!.offers().some((o) => !before.includes(o.order.id))) {
          resumedAfter = i / rate;
          break;
        }
      }
      return { fresh: fresh.size, resumedAfter };
    },
    [TICK_RATE, miss!.tick, miss!.offers] as const,
  );
  console.log(`missed-pickup lockout: ${r.fresh} new offers in 180 s; offers resumed ${r.resumedAfter.toFixed(2)} s after`);
  expect(r.fresh).toBe(0);
  expect(r.resumedAfter).toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('playtest screenshots: map screen whole and zoomed, prep bar, ollie, missed pickup, Shop tabs and ladders, purchase pending and confirmed, delivery popup with GAME, Wallet with vault and lock, Wardrobe, painted car, Gold outfit, Garage', async ({ page }) => {
  // The map screen (whole city, zoomed), the missed pickup, the purchase pending and confirmed, the delivery popup with
  // its GAME, the Wallet with the vault, the lock and the payouts, the Shop's Coins tab and the Garage are taken by the
  // tests above (docs/playtest/sp6/).
  test.setTimeout(120_000);
  const errors = await boot(page, SEED);
  await page.waitForFunction(() => window.__dm?.player().mode === 'ground');
  await hideOverlay(page);
  await instantConfirm(page);

  // The prep bar: at the kitchen, half way through the food's prep.
  const order = await acceptFood(page);
  await standAt(page, order.pickupPoiId);
  await page.evaluate((n) => window.__dm!.advance(n), 3 * TICK_RATE);
  await expect(page.locator('.hud-prep')).toContainText('Preparing');
  // From above the pickup's zone marker (4 m tall), so the shot is not tinted by it.
  await page.evaluate(() => window.__dm!.setLook(window.__dm!.player().heading, -0.7));
  await waitCameraSettled(page);
  await page.screenshot({ path: `${sp6}prep-bar.png` });
  expect(await page.evaluate((o) => window.__dm!.cancel(o), order.id)).toBe('ok');

  // The Token tab's four ladders, with the bicycle and Bag 1 owned (the skateboard ticked with them).
  for (const id of ['line.vehicle.1', 'line.vehicle.2', 'line.bag.1', 'line.shoes.1']) expect(await buyNow(page, id)).toBe('confirmed');
  await popupsGone(page);
  await page.evaluate(() => window.__dm!.openPhone('shop'));
  await expect(page.locator('.phone-shop-row[data-id="line.vehicle.2"] .phone-shop-buy')).toHaveText('✓ Owned');
  await page.screenshot({ path: `${sp6}shop-token.png` });
  await page.locator('.phone-shop-row[data-id="line.dispatcher.5"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sp6}shop-token-ladders.png` });

  // The Wardrobe: a Gold outfit (GAME) and Cherry paint (Coins), equipped.
  expect(await buyNow(page, 'skin.outfit.gold')).toBe('confirmed');
  await page.evaluate(() => window.__dm!.setCoins(200));
  await page.locator('.phone-shop-tab[data-tab="coins"]').click();
  await page.locator('.phone-shop-row[data-id="cosmetic.vehicle.cherry"] .phone-shop-buy').click();
  await page.locator('.phone-nav-btn[data-app="wardrobe"]').click();
  for (const id of ['skin.outfit.gold', 'cosmetic.vehicle.cherry']) {
    const row = page.locator(`.phone-wardrobe-row[data-id="${id}"]`);
    await row.locator('.phone-wardrobe-equip').click();
    await expect(row.locator('.phone-wardrobe-equip')).toHaveText('Equipped');
  }
  expect(await page.evaluate(() => window.__dm!.look())).toMatchObject({ outfit: { finish: 'gold' }, vehicle: { color: 0xc8323c } });
  await popupsGone(page);
  await page.screenshot({ path: `${sp6}wardrobe.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__dm!.phoneOpen());

  // The Gold courier beside the Cherry car, bought at the spawn and parked in its bay.
  await grant(page, 'vehicle', 4);
  const car = await vehicle(page, 'car');
  await page.evaluate(([c]) => window.__dm!.viewpoint({ x: c.x - 2.5, y: 0, z: c.z - 4 }, { x: c.x, y: 0.9, z: c.z }), [car.position] as const);
  await page.evaluate(() => window.__dm!.advance(3));
  await waitCameraSettled(page);
  await page.screenshot({ path: `${sp6}gold-outfit-painted-car.png` });

  // The skateboard ollie mid-air on open ground (the shot is retaken if the board had landed before it).
  let midAir = false;
  for (let attempt = 0; attempt < 3 && !midAir; attempt++) {
    await rideFrom(page, 'skateboard', { x: 18, y: 0, z: 3 }, { x: 70, y: 1.6, z: 3 });
    await hold(page, ['KeyW'], TICK_RATE);
    await page.evaluate((y) => window.__dm!.setLook(y + Math.PI / 2 + 0.5, -0.05), (await player(page)).heading);
    // In real time (the render loop steps the sim), so the chase camera follows the board into the air.
    await page.keyboard.down('KeyW');
    await waitTicks(page, 10);
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window.__dm!.player().position.y > 0.45, undefined, { timeout: 5_000 });
    await page.screenshot({ path: `${sp6}ollie.png` });
    const p = await player(page);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    midAir = p.mode !== 'ground' && p.position.y > 0.15;
    await page.evaluate((n) => window.__dm!.advance(n), TICK_RATE);
    await pressF(page, null);
  }
  expect(midAir, 'the board landed before the ollie shot').toBe(true);
  expect(errors).toEqual([]);
});
