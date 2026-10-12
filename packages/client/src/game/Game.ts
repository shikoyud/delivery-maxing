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
import { eyeHeight, fovForSpeed } from '../render/cameraRig';
import { buildGreyboxMeshes } from '../render/greyboxMeshes';
import { Renderer } from '../render/Renderer';
import { installDebugHooks } from './debugHooks';

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
  private prevPosition: Vec3;
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
    this.renderFrame(this.stepper.alpha);
  }

  /** One fixed simulation tick. */
  private step(): SimEvent[] {
    this.prevPosition = { ...this.sim.state.position };
    const frame = this.actions.sampleTick();
    const events = this.sim.step(frame, NO_MODS, this.world, this.time);
    this.tick++;
    return events;
  }

  private renderFrame(alpha: number): void {
    const s = this.sim.state;
    const feet = lerpVec3(this.prevPosition, s.position, alpha);
    const cam = this.renderer.camera;
    const look = this.actions.look();
    cam.position.set(feet.x, feet.y + eyeHeight(s, this.cfg.camera), feet.z);
    cam.rotation.set(look.pitch, look.yaw, 0);
    const fov = fovForSpeed(horizontalLength(s.velocity), this.cfg.camera);
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.renderer.followShadow(feet);
    this.renderer.render();
    this.frames++;
  }
}
