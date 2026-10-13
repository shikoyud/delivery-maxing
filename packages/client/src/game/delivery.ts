import type * as THREE from 'three';
import {
  NO_MODS,
  ordersConfig,
  playerZones,
  type InputFrame,
  type MapData,
  type MoveMode,
  type PlayerZones,
  type SimEvent,
  type StatModifiers,
  type Vec3,
} from '@dm/shared';
import type { ClientConfig } from '../clientConfig';
import type { ActionState } from '../input/actionState';
import { buildPoiMeshes, type PoiMeshes } from '../render/poiMeshes';
import { Hud } from '../ui/hud';
import { hudModel } from '../ui/hudModel';
import type { ProgressStore, Totals } from './progress';

export interface DeliveryDeps {
  host: HTMLElement;
  scene: THREE.Scene;
  map: MapData;
  cfg: ClientConfig;
  actions: ActionState;
  progress: ProgressStore;
  /** Offer RNG seed (?seed=N, else Date.now()). */
  seed: number;
  /** Sim time (s) and the player's sim state, read when the UI acts between ticks. */
  now(): number;
  player(): { position: Vec3; mode: MoveMode };
}

/**
 * The delivery loop on the client. Transitional (SP3 Task 4): the old order loop is gone and the new one arrives in
 * Task 9, so this only draws the POI markers, tracks the hospital safe zone and shows the totals. Game calls
 * beforeStep → sim.step → afterStep each tick, and draw each frame.
 */
export class DeliveryLoop {
  readonly poiMeshes: PoiMeshes;
  private readonly hud: Hud;
  private readonly totals: Totals;
  private zones: PlayerZones;
  private nextHudAt = 0;

  constructor(private readonly d: DeliveryDeps) {
    this.poiMeshes = buildPoiMeshes(d.map, ordersConfig.zones.poiRadius);
    d.scene.add(this.poiMeshes.group);
    this.hud = new Hud(d.host);
    this.totals = d.progress.load();
    this.zones = playerZones(d.player().position, d.map, ordersConfig.zones);
  }

  /** Id of the hospital whose safe zone the player is in, or null. */
  get safeZone(): string | null {
    return this.zones.safeZone;
  }

  /** Packages the courier is carrying now. */
  carriedCount(): number {
    return 0;
  }

  statModifiers(): StatModifiers {
    return NO_MODS;
  }

  /** The input the sim sees this tick. */
  beforeStep(frame: InputFrame): InputFrame {
    return frame;
  }

  /** After sim.step: refreshes the player's zones (sim events and time feed the order loop again in Task 9). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  afterStep(simEvents: SimEvent[], position: Vec3, now: number): void {
    this.zones = playerZones(position, this.d.map, ordersConfig.zones);
  }

  /** Zeroes Points, Coins and deliveries in storage and in the running totals (dev panel). */
  resetProgress(): void {
    this.totals.points = 0;
    this.totals.coins = 0;
    this.totals.deliveries = 0;
    this.d.progress.save(this.totals);
    this.nextHudAt = 0;
  }

  /** Per frame: the HUD (throttled). */
  draw(clockSeconds: number): void {
    if (clockSeconds < this.nextHudAt) return;
    this.nextHudAt = clockSeconds + 1 / this.d.cfg.ui.hudUpdateHz;
    const safe = this.zones.safeZone;
    const name = safe === null ? null : (this.d.map.hospitals.find((h) => h.id === safe)?.name ?? safe);
    this.hud.update(hudModel(this.totals, name));
  }
}
