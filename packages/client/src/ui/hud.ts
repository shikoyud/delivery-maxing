import { el, setText } from './dom';
import type { HudModel } from './hudModel';

/**
 * The in-game HUD (spec §11). Transitional (SP3 Task 4): Coins, Points, deliveries and the safe-zone badge; Task 9
 * brings back the active orders and offers.
 */
export class Hud {
  private readonly coins: HTMLElement;
  private readonly points: HTMLElement;
  private readonly deliveries: HTMLElement;
  private readonly safe: HTMLElement;

  constructor(host: HTMLElement) {
    const root = el('div', 'hud', host);
    const totals = el('div', 'hud-totals', root);
    const stat = (label: string, cls: string): HTMLElement => {
      const box = el('div', `hud-stat ${cls}`, totals);
      const v = el('span', 'hud-stat-value', box);
      el('span', 'hud-stat-label', box).textContent = label;
      return v;
    };
    this.coins = stat('coins', 'hud-coins');
    this.points = stat('pts', 'hud-points');
    this.deliveries = stat('delivered', 'hud-deliveries');
    this.safe = el('div', 'hud-safe', root);
    this.safe.hidden = true;
  }

  update(m: HudModel): void {
    setText(this.coins, String(m.totals.coins));
    setText(this.points, String(m.totals.points));
    setText(this.deliveries, String(m.totals.deliveries));
    this.safe.hidden = m.safeZone === null;
    if (m.safeZone !== null) setText(this.safe, `Safe zone · ${m.safeZone}`);
  }
}
