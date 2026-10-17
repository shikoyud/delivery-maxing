import { RIDE_TIERS, economyConfig, payoutRange, ridingConfig, type EconomyConfig, type Garage, type RideTier, type SummonResult, type Vec3, type VehicleTier } from '@dm/shared';
import { el, setText, syncList } from '../dom';
import type { HudModel } from '../hudModel';
import type { PhoneAppView } from './Phone';

/** One vehicle in the Garage app: the four tiers, owned or not. */
export interface GarageRow {
  tier: RideTier;
  /** Owned (the chain's vehicle line reaches it); an unowned row shows its range and a Buy button. */
  owned: boolean;
  /** The tier offers, capacity and the payout range follow (the ride, else the last ride). */
  active: boolean;
  /** "Fuel 64%" for an owned ride with a tank; null otherwise. */
  fuelText: string | null;
  /** The payout range, "$0.03–0.30 per order". */
  range: string;
  status: 'riding' | 'carried' | 'parked' | 'unowned';
  /** Where a parked vehicle stands (a copy); null otherwise. */
  position: Vec3 | null;
  /** Metres from the player to a parked vehicle (rounded); null otherwise. */
  distance: number | null;
  /** Tank fraction 0..1 for the motorbike and the car; null for rides without fuel. */
  fuel: number | null;
  /** What Summon would do now, short of finding a spot ('ok' when it may try). */
  summon: SummonResult;
  /** Seconds until the summon cooldown ends (0 when ready). */
  readyIn: number;
}

export const RIDE_NAME: Record<RideTier, string> = {
  skateboard: 'Skateboard',
  bicycle: 'Bicycle',
  motorbike: 'Motorbike',
  car: 'Car',
};

/** Dollars from micro-USD for a range: two decimals, three when two would round it ("$0.005"). */
const dollars = (micro: number): string => {
  const d = micro / 1e6;
  return d.toFixed(Math.abs(Number(d.toFixed(2)) - d) < 1e-9 ? 2 : 3);
};

/** "$0.03–0.30 per order" (spec §3.6; the Garage rows and the Shop's Vehicle tiers). */
export function rangeText(tier: VehicleTier, econ: EconomyConfig = economyConfig): string {
  const { minMicro, maxMicro } = payoutRange(tier, econ);
  return `$${dollars(minMicro)}–${dollars(maxMicro)} per order`;
}

/**
 * The Garage app's rows: all four vehicles in RIDE_TIERS order, as seen from `player` (the feet on the ground, as
 * summon uses) at sim time `now`; `active` is the tier offers follow (the ride, else the last ride). Distances are
 * horizontal, as findRoadSpot measures.
 */
export function garageRows(garage: Garage, player: Vec3, now: number, active: RideTier | null = null): GarageRow[] {
  const owned = garage.owned();
  return RIDE_TIERS.map((tier): GarageRow => {
    const range = rangeText(tier);
    if (!owned.includes(tier)) {
      return { tier, owned: false, active: false, fuelText: null, range, status: 'unowned', position: null, distance: null, fuel: null, summon: 'noSpot', readyIn: 0 };
    }
    const spot = garage.spot(tier);
    const p = garage.state(tier).position;
    const fuel = garage.cfg.rides[tier].fuel ? garage.state(tier).fuel : null;
    return {
      tier,
      owned: true,
      active: tier === active,
      fuelText: fuel === null ? null : `Fuel ${Math.round(Math.max(0, Math.min(1, fuel)) * 100)}%`,
      range,
      status: spot.kind,
      position: spot.kind === 'parked' ? { x: p.x, y: p.y, z: p.z } : null,
      distance: spot.kind === 'parked' ? Math.round(Math.hypot(p.x - player.x, p.z - player.z)) : null,
      fuel,
      summon: garage.summonStatus(tier, player, now),
      readyIn: Math.max(0, garage.summonReadyAt - now),
    };
  });
}

/** The disabled Summon button's copy for a refusal. */
function summonLabel(r: GarageRow): string {
  switch (r.summon) {
    case 'ok':
      return 'Summon';
    case 'tooClose':
      return 'Nearby';
    case 'cooldown':
      return `Ready in ${Math.ceil(r.readyIn)} s`;
    case 'riding':
      return 'Riding';
    case 'carried':
      return 'Carried';
    case 'noSpot':
      return 'No road nearby';
  }
}

function statusText(r: GarageRow): string {
  if (r.status === 'unowned') return 'Not owned';
  if (r.status === 'riding') return 'Riding';
  if (r.status === 'carried') return 'Carried';
  return `Parked · ${r.distance ?? 0} m`;
}

interface RowView {
  el: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
  fuel: HTMLElement;
  range: HTMLElement;
  summon: HTMLButtonElement;
  switch: HTMLButtonElement;
  buy: HTMLButtonElement;
}

export interface GarageCallbacks {
  /** Switch: make offers, capacity and the payout range follow `t` (on foot). */
  switchTo(t: RideTier): void;
  /** Buy in the Shop: opens the Shop's Token tab. */
  buy(): void;
}

/**
 * The Garage app (spec §8): one row per vehicle with its name, where it is ("Riding", "Carried",
 * "Parked · 240 m"), a fuel bar for the motorbike and the car, and Summon (spec §4.4), disabled with the reason.
 * Re-rendered with the HUD model tick like the other apps.
 */
export function createGarageApp(onSummon: (t: RideTier) => void, cb: Partial<GarageCallbacks> = {}): PhoneAppView {
  const root = el('section', 'phone-garage');
  const list = el('div', 'phone-list', root);
  el('p', 'phone-garage-note', root).textContent = `Summon brings a vehicle parked more than ${ridingConfig.summon.minDistance} m away to the road next to you`;
  const rows = new Map<string, RowView>();
  const create = (r: GarageRow): RowView => {
    const card = el('div', 'phone-card phone-garage-row');
    card.dataset.tier = r.tier;
    const top = el('div', 'phone-card-top', card);
    const name = el('span', 'phone-garage-name', top);
    const status = el('span', 'phone-garage-status', top);
    const fuel = el('div', 'phone-fuel', card);
    el('div', 'phone-fuel-bar', fuel);
    const range = el('div', 'phone-garage-range', card);
    const button = (action: string, cls: string, on: () => void): HTMLButtonElement => {
      const b = el('button', `phone-btn ${cls}`, card);
      b.type = 'button';
      b.dataset.action = action;
      b.dataset.tier = r.tier;
      b.addEventListener('click', on);
      return b;
    };
    const summon = button('summon', 'phone-summon', () => onSummon(r.tier));
    const sw = button('switch', 'phone-switch', () => cb.switchTo?.(r.tier));
    const buy = button('buy', 'phone-buy', () => cb.buy?.());
    buy.textContent = 'Buy in the Shop';
    return { el: card, name, status, fuel, range, summon, switch: sw, buy };
  };
  const update = (v: RowView, r: GarageRow): void => {
    setText(v.name, RIDE_NAME[r.tier]);
    setText(v.status, statusText(r));
    setText(v.range, r.fuelText === null ? r.range : `${r.range} · ${r.fuelText}`);
    v.fuel.hidden = r.fuel === null;
    v.summon.hidden = !r.owned;
    v.switch.hidden = !r.owned;
    v.buy.hidden = r.owned;
    v.switch.disabled = r.active;
    setText(v.switch, r.active ? 'For offers' : 'Switch');
    if (r.fuel !== null) {
      const pct = Math.round(Math.max(0, Math.min(1, r.fuel)) * 100);
      if (v.fuel.dataset.fuel !== String(pct)) {
        v.fuel.dataset.fuel = String(pct);
        v.fuel.title = `Fuel ${pct}%`;
        v.fuel.style.setProperty('--fuel', `${pct}%`);
      }
    }
    v.summon.disabled = r.summon !== 'ok';
    setText(v.summon, summonLabel(r));
  };
  return {
    el: root,
    render: (m: HudModel) => syncList(list, rows, m.garage, (r) => r.tier, create, update),
  };
}
