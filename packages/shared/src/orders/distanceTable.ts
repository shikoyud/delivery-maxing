// The build-time table of on-foot path distances from every pickup door to every dropoff door of the city
// (Decision 14), written by `pnpm map:build` to map/city.distances.bin.gz. Layout (all little-endian):
//   bytes 0..3   magic "DMDT"
//   bytes 4..7   u32 version (1)
//   bytes 8..11  u32 pickup count P
//   bytes 12..15 u32 dropoff count D
//   bytes 16..19 u32 byte length L of the ids
//   L bytes      the P pickup ids then the D dropoff ids, UTF-8, each followed by "\n"
//   0..3 bytes   zero padding to a multiple of 4
//   P × D        Float32, row-major (row = pickup), Infinity where the dropoff is not reachable on foot

const MAGIC = 0x54444d44; // "DMDT" read as a little-endian u32
const VERSION = 1;
const HEADER = 20;

/** On-foot path distances from pickup doors to dropoff doors, by POI id. */
export class DistanceTable {
  private readonly pickupIndex: Map<string, number>;
  private readonly dropoffIndex: Map<string, number>;

  /** `values` holds `pickups.length × dropoffs.length` distances, row-major (one row per pickup). */
  constructor(
    readonly pickups: string[],
    readonly dropoffs: string[],
    readonly values: Float32Array,
  ) {
    if (values.length !== pickups.length * dropoffs.length) {
      throw new Error(`distance table: ${pickups.length} × ${dropoffs.length} needs ${pickups.length * dropoffs.length} values, got ${values.length}`);
    }
    this.pickupIndex = new Map(pickups.map((id, i) => [id, i]));
    this.dropoffIndex = new Map(dropoffs.map((id, i) => [id, i]));
  }

  /** The distance from pickup to dropoff (Infinity: not reachable on foot), or undefined when either id is not in the table. */
  get(pickupId: string, dropoffId: string): number | undefined {
    const p = this.pickupIndex.get(pickupId);
    const d = this.dropoffIndex.get(dropoffId);
    return p === undefined || d === undefined ? undefined : this.values[p * this.dropoffs.length + d];
  }

  /** The table in the format above. */
  toBytes(): Uint8Array {
    const ids = new TextEncoder().encode([...this.pickups, ...this.dropoffs].map((id) => `${id}\n`).join(''));
    const start = HEADER + Math.ceil(ids.length / 4) * 4;
    const out = new Uint8Array(start + this.values.length * 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, VERSION, true);
    view.setUint32(8, this.pickups.length, true);
    view.setUint32(12, this.dropoffs.length, true);
    view.setUint32(16, ids.length, true);
    out.set(ids, HEADER);
    this.values.forEach((v, i) => view.setFloat32(start + i * 4, v, true));
    return out;
  }

  /** Reads a table written by `toBytes` (the inflated contents of map/city.distances.bin.gz). Throws on anything else. */
  static parse(bytes: Uint8Array): DistanceTable {
    const bad = (why: string): never => {
      throw new Error(`distance table: ${why}`);
    };
    if (bytes.length < HEADER) bad(`${bytes.length} bytes is shorter than the header`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== MAGIC) bad('bad magic (not a distance table)');
    if (view.getUint32(4, true) !== VERSION) bad(`unknown version ${view.getUint32(4, true)}`);
    const p = view.getUint32(8, true);
    const d = view.getUint32(12, true);
    const len = view.getUint32(16, true);
    const start = HEADER + Math.ceil(len / 4) * 4;
    if (bytes.length !== start + p * d * 4) bad(`expected ${start + p * d * 4} bytes for ${p} × ${d}, got ${bytes.length}`);
    const ids = new TextDecoder().decode(bytes.subarray(HEADER, HEADER + len)).split('\n');
    if (ids.length !== p + d + 1 || ids[p + d] !== '') bad(`expected ${p + d} ids`);
    const values = new Float32Array(p * d);
    for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(start + i * 4, true);
    return new DistanceTable(ids.slice(0, p), ids.slice(p, p + d), values);
  }
}
