/**
 * Whether the "Click to play" hint is hidden: while the pointer is locked (playing) and while the phone is open (the
 * phone always releases the lock so its buttons can be clicked; the hint would otherwise show behind it).
 */
export function playHintHidden(s: { locked: boolean; phoneOpen: boolean }): boolean {
  return s.locked || s.phoneOpen;
}
