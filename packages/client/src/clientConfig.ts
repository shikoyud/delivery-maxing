import type { RideTier } from '@dm/shared';
import clientJson from '../../../config/client.json';

export interface ClientConfig {
  camera: {
    fovBase: number;
    fovMax: number;
    fovSpeedMin: number;
    fovSpeedMax: number;
    /** Exponential ease rate (1/s) of the speed FOV kick. */
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
  courier: CourierConfig;
  ui: {
    /** How long a delivery popup stays on screen (s). */
    popupSeconds: number;
    /** Popups on screen at once; the oldest is dropped first. */
    maxPopups: number;
    /** HUD text refresh rate (Hz); the 3D waypoints still update every frame. */
    hudUpdateHz: number;
    /** Waypoint beam pulse rate (Hz). */
    waypointPulseHz: number;
    /** Below this many seconds left, an order timer (hot, par, Express) turns to its urgent colour. */
    timerUrgentSeconds: number;
    /** How often the route line to the active waypoint is recomputed (s). */
    routeRefreshSeconds: number;
    /** Minimum gap between repeats of the same on-screen hint (s). */
    hintCooldownSeconds: number;
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
   * R12: with a wall face this close to the pivot, the pivot moves up to this far off the courier's axis along the
   * wall normal, so the boom has room and the courier stays in view.
   */
  wallPivotOffset: number;
  /** Per-vehicle overrides of distance, height and pivotHeight while riding. */
  rides: Record<RideTier, { distance: number; height: number; pivotHeight: number }>;
}

/** A procedural pose layered over the courier's clip (see render/courier). */
export type CourierPoseName = 'slide' | 'mantle' | 'board' | 'bike' | 'fall' | 'crouch';

/**
 * One procedural pose. Angles are degrees about the courier's own axes (+X right, +Y up, +Z back; the courier faces
 * −Z), so +X leans an upright part back and swings a hanging limb forward, and +Z tips an upright part to the left.
 */
export interface CourierPose {
  /** Lowers the whole model (feet included), m. */
  drop: number;
  /** Lowers the hips only (the feet stay where the legs put them), m. */
  hipDrop: number;
  /** Whole-model rotation [x, y, z] about the feet. */
  body: number[];
  /** Extra rotation [x, y, z] per bone name, applied over the clip's own rotation. */
  bones: Record<string, number[]>;
}

/** The animated courier model (Task 5). Speeds in m/s, rates in 1/s, times in s, lengths in m. */
export interface CourierConfig {
  /** The model is scaled to this height (feet to the top of the head). */
  height: number;
  /** Exponential ease rate of the model's yaw toward the way it faces (displayYaw). */
  turnEaseRate: number;
  /** In a slide the courier faces its velocity above this horizontal speed (R14). */
  facingMinSpeed: number;
  /** Clip cross-fade and pose blend time. */
  crossFade: number;
  /** The Running clip plays at normal speed at this ground speed (faster above, slower below). */
  runSpeedForFullRun: number;
  /** Floor on the Running playback rate, so a slow run never plays in slow motion. */
  runMinTimeScale: number;
  /** Below this the courier idles; up to walkMaxSpeed it walks; above it runs. */
  idleSpeed: number;
  walkMaxSpeed: number;
  /** In the air and falling faster than this (downward m/s), the fall pose plays. */
  fallSpeed: number;
  /** [from, to] s of the model's Jump clip used in the air: played once from take-off, then held. */
  airClip: number[];
  /** One box per carried package on the courier's back, in this many columns. */
  packages: { size: number; gap: number; columns: number };
  /** The skateboard deck under the feet while on the board. */
  deck: { length: number; width: number; thickness: number; wheelGap: number };
  poses: Record<CourierPoseName, CourierPose>;
}

export type BindingName =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint'
  | 'interact' | 'board' | 'hit' | 'phone' | 'map' | 'accept' | 'mount' | 'devPanel' | 'debugOverlay';

export const clientConfig: ClientConfig = clientJson;
