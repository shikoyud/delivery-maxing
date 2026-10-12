import { scoreOrder, type AcceptResult, type MapData, type Order, type OrderSystem, type OrdersConfig } from '@dm/shared';
import { cssHex } from '../render/palette';
import { slotColor } from '../render/waypoints';
import { clock, el, esc, setHtml, setText } from './dom';
import { MODIFIER_LABEL, TYPE_LABEL, poiIndex, pointsText, stageText, stepTexts } from './hudModel';

export interface OrderBoardCallbacks {
  accept(orderId: string): void;
  cancel(orderId: string): void;
  /** Called after the board closes (Esc, E or the close button). */
  closed(): void;
}

const BAND_LABEL = { short: 'Short', medium: 'Medium', long: 'Long' } as const;

/** Seconds left of the post-refresh Accept guard (R28): 0 with no refresh yet or once the window has passed. */
export function refreshGuardLeft(refreshedAt: number | null, now: number, guardSeconds: number): number {
  return refreshedAt === null ? 0 : Math.max(0, refreshedAt + guardSeconds - now);
}

/**
 * Why Accept is disabled, from OrderSystem.canAccept and the post-refresh guard (`guardLeft` s, R28); null when
 * it is enabled. Reasons about the order itself win over the guard.
 */
export function acceptBlockedReason(result: AcceptResult, order: Order, cooldownLeft: number, guardLeft = 0): string | null {
  switch (result) {
    case 'ok':
      return guardLeft > 0 ? 'New orders · wait' : null;
    case 'no_slots':
      return `Needs ${order.slots} free slot${order.slots === 1 ? '' : 's'}`;
    case 'cooldown':
      return `Cooldown ${Math.max(1, Math.ceil(cooldownLeft))} s`;
    case 'not_in_hub':
      return 'Return to the HUB';
    case 'gone':
      return 'Taken';
  }
}

/**
 * The personal Order Board (spec §3.3), a DOM modal opened at the HUB kiosk. Cards carry data-order-id; Accept
 * and Cancel pass the id (never a slot index), so a refresh under the cursor can't accept a different order
 * (Review Focus 3).
 */
export class OrderBoardView {
  private readonly root: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly active: HTMLElement;
  private readonly refresh: HTMLElement;
  private readonly slots: HTMLElement;
  private readonly notice: HTMLElement;
  private open_ = false;

  constructor(
    host: HTMLElement,
    private readonly map: MapData,
    private readonly cfg: OrdersConfig,
    private readonly cb: OrderBoardCallbacks,
    /** KeyboardEvent.code values that close the board: Escape plus the interact binding. */
    private readonly closeCodes: readonly string[],
  ) {
    this.root = el('div', 'board-overlay', host);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Order Board');
    const panel = el('div', 'board-panel', this.root);
    const head = el('div', 'board-head', panel);
    const title = el('div', 'board-title', head);
    title.innerHTML = '<span class="board-brand">Delivery <b>Maxing</b> courier</span><h2>Order Board</h2>';
    const meta = el('div', 'board-meta', head);
    this.slots = el('span', 'board-pill', meta);
    this.refresh = el('span', 'board-pill board-refresh', meta);
    const close = el('button', 'board-close', meta);
    close.type = 'button';
    close.textContent = 'Close · Esc';
    close.dataset.action = 'close';
    this.notice = el('div', 'board-notice', panel);
    this.cards = el('div', 'board-cards', panel);
    el('h3', 'board-section', panel).textContent = 'In your backpack';
    this.active = el('div', 'board-active', panel);

    this.root.addEventListener('click', (e) => this.onClick(e));
    // Capture on window, before InputManager's listener: Esc/E close the board and never reach gameplay
    // (otherwise E would reopen it on the next tick in ?debug mode).
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.root.hidden = false;
    // The board is used with the mouse; the player clicks the game again to resume.
    if (document.pointerLockElement) document.exitPointerLock();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    // Don't leave a focused button that Space or Enter would press later.
    if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    this.cb.closed();
  }

  /**
   * `guardLeft`: seconds left of the post-refresh Accept guard (the board flashes meanwhile); `colorIndex`: the
   * stable colour index of an active order (R29d).
   */
  render(orders: OrderSystem, now: number, inPlaza: boolean, guardLeft: number, colorIndex: (orderId: string) => number): void {
    if (!this.open_) return;
    this.root.classList.toggle('board-refreshed', guardLeft > 0);
    const pois = poiIndex(this.map);
    const cooldownLeft = Math.max(0, orders.cancelCooldownUntil - now);
    setText(this.slots, `Backpack ${orders.usedSlots()}/${orders.backpackCapacity}`);
    setText(this.refresh, `New orders in ${clock(orders.nextRefreshAt - now)}`);
    const notice = !inPlaza
      ? 'Orders can only be accepted or cancelled at the HUB.'
      : cooldownLeft > 0
        ? `You cancelled an order. New orders unlock in ${Math.ceil(cooldownLeft)} s.`
        : '';
    setText(this.notice, notice);
    this.notice.hidden = notice === '';

    const cards = orders.board.map((o) => {
      if (!o) return '<div class="board-card empty"><span>Taken</span><small>A new order arrives at the next refresh</small></div>';
      const route = stepTexts(o, pois)
        .map((t) => `<li>${esc(t)}</li>`)
        .join('');
      const base = scoreOrder(o, { onTime: false, intact: false, withinPar: false }, this.cfg);
      const best = scoreOrder(o, { onTime: true, intact: true, withinPar: false }, this.cfg);
      const bonus =
        o.modifier && o.modifier !== 'heavy' && best.points > base.points
          ? `<div class="board-bonus">+${pointsText(best.points - base.points)} · +${best.coins - base.coins} coins if ${o.modifier === 'express' ? 'on time' : 'intact'}</div>`
          : '';
      const facts = [
        o.band ? BAND_LABEL[o.band] : 'Multi-stop',
        `${Math.round(o.routeDistance)} m route`,
        `${o.slots} slot${o.slots === 1 ? '' : 's'}`,
      ];
      if (o.expressLimit !== null) facts.push(`${clock(o.expressLimit)} limit`);
      const reason = acceptBlockedReason(orders.canAccept(o.id, now, inPlaza), o, cooldownLeft, guardLeft);
      const shownPts = o.modifier === 'heavy' ? best : base;
      return (
        `<div class="board-card type-${o.type}" data-order-id="${esc(o.id)}">` +
        `<div class="board-card-top"><span class="type-badge">${TYPE_LABEL[o.type]}</span>` +
        (o.modifier ? `<span class="chip chip-${o.modifier}">${MODIFIER_LABEL[o.modifier]}</span>` : '') +
        `</div>` +
        `<ol class="board-route">${route}</ol>` +
        `<div class="board-facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>` +
        `<div class="board-reward"><b>${pointsText(shownPts.points)}</b> · ${shownPts.coins} coins</div>${bonus}` +
        `<button type="button" class="accept" data-action="accept"${reason ? ' disabled' : ''}>${reason ? esc(reason) : 'Accept'}</button>` +
        `</div>`
      );
    });
    setHtml(this.cards, cards.join('') || '<div class="board-card empty"><span>No orders right now</span></div>');

    const active = orders.active.map((a) => {
      const disabled = inPlaza ? '' : ' disabled title="Return to the HUB"';
      return (
        `<div class="board-active-row" data-order-id="${esc(a.order.id)}" style="--slot:${cssHex(slotColor(colorIndex(a.order.id)))}">` +
        `<span class="type-badge">${TYPE_LABEL[a.order.type]}</span>` +
        (a.order.modifier ? `<span class="chip chip-${a.order.modifier}">${MODIFIER_LABEL[a.order.modifier]}</span>` : '') +
        `<span class="board-active-stage">${esc(stageText(a, pois))}</span>` +
        `<button type="button" class="cancel" data-action="cancel"${disabled}>Cancel</button></div>`
      );
    });
    setHtml(
      this.active,
      active.join('') ||
        `<div class="board-active-empty">Empty. Cancelling an order locks new ones for ${this.cfg.board.cancelCooldownSeconds} s.</div>`,
    );
  }

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    if (target === this.root) return; // backdrop: keep the board open (accidental clicks)
    const btn = target.closest<HTMLButtonElement>('button[data-action]');
    if (!btn || btn.disabled) return;
    const id = btn.closest<HTMLElement>('[data-order-id]')?.dataset.orderId;
    if (btn.dataset.action === 'close') this.close();
    else if (btn.dataset.action === 'accept' && id) this.cb.accept(id);
    else if (btn.dataset.action === 'cancel' && id) this.cb.cancel(id);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open_ || e.repeat) return;
    if (this.closeCodes.includes(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }
}
