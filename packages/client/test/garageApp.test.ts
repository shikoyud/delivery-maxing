import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Garage,
  PlayerSim,
  createPhysicsWorld,
  initRapier,
  movementConfig,
  ridingConfig,
  vec3,
  type MapData,
  type RideTier,
  type SavedVehicle,
} from '@dm/shared';
import { createGarageApp, garageRows } from '../src/ui/phone/garageApp';
import { Phone } from '../src/ui/phone/Phone';
import { installFakeDom, type FakeElement } from './fakeDom';
import { model } from './phoneFixtures';

const hospital = (id: string, x: number) => ({
  id,
  name: id,
  center: vec3(x, 0, 0),
  safeRadius: 18,
  spawn: vec3(x, 0, 8),
  spawnYaw: 0,
  bay: vec3(x, 0, 16),
  bayYaw: -Math.PI / 2,
});

const testMap = (): MapData => ({
  kind: 'greybox',
  chunkSize: 100,
  size: 600,
  solids: [{ id: 'ground', kind: 'ground', center: vec3(0, -0.5, 0), size: vec3(600, 1, 600) }],
  pois: [],
  hospitals: [hospital('west', -200), hospital('east', 200)],
  accessZones: [],
  gasStations: [],
  orderRules: { bands: { shortMax: 150, mediumMax: 350 }, foodDropoff: { min: 80, max: 400 }, packageDropoff: { min: 100, max: 650 }, maxPickupDistance: 250 },
});

const parked = (tier: RideTier, x: number, z: number, fuel = 1): SavedVehicle => ({ tier, spot: { kind: 'parked', position: vec3(x, 0, z), heading: 0 }, fuel });

/** A parked vehicle's position (the Map app and minimap markers): where it stands, at its body's height. */
const at = (x: number, z: number) => expect.objectContaining({ x, z });

async function makeGarage(saved: SavedVehicle[]) {
  const map = testMap();
  const physics = createPhysicsWorld(await initRapier(), map);
  return { map, physics, garage: new Garage(physics, map, saved) };
}

describe('Garage app', () => {
  let dom: ReturnType<typeof installFakeDom>;
  const rowOf = (tier: string): FakeElement => dom.host.findAll((e) => e.classList.contains('phone-garage-row') && e.dataset.tier === tier)[0]!;
  const summonBtn = (tier: string): FakeElement => rowOf(tier).findAll((e) => e.tagName === 'BUTTON' && e.dataset.action === 'summon')[0]!;

  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => dom.restore());

  it('rows show status, distance and fuel; Summon is disabled with "Nearby" within 100 m', async () => {
    const { garage } = await makeGarage([
      { tier: 'skateboard', spot: { kind: 'carried' }, fuel: 1 },
      parked('bicycle', 0, 60),
      parked('motorbike', 0, -240, 0.4),
      parked('car', 150, 0, 0.75),
    ]);
    const player = vec3(0, 0, 0);
    const rows = garageRows(garage, player, 0);
    expect(rows).toEqual([
      { tier: 'skateboard', status: 'carried', position: null, distance: null, fuel: null, summon: 'carried', readyIn: 0 },
      { tier: 'bicycle', status: 'parked', position: at(0, 60), distance: 60, fuel: null, summon: 'tooClose', readyIn: 0 },
      { tier: 'motorbike', status: 'parked', position: at(0, -240), distance: 240, fuel: 0.4, summon: 'ok', readyIn: 0 },
      { tier: 'car', status: 'parked', position: at(150, 0), distance: 150, fuel: 0.75, summon: 'ok', readyIn: 0 },
    ]);

    const app = createGarageApp(() => undefined);
    dom.host.appendChild(app.el as unknown as FakeElement);
    app.render(model({ garage: rows }), player, 0);
    expect(rowOf('skateboard').textContent).toContain('Skateboard');
    expect(rowOf('skateboard').textContent).toContain('Carried');
    expect(rowOf('motorbike').textContent).toContain('Motorbike');
    expect(rowOf('motorbike').textContent).toContain('Parked · 240 m');
    // A fuel bar for the motorbike and the car only.
    expect(rowOf('motorbike').byClass('phone-fuel')[0]!.dataset.fuel).toBe('40');
    expect(rowOf('car').byClass('phone-fuel')[0]!.dataset.fuel).toBe('75');
    expect(rowOf('bicycle').byClass('phone-fuel').filter((e) => !e.hidden)).toHaveLength(0);
    expect(rowOf('skateboard').byClass('phone-fuel').filter((e) => !e.hidden)).toHaveLength(0);
    // Summon: disabled with the reason.
    expect(summonBtn('bicycle').disabled).toBe(true);
    expect(summonBtn('bicycle').textContent).toBe('Nearby');
    expect(summonBtn('motorbike').disabled).toBe(false);
    expect(summonBtn('motorbike').textContent).toBe('Summon');

    // Riding the car, with the summon cooling down after the motorbike's summon at t = 0.
    garage.summon('motorbike', player, 0, () => ({ position: vec3(4, 0, 0), heading: 0 }));
    garage.ride('car');
    const later = garageRows(garage, player, 17.5);
    expect(later.find((r) => r.tier === 'car')).toMatchObject({ status: 'riding', distance: null, summon: 'riding' });
    expect(later.find((r) => r.tier === 'motorbike')).toMatchObject({ summon: 'tooClose' });
    app.render(model({ garage: later }), player, 0);
    expect(rowOf('car').textContent).toContain('Riding');
    expect(summonBtn('car').textContent).toBe('Riding');
    expect(summonBtn('car').disabled).toBe(true);
    const far = garageRows(garage, vec3(0, 0, 200), 17.5);
    app.render(model({ garage: far }), player, 0);
    expect(summonBtn('motorbike').textContent).toBe(`Ready in ${ridingConfig.summon.cooldownSeconds - 17} s`);
    expect(summonBtn('motorbike').disabled).toBe(true);
  });

  it('the row distance is horizontal (final review 5): a courier 30 m above sees the flat distance', async () => {
    const { garage } = await makeGarage([parked('motorbike', 0, -240)]);
    expect(garageRows(garage, vec3(0, 30, 0), 0)[0]!.distance).toBe(240);
  });

  it('clicking Summon calls onSummon with the tier', async () => {
    const { garage } = await makeGarage([parked('motorbike', 0, -240), parked('car', 150, 0)]);
    const calls: RideTier[] = [];
    const app = createGarageApp((t) => void calls.push(t));
    dom.host.appendChild(app.el as unknown as FakeElement);
    app.render(model({ garage: garageRows(garage, vec3(0, 0, 0), 0) }), vec3(0, 0, 0), 0);
    summonBtn('car').click();
    summonBtn('motorbike').click();
    expect(calls).toEqual(['car', 'motorbike']);
  });

  it('Settings: Respawn puts the courier on foot at the nearest hospital and keeps the parked car where it was', async () => {
    const { map, physics, garage } = await makeGarage([parked('car', 120, 40)]);
    const sim = new PlayerSim(physics, map, movementConfig, vec3(150, 0, -30), 0, garage);
    const events: string[] = [];
    const phone = new Phone(
      dom.asHost,
      {
        accept: () => undefined,
        cancel: () => undefined,
        skipLockout: () => undefined,
        closed: () => undefined,
        summon: () => undefined,
        respawn: () => void events.push(...sim.respawnAtHospital().map((e) => e.kind)),
        shopBuy: () => undefined,
        shopConfirm: () => undefined,
        shopCancel: () => undefined,
      },
      ['Escape'],
    );
    phone.open('settings');
    phone.render(model());
    const settings = dom.host.findAll((e) => e.classList.contains('phone-app') && e.dataset.app === 'settings')[0]!;
    expect(settings.textContent).toContain('Respawn at nearest hospital');
    settings.findAll((e) => e.tagName === 'BUTTON' && e.dataset.action === 'respawn')[0]!.click();
    expect(events).toEqual(['respawned']);
    const east = map.hospitals[1]!;
    expect(sim.state.riding).toBeNull();
    expect(sim.state.position.x).toBeCloseTo(east.spawn.x, 5);
    expect(sim.state.position.z).toBeCloseTo(east.spawn.z, 5);
    expect(garage.spot('car')).toEqual({ kind: 'parked', position: vec3(120, 0, 40), heading: 0 });
  });
});
