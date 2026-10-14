import GUI, { type Controller } from 'lil-gui';
import { RIDE_TIERS, type RideTier } from '@dm/shared';
import { FIXED_MOVEMENT_KEYS, overridesLabel, type DevSettings } from '../game/devSettings';
import { el } from './dom';

export interface DevPanelHooks {
  /** "Reset tuning": the host restores defaults into `settings` in place; the panel then refreshes its sliders. */
  onReset(): void;
  /** "Reset progress": the host zeroes stored and running totals. */
  onResetProgress(): void;
  /** Any value changed (the host saves, debounced). */
  onChange(): void;
  /** The owned vehicles (Game: the sim's garage) and the shortcuts of the "Vehicles" folder. */
  vehicles: {
    owned(t: RideTier): boolean;
    /** The ride the courier is on, or null: its Owned box is locked until the courier gets off. */
    riding(): RideTier | null;
    setOwned(t: RideTier, owned: boolean): void;
    /** "Fill all tanks". */
    fillTanks(): void;
    /** "+500 coins" (the amount is `DEV_COINS`). */
    addCoins(n: number): void;
  };
}

/** What "+500 coins" adds. */
export const DEV_COINS = 500;

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

  // Vehicles: which rides are owned (a new one parks at the first free bay slot, full), tank and coin shortcuts.
  const folder = gui.addFolder('Vehicles');
  const owned = Object.fromEntries(RIDE_TIERS.map((t) => [t, hooks.vehicles.owned(t)])) as Record<RideTier, boolean>;
  const boxes = RIDE_TIERS.map((t) =>
    folder.add(owned, t).name(`Owned · ${t}`).onChange((on: boolean) => {
      hooks.vehicles.setOwned(t, on);
      syncVehicles();
    }),
  );
  // Sync from the garage; the ridden vehicle's box is locked (getting off first keeps the state whole).
  const syncVehicles = (): void => {
    const riding = hooks.vehicles.riding();
    RIDE_TIERS.forEach((t, i) => {
      owned[t] = hooks.vehicles.owned(t);
      boxes[i]!.updateDisplay().enable(t !== riding);
    });
  };
  folder.add({ fill: () => hooks.vehicles.fillTanks() }, 'fill').name('Fill all tanks');
  folder.add({ coins: () => hooks.vehicles.addCoins(DEV_COINS) }, 'coins').name(`+${DEV_COINS} coins`);

  const refresh = (): void => gui.controllersRecursive().forEach((c: Controller) => c.updateDisplay());
  const actions = {
    copy: () => void copyOrShow(gui, JSON.stringify(settings.movement, null, 2)),
    reset: () => {
      hooks.onReset();
      refresh();
    },
    resetProgress: () => {
      hooks.onResetProgress();
      syncVehicles();
    },
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
      if (gui._hidden) {
        syncVehicles(); // ownership or the ride may have changed since (debug API, a reset)
        gui.show();
      } else gui.hide();
    },
    get isOpen() {
      return !gui._hidden;
    },
  };
}
