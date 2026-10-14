import { mulberry32 } from '../util/rng';
import { vec3 } from '../math/vec3';
import type { AccessZone, GreyboxSource, Hospital, MapData, Rect, Solid } from './mapTypes';

const intersects = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

const inRect = (x: number, z: number, r: Rect): boolean =>
  x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/** The id of the solid block standing on a hospital's centre. */
export const hospitalBlockId = (h: Hospital): string => `hospital-block-${h.id}`;

/** Expands a greybox source (hand-placed solids + grid parameters) into the final MapData. */
export function expandGreybox(src: GreyboxSource): MapData {
  const { seed, grid, districts, reserved, hospitalBlock, ...map } = src;
  const rng = mulberry32(seed);
  const { pitch, roadWidth, alleyWidth } = grid;
  const half = src.size / 2;
  const lot = (pitch - roadWidth - alleyWidth) / 2;
  const lotOffset = (lot + alleyWidth) / 2;
  const kMin = Math.ceil(-half / pitch);
  const kMax = Math.floor(half / pitch) - 1;

  const solids: Solid[] = [
    { id: 'ground', kind: 'ground', center: vec3(0, -0.5, 0), size: vec3(src.size, 1, src.size) },
  ];

  const alleyZones: AccessZone[] = [];
  const halfAlley = alleyWidth / 2;
  const outer = lotOffset + lot / 2;

  for (let bx = kMin; bx <= kMax; bx++) {
    for (let bz = kMin; bz <= kMax; bz++) {
      const cx = pitch / 2 + bx * pitch;
      const cz = pitch / 2 + bz * pitch;
      const built = [false, false, false, false];
      for (let lotIdx = 0; lotIdx < 4; lotIdx++) {
        const x = cx + (lotIdx % 2 === 0 ? -lotOffset : lotOffset);
        const z = cz + (lotIdx < 2 ? -lotOffset : lotOffset);
        const footprint: Rect = { minX: x - lot / 2, minZ: z - lot / 2, maxX: x + lot / 2, maxZ: z + lot / 2 };
        const d = districts.find((dd) => inRect(x, z, dd.rect));
        if (!d) continue;
        if (reserved.some((r) => intersects(footprint, r))) continue;
        if (!(rng() < d.fillChance)) continue;
        const raw = d.heightMin + rng() * (d.heightMax - d.heightMin);
        const height = Math.round(raw * 2) / 2;
        built[lotIdx] = true;
        solids.push({
          id: `b-${bx}-${bz}-${lotIdx}`,
          kind: 'building',
          center: vec3(x, height / 2, z),
          size: vec3(lot, height, lot),
        });
      }
      // Half-alleys: a = lots 0|1 (north half), b = 2|3 (south half), c = 0|2 (west half), d = 1|3 (east half).
      const halves: [string, number, number, Rect][] = [
        ['a', 0, 1, { minX: cx - halfAlley, maxX: cx + halfAlley, minZ: cz - outer, maxZ: cz }],
        ['b', 2, 3, { minX: cx - halfAlley, maxX: cx + halfAlley, minZ: cz, maxZ: cz + outer }],
        ['c', 0, 2, { minX: cx - outer, maxX: cx, minZ: cz - halfAlley, maxZ: cz + halfAlley }],
        ['d', 1, 3, { minX: cx, maxX: cx + outer, minZ: cz - halfAlley, maxZ: cz + halfAlley }],
      ];
      for (const [letter, l1, l2, rect] of halves) {
        if (built[l1] && built[l2]) {
          alleyZones.push({ id: `alley-${bx}-${bz}-${letter}`, kind: 'alley', rect, minY: 0, maxY: 0 });
        }
      }
    }
  }

  for (const h of src.hospitals) {
    solids.push({
      id: hospitalBlockId(h),
      kind: 'hospital',
      center: vec3(h.center.x, h.center.y + hospitalBlock.y / 2, h.center.z),
      size: vec3(hospitalBlock.x, hospitalBlock.y, hospitalBlock.z),
    });
  }

  solids.push(...src.solids);
  return { ...map, solids, accessZones: [...src.accessZones, ...alleyZones] };
}
