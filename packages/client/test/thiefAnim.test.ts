import { describe, expect, it } from 'vitest';
import { clientConfig } from '../src/clientConfig';
import { thiefClip } from '../src/render/thieves/ThiefView';

const cfg = clientConfig.thieves;

describe('thiefClip', () => {
  it('punches while catching, whatever the mode and speed', () => {
    expect(thiefClip('chase', 7, true)).toEqual({ clip: 'Man_Punch', timeScale: 1 });
    expect(thiefClip('return', 3.5, true)).toEqual({ clip: 'Man_Punch', timeScale: 1 });
    expect(thiefClip('patrol', 0, true)).toEqual({ clip: 'Man_Punch', timeScale: 1 });
  });

  it('runs when chasing, at a rate of speed / runSpeedForFullRun', () => {
    expect(thiefClip('chase', cfg.runSpeedForFullRun, false)).toEqual({ clip: 'Man_Run', timeScale: 1 });
    const half = thiefClip('chase', cfg.runSpeedForFullRun / 2, false);
    expect(half.clip).toBe('Man_Run');
    expect(half.timeScale).toBeCloseTo(0.5, 10);
    const a = thiefClip('chase', 3, false).timeScale;
    const b = thiefClip('chase', 6, false).timeScale;
    expect(b / a).toBeCloseTo(2, 10);
  });

  it('walks on patrol or return above idleSpeed', () => {
    expect(thiefClip('patrol', 2.2, false)).toEqual({ clip: 'Man_Walk', timeScale: 1 });
    expect(thiefClip('return', 3.5, false)).toEqual({ clip: 'Man_Walk', timeScale: 1 });
    expect(thiefClip('patrol', cfg.idleSpeed + 0.01, false).clip).toBe('Man_Walk');
  });

  it('idles on patrol or return at or below idleSpeed', () => {
    expect(thiefClip('patrol', 0, false)).toEqual({ clip: 'Man_Idle', timeScale: 1 });
    expect(thiefClip('return', cfg.idleSpeed, false)).toEqual({ clip: 'Man_Idle', timeScale: 1 });
  });

  it('uses the brief values', () => {
    expect(cfg).toMatchObject({ renderRadius: 150, crossFade: 0.15, runSpeedForFullRun: 7, idleSpeed: 0.3, punchSeconds: 0.5 });
  });
});
