import type { ClientConfig } from '../clientConfig';
import { cssHex } from '../render/palette';
import { slotColor } from '../render/waypoints';
import { clock, el, esc, setHtml, setText } from './dom';
import { acceptBlockedReason } from './phone/ordersApp';
import { BAND_LABEL, KIND_LABEL, loadText, pointsText, type HudModel, type HudOrder, type HudTimer } from './hudModel';

/** What DeliveryLoop needs from the HUD (tests pass a recorder). */
export interface HudView {
  /** `colorIndex`: the stable colour index of an active order (R29d). */
  update(m: HudModel, colorIndex: (orderId: string) => number): void;
}

/**
 * The always-on HUD (spec §8): active orders top left (stage, target, distance, timers, kg); totals and load top
 * right; offer toasts bottom right with the accept key (or the refusal) on the top one; safe-zone and lockout chips top centre.
 */
export class Hud implements HudView {
  private readonly orders: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly points: HTMLElement;
  private readonly deliveries: HTMLElement;
  private readonly load: HTMLElement;
  private readonly offers: HTMLElement;
  private readonly safe: HTMLElement;
  private readonly lockout: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly ui: Pick<ClientConfig['ui'], 'timerUrgentSeconds'>,
    /** Label of the accept key ("Y"). */
    private readonly acceptKey: string,
  ) {
    const root = el('div', 'hud', host);
    this.orders = el('div', 'hud-active', root);
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
    const load = el('div', 'hud-load', totals);
    el('span', 'hud-load-label', load).textContent = 'Load';
    this.load = el('b', 'hud-load-value', load);
    const chips = el('div', 'hud-chips', root);
    this.safe = el('div', 'hud-chip hud-safe', chips);
    this.lockout = el('div', 'hud-chip hud-lockout', chips);
    this.safe.hidden = true;
    this.lockout.hidden = true;
    this.offers = el('div', 'hud-offers', root);
  }

  update(m: HudModel, colorIndex: (orderId: string) => number): void {
    setText(this.coins, String(m.totals.coins));
    setText(this.points, String(m.totals.points));
    setText(this.deliveries, String(m.totals.deliveries));
    setText(this.load, loadText(m.load));

    this.safe.hidden = m.safeZone === null;
    if (m.safeZone !== null) setText(this.safe, `Safe zone · ${m.safeZone}`);
    this.lockout.hidden = m.lockoutLeft <= 0;
    if (m.lockoutLeft > 0) setText(this.lockout, `No new offers · ${Math.ceil(m.lockoutLeft)} s`);

    setHtml(this.orders, m.orders.map((o) => this.orderRow(o, colorIndex(o.id))).join(''));

    setHtml(
      this.offers,
      m.offers
        .map((o, i) => {
          const kg = o.weightKg !== null ? ` · ${o.weightKg} kg` : '';
          // The top offer shows the accept key, or why an accept would be refused (the phone's copy).
          const blocked = acceptBlockedReason(o.acceptStatus);
          const key =
            i !== 0
              ? ''
              : blocked
                ? `<div class="hud-offer-blocked">${esc(blocked)}</div>`
                : `<div class="hud-offer-accept"><kbd>${esc(this.acceptKey)}</kbd>Accept</div>`;
          return (
            `<div class="hud-offer hud-offer-${o.kind}${i === 0 ? ' top' : ''}" data-offer-id="${esc(o.id)}">` +
            `<div class="hud-offer-top"><span class="hud-kind">${KIND_LABEL[o.kind]} · ${BAND_LABEL[o.band]}${kg}</span>` +
            `<span class="hud-offer-time">${clock(o.secondsLeft)}</span></div>` +
            `<div class="hud-offer-text">${esc(o.pickupText)}</div>` +
            `<div class="hud-offer-text">${esc(o.dropoffText)}</div>` +
            `<div class="hud-offer-bottom"><span class="hud-reward">up to +${pointsText(o.reward.points)} · +${o.reward.coins} coins</span>${key}</div>` +
            `</div>`
          );
        })
        .join(''),
    );
  }

  private timer(label: string, t: HudTimer, lateText: string): string {
    if (t.late) return `<span class="hud-timer late">${lateText}</span>`;
    const urgent = t.secondsLeft < this.ui.timerUrgentSeconds ? ' urgent' : '';
    return `<span class="hud-timer${urgent}">${label} ${clock(t.secondsLeft)}</span>`;
  }

  private orderRow(o: HudOrder, color: number): string {
    const extra: string[] = [];
    if (o.timer) extra.push(o.kind === 'food' ? this.timer('Hot', o.timer, 'Cold · no hot bonus') : this.timer('Par', o.timer, 'Over par · no bonus'));
    if (o.express) extra.push(this.timer('Express', o.express, 'Express late · no bonus'));
    if (o.weightKg !== null) extra.push(`<span class="hud-kg">${o.weightKg} kg</span>`);
    if (o.fragileIntact !== null) {
      extra.push(o.fragileIntact ? '<span class="hud-fragile">Fragile · intact</span>' : '<span class="hud-fragile broken">Fragile · damaged</span>');
    }
    return (
      `<div class="hud-order" data-order-id="${esc(o.id)}" style="--slot:${cssHex(slotColor(color))}">` +
      `<div class="hud-order-top"><span class="hud-order-title">${esc(o.targetName)}</span>` +
      `<span class="hud-distance">${o.distance} m</span></div>` +
      `<div class="hud-stage">${esc(o.stage)}</div>` +
      (extra.length ? `<div class="hud-extra">${extra.join('')}</div>` : '') +
      `</div>`
    );
  }
}
