import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VehicleTier } from '@dm/shared';

/** The repository root. */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The greybox source map, relative to the repository root. */
export const GREYBOX_SOURCE = 'map/greybox.json';

/** The committed navmesh of a tier (`pnpm map:build`), relative to the repository root. */
export const navBinPath = (tier: VehicleTier): string => `map/nav/greybox-${tier}.bin`;
