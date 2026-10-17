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
  };
  refuel: { pumpRadius: number; tankPerSecond: number };
  summon: { minDistance: number; cooldownSeconds: number; minClearance: number; searchRadius: number; ringSamples: number };
  bays: { spacing: number };
}

export interface NavConfig {
  /** Recast cell size per tier (m): finer on foot, coarser for wider agents (Decision 13). */
  cellSizeByTier: Record<VehicleTier, number>;
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
   * the step below and the step above as neighbours (two rises). 1 m: the beach bars stand on the sand 1 m below the
   * boardwalk, which the courier mantles (the mantle height caps it).
   */
  walkClimb: number;
  /** routeToDoor snaps a door to the mesh within carRoadMaxDoorDistance, doubling the search box up to this (m). */
  doorSearchMaxRadius: number;
  /** routeToDoor returns null when the straight foot leg from where the tier stops to the door is longer (m). */
  maxFootLeg: number;
  /** map:check fails when a map's five gzipped navmeshes total more than this (MB, 10^6 bytes). */
  maxNavMeshMB: number;
  /**
   * City area kinds (`CityLayout.areas`) each tier's navmesh is kept off with blocker boxes, beside the access zones:
   * the car off the beach sand, the pier, the marina and the band-gap floors (Review Focus 4). A band gap's blocker
   * leaves its switchback's own deck open.
   */
  forbiddenAreasByTier: Record<VehicleTier, string[]>;
  /** The validator samples each forbidden zone or area on a grid this fine (m) for polygons of a tier's mesh. */
  forbiddenSampleStep: number;
  /**
   * A band gap's blocker is a slab `height` thick on the gap floor (one fill layer above the floor, so no ride stands
   * on it) that runs under the switchback decks: only deck parts whose top is less than height + deck thickness +
   * `deckClearance` above the floor (the entry stub, the foot of the first leg) are left out of it.
   */
  gapFloorBlocker: { height: number; deckClearance: number };
  /** Validator tolerances (m). */
  validate: {
    /** A polygon within this of a zone's or floor's height range counts as on it. */
    floorTolerance: number;
    /** A polygon point counts as inside a zone or area only this far inside its rect (edges are shared with roads). */
    zoneInset: number;
    /** A door counts as inside another lot only when the lots' base heights differ by less than this. */
    doorLotHeightWindow: number;
  };
}

interface TimeRule { distanceFactor: number; extraSeconds: number }
interface Rewards { short: number; medium: number; long: number; hot: number; par: number; express: number; fragile: number }

export interface OrdersConfig {
  offers: {
    maxShown: number;
    lifetimeSeconds: number;
    minIntervalSeconds: number;
    maxIntervalSeconds: number;
    /** A roll path-queries at most this many pickups (nearest in a straight line first) for the player→pickup leg. */
    maxPathQueries: number;
  };
  /** After a completed delivery, the next offer waits at least this long (server-side pacing; no UI). */
  deliveryCooldown: { minSeconds: number; maxSeconds: number };
  /** Food orders: seconds the kitchen takes once the courier arrives at the pickup, before the order can be picked up. */
  prep: { foodSeconds: number };
  lockout: { seconds: number };
  /** `doorMeters` must equal config/city.json `pois.doorSpacing` (the generator and the order picker keep the same gap). */
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
    /** The two courts of a sports block, west to east, and the car park's model */
    sportsAssets: [string, string];
    parkingAsset: string;
  };
  terrain: {
    /** Thickness of every ground slab (m); its top is the level height. */
    slabThickness: number;
    /** Thickness of sand / pier / breakwater slabs (m); the top is the area height. */
    terrainThickness: number;
    /** L0 ground rects; each stops at the water (x range and the z the ground starts at). */
    l0Ground: { id: string; x0: number; x1: number; z0: number }[];
  };
  /**
   * A U of two climbing legs: `legLength` (`legLengthShallow` in a band shallower than `deepBandMin`) is the x span of
   * each leg, `landing` (`landingShallow`) the length of the entry and exit stubs and the depth of the hairpin landing.
   */
  switchback: {
    gradePct: number;
    legLength: number;
    legLengthShallow: number;
    landing: number;
    landingShallow: number;
    width: number;
    /** Ramp box thickness (m) */
    thickness: number;
    deepBandMin: number;
  };
  /** A steep lane's access zone is one rect per zoneStep metres of run. */
  steepLane: { gradePct: number; width: number; zoneStep: number; thickness: number };
  /** One step box per `rise`, `tread` deep; a `landingDepth` landing after every `landingEvery` steps. */
  stairs: { width: number; rise: number; tread: number; landingEvery: number; landingDepth: number };
  /** Along every upper terrace edge; it stops `mouthClearance` short of each connector mouth. */
  parapet: { height: number; thickness: number; mouthClearance: number };
  /** Where the connectors go (the prototype's SW_K, LANE_K and STAIR_X) and the slope-band walk-ups. */
  slopeBands: {
    /** Switchbacks start on these cross streets (k) */
    switchbackK: Record<CityBandKey, number[]>;
    /** Steep lanes start `laneOffset` east of these cross streets, `laneShift` further east while they overlap */
    laneK: Record<CityBandKey, number[]>;
    laneOffset: number;
    laneShift: number;
    /** Staircase x, `stairShift` further east (west at the city edge) while they overlap */
    stairX: Record<CityBandKey, number[]>;
    stairShift: number;
    /** The band gap reaches this far beyond a switchback's or steep lane's footprint (m) */
    gapMargin: number;
    slopeLots: {
      bands: CityBandKey[];
      /** First slot x, and the slot loop stops `endMargin` short of the east edge */
      x0: number;
      endMargin: number;
      /** A free slot is `slot` m; with `chance` it gets a walk-up, else it is skipped */
      slot: number;
      chance: number;
      /** Step past a slot that touches a connector (m) */
      skip: number;
      /** Gap after a walk-up (m) */
      spacing: number;
      /** Distance kept from a connector's extent (m) */
      clearance: number;
    };
  };
  /**
   * A hospital block: `mega/Hospital_01` on a `lot` x `lot` hospitalLot at the block's west end, facing the avenue.
   * The courier respawns `spawnOffset` in front of the door; the first parking bay is on the avenue-side sidewalk
   * `bayOffset` east of the hospitalLot and `bayBack` south of the block's front (Decision 6). The rest of the block is
   * two filler rows `rowMargin` short of half its depth, and a north row behind the hospitalLot past `behindGap`.
   */
  hospital: { asset: string; lot: number; safeRadius: number; bayOffset: number; bayBack: number; spawnOffset: number; behindGap: number; rowMargin: number };
  /** An 18 x 15 m gasLot: the canopy and the kiosk at (x, z) from its south-west corner, two pumps under the canopy. */
  gasStation: {
    lotW: number;
    lotD: number;
    canopy: { asset: string; x: number; z: number };
    kiosk: { asset: string; x: number; z: number };
    pumpSpacing: number;
  };
  /**
   * The ridge: Hillcrest Drive (z = driveZ + driveAmplitude * sin(2 pi x / drivePeriod), a point every driveStep m,
   * driveWidth wide), `lot` x `depth` plots both sides every `slot` m from x0, `setback` off the drive's edge, none in
   * the park x range or within `mouthClearance` of a band D switchback exit; the gas station's lot corner; the cliff.
   */
  hillcrest: {
    lot: number;
    depth: number;
    driveZ: number;
    driveAmplitude: number;
    drivePeriod: number;
    driveWidth: number;
    driveStep: number;
    x0: number;
    slot: number;
    endMargin: number;
    setback: number;
    mouthClearance: number;
    parkX0: number;
    parkX1: number;
    parkZ0: number;
    parkZ1: number;
    gas: { name: string; x: number; z: number };
    cliff: { z0: number; z1: number; y: number };
  };
  /** The docks (the prototype's hand placements): quay, rail, container yard, cranes, buildings, roads, gas lot corner. */
  docks: {
    quayZ: number;
    railZ0: number;
    railZ1: number;
    railX1: number;
    yard: { x0: number; z0: number; x1: number; z1: number };
    containerCols: number;
    containerRows: number;
    containers: { asset: string; x0: number; z0: number; dx: number; dz: number; stackMax: number };
    craneAsset: string;
    cranes: { x: number; z: number }[];
    buildings: { asset: string; x: number; z: number; facing: 'N' | 'S' | 'E' | 'W' }[];
    street: { x0: number; x1: number; z0: number };
    lanes: { x0: number; x1: number; z0: number; z1: number }[];
    gas: { name: string; x: number; z: number };
  };
  /** The beach: sand strips `sandStep` wide down to shore(x) = shoreZ + crescent * sin(pi (x - x0) / (x1 - x0)). */
  beach: {
    x0: number;
    x1: number;
    boardwalkZ0: number;
    boardwalkZ1: number;
    sandY: number;
    sandStep: number;
    shoreZ: number;
    crescent: number;
    bars: { assets: string[]; x0: number; x1: number; slot: number; every: number; gap: number };
    hotels: { x0: number; x1: number; maxD: number; gap: number };
    ferrisWheel: { asset: string; x: number; z: number };
  };
  /** Old Harbor: quay, pier, breakwater (with an arm back to the quay), lighthouse, marina, Quay Street, the alley, three rows. */
  harbor: {
    quayZ: number;
    x0: number;
    x1: number;
    pierX: number;
    pierWidth: number;
    pierZ0: number;
    breakwater: { x0: number; x1: number; z0: number; z1: number; armX0: number };
    lighthouse: { asset: string; name: string; x: number };
    marina: { x0: number; z0: number; x1: number; z1: number; y: number };
    quayStreet: { z0: number; z1: number };
    alley: { z0: number; z1: number };
    rows: { z: number; facing: 'N' | 'S'; maxD: number }[];
  };
  /** The prototype's SPECIAL blocks, keyed "<level>:<k>:<row>". */
  landmarks: {
    hospitals: { name: string; at: string }[];
    gas: { name: string; at: string; side: 'W' | 'E' }[];
    civic: { asset: string; name: string; at: string }[];
    /** A landmark block: filler lots `sideGap` either side of the landmark up to `fillerDepth` deep, a north row behind */
    plaza: { fillerDepth: number; sideGap: number; backGap: number; backMin: number };
  };
  /** The city edges: curved-road segment overlap, backdrop mountain wedges beyond the cliff, the water under the bay. */
  edges: {
    curvedRoadOverlap: number;
    mountains: { depth: number; height: number; thickness: number; spans: [number, number][] };
    /** Below movement fall.outOfBoundsY, so a fall into the bay still respawns */
    water: { top: number; thickness: number; z1: number };
  };
  /** `doorSpacing` must equal config/orders.json `spacing.doorMeters` (the generator and the order picker keep the same gap). */
  pois: { foodPickupCap: number; packagePickupCap: number; target: number; doorSpacing: number };
  /** A lot's door stands `offset` m outside the middle of its facing edge (on the sidewalk) */
  door: { offset: number };
  orderRules: OrderRules;
}

/** config/names.json: the fictional word lists business, household and street names are made from. */
export interface NamesConfig {
  /** First words of business names ("Crumb", "Bayside", ...) */
  first: string[];
  /** Suffixes by catalog kind word ("bakery") or, failing that, by catalog category ("food") */
  kinds: Record<string, string[]>;
  surnames: string[];
  /** Share of business names that lead with a `first` word (the rest lead with a surname) */
  firstWordShare: number;
  /** Random draws a name pattern gets before the Namer moves on to the longer one */
  tries: number;
  /** Household initials ("J. Hartley"), one letter each */
  initials: string;
  streets: {
    /** L0, L1, L2, L3, ridge */
    avenues: string[];
    /** One per cross street, west to east */
    cross: string[];
    quay: string;
    docks: { street: string; lanes: string[] };
    boardwalk: string;
    breakwater: string;
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
  /** Order text: a catalog `poi.items` phrase ("bread and pastries") -> concrete things ("2 baguettes and a sourdough") */
  items: ItemsConfig;
}

export interface ItemsConfig {
  /** Chance an order names a second, different thing ("... and a sourdough") */
  secondChance: number;
  /** Per catalog phrase: up to `max` of each thing, each thing as [singular, plural] */
  phrases: Record<string, { max: number; things: string[][] }>;
}
