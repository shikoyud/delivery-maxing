import * as THREE from 'three';
import {
  OrderSystem,
  StreetGraph,
  ThiefSystem,
  addEpochPoints,
  buildPoiInfo,
  emptyInput,
  movementConfig,
  mulberry32,
  navDistanceTable,
  ordersConfig,
  playerZones,
  penalizeEpoch,
  reachablePois,
  streetDistanceTable,
  thievesConfig,
  type AcceptResult,
  type ActiveOrder,
  type CancelResult,
  type CityMap,
  type DistanceTable,
  type EpochPoints,
  type InputFrame,
  type LineOfSight,
  type MapData,
  type MoveMode,
  type OrderEvent,
  type PlayerZones,
  type PoiInfo,
  type PoiTableFile,
  type SimEvent,
  type StatModifiers,
  type ThiefEvent,
  type ThiefState,
  type Vec3,
} from '@dm/shared';
import type { ClientConfig } from '../clientConfig';
import { buildHubMeshes, type HubMeshes } from '../render/hubMeshes';
import { buildWaypoints, type Waypoints } from '../render/waypoints';
import { toSun } from '../render/Renderer';
import { esc, keyLabel } from '../ui/dom';
import { Hud } from '../ui/hud';
import { MODIFIER_LABEL, hudModel, poiIndex, pointsText, robbedText, stageText } from '../ui/hudModel';
import { OrderBoardView, refreshGuardLeft } from '../ui/orderBoard';
import { SlotColorAssigner } from '../ui/slotColors';
import { Popups } from '../ui/popups';
import type { ActionState } from '../input/actionState';
import type { ProgressStore } from './progress';

export interface DeliveryDeps {
  host: HTMLElement;
  scene: THREE.Scene;
  map: MapData;
  /** The city's navmesh POI table; null on the greybox (street distances). */
  poiTable: PoiTableFile | null;
  cfg: ClientConfig;
  actions: ActionState;
  progress: ProgressStore;
  /** Starting backpack capacity and base sprint speed (dev tuning); default to the config values. */
  backpackCapacity?: number;
  baseSprintSpeed?: number;
  /** The city placement file: its streets carry the thieves (spec §7.3). Null on the greybox, which has no streets. */
  city: CityMap | null;
  /** Thief line of sight (the host raycasts its world, the courier's own collider excluded). */
  lineOfSight: LineOfSight;
  /** Board RNG seed (?seed=N, else Date.now()); the thieves' random stream is derived from it. */
  seed: number;
  /** Wall-clock UTC ms (default Date.now): reward epochs follow it, not sim time (spec §9.4 step 1). */
  clock?: () => number;
  /** Sim time (s) and the player's sim state, read when the UI acts between ticks. */
  now(): number;
  player(): { position: Vec3; mode: MoveMode };
}

/**
 * The board candidates and route distances for a map: on the city, the navmesh table, the city bands and only the
 * POIs that passed the build-time reachability check (spec §5.3); on the greybox (no table), SP1's street distances
 * and the greybox bands.
 */
export function orderDistances(map: MapData, poiTable: PoiTableFile | null): { pois: PoiInfo[]; distances: DistanceTable } {
  if (poiTable) {
    const distances = navDistanceTable(poiTable);
    return { pois: buildPoiInfo({ pois: reachablePois(map, poiTable) }, distances, ordersConfig.bands.city), distances };
  }
  const distances = streetDistanceTable(map);
  return { pois: buildPoiInfo(map, distances, ordersConfig.bands.greybox), distances };
}

/** Mixed into the board seed for the thieves' random stream, so it differs from the board's but stays reproducible. */
const THIEF_SEED_SALT = 0x7417;

const BONUS_LINE = { express: 'Express on time', fragile: 'Fragile intact', heavy: 'Heavy package', par: 'Within par' } as const;
const BONUS_KEY = { express: 'expressOnTime', fragile: 'fragileIntact', heavy: 'heavy', par: 'withinPar' } as const;

/**
 * The delivery loop on the client (spec §3, §11): owns the OrderSystem, the street thieves (city only), local progress
 * (lifetime totals and current-epoch points), the HUB/POI markers, waypoint beams, the HUD, popups and the Order Board.
 * Game calls beforeStep → sim.step → afterStep each tick, and draw each frame.
 */
export class DeliveryLoop {
  readonly orders: OrderSystem;
  /** The street thieves (spec §7.3); null on the greybox. */
  readonly thieves: ThiefSystem | null;
  /** Delivery Points earned in the current reward epoch (local; plan assumption 12). */
  private epoch: EpochPoints;
  private readonly clock: () => number;
  /** The thieves' streets, built on first use by placeThief (tests only). */
  private streets: StreetGraph | null = null;
  readonly board: OrderBoardView;
  readonly hubMeshes: HubMeshes;
  readonly waypoints: Waypoints;
  private readonly hud: Hud;
  private readonly popups: Popups;
  private zones: PlayerZones = { inPlaza: false, inDropZone: false, poiIds: new Set() };
  private nextHudAt = 0;
  private readonly modalListeners: (() => void)[] = [];
  private readonly caughtListeners: ((thiefId: string) => void)[] = [];
  /** Sim time of the last board refresh (null before the first): Accept clicks wait out the guard after it (R28). */
  private boardRefreshedAt: number | null = null;
  private readonly colors = new SlotColorAssigner();
  private readonly colorIndex = (id: string): number => this.colors.indexOf(id);

  constructor(private readonly d: DeliveryDeps) {
    this.clock = d.clock ?? Date.now;
    const progress = d.progress.load(this.clock());
    this.epoch = progress.epoch;
    this.orders = new OrderSystem(
      {
        ...orderDistances(d.map, d.poiTable),
        cfg: ordersConfig,
        baseSprintSpeed: d.baseSprintSpeed ?? movementConfig.run.sprintSpeed,
        rng: mulberry32(d.seed),
        unlocks: { express: true, chain: true },
        backpackCapacity: d.backpackCapacity ?? ordersConfig.backpack.baseSlots,
        totals: progress.totals,
      },
      d.now(),
    );
    this.thieves = d.city ? new ThiefSystem(d.city, thievesConfig, mulberry32(d.seed ^ THIEF_SEED_SALT)) : null;
    const gfx = d.cfg.graphics;
    this.hubMeshes = buildHubMeshes(d.map, ordersConfig.zones.poiRadius, {
      drawRadius: d.cfg.poiMarkers.drawRadius,
      shadow: gfx.shadows ? { toSun, extent: gfx.shadowExtent } : null,
    });
    this.waypoints = buildWaypoints(ordersConfig.backpack.maxSlots, d.cfg.ui.waypointPulseHz);
    d.scene.add(this.hubMeshes.group, this.waypoints.mesh);
    this.hud = new Hud(d.host, d.cfg.ui);
    this.popups = new Popups(d.host, d.cfg.ui.popupSeconds, d.cfg.ui.maxPopups);
    this.board = new OrderBoardView(
      d.host,
      d.map,
      ordersConfig,
      {
        // A click right after a refresh may be meant for the old card: ignore it while the board flashes.
        accept: (id) => {
          if (this.refreshGuardLeft() === 0) void this.accept(id);
        },
        cancel: (id) => void this.cancel(id),
        closed: () => {
          // Keys pressed while the board was open must not count as held when play resumes.
          d.actions.releaseAll();
          this.emitModal();
        },
      },
      ['Escape', ...d.cfg.input.bindings.interact],
    );
    this.zones = playerZones(d.player().position, d.map, ordersConfig.zones);
  }

  get modalOpen(): boolean {
    return this.board.isOpen;
  }

  /** Called when the Order Board opens or closes (main.ts hides the "click to play" hint while it is open). */
  onModalChange(fn: () => void): void {
    this.modalListeners.push(fn);
  }

  /** Called with the thief's id when a thief catches the courier (ThiefView plays its punch). */
  onThiefCaught(fn: (thiefId: string) => void): void {
    this.caughtListeners.push(fn);
  }

  /** Packages the courier is carrying now (accepted and collected, not yet delivered). */
  carriedCount(): number {
    return this.orders.active.filter((a) => this.orders.isCarried(a)).length;
  }

  statModifiers(): StatModifiers {
    return this.orders.statModifiers();
  }

  nearKiosk(p: Vec3): boolean {
    const k = this.d.map.hub.kiosk;
    return Math.hypot(p.x - k.x, p.y - k.y, p.z - k.z) <= this.d.map.hub.kioskRange;
  }

  /** The input the sim sees this tick: E at the kiosk opens the board; while it is open, only the look passes. */
  beforeStep(frame: InputFrame): InputFrame {
    const { position, mode } = this.d.player();
    if (!this.modalOpen && frame.interact.pressed && mode !== 'zipline' && this.nearKiosk(position)) {
      this.board.open();
      this.d.actions.releaseAll();
      this.emitModal();
    }
    if (!this.modalOpen) return frame;
    const idle = emptyInput();
    idle.look = frame.look;
    return idle;
  }

  /**
   * After sim.step: Fragile breaks resolve before completions (onSimEvents before update, same tick); then the thieves
   * step against what the courier still carries (a package delivered this tick can't be stolen).
   */
  afterStep(simEvents: SimEvent[], position: Vec3, now: number): void {
    const events = this.orders.onSimEvents(simEvents);
    const before = this.orders.active;
    this.zones = playerZones(position, this.d.map, ordersConfig.zones);
    events.push(...this.orders.update(now, this.zones));
    for (const e of events) this.announce(e, before, now);
    if (!this.thieves) return;
    const courier = { position, carrying: this.carriedCount(), inPlaza: this.zones.inPlaza };
    for (const e of this.thieves.step(1 / movementConfig.tickRate, now, courier, this.d.lineOfSight)) this.onThief(e);
  }

  /** Points earned in the current epoch (0 once its window has passed). */
  epochPoints(): number {
    return this.currentEpoch().points;
  }

  /** Seconds until the chasing thief gives up (maxChaseSeconds), or null when none is chasing. */
  chaseSecondsLeft(): number | null {
    const t = this.thieves?.thieves.find((x) => x.mode === 'chase');
    return t ? Math.max(0, thievesConfig.maxChaseSeconds - t.chaseTime) : null;
  }

  /**
   * Tests (?debug): moves a thief to the street point nearest `p` (projected onto the street strips), patrolling on
   * toward the nearer end of that street, so it can see and chase the courier from the next tick.
   */
  placeThief(id: string, p: Vec3): ThiefState {
    if (!this.thieves || !this.d.city) throw new Error('placeThief needs the city map (the greybox has no thieves)');
    const t = this.thieves.thieves.find((x) => x.id === id);
    if (!t) throw new Error(`unknown thief ${id}`);
    const graph = (this.streets ??= new StreetGraph(this.d.city.streets, this.d.city.hub, thievesConfig.plazaMargin));
    const at = graph.project(p);
    const dist = (n: string): number => {
      const q = graph.position(n);
      return Math.hypot(q.x - at.p.x, q.y - at.p.y, q.z - at.p.z);
    };
    const [end] = graph.edgeEnds(at.edge).filter((n) => graph.isThiefNode(n)).sort((a, b) => dist(a) - dist(b));
    Object.assign(t, {
      position: at.p,
      mode: 'patrol',
      route: [end!],
      prevNode: null,
      chaseTime: 0,
      aboveTime: 0,
      speed: thievesConfig.patrolSpeed,
    });
    return t;
  }

  /** Dev panel backpack slots: applies the capacity and regenerates the board now (Heavy can appear at once). */
  setBackpackCapacity(n: number): void {
    if (n === this.orders.backpackCapacity) return;
    this.orders.setBackpackCapacity(n);
    const now = this.d.now();
    for (const e of this.orders.refreshBoard(now)) this.announce(e, this.orders.active, now);
    this.nextHudAt = 0;
  }

  /** Seconds left of the post-refresh Accept guard. */
  refreshGuardLeft(): number {
    return refreshGuardLeft(this.boardRefreshedAt, this.d.now(), this.d.cfg.ui.boardRefreshGuardSeconds);
  }

  /** Zeroes Points, Coins, deliveries and the epoch points in storage and in the running totals (dev panel). */
  resetProgress(): void {
    this.orders.totals.points = 0;
    this.orders.totals.coins = 0;
    this.orders.totals.deliveries = 0;
    this.epoch = { id: this.currentEpoch().id, points: 0 };
    this.saveProgress();
    this.nextHudAt = 0;
  }

  accept(id: string): AcceptResult {
    const result = this.orders.accept(id, this.d.now(), this.inPlazaNow());
    if (result === 'ok') this.nextHudAt = 0;
    return result;
  }

  cancel(id: string): CancelResult {
    const result = this.orders.cancel(id, this.d.now(), this.inPlazaNow());
    if (result === 'ok') {
      this.popups.show('Order cancelled', [`New orders unlock in ${ordersConfig.board.cancelCooldownSeconds} s`], 'warn');
      this.nextHudAt = 0;
    }
    return result;
  }

  /** Per frame: beams, POI highlights and the POI markers near the player, the HUD (throttled) and the open board. */
  draw(clockSeconds: number): void {
    const now = this.d.now();
    const targets: Vec3[] = [];
    const targetPois = new Set<string>();
    const colorIndices: number[] = [];
    const pois = poiIndex(this.d.map);
    this.colors.sync(this.orders.active.map((a) => a.order.id));
    for (const a of this.orders.active) {
      const step = this.orders.currentStep(a);
      targets.push(pois.target(step));
      colorIndices.push(this.colors.indexOf(a.order.id));
      if (step.kind === 'poi') targetPois.add(step.poiId);
    }
    this.waypoints.update(targets, colorIndices, clockSeconds);
    this.hubMeshes.setTargets(targetPois);
    this.hubMeshes.update(this.d.player().position);

    if (clockSeconds >= this.nextHudAt) {
      this.nextHudAt = clockSeconds + 1 / this.d.cfg.ui.hudUpdateHz;
      const { position } = this.d.player();
      const prompt = !this.modalOpen && this.nearKiosk(position) ? `<kbd>${esc(keyLabel(this.d.cfg.input.bindings.interact[0] ?? ''))}</kbd> Order Board` : null;
      const local = { epochPoints: this.epochPoints(), chaseSecondsLeft: this.chaseSecondsLeft() };
      this.hud.update(hudModel(this.orders, this.d.map, position, now, local), prompt, this.colorIndex);
    }
    if (this.modalOpen) this.board.render(this.orders, now, this.zones.inPlaza, this.refreshGuardLeft(), this.colorIndex);
  }

  private inPlazaNow(): boolean {
    return playerZones(this.d.player().position, this.d.map, ordersConfig.zones).inPlaza;
  }

  /** The epoch points as of the wall clock now: rolled over to the new epoch (0 points) once the window has passed. */
  private currentEpoch(): EpochPoints {
    this.epoch = addEpochPoints(this.epoch, this.clock(), ordersConfig.epoch.seconds, 0);
    return this.epoch;
  }

  private saveProgress(): void {
    this.d.progress.save({ totals: this.orders.totals, epoch: this.epoch });
  }

  /**
   * A thief's catch (spec §7.3): every carried package is stolen (those orders fail; their waypoints go with them) and
   * the current epoch loses penaltyPoints, floored at 0. Lifetime Points are untouched. Chase starts and ends only
   * change the HUD banner, so the HUD redraws at once.
   */
  private onThief(e: ThiefEvent): void {
    this.nextHudAt = 0;
    if (e.kind !== 'caught') return;
    const robbed = this.orders.rob();
    const before = this.currentEpoch().points;
    this.epoch = penalizeEpoch(this.epoch, this.clock(), ordersConfig.epoch.seconds, thievesConfig.penaltyPoints);
    this.saveProgress();
    this.popups.show(robbedText(robbed.lostOrderIds.length, thievesConfig.penaltyPoints, before), [], 'warn');
    for (const fn of this.caughtListeners) fn(e.thiefId);
  }

  private emitModal(): void {
    this.nextHudAt = 0;
    for (const fn of this.modalListeners) fn();
  }

  /** `before`: the active orders before this tick's update, so a completed order's details are still known. */
  private announce(e: OrderEvent, before: readonly ActiveOrder[], now: number): void {
    switch (e.kind) {
      case 'completed': {
        this.epoch = addEpochPoints(this.epoch, this.clock(), ordersConfig.epoch.seconds, e.points);
        this.saveProgress();
        const lines = e.bonuses.map(
          (b) => `${BONUS_LINE[b]}  +${pointsText(ordersConfig.points[BONUS_KEY[b]])} · +${ordersConfig.coins[BONUS_KEY[b]]} coins`,
        );
        const done = before.find((a) => a.order.id === e.orderId);
        if (e.onTime === false) lines.push('Express late · no bonus');
        if (!e.withinPar) lines.push('Par over · no bonus');
        if (done?.order.modifier === 'fragile' && !done.fragileIntact) lines.push('Fragile damaged · no bonus');
        this.popups.show(`Delivered!  +${pointsText(e.points)} · +${e.coins} coins`, lines);
        break;
      }
      case 'stepReached': {
        const a = this.orders.active.find((x) => x.order.id === e.orderId);
        this.popups.show('Package collected', a ? [stageText(a, poiIndex(this.d.map))] : [], 'info');
        break;
      }
      case 'fragileBroken':
        this.popups.show(`${MODIFIER_LABEL.fragile} package damaged`, ['Bonus lost · the order still counts'], 'warn');
        break;
      case 'boardRefreshed':
        this.boardRefreshedAt = now; // Accept waits out the guard; the board flashes (R28)
        break;
    }
  }
}
