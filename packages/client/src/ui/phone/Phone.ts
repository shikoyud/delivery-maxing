import type { Vec3 } from '@dm/shared';
import { el, keyLabel } from '../dom';
import type { HudModel } from '../hudModel';
import { renderOrdersApp, type OrdersCallbacks } from './ordersApp';
import { buildComingSoon, buildStubApp, type StubAppName } from './stubApp';
import { renderWalletApp } from './walletApp';

export type PhoneApp = 'orders' | 'map' | 'garage' | 'shop' | 'wallet' | 'wardrobe' | 'leaderboard' | 'settings';

/** Nav order (spec §8 app table). */
export const PHONE_APPS: readonly PhoneApp[] = ['orders', 'map', 'garage', 'shop', 'wallet', 'wardrobe', 'leaderboard', 'settings'];

const APP_TITLE: Record<PhoneApp, string> = {
  orders: 'Orders',
  map: 'Map',
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
}

/** What DeliveryLoop needs from the phone (tests pass a recorder). */
export interface PhoneView {
  readonly isOpen: boolean;
  open(app?: PhoneApp): void;
  close(): void;
  toggle(): void;
  show(app: PhoneApp): void;
  /** `player`/`heading` feed the Map app. */
  render(model: HudModel, player: Vec3, heading: number): void;
}

/** An app view the phone hosts: its element and how it draws a model. */
export interface PhoneAppView {
  el: HTMLElement;
  render(model: HudModel, player: Vec3, heading: number): void;
}

/**
 * The courier's phone (spec §8): a dimmed backdrop over the game (the HUD stays visible behind it) and a handset
 * with a nav bar of the eight apps. Only the open app renders. While open, the close keys (Esc and the phone key) are
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
   * time-dependent (seconds left, accept status) from the model; only the Map also needs the player's pose.
   */
  render(model: HudModel, player: Vec3 = this.player, heading: number = this.heading): void {
    this.last = model;
    this.player = player;
    this.heading = heading;
    this.screen.hidden = false;
    if (this.open_) this.views.get(this.current)!.render(model, player, heading);
  }

  /** Puts the real Map app (Task 11) in place of the placeholder. */
  setMapApp(view: PhoneAppView): void {
    const old = this.views.get('map')!;
    view.el.classList.add('phone-app');
    view.el.dataset.app = 'map';
    this.screen.replaceChild(view.el, old.el);
    this.views.set('map', view);
    this.syncNav();
    if (this.open_ && this.current === 'map' && this.last) view.render(this.last, this.player, this.heading);
  }

  private buildApp(app: PhoneApp): PhoneAppView {
    const root = el('section', 'phone-app', this.screen);
    root.dataset.app = app;
    switch (app) {
      case 'orders':
        return { el: root, render: (m) => renderOrdersApp(root, m, this.callbacks) };
      case 'wallet':
        return { el: root, render: (m) => renderWalletApp(root, m) };
      case 'map':
        buildComingSoon(root, 'Map', 3); // placeholder until Task 11's setMapApp
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
