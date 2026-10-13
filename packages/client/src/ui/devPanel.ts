import GUI, { type Controller } from 'lil-gui';
import { FIXED_MOVEMENT_KEYS, overridesLabel, type DevSettings } from '../game/devSettings';
import { el } from './dom';

export interface DevPanelHooks {
  /** "Reset tuning": the host restores defaults into `settings` in place; the panel then refreshes its sliders. */
  onReset(): void;
  /** "Reset progress": the host zeroes stored and running totals. */
  onResetProgress(): void;
  /** Any value changed (the host saves, debounced). */
  onChange(): void;
}

export interface DevPanel {
  toggle(): void;
  /** Shows how many values differ from the defaults (R27). */
  setOverrideCount(n: number): void;
  readonly isOpen: boolean;
}

/** Slider range for a field, derived from its default so no movement value is hard-coded here. */
const RANGE_FACTOR = 3;

function rangeFor(def: number): { min: number; max: number; step: number } {
  const span = Math.abs(def) > 0 ? Math.abs(def) * RANGE_FACTOR : 1;
  const step = span >= 20 ? 0.5 : span >= 2 ? 0.05 : 0.01;
  return def < 0 ? { min: -span, max: 0, step } : { min: 0, max: span, step };
}

/** Copy text to the clipboard, or show it in a textarea (selected) when the API is missing or rejects. */
async function copyOrShow(gui: GUI, text: string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the textarea.
  }
  const existing = gui.domElement.querySelector('textarea.dm-dev-json');
  const area = existing instanceof HTMLTextAreaElement ? existing : el('textarea', 'dm-dev-json', gui.domElement);
  area.value = text;
  area.readOnly = true;
  area.rows = 8;
  area.focus();
  area.select();
}

/**
 * Live tuning panel (lil-gui). Edits `settings.movement` in place, the same object PlayerSim holds, so changes
 * apply on the next tick. Starts hidden; toggle() opens and closes it.
 */
export function mountDevPanel(settings: DevSettings, hooks: DevPanelHooks): DevPanel {
  const gui = new GUI({ title: 'Dev tuning', width: 300 });
  gui.domElement.classList.add('dm-dev-panel');
  gui.hide();
  const status = { overrides: overridesLabel(0) };
  const statusCtrl = gui.add(status, 'overrides').name('status').disable();

  const walk = (folder: GUI, obj: Record<string, number>): void => {
    for (const [key, def] of Object.entries(obj)) {
      const r = rangeFor(def);
      folder.add(obj, key, r.min, r.max, r.step).onChange(hooks.onChange);
    }
  };
  const movement = settings.movement as unknown as Record<string, number | Record<string, number>>;
  const top = gui.addFolder('general');
  for (const [key, val] of Object.entries(movement)) {
    if (FIXED_MOVEMENT_KEYS.includes(key)) continue;
    if (typeof val === 'number') {
      const r = rangeFor(val);
      top.add(movement as Record<string, number>, key, r.min, r.max, r.step).onChange(hooks.onChange);
    } else {
      walk(gui.addFolder(key).close(), val);
    }
  }

  const refresh = (): void => gui.controllersRecursive().forEach((c: Controller) => c.updateDisplay());
  const actions = {
    copy: () => void copyOrShow(gui, JSON.stringify(settings.movement, null, 2)),
    reset: () => {
      hooks.onReset();
      refresh();
    },
    resetProgress: () => hooks.onResetProgress(),
  };
  gui.add(actions, 'copy').name('Copy movement JSON');
  gui.add(actions, 'reset').name('Reset tuning');
  gui.add(actions, 'resetProgress').name('Reset progress');

  return {
    setOverrideCount(n) {
      status.overrides = overridesLabel(n);
      statusCtrl.updateDisplay();
    },
    toggle() {
      if (gui._hidden) gui.show();
      else gui.hide();
    },
    get isOpen() {
      return !gui._hidden;
    },
  };
}
