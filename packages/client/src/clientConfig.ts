import clientJson from '../../../config/client.json';

export interface ClientConfig {
  camera: {
    fovBase: number;
    fovMax: number;
    fovSpeedMin: number;
    fovSpeedMax: number;
    wallRunRollDeg: number;
    /** Exponential ease rates (1/s) for the wall-run roll and the speed FOV kick. */
    rollEaseRate: number;
    fovEaseRate: number;
    eyeHeight: number;
    crouchEyeHeight: number;
    pitchLimitDeg: number;
    /** Near and far clip planes (m). */
    near: number;
    far: number;
  };
  graphics: {
    maxPixelRatio: number;
    shadows: boolean;
    shadowMapSize: number;
    shadowExtent: number;
    fogNear: number;
    fogFar: number;
    drawCallBudget: number;
    /** Water plane height (m): below the ground top (0) and above movement fall.outOfBoundsY. */
    waterLevel: number;
    /** How far the water extends past the island edge on each side (m). */
    waterMargin: number;
    lights: { hemi: number; sun: number };
    shadowBias: number;
    shadowNormalBias: number;
  };
  input: {
    mouseSensitivity: number;
    invertY: boolean;
    bindings: Record<BindingName, string[]>;
  };
}

export type BindingName =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint'
  | 'interact' | 'board' | 'hit' | 'devPanel' | 'debugOverlay';

export const clientConfig: ClientConfig = clientJson;
