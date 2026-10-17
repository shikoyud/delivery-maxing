import type { RideTier, Vec3 } from '@dm/shared';
import { el, keyLabel } from '../dom';
import type { HudModel } from '../hudModel';
import { createGarageApp } from './garageApp';
import { renderOrdersApp, type OrdersCallbacks } from './ordersApp';
import { createShopApp } from './shopApp';
import { buildStubApp, type StubAppName } from './stubApp';
import { renderWalletApp } from './walletApp';

export type PhoneApp = 'orders' | 'garage' | 'shop' | 'wallet' | 'wardrobe' | 'leaderboard' | 'settings';

/** Nav order (spec §8 app table; the map is its own screen, M: Decision 11). */
export const PHONE_APPS: readonly PhoneApp[] = ['orders', 'garage', 'shop', 'wallet', 'wardrobe', 'leaderboard', 'settings'];

const APP_TITLE: Record<PhoneApp, string> = {
  orders: 'Orders',
  garage: 'Garage',
  shop: 'Shop',
  wallet: 'Wallet',
  wardrobe: 'Wardrobe',
  leaderboard: 'Leaderboard',
  settings: 'Settings',
};

export interface PhoneCallbacks extends OrdersCallbacks {
  /** The phone was closed (Esc / Tab in the phone, or close()). */
  closed(): void;
  /** Garage: Summon `t` to the road next to the courier. */
  summon(t: RideTier): void;
  /** Settings: respawn at the nearest hospital (spec §13 Vehicle stuck). */
  respawn(): void;
  /** Shop: a Coin item's Buy (bought at once). */
  shopBuy(itemId: string): void;
  /** Shop: Confirm on a GAME item's confirm sheet (sent to the chain at the live quote). */
  shopConfirm(itemId: string): void;
  /** Shop: the confirm sheet was cancelled. */
  shopCancel(): void;
}

/** What DeliveryLoop needs from the phone (tests pass a recorder). */
export interface PhoneView {
  readonly isOpen: boolean;
  open(app?: PhoneApp): void;
  close(): void;
  toggle(): void;
  show(app: PhoneApp): void;
  /** `player`/`heading` feed the Garage app (distances). */
  render(model: HudModel, player: Vec3, heading: number): void;
}

/** An app view the phone hosts: its element and how it draws a model. */
export interface PhoneAppView {
  el: HTMLElement;
  render(model: HudModel, player: Vec3, heading: number): void;
}

/**
 * The courier's phone (spec §8): a dimmed backdrop over the game (the HUD stays visible behind it) and a handset
 * with a nav bar of the seven apps. Only the open app renders. While open, the close keys (Esc and the phone key) are
 * caught before the game's input sees them.
 */
export class Phone implements PhoneView {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly navButtons = new Map<PhoneApp, HTMLButtonElement>();
  private readonly views = new Map<PhoneApp, PhoneAppView>();
  private open_ = false;
  private current: PhoneApp = 'orders';
  private last: HudModel | null = null;
  private player: Vec3 = { x: 0, y: 0, z: 0 };
  private heading = 0;

  constructor(
    host: HTMLElement,
    private readonly callbacks: PhoneCallbacks,
    private readonly closeCodes: string[],
  ) {
    this.root = el('div', 'phone', host);
    this.root.hidden = true;
    const device = el('div', 'phone-device', this.root);
    device.setAttribute('role', 'dialog');
    device.setAttribute('aria-label', 'Phone');
    this.title = el('div', 'phone-title', device);
    this.screen = el('div', 'phone-screen', device);
    const nav = el('nav', 'phone-nav', device);
    const footer = el('div', 'phone-footer', device);
    footer.textContent = `${closeCodes.map((c) => (c === 'Escape' ? 'Esc' : keyLabel(c))).join(' or ')} to close`;

    for (const app of PHONE_APPS) {
      const b = el('button', 'phone-nav-btn', nav);
      b.type = 'button';
      b.dataset.app = app;
      b.textContent = APP_TITLE[app];
      b.addEventListener('click', () => this.show(app));
      this.navButtons.set(app, b);
      this.views.set(app, this.buildApp(app));
    }
    this.syncNav();

    // Capture phase on the document runs before InputManager's window listener, so stopping it here keeps the
    // close key from also reaching the game (where Tab would toggle the phone straight back open).
    host.ownerDocument.addEventListener(
      'keydown',
      (e) => {
        if (!this.open_ || !this.closeCodes.includes(e.code)) return;
        e.preventDefault();
        e.stopPropagation();
        // A held Tab auto-repeats: only a fresh press closes, or holding the key would close the phone it just opened.
        if (!e.repeat) this.close();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** The app on screen (or that will be, when opened). */
  get app(): PhoneApp {
    return this.current;
  }

  /** Opens on `app` (Orders by default). */
  open(app: PhoneApp = 'orders'): void {
    this.open_ = true;
    this.root.hidden = false;
    // The apps still hold the last open's content (offers that may have expired since): keep the screen blank
    // until the first fresh model arrives (DeliveryLoop draws one on the next frame).
    this.screen.hidden = this.last === null;
    this.show(app);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.last = null;
    this.callbacks.closed();
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  show(app: PhoneApp): void {
    this.current = app;
    this.syncNav();
    if (this.open_ && this.last) this.views.get(app)!.render(this.last, this.player, this.heading);
  }

  /**
   * Draws the open app (DeliveryLoop calls this at the HUD rate while the phone is open). The apps read everything
   * time-dependent (seconds left, accept status) from the model; the Garage also needs the player's pose.
   */
  render(model: HudModel, player: Vec3 = this.player, heading: number = this.heading): void {
    this.last = model;
    this.player = player;
    this.heading = heading;
    this.screen.hidden = false;
    if (this.open_) this.views.get(this.current)!.render(model, player, heading);
  }

  private buildApp(app: PhoneApp): PhoneAppView {
    const root = el('section', 'phone-app', this.screen);
    root.dataset.app = app;
    switch (app) {
      case 'orders':
        return { el: root, render: (m) => renderOrdersApp(root, m, this.callbacks) };
      case 'wallet':
        return { el: root, render: (m) => renderWalletApp(root, m) };
      case 'garage': {
        const view = createGarageApp((t) => this.callbacks.summon(t));
        root.appendChild(view.el);
        return { el: root, render: (m, p, h) => view.render(m, p, h) };
      }
      case 'shop': {
        const cb = this.callbacks;
        const view = createShopApp({ buy: (id) => cb.shopBuy(id), confirm: (id) => cb.shopConfirm(id), cancel: () => cb.shopCancel() });
        root.appendChild(view.el);
        return { el: root, render: (m, p, h) => view.render(m, p, h) };
      }
      case 'settings':
        buildStubApp(root, app, () => this.callbacks.respawn());
        return { el: root, render: () => undefined };
      default:
        buildStubApp(root, app satisfies StubAppName);
        return { el: root, render: () => undefined };
    }
  }

  private syncNav(): void {
    for (const [app, b] of this.navButtons) {
      const on = app === this.current;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const [app, v] of this.views) v.el.hidden = app !== this.current;
    this.title.textContent = APP_TITLE[this.current];
  }
}
