import { economyConfig } from '../config';
import type { EconomyConfig } from '../config/types';

export interface DispatcherTuning {
  maxShown: number;
  /** Multiplies the offer interval. */
  intervalScale: number;
  /** Multiplies the long band's selection weight (Decision 16: 1 + 0.3 t). */
  longWeightScale: number;
  /** Multiplies every modifier's weight, Express and Fragile (Decision 16: 1 + 0.2 t). */
  modifierWeightScale: number;
}

/** The Dispatcher line's offer tuning at `tier` (0–5, spec §6.2). */
export function dispatcherTuning(tier: number, cfg: EconomyConfig = economyConfig): DispatcherTuning {
  const d = cfg.lines.dispatcher;
  const maxShown = d.maxShown[tier];
  const intervalScale = d.intervalScale[tier];
  if (maxShown === undefined || intervalScale === undefined) throw new Error(`no dispatcher tier ${tier}`);
  return { maxShown, intervalScale, longWeightScale: 1 + d.longWeightPerTier * tier, modifierWeightScale: 1 + d.modifierWeightPerTier * tier };
}
