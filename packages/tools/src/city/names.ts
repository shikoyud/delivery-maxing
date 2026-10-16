import type { CatalogEntry, Lot, NamesConfig, Rng, Road } from '@dm/shared';

// Fictional business, household and street names (city design section 6.2, config/names.json). Every name a Namer
// gives is unique for its run.

const INITIALS = 'ABCDEFGHIJKLMNOPRSTVW';
const TRIES = 40;

export class Namer {
  private readonly used = new Set<string>();

  constructor(
    private readonly cfg: NamesConfig,
    private readonly rng: Rng,
  ) {}

  /** The first word of the entry's catalog `kind` that names.json has suffixes for ("Bakery, 3 floors" -> "bakery"). */
  kindKey(entry: CatalogEntry): string | null {
    for (const w of (entry.kind ?? '').toLowerCase().split(/[^a-z]+/)) if (w && Object.hasOwn(this.cfg.kinds, w)) return w;
    return null;
  }

  /** Homes get a household name; hotels, motels and every other building a business name. */
  isHousehold(entry: CatalogEntry): boolean {
    return entry.category === 'residential' && this.kindKey(entry) === null;
  }

  lotName(entry: CatalogEntry): string {
    return this.isHousehold(entry) ? this.household() : this.business(entry);
  }

  /** "<first word or surname> <suffix>", e.g. "Crumb & Co. Bakery"; "<surname> & <surname> <suffix>" once those run out. */
  business(entry: CatalogEntry): string {
    const key = this.kindKey(entry);
    const suffixes = (key && this.cfg.kinds[key]) || this.cfg.kinds[entry.category] || this.cfg.kinds.shop;
    if (!suffixes || suffixes.length === 0) throw new Error(`names: no business suffixes for ${entry.id}`);
    const { first, surnames } = this.cfg;
    return this.unique(
      () => `${this.rng() < 0.6 ? this.pick(first) : this.pick(surnames)} ${this.pick(suffixes)}`,
      () => `${this.pick(surnames)} & ${this.pick(surnames)} ${this.pick(suffixes)}`,
      function* () {
        for (const a of surnames) for (const b of surnames) for (const s of suffixes) if (a !== b) yield `${a} & ${b} ${s}`;
      },
    );
  }

  /** "<initial>. <surname>", e.g. "J. Hartley"; double-barrelled once those run out. */
  household(): string {
    const { surnames } = this.cfg;
    return this.unique(
      () => `${this.pick([...INITIALS])}. ${this.pick(surnames)}`,
      () => `${this.pick([...INITIALS])}. ${this.pick(surnames)}-${this.pick(surnames)}`,
      function* () {
        for (const i of INITIALS) for (const a of surnames) for (const b of surnames) if (a !== b) yield `${i}. ${a}-${b}`;
      },
    );
  }

  /**
   * "<number> <street>[, apt <n>]". Numbers count along the street from its west (or south) end in steps of 2 per
   * `address.step` metres: odd on the south (west) side, even on the north (east) side. Every named street starts at
   * the city's west or south edge, so the distance is the lot centre's x (or z); a street split into segments keeps
   * one numbering. A home with more than `aptOverFloors` floors adds an apartment number.
   */
  address(lot: Pick<Lot, 'rect'>, road: Road, entry?: CatalogEntry): string {
    if (!road.name) throw new Error(`names: road ${road.id} has no name for an address`);
    const a = this.cfg.address;
    const r = road.rect;
    const eastWest = r.maxX - r.minX >= r.maxZ - r.minZ;
    const cx = (lot.rect.minX + lot.rect.maxX) / 2;
    const cz = (lot.rect.minZ + lot.rect.maxZ) / 2;
    const along = eastWest ? cx : cz;
    const firstSide = eastWest ? cz < (r.minZ + r.maxZ) / 2 : cx < (r.minX + r.maxX) / 2;
    const n = 2 * Math.floor(along / a.step) + (firstSide ? 1 : 2);
    let out = `${n} ${this.abbreviate(road.name)}`;
    if (entry && this.isHousehold(entry)) {
      const floors = floorsOf(entry, a.floorHeight);
      if (floors > a.aptOverFloors) out += `, apt ${1 + Math.floor(this.rng() * floors * a.aptsPerFloor)}`;
    }
    return out;
  }

  private abbreviate(street: string): string {
    const words = street.split(' ');
    const last = words[words.length - 1]!;
    const short = this.cfg.address.abbreviations[last];
    if (short !== undefined) words[words.length - 1] = short;
    return words.join(' ');
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng() * list.length)]!;
  }

  private unique(simple: () => string, longer: () => string, all: () => Iterable<string>): string {
    for (const make of [simple, longer]) {
      for (let i = 0; i < TRIES; i++) {
        const s = make();
        if (!this.used.has(s)) return this.take(s);
      }
    }
    for (const s of all()) if (!this.used.has(s)) return this.take(s);
    throw new Error('names: ran out of unique names (add words to config/names.json)');
  }

  private take(s: string): string {
    this.used.add(s);
    return s;
  }
}

/** Floors from the catalog kind ("4-5 floors" -> 5), else height / floorHeight. */
export function floorsOf(entry: CatalogEntry, floorHeight: number): number {
  const m = /(\d+)(?:\s*-\s*(\d+))?\s+floors?/.exec(entry.kind ?? '');
  if (m) return Number(m[2] ?? m[1]);
  return Math.floor(entry.size.h / floorHeight);
}
