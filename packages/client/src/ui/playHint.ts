/**
 * Whether the "Click to play" hint is hidden: while the pointer is locked (playing) and while the phone or the map is open (they
 * always release the lock so the mouse can use them; the hint would otherwise show behind them).
 */
export function playHintHidden(s: { locked: boolean; phoneOpen: boolean }): boolean {
  return s.locked || s.phoneOpen;
}
