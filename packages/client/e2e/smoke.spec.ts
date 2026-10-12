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
  // Stand at the hub looking east at the feature cluster.
  await page.evaluate(() => window.__dm!.viewpoint({ x: 6, y: 0, z: 8 }, { x: 28, y: 2, z: 0 }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${artifacts}sp1-features.png` });
  expect(errors).toEqual([]);
});

/**
 * Board seed for the delivery tests. With the starter greybox (3 POIs) its first board is
 * [Pick-up, Drop-off Express, Drop-off]. Tests assert a Drop-off is present, so a map or generator change
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
  const popup = page.locator('.popup').filter({ hasText: 'pts' });
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
