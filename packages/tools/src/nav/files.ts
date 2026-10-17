import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { MapData, VehicleTier } from '@dm/shared';

/** The repository root. */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The greybox source map, relative to the repository root. */
export const GREYBOX_SOURCE = 'map/greybox.json';

/** The committed, gzipped navmesh of a map's tier (`pnpm map:build`), relative to the repository root. */
export const navBinPath = (kind: MapData['kind'], tier: VehicleTier): string => `map/nav/${kind}-${tier}.bin.gz`;

/** The city's pickup→dropoff on-foot distance table, gzipped (`pnpm map:build`), relative to the repository root. */
export const DISTANCES = 'map/city.distances.bin.gz';

/** Gzip as committed: level 9, no file name or time in the header, so the same bytes give the same file. */
export const gzip = (bytes: Uint8Array): Uint8Array => new Uint8Array(gzipSync(bytes, { level: 9 }));

/** The inflated contents of a committed .gz file. */
export const readGz = (repo: string, path: string): Uint8Array => new Uint8Array(gunzipSync(readFileSync(join(repo, path))));

/** The generated city layout (`pnpm map:build`), relative to the repository root. */
export const CITY_LAYOUT = 'map/city.layout.json';

/** The asset catalog, relative to the repository root. */
export const CATALOG = 'map/catalog.json';
