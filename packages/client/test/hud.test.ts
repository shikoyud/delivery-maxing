import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hud } from '../src/ui/hud';
import { installFakeDom } from './fakeDom';
import { model, offer } from './phoneFixtures';

describe('Hud offer toasts', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let hud: Hud;
  const offersHtml = (): string => dom.host.byClass('hud-offers')[0]!.innerHTML;

  beforeEach(() => {
    dom = installFakeDom();
    hud = new Hud(dom.asHost, { timerUrgentSeconds: 10 }, 'Y');
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
