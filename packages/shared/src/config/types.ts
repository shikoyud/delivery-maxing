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
  jump: { height: number; coyoteTime: number; bufferTime: number };
  mantle: { minHeight: number; maxHeight: number; reach: number; duration: number };
  slide: { minEntrySpeed: number; friction: number; endSpeed: number; slopeGravityScale: number };
  chute: { friction: number; steerAccel: number };
  wallRun: {
    maxTime: number;
    minSpeed: number;
    checkDistance: number;
    gravityScale: number;
    maxApproachAngleDeg: number;
    wallJumpPush: number;
    sameWallDot: number;
    /** Speed (m/s) at which a wall-runner is pulled toward the wall so contact holds. */
    stickSpeed: number;
    /** Fastest fall (m/s) kept when a wall-run starts: vy = max(vy, -maxEntryFallSpeed) (R24). */
    maxEntryFallSpeed: number;
    /** Highest a wall-run may start (m) above the first wall-run start of the current chain (R25). */
    maxChainRise: number;
  };
  zipLine: {
    attachDistance: number;
    hangDrop: number;
    baseSpeed: number;
    maxSpeed: number;
    /** How far below the cable end (m) the end-of-ride dismount looks for a standing surface. */
    dismountReach: number;
    /** Attaching is refused when less line than this (m) remains in the ride direction. */
    minRideLength: number;
    /** |cos| between the facing and the line (horizontally) below which the facing does not pick the ride end. */
    facingTie: number;
    /** Horizontal speed along the line (m/s) below which the velocity does not pick the ride end either. */
    velocityTie: number;
  };
  jumpPad: { retriggerCooldown: number };
  boostOrb: { radius: number; speedMultiplier: number; duration: number; respawnTime: number };
  rail: { snapDistance: number; friction: number; minSpeedFoot: number };
  board: {
    topSpeed: number;
    accel: number;
    brakeDecel: number;
    /** Back input (dot(wish, heading) < -0.5) brakes only above this speed along the heading; at or below it, it steers (R3). */
    brakeMinSpeed: number;
    friction: number;
    turnRate: number;
    railMinSpeed: number;
  };
  fall: { outOfBoundsY: number; boundsMargin: number };
}

export interface OrdersConfig {
  board: { size: number; refreshSeconds: number; cancelCooldownSeconds: number };
  backpack: { baseSlots: number; maxSlots: number };
  bands: { shortMax: number; mediumMax: number };
  points: {
    short: number;
    medium: number;
    long: number;
    chain: number;
    expressOnTime: number;
    fragileIntact: number;
    heavy: number;
    withinPar: number;
  };
  coins: {
    short: number;
    medium: number;
    long: number;
    chain: number;
    expressOnTime: number;
    fragileIntact: number;
    heavy: number;
    withinPar: number;
  };
  express: { distanceFactor: number; extraSeconds: number };
  par: { distanceFactor: number; extraSeconds: number };
  fragile: { maxFallMeters: number };
  heavy: { slots: number; jumpHeightMultiplier: number };
  mix: {
    typeWeights: { dropoff: number; pickup: number; chain: number };
    modifierWeights: { none: number; express: number; fragile: number; heavy: number };
  };
  zones: { poiRadius: number; poiHeight: number };
}
