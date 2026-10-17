import { emptyInput, type ButtonState, type InputFrame } from '@dm/shared';
import type { BindingName, ClientConfig } from '../clientConfig';

export type ButtonAction = 'jump' | 'crouch' | 'sprint' | 'interact' | 'hit' | 'phone' | 'map' | 'accept' | 'mount';
export type UiKey = 'devPanel' | 'debugOverlay' | 'mapDebug';

const BUTTONS: readonly ButtonAction[] = ['jump', 'crouch', 'sprint', 'interact', 'hit', 'phone', 'map', 'accept', 'mount'];
const UI_KEYS: readonly UiKey[] = ['devPanel', 'debugOverlay', 'mapDebug'];

/** Raw code for a mouse button, as used in bindings ("Mouse0" = left). */
export const mouseCode = (button: number): string => `Mouse${button}`;

/**
 * Maps raw keys and mouse to actions (spec §4 input layer). Pure: no DOM.
 * Codes are KeyboardEvent.code values or "Mouse<n>". Presses are latched until the next sampleTick, so a tap
 * shorter than a tick is still seen (as pressed and held for that one tick).
 */
export class ActionState {
  onUiKey: ((name: UiKey) => void) | null = null;

  private readonly codeTo = new Map<string, BindingName>();
  /** Codes currently down. */
  private readonly down = new Set<string>();
  /** Actions pressed since the last sampleTick. */
  private readonly latched = new Set<ButtonAction>();
  private yaw = 0;
  private pitch = 0;
  /** Mouse yaw turned since the last takeYawDelta (radians). */
  private yawDelta = 0;

  constructor(
    private readonly input: ClientConfig['input'],
    /** Look pitch limits (radians): the chase camera's [pitchMinDeg, pitchMaxDeg]. */
    private readonly pitchMinRad: number,
    private readonly pitchMaxRad: number,
  ) {
    for (const [name, codes] of Object.entries(input.bindings) as [BindingName, string[]][]) {
      for (const code of codes) this.codeTo.set(code, name);
    }
  }

  keyDown(code: string): void {
    const action = this.codeTo.get(code);
    if (!action || this.down.has(code)) return;
    this.down.add(code);
    if ((UI_KEYS as readonly string[]).includes(action)) this.onUiKey?.(action as UiKey);
    else if ((BUTTONS as readonly string[]).includes(action) && !this.isHeld(action as ButtonAction, code)) {
      this.latched.add(action as ButtonAction);
    }
  }

  /** Whether `code` is bound to a UI key (dev panel, debug overlay, map debug view); those work without pointer lock. */
  isUiCode(code: string): boolean {
    const action = this.codeTo.get(code);
    return action !== undefined && (UI_KEYS as readonly string[]).includes(action);
  }

  keyUp(code: string): void {
    this.down.delete(code);
  }

  mouseDown(button: number): void {
    this.keyDown(mouseCode(button));
  }

  mouseUp(button: number): void {
    this.keyUp(mouseCode(button));
  }

  /** Relative mouse motion in pixels: right turns right, up looks up (unless invertY). */
  mouseMove(dx: number, dy: number): void {
    const k = this.input.mouseSensitivity;
    this.yaw -= dx * k;
    this.yawDelta -= dx * k;
    this.pitch -= (this.input.invertY ? -dy : dy) * k;
    this.pitch = this.clampPitch(this.pitch);
  }

  /** Releases everything (focus or pointer lock lost); held keys need a fresh press to count again. */
  releaseAll(): void {
    this.down.clear();
    this.latched.clear();
  }

  /** Sets the look direction (e.g. the spawn yaw); pitch is clamped. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = this.clampPitch(pitch);
  }

  private clampPitch(p: number): number {
    return Math.min(this.pitchMaxRad, Math.max(this.pitchMinRad, p));
  }

  /** The mouse yaw turned since the last call (the ride camera orbits by it); resets to 0. */
  takeYawDelta(): number {
    const d = this.yawDelta;
    this.yawDelta = 0;
    return d;
  }

  look(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  /** Samples one simulation tick and consumes the latched presses. */
  sampleTick(): InputFrame {
    const f = emptyInput();
    const x = Number(this.held('right')) - Number(this.held('left'));
    const y = Number(this.held('forward')) - Number(this.held('back'));
    const len = Math.hypot(x, y);
    f.move = len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
    f.look = this.look();
    for (const b of BUTTONS) {
      const pressed = this.latched.has(b);
      const s: ButtonState = { held: this.held(b) || pressed, pressed };
      f[b] = s;
    }
    this.latched.clear();
    return f;
  }

  private held(action: BindingName): boolean {
    return this.input.bindings[action].some((c) => this.down.has(c));
  }

  /** Whether `action` is held by a code other than `except` (a second bound key is not a new press). */
  private isHeld(action: ButtonAction, except: string): boolean {
    return this.input.bindings[action].some((c) => c !== except && this.down.has(c));
  }
}

