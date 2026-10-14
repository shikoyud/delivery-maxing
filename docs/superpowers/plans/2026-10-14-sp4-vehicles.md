# SP4 Vehicles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the courier a skateboard, bicycle, motorbike and car on the shared 30 Hz sim (mount, park, summon, access per surface, fuel and gas stations, crashes), route every trip per vehicle on build-time navmeshes, and close the three SP3 gaps (HUD next-stop arrow, Fragile crash damage, phone while riding), all tuned on a greybox test town with slopes, alleys and stairs. Single-player.

**Architecture:** A new `vehicles/` module in the shared package holds an arcade, kinematic drive model (a generalisation of today's SP1 board), a `VehicleBody` on the same Rapier character controller as the courier (the controller code is extracted from `PlayerBody` into a shared `KinematicMover`), access zones that act as invisible walls for the tiers they forbid, fuel and refuelling, and a `Garage` that owns every vehicle's parked state. `PlayerSim` gains a riding mode: while riding it steps the vehicle and the courier rides along. A new `packages/tools` builds one navmesh per tier (forbidden zones become blockers) into `map/nav/`, and the shared `NavRouter` answers path distances (orders), routes (Map app, HUD arrow) and road spots (summon) at runtime. The client draws code-built vehicle placeholders, a vehicle chase camera, the Garage app, the next-stop arrow and the fuel gauge.

**Tech Stack:** TypeScript, pnpm workspaces (`@dm/shared`, `@dm/client`, new `@dm/tools`), Three.js 0.186, Rapier (`@dimforge/rapier3d-compat`), `recast-navigation` 0.43.1 (the version the SP2 branch used), Vitest, Playwright (headless Chromium, `?debug` hooks, sim-tick driven).

**Spec:** `docs/superpowers/specs/2026-10-12-delivery-maxing-design.md` (revision 2, plus the playtest tuning recorded in PR #8): §2 rows Vehicles and Fuel, §3.2 Fragile, §3.3 Slots and weight, §3.4 Accepting, §4 Camera, §4.1 Input layer, §4.2 Vehicles, §4.3 Where each vehicle can go, §4.4 Fuel, §5 Navmeshes and respawn, §7.2 (only what applies without other players), §8 Phone and HUD, §13 Vehicle stuck, §14 Testing, §15 row 4. City map design `docs/superpowers/specs/2026-10-14-city-map-design.md` §2.1 (grades, stairs, steep lanes), §2.2 gas stations, §3 street table and access rules. SP3 gaps: `/mnt/project-files/knowledge/claude/sp3-status.md` "Known gaps".

## Decisions to confirm (defaults this plan uses)

The spec is silent or ambiguous on these. Each is built as written below unless shiko says otherwise when approving the plan.

1. **The skateboard is carried, not parked.** F with no parked vehicle in reach puts the board down and you ride; F again picks it up. It never stays behind, so it has no summon. This reads §4.3 "Stairs ✗ (carried)" literally and keeps today's board feel. *Alternative:* it parks like the other three; Task 6 then drops its `carried` branch.
2. **Owned vehicles before the shop.** The shop is SP6, so in SP4 all four vehicles are owned by default and the dev panel toggles ownership. They start parked at the spawn hospital's vehicle bay.
3. **One navmesh per tier (five), not three.** §5 says "per vehicle class (foot, two-wheeler, car)", but §4.3 gives five different access rules (the skateboard can't use steep lanes, the motorbike can't use paths), so one two-wheeler mesh can't route all three. §5 is updated in the build PR.
4. **Steering stays camera-relative, like today's board.** W/A/S/D give a wish direction relative to the camera and the vehicle turns toward it at its turn rate (§4: "Movement is relative to the camera"). Back input brakes; when stopped, the car reverses and the other vehicles turn around.
5. **A crash doesn't knock the rider off.** Hitting a wall above 10 m/s stops the vehicle and cancels Fragile bonuses (§3.2). Knock-offs come with hits and vehicle-vs-player collisions in SP7, which need other players.
6. **Out of bounds while riding.** The courier respawns on foot at the nearest hospital (as today) and the vehicle is towed to that hospital's bay with its fuel unchanged.
7. **Placeholder models.** All four vehicles are code-built placeholders in SP4. The car from the owner's packs arrives with the asset import in SP5 (the packs are not in the repo).

## Global Constraints

- Tuning values live in `config/*.json`, never hard-coded (project rule). New files: `config/riding.json`, `config/nav.json`; new keys in `config/orders.json` and `config/client.json` (Task 1).
- Values copied from the spec: top speeds walk 8, skateboard 12, bicycle 16, motorbike 22, car 28 m/s (server-enforced caps); slots 1/1/2/3/5; max package weight motorbike 50 kg, car 150 kg; mount and dismount on F; a dismounted vehicle stays parked and nobody else can use it; summon moves an owned vehicle more than 100 m away to the nearest legal road spot next to the player, cooldown 60 s; fuel only on motorbike and car, tank range motorbike 6 km and car 5 km; refuel by holding E at a pump, a full tank costs 40 Coins (motorbike) or 80 Coins (car), partial fills proportional; an empty tank still moves at 3 m/s; Fragile bonus lost when crashing a vehicle above 10 m/s into a wall.
- Access (spec §4.3): avenues and streets all tiers; alleys all but car; steep lanes (14%) walk, bicycle, motorbike; stairs walk only (skateboard carried); boardwalk, pier, park paths walk, skateboard, bicycle.
- Every delivery ends on foot: pickup and hand-over only count off the vehicle (§3.3). Switching to a vehicle that can't hold the active orders is refused (§3.3). Offers are filtered by the vehicle being ridden or last ridden (§3.3).
- Phone (§8): the full phone works on foot or when stopped; while riding only notifications show, with Y accepting the top offer.
- Keys (§4.1): F mount/dismount, Space handbrake on a vehicle, E refuel, Shift unused on a vehicle. The SP1 Q board key and `board` action are removed (the skateboard is a vehicle now).
- All movement and vehicle code lives in `packages/shared` and runs on the fixed 30 Hz step; rendering interpolates.
- Node ≥ 22, pnpm 10, TypeScript ~6.0. `pnpm check` (lint, typecheck, unit tests, and from Task 8 `map:check`) passes at every commit; `pnpm e2e` passes at the end of Task 14. The CI workflow file is not changed (project rule); CI already runs `pnpm check`.
- No Amazon or real brand names: gas stations and new POIs get fictional names (§16).
- Branch `sp4/vehicles` from `main` once this plan is approved; one PR titled `[SP4] Vehicles`. Commit and push after every task.
- Playtest deliverables: Playwright screenshots of each vehicle, the HUD with the next-stop arrow and fuel gauge, the Map app route for car and for foot, the Garage app, a gas station, the test town; pasted summary lines of `pnpm check` and `pnpm e2e`.

## Review Focus

1. **Getting off where there is no room.** A car pulled tight against an alley wall with a parked motorbike on the other side: F must try left, right, then behind, and refuse with "No room to get off" rather than put the courier inside a solid or a vehicle. Test in Task 6.
2. **Running dry with too few Coins.** An empty car far from a pump crawls at 3 m/s and is never stuck; at the pump with 30 Coins (a full car tank is 80), holding E fills only what 30 Coins buy, stops, charges at most 30, and Coins never go negative. Tests in Task 7.
3. **Summon with no legal spot near the player.** Standing on the stairs, the car's nearest spot is off the stairs on the car navmesh; when no point of the car mesh lies within the search radius, summon fails with "No road nearby" and the 60 s cooldown is not used up. Tests in Task 10.
4. **Mounting a smaller vehicle while carrying orders it can't hold.** On foot with two food orders after riding the bicycle, F next to the skateboard is refused with the reason, nothing changes, and both orders stay. Test in Task 9.
5. **A vehicle that leaves the map.** Riding the car off the pier: the courier respawns on foot at the nearest hospital, the car is towed to that hospital's bay, carried orders stay, a carried Fragile breaks exactly once, and the car can be mounted again at the bay. Test in Task 6 (sim) and Task 9 (orders).

---

### Task 1: Riding, navigation and camera config

**Files:**
- Create: `config/riding.json`, `config/nav.json`
- Modify: `config/orders.json` (`fragile.crashSpeed`), `config/client.json` (`camera.chase.rides`, `ui.routeRefreshSeconds`, `ui.hintCooldownSeconds`, courier `poses.bike`), `packages/shared/src/config/types.ts`, `packages/shared/src/config/index.ts`, `packages/client/src/clientConfig.ts`
- Test: `packages/shared/test/config/config.test.ts`, `packages/client/test/clientConfig.test.ts`

**Interfaces:**
- Produces:
  - `type RideTier = 'skateboard' | 'bicycle' | 'motorbike' | 'car'`; `const RIDE_TIERS: readonly RideTier[]` (in that order)
  - `type AccessKind = 'alley' | 'steepLane' | 'stairs' | 'path'`
  - `interface RideSpec { accel; brakeDecel; coastDecel; handbrakeDecel; reverseSpeed; turnRateLow; turnRateHigh; grip; handbrakeGrip; slopeGravityScale; collider: { shape: 'upright' | 'lengthwise'; radius; halfLength; height }; maxStepHeight; maxSlopeClimbDeg; fuel: { rangeMeters; fullTankCoins } | null }` (all numbers)
  - `interface RidingConfig { rides: Record<RideTier, RideSpec>; access: Record<VehicleTier, AccessKind[]>; riding: { mountRadius; stoppedSpeed; dismountMaxSpeed; dismountGap; emptyTankSpeed }; refuel: { pumpRadius; tankPerSecond }; summon: { minDistance; cooldownSeconds; minClearance; searchRadius; ringSamples }; bays: { spacing } }`; `export const ridingConfig: RidingConfig`
  - `interface NavConfig { cellSize; cellHeight; tileSize; minRegionArea; maxEdgeLen; maxNodes; maxPathPolys; maxStraightPathPoints; queryHalfExtents: Vec3; reachTolerance; blockerHeight; carRoadMaxDoorDistance; maxFoodOffCarShare }`; `export const navConfig: NavConfig`
  - `OrdersConfig.fragile: { maxFallMeters: number; crashSpeed: number }`
  - `ClientConfig.camera.chase.rides: Record<RideTier, { distance: number; height: number; pivotHeight: number }>`, `ClientConfig.ui.routeRefreshSeconds`, `ClientConfig.ui.hintCooldownSeconds`

- [ ] **Step 1: Write the failing tests**

In `packages/shared/test/config/config.test.ts`:
```ts
test('riding config: four rides, fuel only on motorbike and car (spec §4.2, §4.4)', () => {
  expect(RIDE_TIERS).toEqual(['skateboard', 'bicycle', 'motorbike', 'car']);
  expect(ridingConfig.rides.motorbike.fuel).toEqual({ rangeMeters: 6000, fullTankCoins: 40 });
  expect(ridingConfig.rides.car.fuel).toEqual({ rangeMeters: 5000, fullTankCoins: 80 });
  expect(ridingConfig.rides.skateboard.fuel).toBeNull();
  expect(ridingConfig.rides.bicycle.fuel).toBeNull();
  expect(ridingConfig.riding.emptyTankSpeed).toBe(3);
  expect(ridingConfig.summon).toMatchObject({ minDistance: 100, cooldownSeconds: 60 });
});
test('access table matches spec §4.3', () => {
  expect(ridingConfig.access).toEqual({
    walk: ['alley', 'steepLane', 'stairs', 'path'],
    skateboard: ['alley', 'path'],
    bicycle: ['alley', 'steepLane', 'path'],
    motorbike: ['alley', 'steepLane'],
    car: [],
  });
});
test('top speeds are the spec caps', () => {
  expect(RIDE_TIERS.map((t) => vehiclesConfig[t].topSpeed)).toEqual([12, 16, 22, 28]);
});
test('Fragile crash threshold is 10 m/s', () => { expect(ordersConfig.fragile.crashSpeed).toBe(10); });
```
In `packages/client/test/clientConfig.test.ts`:
```ts
test('vehicle cameras sit further back and higher than on foot, growing with the tier', () => {
  const c = clientConfig.camera.chase;
  const d = RIDE_TIERS.map((t) => c.rides[t].distance);
  expect(d[0]).toBeGreaterThan(c.distance);
  expect([...d].sort((a, b) => a - b)).toEqual(d);
  for (const t of RIDE_TIERS) expect(c.rides[t].height).toBeGreaterThan(c.height);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/shared/test/config packages/client/test/clientConfig.test.ts`
Expected: FAIL (`RIDE_TIERS` / `ridingConfig` not exported)

- [ ] **Step 3: Write the config files and types**

`config/riding.json` starting values (tuning, not spec, except the values the spec pins):
```json
{
  "rides": {
    "skateboard": { "accel": 6, "brakeDecel": 12, "coastDecel": 1, "handbrakeDecel": 8, "reverseSpeed": 0, "turnRateLow": 2.5, "turnRateHigh": 2.0, "grip": 60, "handbrakeGrip": 20, "slopeGravityScale": 1,
      "collider": { "shape": "upright", "radius": 0.35, "halfLength": 0, "height": 1.9 }, "maxStepHeight": 0.2, "maxSlopeClimbDeg": 20, "fuel": null },
    "bicycle": { "accel": 5, "brakeDecel": 10, "coastDecel": 0.6, "handbrakeDecel": 8, "reverseSpeed": 0, "turnRateLow": 2.6, "turnRateHigh": 1.4, "grip": 50, "handbrakeGrip": 15, "slopeGravityScale": 0.6,
      "collider": { "shape": "upright", "radius": 0.4, "halfLength": 0, "height": 2.0 }, "maxStepHeight": 0.2, "maxSlopeClimbDeg": 20, "fuel": null },
    "motorbike": { "accel": 9, "brakeDecel": 14, "coastDecel": 1.2, "handbrakeDecel": 10, "reverseSpeed": 0, "turnRateLow": 2.4, "turnRateHigh": 1.0, "grip": 40, "handbrakeGrip": 12, "slopeGravityScale": 0.3,
      "collider": { "shape": "lengthwise", "radius": 0.5, "halfLength": 0.6, "height": 1.0 }, "maxStepHeight": 0.2, "maxSlopeClimbDeg": 20, "fuel": { "rangeMeters": 6000, "fullTankCoins": 40 } },
    "car": { "accel": 8, "brakeDecel": 16, "coastDecel": 1.5, "handbrakeDecel": 12, "reverseSpeed": 6, "turnRateLow": 1.8, "turnRateHigh": 0.7, "grip": 30, "handbrakeGrip": 8, "slopeGravityScale": 0.25,
      "collider": { "shape": "lengthwise", "radius": 0.95, "halfLength": 1.25, "height": 1.9 }, "maxStepHeight": 0.2, "maxSlopeClimbDeg": 20, "fuel": { "rangeMeters": 5000, "fullTankCoins": 80 } }
  },
  "access": { "walk": ["alley", "steepLane", "stairs", "path"], "skateboard": ["alley", "path"], "bicycle": ["alley", "steepLane", "path"], "motorbike": ["alley", "steepLane"], "car": [] },
  "riding": { "mountRadius": 2.5, "stoppedSpeed": 0.5, "dismountMaxSpeed": 2, "dismountGap": 0.3, "emptyTankSpeed": 3 },
  "refuel": { "pumpRadius": 3, "tankPerSecond": 0.25 },
  "summon": { "minDistance": 100, "cooldownSeconds": 60, "minClearance": 3, "searchRadius": 60, "ringSamples": 16 },
  "bays": { "spacing": 4 }
}
```
`config/nav.json`: `{ "cellSize": 0.3, "cellHeight": 0.2, "tileSize": 64, "minRegionArea": 8, "maxEdgeLen": 12, "maxNodes": 4096, "maxPathPolys": 512, "maxStraightPathPoints": 512, "queryHalfExtents": { "x": 2, "y": 4, "z": 2 }, "reachTolerance": 1.0, "blockerHeight": 8, "carRoadMaxDoorDistance": 30, "maxFoodOffCarShare": 0.15 }`.
`config/orders.json`: `"fragile": { "maxFallMeters": 7, "crashSpeed": 10 }`.
`config/client.json`: `camera.chase.rides` = skateboard `{ distance 5, height 1.8, pivotHeight 1.5 }`, bicycle `{ 5.5, 2.0, 1.6 }`, motorbike `{ 6.5, 2.2, 1.4 }`, car `{ 8.5, 2.8, 1.4 }`; `ui.routeRefreshSeconds 0.5`, `ui.hintCooldownSeconds 3`; `courier.poses.bike` = `{ "drop": 0, "hipDrop": 0.35, "body": [10, 0, 0], "bones": { "UpperLegL": [70, 0, 0], "UpperLegR": [70, 0, 0], "UpperArmL": [-60, 0, 0], "UpperArmR": [-60, 0, 0] } }`. Add the types to `types.ts`, re-export from `config/index.ts` and the client config type.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/shared/test/config packages/client/test/clientConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add config packages/shared/src/config packages/shared/test/config packages/client/src/clientConfig.ts packages/client/test/clientConfig.test.ts
git commit -m "feat(config): riding, navigation and vehicle camera config"
git push -u origin sp4/vehicles
```

---

### Task 2: Map schema: access zones, gas stations, vehicle bays

**Files:**
- Create: `packages/shared/src/world/access.ts`
- Modify: `packages/shared/src/world/mapTypes.ts`, `packages/shared/src/world/greybox.ts`, `packages/shared/src/index.ts`, `packages/shared/test/world/fixtures.ts`, `map/greybox.json` (empty `accessZones` and `gasStations`, and a `bay` per hospital, so the map loads; Task 3 fills in the rest)
- Test: `packages/shared/test/world/access.test.ts`, `packages/shared/test/world/greybox.test.ts`

**Interfaces:**
- Consumes: `AccessKind`, `ridingConfig.access` (Task 1)
- Produces:
  - `interface AccessZone { id: string; kind: AccessKind; rect: Rect; minY: number; maxY: number }`
  - `interface GasStation { id: string; name: string; position: Vec3; pumps: Vec3[] }` (`pumps`: ground points where a stopped vehicle refuels)
  - `Hospital.bay: Vec3`, `Hospital.bayYaw: number` (first parking slot and the facing of parked vehicles; slot i is `bay + i·bays.spacing` along the bay's right vector)
  - `MapData.accessZones: AccessZone[]`, `MapData.gasStations: GasStation[]`; `GreyboxSource` lists only hand-placed zones, `expandGreybox` appends the generated alley zones
  - `accessAllowed(tier: VehicleTier, kind: AccessKind, cfg?: RidingConfig): boolean`
  - `zoneAt(map: MapData, p: Vec3): AccessZone | null` (first zone whose rect contains p.x/p.z, edges inclusive, with `minY - 0.5 ≤ p.y ≤ maxY + 0.5`)
  - `forbiddenZoneAt(map: MapData, tier: VehicleTier, p: Vec3): AccessZone | null`
  - `baySlot(h: Hospital, i: number, cfg?: RidingConfig): { position: Vec3; heading: number }`

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/world/access.test.ts`:
```ts
test('accessAllowed follows spec §4.3', () => {
  expect(accessAllowed('car', 'alley')).toBe(false);
  expect(accessAllowed('motorbike', 'alley')).toBe(true);
  expect(accessAllowed('skateboard', 'steepLane')).toBe(false);
  expect(accessAllowed('bicycle', 'stairs')).toBe(false);
  expect(accessAllowed('walk', 'stairs')).toBe(true);
  expect(accessAllowed('motorbike', 'path')).toBe(false);
});
test('forbiddenZoneAt: a car in an alley zone gets the zone, a bicycle gets null', () => { /* fixture map with one alley zone */ });
test('zoneAt ignores a point far above the zone (a bridge over an alley)', () => { /* p.y = maxY + 3 → null */ });
test('baySlot spaces slots along the bay right vector by bays.spacing', () => { /* slot 2 is 8 m from slot 0, heading = bayYaw */ });
```
In `packages/shared/test/world/greybox.test.ts`:
```ts
test('expandGreybox emits an alley zone for each half-alley whose two flanking lots are both built', () => {
  /* fixture: one block with lots 0 and 1 built, 2 and 3 empty → exactly one zone, kind 'alley',
     4 m wide (grid.alleyWidth), running from the block edge to the block centre, minY 0, maxY 0 */
});
test('no alley zone where a flanking lot is empty (open plazas stay open to cars)', () => { /* … */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- access greybox`
Expected: FAIL (module `world/access` not found)

- [ ] **Step 3: Implement the schema and helpers**

Add the types. In `map/greybox.json` add `"accessZones": []`, `"gasStations": []`, and on every hospital a `bay` 8 m in front of its `spawn` (toward the street) with `bayYaw` parallel to the street. In `expandGreybox`, while placing lots record which lots are built; then, for each block, each of the four half-alleys (between lots 0–1, 2–3 along one axis and 0–2, 1–3 along the other) becomes a zone `alley-<bx>-<bz>-<a|b|c|d>` when both lots it separates are built; the half-alley runs from the block's outer lot edge to the block centre (it includes half of the 4 × 4 m crossing). Update the test fixtures with `accessZones: []`, `gasStations: []` and hospital bays.

- [ ] **Step 4: Run the shared tests**

Run: `pnpm --filter @dm/shared test`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A packages/shared && git commit -m "feat(map): access zones, gas stations and hospital vehicle bays" && git push
```

---

### Task 3: Greybox test town and gas stations

The hillside reserved area (−300…−150 on x and z) is rebuilt as the SP4 test town; the rest of the greybox stays as it is apart from the bays and a second gas station.

**Files:**
- Modify: `map/greybox.json`
- Test: `packages/shared/test/world/greyboxContent.test.ts`

**Interfaces:**
- Consumes: `AccessZone`, `GasStation`, `Hospital.bay`, `baySlot` (Task 2)
- Produces: the zone ids `town-steep-lane`, `town-stairs`, `town-park-path`, `town-boardwalk`; gas stations `town-gas` ("Hilltop Fuel Stop") and `harbor-gas` ("Bayline Fuel"); POIs `town-poi-01` (food dropoff on the terrace, nearest door reached by the stairs) and `town-poi-02` (food + package dropoff within 30 m of the road ramp top). Later tasks and e2e tests teleport to these.

The town (replace `hillside-plateau`, `hillside-terrace-01`, `hillside-ramp-01/02`, `hillside-house-01..04`):
- A **terrace** 5 m high (top at y = 5) covering the north-west of the area, with 4 small houses on it.
- A **road ramp** 12 m wide at **9 %** (the switchback grade, all vehicles) from street level to the terrace.
- A **steep lane** 6 m wide at **14 %** to the terrace, covered by an access zone `steepLane`.
- A **stair** 4 m wide, steps of 0.25 m rise and 0.35 m tread (20 steps), covered by an access zone `stairs`.
- A **park path** 6 m wide across the terrace (zone `path`) and a **boardwalk** 8 m wide along the area's south edge (zone `path`), both with a car-legal road at each end so the navmesh check in Task 8 holds.
- A **gas station** at the foot of the road ramp on an 18 × 15 m lot: a canopy roof slab at y 5–5.4 on four 0.4 m pillars, two pump islands (props 1 × 1.2 × 3 m), and two `pumps` points 1.5 m beside the islands. A second gas station in the harbor district.
- Every hospital bay (added in Task 2) has room for 4 slots; move a bay along its street if a slot doesn't fit.

- [ ] **Step 1: Write the failing content tests**

In `greyboxContent.test.ts` add:
```ts
test('road ramp grade is 9 % ± 0.3 % and 12 m wide', () => { /* from the ramp solid's rotation and size */ });
test('steep lane grade is 14 % ± 0.3 %, 6 m wide, and fully inside zone town-steep-lane', () => {});
test('stairs: 20 steps of 0.25 m rise, 0.35 m tread, inside zone town-stairs', () => {});
test('two gas stations, each with 2 pumps on open ground (no solid within 0.5 m of a pump point)', () => {});
test('every hospital bay slot 0..3 stands on ground and fits a car capsule', async () => { /* physics intersectionWithShape with the car collider */ });
test('town POIs exist and town-poi-02 is within 30 m (straight line) of the ramp top', () => {});
test('no access zone overlaps a hospital safe zone or a bay slot', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- greyboxContent`
Expected: FAIL (zones and stations missing)

- [ ] **Step 3: Edit `map/greybox.json`**

Build the town to the list above; keep every other hand-placed solid, POI and hospital unchanged except for the bays. Ramps use `kind: 'ramp'` with `rotationDeg` (grade = tan of the tilt). Stair steps are 20 `prop` solids `town-stair-01..20`.

- [ ] **Step 4: Run the shared tests**

Run: `pnpm --filter @dm/shared test`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add map/greybox.json packages/shared/test/world && git commit -m "feat(map): greybox test town (ramp, steep lane, stairs, paths) and two gas stations" && git push
```

---

### Task 4: The drive model

`board.ts` becomes the general drive model for all four rides. Pure velocity math; no physics.

**Files:**
- Create: `packages/shared/src/vehicles/types.ts`, `packages/shared/src/vehicles/drive.ts`
- Delete: `packages/shared/src/movement/board.ts`, `packages/shared/test/movement/board.test.ts` (its cases move to `drive.test.ts` with the skateboard spec)
- Test: `packages/shared/test/vehicles/drive.test.ts`

**Interfaces:**
- Consumes: `RideSpec`, `RideTier` (Task 1); `facing`, `yawOf`, `hasMoveInput`, `wishDirection` from `movement/ground.ts`
- Produces:
  - `interface VehicleState { tier: RideTier; position: Vec3; heading: number; velocity: Vec3; grounded: boolean; groundNormal: Vec3; airApexY: number; fuel: number /* 0..1; always 1 without a tank */ }`
  - `interface DriveInput { wish: Vec3; magnitude: number; hasInput: boolean; handbrake: boolean }`; `driveInput(input: InputFrame): DriveInput` (handbrake = `input.jump.held`)
  - `vehicleTopSpeed(v: VehicleState, cfg = { vehicles: vehiclesConfig, riding: ridingConfig }): number` (the tier's spec top speed; `riding.emptyTankSpeed` when the tank is empty)
  - `applyDrive(v: VehicleState, d: DriveInput, spec: RideSpec, topSpeed: number, gravity: number, dt: number): void`

Rules `applyDrive` must follow (each one a test):
- Forward speed `s` is the velocity along the heading; sideways velocity decays toward 0 at `grip` m/s² (`handbrakeGrip` while the handbrake is held).
- Turning: the heading turns toward the wish yaw at most `turnRate·dt`, where `turnRate` goes linearly from `turnRateLow` at 0 m/s to `turnRateHigh` at `topSpeed`.
- Back input (wish · heading < −0.5) above `riding.stoppedSpeed` brakes at `brakeDecel·magnitude`, without turning. At or below it: with `reverseSpeed > 0` it accelerates backwards to `−reverseSpeed` (the car); with `reverseSpeed = 0` it turns around in place like the SP1 board (R3).
- Other input accelerates at `accel·magnitude` to `topSpeed`; no input coasts down at `coastDecel`; the handbrake slows at `handbrakeDecel`.
- Slope: `s += gravity · sinθ · slopeGravityScale · (downhill share of the heading) · dt`.
- `|s|` never exceeds `topSpeed` (hard cap: it is the server cap, slopes included).
- Vertical velocity is untouched.

- [ ] **Step 1: Write the failing tests**

```ts
test.each(RIDE_TIERS)('%s reaches exactly its top speed on the flat and never more', (t) => { /* 30 s of W: max speed === topSpeed */ });
test('the car gets to 28 m/s; a 30 % downhill never pushes it above 28', () => {});
test('S below stoppedSpeed: the car reverses to -6 m/s, the bicycle turns around instead', () => {});
test('S above stoppedSpeed brakes without turning', () => {});
test('turn rate falls with speed: the car turns 1.8 rad/s at rest and 0.7 rad/s at 28 m/s', () => {});
test('sideways velocity decays at grip, faster than at handbrakeGrip', () => {});
test('an empty tank caps the car at 3 m/s; the bicycle ignores fuel', () => { expect(vehicleTopSpeed({ ...car, fuel: 0 })).toBe(3); });
test('skateboard keeps the SP1 board behaviours (R3 turn-around, R4 sideways input turns)', () => { /* ported from board.test.ts */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- drive`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `vehicles/types.ts` and `vehicles/drive.ts`**

Generalise `applyBoardVelocity`: the same structure, with the spec's numbers replacing `cfg.board` and the rules above added. Leave `board.ts` in place until Task 6 deletes it with the rest of the board wiring.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @dm/shared test -- drive`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/shared && git commit -m "feat(vehicles): arcade drive model for skateboard, bicycle, motorbike and car" && git push
```

---

### Task 5: Vehicle body, access walls and crashes

**Files:**
- Create: `packages/shared/src/movement/kinematicMover.ts`, `packages/shared/src/vehicles/VehicleBody.ts`, `packages/shared/src/vehicles/accessClip.ts`, `packages/shared/src/vehicles/stepVehicle.ts`
- Modify: `packages/shared/src/movement/body.ts` (delegates to `KinematicMover`), `packages/shared/src/movement/types.ts` (`SimEvent`)
- Test: `packages/shared/test/vehicles/accessClip.test.ts`, `packages/shared/test/vehicles/stepVehicle.test.ts`; the existing `packages/shared/test/movement/*.test.ts` must pass unchanged

**Interfaces:**
- Consumes: `VehicleState`, `applyDrive`, `driveInput`, `vehicleTopSpeed` (Task 4); `forbiddenZoneAt`, `AccessZone` (Task 2)
- Produces:
  - `class KinematicMover { constructor(physics: PhysicsWorld, collider: Collider, body: RigidBody, settings: () => MoverSettings); move(desired: Vec3, snapToGround: boolean, bottomSphere: () => { center: Vec3; radius: number }): MoveResult; castRay(from: Vec3, dir: Vec3, maxDist: number): RayHit | null }` with `MoverSettings = { offset; maxStepHeight; minStepWidth; snapToGround; maxSlopeClimbDeg; minSlopeSlideDeg }` — the controller setup, `skinDeficit` and ground probe moved out of `PlayerBody` unchanged
  - `class VehicleBody { constructor(physics: PhysicsWorld, spec: RideSpec, feet: Vec3, heading: number); readonly collider: Collider; get feet(): Vec3; get heading(): number; move(desired: Vec3, snap: boolean): MoveResult; tryTurn(heading: number): boolean; place(feet: Vec3, heading: number): void; fitsAt(feet: Vec3, heading: number): boolean; setEnabled(on: boolean): void; destroy(): void }` — upright capsule, or a capsule lying along the heading (`lengthwise`); `tryTurn` rotates only when the turned shape overlaps nothing (else the heading stays)
  - `clipToAccess(map: MapData, tier: VehicleTier, from: Vec3, move: Vec3): { move: Vec3; zone: AccessZone | null; normal: Vec3 | null }` — when `from` is outside every zone forbidden to `tier` and `from + move` is inside one, the move is shortened to stop 0.05 m before the crossed rect edge and `normal` is that edge's outward normal; starting inside a forbidden zone is never blocked (a vehicle can always drive out)
  - `stepVehicle(v: VehicleState, body: VehicleBody, input: InputFrame, ctx: { map: MapData; spec: RideSpec; gravity: number; dt: number; crashSpeed: number }): SimEvent[]` — order: drive → `tryTurn` → gravity → `clipToAccess` → `body.move` → remove blocked velocity (walls and access edges) → crash check → landing → fuel burn (Task 7 fills in the burn)
  - New `SimEvent` kinds: `{ kind: 'crashed'; speed: number }` (impact speed into a wall, emitted when `> crashSpeed`), `{ kind: 'accessBlocked'; zone: AccessKind }`; vehicle landings reuse `{ kind: 'landed'; fallHeight }`

- [ ] **Step 1: Write the failing tests**

`accessClip.test.ts`:
```ts
test('a car driving into an alley stops 0.05 m before the zone edge, normal pointing out', () => {});
test('a motorbike passes the same alley edge unchanged', () => {});
test('a car that starts inside an alley zone (summoned, towed) can drive out', () => {});
test('a move that skims past a zone corner without entering is not clipped', () => {});
```
`stepVehicle.test.ts` (Rapier world from a small fixture map: a wall, an alley zone, a 14 % ramp, 0.25 m stairs, a 9 m ledge):
```ts
test('car at 10.5 m/s into a wall: one crashed event with speed ≈ 10.5, velocity into the wall removed', () => {});
test('car at 9.5 m/s into a wall: no crashed event', () => {});
test('car toward an alley: accessBlocked once, never enters the zone over 3 s of W', () => {});
test('bicycle climbs the 14 % ramp; the 0.25 m stairs stop it', () => {});
test('a lengthwise car beside a wall cannot turn its nose into the wall (heading unchanged)', () => {});
test('driving off the 9 m ledge emits landed with fallHeight ≈ 9', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- accessClip stepVehicle`
Expected: FAIL (modules missing)

- [ ] **Step 3: Extract `KinematicMover`, then build `VehicleBody`, `clipToAccess` and `stepVehicle`**

Extract first and run `pnpm --filter @dm/shared test -- movement` to prove `PlayerBody` behaves exactly as before; then add the vehicle code. A lengthwise capsule's bottom sphere for `skinDeficit` is centred on the capsule axis.

- [ ] **Step 4: Run the shared tests**

Run: `pnpm --filter @dm/shared test`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/shared && git commit -m "feat(vehicles): vehicle body, access walls and crash detection" && git push
```

---

### Task 6: Riding: Garage, mount, dismount, park, tow

**Files:**
- Create: `packages/shared/src/vehicles/Garage.ts`
- Modify: `packages/shared/src/movement/PlayerSim.ts`, `packages/shared/src/movement/types.ts`, `packages/shared/src/movement/triggers.ts`, `packages/shared/src/input/inputFrame.ts` (drop `board`), `packages/shared/src/config/types.ts` and `config/movement.json` (drop `board`), `packages/shared/src/index.ts`, `packages/shared/test/helpers/simHarness.ts`
- Delete: `packages/shared/src/movement/board.ts`
- Modify (board removal on the client, compile only): `packages/client/src/input/actionState.ts`, `config/client.json` (drop the `board` binding), `packages/client/src/ui/phone/stubApp.ts` (binding labels), `packages/client/src/render/courier/animState.ts`, `packages/client/src/render/courier/CourierModel.ts` (the deck goes; Task 11 draws the skateboard), `packages/client/src/ui/debugOverlay.ts`, `packages/client/src/game/debugHooks.ts`, `packages/client/src/game/Game.ts`
- Test: `packages/shared/test/vehicles/garage.test.ts`, `packages/shared/test/movement/riding.test.ts`, `packages/shared/test/movement/triggers.test.ts`

**Interfaces:**
- Consumes: `VehicleBody`, `stepVehicle` (Task 5); `baySlot` (Task 2)
- Produces:
  - `type VehicleSpot = { kind: 'parked'; position: Vec3; heading: number } | { kind: 'carried' } | { kind: 'riding' }`
  - `interface SavedVehicle { tier: RideTier; spot: VehicleSpot; fuel: number }`
  - `class Garage { constructor(physics: PhysicsWorld, map: MapData, owned: SavedVehicle[]); owned(): readonly RideTier[]; state(t: RideTier): VehicleState; spot(t: RideTier): VehicleSpot; body(t: RideTier): VehicleBody; nearestParked(feet: Vec3, radius: number): RideTier | null; setOwned(t: RideTier, owned: boolean, startAt: Hospital): void; tow(t: RideTier, h: Hospital): void; snapshot(): SavedVehicle[] }` — `carried` is the skateboard's resting spot (Decision 1); `setOwned(true)` parks a new vehicle at the first free bay slot of `startAt`; parked bodies are enabled colliders, carried and unowned ones are disabled
  - `defaultGarage(map: MapData): SavedVehicle[]` — all four owned (Decision 2): skateboard carried, the others in bay slots 0–2 of `map.hospitals[0]`, full tanks
  - `PlayerState`: remove `onBoard`, `boardHeading`; add `riding: RideTier | null`, `lastRide: RideTier | null` (the tier last ridden, for capacity)
  - `PlayerSim` constructor gains `garage: Garage` (last parameter); `PlayerSim.garage`; `PlayerSim.mountCandidate(): RideTier | null` (what F would mount now: the nearest parked owned vehicle within `riding.mountRadius`, else the carried skateboard; null while riding, airborne, crouched, sliding or mantling)
  - New `SimEvent` kinds: `{ kind: 'mounted'; tier: RideTier }`, `{ kind: 'dismounted'; tier: RideTier }`, `{ kind: 'mountRefused'; reason: 'tooFast' | 'noRoom' }`, `{ kind: 'towed'; tier: RideTier; hospitalId: string }`; `boardToggled` is removed

Riding rules (each one a test):
- F on foot mounts `mountCandidate()`. Mounting disables the courier's collider, puts the skateboard's body at the feet (carried case) and sets `riding`, `lastRide`, `heading = vehicle heading`. Sprint switches off.
- While riding, `step` runs `stepVehicle`; the courier's `position`, `velocity`, `heading`, `grounded` and `mode` (`'ground'`/`'air'`) mirror the vehicle. Stamina regenerates.
- F while riding dismounts when speed ≤ `riding.dismountMaxSpeed`, else `mountRefused 'tooFast'`. Feet go to the vehicle's left side (vehicle half-width + capsule radius + `dismountGap`), else right, else behind; the first spot where `PlayerBody.fitsAt` holds wins; none → `mountRefused 'noRoom'` and the courier stays on. The skateboard needs no side spot: it is picked up and the courier stands where it was.
- A parked vehicle is an obstacle for the courier and for the ridden vehicle.
- Out of bounds while riding: `respawned` (as today, at the hospital nearest `lastGrounded`) plus `towed` to that hospital (Decision 6); the courier is on foot.

- [ ] **Step 1: Write the failing tests**

`riding.test.ts`:
```ts
test('F within 2.5 m of the parked car mounts it; at 3 m it pulls out the skateboard instead', () => {});
test('F is ignored while airborne, crouched or mid-slide', () => {});
test('riding the car: courier position follows the car; 10 s of W reaches 28 m/s', () => {});
test('F at 5 m/s: mountRefused tooFast, still riding', () => {});
test('dismount puts the courier on the left; with a wall on the left, on the right', () => {});
test('Review Focus 1: car in a 4 m gap between a wall and a parked motorbike: dismount behind, else noRoom and still riding, courier never inside a solid', () => {});
test('the parked car blocks the courier walking into it', () => {});
test('skateboard: F off leaves nothing parked; mountCandidate is the skateboard again', () => {});
```
`triggers.test.ts`:
```ts
test('Review Focus 5: riding off the map edge respawns on foot at the nearest hospital and tows the car to its bay; F at the bay mounts it again', () => {});
```
`garage.test.ts`:
```ts
test('defaultGarage owns all four: skateboard carried, others in bay slots 0-2 with full tanks', () => {});
test('setOwned(false) removes the collider; setOwned(true) parks at the first free slot', () => {});
test('snapshot round-trips through the constructor', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- riding garage triggers`
Expected: FAIL

- [ ] **Step 3: Implement the Garage and the riding mode; remove the SP1 board**

Remove `board` everywhere (action, Q binding, `MovementConfig.board`, `boardToggled`, `onBoard`, the deck in `CourierModel`, the "board" pose use in `animFor`; keep the `board` pose config for Task 11's skateboard rider). `Game.create` builds `new Garage(physics, map, defaultGarage(map))` until Task 13 loads the saved one. The client still compiles and runs; the courier rides an invisible vehicle until Task 11.

- [ ] **Step 4: Run all checks**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(vehicles): garage, mount, dismount, parking and tow; the SP1 Q board becomes the skateboard" && git push
```

---

### Task 7: Fuel and refuelling

**Files:**
- Create: `packages/shared/src/vehicles/fuel.ts`
- Modify: `packages/shared/src/vehicles/stepVehicle.ts` (burn), `packages/shared/src/orders/OrderSystem.ts` (`spendCoins`)
- Test: `packages/shared/test/vehicles/fuel.test.ts`, `packages/shared/test/orders/OrderSystem.test.ts`

**Interfaces:**
- Consumes: `VehicleState`, `stepVehicle` (Tasks 4–5), `GasStation` (Task 2)
- Produces:
  - `burnFuel(fuel: number, meters: number, spec: RideSpec): number` (unchanged without a tank; `max(0, fuel − meters / rangeMeters)`)
  - `pumpAt(map: MapData, p: Vec3, radius: number): { stationId: string; pump: Vec3 } | null`
  - `class Refueller { tick(v: VehicleState, spec: RideSpec, ctx: { holding: boolean; atPump: boolean; stopped: boolean; coins: number; dt: number }): RefuelEvent[] }` with `RefuelEvent = { kind: 'refuelStarted' } | { kind: 'refuelled'; cost: number; fuel: number; reason: 'full' | 'released' | 'coins' | 'moved' }`
  - `OrderSystem.spendCoins(n: number): boolean` (false and no change when `n > totals.coins`)
  - New `SimEvent` kind `{ kind: 'fuelEmpty'; tier: RideTier }` (emitted once when the tank reaches 0)

Refuel rules: fuel rises at `refuel.tankPerSecond` while E is held, the vehicle is stopped (speed ≤ `stoppedSpeed`) and at a pump; cost accrues at `fullTankCoins × fuel added`; the session ends when the tank is full, E is released, the vehicle moves, or the next tick's accrued cost would round up above the player's Coins; it charges `ceil(accrued − 1e-9)`, which is never more than the Coins held.

- [ ] **Step 1: Write the failing tests**

```ts
test('the car burns a full tank over 5000 m and the motorbike over 6000 m', () => {});
test('fuelEmpty fires once; an empty car still drives at 3 m/s (Review Focus 2)', () => {});
test('a full car fill costs 80 Coins; half a tank costs 40', () => {});
test('Review Focus 2: with 30 Coins at an empty car pump, refuelling stops at 30/80 of a tank and charges at most 30', () => {});
test('no fuel while moving, away from a pump, or on the bicycle', () => {});
test('spendCoins refuses more than the player has', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- fuel OrderSystem`
Expected: FAIL

- [ ] **Step 3: Implement fuel, the burn in `stepVehicle`, `Refueller` and `spendCoins`**

The burn uses the horizontal distance the vehicle actually moved this tick.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @dm/shared test`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/shared && git commit -m "feat(vehicles): fuel burn, empty-tank crawl and paid refuelling at pumps" && git push
```

---

### Task 8: Navmeshes per tier and routing

**Files:**
- Create: `packages/tools/package.json` (`@dm/tools`, deps `@dm/shared` workspace, `recast-navigation` 0.43.1, `tsx`), `packages/tools/tsconfig.json`, `packages/tools/src/nav/geometry.ts` (port from `origin/sp2/city-map-poi` without the chute branch), `packages/tools/src/nav/build.ts`, `packages/tools/src/nav/validate.ts`, `packages/tools/src/bin/map-build.ts`, `packages/tools/src/bin/map-check.ts`, `packages/shared/src/world/nav.ts`, `map/nav/greybox-{walk,skateboard,bicycle,motorbike,car}.bin` (generated)
- Modify: root `package.json` (`map:build`, `map:check`; `check` becomes `pnpm lint && pnpm typecheck && pnpm test && pnpm map:check`), `pnpm-workspace.yaml` if needed, `packages/shared/package.json` (`recast-navigation` 0.43.1), root `vitest.config.ts` (tools tests)
- Test: `packages/tools/test/nav/build.test.ts`, `packages/tools/test/nav/validate.test.ts`, `packages/shared/test/world/nav.test.ts`

**Interfaces:**
- Consumes: `accessAllowed`, `AccessZone` (Task 2); the town and stations (Task 3); `ridingConfig.rides[t].collider/maxStepHeight/maxSlopeClimbDeg` and `movementConfig.capsule/controller` for agent sizes; `navConfig`
- Produces:
  - Tools: `buildTierNavMesh(map: MapData, tier: VehicleTier): NavMesh` — geometry = every solid, plus one blocker box per access zone forbidden to `tier` (the zone rect, from `minY` to `maxY + nav.blockerHeight`); agent radius = upright capsule radius or the lengthwise capsule's radius, climb = `maxStepHeight`, slope = `maxSlopeClimbDeg` (walk uses `movement.json`)
  - Tools: `validateGreyboxNav(map: MapData, router: NavRouter): string[]` — one message per failure of: every POI door reachable on foot from every hospital spawn and back; every package door within `carRoadMaxDoorDistance` (path on foot) of a point on the car mesh; at most `maxFoodOffCarShare` of food dropoffs farther than that; every pump and every bay slot on the car and motorbike meshes and reachable from every hospital bay
  - `pnpm map:build` writes the five binaries (`exportNavMesh`); `pnpm map:check` rebuilds them in memory, byte-compares with the committed files, runs the validator, and exits 1 with every message
  - Shared: `initNav(): Promise<void>`; `class NavRouter { static fromBinaries(bins: Record<VehicleTier, Uint8Array>, cfg?: NavConfig): NavRouter; distance(tier: VehicleTier, from: Vec3, to: Vec3): number /* Infinity unless the path starts within reachTolerance of from and ends within it of to */; closestPoint(tier: VehicleTier, p: Vec3, halfExtents?: Vec3): Vec3 | null; routeToDoor(tier: VehicleTier, from: Vec3, door: Vec3): RouteToDoor | null; destroy(): void }`
  - `interface RouteToDoor { drive: Vec3[]; footLeg: [Vec3, Vec3] | null; length: number }` — `drive` is the tier's path to the door, or, when the door is off the tier's mesh, to the mesh's closest point to the door, with `footLeg` from there to the door; `length` sums both

- [ ] **Step 1: Write the failing tests**

`packages/tools/test/nav/build.test.ts`:
```ts
test('the car mesh has no polygon inside an alley, steep-lane, stairs or path zone; the walk mesh covers the stairs', () => {});
test('building twice gives byte-identical binaries', () => {});
```
`packages/tools/test/nav/validate.test.ts`:
```ts
test('the committed greybox passes the validator with no messages', () => {});
test('moving a package door 60 m from any car road produces exactly one message naming it', () => {});
```
`packages/shared/test/world/nav.test.ts` (loads the committed binaries with `fs`):
```ts
test('walk distance between two street POIs is ≥ their straight-line distance and finite', () => {});
test('car route from the town gas station to town-poi-01 stops at the closest car point and adds a foot leg up the stairs', () => {});
test('bicycle route up to the terrace uses the steep lane (shorter than the car route via the ramp)', () => {});
test('distance is Infinity for a point inside a building', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/tools packages/shared/test/world/nav.test.ts`
Expected: FAIL (packages and modules missing)

- [ ] **Step 3: Implement the tools package, the binaries and `NavRouter`**

Port `geometry.ts`, `NavPaths` and `reaches` from `origin/sp2/city-map-poi:packages/tools/src/nav/` (read them there; recast reports partial paths as success, so `reaches` must check both ends). Run `pnpm install`, then `pnpm map:build` and commit the five binaries.

- [ ] **Step 4: Run all checks**

Run: `pnpm check`
Expected: PASS, including `map:check` ("map:check: 5 navmeshes match, 0 problems")

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(nav): one navmesh per tier, map:build and map:check, runtime NavRouter" && git push
```

---

### Task 9: Orders on vehicles

**Files:**
- Modify: `packages/shared/src/orders/OrderSystem.ts`, `packages/client/src/game/delivery.ts`, `packages/client/src/game/Game.ts`
- Test: `packages/shared/test/orders/OrderSystem.test.ts`, `packages/client/test/delivery.test.ts`

**Interfaces:**
- Consumes: `PlayerSim.mountCandidate`, `PlayerState.riding/lastRide`, `SimEvent` `crashed` (Tasks 5–6), `NavRouter.distance` (Task 8)
- Produces:
  - `OrderEvent` `fragileBroken.reason: 'fall' | 'respawn' | 'crash'`; `OrderSystem.onSimEvents` breaks carried Fragile orders on `crashed`
  - `DeliveryDeps` loses `capacityTier`; gains `rider(): { riding: RideTier | null; lastRide: RideTier | null; speed: number; mountCandidate(): RideTier | null }` and `distance: PathDistance`
  - `DeliveryLoop.capacityTier` becomes a getter: `riding ?? lastRide ?? 'walk'`; capacity follows it every tick (`setCapacity` already refuses switches that would drop orders); `DeliveryLoop.setCapacityTier` and the capacity save are removed
  - `Game` passes `distance = (a, b) => router.distance('walk', a, b)` (order distances stay on-foot paths: the timers' reference speed is the on-foot sprint, spec §3.2)

Rules (each one a test):
- `beforeStep`: an F press on foot whose `mountCandidate()` can't hold the active orders (`canSwitchCapacity`) is swallowed and shows "Can't ride the {tier}" with "Your orders don't fit: …" (the SP3 wording); nothing else changes.
- `afterStep`: while riding, the POI zones are empty, so nothing is picked up or handed over and no prep starts; riding into an active order's target zone shows "Get off to pick up" or "Get off to hand over", at most once per `ui.hintCooldownSeconds`.
- A crash with a carried Fragile order breaks it once; the popup says "Crashed · Fragile bonus lost".
- Offers come from `router.distance('walk', …)`; an unreachable door is never offered.

- [ ] **Step 1: Write the failing tests**

`OrderSystem.test.ts`:
```ts
test('a crashed event breaks a carried Fragile order once, not an order not yet picked up', () => {});
```
`delivery.test.ts`:
```ts
test('Review Focus 4: two food orders, last ride bicycle, F next to the skateboard is swallowed with the reason and both orders stay', () => {});
test('riding through the pickup zone does not pick up and shows the get-off hint once per cooldown', () => {});
test('stepping off inside the pickup zone starts the food prep', () => {});
test('capacity follows the ridden tier, then the last ridden tier on foot', () => {});
test('Review Focus 5: after a tow, carried orders are kept and the Fragile break popup shows once', () => {});
test('an offer whose door has no walk path is never generated', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/shared/test/orders packages/client/test/delivery.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`streetDistance` stays exported for tests but the game no longer uses it.

- [ ] **Step 4: Run all checks**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(orders): capacity from the vehicle, deliveries on foot, navmesh distances, Fragile crash damage" && git push
```

---

### Task 10: Summon and the Garage app

**Files:**
- Create: `packages/shared/src/vehicles/summon.ts`, `packages/client/src/ui/phone/garageApp.ts`
- Modify: `packages/shared/src/vehicles/Garage.ts`, `packages/client/src/ui/phone/Phone.ts` (Garage replaces its stub), `packages/client/src/ui/phone/stubApp.ts` (drop `garage`), `packages/client/src/game/delivery.ts`
- Test: `packages/shared/test/vehicles/summon.test.ts`, `packages/client/test/garageApp.test.ts`, `packages/client/test/phone.test.ts`

**Interfaces:**
- Consumes: `Garage`, `VehicleBody.fitsAt` (Tasks 5–6), `NavRouter.closestPoint` (Task 8), `forbiddenZoneAt` (Task 2)
- Produces:
  - `type SummonResult = 'ok' | 'riding' | 'carried' | 'tooClose' | 'cooldown' | 'noSpot'`
  - `findRoadSpot(router: NavRouter, garage: Garage, tier: RideTier, player: Vec3, cfg?: RidingConfig): { position: Vec3; heading: number } | null` — `ringSamples` points on a ring of radius `minClearance + 2` around the player, each snapped with `closestPoint(tier, …)`; the nearest one that is at least `minClearance` from the player, outside every zone forbidden to the tier, and where `fitsAt` holds; if none, `closestPoint(tier, player, searchRadius on x/z)` under the same checks; else null. Heading: along the player's heading.
  - `Garage.summon(t: RideTier, player: Vec3, now: number, spot: (t: RideTier) => { position: Vec3; heading: number } | null): SummonResult` — 'tooClose' when within `minDistance` (100 m), 'cooldown' within `cooldownSeconds` (60 s, one cooldown for all vehicles) of the last successful summon; a failed summon never starts the cooldown
  - `Garage.summonReadyAt: number`
  - `GarageRow { tier: RideTier; status: 'riding' | 'carried' | 'parked'; distance: number | null; fuel: number | null; summon: SummonResult }`; `garageRows(garage, player, now): GarageRow[]`; `createGarageApp(onSummon: (t: RideTier) => void): PhoneAppView` rendering one row per owned vehicle: name, "Riding" / "Carried" / "Parked · 240 m", a fuel bar for motorbike and car, and a Summon button disabled with the reason ("Nearby", "Ready in 42 s", "Riding")
  - `PhoneCallbacks.summon(t: RideTier): void`; `DeliveryLoop.summon(t)` shows "{Tier} is here" or the refusal ("No road nearby" for 'noSpot')
  - Spec §13 "Vehicle stuck": the Settings app (still mostly a stub) gains a "Respawn at nearest hospital" button: the courier respawns on foot like an out-of-bounds respawn (orders kept, Fragile lost), vehicles stay where they are. `PhoneCallbacks.respawn(): void`, `PlayerSim.respawnAtHospital(): SimEvent[]`

- [ ] **Step 1: Write the failing tests**

`summon.test.ts`:
```ts
test('a car 240 m away comes to a spot ≥ 3 m from the player, on the car mesh, outside alleys', () => {});
test('within 100 m: tooClose; a second summon 30 s later: cooldown; 60 s later: ok', () => {});
test('Review Focus 3: player on the stairs: the car lands at the nearest car-mesh point off the stairs', () => {});
test('Review Focus 3: no car mesh within the search radius: noSpot, and the cooldown is not started', () => {});
test('the skateboard (carried) and the ridden vehicle cannot be summoned', () => {});
```
`garageApp.test.ts`:
```ts
test('rows show status, distance and fuel; Summon is disabled with "Nearby" within 100 m', () => {});
test('clicking Summon calls onSummon with the tier', () => {});
test('Settings: Respawn puts the courier on foot at the nearest hospital and keeps the parked car where it was', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/shared/test/vehicles/summon.test.ts packages/client/test/garageApp.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement summon and the Garage app**

Summon moves the vehicle with `VehicleBody.place`. The Garage app re-renders with the HUD model tick (as the Orders app does).

- [ ] **Step 4: Run all checks**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(garage): summon to the nearest legal road spot, Garage phone app" && git push
```

---

### Task 11: Vehicles on screen

**Files:**
- Create: `packages/client/src/render/vehicles/vehicleMeshes.ts`, `packages/client/src/render/vehicles/VehicleViews.ts`, `packages/client/src/render/gasStationMeshes.ts`, `packages/client/src/render/accessZoneMeshes.ts`
- Modify: `packages/client/src/render/courier/animState.ts`, `packages/client/src/render/courier/CourierModel.ts`, `packages/client/src/render/courierPlaceholder.ts`, `packages/client/src/render/chaseCamera.ts`, `packages/client/src/game/cameraQueries.ts`, `packages/client/src/game/Game.ts`, `packages/client/src/ui/debugOverlay.ts`, `packages/client/src/render/palette.ts`
- Test: `packages/client/test/vehicleMeshes.test.ts`, `packages/client/test/animState.test.ts`, `packages/client/test/chaseCamera.test.ts`, `packages/client/test/cameraQueries.test.ts`

**Interfaces:**
- Consumes: `Garage.state/spot` (Task 6), `PlayerState.riding`, `map.gasStations`, `map.accessZones`
- Produces:
  - `buildVehicleMesh(tier: RideTier, spec: RideSpec): THREE.Group` — code-built placeholders from boxes and cylinders sized from the collider (skateboard deck + 4 wheels; bicycle frame + 2 wheels; motorbike body + 2 wheels; car body + cabin + 4 wheels); one merged material set per tier
  - `class VehicleViews { constructor(scene: THREE.Scene); update(garage: Garage, alpha: number): void }` — one mesh per owned vehicle, hidden while carried, interpolated between ticks, pitched to the ground normal
  - `animFor`: riding the skateboard → the `board` pose; bicycle and motorbike → `bike`; car → courier hidden
  - `pivotHeightFor` / `ChaseCamera` use `camera.chase.rides[tier]` while riding (distance, height, pivot)
  - `physicsSphereCast` and `physicsWallProbe` take `exclude: () => Collider[]` (courier plus the ridden vehicle)
  - `buildGasStationMeshes(map: MapData): THREE.Group` (a "FUEL" sign on each canopy and a glow on each pump point); `buildAccessZoneMeshes(map: MapData): THREE.Group` (translucent, coloured per kind, shown with the F3 overlay)
  - Debug overlay lines: `ride: car · 21.4 m/s · fuel 73 %`

- [ ] **Step 1: Write the failing tests**

```ts
test('each vehicle mesh fits within its collider footprint ±10 % and stands on y = 0', () => {});
test('animFor: bicycle → bike pose, car → hidden, skateboard → board pose', () => {});
test('chase camera distance while riding the car is camera.chase.rides.car.distance', () => {});
test('camera casts ignore the ridden vehicle collider but hit a parked one', () => {});
test('the draw-call cost of four vehicles plus two stations is ≤ 24', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/client test -- vehicleMeshes animState chaseCamera cameraQueries`
Expected: FAIL

- [ ] **Step 3: Implement the meshes, the views and the camera changes**

Colours come from `palette.ts` (add vehicle colours there). No pack art.

- [ ] **Step 4: Run all checks**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(client): vehicle placeholders, rider poses, vehicle camera, gas stations and access-zone overlay" && git push
```

---

### Task 12: HUD next-stop arrow, speed, fuel and load; Map routes; phone while riding

**Files:**
- Create: `packages/client/src/game/routes.ts`
- Modify: `packages/client/src/ui/hudModel.ts`, `packages/client/src/ui/hud.ts`, `packages/client/src/ui/styles.css`, `packages/client/src/ui/phone/mapApp.ts`, `packages/client/src/ui/minimap.ts`, `packages/client/src/game/delivery.ts`
- Test: `packages/client/test/routes.test.ts`, `packages/client/test/hudModel.test.ts`, `packages/client/test/hud.test.ts`, `packages/client/test/mapApp.test.ts` (new), `packages/client/test/minimap.test.ts`, `packages/client/test/delivery.test.ts`

**Interfaces:**
- Consumes: `NavRouter.routeToDoor` (Task 8), rider state (Task 9), `Garage` (Task 6), `map.gasStations`
- Produces:
  - `class RouteCache { constructor(router: NavRouter, refreshSeconds: number); get(tier: VehicleTier, from: Vec3, targetId: string, door: Vec3, now: number): RouteToDoor | null }` — recomputes when the target or tier changes, after `refreshSeconds`, or when the player is 5 m off the last route start
  - `HudModel.nextStop: { orderId: string; name: string; distance: number; bearing: number /* world yaw to the route's next corner */ } | null` — the active order whose current target has the shortest route for the current tier (ties: the oldest order); `distance` is the route length, rounded
  - `HudModel.ride: { tier: RideTier; speed: number; fuel: number | null } | null`
  - `HudOrder.distance` becomes the route length (it was straight-line)
  - HUD: an arrow at top centre rotated by `bearing − camera yaw`, the stop name and "240 m"; a speed readout ("21 m/s") and, on motorbike and car, a fuel gauge bottom left while riding; the load chip keeps `loadText`
  - Map app: the route for the current tier as a solid line and the foot leg dashed; gas stations as fuel icons; the minimap shows gas stations too
  - Phone while riding (`beforeStep`): Tab and M open the phone only when not riding or when speed ≤ `stoppedSpeed`; otherwise they show "Stop to use the phone" (hint cooldown); while the phone is open on a vehicle the sim gets an idle input with the handbrake held, so the vehicle stays put; Y keeps accepting the top offer while riding (unchanged)
  - Refuel wiring (`afterStep`): `Refueller.tick` with E held, `pumpAt`, stopped and riding; a `refuelled` event calls `spendCoins(cost)` and shows "Refuelled · −{cost} coins"; an E press at a pump with no tank shows "This one runs on legs"

- [ ] **Step 1: Write the failing tests**

```ts
test('nextStop picks the target with the shortest route for the ridden tier', () => {});
test('the arrow bearing points along the first route segment, not straight at the door', () => {});
test('RouteCache recomputes after refreshSeconds or a 5 m move, not every frame', () => {});
test('HUD shows the fuel gauge on the car and not on the bicycle', () => {});
test('Map app draws the car route solid and the foot leg dashed', () => {});
test('Tab at 8 m/s on the car does not open the phone and shows the hint; at rest it opens and the car holds still', () => {});
test('Y accepts the top offer while riding at speed', () => {});
test('holding E at a pump on the car charges coins and fills the tank; on foot nothing happens', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/client test -- routes hudModel hud mapApp minimap delivery`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run all checks**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(hud): next-stop arrow on the route, speed and fuel; Map routes per vehicle; phone and refuel while riding" && git push
```

---

### Task 13: Saved vehicles, dev panel and debug hooks

**Files:**
- Modify: `packages/client/src/game/progress.ts`, `packages/client/src/ui/devPanel.ts`, `packages/client/src/game/debugHooks.ts`, `packages/client/src/game/Game.ts`
- Test: `packages/client/test/progress.test.ts`, `packages/client/test/devSettings.test.ts`

**Interfaces:**
- Consumes: `Garage.snapshot`, `defaultGarage`, `Garage.setOwned` (Task 6)
- Produces:
  - `Progress { totals: Totals; garage: SavedVehicle[]; lastRide: RideTier | null }`, key `dm.progress.v3`; a v2 record's totals carry over, its `capacityTier` is dropped; saved on delivery, dismount, refuel, summon and ownership changes; a vehicle saved as `riding` loads as parked where it was
  - Dev panel "Vehicles" folder (replaces "Capacity (dev, until SP4)"): an Owned checkbox per ride, "Fill all tanks", "+500 coins"; "Reset progress" restores `defaultGarage`
  - Debug hooks: `dm.ride(tier)` (park the tier next to the player and mount it), `dm.vehicles()` (tier, spot, position, fuel), `dm.setCoins(n)`, `dm.route()` (the HUD's nextStop and route points); `dm.player()` reports `riding` instead of `onBoard`

- [ ] **Step 1: Write the failing tests**

```ts
test('progress v3 round-trips garage, lastRide and totals', () => {});
test('a v2 record keeps its totals and gets the default garage', () => {});
test('a bad vehicle entry falls back to the default for that tier only', () => {});
test('a vehicle saved while riding loads as parked at that spot', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/client test -- progress devSettings`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run all checks**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(client): saved garage, dev vehicle toggles, vehicle debug hooks" && git push
```

---

### Task 14: End-to-end tests, screenshots, performance and the spec

**Files:**
- Modify: `packages/client/e2e/smoke.spec.ts`, `README.md` (controls), `docs/superpowers/specs/2026-10-12-delivery-maxing-design.md`, `assets/CREDITS.md` (state that SP4 vehicles are code-built placeholders, no new assets)
- Create: `docs/playtest/sp4/*.png`

**Interfaces:**
- Consumes: the debug hooks (Task 13)

- [ ] **Step 1: Replace the SP3 capacity-preset e2e tests and add the vehicle ones**

Remove "a package offer needs the car preset" and "dev panel capacity preset …"; add, driven by sim ticks:
```ts
test('F at the spawn bay mounts the car; 12 s of W reaches 28 m/s and never more', async ({ page }) => {});
test('the car stops at an alley mouth; the motorbike rides through', async ({ page }) => {});
test('the bicycle climbs the steep lane; the skateboard is stopped by it', async ({ page }) => {});
test('a package offer appears on the motorbike and is delivered on foot after getting off', async ({ page }) => {});
test('Fragile package: a 12 m/s wall crash shows the bonus-lost popup', async ({ page }) => {});
test('refuel at the town pump: coins drop, the fuel gauge fills', async ({ page }) => {});
test('Garage app summons the car 200 m away to the player', async ({ page }) => {});
test('Tab while driving shows the hint; stopped, the phone opens', async ({ page }) => {});
test('draw calls stay under the budget with all four vehicles in view', async ({ page }) => {});
```

- [ ] **Step 2: Screenshots**

Save to `docs/playtest/sp4/`: `skateboard.png`, `bicycle.png`, `motorbike.png`, `car.png`, `hud-arrow-fuel.png`, `map-route-car.png`, `map-route-foot.png`, `garage-app.png`, `gas-station.png`, `test-town.png`.

- [ ] **Step 3: Performance**

Run the existing draw-call budget test with the vehicles in view and log the average frame time over 600 headless frames in the e2e output (60 fps on a mid-range laptop is checked by shiko's playtest; headless timing is a regression signal only).

- [ ] **Step 4: Update the spec in the same PR**

§15 row 4: "Built (PR #N)." in front of the existing text. §5 Navmeshes: one per tier (walk, skateboard, bicycle, motorbike, car). §4.2: the skateboard is carried when you get off (if Decision 1 stands). §4.1: remove nothing (Q was never in the rev. 2 key list). Record any decision shiko changed when approving this plan.

- [ ] **Step 5: Run everything**

Run: `pnpm check && pnpm e2e`
Expected: PASS; paste both summary lines in the PR and the final message.

- [ ] **Step 6: Commit and push**

```bash
git add -A && git commit -m "test(e2e): SP4 vehicle tests, playtest screenshots; spec §15 row 4" && git push
```
