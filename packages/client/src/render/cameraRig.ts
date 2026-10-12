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

/** Eye height above the feet: low while crouched or sliding. */
export function eyeHeight(state: PlayerState, cam: CameraConfig): number {
  return state.crouched || state.mode === 'slide' ? cam.crouchEyeHeight : cam.eyeHeight;
}
