import type { Vec3 } from '../math/vec3';

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
  riding: { mountRadius: number; stoppedSpeed: number; dismountMaxSpeed: number; dismountGap: number; emptyTankSpeed: number };
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
