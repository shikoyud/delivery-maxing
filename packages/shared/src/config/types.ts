import type { Vec3 } from '../math/vec3';
import type { CityDistrict, OrderRules } from '../world/mapTypes';

export interface MovementConfig {
  tickRate: number;
  maxStepsPerFrame: number;
  gravity: number;
  speedCap: number;
  capsule: { radius: number; height: number; crouchHeight: number };
  controller: {
    offset: number;
    maxStepHeight: number;
    minStepWidth: number;
    snapToGround: number;
    maxSlopeClimbDeg: number;
    minSlopeSlideDeg: number;
  };
  run: {
    runSpeed: number;
    sprintSpeed: number;
    crouchSpeed: number;
    groundAccel: number;
    groundDecel: number;
    airAccel: number;
    overspeedDecay: number;
  };
  /**
   * Sprint stamina: drains while sprinting, regenerates while not. Sprint shuts off at 0 and the toggle is refused
   * below minSprintStart (so an empty bar can't stutter sprint on and off every tick).
   */
  stamina: { max: number; sprintDrainPerSecond: number; regenPerSecond: number; minSprintStart: number };
  jump: { height: number; coyoteTime: number; bufferTime: number };
  mantle: { minHeight: number; maxHeight: number; reach: number; duration: number };
  slide: { minEntrySpeed: number; friction: number; endSpeed: number; slopeGravityScale: number; boostSpeed: number; boostCooldown: number };
  fall: { outOfBoundsY: number; boundsMargin: number };
}

export type VehicleTier = 'walk' | 'skateboard' | 'bicycle' | 'motorbike' | 'car';
export interface VehicleSpec { slots: number; maxPackageKg: number; topSpeed: number }
export type VehiclesConfig = Record<VehicleTier, VehicleSpec>;

export type RideTier = 'skateboard' | 'bicycle' | 'motorbike' | 'car';
export const RIDE_TIERS: readonly RideTier[] = ['skateboard', 'bicycle', 'motorbike', 'car'];
export type AccessKind = 'alley' | 'steepLane' | 'stairs' | 'path';

export interface RideSpec {
  accel: number;
  brakeDecel: number;
  coastDecel: number;
  handbrakeDecel: number;
  reverseSpeed: number;
  turnRateLow: number;
  turnRateHigh: number;
  grip: number;
  handbrakeGrip: number;
  slopeGravityScale: number;
  collider: { shape: 'upright' | 'lengthwise'; radius: number; halfLength: number; height: number };
  maxStepHeight: number;
  maxSlopeClimbDeg: number;
  fuel: { rangeMeters: number; fullTankCoins: number } | null;
}

export interface RidingConfig {
  rides: Record<RideTier, RideSpec>;
  access: Record<VehicleTier, AccessKind[]>;
  riding: {
    mountRadius: number;
    /** A parked vehicle more than this far above or below the feet (m) is out of reach for F. */
    mountReachHeight: number;
    stoppedSpeed: number;
    dismountMaxSpeed: number;
    dismountGap: number;
    emptyTankSpeed: number;
    /** Drive input whose direction has a dot product with the heading below this points back (brake / reverse). */
    backInputDot: number;
    /**
     * A ride whose reverseSpeed is at most this (the two-wheelers' walking pace) turns toward back input first and
     * only backs up when that turn is blocked by an obstacle; faster-reversing rides (the car) back up at once.
     */
    turnFirstMaxReverse: number;
    /** When such a ride's short-way turn is refused it backs up for this long (s) before turning again. */
    backOutSeconds: number;
  };
  refuel: { pumpRadius: number; tankPerSecond: number };
  summon: { minDistance: number; cooldownSeconds: number; minClearance: number; searchRadius: number; ringSamples: number };
  bays: { spacing: number };
}

export interface NavConfig {
  cellSize: number;
  cellHeight: number;
  tileSize: number;
  minRegionArea: number;
  maxEdgeLen: number;
  maxNodes: number;
  maxPathPolys: number;
  maxStraightPathPoints: number;
  queryHalfExtents: Vec3;
  reachTolerance: number;
  blockerHeight: number;
  carRoadMaxDoorDistance: number;
  maxFoodOffCarShare: number;
  /**
   * The walk navmesh's climb (m), clamped to movement.mantle.maxHeight. Above the courier's step height because
   * recast's ledge filter rejects a cell whose neighbours span more than one climb, and on stairs a cell can have
   * the step below and the step above as neighbours (two rises).
   */
  walkClimb: number;
  /** routeToDoor snaps a door to the mesh within carRoadMaxDoorDistance, doubling the search box up to this (m). */
  doorSearchMaxRadius: number;
  /** routeToDoor returns null when the straight foot leg from where the tier stops to the door is longer (m). */
  maxFootLeg: number;
}

interface TimeRule { distanceFactor: number; extraSeconds: number }
interface Rewards { short: number; medium: number; long: number; hot: number; par: number; express: number; fragile: number }

export interface OrdersConfig {
  offers: { maxShown: number; lifetimeSeconds: number; minIntervalSeconds: number; maxIntervalSeconds: number };
  /** After a completed delivery, the next offer waits at least this long (server-side pacing; no UI). */
  deliveryCooldown: { minSeconds: number; maxSeconds: number };
  /** Food orders: seconds the kitchen takes once the courier arrives at the pickup, before the order can be picked up. */
  prep: { foodSeconds: number };
  lockout: { seconds: number };
  spacing: { doorMeters: number; reuseSeconds: number };
  referenceSpeed: number;
  hot: TimeRule;
  par: TimeRule;
  express: TimeRule;
  fragile: { maxFallMeters: number; crashSpeed: number };
  weightClasses: { smallMax: number; mediumMax: number; largeMax: number; bulkyMax: number };
  weightMultiplier: { small: number; medium: number; large: number; bulky: number };
  points: Rewards;
  coins: Rewards;
  mix: {
    kindWeights: { food: number; package: number };
    modifierWeights: { none: number; express: number; fragile: number };
  };
  zones: { poiRadius: number; poiHeight: number };
}

export interface WorldConfig {
  chunkSize: number;
  physics: { loadRadius: number; unloadRadius: number };
}

type CityLevelKey = 'L0' | 'L1' | 'L2' | 'L3' | 'ridge';
type CityBandKey = 'A' | 'B' | 'C' | 'D';

/** config/city.json: the city generator's rules (city design sections 2-6) and the terrain the map is built from. */
export interface CityConfig {
  size: number;
  seed: number;
  /** Widths (m) */
  street: number;
  avenue: number;
  alley: number;
  /** Cross streets: centre lines at crossStreetFirst + crossStreetPitch * k for k < crossStreets */
  crossStreetFirst: number;
  crossStreetPitch: number;
  crossStreets: number;
  /** West side of the east edge street */
  eastEdgeStreetX: number;
  levels: Record<CityLevelKey, { y: number; z0: number; z1: number }>;
  bands: Record<CityBandKey, { z0: number; z1: number; y0: number; y1: number }>;
  blockDepth: { dense: number; alley: number };
  /** Every openEvery-th block ((k + row) % openEvery === 0) is open in blockFill.openDistricts */
  openEvery: number;
  districtSplits: { L1: { industrialMaxX: number; downtownMaxX: number }; L2: { rowhousesMaxX: number; highstreetMaxX: number } };
  blockFill: {
    /** A row of lots stops when less than this is left (m) */
    minGap: number;
    /** Districts whose full-depth blocks have no alley */
    denseDistricts: CityDistrict[];
    openDistricts: CityDistrict[];
    /** Sports courts: inset from the block's south-west corner, and x spacing between the two courts */
    sportsInset: number;
    sportsSpacing: number;
    /** Car park: x inset from the block's west side */
    parkingInset: number;
  };
  terrain: {
    /** Thickness of every ground slab (m); its top is the level height. */
    slabThickness: number;
    /** Thickness of sand / pier / breakwater slabs (m); the top is the area height. */
    terrainThickness: number;
    /** L0 ground rects; each stops at the water (x range and the z the ground starts at). */
    l0Ground: { id: string; x0: number; x1: number; z0: number }[];
  };
  switchback: { gradePct: number; legLength: number; legLengthShallow: number; landing: number; landingShallow: number; width: number };
  /** A steep lane's access zone is one rect per zoneStep metres of run. */
  steepLane: { gradePct: number; width: number; zoneStep: number };
  stairs: { width: number; rise: number; tread: number; landingEvery: number };
  parapet: { height: number; thickness: number };
  hospital: { lot: number; safeRadius: number; bayOffset: number; bayBack: number };
  gasStation: { lotW: number; lotD: number };
  hillcrest: {
    lot: number;
    depth: number;
    driveZ: number;
    driveAmplitude: number;
    drivePeriod: number;
    driveWidth: number;
    parkX0: number;
    parkX1: number;
  };
  docks: { quayZ: number; railZ0: number; railZ1: number; containerCols: number; containerRows: number };
  beach: { x0: number; x1: number; boardwalkZ0: number; boardwalkZ1: number };
  harbor: { pierX: number; pierWidth: number; breakwater: { x0: number; z0: number; z1: number } };
  pois: { foodPickupCap: number; packagePickupCap: number; target: number; doorSpacing: number };
  orderRules: OrderRules;
}

/** config/names.json: the fictional word lists business, household and street names are made from. */
export interface NamesConfig {
  /** First words of business names ("Crumb", "Bayside", ...) */
  first: string[];
  /** Suffixes by catalog kind word ("bakery") or, failing that, by catalog category ("food") */
  kinds: Record<string, string[]>;
  surnames: string[];
  streets: {
    /** L0, L1, L2, L3, ridge */
    avenues: string[];
    /** One per cross street, west to east */
    cross: string[];
    quay: string;
    /** The east edge street of every built level */
    edge: string;
    /** East-west streets between block rows, south to north, per built level */
    rows: Record<'L1' | 'L2' | 'L3', string[]>;
    /** The street along the top of each built level */
    terraces: Record<'L1' | 'L2' | 'L3', string>;
  };
  address: {
    /** House numbers go up by 2 every `step` metres along the street */
    step: number;
    /** Homes with more floors than this get ", apt <n>" */
    aptOverFloors: number;
    aptsPerFloor: number;
    /** Floors of a home whose catalog kind does not say: height / floorHeight */
    floorHeight: number;
    /** Street-name words shortened in addresses ("Street" -> "St") */
    abbreviations: Record<string, string>;
  };
}
