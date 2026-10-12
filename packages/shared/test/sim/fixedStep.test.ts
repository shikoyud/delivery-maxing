import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../src/sim/fixedStep';

function stepsOver(frames: number, frameSeconds: number): number {
  const s = new FixedStepper(30, 5);
  let total = 0;
  for (let i = 0; i < frames; i++) total += s.advance(frameSeconds);
  return total;
}

describe('FixedStepper', () => {
  it('exposes dt = 1/tickRate', () => {
    expect(new FixedStepper(30, 5).dt).toBeCloseTo(1 / 30, 12);
  });
  it('runs exactly 30 steps per simulated second however frames are split', () => {
    expect(stepsOver(144, 1 / 144)).toBe(30);
    expect(stepsOver(7, 1 / 7)).toBe(30);
    expect(stepsOver(60, 1 / 60)).toBe(30);
    expect(stepsOver(30, 1 / 30)).toBe(30);
  });
  it('alpha is the leftover fraction of a tick', () => {
    const s = new FixedStepper(30, 5);
    expect(s.advance(1 / 60)).toBe(0);
    expect(s.alpha).toBeCloseTo(0.5, 5);
    expect(s.alpha).toBeGreaterThanOrEqual(0);
    expect(s.alpha).toBeLessThan(1);
  });
  it('caps a 10 s gap at maxStepsPerFrame and drops the backlog', () => {
    const s = new FixedStepper(30, 5);
    expect(s.advance(10)).toBe(5);
    expect(s.advance(1 / 60)).toBeLessThanOrEqual(1);
    expect(s.alpha).toBeLessThan(1);
  });
  it('ignores negative and NaN frame times', () => {
    const s = new FixedStepper(30, 5);
    expect(s.advance(-1)).toBe(0);
    expect(s.advance(NaN)).toBe(0);
    expect(s.alpha).toBe(0);
  });
});
