import { describe, expect, it } from 'vitest';
import { RideLook } from '../src/input/rideLook';

const cfg = { recenterDelay: 1.5, recenterRate: 3, recenterMinSpeed: 2 };
const DT = 1 / 60;

describe('RideLook', () => {
  it('mount keeps the camera where it was: offset = cameraYaw − heading', () => {
    const r = new RideLook(cfg);
    r.mount(1.0, 0.4);
    expect(r.offset).toBeCloseTo(0.6, 9);
    expect(r.update(0, 0.4, 0, DT)).toBeCloseTo(1.0, 9);
  });

  it('the mouse orbits: update returns heading + accumulated offset', () => {
    const r = new RideLook(cfg);
    r.mount(0.5, 0.5);
    r.update(0.3, 0.5, 10, DT);
    const yaw = r.update(0.2, 1.0, 10, DT);
    expect(r.offset).toBeCloseTo(0.5, 9);
    expect(yaw).toBeCloseTo(1.5, 9);
  });

  it('after recenterDelay without mouse movement at speed the offset eases to 0 at recenterRate', () => {
    const r = new RideLook(cfg);
    r.mount(Math.PI / 2, 0);
    for (let t = 0; t < 1.4; t += DT) r.update(0, 0, 10, DT);
    expect(r.offset).toBeCloseTo(Math.PI / 2, 9);
    let prev = r.offset;
    for (let t = 0; t < 3; t += DT) {
      r.update(0, 0, 10, DT);
      expect(r.offset).toBeLessThanOrEqual(prev);
      prev = r.offset;
    }
    expect(Math.abs(r.offset)).toBeLessThan(0.05);
  });

  it('mouse movement restarts the delay', () => {
    const r = new RideLook(cfg);
    r.mount(1, 0);
    for (let t = 0; t < 1.4; t += DT) r.update(0, 0, 10, DT);
    r.update(0.01, 0, 10, DT);
    for (let t = 0; t < 1.4; t += DT) r.update(0, 0, 10, DT);
    expect(r.offset).toBeCloseTo(1.01, 9);
  });

  it('below recenterMinSpeed the camera stays where the mouse left it', () => {
    const r = new RideLook(cfg);
    r.mount(1.2, 0);
    for (let t = 0; t < 6; t += DT) r.update(0, 0, 1.5, DT);
    expect(r.offset).toBeCloseTo(1.2, 9);
  });

  it('the offset wraps the short way (π − 0.1 → −π + 0.1 is 0.2 rad)', () => {
    const r = new RideLook(cfg);
    r.mount(Math.PI - 0.1, 0);
    r.update(0.2, 0, 0, DT);
    expect(r.offset).toBeCloseTo(-Math.PI + 0.1, 9);
    const m = new RideLook(cfg);
    m.mount(-Math.PI + 0.1, Math.PI - 0.1);
    expect(m.offset).toBeCloseTo(0.2, 9);
  });
});
