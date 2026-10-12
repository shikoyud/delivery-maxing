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

/** Third-person chase camera (spec §4 "Camera", rulings R9 and R10). Lengths in metres, rates in 1/s. */
export interface ChaseConfig {
  /** Boom length behind the lifted pivot on open ground. */
  distance: number;
  /** Lift above the pivot before the boom runs back (R9: camera at feet + pivotHeight + height at level pitch). */
  height: number;
  /** The camera orbits a pivot this far above the feet (crouchPivotHeight while crouched or sliding). */
  pivotHeight: number;
  crouchPivotHeight: number;
  /** The camera looks at the point this far above the feet (less the crouch drop), so the courier sits low in frame. */
  lookAtHeight: number;
  /** Look pitch limits (degrees): negative looks down (camera above the courier). */
  pitchMinDeg: number;
  pitchMaxDeg: number;
  /** Ease rate of the followed pivot toward the courier (the slight lag; hides small sim snaps). */
  followEaseRate: number;
  /**
   * Radius of the camera's collision ball (sphere cast). Must cover the near plane at fovMax (checked in
   * clientConfig.test.ts), so the camera never sees through a surface it grazes.
   */
  collisionRadius: number;
  /** Below this boom length the courier is hidden (its shadow stays); the camera itself never passes a hit (R10). */
  minDistance: number;
  /** Ease rate of the boom growing back out once geometry stops blocking it. Pulling in is immediate (R10). */
  pushOutEaseRate: number;
  /**
   * R12: while wall-running, or with a wall face this close to the pivot, the pivot moves this far off the courier's
   * axis along the wall normal, so the boom has room and the courier stays in view.
   */
  wallPivotOffset: number;
}

export type BindingName =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint'
  | 'interact' | 'board' | 'hit' | 'devPanel' | 'debugOverlay';

export const clientConfig: ClientConfig = clientJson;
