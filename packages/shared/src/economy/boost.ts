import { economyConfig } from '../config';
import type { EconomyConfig } from '../config/types';

/** Lock-to-boost (spec §6.4): `1 + maxBoost × min(1, locked USD ÷ fullBoostUsd)`. */
export function boostMultiplier(lockedUsdMicro: number, cfg: EconomyConfig = economyConfig): number {
  return 1 + cfg.lock.maxBoost * Math.min(1, Math.max(0, lockedUsdMicro) / cfg.lock.fullBoostUsdMicro);
}
