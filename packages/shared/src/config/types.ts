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
  slide: { minEntrySpeed: number; friction: number; endSpeed: number; slopeGravityScale: number; boostSpeed: number; boostCooldown: number };
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

/** A map's distance bands: Short below shortMax, Medium up to mediumMax, Long beyond, m. */
export interface BandLimits { shortMax: number; mediumMax: number }

export interface OrdersConfig {
  board: { size: number; refreshSeconds: number; cancelCooldownSeconds: number };
  backpack: { baseSlots: number; maxSlots: number };
  /** Distance bands per map (Ruling R3): the 2 km city and the SP1 greybox. */
  bands: { city: BandLimits; greybox: BandLimits };
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
  /** What the build-time POI table must show (spec §5.3): reachable POIs, elevated share of them, POIs per band. */
  poiChecks: { minReachable: number; minElevatedShare: number; minPerBand: number };
}

export interface WorldConfig {
  /** Side of a streamed chunk, metres */
  chunkSize: number;
  physics: { loadRadius: number; unloadRadius: number };
  nav: NavConfig;
}

/** The build-time navmesh (recast) and its path queries. */
export interface NavConfig {
  /** Voxel size across and up, metres */
  cellSize: number;
  cellHeight: number;
  /** Tile side, voxels */
  tileSize: number;
  /** Smallest isolated walkable island kept (side of the square, voxels): balconies and kit crates are islands */
  minRegionArea: number;
  /** Longest polygon edge along a wall, voxels; 0 leaves edges unsplit (half the polygons on the open streets) */
  maxEdgeLen: number;
  /** Per-tile bounding-volume trees speed nearest-polygon lookups but add ~1 MB to the export */
  buildBvTree: boolean;
  /** How far (horizontally) a navigation link's ends reach for the navmesh, metres */
  linkRadius: number;
  /** The box a path's start and end snap to the navmesh within; small vertically so a roof never snaps to the street */
  queryHalfExtents: { x: number; y: number; z: number };
  /** A* node pool of the path query (Detour caps it at 65535): a smaller pool ends long paths early, as partial paths */
  maxNodes: number;
  maxPathPolys: number;
  maxStraightPathPoints: number;
  /** A path counts only when it ends (and starts) within this of its target, metres */
  reachTolerance: number;
  /** Size budget of the exported navmesh (map/city.navmesh.bin) */
  maxNavMeshMB: number;
}
