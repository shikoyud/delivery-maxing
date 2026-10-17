import { lotSize, type CatalogEntry, type CatalogIndex, type CityDistrict, type Rng } from '@dm/shared';

/** A district palette: groups of catalog ids (regexes over the placed, non-duplicate entries) with a weight each. */
export type Palette = [RegExp[], number][];

const rx = (...ids: string[]): RegExp[] => ids.map((s) => new RegExp(`^(?:${s})$`));

/**
 * The prototype's PAL (city-map-prototype/layout.py), district by district. The prototype's `bayview` palette is not
 * used by any district there and is left out; `docks` has none (the waterfront places its lots by hand, Task 8) and
 * `hillcrest` is the prototype's detached-house choice.
 */
export const PALETTES: Record<CityDistrict, Palette> = {
  downtown: [
    [rx('mega/House_(49|5[0-2])'), 3],
    [rx('mega/House_4[0-8]'), 5],
    [rx('mega/House_(2[3-5]|3[7-9])'), 4],
    [rx('mega/Bank_0[12]', 'mega/Office_01'), 2],
    [rx('mega/Cinema_01'), 0.5],
    [rx('(mega|trop)/Hotel_0[12]'), 1],
    [rx('mega/Coffe_02', 'mega/Cafe_01', 'mega/Sushi_01'), 1.5],
  ],
  market: [
    [rx('mega/(House_0[1-8]|OldHouse_0[5-8])'), 5],
    [rx('mega/(SmallHouse_(0[1-9]|1[0-5])|OldHouse_1[0-2])'), 4],
    [rx('mega/(Bakery_01|Burgers_01|Cafe_01|Coffe_02|Donuts_01|Pizza_01|Sushi_01)', 'trop/Wok_01'), 3.5],
    [rx('mega/Supermarket_0[12]', 'mega/AutoService_01'), 1],
    [rx('(mega|trop)/Hotel_0[12]'), 0.6],
    [rx('mega/SmallMarket_01'), 0.6],
  ],
  highstreet: [
    [rx('mega/(House_0[1-8]|House_1[3-5]|House_3[34]|OldHouse_0[1-2])'), 5],
    [rx('mega/(SmallHouse_(0[1-9]|1[0-5])|OldHouse_1[0-2])'), 3],
    [rx('mega/(Bakery_01|Burgers_01|Cafe_01|Coffe_02|Donuts_01|Pizza_01)', 'trop/(Wok_01|Pizza_01)'), 3],
    [rx('mega/Supermarket_0[12]', 'mega/Office_01', 'mega/House_2[3-5]'), 1],
    [rx('mega/Cinema_01'), 0.3],
  ],
  industrial: [
    [rx('mega/Factory_0[35]'), 2],
    [rx('mega/(House_2[6-8]|OldHouse_09)'), 3],
    [rx('mega/Supermarket_0[34]'), 1],
    [rx('mega/AutoService_01', 'mega/Office_01'), 1.5],
    [rx('mega/Construction_0[12]'), 0.6],
    [rx('mega/(Burgers_01|SmallMarket_01)'), 0.6],
  ],
  rowhouses: [
    [rx('mega/(House_(09|1[0-8])|House_0[1-8]|OldHouse_0[5-8])'), 7],
    [rx('mega/(House_2[6-8]|OldHouse_09)'), 1],
    [rx('mega/(SmallHouse_1[1-5]|Coffe_02|Pizza_01)'), 1],
  ],
  apartments: [
    [rx('mega/(House_3[1-4]|OldHouse_0[1-4])'), 6],
    [rx('mega/(House_(19|2[01])|House_0[1-8])'), 2],
    [rx('mega/Supermarket_0[1-4]', 'mega/Construction_0[12]'), 0.8],
    [rx('mega/(Donuts_01|Burgers_01|SmallHouse_1[1-5])'), 1],
  ],
  uptown: [
    [rx('mega/House_1[3-8]', 'mega/House_(09|1[0-2])'), 6],
    [rx('mega/House_(19|2[01])'), 2],
    [rx('mega/(SmallHouse_1[1-5]|Bakery_01|Cafe_01|Coffe_02)', 'mega/Supermarket_0[12]'), 1.5],
  ],
  harbor: [
    [rx('trop/House_0[5-8]', 'trop/Hotel_(0[3-5]|09|1[01])'), 4],
    [rx('mega/Sushi_01', 'trop/Wok_01', 'trop/Pizza_01', 'trop/Burgers_01'), 2],
    [rx('mega/(SmallHouse_1[1-5])'), 1],
  ],
  beach: [
    [rx('trop/Hotel_(0[3-9]|1[01])'), 4],
    [rx('trop/House_0[5-6]'), 2],
    [rx('trop/(Burgers_01|Pizza_01)', 'mega/Donuts_01'), 2],
  ],
  hillcrest: [[rx('mega/(SuburbHouse_0[1-9]|OldHouse_1[4-6])'), 1]],
  slope: [[rx('mega/House_0[5-6]', 'mega/OldHouse_07'), 1]],
  docks: [],
};

const resolved = new WeakMap<CatalogIndex, Map<RegExp, CatalogEntry[]>>();

/** The placed, non-duplicate catalog entries a regex matches, in catalog order (cached per catalog). */
export function paletteEntries(re: RegExp, cat: CatalogIndex): CatalogEntry[] {
  let byRe = resolved.get(cat);
  if (!byRe) resolved.set(cat, (byRe = new Map()));
  let out = byRe.get(re);
  if (!out) {
    out = cat.catalog.entries.filter((e) => e.use === 'placed' && !e.duplicateOf && re.test(e.id));
    byRe.set(re, out);
  }
  return out;
}

/**
 * A weighted pick from the palette among the entries whose lot (`lotSize`) fits `maxW` x `maxD`; null when none fits.
 * As the prototype's `pick`: a group by weight, then an entry of the group uniformly.
 */
export function pickLot(pal: Palette, rng: Rng, maxW: number, maxD: number, cat: CatalogIndex): CatalogEntry | null {
  const choices: [CatalogEntry[], number][] = [];
  for (const [res, weight] of pal) {
    const fit = res.flatMap((re) => paletteEntries(re, cat)).filter((e) => {
      const s = lotSize(e);
      return s.w <= maxW + 1e-9 && s.d <= maxD + 1e-9;
    });
    if (fit.length > 0) choices.push([fit, weight]);
  }
  if (choices.length === 0) return null;
  const total = choices.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [fit, w] of choices) {
    r -= w;
    if (r <= 0) return fit[Math.floor(rng() * fit.length)]!;
  }
  const last = choices[choices.length - 1]![0];
  return last[Math.floor(rng() * last.length)]!;
}
