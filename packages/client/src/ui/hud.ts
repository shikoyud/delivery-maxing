import type { ClientConfig } from '../clientConfig';
import { cssHex } from '../render/palette';
import { slotColor } from '../render/waypoints';
import { clock, el, esc, setHtml, setText } from './dom';
import { MODIFIER_LABEL, type HudModel } from './hudModel';

/** The in-game HUD (spec §11): active orders with distances and timers, Coins, Points and backpack slots. */
export class Hud {
  private readonly orders: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly points: HTMLElement;
  private readonly deliveries: HTMLElement;
  private readonly slots: HTMLElement;
  private readonly prompt: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly ui: Pick<ClientConfig['ui'], 'expressUrgentSeconds'>,
  ) {
    const root = el('div', 'hud', host);
    this.orders = el('div', 'hud-orders', root);
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
    this.slots = el('div', 'hud-slots', totals);
    this.prompt = el('div', 'hud-prompt', root);
    this.prompt.hidden = true;
  }

  /** `colorIndex`: the stable colour index of an active order (R29d). */
  update(m: HudModel, prompt: string | null, colorIndex: (orderId: string) => number): void {
    setText(this.coins, String(m.totals.coins));
    setText(this.points, String(m.totals.points));
    setText(this.deliveries, String(m.totals.deliveries));
    const pips = Array.from({ length: m.slots.capacity }, (_, i) => `<i class="${i < m.slots.used ? 'full' : ''}"></i>`).join('');
    setHtml(this.slots, `<span>Backpack</span>${pips}<b>${m.slots.used}/${m.slots.capacity}</b>`);

    const rows = m.orders.map((o) => {
      const chip = o.modifier ? `<span class="chip chip-${o.modifier}">${MODIFIER_LABEL[o.modifier]}</span>` : '';
      const extra: string[] = [];
      // Par on every order (dimmed once over; the order still counts), Express as its own timer beside it.
      extra.push(
        o.par.late
          ? '<span class="hud-timer hud-par late">Par over · no bonus</span>'
          : `<span class="hud-timer hud-par">Par ${clock(o.par.secondsLeft)} left</span>`,
      );
      if (o.express) {
        extra.push(
          o.express.late
            ? '<span class="hud-timer late">Express late · no bonus</span>'
            : `<span class="hud-timer${o.express.secondsLeft < this.ui.expressUrgentSeconds ? ' urgent' : ''}">Express ${clock(o.express.secondsLeft)} left</span>`,
        );
      }
      if (o.fragileIntact !== null) {
        extra.push(o.fragileIntact ? '<span class="hud-fragile">Intact</span>' : '<span class="hud-fragile broken">Damaged</span>');
      }
      return (
        `<div class="hud-order" data-order-id="${esc(o.id)}" style="--slot:${cssHex(slotColor(colorIndex(o.id)))}">` +
        `<div class="hud-order-top"><span class="hud-order-title">${esc(o.title)}</span>${chip}` +
        `<span class="hud-distance">${o.distance} m</span></div>` +
        `<div class="hud-stage">${esc(o.stage)}</div>` +
        (extra.length ? `<div class="hud-extra">${extra.join('')}</div>` : '') +
        `</div>`
      );
    });
    setHtml(
      this.orders,
      rows.length
        ? rows.join('')
        : '<div class="hud-empty">No active orders<br><span>Take orders at the HUB kiosk</span></div>',
    );

    this.prompt.hidden = prompt === null;
    if (prompt !== null) setHtml(this.prompt, prompt);
  }
}
