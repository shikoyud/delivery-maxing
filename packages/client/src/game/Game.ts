import * as THREE from 'three';
import {
  FixedStepper,
  PlayerSim,
  createPagedPhysicsWorld,
  createPhysicsWorld,
  createWorldFeatureState,
  horizontalLength,
  initRapier,
  lerpVec3,
  movementConfig,
  vec3,
  worldConfig,
  type MapData,
  type PagedPhysicsWorld,
  type PoiTableFile,
  type SimEvent,
  type Vec3,
  type WorldFeatureState,
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
import { buildFeatureMeshes, type FeatureMeshes } from '../render/featureMeshes';
import { CityView } from '../render/city/CityView';
import { buildGreyboxMeshes } from '../render/greyboxMeshes';
import { Renderer, toSun } from '../render/Renderer';
import { mountDebugOverlay, type DebugOverlay } from '../ui/debugOverlay';
import { mountDevPanel, type DevPanel } from '../ui/devPanel';
import { installDebugHooks } from './debugHooks';
import { DeliveryLoop } from './delivery';
import { loadMap, type MapKind } from './mapLoader';
import {
  assignNumbers,
  countOverrides,
  createDebouncedSave,
  createDevSettingsStore,
  type DevSettings,
  type DevSettingsStore,
} from './devSettings';
import { browserStorage, createProgressStore } from './progress';
import { ballInSolid, physicsSphereCast, physicsWallProbe } from './cameraQueries';
import { interpolationStart } from './interpolation';
import type { PerfResult } from './perf';

/** Dev settings are saved this long after the last panel edit (ms). */
const SAVE_DEBOUNCE_MS = 300;

export interface GameOptions {
  debug: boolean;
  /** Show the F3 debug overlay from the start (defaults to `debug`). */
  overlay?: boolean;
  /** Order Board RNG seed (?seed=N); defaults to Date.now(). */
  seed?: number;
  /** Which map to play (?map=): the city by default, or the SP1 greybox. */
  map?: MapKind;
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
  readonly features: FeatureMeshes;
  readonly delivery: DeliveryLoop;
  readonly overlay: DebugOverlay;
  readonly devPanel: DevPanel;
  private readonly progress = createProgressStore(browserStorage());
  readonly chase: ChaseCamera;
  /** Sphere cast of the camera's collision ball against the map (the courier's own collider excluded). */
  private readonly cameraCast: RayCast;
  /** The last ?perf=1 flythrough's result (null until one has finished). */
  perfResult: PerfResult | null = null;
  /** The animated courier, or the capsule when the model failed to load (Review Focus 4). */
  readonly courier: CourierView;
  private prevPosition: Vec3;
  /** Eased chase pivot height above the feet (drops while crouched or sliding). */
  private pivot: number = clientConfig.camera.chase.pivotHeight;
  private lastFrameMs: number | null = null;
  /**
   * When set, takes over each frame (the ?perf=1 flythrough): it is called with the frame's wall clock (ms) before the
   * frame is drawn, input and the simulation do not run, and it moves the player itself (viewpoint()).
   */
  frameDriver: ((nowMs: number) => void) | null = null;
  /** Wall-clock cost (ms) of the last frame's CityView.update; 0 on the greybox. */
  cityUpdateMs = 0;
  private readonly saver = createDebouncedSave(() => this.devStore.save(this.settings), SAVE_DEBOUNCE_MS);
  private running = false;

  private constructor(
    readonly host: HTMLElement,
    readonly opts: GameOptions,
    readonly map: MapData,
    readonly sim: PlayerSim,
    readonly world: WorldFeatureState,
    private readonly settings: DevSettings,
    private readonly devStore: DevSettingsStore,
    model: CourierModel | null,
    /** The city's collider pager (null on the greybox, whose colliders all load at start). */
    readonly pager: PagedPhysicsWorld | null,
    /** The streamed city renderer (null on the greybox). */
    readonly city: CityView | null,
    /** The city's navmesh POI table (null on the greybox): the board's route distances. */
    poiTable: PoiTableFile | null,
  ) {
    this.prevPosition = { ...sim.state.position };
    const chase = this.cfg.camera.chase;
    this.actions = new ActionState(
      this.cfg.input,
      THREE.MathUtils.degToRad(chase.pitchMinDeg),
      THREE.MathUtils.degToRad(chase.pitchMaxDeg),
    );
    this.actions.setLook(map.hub.spawnYaw, 0);
    this.renderer = new Renderer(host, this.cfg.graphics, this.cfg.camera, map.size);
    this.cameraCast = physicsSphereCast(sim.physics, chase.collisionRadius, sim.body.collider);
    this.chase = new ChaseCamera(
      this.renderer.camera,
      this.cfg.camera,
      this.cameraCast,
      { probe: physicsWallProbe(sim.physics, sim.body.collider), courierRadius: () => settings.movement.capsule.radius },
    );
    this.courier = model ?? createCourierPlaceholder(settings.movement.capsule, this.cfg.courier);
    this.renderer.scene.add(this.courier.root);
    this.renderer.scene.add(city ? city.group : buildGreyboxMeshes(map));
    this.features = buildFeatureMeshes(map);
    this.renderer.scene.add(this.features.group);
    this.input = new InputManager(this.renderer.renderer.domElement, this.actions, {
      requirePointerLock: !opts.debug,
    });
    this.delivery = new DeliveryLoop({
      host,
      scene: this.renderer.scene,
      map,
      poiTable,
      cfg: this.cfg,
      actions: this.actions,
      progress: this.progress,
      backpackCapacity: settings.backpackSlots,
      baseSprintSpeed: settings.movement.run.sprintSpeed,
      seed: opts.seed ?? Date.now(),
      now: () => this.time,
      player: () => this.sim.state,
    });
    this.overlay = mountDebugOverlay(host, opts.overlay ?? opts.debug);
    this.devPanel = mountDevPanel(settings, {
      onBackpack: (n) => this.delivery.setBackpackCapacity(n),
      onReset: () => {
        this.saver.cancel(); // a pending save would bring the overrides back
        const fresh = this.devStore.reset();
        assignNumbers(settings.movement as never, fresh.movement as never);
        settings.backpackSlots = fresh.backpackSlots;
        this.delivery.setBackpackCapacity(fresh.backpackSlots);
        this.devPanel.setOverrideCount(0);
      },
      onResetProgress: () => {
        this.delivery.resetProgress();
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
    // The city's models load alongside them; a city that fails to load fails the start (main.ts shows the error).
    const gfx = clientConfig.graphics;
    const [rapier, model, { map, city, view, poiTable }] = await Promise.all([
      initRapier(),
      CourierModel.load(robotUrl, clientConfig.courier),
      loadMap(opts.map ?? 'city').then(async (m) => ({
        ...m,
        view: m.city && m.pieces ? await CityView.load(m.city, m.pieces, clientConfig.city, gfx.shadows ? { toSun, extent: gfx.shadowExtent } : undefined) : null,
      })),
    ]);
    // The city pages its colliders around the player (loaded around the spawn before the first step); the greybox keeps
    // SP1's all-at-once world.
    const pager = city ? createPagedPhysicsWorld(rapier, city, city.chunkSize, worldConfig.physics) : null;
    pager?.update(map.hub.spawn);
    const physics = pager ?? createPhysicsWorld(rapier, map);
    // One deep-cloned movement object shared by PlayerSim and the dev panel; the shared import is never mutated.
    const devStore = createDevSettingsStore(browserStorage());
    const settings = devStore.load();
    const sim = new PlayerSim(physics, map, settings.movement, map.hub.spawn, map.hub.spawnYaw);
    const game = new Game(host, opts, map, sim, createWorldFeatureState(map), settings, devStore, model, pager, view, poiTable);
    if (opts.debug) installDebugHooks(game);
    return game;
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
    // Load the colliders around the target first, so the player never lands in an unloaded chunk (Review Focus 1).
    this.pager?.update(p);
    this.sim.teleport(vec3(p.x, p.y, p.z), vec3(v.x, v.y, v.z));
    this.prevPosition = { ...this.sim.state.position };
    this.courier.snap();
    this.chase.snap();
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
    return ballInSolid(this.sim.physics, { x: p.x, y: p.y, z: p.z }, r, this.sim.body.collider);
  }

  private frame(nowMs: number): void {
    // Long gaps (tab switches) are safe: the stepper runs at most maxStepsPerFrame and drops the rest.
    const dt = this.lastFrameMs === null ? 0 : (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    if (this.frameDriver) {
      this.frameDriver(nowMs);
      this.renderFrame(1, dt, nowMs / 1000);
      return;
    }
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

  /** One fixed simulation tick. */
  private step(): SimEvent[] {
    const before = { ...this.sim.state.position };
    const wasZip = this.sim.state.mode === 'zipline';
    const now = this.time;
    const mods = this.delivery.statModifiers();
    const frame = this.delivery.beforeStep(this.actions.sampleTick());
    // Colliders around the player, before every step (a respawn last tick moved it; the pager loads the new chunks).
    this.pager?.update(this.sim.state.position);
    const events = this.sim.step(frame, mods, this.world, now);
    this.delivery.afterStep(events, this.sim.state.position, now);
    const leftZip = wasZip && this.sim.state.mode !== 'zipline';
    this.prevPosition = interpolationStart(before, this.sim.state.position, events, leftZip);
    if (events.some((e) => e.kind === 'respawned')) {
      // A teleport: no camera sweep, and no turn or animation blend across it.
      this.chase.snap();
      this.courier.snap();
    }
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
    this.chase.update(dt, { x: feet.x, y: pivotY, z: feet.z }, look.yaw, look.pitch, horizontalLength(s.velocity), s);
    if (this.city) {
      const t0 = performance.now();
      this.city.update(feet, this.renderer.camera);
      this.cityUpdateMs = performance.now() - t0;
    }
    this.courier.update(dt, s, feet, horizontalLength(s.velocity));
    this.courier.setPackages(this.delivery.carriedCount());
    this.courier.setHidden(this.chase.courierHidden);
    for (const orb of this.map.boostOrbs) {
      this.features.setOrbVisible(orb.id, this.time >= (this.world.orbAvailableAt.get(orb.id) ?? 0));
    }
    this.features.update(clockSeconds);
    this.delivery.draw(clockSeconds);
    this.renderer.followShadow(feet);
    this.renderer.render();
    this.frames++;
    this.overlay.frame(clockSeconds * 1000, () => ({
      drawCalls: this.renderer.info().calls,
      speed: horizontalLength(s.velocity),
      mode: s.mode,
      onBoard: s.onBoard,
      sprinting: s.sprinting,
      tick: this.tick,
      position: s.position,
    }));
  }
}
