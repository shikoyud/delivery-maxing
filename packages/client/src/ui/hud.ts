import type { ClientConfig } from '../clientConfig';
import { cssHex } from '../render/palette';
import { slotColor } from '../render/waypoints';
import { clock, el, esc, mockBadge, setHtml, setText } from './dom';
import { acceptBlockedReason } from './phone/ordersApp';
import { BAND_LABEL, KIND_LABEL, gameText, loadText, pointsText, type HudModel, type HudOrder, type HudTimer } from './hudModel';

/** What DeliveryLoop needs from the HUD (tests pass a recorder). */
export interface HudView {
  /** `colorIndex`: the stable colour index of an active order (R29d). */
  update(m: HudModel, colorIndex: (orderId: string) => number): void;
  /** Per frame: turns the next-stop arrow for the camera's yaw (cheap: one style write when it moved a degree). */
  aim?(cameraYaw: number): void;
}

/**
 * The always-on HUD (spec §8): active orders top left (stage, target, distance, timers, kg); totals, the accrued GAME
 * and load top right; offer toasts bottom right with the accept key (or the refusal) on the top one; top centre the
 * next-stop arrow (name and route distance) over the safe-zone and lockout chips; bottom centre the key prompt; bottom
 * left while riding the speed and, on the motorbike and car, the fuel gauge.
 */
export class Hud implements HudView {
  private readonly orders: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly points: HTMLElement;
  private readonly deliveries: HTMLElement;
  private readonly game: HTMLElement;
  private readonly gameBadge: HTMLElement;
  private readonly load: HTMLElement;
  private readonly offers: HTMLElement;
  private readonly safe: HTMLElement;
  private readonly lockout: HTMLElement;
  private readonly stamina: HTMLElement;
  private readonly next: HTMLElement;
  private readonly nextArrow: HTMLElement;
  private readonly nextName: HTMLElement;
  private readonly nextDistance: HTMLElement;
  private readonly ride: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly fuel: HTMLElement;
  private readonly prompt: HTMLElement;
  /** The next stop's world yaw (null: none), the camera yaw last aimed with, and the arrow angle last written. */
  private bearing: number | null = null;
  private cameraYaw = 0;
  private arrowDeg: number | null = null;

  constructor(
    host: HTMLElement,
    private readonly ui: Pick<ClientConfig['ui'], 'timerUrgentSeconds' | 'fuelLowPct'>,
    /** Label of the accept key ("Y"). */
    private readonly acceptKey: string,
  ) {
    const root = el('div', 'hud', host);
    // Stamina ring, top left (the character info corner). A conic gradient driven by --stamina.
    this.stamina = el('div', 'hud-stamina', root);
    this.stamina.setAttribute('role', 'meter');
    this.stamina.setAttribute('aria-label', 'Stamina');
    el('span', 'hud-stamina-icon', this.stamina).textContent = '⚡';
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
    this.game = stat('GAME', 'hud-game');
    // The GAME figure is the browser mock's (Decision 1): a small badge under it.
    this.gameBadge = mockBadge(this.game.parentNode as HTMLElement, 'hud-mock-badge');
    const load = el('div', 'hud-load', totals);
    el('span', 'hud-load-label', load).textContent = 'Load';
    this.load = el('b', 'hud-load-value', load);
    const top = el('div', 'hud-top', root);
    this.next = el('div', 'hud-next', top);
    this.next.hidden = true;
    this.nextArrow = el('div', 'hud-next-arrow', this.next);
    this.nextArrow.setAttribute('aria-hidden', 'true');
    const nextText = el('div', 'hud-next-text', this.next);
    this.nextName = el('span', 'hud-next-name', nextText);
    this.nextDistance = el('span', 'hud-next-distance', nextText);
    const chips = el('div', 'hud-chips', top);
    this.safe = el('div', 'hud-chip hud-safe', chips);
    this.lockout = el('div', 'hud-chip hud-lockout', chips);
    this.safe.hidden = true;
    this.lockout.hidden = true;
    this.prompt = el('div', 'hud-prompt', root);
    this.prompt.hidden = true;
    this.offers = el('div', 'hud-offers', root);
    this.ride = el('div', 'hud-ride', root);
    this.ride.hidden = true;
    this.speed = el('div', 'hud-speed', this.ride);
    this.fuel = el('div', 'hud-fuel', this.ride);
    this.fuel.setAttribute('role', 'meter');
    this.fuel.setAttribute('aria-label', 'Fuel');
    this.fuel.hidden = true;
    el('span', 'hud-fuel-label', this.fuel).textContent = 'Fuel';
    el('div', 'hud-fuel-bar', this.fuel);
  }

  aim(cameraYaw: number): void {
    this.cameraYaw = cameraYaw;
    if (this.bearing === null) return;
    // Screen angle, clockwise from up: a stop to the camera's left (bearing > yaw) points left.
    let deg = Math.round((-(this.bearing - cameraYaw) * 180) / Math.PI) % 360;
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;
    deg += 0; // no "-0deg"
    if (deg === this.arrowDeg) return;
    this.arrowDeg = deg;
    this.nextArrow.style.setProperty('--arrow', `${deg}deg`);
  }

  update(m: HudModel, colorIndex: (orderId: string) => number): void {
    setText(this.coins, String(m.totals.coins));
    setText(this.points, String(m.totals.points));
    setText(this.deliveries, String(m.totals.deliveries));
    setText(this.game, gameText(m.wallet.accrued));
    this.gameBadge.hidden = !m.wallet.mock;
    setText(this.load, loadText(m.load));

    this.safe.hidden = m.safeZone === null;
    if (m.safeZone !== null) setText(this.safe, `Safe zone · ${m.safeZone}`);
    this.lockout.hidden = m.lockoutLeft <= 0;
    if (m.lockoutLeft > 0) {
      const secs = Math.ceil(m.lockoutLeft);
      setText(this.lockout, m.lockoutReason === 'missedPickup' ? `Missed pickup · no new offers · ${secs} s` : `No new offers · ${secs} s`);
    }

    const n = m.nextStop;
    this.next.hidden = n === null;
    this.bearing = n === null ? null : n.bearing;
    if (n !== null) {
      setText(this.nextName, n.name);
      setText(this.nextDistance, `${n.distance} m`);
      this.aim(this.cameraYaw);
    }

    this.prompt.hidden = m.prompt === null;
    if (m.prompt !== null) setText(this.prompt, m.prompt);

    const r = m.ride;
    this.ride.hidden = r === null;
    if (r !== null) {
      setText(this.speed, `${Math.round(r.speed)} m/s`);
      this.fuel.hidden = r.fuel === null;
      if (r.fuel !== null) {
        const fuelPct = Math.round(Math.min(1, Math.max(0, r.fuel)) * 100);
        this.fuel.style.setProperty('--fuel', `${fuelPct}%`);
        this.fuel.setAttribute('aria-valuenow', String(fuelPct));
        this.fuel.classList.toggle('low', fuelPct <= this.ui.fuelLowPct);
      }
    }

    const pct = Math.round(Math.min(1, Math.max(0, m.stamina)) * 100);
    this.stamina.style.setProperty('--stamina', `${pct}%`);
    this.stamina.setAttribute('aria-valuenow', String(pct));
    this.stamina.classList.toggle('full', pct >= 100);
    this.stamina.classList.toggle('low', pct <= 25);

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
    if (o.prep) {
      extra.push(
        o.prep.ready
          ? '<span class="hud-prep-ready">Ready for pickup</span>'
          : `<div class="hud-prep"><div class="hud-prep-bar" style="--progress:${Math.round(o.prep.progress * 100)}%"></div><span>Preparing</span></div>`,
      );
    }
    if (o.pickup) extra.push(this.timer('Pickup', o.pickup, 'Pickup missed'));
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
