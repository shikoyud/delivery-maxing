import type { PlayerState } from '@dm/shared';
import type { ClientConfig } from '../clientConfig';

type CameraConfig = ClientConfig['camera'];

/** Field of view (degrees) widening linearly with horizontal speed between fovSpeedMin and fovSpeedMax. */
export function fovForSpeed(speed: number, cam: CameraConfig): number {
  const t = (speed - cam.fovSpeedMin) / (cam.fovSpeedMax - cam.fovSpeedMin);
  if (!(t > 0)) return cam.fovBase;
  if (t >= 1) return cam.fovMax;
  return cam.fovBase + (cam.fovMax - cam.fovBase) * t;
}

/**
 * Camera roll (radians) while wall-running: a magnitude of wallRunRollDeg, signed by which side the wall is on
 * (wall on the right gives a negative roll, on the left a positive one); 0 otherwise. The wall normal points
 * from the wall toward the player. Roll here is clockwise-positive as seen by the player, so the renderer
 * applies it as camera.rotation.z = -roll (head tilted away from the wall).
 */
export function rollForWallRun(state: PlayerState, cam: CameraConfig): number {
  const n = state.wallRun.normal;
  if (state.mode !== 'wallrun' || !n) return 0;
  // Right vector for yaw (see shared facing/rightOf): (cos yaw, 0, -sin yaw).
  const side = n.x * Math.cos(state.yaw) - n.z * Math.sin(state.yaw);
  if (side === 0) return 0;
  return (Math.sign(side) * cam.wallRunRollDeg * Math.PI) / 180;
}

/** Frame-rate independent exponential ease of `current` toward `target` at `rate` (1/s). */
export function easeToward(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}
