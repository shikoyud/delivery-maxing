import { describe, expect, it } from 'vitest';
import { ACTIONS, emptyInput } from '../../src/input/inputFrame';

describe('inputFrame', () => {
  it('lists the 8 actions', () => {
    expect(ACTIONS).toEqual(['move', 'look', 'jump', 'crouch', 'sprint', 'interact', 'hit', 'board']);
  });
  it('emptyInput is idle and returns fresh objects', () => {
    const a = emptyInput();
    expect(a.move).toEqual({ x: 0, y: 0 });
    expect(a.look).toEqual({ yaw: 0, pitch: 0 });
    expect(a.jump).toEqual({ held: false, pressed: false });
    a.jump.held = true;
    expect(emptyInput().jump.held).toBe(false);
  });
});
