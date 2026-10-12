import * as THREE from 'three';
import {
  FixedStepper,
  NO_MODS,
  PlayerSim,
  createPhysicsWorld,
  createWorldFeatureState,
  expandGreybox,
  horizontalLength,
  initRapier,
  lerpVec3,
  movementConfig,
  vec3,
  type GreyboxSource,
  type MapData,
  type SimEvent,
  type Vec3,
  type WorldFeatureState,
} from '@dm/shared';
import greyboxJson from '../../../../map/greybox.json';
import { clientConfig, type ClientConfig } from '../clientConfig';
import { ActionState } from '../input/actionState';
import { InputManager } from '../input/InputManager';
import { easeToward, eyeHeight, fovForSpeed, rollForWallRun } from '../render/cameraRig';
import { buildFeatureMeshes, type FeatureMeshes } from '../render/featureMeshes';
import { buildGreyboxMeshes } from '../render/greyboxMeshes';
import { Renderer } from '../render/Renderer';
import { installDebugHooks } from './debugHooks';
import { interpolationStart } from './interpolation';

export interface GameOptions {
  debug: boolean;
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
  private prevPosition: Vec3;
  private camRoll = 0;
  private lastFrameMs: number | null = null;
  private running = false;

  private constructor(
    readonly host: HTMLElement,
    readonly opts: GameOptions,
    readonly map: MapData,
    readonly sim: PlayerSim,
    readonly world: WorldFeatureState,
  ) {
    this.prevPosition = { ...sim.state.position };
    const pitchLimit = THREE.MathUtils.degToRad(this.cfg.camera.pitchLimitDeg);
    this.actions = new ActionState(this.cfg.input, pitchLimit);
    this.actions.setLook(map.hub.spawnYaw, 0);
    this.renderer = new Renderer(host, this.cfg.graphics, this.cfg.camera, map.size);
    this.renderer.scene.add(buildGreyboxMeshes(map));
    this.features = buildFeatureMeshes(map);
    this.renderer.scene.add(this.features.group);
    this.input = new InputManager(this.renderer.renderer.domElement, this.actions, {
      requirePointerLock: !opts.debug,
    });
  }

  static async create(host: HTMLElement, opts: GameOptions): Promise<Game> {
    const rapier = await initRapier();
    const map = expandGreybox(greyboxJson as GreyboxSource);
    const physics = createPhysicsWorld(rapier, map);
    const sim = new PlayerSim(physics, map, movementConfig, map.hub.spawn, map.hub.spawnYaw);
    const game = new Game(host, opts, map, sim, createWorldFeatureState(map));
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

  /** Moves the player (airborne, zero velocity) and resets interpolation so the camera doesn't sweep. */
  teleport(p: Vec3): void {
    this.sim.teleport(vec3(p.x, p.y, p.z));
    this.prevPosition = { ...this.sim.state.position };
  }

  private frame(nowMs: number): void {
    // Long gaps (tab switches) are safe: the stepper runs at most maxStepsPerFrame and drops the rest.
    const dt = this.lastFrameMs === null ? 0 : (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    const steps = this.stepper.advance(dt);
    for (let i = 0; i < steps; i++) this.step();
    this.renderFrame(this.stepper.alpha, dt, nowMs / 1000);
  }

  /** Moves the player to `feet` on the ground and points the camera at `target` (screenshots and tests). */
  viewpoint(feet: Vec3, target: Vec3): void {
    this.teleport(feet);
    const dx = target.x - feet.x;
    const dz = target.z - feet.z;
    const dy = target.y - (feet.y + this.cfg.camera.eyeHeight);
    this.actions.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }

  /** One fixed simulation tick. */
  private step(): SimEvent[] {
    const before = { ...this.sim.state.position };
    const frame = this.actions.sampleTick();
    const events = this.sim.step(frame, NO_MODS, this.world, this.time);
    this.prevPosition = interpolationStart(before, this.sim.state.position, events);
    this.tick++;
    return events;
  }

  private renderFrame(alpha: number, dt: number, clockSeconds: number): void {
    const s = this.sim.state;
    const cc = this.cfg.camera;
    const feet = lerpVec3(this.prevPosition, s.position, alpha);
    const cam = this.renderer.camera;
    const look = this.actions.look();
    // Roll is clockwise-positive (see rollForWallRun); three's rotation.z is counter-clockwise-positive.
    this.camRoll = easeToward(this.camRoll, rollForWallRun(s, cc), dt, cc.rollEaseRate);
    cam.position.set(feet.x, feet.y + eyeHeight(s, cc), feet.z);
    cam.rotation.set(look.pitch, look.yaw, -this.camRoll);
    const fov = easeToward(cam.fov, fovForSpeed(horizontalLength(s.velocity), cc), dt, cc.fovEaseRate);
    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    for (const orb of this.map.boostOrbs) {
      this.features.setOrbVisible(orb.id, this.time >= (this.world.orbAvailableAt.get(orb.id) ?? 0));
    }
    this.features.update(clockSeconds);
    this.renderer.followShadow(feet);
    this.renderer.render();
    this.frames++;
  }
}
