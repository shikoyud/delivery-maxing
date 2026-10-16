import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  FixedStepper,
  Garage,
  PlayerSim,
  createPagedPhysicsWorld,
  createPhysicsWorld,
  defaultGarage,
  RIDE_TIERS,
  findRoadSpot,
  horizontalLength,
  initRapier,
  lerpVec3,
  movementConfig,
  vec3,
  worldConfig,
  type CatalogIndex,
  type CityMap,
  type DistanceTable,
  type MapData,
  type NavRouter,
  type RideTier,
  type SimEvent,
  type Vec3,
} from '@dm/shared';
import { clientConfig, type ClientConfig } from '../clientConfig';
import { ActionState } from '../input/actionState';
import { InputManager } from '../input/InputManager';
import { easeToward } from '../render/cameraRig';
import robotUrl from '../../../../assets/models/RobotExpressive.glb?url';
import { ChaseCamera, clampPivotHeight, pivotHeightFor, type RayCast } from '../render/chaseCamera';
import { CourierModel } from '../render/courier/CourierModel';
import type { CourierView } from '../render/courier/CourierView';
import { createCourierPlaceholder } from '../render/courierPlaceholder';
import { buildGreyboxMeshes } from '../render/greyboxMeshes';
import { buildBlockMeshes } from '../render/city/blockMeshes';
import { CityView } from '../render/city/CityView';
import { ModelLoader } from '../render/city/modelLoader';
import { packManifest } from '../render/city/packManifest';
import { buildAccessZoneMeshes } from '../render/accessZoneMeshes';
import { buildGasStationMeshes } from '../render/gasStationMeshes';
import { buildHospitalMeshes } from '../render/hospitalMeshes';
import { VehicleViews } from '../render/vehicles/VehicleViews';
import { CAR_MODEL_ID } from '../render/vehicles/vehicleMeshes';
import { Renderer } from '../render/Renderer';
import { mountDebugOverlay, type DebugOverlay } from '../ui/debugOverlay';
import { mountDevPanel, type DevPanel } from '../ui/devPanel';
import { installDebugHooks } from './debugHooks';
import { DeliveryLoop } from './delivery';
import {
  assignNumbers,
  countOverrides,
  createDebouncedSave,
  createDevSettingsStore,
  type DevSettings,
  type DevSettingsStore,
} from './devSettings';
import { browserStorage, createProgressStore, saveWhenLeaving, type ProgressStore } from './progress';
import { ballInSolid, physicsSphereCast, physicsWallProbe, type CameraExclude } from './cameraQueries';
import { interpolationStart } from './interpolation';
import { loadMap, type MapKind } from './mapLoader';
import { garageRows } from '../ui/phone/garageApp';

/** Dev settings are saved this long after the last panel edit (ms). */
const SAVE_DEBOUNCE_MS = 300;

export interface GameOptions {
  debug: boolean;
  /** Show the F3 debug overlay from the start (defaults to `debug`). */
  overlay?: boolean;
  /** Offer RNG seed (?seed=N); defaults to Date.now(). */
  seed?: number;
  /** Which map to play (?map=); the city by default. */
  map?: MapKind;
}

/** The catalog (the city's lots, the pack car) and, on the city, the build-time offer distances. */
interface MapExtras {
  catalog: CatalogIndex;
  distances: DistanceTable | null;
}

/**
 * The single-player game: fixed-step simulation (movementConfig.tickRate) with interpolated rendering.
 * Each animation frame runs the due ticks (tick()), then draws (renderFrame()).
 */
export class Game {
  readonly cfg: ClientConfig = clientConfig;
  readonly stepper = new FixedStepper(movementConfig.tickRate, movementConfig.maxStepsPerFrame);
  readonly actions: ActionState;
  readonly input: InputManager;
  readonly renderer: Renderer;
  /** Simulation ticks run so far; sim time is tick / tickRate. */
  tick = 0;
  /** Frames drawn so far. */
  frames = 0;
  readonly delivery: DeliveryLoop;
  readonly overlay: DebugOverlay;
  readonly devPanel: DevPanel;
  private readonly progress: ProgressStore;
  readonly chase: ChaseCamera;
  /** The colliders the camera looks through: the courier's, plus the ridden vehicle's. */
  private readonly cameraExclude: CameraExclude;
  /** Sphere cast of the camera's collision ball against the map (the courier's own collider excluded). */
  private readonly cameraCast: RayCast;
  /** The animated courier, or the capsule when the model failed to load (Review Focus 4). */
  readonly courier: CourierView;
  /** The owned vehicles' placeholders (the pack car once loaded), interpolated like the courier. */
  readonly vehicles: VehicleViews;
  /** The runtime pack models (public/packs/, git-ignored; boxes and placeholders without them). */
  readonly models: ModelLoader;
  /** The city's regions, blocks and pack models; null on the greybox. */
  readonly cityView: CityView | null = null;
  /** Access-zone volumes, shown with the F3 overlay. */
  private readonly accessZones: THREE.Group;
  private prevPosition: Vec3;
  /** Scratch vector for the camera's yaw (the HUD arrow). */
  private readonly camDir = new THREE.Vector3();
  /** Eased chase pivot height above the feet (drops while crouched or sliding). */
  private pivot: number = clientConfig.camera.chase.pivotHeight;
  private lastFrameMs: number | null = null;
  private readonly saver = createDebouncedSave(() => this.devStore.save(this.settings), SAVE_DEBOUNCE_MS);
  private running = false;
  /** Called after the phone opened or closed (main.ts refreshes the play hint from it). */
  onPhoneChanged: ((open: boolean) => void) | null = null;

  private constructor(
    readonly host: HTMLElement,
    readonly opts: GameOptions,
    readonly map: MapData,
    readonly sim: PlayerSim,
    /** Paths on the five per-tier navmeshes. */
    readonly nav: NavRouter,
    private readonly settings: DevSettings,
    private readonly devStore: DevSettingsStore,
    model: CourierModel | null,
    progress: ProgressStore,
    extras: MapExtras,
  ) {
    this.progress = progress;
    this.prevPosition = { ...sim.state.position };
    const chase = this.cfg.camera.chase;
    this.actions = new ActionState(
      this.cfg.input,
      THREE.MathUtils.degToRad(chase.pitchMinDeg),
      THREE.MathUtils.degToRad(chase.pitchMaxDeg),
    );
    this.actions.setLook(map.hospitals[0]!.spawnYaw, 0);
    this.renderer = new Renderer(host, this.cfg.graphics, this.cfg.camera, map.size);
    // The camera looks through the courier and the vehicle it rides; a parked vehicle blocks it like any solid.
    const exclude: CameraExclude = () => {
      const t = sim.state.riding;
      return t ? [sim.body.collider, sim.garage.body(t).collider] : [sim.body.collider];
    };
    this.cameraExclude = exclude;
    this.cameraCast = physicsSphereCast(sim.physics, chase.collisionRadius, exclude);
    this.chase = new ChaseCamera(
      this.renderer.camera,
      this.cfg.camera,
      this.cameraCast,
      { probe: physicsWallProbe(sim.physics, exclude), courierRadius: () => settings.movement.capsule.radius },
    );
    this.courier = model ?? createCourierPlaceholder(settings.movement.capsule, this.cfg.courier);
    this.renderer.scene.add(this.courier.root);
    this.models = new ModelLoader(`${import.meta.env.BASE_URL}${this.cfg.city.modelsBase}`, new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), {
      manifest: packManifest,
    });
    if (map.kind === 'city') {
      // The city (city design §7.2–§7.3): code-built regions and every lot as a category-coloured box, shown within
      // city.lodRadii[2], with the pack models swapped in nearer when public/packs/ has them.
      const city = map as CityMap;
      const sun = this.renderer.sunDirection();
      this.cityView = CityView.create(city, extras.catalog, buildBlockMeshes(city, extras.catalog), this.cfg.city, this.models, {
        extent: this.cfg.graphics.shadowExtent,
        slope: Math.hypot(sun.x, sun.z) / sun.y,
      });
      this.renderer.scene.add(this.cityView.group);
    } else {
      this.renderer.scene.add(buildGreyboxMeshes(map));
    }
    this.renderer.scene.add(buildHospitalMeshes(map));
    this.renderer.scene.add(buildGasStationMeshes(map));
    this.accessZones = buildAccessZoneMeshes(map);
    this.renderer.scene.add(this.accessZones);
    this.vehicles = new VehicleViews(
      this.renderer.scene,
      extras.catalog.has(CAR_MODEL_ID) ? { loader: this.models, car: extras.catalog.get(CAR_MODEL_ID) } : undefined,
    );
    this.input = new InputManager(this.renderer.renderer.domElement, this.actions, {
      requirePointerLock: !opts.debug,
    });
    this.delivery = new DeliveryLoop({
      host,
      scene: this.renderer.scene,
      map,
      cfg: this.cfg,
      actions: this.actions,
      progress: this.progress,
      seed: opts.seed ?? Date.now(),
      now: () => this.time,
      player: () => this.sim.state,
      rider: () => ({
        riding: this.sim.state.riding,
        lastRide: this.sim.state.lastRide,
        speed: horizontalLength(this.sim.state.velocity),
        mountCandidate: () => this.sim.mountCandidate(),
      }),
      // Order distances stay on-foot paths: the timers' reference speed is the on-foot sprint (spec §3.2).
      distance: (a, b) => nav.distance('walk', a, b),
      ...(extras.distances ? { table: extras.distances } : {}),
      router: nav,
      cameraYaw: () => {
        const d = this.renderer.camera.getWorldDirection(this.camDir);
        return Math.atan2(-d.x, -d.z);
      },
      stamina: () => this.sim.state.stamina / settings.movement.stamina.max,
      phoneChanged: (open) => this.phoneChanged(open),
      vehicles: {
        // Rows and summon both measure from the feet on the ground (an airborne courier's last grounded position).
        rows: (now) => garageRows(sim.garage, sim.state.grounded ? sim.state.position : sim.state.lastGrounded, now),
        state: (t) => sim.garage.state(t),
        summon: (t, now) => {
          const s = sim.state;
          const at = s.grounded ? s.position : s.lastGrounded;
          const result = sim.garage.summon(t, at, now, (tier) => findRoadSpot(nav, sim.garage, tier, at, s.heading));
          this.vehicles.snap(); // drawn at its new spot, not swept across the map
          return result;
        },
        snapshot: () => sim.garage.snapshot(),
        respawn: () => {
          const events = sim.respawnAtHospital();
          this.afterTeleport();
          return events;
        },
      },
    });
    this.overlay = mountDebugOverlay(host, opts.overlay ?? opts.debug);
    this.devPanel = mountDevPanel(settings, {
      onReset: () => {
        this.saver.cancel(); // a pending save would bring the overrides back
        const fresh = this.devStore.reset();
        assignNumbers(settings.movement as never, fresh.movement as never);
        this.devPanel.setOverrideCount(0);
      },
      onResetProgress: () => {
        this.resetGarage();
        this.delivery.resetProgress();
      },
      vehicles: {
        owned: (t) => sim.garage.owned().includes(t),
        riding: () => sim.state.riding,
        setOwned: (t, owned) => this.setOwned(t, owned),
        fillTanks: () => this.fillTanks(),
        addCoins: (n) => this.delivery.setCoins(this.delivery.orders.totals.coins + n),
      },
      onChange: () => {
        this.saver.schedule();
        this.devPanel.setOverrideCount(countOverrides(settings));
      },
    });
    this.devPanel.setOverrideCount(countOverrides(settings));
    this.actions.onUiKey = (name) => {
      if (name === 'debugOverlay') this.overlay.toggle();
      else this.toggleDevPanel();
    };
  }

  /**
   * The phone opened or closed (Tab, Esc). Open: the pointer lock is released so the player can click the phone
   * (DeliveryLoop already released held keys). Closed: ask for the lock back — browsers may refuse without a click
   * (Esc gives no user activation), and then a click on the canvas locks it as usual.
   */
  private phoneChanged(open: boolean): void {
    const canvas = this.renderer.renderer.domElement;
    if (open) {
      if (this.input.locked) this.host.ownerDocument.exitPointerLock();
    } else if (!this.opts.debug && !this.input.locked) {
      void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
    }
    this.onPhoneChanged?.(open);
  }

  /** Opens or closes the dev panel; opening releases held keys and the pointer lock so the mouse can use it. */
  private toggleDevPanel(): void {
    this.devPanel.toggle();
    if (this.devPanel.isOpen) {
      this.actions.releaseAll();
      if (this.input.locked) this.host.ownerDocument.exitPointerLock();
    }
  }

  static async create(host: HTMLElement, opts: GameOptions): Promise<Game> {
    // The model loads alongside physics; a missing or broken file falls back to the capsule with one warning.
    // The navmeshes (recast WASM and five binaries) load alongside too.
    // The map (the city's layout fetched and expanded), its navmeshes and the city's distance table load alongside too.
    const [rapier, model, loaded] = await Promise.all([
      initRapier(),
      CourierModel.load(robotUrl, clientConfig.courier),
      loadMap(opts.map ?? 'city'),
    ]);
    const { map, nav } = loaded;
    // The city pages its colliders by chunk around the player (world config); the greybox keeps every collider.
    const physics =
      map.kind === 'city' ? createPagedPhysicsWorld(rapier, map, map.chunkSize, worldConfig.physics) : createPhysicsWorld(rapier, map);
    // One deep-cloned movement object shared by PlayerSim and the dev panel; the shared import is never mutated.
    const devStore = createDevSettingsStore(browserStorage());
    const settings = devStore.load();
    // Hospitals are the only spawn points (spec rev. 2); a fresh session starts at the first one.
    // On the city that is Bayview General (the layout lists it first); the colliders around it load before anything
    // touches physics (the garage parks at its bay, the courier spawns on its avenue).
    const spawn = map.hospitals[0];
    if (!spawn) throw new Error('map has no hospitals');
    physics.update?.(spawn.spawn);
    // Every vehicle owned and parked at the first hospital's bay (the skateboard carried) until saves load a garage.
    const progress = createProgressStore(browserStorage(), () => defaultGarage(map));
    const saved = progress.load();
    const garage = new Garage(physics, map, saved.garage);
    const sim = new PlayerSim(physics, map, settings.movement, spawn.spawn, spawn.spawnYaw, garage);
    // The tier last ridden (capacity and offers follow it), only while it is still owned.
    sim.state.lastRide = saved.lastRide && garage.owned().includes(saved.lastRide) ? saved.lastRide : null;
    const extras = { catalog: loaded.catalog, distances: loaded.distances };
    const game = new Game(host, opts, map, sim, nav, settings, devStore, model, progress, extras);
    // Closing or hiding the tab mid-ride keeps the vehicle's spot and the fuel it burnt.
    saveWhenLeaving(window, document, () => game.delivery.save());
    if (opts.debug) installDebugHooks(game);
    return game;
  }

  /** Which map is loaded. */
  get mapKind(): MapKind {
    return this.map.kind;
  }

  /** The collider chunks loaded around the player (the city's paged physics); empty on the greybox. */
  loadedChunks(): string[] {
    return [...(this.sim.physics.loadedChunks?.() ?? [])];
  }

  /** The city's paged physics loads the chunks around the player (a no-op on the greybox, whose colliders all exist). */
  private pageAround(p: Vec3): void {
    this.sim.physics.update?.(p);
  }

  get time(): number {
    return this.tick / movementConfig.tickRate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (nowMs: number): void => {
      if (!this.running) return;
      this.frame(nowMs);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  /** Moves the player (airborne, at velocity `v`, zero by default) and resets interpolation so the camera doesn't sweep. */
  teleport(p: Vec3, v: Vec3 = { x: 0, y: 0, z: 0 }): void {
    this.sim.teleport(vec3(p.x, p.y, p.z), vec3(v.x, v.y, v.z));
    this.pageAround(this.sim.state.position);
    this.prevPosition = { ...this.sim.state.position };
    this.courier.snap();
    this.chase.snap();
    this.vehicles.snap();
  }

  /**
   * Dev panel: buys or removes `t`. The vehicle being ridden cannot be removed (refused, false): the courier gets off
   * first. A bought one parks at the first free bay slot with a full tank. Saved.
   */
  setOwned(t: RideTier, owned: boolean): boolean {
    if (!owned && this.sim.state.riding === t) return false;
    this.sim.garage.setOwned(t, owned, this.map.hospitals[0]!);
    if (!owned && this.sim.state.lastRide === t) this.sim.state.lastRide = null;
    this.vehicles.snap();
    this.delivery.save();
    return true;
  }

  /** Dev panel: every owned tank full. Saved. */
  private fillTanks(): void {
    for (const t of this.sim.garage.owned()) this.sim.garage.state(t).fuel = 1;
    this.delivery.save();
  }

  /**
   * Dev panel "Reset progress": the courier gets off and every vehicle is bought afresh (the default garage: the bay
   * slots in order, full tanks), no last ride, summon ready.
   */
  private resetGarage(): void {
    this.sim.leaveRide();
    const g = this.sim.garage;
    const hospital = this.map.hospitals[0]!;
    for (const t of RIDE_TIERS) g.setOwned(t, false, hospital);
    for (const t of RIDE_TIERS) g.setOwned(t, true, hospital);
    g.summonReadyAt = 0;
    this.sim.state.lastRide = null;
    this.vehicles.snap();
  }

  /** Debug API: parks `tier` next to the player (owning it first) and mounts it. */
  rideNow(tier: RideTier): void {
    const g = this.sim.garage;
    if (!g.owned().includes(tier)) this.setOwned(tier, true);
    // Park ahead of the courier by half the mount radius (leaves any current ride first).
    this.sim.rideNow(tier, g.cfg.riding.mountRadius / 2);
    this.afterTeleport();
    this.delivery.save();
  }

  /**
   * Whether any part of the camera's near plane is inside a map solid (tests: the chase camera must never be): a ball
   * around the camera reaching the near-plane corners at the current FOV and aspect.
   */
  cameraInsideSolid(): boolean {
    const cam = this.renderer.camera;
    const halfH = cam.near * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const r = Math.hypot(cam.near, halfH, halfH * cam.aspect);
    const p = cam.position;
    return ballInSolid(this.sim.physics, { x: p.x, y: p.y, z: p.z }, r, this.cameraExclude);
  }

  private frame(nowMs: number): void {
    // Long gaps (tab switches) are safe: the stepper runs at most maxStepsPerFrame and drops the rest.
    const dt = this.lastFrameMs === null ? 0 : (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    const steps = this.stepper.advance(dt);
    for (let i = 0; i < steps; i++) this.step();
    this.renderFrame(this.stepper.alpha, dt, nowMs / 1000);
  }

  /**
   * Moves the player to `feet`, turns the courier toward `target` and orbits the chase camera behind it, looking at
   * `target` (screenshots and tests).
   */
  viewpoint(feet: Vec3, target: Vec3): void {
    const dx = target.x - feet.x;
    const dz = target.z - feet.z;
    const dy = target.y - (feet.y + this.cfg.camera.chase.pivotHeight + this.cfg.camera.chase.height);
    const yaw = Math.atan2(-dx, -dz);
    this.sim.state.heading = yaw;
    this.teleport(feet);
    this.actions.setLook(yaw, Math.atan2(dy, Math.hypot(dx, dz)));
  }

  /**
   * Debug and tests: runs `ticks` fixed simulation ticks now, synchronously and without drawing (the render loop
   * carries on afterwards). Returns the player's horizontal speed after each tick.
   */
  advanceTicks(ticks: number): number[] {
    const speeds: number[] = [];
    for (let i = 0; i < ticks; i++) {
      this.step();
      speeds.push(horizontalLength(this.sim.state.velocity));
    }
    return speeds;
  }

  /**
   * After a respawn: no camera sweep, and no turn or animation blend across it. The camera looks the way the
   * respawned courier faces (the hospital's spawnYaw).
   */
  private afterTeleport(): void {
    this.pageAround(this.sim.state.position);
    this.prevPosition = { ...this.sim.state.position };
    this.actions.setLook(this.sim.state.heading, this.actions.look().pitch);
    this.chase.snap();
    this.courier.snap();
    this.vehicles.snap();
  }

  /** One fixed simulation tick. */
  private step(): SimEvent[] {
    const before = { ...this.sim.state.position };
    const now = this.time;
    const mods = this.delivery.statModifiers();
    const frame = this.delivery.beforeStep(this.actions.sampleTick());
    this.vehicles.beforeStep(this.sim.garage);
    this.pageAround(this.sim.state.position);
    const events = this.sim.step(frame, mods, now);
    this.delivery.afterStep(events, this.sim.state.position, now);
    this.prevPosition = interpolationStart(before, this.sim.state.position, events);
    if (events.some((e) => e.kind === 'respawned')) this.afterTeleport();
    this.tick++;
    return events;
  }

  private renderFrame(alpha: number, dt: number, clockSeconds: number): void {
    const s = this.sim.state;
    const cc = this.cfg.camera;
    const feet = lerpVec3(this.prevPosition, s.position, alpha);
    const look = this.actions.look();
    this.pivot = easeToward(this.pivot, pivotHeightFor(s, cc.chase), dt, cc.crouchEaseRate);
    const pivotY = feet.y + clampPivotHeight(feet, this.pivot, this.cameraCast, cc.chase);
    this.chase.update(dt, { x: feet.x, y: pivotY, z: feet.z }, look.yaw, look.pitch, horizontalLength(s.velocity), s.riding);
    this.delivery.setCamera(this.renderer.camera.position);
    this.cityView?.update(feet, this.renderer.camera);
    this.vehicles.update(this.sim.garage, alpha);
    this.accessZones.visible = this.overlay.visible;
    this.courier.update(dt, s, feet, horizontalLength(s.velocity));
    this.courier.setPackages(this.delivery.carriedCount());
    this.courier.setHidden(this.chase.courierHidden);
    this.delivery.draw(clockSeconds);
    this.renderer.followShadow(feet);
    this.renderer.render();
    this.frames++;
    this.overlay.frame(clockSeconds * 1000, () => ({
      drawCalls: this.renderer.info().calls,
      speed: horizontalLength(s.velocity),
      mode: s.mode,
      riding: s.riding,
      fuel: s.riding && this.sim.garage.cfg.rides[s.riding].fuel ? this.sim.garage.state(s.riding).fuel : null,
      sprinting: s.sprinting,
      tick: this.tick,
      position: s.position,
    }));
  }
}
