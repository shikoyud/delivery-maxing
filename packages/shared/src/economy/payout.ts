import { economyConfig } from '../config';
import type { EconomyConfig, VehicleTier } from '../config/types';

/** The order's vehicle tier's payout range in micro-USD (spec §3.6). */
export function payoutRange(tier: VehicleTier, cfg: EconomyConfig = economyConfig): { minMicro: number; maxMicro: number } {
  const [minMicro, maxMicro] = cfg.payout.ranges[tier];
  return { minMicro, maxMicro };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** The roll's quality (spec §3.6): points ÷ maxPoints clamped to [0, 1]; 0 when maxPoints is 0. */
export function payoutQuality(points: number, maxPoints: number): number {
  return clamp01(maxPoints > 0 ? points / maxPoints : 0);
}

/**
 * An order's payout roll in micro-USD (spec §3.6): `min + (max − min) × (0.6 × quality + 0.4 × luck)`, times the
 * lock-to-boost multiplier, rounded. `quality` = points ÷ maxPoints (0 when maxPoints is 0); quality and luck are
 * clamped to [0, 1]. Pure, so the server can run it (SP7).
 */
export function rollPayoutUsd(
  args: { tier: VehicleTier; points: number; maxPoints: number; luck: number; boost: number },
  cfg: EconomyConfig = economyConfig,
): number {
  const { minMicro, maxMicro } = payoutRange(args.tier, cfg);
  const quality = payoutQuality(args.points, args.maxPoints);
  const roll = cfg.payout.qualityWeight * quality + cfg.payout.luckWeight * clamp01(args.luck);
  return Math.round((minMicro + (maxMicro - minMicro) * roll) * args.boost);
}
