import { initNav, NAV_TIERS, NavRouter, type VehicleTier } from '@dm/shared';
import walkUrl from '../../../../map/nav/greybox-walk.bin?url';
import skateboardUrl from '../../../../map/nav/greybox-skateboard.bin?url';
import bicycleUrl from '../../../../map/nav/greybox-bicycle.bin?url';
import motorbikeUrl from '../../../../map/nav/greybox-motorbike.bin?url';
import carUrl from '../../../../map/nav/greybox-car.bin?url';

/** The five navmeshes built by `pnpm map:build` (Vite emits them as assets under the base path). */
const NAV_URLS: Record<VehicleTier, string> = {
  walk: walkUrl,
  skateboard: skateboardUrl,
  bicycle: bicycleUrl,
  motorbike: motorbikeUrl,
  car: carUrl,
};

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`navmesh ${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Loads the recast WASM and the five per-tier navmeshes (in parallel) and builds the router. */
export async function loadNavRouter(): Promise<NavRouter> {
  const [, ...bytes] = await Promise.all([initNav(), ...NAV_TIERS.map((t) => fetchBytes(NAV_URLS[t]))]);
  const bins = {} as Record<VehicleTier, Uint8Array>;
  NAV_TIERS.forEach((t, i) => (bins[t] = bytes[i]!));
  return NavRouter.fromBinaries(bins);
}
