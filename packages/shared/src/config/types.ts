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
  board: {
    topSpeed: number;
    accel: number;
    brakeDecel: number;
    /** Back input (dot(wish, heading) < -0.5) brakes only above this speed along the heading; at or below it, it steers (R3). */
    brakeMinSpeed: number;
    friction: number;
    turnRate: number;
  };
  fall: { outOfBoundsY: number; boundsMargin: number };
}

export type VehicleTier = 'walk' | 'skateboard' | 'bicycle' | 'motorbike' | 'car';
export interface VehicleSpec { slots: number; maxPackageKg: number; topSpeed: number }
export type VehiclesConfig = Record<VehicleTier, VehicleSpec>;

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
  fragile: { maxFallMeters: number };
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
