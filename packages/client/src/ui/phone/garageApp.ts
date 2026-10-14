import { ridingConfig, type Garage, type RideTier, type SummonResult, type Vec3 } from '@dm/shared';
import { el, setText } from '../dom';
import type { HudModel } from '../hudModel';
import { syncList } from './ordersApp';
import type { PhoneAppView } from './Phone';

/** One owned vehicle in the Garage app. */
export interface GarageRow {
  tier: RideTier;
  status: 'riding' | 'carried' | 'parked';
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

/**
 * The Garage app's rows: every owned vehicle, in RIDE_TIERS order, as seen from `player` (the feet on the ground, as
 * summon uses) at sim time `now`. Distances are horizontal, as findRoadSpot measures.
 */
export function garageRows(garage: Garage, player: Vec3, now: number): GarageRow[] {
  return garage.owned().map((tier) => {
    const spot = garage.spot(tier);
    const p = garage.state(tier).position;
    return {
      tier,
      status: spot.kind,
      distance: spot.kind === 'parked' ? Math.round(Math.hypot(p.x - player.x, p.z - player.z)) : null,
      fuel: garage.cfg.rides[tier].fuel ? garage.state(tier).fuel : null,
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
  if (r.status === 'riding') return 'Riding';
  if (r.status === 'carried') return 'Carried';
  return `Parked · ${r.distance ?? 0} m`;
}

interface RowView {
  el: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
  fuel: HTMLElement;
  summon: HTMLButtonElement;
}

/**
 * The Garage app (spec §8): one row per owned vehicle with its name, where it is ("Riding", "Carried",
 * "Parked · 240 m"), a fuel bar for the motorbike and the car, and Summon (spec §4.4), disabled with the reason.
 * Re-rendered with the HUD model tick like the other apps.
 */
export function createGarageApp(onSummon: (t: RideTier) => void): PhoneAppView {
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
    const summon = el('button', 'phone-btn phone-summon', card);
    summon.type = 'button';
    summon.dataset.action = 'summon';
    summon.dataset.tier = r.tier;
    summon.addEventListener('click', () => onSummon(r.tier));
    return { el: card, name, status, fuel, summon };
  };
  const update = (v: RowView, r: GarageRow): void => {
    setText(v.name, RIDE_NAME[r.tier]);
    setText(v.status, statusText(r));
    v.fuel.hidden = r.fuel === null;
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
