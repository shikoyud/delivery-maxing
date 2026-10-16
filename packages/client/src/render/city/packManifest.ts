import type { PackManifest } from '@dm/shared';

/**
 * The runtime packs' manifest (`public/packs/manifest.json`, written by `pnpm assets:import`), bundled at build time
 * when it exists, else null. The packs are git-ignored, so a fresh clone builds without it and the city stays boxes;
 * knowing that at build time means the browser never asks for a model that is not there (no 404 noise, Review
 * Focus 1), and LOD1 files are only fetched where the import wrote one.
 */
const found = import.meta.glob<PackManifest>('/public/packs/manifest.json', { eager: true, import: 'default' });
export const packManifest: PackManifest | null = Object.values(found)[0] ?? null;
