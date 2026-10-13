import type { Vec3 } from '@dm/shared';
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
    /** CI proxies for the 60 fps target (headless Chromium can't measure real fps): per-frame draw calls and triangles. */
    drawCallBudget: number;
    triangleBudget: number;
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
  thieves: ThievesRenderConfig;
  city: CityRenderConfig;
  /** The POI posts and ground rings (render/hubMeshes): drawn within `drawRadius` m (horizontal) of the player only. */
  poiMarkers: { drawRadius: number };
  mapDebug: MapDebugConfig;
  perf: PerfConfig;
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

/** The street thieves' models (Task 18; their simulation is config/thieves.json). Speeds in m/s, times in s. */
export interface ThievesRenderConfig {
  /** Only thieves within this horizontal distance (m) of the player are drawn and animated. */
  renderRadius: number;
  /** Clip cross-fade time. */
  crossFade: number;
  /** Man_Run plays at normal speed at this chase speed (faster above, slower below). */
  runSpeedForFullRun: number;
  /** On patrol or return, at or below this speed the thief idles; above it, it walks. */
  idleSpeed: number;
  /** Man_Punch plays this long after a catch. */
  punchSeconds: number;
}

/** The F4 map debug view (ui/mapDebug, spec §5.2). */
export interface MapDebugConfig {
  /** POI beams and labels, and thief labels, show within this horizontal distance (m) of the player. */
  radius: number;
}

/** City rendering (spec §5.1 streaming; plan assumption 13). Distances are horizontal, in metres. */
export interface CityRenderConfig {
  /** LOD ring outer radii: full model (LOD0) up to [0], LOD1 up to [1], tinted box (LOD2) up to [2], nothing beyond. */
  lodRadii: number[];
  /** Instances are re-sorted into rings when the player moved this far, or into another chunk, since the last sort. */
  relodDistance: number;
  /** Side of the square render regions the code-built geometry (ground, roads, cliffs…) is merged into. */
  renderRegion: number;
}

/**
 * The ?perf=1 flythrough (Task 8) and the CI budget viewpoints: street and rooftop views over every district. The run's
 * `seconds` are split equally across the route entries.
 */
export interface PerfConfig {
  route: { feet: Vec3; target: Vec3 }[];
  /** Flythrough length (s, all entries together) and glide speed (m/s) toward each entry's target. */
  seconds: number;
  speed: number;
  /** The run passes when the overall p95 frame time is at most this (ms): 60 Hz frames read ~16.7 ms, a dropped one ~33 ms. */
  p95TargetMs: number;
  /** Frames from the start of the run left out of the statistics (shader compiles, first uploads), s. */
  warmupSeconds: number;
  /** The first this-many frames after each teleport to the next viewpoint are left out (the jump itself). */
  teleportSkipFrames: number;
  /** Fewer counted frames than this and the run reports "too few frames" instead of PASS or FAIL. */
  minFrames: number;
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

/** A procedural pose layered over the courier's clip (see render/courier). */
export type CourierPoseName = 'slide' | 'wallrunL' | 'wallrunR' | 'zip' | 'grind' | 'mantle' | 'board' | 'fall' | 'crouch';

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
  /** On a zip line, in a slide, grind or wall-run the courier faces its velocity above this horizontal speed (R14). */
  facingMinSpeed: number;
  /** After leaving a zip line the courier eases down onto the feet at this exponential rate (1/s, R16). */
  dismountEaseRate: number;
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
  | 'interact' | 'board' | 'hit' | 'devPanel' | 'debugOverlay' | 'mapDebug';

export const clientConfig: ClientConfig = clientJson;
