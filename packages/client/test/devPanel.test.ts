import { describe, expect, it } from 'vitest';
import { expandGreybox, type GreyboxSource, type MapData } from '@dm/shared';
import greyboxJson from '../../../map/greybox.json';
import cityJson from '../../../map/city.layout.json';
import { mapRowItems } from '../src/ui/devPanel';
import { teleportTargets } from '../src/game/mapTargets';

const grey = expandGreybox(greyboxJson as GreyboxSource);
// The city layout's hospitals and gas stations are all the Map row reads.
const city = { kind: 'city', hospitals: cityJson.hospitals, gasStations: cityJson.gasStations } as unknown as MapData;

describe('dev panel Map row', () => {
  it('lists 4 hospitals and 6 gas stations on the city', () => {
    const items = mapRowItems(teleportTargets(city), () => undefined);
    expect(items.filter((i) => i.kind === 'hospital')).toHaveLength(4);
    expect(items.filter((i) => i.kind === 'gas')).toHaveLength(6);
  });

  it('lists 4 hospitals and 2 gas stations on the greybox', () => {
    const items = mapRowItems(teleportTargets(grey), () => undefined);
    expect(items.filter((i) => i.kind === 'hospital')).toHaveLength(4);
    expect(items.filter((i) => i.kind === 'gas')).toHaveLength(2);
  });

  it('clicking an entry calls teleportTo with its id', () => {
    const calls: string[] = [];
    const items = mapRowItems(teleportTargets(city), (id) => void calls.push(id));
    items[0]!.run();
    items[items.length - 1]!.run();
    expect(calls).toEqual(['hospital-bayview-general', 'gas-ridge-fuel']);
    expect(items[0]!.label).toMatch(/^Teleport to /);
  });
});
