import GUI, { type Controller } from 'lil-gui';
import { GAME_UNITS, LINES, tierOfVehicle, RIDE_TIERS, type CarrierCapacity, type Line, type RideTier } from '@dm/shared';
import type { MockChain } from '../economy/MockChain';
import { FIXED_MOVEMENT_KEYS, overridesLabel, type DevSettings } from '../game/devSettings';
import type { TeleportTarget } from '../game/mapTargets';
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
    /** The read-only capacity line (see `capacityLabel`). */
    capacityLabel(): string;
  };
  /** The "Economy" folder: the mock chain's dev controls and the tiers of each line. */
  economy: {
    dev: MockChain['dev'];
    /** The current GAME price in USD, or null without a rate. */
    rate(): number | null;
    tier(line: Line): number;
    tierMax(line: Line): number;
    /** Sets a line's tier; the vehicle line goes through the garage (Game.setOwned), refused (false) while riding a tier that would go. */
    setTier(line: Line, tier: number): boolean;
    confirmSeconds(): number;
    vaultUsd(): number;
    /** Calls `listener` after every chain change; returns the unsubscriber. */
    subscribe(listener: () => void): () => void;
  };
  /** The "Map" folder: the loaded map's teleport entries and the lot-id view (the city only; null on the greybox). */
  map: {
    kind: string;
    targets: TeleportTarget[];
    teleportTo(id: string): void;
    lotIds: { get(): boolean; set(on: boolean): void } | null;
  };
}

export interface MapRowItem {
  label: string;
  kind: TeleportTarget['kind'];
  run(): void;
}

/** The Map row's "Teleport to" buttons, one per target, each calling `teleportTo` with its id. */
export function mapRowItems(targets: TeleportTarget[], teleportTo: (id: string) => void): MapRowItem[] {
  return targets.map((t) => ({
    label: `Teleport to ${t.label}`,
    kind: t.kind,
    run: () => teleportTo(t.id),
  }));
}

/** "Bag 2 × bicycle → 3 slots, 25 kg": the Bag tier and the ride, and the capacity they give (spec §3.3). */
export function capacityLabel(bagTier: number, ride: string, c: CarrierCapacity): string {
  return `Bag ${bagTier} × ${ride} → ${c.slots} slot${c.slots === 1 ? '' : 's'}, ${c.maxPackageKg} kg`;
}

/** What "+100,000 GAME" adds (whole GAME; the chain takes base units). */
export const DEV_GAME = 100_000;

export const RATE_REFUSED = 'Rate move over 20% refused';

export interface EconomyActions {
  addGame(): void;
  /** Sets the GAME price; returns the refusal text when the move is over the limit, else null. */
  setRate(usd: number): string | null;
  makeStale(): void;
  failNext(): void;
  setConfirmSeconds(s: number): void;
  setVaultUsd(usd: number): void;
  setTier(line: Line, tier: number): boolean;
  advanceDay(): void;
}

/** The Economy folder's actions over the chain's dev controls (pure, so tests drive them without a DOM). */
export function economyActions(dev: MockChain['dev'], gameUnits: number, setTier: (line: Line, tier: number) => boolean = (l, t) => (dev.grantTier(l, t), true)): EconomyActions {
  return {
    addGame: () => dev.addGame(DEV_GAME * gameUnits),
    setRate: (usd) => (dev.setRate(usd) ? null : RATE_REFUSED),
    makeStale: () => dev.makeRateStale(),
    failNext: () => dev.failNext(),
    setConfirmSeconds: (s) => dev.setConfirmSeconds(s),
    setVaultUsd: (usd) => dev.setVaultUsd(usd),
    setTier,
    advanceDay: () => dev.advanceClock(24 * 60 * 60 * 1000),
  };
}

/**
 * The vehicle line's tier after granting or revoking `t` (Decision 15: owning `t` owns every tier below it; removing
 * it removes the tiers above too), or null when refused: revoking while riding a tier that would go.
 */
export function vehicleTierAfter(current: number, t: RideTier, owned: boolean, riding: RideTier | null): number | null {
  const tier = tierOfVehicle(t);
  if (!owned && riding !== null && tierOfVehicle(riding) >= tier) return null;
  return owned ? Math.max(current, tier) : Math.min(current, tier - 1);
}

/** The ride a vehicle tier number stands for (1..n), or null. */
export function rideOfTier(n: number): RideTier | null {
  return RIDE_TIERS.find((t) => tierOfVehicle(t) === n) ?? null;
}

/** The Vehicles folder's Owned boxes: checked when owned, locked while the courier rides that tier. */
export function ownedBoxStates(owned: (t: RideTier) => boolean, riding: RideTier | null): { tier: RideTier; owned: boolean; locked: boolean }[] {
  return RIDE_TIERS.map((tier) => ({ tier, owned: owned(tier), locked: tier === riding }));
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
    ownedBoxStates(hooks.vehicles.owned, hooks.vehicles.riding()).forEach((b, i) => {
      owned[b.tier] = b.owned;
      boxes[i]!.updateDisplay().enable(!b.locked);
    });
  };
  const capInfo = { capacity: hooks.vehicles.capacityLabel() };
  const capCtrl = folder.add(capInfo, 'capacity').name('Capacity').disable();
  folder.add({ fill: () => hooks.vehicles.fillTanks() }, 'fill').name('Fill all tanks');
  folder.add({ coins: () => hooks.vehicles.addCoins(DEV_COINS) }, 'coins').name(`+${DEV_COINS} coins`);

  // Economy: the mock chain's dev controls (Decision 1).
  const eco = hooks.economy;
  const acts = economyActions(eco.dev, GAME_UNITS, eco.setTier);
  const ecoFolder = gui.addFolder('Economy');
  const ecoState = { rate: eco.rate() ?? 0, refused: '', confirm: eco.confirmSeconds(), vault: eco.vaultUsd() };
  ecoFolder.add({ add: acts.addGame }, 'add').name(`+${DEV_GAME.toLocaleString('en-US')} GAME`);
  const refusedCtrl = ecoFolder.add(ecoState, 'refused').name('Rate').disable();
  refusedCtrl.hide();
  ecoFolder.add(ecoState, 'rate').name('GAME price (USD)').onFinishChange((usd: number) => {
    const msg = acts.setRate(usd);
    ecoState.refused = msg ?? '';
    refusedCtrl.updateDisplay();
    refusedCtrl.show(msg !== null);
    if (msg !== null) {
      ecoState.rate = eco.rate() ?? 0;
      ecoFolder.controllers.forEach((c: Controller) => c.updateDisplay());
    }
  });
  ecoFolder.add({ stale: acts.makeStale }, 'stale').name('Make rate stale');
  ecoFolder.add({ fail: acts.failNext }, 'fail').name('Fail next transaction');
  ecoFolder.add(ecoState, 'confirm', 0, 30, 1).name('Confirm delay (s)').onChange(acts.setConfirmSeconds);
  ecoFolder.add(ecoState, 'vault').name('Vault (USD)').onFinishChange(acts.setVaultUsd);
  ecoFolder.add({ day: acts.advanceDay }, 'day').name('Advance clock 1 day');
  const tiers = Object.fromEntries(LINES.map((l) => [l, eco.tier(l)])) as Record<Line, number>;
  const tierCtrls = LINES.map((l) => ecoFolder.add(tiers, l, 0, eco.tierMax(l), 1).name(`Tier · ${l}`).onChange((n: number) => {
    if (!acts.setTier(l, n)) syncEconomy();
  }));
  const syncEconomy = (): void => {
    LINES.forEach((l, i) => {
      tiers[l] = eco.tier(l);
      tierCtrls[i]!.updateDisplay();
    });
    ecoState.rate = eco.rate() ?? 0;
    ecoState.confirm = eco.confirmSeconds();
    ecoState.vault = eco.vaultUsd();
    ecoFolder.controllers.forEach((c: Controller) => c.updateDisplay());
    syncVehicles();
  };
  eco.subscribe(() => {
    if (!gui._hidden) syncEconomy();
  });

  // Map: which map is loaded, a teleport button per hospital and gas station, and the F4 lot-id view.
  const mapFolder = gui.addFolder('Map');
  const mapInfo = { map: hooks.map.kind };
  mapFolder.add(mapInfo, 'map').name('current map').disable();
  for (const item of mapRowItems(hooks.map.targets, hooks.map.teleportTo)) {
    mapFolder.add({ go: item.run }, 'go').name(item.label);
  }
  const lotIds = hooks.map.lotIds;
  const lotState = { show: lotIds?.get() ?? false };
  const lotCtrl = lotIds ? mapFolder.add(lotState, 'show').name('Show lot ids').onChange((on: boolean) => lotIds.set(on)) : null;

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
        lotState.show = lotIds?.get() ?? false; // F4 may have changed it
        lotCtrl?.updateDisplay();
        capInfo.capacity = hooks.vehicles.capacityLabel();
        capCtrl.updateDisplay();
        syncEconomy(); // ownership or the ride may have changed since (debug API, a reset)
        gui.show();
      } else gui.hide();
    },
    get isOpen() {
      return !gui._hidden;
    },
  };
}
