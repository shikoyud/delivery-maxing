/** Fixed-timestep accumulator. Pure: no clocks, no DOM. */
export class FixedStepper {
  readonly dt: number;
  private acc = 0;

  constructor(
    tickRate: number,
    private readonly maxStepsPerFrame: number,
  ) {
    this.dt = 1 / tickRate;
  }

  /** Adds frame time and returns the number of fixed steps to run now. */
  advance(frameSeconds: number): number {
    if (!(frameSeconds > 0)) return 0;
    this.acc += frameSeconds;
    let steps = 0;
    while (this.acc >= this.dt - 1e-9 && steps < this.maxStepsPerFrame) {
      this.acc -= this.dt;
      steps++;
    }
    if (this.acc < 0) this.acc = 0;
    // Hit the cap with backlog left: drop it so we never spiral.
    if (this.acc >= this.dt - 1e-9) this.acc = 0;
    return steps;
  }

  /** Interpolation factor in [0, 1). */
  get alpha(): number {
    return Math.min(this.acc / this.dt, 1 - 1e-9);
  }
}
