import { describe, expect, it } from 'vitest';
import { vec3, type SimEvent } from '@dm/shared';
import { interpolationStart, lerpAngle } from '../src/game/interpolation';

describe('interpolationStart', () => {
  const before = vec3(1, 2, 3);
  const after = vec3(50, 0, 50);

  it('keeps the pre-step position for ordinary ticks', () => {
    const events: SimEvent[] = [{ kind: 'jumped' }, { kind: 'landed', fallHeight: 1 }];
    expect(interpolationStart(before, after, events)).toEqual(before);
  });

  it('snaps to the post-step position after a respawn (no camera streak)', () => {
    const p = interpolationStart(before, after, [{ kind: 'respawned', checkpointId: 'cp-1' }]);
    expect(p).toEqual(after);
    expect(p).not.toBe(after); // a copy, not the live state object
  });
});

describe('lerpAngle', () => {
  it('interpolates along the shorter arc across ±π', () => {
    expect(lerpAngle(0, 1, 0.25)).toBeCloseTo(0.25, 12);
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    const mid = lerpAngle(a, b, 0.5);
    expect(Math.abs(Math.cos(mid) - -1)).toBeLessThan(1e-9);
    expect(lerpAngle(a, b, 1)).toBeCloseTo(a + 0.2, 12);
  });
});
