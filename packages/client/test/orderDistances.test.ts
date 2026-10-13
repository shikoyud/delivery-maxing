import { describe, expect, it } from 'vitest';
import {
  bandFor,
  expandGreybox,
  ordersConfig,
  parseCityMap,
  parsePieceCatalog,
  parsePoiTable,
  streetDistance,
  type GreyboxSource,
} from '@dm/shared';
import greybox from '../../../map/greybox.json';
import cityJson from '../../../map/city.json';
import poiJson from '../../../map/city.poi.json';
import piecesJson from '../../../map/pieces.json';
import { orderDistances } from '../src/game/delivery';

describe('orderDistances (the board candidates and route distances per map)', () => {
  it('greybox: street distance and the greybox bands (150 / 350 m), every POI', () => {
    const map = expandGreybox(greybox as GreyboxSource);
    const { pois, distances } = orderDistances(map, null);
    expect(pois.map((p) => p.poi.id)).toEqual(map.pois.map((p) => p.id));
    for (const p of pois) {
      const d = streetDistance(map.hub.center, p.poi.position);
      expect(distances.fromHub(p.poi.id)).toBe(d);
      expect(p.band).toBe(bandFor(d, ordersConfig.bands.greybox));
    }
  });

  it('city: the navmesh table and the city bands (500 / 1,200 m), reachable POIs only', () => {
    const city = parseCityMap(cityJson, parsePieceCatalog(piecesJson));
    const table = parsePoiTable(poiJson);
    const { pois, distances } = orderDistances(city, table);
    const reachable = table.pois.filter((r) => r.reachable);
    expect(pois.map((p) => p.poi.id).sort()).toEqual(reachable.map((r) => r.id).sort());
    for (const p of pois) {
      const row = reachable.find((r) => r.id === p.poi.id)!;
      expect(p.hubDistance).toBe(row.fromHub);
      expect(distances.toHub(p.poi.id)).toBe(row.toHub);
      expect(p.band).toBe(bandFor(row.fromHub, ordersConfig.bands.city));
      expect(p.elevated).toBe(row.elevated);
    }
    expect(new Set(pois.map((p) => p.band))).toEqual(new Set(['short', 'medium', 'long']));
  });

  it('city: a POI the table marks unreachable is never a candidate', () => {
    const city = parseCityMap(cityJson, parsePieceCatalog(piecesJson));
    const table = parsePoiTable(structuredClone(poiJson));
    const row = table.pois[0]!;
    row.reachable = false;
    expect(orderDistances(city, table).pois.map((p) => p.poi.id)).not.toContain(row.id);
  });
});
