import { ordersConfig, type AcceptResult } from '@dm/shared';
import { clock, el, setText } from '../dom';
import { BAND_LABEL, KIND_LABEL, pointsText, type HudModel, type HudOffer, type HudOrder, type HudTimer } from '../hudModel';

export interface OrdersCallbacks {
  accept(offerId: string): void;
  cancel(orderId: string): void;
  /** Dev stub until SP6 (burning GAME, price Pending). */
  skipLockout(): void;
}

const BLOCKED: Record<AcceptResult, string> = {
  ok: '',
  gone: 'Taken',
  expired: 'Expired',
  no_slots: 'No free slot',
  too_heavy: 'Too heavy for your ride',
};

/** The disabled Accept button's copy for a refused accept ('' for 'ok'). */
export function acceptBlockedReason(result: AcceptResult): string {
  return BLOCKED[result];
}

/**
 * Keeps `list`'s children in step with `items` by key: existing elements are updated in place (so a button under the
 * cursor is never replaced between mousedown and click), missing ones created, stale ones removed.
 */
function syncList<T, V extends { el: HTMLElement }>(
  list: HTMLElement,
  views: Map<string, V>,
  items: readonly T[],
  key: (item: T) => string,
  create: (item: T) => V,
  update: (view: V, item: T) => void,
): void {
  const keep = new Set(items.map(key));
  for (const [k, v] of views) {
    if (!keep.has(k)) {
      v.el.remove();
      views.delete(k);
    }
  }
  items.forEach((item, i) => {
    const k = key(item);
    let v = views.get(k);
    if (!v) views.set(k, (v = create(item)));
    update(v, item);
    const at = list.children[i] ?? null;
    if (at !== v.el) list.insertBefore(v.el, at);
  });
}

interface OfferCard {
  el: HTMLElement;
  kind: HTMLElement;
  time: HTMLElement;
  pickup: HTMLElement;
  dropoff: HTMLElement;
  reward: HTMLElement;
  accept: HTMLButtonElement;
}

interface ActiveCard {
  el: HTMLElement;
  title: HTMLElement;
  stage: HTMLElement;
  timers: HTMLElement;
  cancel: HTMLButtonElement;
}

function button(cls: string, action: string, parent: HTMLElement): HTMLButtonElement {
  const b = el('button', `phone-btn ${cls}`, parent);
  b.type = 'button';
  b.dataset.action = action;
  return b;
}

function timerText(label: string, t: HudTimer, lateText: string): string {
  return t.late ? lateText : `${label} ${clock(t.secondsLeft)}`;
}

/** Hot / Par / Express lines of an active order (none before pickup: timers start at pickup). */
export function orderTimers(o: HudOrder): string[] {
  const out: string[] = [];
  if (o.timer) out.push(o.kind === 'food' ? timerText('Hot', o.timer, 'Cold · no hot bonus') : timerText('Par', o.timer, 'Over par · no bonus'));
  if (o.express) out.push(timerText('Express', o.express, 'Express late · no bonus'));
  if (o.timer === null) out.push('Timer starts at pickup');
  return out;
}

/** The Orders app (spec §8): incoming offers with Accept, active orders with Cancel, and the lockout row with skip. */
class OrdersApp {
  cb: OrdersCallbacks;
  private readonly lockout: HTMLElement;
  private readonly lockoutText: HTMLElement;
  private readonly offerList: HTMLElement;
  private readonly offersEmpty: HTMLElement;
  private readonly activeList: HTMLElement;
  private readonly activeEmpty: HTMLElement;
  private readonly offerCards = new Map<string, OfferCard>();
  private readonly activeCards = new Map<string, ActiveCard>();

  constructor(root: HTMLElement, cb: OrdersCallbacks) {
    this.cb = cb;
    const wrap = el('div', 'phone-orders', root);
    this.lockout = el('div', 'phone-lockout', wrap);
    this.lockout.hidden = true;
    this.lockoutText = el('span', 'phone-lockout-text', this.lockout);
    const skip = button('phone-skip', 'skip', this.lockout);
    skip.textContent = 'Skip (burn GAME)';
    skip.title = 'Ends the offer lockout now. Burning GAME comes with SP6; this is a dev stub.';
    skip.addEventListener('click', () => this.cb.skipLockout());
    el('span', 'phone-devstub', this.lockout).textContent = 'dev stub';

    el('h3', 'phone-section', wrap).textContent = 'Offers';
    this.offerList = el('div', 'phone-list', wrap);
    this.offersEmpty = el('p', 'phone-empty', wrap);
    el('h3', 'phone-section', wrap).textContent = 'Active orders';
    this.activeList = el('div', 'phone-list', wrap);
    this.activeEmpty = el('p', 'phone-empty', wrap);
    this.activeEmpty.textContent = 'No active orders.';
  }

  render(m: HudModel): void {
    this.lockout.hidden = m.lockoutLeft <= 0;
    if (m.lockoutLeft > 0) setText(this.lockoutText, `No new offers for ${Math.ceil(m.lockoutLeft)} s`);

    syncList(this.offerList, this.offerCards, m.offers, (o) => o.id, (o) => this.offerCard(o), (c, o) => this.updateOffer(c, o));
    this.offersEmpty.hidden = m.offers.length > 0;
    setText(this.offersEmpty, m.lockoutLeft > 0 ? 'Offers resume when the lockout ends.' : 'Waiting for offers…');

    syncList(this.activeList, this.activeCards, m.orders, (o) => o.id, (o) => this.activeCard(o), (c, o) => this.updateActive(c, o));
    this.activeEmpty.hidden = m.orders.length > 0;
  }

  private offerCard(o: HudOffer): OfferCard {
    const card = el('div', `phone-card phone-offer phone-offer-${o.kind}`);
    card.dataset.id = o.id;
    const top = el('div', 'phone-card-top', card);
    const view: OfferCard = {
      el: card,
      kind: el('span', 'phone-kind', top),
      time: el('span', 'phone-time', top),
      pickup: el('div', 'phone-card-text', card),
      dropoff: el('div', 'phone-card-text', card),
      reward: el('div', 'phone-reward', card),
      accept: button('phone-accept', 'accept', card),
    };
    view.accept.dataset.id = o.id;
    view.accept.addEventListener('click', () => {
      if (!view.accept.disabled) this.cb.accept(o.id);
    });
    return view;
  }

  private updateOffer(c: OfferCard, o: HudOffer): void {
    const kg = o.weightKg !== null ? ` · ${o.weightKg} kg` : '';
    setText(c.kind, `${KIND_LABEL[o.kind]} · ${BAND_LABEL[o.band]}${kg}`);
    setText(c.time, clock(o.secondsLeft));
    setText(c.pickup, o.pickupText);
    setText(c.dropoff, o.dropoffText);
    setText(c.reward, `up to +${pointsText(o.reward.points)} · +${o.reward.coins} coins`);
    const blocked = acceptBlockedReason(o.acceptStatus);
    c.accept.disabled = blocked !== '';
    setText(c.accept, blocked || 'Accept');
    c.accept.title = blocked;
  }

  private activeCard(o: HudOrder): ActiveCard {
    const card = el('div', `phone-card phone-active-order phone-offer-${o.kind}`);
    card.dataset.id = o.id;
    const top = el('div', 'phone-card-top', card);
    const view: ActiveCard = {
      el: card,
      title: el('span', 'phone-kind', top),
      stage: el('div', 'phone-card-text', card),
      timers: el('div', 'phone-timers', card),
      cancel: button('phone-cancel', 'cancel', card),
    };
    view.cancel.dataset.id = o.id;
    view.cancel.textContent = 'Cancel';
    view.cancel.title = `No reward, and no new offers for ${ordersConfig.lockout.seconds} s`;
    view.cancel.addEventListener('click', () => this.cb.cancel(o.id));
    return view;
  }

  private updateActive(c: ActiveCard, o: HudOrder): void {
    const kg = o.weightKg !== null ? ` · ${o.weightKg} kg` : '';
    setText(c.title, `${KIND_LABEL[o.kind]} · ${o.distance} m${kg}`);
    setText(c.stage, o.stage);
    const extra = orderTimers(o);
    if (o.fragileIntact !== null) extra.push(o.fragileIntact ? 'Fragile · intact' : 'Fragile · damaged');
    setText(c.timers, extra.join(' · '));
  }
}

const apps = new WeakMap<HTMLElement, OrdersApp>();

/** Renders the Orders app into `root` (built on the first call, updated in place after). */
export function renderOrdersApp(root: HTMLElement, model: HudModel, cb: OrdersCallbacks): void {
  let app = apps.get(root);
  if (!app) apps.set(root, (app = new OrdersApp(root, cb)));
  app.cb = cb;
  app.render(model);
}
