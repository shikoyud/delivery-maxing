import type { ClientConfig } from '../clientConfig';

type CameraConfig = ClientConfig['camera'];

/** Field of view (degrees) widening linearly with horizontal speed between fovSpeedMin and fovSpeedMax. */
export function fovForSpeed(speed: number, cam: CameraConfig): number {
  const t = (speed - cam.fovSpeedMin) / (cam.fovSpeedMax - cam.fovSpeedMin);
  if (!(t > 0)) return cam.fovBase;
  if (t >= 1) return cam.fovMax;
  return cam.fovBase + (cam.fovMax - cam.fovBase) * t;
}

/** Frame-rate independent exponential ease of `current` toward `target` at `rate` (1/s). */
export function easeToward(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}
