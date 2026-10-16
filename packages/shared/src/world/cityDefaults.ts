import type { CityConfig } from '../config';

/**
 * Fallback used by `layoutToMap` / `terrainSolids` when no city config is passed (config/city.json arrives with SP5 Task 6,
 * which replaces this with the real file). The L0 ground values are the city design section 2 shoreline.
 */
export const cityConfigDefaults: CityConfig = {
  layout: {
    slabThickness: 1,
    terrainThickness: 3,
    steepLaneWidth: 6,
    steepLaneGradePct: 14,
    zoneStep: 6,
    stairsWidth: 4,
    l0Ground: [
      { id: 'docks', x0: 0, x1: 380, z0: 110 },
      { id: 'beach', x0: 380, x1: 820, z0: 200 },
      { id: 'harbor', x0: 820, x1: 1200, z0: 120 },
    ],
  },
};
