import type { Lod1Options, RideTier } from '@dm/shared';
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
    /** Draw calls and triangles allowed in view (spec §11; e2e and ?perf=1 check them). */
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
  city: CityRenderConfig;
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
    /** Metres the player may drift from a cached route's start before it is recomputed early. */
    routeDriftMeters: number;
    /** Minimum gap between repeats of the same on-screen hint (s). */
    hintCooldownSeconds: number;
    /** The HUD fuel gauge turns to the warning colour at or below this tank share (%). */
    fuelLowPct: number;
    /** The phone Map app on the city shows a window this many metres wide, centred on the player (the greybox shows all of it). */
    mapWindowMeters: number;
  };
}

/** How the city is drawn (city design §7, §8). Distances in metres, horizontal from the player. */
export interface CityRenderConfig {
  /** LOD rings: pack models at LOD0 within [0], LOD1 within [1]; placeholder block boxes out to [2] (= graphics.fogFar). */
  lodRadii: number[];
  /** The player moves this far before the LOD rings are recomputed. */
  relodDistance: number;
  /** Side of the square render regions the roads, terrain and ground are merged into. */
  renderRegion: number;
  /** Lot ids show as labels in the map debug view (Decision 7) within this radius. */
  labelRadius: number;
  /** Where `pnpm assets:import` puts the runtime pack models, relative to the site base (public/packs/). */
  modelsBase: string;
  /** Lots this near request their models, so they have loaded by the time they enter lodRadii[1]. */
  loadAheadRadius: number;
  /**
   * How `pnpm assets:import` makes LOD1 files: meshopt simplification toward `ratio` of the triangles within `error`
   * (a share of the model's size), kept only when it drops at least `minDrop` of them (else LOD1 draws LOD0).
   */
  lod1: Lod1Config;
  /**
   * In the LOD1 ring (lodRadii[0]..[1]), a lot whose model has no LOD1 file stays its placeholder box (`box`) or draws
   * its full LOD0 model (`lod0`). Most pack models simplify too little to get a LOD1 file, so `lod0` costs one
   * InstancedMesh and every LOD0 triangle per such id out to lodRadii[1].
   */
  lod1Fallback: Lod1Fallback;
}

export type Lod1Fallback = 'box' | 'lod0';

function lod1Fallback(v: string): Lod1Fallback {
  if (v !== 'box' && v !== 'lod0') throw new Error(`config/client.json city.lod1Fallback: expected "box" or "lod0", got ${v}`);
  return v;
}

export type Lod1Config = Lod1Options;

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
  poses: Record<CourierPoseName, CourierPose>;
}

export type BindingName =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint'
  | 'interact' | 'hit' | 'phone' | 'map' | 'accept' | 'mount' | 'devPanel' | 'debugOverlay';

export const clientConfig: ClientConfig = { ...clientJson, city: { ...clientJson.city, lod1Fallback: lod1Fallback(clientJson.city.lod1Fallback) } };
