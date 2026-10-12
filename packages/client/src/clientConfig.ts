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
    /** Exponential ease rate (1/s) of the chase pivot height between standing and crouched (no camera snap). */
    crouchEaseRate: number;
    /** Near and far clip planes (m). */
    near: number;
    far: number;
    chase: ChaseConfig;
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
  ui: {
    /** How long a delivery popup stays on screen (s). */
    popupSeconds: number;
    /** Popups on screen at once; the oldest is dropped first. */
    maxPopups: number;
    /** HUD text refresh rate (Hz); the 3D waypoints still update every frame. */
    hudUpdateHz: number;
    /** Waypoint beam pulse rate (Hz). */
    waypointPulseHz: number;
    /** Below this many seconds left, an Express timer turns to its urgent colour. */
    expressUrgentSeconds: number;
    /** After a board refresh, Accept clicks are ignored this long (s) and the board flashes (Review Focus 3). */
    boardRefreshGuardSeconds: number;
  };
}

/** Third-person chase camera (spec §4 "Camera"). Lengths in metres, rates in 1/s. */
export interface ChaseConfig {
  /** Boom length behind the pivot on open ground. */
  distance: number;
  /** Camera height above the feet on open ground at level pitch. */
  height: number;
  /** The camera orbits a pivot this far above the feet (crouchPivotHeight while crouched or sliding). */
  pivotHeight: number;
  crouchPivotHeight: number;
  /** Look pitch limits (degrees): negative looks down (camera above the courier). */
  pitchMinDeg: number;
  pitchMaxDeg: number;
  /** Ease rate of the followed pivot toward the courier (the slight lag; hides small sim snaps). */
  followEaseRate: number;
  /** A blocked boom stops this far short of the hit. */
  collisionRadius: number;
  /** The boom is never shortened below this (unless that would put the camera inside geometry). */
  minDistance: number;
  /** Boom length ease rates when geometry pulls it in and when it lets it back out. */
  pullInEaseRate: number;
  pushOutEaseRate: number;
}

export type BindingName =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint'
  | 'interact' | 'board' | 'hit' | 'devPanel' | 'debugOverlay';

export const clientConfig: ClientConfig = clientJson;
