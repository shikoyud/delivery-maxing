import { describe, expect, it } from 'vitest';
import { vec3, type SimEvent } from '@dm/shared';
import { interpolationStart } from '../src/game/interpolation';

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
