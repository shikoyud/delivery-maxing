import { describe, expect, it, vi } from 'vitest';
import { clientConfig } from '../src/clientConfig';
import { ActionState } from '../src/input/actionState';

const DEG = Math.PI / 180;
const PITCH_MIN = clientConfig.camera.chase.pitchMinDeg * DEG;
const PITCH_MAX = clientConfig.camera.chase.pitchMaxDeg * DEG;
const make = (): ActionState => new ActionState(clientConfig.input, PITCH_MIN, PITCH_MAX);

describe('ActionState', () => {
  it('W gives move.y = 1; W + D is normalised to length 1', () => {
    const a = make();
    a.keyDown('KeyW');
    expect(a.sampleTick().move).toEqual({ x: 0, y: 1 });
    a.keyDown('KeyD');
    const m = a.sampleTick().move;
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(1, 9);
    expect(m.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(m.y).toBeCloseTo(Math.SQRT1_2, 9);
    a.keyDown('KeyS');
    expect(a.sampleTick().move).toEqual({ x: 1, y: 0 });
  });

  it('a tap between ticks reports pressed on the next tick only', () => {
    const a = make();
    a.keyDown('Space');
    a.keyUp('Space');
    const first = a.sampleTick();
    expect(first.jump.pressed).toBe(true);
    const second = a.sampleTick();
    expect(second.jump.pressed).toBe(false);
    expect(second.jump.held).toBe(false);

    a.mouseDown(0);
    a.mouseUp(0);
    expect(a.sampleTick().hit.pressed).toBe(true);
    expect(a.sampleTick().hit.pressed).toBe(false);
  });

  it('a held key does not re-trigger pressed on repeated keyDown', () => {
    const a = make();
    a.keyDown('KeyE');
    const t1 = a.sampleTick();
    expect(t1.interact).toEqual({ held: true, pressed: true });
    a.keyDown('KeyE');
    a.keyDown('KeyE');
    expect(a.sampleTick().interact).toEqual({ held: true, pressed: false });
    a.keyUp('KeyE');
    expect(a.sampleTick().interact).toEqual({ held: false, pressed: false });
    a.keyDown('KeyE');
    expect(a.sampleTick().interact).toEqual({ held: true, pressed: true });
  });

  it('Tab latches phone, Y latches accept, F latches mount', () => {
    const a = make();
    a.keyDown('Tab');
    a.keyUp('Tab');
    a.keyDown('KeyY');
    a.keyUp('KeyY');
    a.keyDown('KeyF');
    a.keyUp('KeyF');
    const f = a.sampleTick();
    expect(f.phone).toEqual({ held: true, pressed: true });
    expect(f.accept).toEqual({ held: true, pressed: true });
    expect(f.mount).toEqual({ held: true, pressed: true });
    const g = a.sampleTick();
    for (const b of [g.phone, g.accept, g.mount]) expect(b).toEqual({ held: false, pressed: false });
  });

  it('releaseAll clears held buttons and movement (Review Focus 2)', () => {
    const a = make();
    a.keyDown('KeyW');
    a.keyDown('ShiftLeft');
    a.keyDown('KeyC');
    a.mouseDown(0);
    a.sampleTick();
    a.releaseAll();
    const f = a.sampleTick();
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.sprint).toEqual({ held: false, pressed: false });
    expect(f.crouch).toEqual({ held: false, pressed: false });
    expect(f.hit).toEqual({ held: false, pressed: false });
    // A key that was held before the release needs a fresh keyDown to count again.
    a.keyUp('KeyW');
    a.keyDown('KeyW');
    expect(a.sampleTick().move).toEqual({ x: 0, y: 1 });
  });

  it('pitch clamps to [−55°, 35°] (chase camera: down to −55°, up to 35°)', () => {
    const a = make();
    a.mouseMove(0, -1e6); // mouse up looks up
    expect(a.look().pitch).toBeCloseTo(35 * DEG, 9);
    a.mouseMove(0, 2e6);
    expect(a.look().pitch).toBeCloseTo(-55 * DEG, 9);
    expect(a.sampleTick().look.pitch).toBeCloseTo(-55 * DEG, 9);
  });

  it('mouse right turns right (negative yaw), scaled by sensitivity', () => {
    const a = make();
    a.mouseMove(100, 0);
    expect(a.look().yaw).toBeCloseTo(-100 * clientConfig.input.mouseSensitivity, 9);
    expect(a.sampleTick().look.yaw).toBeCloseTo(a.look().yaw, 12);
  });

  it('unbound keys are ignored; Backquote and F3 call onUiKey', () => {
    const a = make();
    const onUi = vi.fn();
    a.onUiKey = onUi;
    a.keyDown('KeyZ');
    a.mouseDown(2);
    const f = a.sampleTick();
    expect(f.move).toEqual({ x: 0, y: 0 });
    for (const b of [f.jump, f.crouch, f.sprint, f.interact, f.hit, f.phone, f.accept, f.mount]) expect(b).toEqual({ held: false, pressed: false });
    expect(onUi).not.toHaveBeenCalled();
    a.keyDown('Backquote');
    a.keyDown('F3');
    expect(onUi.mock.calls).toEqual([['devPanel'], ['debugOverlay']]);
    // Held UI keys fire once per press.
    a.keyDown('F3');
    expect(onUi).toHaveBeenCalledTimes(2);
  });

  it('F4 toggles the map debug view (a UI key: works without pointer lock, latches no button)', () => {
    expect(clientConfig.input.bindings.mapDebug).toEqual(['F4']);
    const a = make();
    const onUi = vi.fn();
    a.onUiKey = onUi;
    expect(a.isUiCode('F4')).toBe(true);
    a.keyDown('F4');
    expect(onUi.mock.calls).toEqual([['mapDebug']]);
    const f = a.sampleTick();
    for (const b of [f.jump, f.crouch, f.sprint, f.interact, f.hit, f.phone, f.map, f.accept, f.mount]) expect(b).toEqual({ held: false, pressed: false });
    a.keyUp('F4');
    a.keyDown('F4');
    expect(onUi).toHaveBeenCalledTimes(2);
  });
});

describe('ActionState.setLook', () => {
  it('sets yaw and clamps pitch', () => {
    const a = make();
    a.setLook(1.25, 10);
    expect(a.look()).toEqual({ yaw: 1.25, pitch: PITCH_MAX });
    a.setLook(1.25, -10);
    expect(a.look()).toEqual({ yaw: 1.25, pitch: PITCH_MIN });
  });
});
