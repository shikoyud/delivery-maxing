/**
 * Stable per-order colour indices (R29d): an order keeps the index it got when it first appeared among the active
 * orders (the lowest index not in use), so HUD stripes, board rows and waypoint beams don't change colour when an
 * earlier order completes or is cancelled.
 */
export class SlotColorAssigner {
  private readonly byId = new Map<string, number>();

  /** Forgets orders no longer active and gives new ones the lowest free index, in list order. */
  sync(activeIds: readonly string[]): void {
    const keep = new Set(activeIds);
    for (const id of [...this.byId.keys()]) if (!keep.has(id)) this.byId.delete(id);
    for (const id of activeIds) {
      if (this.byId.has(id)) continue;
      const used = new Set(this.byId.values());
      let i = 0;
      while (used.has(i)) i++;
      this.byId.set(id, i);
    }
  }

  /** The order's colour index (0 for an order sync() hasn't seen). */
  indexOf(id: string): number {
    return this.byId.get(id) ?? 0;
  }
}
