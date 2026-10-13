/**
 * Local epoch points (plan assumption 12): Delivery Points earned in the current reward epoch, kept apart from the
 * lifetime totals. Epochs are the wall-clock UTC windows of `seconds` (spec §9.4 step 1: 10 minutes), numbered from the
 * Unix epoch. A thief's penalty (spec §7.3) only touches the current epoch, never below 0.
 */
export interface EpochPoints { id: number; points: number }

/** The epoch a wall-clock instant (ms since the Unix epoch, UTC) falls in. */
export function epochIdAt(utcMs: number, seconds: number): number {
  return Math.floor(utcMs / 1000 / seconds);
}

/** `e` as of `utcMs`: unchanged within its epoch, else the new epoch with 0 points (a settled epoch is never carried). */
function current(e: EpochPoints, utcMs: number, seconds: number): EpochPoints {
  const id = epochIdAt(utcMs, seconds);
  return id === e.id ? { ...e } : { id, points: 0 };
}

/** Adds `n` points at `utcMs`, rolling over to the new epoch first when the window changed. */
export function addEpochPoints(e: EpochPoints, utcMs: number, seconds: number, n: number): EpochPoints {
  const c = current(e, utcMs, seconds);
  return { id: c.id, points: c.points + n };
}

/** Subtracts `n` points at `utcMs` (after any rollover), floored at 0. */
export function penalizeEpoch(e: EpochPoints, utcMs: number, seconds: number, n: number): EpochPoints {
  const c = current(e, utcMs, seconds);
  return { id: c.id, points: Math.max(0, c.points - n) };
}
