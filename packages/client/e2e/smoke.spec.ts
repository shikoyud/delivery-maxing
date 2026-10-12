import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import clientJson from '../../../config/client.json' with { type: 'json' };
import type {} from '../src/game/debugHooks';

const artifacts = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });

/** Opens the game in debug mode and waits for the first frame; returns the console errors seen. */
async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('?debug=1');
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
