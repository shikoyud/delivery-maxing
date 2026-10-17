export interface RideLookConfig {
  /** Seconds without mouse movement before the camera swings back behind the ride. */
  recenterDelay: number;
  /** Exponential rate (1/s) of the swing back. */
  recenterRate: number;
  /** The camera only swings back while the ride moves faster than this (m/s). */
  recenterMinSpeed: number;
}

const TAU = Math.PI * 2;
const wrap = (a: number): number => a - TAU * Math.round(a / TAU);

/**
 * The camera yaw on a ride: the mouse orbits it freely around the vehicle (an offset from the heading), and after
 * recenterDelay without mouse movement, while the ride moves, the offset eases back to 0 (behind the heading).
 */
export class RideLook {
  private off = 0;
  private idle = 0;

  constructor(private readonly cfg: RideLookConfig) {}

  /** Getting on: keeps the camera where it was, so nothing jumps. */
  mount(cameraYaw: number, heading: number): void {
    this.off = wrap(cameraYaw - heading);
    this.idle = 0;
  }

  /** Orbit offset from the heading, radians in (−π, π]. */
  get offset(): number {
    return this.off;
  }

  /** Advances one frame; returns the camera yaw (same convention as the heading). */
  update(mouseYawDelta: number, heading: number, speed: number, dt: number): number {
    if (mouseYawDelta !== 0) {
      this.off = wrap(this.off + mouseYawDelta);
      this.idle = 0;
    } else {
      this.idle += dt;
      if (this.idle >= this.cfg.recenterDelay && speed >= this.cfg.recenterMinSpeed) {
        this.off *= Math.exp(-this.cfg.recenterRate * dt);
      }
    }
    return heading + this.off;
  }
}
