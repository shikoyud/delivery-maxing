import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hud } from '../src/ui/hud';
import { installFakeDom } from './fakeDom';
import { model, offer, order } from './phoneFixtures';

describe('Hud offer toasts', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let hud: Hud;
  const offersHtml = (): string => dom.host.byClass('hud-offers')[0]!.innerHTML;

  beforeEach(() => {
    dom = installFakeDom();
    hud = new Hud(dom.asHost, { timerUrgentSeconds: 10, fuelLowPct: 20 }, 'Y');
  });
  afterEach(() => dom.restore());

  it('shows the accept key on the top offer when the accept would succeed', () => {
    hud.update(model({ offers: [offer('a'), offer('b')] }), () => 0);
    const html = offersHtml();
    expect(html).toContain('<kbd>Y</kbd>Accept');
    expect(html.match(/hud-offer-accept/g)).toHaveLength(1);
  });

  it('shows the refusal copy instead of the accept key when the accept would be refused', () => {
    hud.update(model({ offers: [offer('a', { acceptStatus: 'too_heavy' }), offer('b')] }), () => 0);
    const html = offersHtml();
    expect(html).not.toContain('<kbd>Y</kbd>');
    expect(html).toContain('hud-offer-blocked');
    expect(html).toContain('Too heavy for your ride');
    hud.update(model({ offers: [offer('a', { acceptStatus: 'no_slots' })] }), () => 0);
    expect(offersHtml()).toContain('No free slot');
  });

  it('shows the stamina ring: value as a percentage, dimmed when full, warning colour when low', () => {
    const ring = () => dom.host.byClass('hud-stamina')[0]!;
    hud.update(model({ stamina: 1 }), () => 0);
    expect(ring().getAttribute('aria-valuenow')).toBe('100');
    expect(ring().className).toContain('full');
    hud.update(model({ stamina: 0.6 }), () => 0);
    expect(ring().getAttribute('aria-valuenow')).toBe('60');
    expect(ring().className).not.toContain('full');
    expect(ring().className).not.toContain('low');
    hud.update(model({ stamina: 0.1 }), () => 0);
    expect(ring().getAttribute('aria-valuenow')).toBe('10');
    expect(ring().className).toContain('low');
  });
});

describe('Hud next stop and ride', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let hud: Hud;
  const one = (cls: string) => dom.host.byClass(cls)[0]!;

  beforeEach(() => {
    dom = installFakeDom();
    hud = new Hud(dom.asHost, { timerUrgentSeconds: 10, fuelLowPct: 20 }, 'Y');
  });
  afterEach(() => dom.restore());

  it('shows the next stop top centre: an arrow rotated by bearing − camera yaw, the name and the distance', () => {
    hud.update(model(), () => 0);
    expect(one('hud-next').hidden).toBe(true);
    hud.update(model({ nextStop: { orderId: 'a', name: 'Noodle Bar', distance: 240, bearing: Math.PI / 2 } }), () => 0);
    expect(one('hud-next').hidden).toBe(false);
    expect(one('hud-next-name').textContent).toBe('Noodle Bar');
    expect(one('hud-next-distance').textContent).toBe('240 m');
    const arrow = (): string => one('hud-next-arrow').style.getPropertyValue('--arrow');
    hud.aim(0); // the stop is 90° to the left of the camera: the arrow points left
    expect(arrow()).toBe('-90deg');
    hud.aim(Math.PI / 2); // facing it: straight up
    expect(arrow()).toBe('0deg');
    hud.aim(Math.PI); // the stop is 90° to the right
    expect(arrow()).toBe('90deg');
  });

  it('HUD shows the fuel gauge on the car and not on the bicycle', () => {
    hud.update(model(), () => 0);
    expect(one('hud-ride').hidden).toBe(true);
    hud.update(model({ ride: { tier: 'car', speed: 21.4, fuel: 0.35 } }), () => 0);
    expect(one('hud-ride').hidden).toBe(false);
    expect(one('hud-speed').textContent).toBe('21 m/s');
    expect(one('hud-fuel').hidden).toBe(false);
    expect(one('hud-fuel').getAttribute('aria-valuenow')).toBe('35');
    expect(one('hud-fuel').style.getPropertyValue('--fuel')).toBe('35%');
    expect(one('hud-fuel').className).not.toContain('low');
    hud.update(model({ ride: { tier: 'car', speed: 3, fuel: 0.1 } }), () => 0);
    expect(one('hud-fuel').className).toContain('low');
    hud.update(model({ ride: { tier: 'bicycle', speed: 9.6, fuel: null } }), () => 0);
    expect(one('hud-ride').hidden).toBe(false);
    expect(one('hud-speed').textContent).toBe('10 m/s');
    expect(one('hud-fuel').hidden).toBe(true);
  });

  it('the fuel gauge turns low at ui.fuelLowPct (final review 7)', () => {
    dom.restore();
    dom = installFakeDom();
    hud = new Hud(dom.asHost, { timerUrgentSeconds: 10, fuelLowPct: 40 }, 'Y');
    hud.update(model({ ride: { tier: 'car', speed: 3, fuel: 0.35 } }), () => 0);
    expect(one('hud-fuel').className).toContain('low');
    hud.update(model({ ride: { tier: 'car', speed: 3, fuel: 0.41 } }), () => 0);
    expect(one('hud-fuel').className).not.toContain('low');
  });

  it('shows the accrued GAME top right, whole with thousands separators (spec §8)', () => {
    const value = () => one('hud-game').byClass('hud-stat-value')[0]!.textContent;
    hud.update(model(), () => 0);
    expect(value()).toBe('0');
    hud.update(model({ wallet: { accrued: 1_234_567_890_123, balance: 0 } }), () => 0); // base units: 1,234,567.89 GAME
    expect(value()).toBe('1,234,567');
    expect(one('hud-game').byClass('hud-stat-label')[0]!.textContent).toBe('GAME');
  });

  it('the load chip keeps loadText', () => {
    hud.update(model({ load: { usedSlots: 2, slots: 5, carriedKg: 25, maxPackageKg: 150 }, ride: { tier: 'car', speed: 0, fuel: 1 } }), () => 0);
    expect(one('hud-load-value').textContent).toBe('2/5 · 25/150 kg');
  });
});

describe('Hud key prompt', () => {
  it('renders the model prompt and hides when null', () => {
    const dom = installFakeDom();
    try {
      const hud = new Hud(dom.asHost, { timerUrgentSeconds: 10, fuelLowPct: 20 }, 'Y');
      const line = () => dom.host.byClass('hud-prompt')[0]!;
      hud.update(model({ prompt: 'F · Get off' }), () => 0);
      expect(line().hidden).toBe(false);
      expect(line().textContent).toBe('F · Get off');
      hud.update(model({ prompt: null }), () => 0);
      expect(line().hidden).toBe(true);
    } finally {
      dom.restore();
    }
  });
});

describe('Hud pickup deadline', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let hud: Hud;
  const rowHtml = (): string => dom.host.byClass('hud-active')[0]!.innerHTML;

  beforeEach(() => {
    dom = installFakeDom();
    hud = new Hud(dom.asHost, { timerUrgentSeconds: 10, fuelLowPct: 20 }, 'Y');
  });
  afterEach(() => dom.restore());

  it('an unreached order shows the pickup countdown, urgent under the threshold; a reached one does not', () => {
    hud.update(model({ orders: [order('a', { pickup: { secondsLeft: 161, late: false } })] }), () => 0);
    expect(rowHtml()).toContain('<span class="hud-timer">Pickup 2:41</span>');
    hud.update(model({ orders: [order('a', { pickup: { secondsLeft: 9, late: false } })] }), () => 0);
    expect(rowHtml()).toContain('hud-timer urgent">Pickup 0:09');
    hud.update(model({ orders: [order('a', { pickup: null })] }), () => 0);
    expect(rowHtml()).not.toContain('Pickup');
  });

  it('the lockout chip names a missed pickup', () => {
    const chip = () => dom.host.byClass('hud-lockout')[0]!;
    hud.update(model({ lockoutLeft: 173.2, lockoutReason: 'missedPickup' }), () => 0);
    expect(chip().hidden).toBe(false);
    expect(chip().textContent).toBe('Missed pickup · no new offers · 174 s');
    hud.update(model({ lockoutLeft: 41.5, lockoutReason: 'cancelled' }), () => 0);
    expect(chip().textContent).toBe('No new offers · 42 s');
  });
});

describe('Hud food prep bar', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let hud: Hud;
  const rowHtml = (): string => dom.host.byClass('hud-active')[0]!.innerHTML;

  beforeEach(() => {
    dom = installFakeDom();
    hud = new Hud(dom.asHost, { timerUrgentSeconds: 10, fuelLowPct: 20 }, 'Y');
  });
  afterEach(() => dom.restore());

  it('a preparing order shows a bar at its progress and no seconds', () => {
    hud.update(model({ orders: [order('a', { prep: { progress: 0.5, ready: false } })] }), () => 0);
    const html = rowHtml();
    expect(html).toContain('hud-prep-bar');
    expect(html).toContain('--progress:50%');
    expect(html).toContain('Preparing');
    const prep = html.slice(html.indexOf('class="hud-prep"'));
    expect(prep.slice(0, prep.indexOf('</span>'))).not.toMatch(/\d+:\d\d/);
    expect(html).not.toContain('hud-prep-ready');
  });

  it('a ready order shows "Ready for pickup"', () => {
    hud.update(model({ orders: [order('a', { prep: { progress: 1, ready: true } })] }), () => 0);
    expect(rowHtml()).toContain('Ready for pickup');
    expect(rowHtml()).not.toContain('hud-prep-bar');
  });
});
