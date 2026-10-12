import type { ActionState } from './actionState';

export interface InputManagerOptions {
  /** When true, keys and buttons only count while the pointer is locked (normal play). Debug mode passes false. */
  requirePointerLock: boolean;
}

/** Wires DOM keyboard, mouse, focus and pointer-lock events into an ActionState. */
export class InputManager {
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly target: HTMLElement,
    private readonly actions: ActionState,
    private readonly opts: InputManagerOptions,
  ) {
    const doc = target.ownerDocument;
    const win = doc.defaultView ?? window;
    this.listen(win, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(win, 'keyup', (e) => this.actions.keyUp((e as KeyboardEvent).code));
    this.listen(target, 'mousedown', (e) => {
      if (this.active) this.actions.mouseDown((e as MouseEvent).button);
    });
    this.listen(win, 'mouseup', (e) => this.actions.mouseUp((e as MouseEvent).button));
    this.listen(doc, 'mousemove', (e) => {
      const m = e as MouseEvent;
      if (this.locked) this.actions.mouseMove(m.movementX, m.movementY);
    });
    this.listen(win, 'blur', () => this.actions.releaseAll());
    this.listen(doc, 'visibilitychange', () => {
      if (doc.visibilityState === 'hidden') this.actions.releaseAll();
    });
    this.listen(doc, 'pointerlockchange', () => {
      if (!this.locked) this.actions.releaseAll();
    });
    this.listen(target, 'click', () => {
      if (!this.locked) void Promise.resolve(target.requestPointerLock()).catch(() => undefined);
    });
    this.listen(target, 'contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return this.target.ownerDocument.pointerLockElement === this.target;
  }

  /** Whether gameplay keys count right now. */
  private get active(): boolean {
    return this.locked || !this.opts.requirePointerLock;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    const ui = this.actions.isUiCode(e.code);
    // Typing in a panel field (lil-gui inputs) must not drive the player.
    const t = e.target;
    if (!ui && t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (!ui && !this.active) return;
    // Keep the browser from scrolling (Space) or using F3 as find.
    if (ui || e.code === 'Space') e.preventDefault();
    this.actions.keyDown(e.code);
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void): void {
    t.addEventListener(type, fn);
    this.disposers.push(() => t.removeEventListener(type, fn));
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }
}
