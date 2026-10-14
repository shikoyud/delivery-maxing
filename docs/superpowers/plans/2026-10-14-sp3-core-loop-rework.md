# SP3 Core Loop Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the HUB-and-parkour loop with the revision-2 loop: food and package orders that go pickup → dropoff, offered on an in-game phone anywhere in the city, with slots and weight, timers, a cancel lockout, and hospitals as the spawn points — on the current greybox map, single-player.

**Architecture:** The shared package keeps the fixed-step `PlayerSim` but loses every parkour mode (wall-run, zip line, grind, jump pad, boost orb, chute) and gains the sprint toggle and slide boost from the SP2 branch. `OrderSystem` is rewritten around *offers* (generated near the player, expiring) and *active orders* with a pickup and a dropoff door; the map schema gains hospitals and POI roles and loses the HUB and the movement features. The client replaces the HUB Order Board with a phone (Orders, Map, Wallet, stub apps) and a slimmer HUD. Vehicles arrive in SP4: this sub-project only carries the *capacity* table (slots, max kg) so package orders can be exercised through a dev-panel preset.

**Tech Stack:** TypeScript, pnpm workspaces (`@dm/shared`, `@dm/client`), Three.js, Rapier, Vitest, Playwright (headless Chromium, `?debug` hooks, sim-tick driven).

**Spec:** `docs/superpowers/specs/2026-10-12-delivery-maxing-design.md` (revision 2) §3 Core loop, §4.1 On foot, §4.2 table (capacity only), §5 (spawn/respawn), §8 Phone, §10 (minimum plausible time is *not* in SP3: no server), §15 row 3. City map design `docs/superpowers/specs/2026-10-14-city-map-design.md` §6 (POI roles, items, weight classes, selection rules) for the data shapes the greybox must already carry.

## Global Constraints

- Tuning values live in `config/*.json`, never hard-coded (project rule). New values and their spec sources are listed in Task 5.
- Node ≥ 22, pnpm 10, TypeScript ~6.0, ESLint flat config; `pnpm check` = lint + typecheck + unit tests must pass at every commit; `pnpm e2e` at the end of Task 12.
- Fixed 30 Hz sim on the shared package; all gameplay code reads actions, never raw keys (spec §4.1). Default keys from spec §4.1: Tab = `phone`, Y = `accept`, E = `interact`, F = `mount` (bound but unused until SP4), C crouch (never Ctrl), Shift sprint toggle.
- No HUB, no Order Board, no parkour props anywhere in code, map data, UI copy or tests after this sub-project. "Checkpoints" are gone; respawn goes to the nearest hospital.
- No Amazon or real delivery-app names in copy; POI and business names are fictional (spec §16).
- Commit and push often (branch `sp3/core-loop-rework` from `main`). One PR titled `[SP3] Core loop rework`.
- Playtest deliverables: Playwright screenshots of the phone (Orders, Map, Wallet), a delivery, the hospital spawn; pasted summary lines of `pnpm check` and `pnpm e2e`.

## Review Focus

1. **An offer expires on the tick the player accepts it.** `accept` must report `expired` (not throw, not accept) and the phone must re-render without the card. Test in Task 7 (`accept` after `expiresAt`) and Task 10 (render with an expired offer removed).
2. **Weight is counted against what is already carried.** A 30 kg package offered to a motorbike (50 kg) that already carries 25 kg must be refused with `too_heavy`, and such offers must not be generated in the first place. Tests in Task 6 (generation filters by *remaining* kg) and Task 7 (`accept` returns `too_heavy`).
3. **Cancelling an order that was already picked up.** The order disappears, no points, the lockout starts once, and the carried count the courier model shows drops. Test in Task 7 and Task 9 (`carriedCount()` after cancel).
4. **No eligible dropoff for a pickup.** With all dropoff doors inside the 12 m spacing of the active orders' doors, or outside the food distance window, the generator returns `null` and the system simply tries again at the next interval instead of offering a broken order. Tests in Task 6 (returns `null`) and Task 7 (no event, `nextOfferAt` advances).
5. **Respawn with a Fragile package.** Falling out of bounds respawns at the *nearest hospital*, keeps the order, breaks the Fragile bonus once, and never repeats the break on the same order. Tests in Task 3 (nearest hospital) and Task 7 (`fragileBroken` emitted once).

---

### Task 1: Port the sprint toggle and slide boost from the SP2 branch

The spec's §4.1 sprint toggle (Shift) and slide burst (+4 m/s, 2 s cooldown) exist only as two commits on the closed branch `sp2/city-map-poi`. Cherry-pick them, then apply the two revision-2 numbers: on-foot speed cap 12 m/s and mantle max 1.2 m.

**Files:**
- Modify (by cherry-pick): `packages/shared/src/movement/{PlayerSim,ground,slide,types}.ts`, `packages/shared/src/movement/sprint.ts` (new), `config/movement.json`, `packages/shared/src/config/types.ts`, `packages/client/src/game/Game.ts`, `packages/client/src/ui/debugOverlay.ts`, `packages/client/index.html`, `packages/client/e2e/smoke.spec.ts`, tests `packages/shared/test/movement/{sprint,slide,groundStall}.test.ts`, `packages/shared/test/helpers/simHarness.ts`, `packages/client/test/playHint.test.ts`, `packages/shared/test/world/greyboxContent.test.ts`
- Modify: `config/movement.json` (`speedCap`, `mantle.maxHeight`), `packages/shared/test/movement/mantle.test.ts`

**Interfaces:**
- Produces: `PlayerState.sprinting: boolean`; `MovementConfig.slide.boostSpeed: number`, `MovementConfig.slide.boostCooldown: number` (names as the cherry-picked commits define them — read `packages/shared/src/movement/slide.ts` after the pick and use those exact names in later tasks).

- [ ] **Step 1: Create the branch and cherry-pick**

```bash
git checkout -b sp3/core-loop-rework main
git fetch origin sp2/city-map-poi
git cherry-pick 5ec868f dc52513
```
Expected: both apply cleanly (they predate the city work). If `packages/client/e2e/smoke.spec.ts` conflicts, keep both sides' tests.

- [ ] **Step 2: Run the ported tests**

Run: `pnpm --filter @dm/shared test -- sprint slide groundStall`
Expected: PASS

- [ ] **Step 3: Write the failing tests for the two new numbers**

In `packages/shared/test/movement/mantle.test.ts` add:
```ts
test('a 1.4 m ledge is not mantled (max 1.2 m)', () => { /* ledge at 1.4 m, run at it: mode never 'mantle', feet y stays < 0.5 */ });
```
In `packages/shared/test/movement/slide.test.ts` add:
```ts
test('a boosted slide from sprint never exceeds the 12 m/s on-foot cap', () => { /* horizontalLength(velocity) <= 12 every tick */ });
```

- [ ] **Step 4: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- mantle slide`
Expected: the 1.4 m ledge test FAILS (it mantles at max 1.5), the cap test FAILS or passes trivially (cap 18): keep it as the regression guard either way.

- [ ] **Step 5: Change `config/movement.json`**

`"speedCap": 12`, `"mantle": { ..., "maxHeight": 1.2, ... }`. Update any existing mantle test that climbs a ledge between 1.2 m and 1.5 m to use a ≤ 1.2 m ledge.

- [ ] **Step 6: Run the shared tests**

Run: `pnpm --filter @dm/shared test`
Expected: PASS

- [ ] **Step 7: Commit and push**

```bash
git add -A && git commit -m "feat(movement): sprint toggle and slide boost (ported); on-foot cap 12 m/s, mantle 1.2 m"
git push -u origin sp3/core-loop-rework
```

---

### Task 2: Remove the parkour kit from the shared sim

**Files:**
- Delete: `packages/shared/src/movement/{wallRun,zipLine,rail}.ts`, tests `packages/shared/test/movement/{wallRun,zipLine,rail}.test.ts`
- Modify: `packages/shared/src/movement/types.ts`, `packages/shared/src/movement/PlayerSim.ts`, `packages/shared/src/movement/triggers.ts`, `packages/shared/src/movement/ground.ts` (chute surface branch, if any), `packages/shared/src/movement/board.ts` (rail entry), `packages/shared/src/movement/slide.ts` (chute), `packages/shared/src/config/types.ts`, `config/movement.json`, `packages/shared/src/index.ts`, `packages/shared/test/helpers/simHarness.ts`, `packages/shared/test/movement/triggers.test.ts`, `packages/shared/test/movement/board.test.ts`, `packages/shared/test/world/fixtures.ts`
- Test: `packages/shared/test/movement/types.test.ts` (new, tiny)

**Interfaces:**
- Produces:
  - `type MoveMode = 'ground' | 'air' | 'slide' | 'mantle'`
  - `PlayerState` without `zip`, `grind`, `wallRun`, `wallChainStartY`, `boostLeft`, `padCooldown`
  - `type SimEvent = { kind: 'jumped' } | { kind: 'landed'; fallHeight: number } | { kind: 'respawned'; hospitalId: string } | { kind: 'boardToggled'; onBoard: boolean }`
  - `interface StatModifiers { speedMul: number; jumpHeightMul: number; canSprint: boolean }`, `NO_MODS = { speedMul: 1, jumpHeightMul: 1, canSprint: true }`
  - `PlayerSim.step(input: InputFrame, mods: StatModifiers, time: number): SimEvent[]` (no `WorldFeatureState` parameter; `createWorldFeatureState` deleted)
  - `MovementConfig` without `wallRun`, `zipLine`, `jumpPad`, `boostOrb`, `rail`, `chute`; `board` keeps its fields minus `railMinSpeed`
  - `applyTriggers(state, body, map, cfg): SimEvent[]` handles out-of-bounds only and respawns at `nearestHospital(map, state.lastGrounded)` (Task 3 provides it; until then respawn at `map.hospitals[0]` — Task 3 replaces the call)
  - `MapData` temporarily keeps `hospitals` undefined; Task 3 adds it. To keep this task compiling, respawn target in this task is `map.spawn` — see Step 3.

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/movement/types.test.ts`:
```ts
test('NO_MODS allows sprint', () => { expect(NO_MODS.canSprint).toBe(true); });
```
In `packages/shared/test/movement/ground.test.ts` add:
```ts
test('sprint toggle is ignored while mods.canSprint is false', () => { /* Shift pressed + W held, mods {canSprint:false}: speed settles at runSpeed 5.5, state.sprinting false */ });
```
In `packages/shared/test/movement/triggers.test.ts` replace the pad/orb tests with:
```ts
test('falling below outOfBoundsY respawns at the map spawn and emits respawned', () => { /* events contain { kind: 'respawned', hospitalId: 'spawn' } for now */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- types ground triggers`
Expected: FAIL (`canSprint` missing; pad tests reference removed exports)

- [ ] **Step 3: Delete the modules and prune the state**

Remove the three files, their imports and the `tryZip`/`tryGrind`/wall-run branches in `PlayerSim.stepMovement`; remove the chute surface and `Surface` handling from `slide.ts`/`ground.ts`; remove rail entry from `board.ts`. In `triggers.ts` keep `enterAir` and the out-of-bounds respawn; the respawn target is `map.spawn` (a `Vec3` added to `MapData` in this task as a stopgap; Task 3 replaces it with hospitals). Sprint: in `sprint.ts`, a toggle press with `mods.canSprint === false` is ignored and `sprinting` is forced false. Prune `MovementConfig`, `config/movement.json` and `simHarness.ts` accordingly.

- [ ] **Step 4: Run the whole shared package**

Run: `pnpm --filter @dm/shared typecheck && pnpm --filter @dm/shared test`
Expected: PASS (the client will not compile until Task 4; that is expected)

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "refactor(movement): remove wall-run, zip line, rail, pads, orbs and chutes from the shared sim"
git push
```

---

### Task 3: Map schema v2 — hospitals, POI roles, order rules; greybox data

**Files:**
- Modify: `packages/shared/src/world/mapTypes.ts`, `packages/shared/src/world/greybox.ts`, `packages/shared/src/world/zones.ts`, `packages/shared/src/world/distance.ts`, `packages/shared/src/movement/triggers.ts`, `map/greybox.json`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/world/hospitals.ts`
- Test: `packages/shared/test/world/{hospitals,zones,greyboxContent,distance}.test.ts`

**Interfaces:**
- Produces (in `mapTypes.ts`):
  - `type PoiRole = 'foodPickup' | 'packagePickup' | 'dropoffFood' | 'dropoffPackage'`
  - `interface Poi { id: string; position: Vec3; district: District; kind: 'door' | 'counter'; name: string; roles: PoiRole[]; items?: string[]; weightKg?: [number, number] }` — `items` on pickups (the order text draws one), `weightKg` on package senders
  - `interface Hospital { id: string; name: string; center: Vec3; safeRadius: number; spawn: Vec3; spawnYaw: number }`
  - `interface OrderRules { bands: { shortMax: number; mediumMax: number }; foodDropoff: { min: number; max: number }; maxPickupDistance: number }`
  - `interface MapData { size: number; solids: Solid[]; pois: Poi[]; hospitals: Hospital[]; orderRules: OrderRules }` (no `hub`, `zipLines`, `jumpPads`, `boostOrbs`, `rails`, `checkpoints`, `spawn`)
  - `type SolidKind = 'ground' | 'building' | 'prop' | 'ramp'`; `Surface` removed
- Produces (in `hospitals.ts`): `nearestHospital(map: MapData, p: Vec3): Hospital` (horizontal distance to `center`); `inSafeZone(map: MapData, p: Vec3): Hospital | null`
- Produces (in `zones.ts`): `interface PlayerZones { poiIds: ReadonlySet<string>; safeZone: string | null }`, `playerZones(p, map, zonesCfg)`
- Produces (in `distance.ts`): `bandFor(d, bands)` unchanged; `buildPoiTable` removed (no HUB distance). `PathDistance` and `streetDistance` stay.
- `SimEvent 'respawned'` carries `hospitalId` (the stopgap `'spawn'` from Task 2 goes away).

- [ ] **Step 1: Write the failing tests**

`hospitals.test.ts`:
```ts
test('nearestHospital picks by horizontal distance', () => { /* two hospitals, point nearer the second → id of the second */ });
test('inSafeZone is null outside safeRadius and the hospital inside', () => {});
```
`zones.test.ts`: replace plaza/drop-zone tests with `safeZone` and `poiIds` tests.
`greyboxContent.test.ts` (rewrite the content checks):
```ts
test('greybox has 4 hospitals with distinct names and spawns on the ground', () => {});
test('every POI has at least one role, a name, and a ground-level position reachable without parkour (y <= 1.2 or kind door at street level)', () => {});
test('food pickups carry items; package pickups carry items and a weightKg range within [1,150]', () => {});
test('at least 6 pickups (4 food, 2 package) and 14 dropoffs', () => {});
test('no solids of kind chute or hub, and no feature arrays remain', () => {});
```
`triggers.test.ts`: `respawned` event carries the nearest hospital id.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- hospitals zones greyboxContent triggers`
Expected: FAIL

- [ ] **Step 3: Change the types, data and functions**

`map/greybox.json`: delete `zipLines`, `jumpPads`, `boostOrbs`, `rails`, `checkpoints`, `hub`, the `hub-kiosk` solid, every `chute` solid and `surface` field; add `hospitals` (4: at the old checkpoint positions `downtown-cp-01`, `harbor-cp-01`, `hillside-cp-02`, `suburbs-cp-01` or equivalent ground points, `safeRadius: 18`, names "Downtown General", "Harbor Clinic", "Hillside Medical", "Suburbs Hospital", each `spawn` 8 m in front of `center`); add `orderRules: { bands: { shortMax: 150, mediumMax: 350 }, foodDropoff: { min: 80, max: 400 }, maxPickupDistance: 250 }` (greybox values; the city uses spec values); for every POI set `name`, `roles`, lower any balcony/rooftop POI to its street-level ground point and `kind: 'door'`; make 4 food pickups (`items` such as ["pizza", "burger meal", "coffee and donuts", "noodle box"]), 2 package pickups (`weightKg: [2, 20]` and `[10, 150]`), the rest dropoffs with both dropoff roles (two of them `dropoffFood` only). Fictional names: "Pier 9 Diner", "Harbor Apartments 3B", etc.
Update `mapTypes.ts`, `greybox.ts` (nothing to expand for features), `zones.ts`, `distance.ts`, `triggers.ts` (`nearestHospital`), `index.ts` (export `hospitals.ts`; drop `buildPoiTable`).

- [ ] **Step 4: Run the shared tests**

Run: `pnpm --filter @dm/shared typecheck && pnpm --filter @dm/shared test`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(world): hospitals, POI roles and order rules in the map schema; greybox v2 data"
git push
```

---

### Task 4: Client cleanup — compile against the pruned sim and map

The client must build again before any new UI. This task removes HUB/feature rendering, parkour poses and camera roll, and stubs the delivery loop just enough to compile; Task 9 rewrites it.

**Files:**
- Delete: `packages/client/src/render/featureMeshes.ts`, `packages/client/src/render/hubMeshes.ts`, `packages/client/src/ui/orderBoard.ts`, tests `hubMeshes.test.ts`, `orderBoard.test.ts`
- Create: `packages/client/src/render/poiMeshes.ts`, `packages/client/src/render/hospitalMeshes.ts`
- Modify: `packages/client/src/game/Game.ts`, `packages/client/src/game/delivery.ts` (temporarily reduced to a no-op class with the same `beforeStep/afterStep/draw/statModifiers/carriedCount` surface), `packages/client/src/game/debugHooks.ts`, `packages/client/src/render/chaseCamera.ts`, `packages/client/src/render/courier/{CourierModel,animState}.ts`, `packages/client/src/clientConfig.ts`, `config/client.json`, `packages/client/src/input/actionState.ts`, `packages/client/src/game/interpolation.ts`, tests `chaseCamera.test.ts`, `animState.test.ts`, `courierModel.test.ts`, `actionState.test.ts`, `clientConfig.test.ts`, `interpolation.test.ts`
- Test: `packages/client/test/{poiMeshes,hospitalMeshes}.test.ts`

**Interfaces:**
- Produces:
  - `buildPoiMeshes(map: MapData, radius: number): { group: THREE.Group; setTargets(ids: ReadonlySet<string>): void; setHighlight(id: string | null): void }` — a door marker per POI coloured by role (food pickup orange, package pickup purple, dropoff grey; palette entries `poiFood`, `poiPackage`, `poiDrop`)
  - `buildHospitalMeshes(map: MapData): THREE.Group` — a white block with a red cross per hospital and a flat ring at `safeRadius`
  - `config/client.json` `input.bindings` gains `"phone": ["Tab"]`, `"accept": ["KeyY"]`, `"mount": ["KeyF"]`; `camera.wallRunRollDeg` and `rollEaseRate` removed; `courier.poses` loses `wallrunL`, `wallrunR`, `zip`, `grind`
  - `ActionState` button actions: `'jump' | 'crouch' | 'sprint' | 'interact' | 'hit' | 'board' | 'phone' | 'accept' | 'mount'`; `InputFrame` (shared `inputFrame.ts`) gains `phone`, `accept`, `mount` `ButtonState`s
  - Debug API: remove `orbVisible`, `featurePosition`, `kiosk`, `boardOpen`; add `hospitals(): Hospital[]`, `safeZone(): string | null`

- [ ] **Step 1: Write the failing tests**

`poiMeshes.test.ts`:
```ts
test('one marker per POI, coloured by its first pickup role or dropoff', () => {});
test('setTargets raises only the targeted markers', () => {});
```
`hospitalMeshes.test.ts`: `test('one cross block and one ring per hospital', ...)`.
`actionState.test.ts`: add `test('Tab latches phone, Y latches accept, F latches mount', ...)`.
`clientConfig.test.ts`: assert the three new bindings exist and `wallRunRollDeg` does not.

- [ ] **Step 2: Run the client typecheck to see the breakage**

Run: `pnpm --filter @dm/client typecheck`
Expected: errors in Game, delivery, debugHooks, chaseCamera, courier, featureMeshes, hubMeshes, orderBoard

- [ ] **Step 3: Make the client compile**

Delete the listed files; implement `poiMeshes.ts` and `hospitalMeshes.ts`; remove wall-run roll from `chaseCamera.ts` and the four poses from the courier; add the bindings and `InputFrame` fields; reduce `delivery.ts` to a compiling stub (constructor takes `DeliveryDeps` without `backpackCapacity`; `statModifiers()` returns `NO_MODS`); spawn the player at `map.hospitals[0].spawn` with `spawnYaw`; prune `debugHooks.ts`; update `smoke.spec.ts` by deleting the orb, zip-line, wall-run, feature-screenshot, kiosk and board tests (Task 12 writes the replacements).

- [ ] **Step 4: Run the full check**

Run: `pnpm check`
Expected: lint, typecheck and unit tests PASS (e2e not run here)

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "refactor(client): drop HUB, order board and parkour rendering; POI and hospital markers; phone/accept/mount bindings"
git push
```

---

### Task 5: Orders v2 — config, types and pure rules

**Files:**
- Modify: `config/orders.json` (rewrite), `packages/shared/src/config/types.ts`, `packages/shared/src/config/index.ts` (loads `vehicles.json`), `packages/shared/src/orders/types.ts` (rewrite), `packages/shared/src/orders/rules.ts` (rewrite), `packages/shared/src/index.ts`
- Create: `config/vehicles.json`
- Test: `packages/shared/test/orders/rules.test.ts` (rewrite), `packages/shared/test/config/config.test.ts`

**Interfaces:**
- `config/orders.json` (spec §3.2, §3.4, §3.5, §3.6, map design §6.3):
  ```json
  { "offers": { "maxShown": 3, "lifetimeSeconds": 20, "minIntervalSeconds": 8, "maxIntervalSeconds": 15 },
    "lockout": { "seconds": 45 },
    "spacing": { "doorMeters": 12, "reuseSeconds": 180 },
    "referenceSpeed": 8,
    "hot": { "distanceFactor": 1.3, "extraSeconds": 20 },
    "par": { "distanceFactor": 1.3, "extraSeconds": 10 },
    "express": { "distanceFactor": 1.1, "extraSeconds": 10 },
    "fragile": { "maxFallMeters": 7 },
    "weightClasses": { "smallMax": 10, "mediumMax": 25, "largeMax": 50, "bulkyMax": 150 },
    "weightMultiplier": { "small": 1, "medium": 1.5, "large": 2, "bulky": 3 },
    "points": { "short": 1, "medium": 2, "long": 3, "hot": 1, "par": 1, "express": 1, "fragile": 2 },
    "coins": { "short": 10, "medium": 20, "long": 30, "hot": 10, "par": 10, "express": 10, "fragile": 20 },
    "mix": { "kindWeights": { "food": 6, "package": 4 }, "modifierWeights": { "none": 5, "express": 2, "fragile": 2 } },
    "zones": { "poiRadius": 3, "poiHeight": 4 } }
  ```
- `config/vehicles.json` (spec §4.2; SP3 uses `slots` and `maxPackageKg` only):
  ```json
  { "walk": { "slots": 1, "maxPackageKg": 0, "topSpeed": 8 }, "skateboard": { "slots": 1, "maxPackageKg": 0, "topSpeed": 12 },
    "bicycle": { "slots": 2, "maxPackageKg": 0, "topSpeed": 16 }, "motorbike": { "slots": 3, "maxPackageKg": 50, "topSpeed": 22 },
    "car": { "slots": 5, "maxPackageKg": 150, "topSpeed": 28 } }
  ```
- `types.ts`:
  - `type VehicleTier = 'walk' | 'skateboard' | 'bicycle' | 'motorbike' | 'car'`; `interface VehicleSpec { slots: number; maxPackageKg: number; topSpeed: number }`; `type VehiclesConfig = Record<VehicleTier, VehicleSpec>`; exported `vehiclesConfig`
  - `interface OrdersConfig` mirroring the JSON above
- `orders/types.ts`:
  - `type OrderKind = 'food' | 'package'`; `type WeightClass = 'small' | 'medium' | 'large' | 'bulky'`; `type Modifier = 'express' | 'fragile'`; `type Bonus = 'hot' | 'par' | 'express' | 'fragile'`
  - `interface Order { id: string; kind: OrderKind; pickupPoiId: string; dropoffPoiId: string; item: string; weightKg: number | null; weightClass: WeightClass | null; modifier: Modifier | null; band: Band; distance: number; timeLimit: number; expressLimit: number | null }` — `distance` = path pickup → dropoff; `timeLimit` = hot (food) or par (package), seconds from pickup
  - `interface Offer { order: Order; offeredAt: number; expiresAt: number }`
  - `interface ActiveOrder { order: Order; acceptedAt: number; pickedUpAt: number | null; fragileIntact: boolean }`
  - `interface CarrierCapacity { slots: number; maxPackageKg: number }`
- `rules.ts`:
  - `weightClassFor(kg: number, cfg: OrdersConfig['weightClasses']): WeightClass`
  - `timeLimit(kind: OrderKind, distance: number, cfg: OrdersConfig): number` → hot for food, par for package, using `cfg.referenceSpeed`
  - `expressLimit(distance: number, cfg: OrdersConfig): number`
  - `scoreOrder(order: Order, outcome: { inTime: boolean; expressOnTime: boolean; intact: boolean }, cfg: OrdersConfig): { points: number; coins: number; bonuses: Bonus[] }` — base = band value × weight multiplier (packages) rounded to the nearest integer; `inTime` adds `hot` (food) or `par` (package); express and fragile only for packages
  - `orderText(order: Order, pickup: Poi, dropoff: Poi): { pickup: string; dropoff: string }` → `"Pick up {item} from {pickup.name}"` / `"Deliver to {dropoff.name}"`, packages append `" ({weightKg} kg)"` to the pickup line

- [ ] **Step 1: Write the failing tests**

`rules.test.ts`:
```ts
test('weight classes split at 10, 25, 50', () => { expect(weightClassFor(10, wc)).toBe('small'); expect(weightClassFor(10.5, wc)).toBe('medium'); expect(weightClassFor(50, wc)).toBe('large'); expect(weightClassFor(51, wc)).toBe('bulky'); });
test('food hot limit = d/8*1.3+20, package par = d/8*1.3+10, express = d/8*1.1+10', () => { /* d = 400: 85, 75, 65 */ });
test('medium bulky package in time: (2*3)=6 pts + 1 par = 7 pts, 60+10 coins', () => {});
test('medium weight multiplier rounds: short medium-class package = round(1*1.5) = 2 pts', () => {});
test('food scores hot bonus, never express or fragile', () => {});
test('orderText names the item and the doors, with kg for packages', () => {});
```
`config.test.ts`: `vehiclesConfig.car.maxPackageKg === 150`, `ordersConfig.lockout.seconds === 45`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- rules config`
Expected: FAIL

- [ ] **Step 3: Write the config files, types and rules**

As specified in Interfaces. Delete the old `Unlocks`, `Step`, `OrderType`, `orderSteps`, `slotsFor`, `parLimit`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @dm/shared test -- rules config`
Expected: PASS (OrderSystem/board tests still fail to compile — Task 6/7 replace them; temporarily delete `board.test.ts` and `OrderSystem.test.ts` in this task so the package's test run is green)

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(orders): revision-2 order types, config and scoring rules; vehicles capacity table"
git push
```

---

### Task 6: Offer generation

**Files:**
- Create: `packages/shared/src/orders/offers.ts` (replaces `board.ts`; delete `board.ts`)
- Test: `packages/shared/test/orders/offers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface OfferContext {
    pois: Poi[]; distance: PathDistance; rules: OrderRules; cfg: OrdersConfig; rng: Rng;
    player: Vec3; capacity: CarrierCapacity; carriedKg: number; freeSlots: number;
    /** Doors of active orders and current offers (spacing), and door ids used within reuseSeconds (reuse). */
    blockedDoors: Vec3[]; recentlyUsed: ReadonlySet<string>; nextId: () => string;
  }
  function generateOffer(ctx: OfferContext): Order | null;
  ```
  Rules (map design §6.4, spec §3.3/§3.4): kind by `mix.kindWeights`, but `package` only if `capacity.maxPackageKg - carriedKg > 0` and `freeSlots > 0`; pickup = a POI with the matching pickup role within `rules.maxPickupDistance` (path) of `player`, not in `recentlyUsed`, not within `spacing.doorMeters` of any `blockedDoors`; dropoff = a POI with the matching dropoff role, ≠ pickup, same filters, and for food with `rules.foodDropoff.min ≤ distance(pickup, dropoff) ≤ max`; package weight uniform in the sender's `weightKg` range clamped to the remaining kg (if the sender's minimum exceeds the remaining kg, skip that sender); modifier by `mix.modifierWeights` (packages only); `band = bandFor(distance, rules.bands)`; `timeLimit`/`expressLimit` from Task 5. Returns `null` when no pickup or no dropoff qualifies. Deterministic given `rng`.

- [ ] **Step 1: Write the failing tests** (fixture: a small POI set with known street distances)

```ts
test('food offer: pickup within maxPickupDistance, dropoff within the food window, text item from the pickup', () => {});
test('package offers are never generated for a walk capacity (maxPackageKg 0)', () => {});
test('package weight is clamped to the remaining kg; a sender whose minimum exceeds it is skipped', () => {});
test('doors within 12 m of a blocked door and recently used doors are not offered', () => {});
test('returns null when every dropoff is blocked', () => {});
test('same rng seed gives the same offer', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- offers`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `generateOffer`** in `offers.ts`

Pick weighted kind first; collect candidate pickups, shuffle with `rng`; for each pickup, collect candidate dropoffs and take one at random; fall through to the next pickup when none; return `null` at the end.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @dm/shared test -- offers`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(orders): offer generation near the player with capacity, spacing, reuse and food-window rules"
git push
```

---

### Task 7: OrderSystem v2 — offers, accept, cancel and lockout, pickup, completion

**Files:**
- Modify: `packages/shared/src/orders/OrderSystem.ts` (rewrite), `packages/shared/src/index.ts`
- Test: `packages/shared/test/orders/OrderSystem.test.ts` (rewrite)

**Interfaces:**
- Produces:
  ```ts
  type AcceptResult = 'ok' | 'gone' | 'expired' | 'no_slots' | 'too_heavy';
  type CancelResult = 'ok' | 'unknown';
  type OrderEvent =
    | { kind: 'offered'; offerId: string }
    | { kind: 'offerExpired'; offerId: string }
    | { kind: 'pickedUp'; orderId: string }
    | { kind: 'fragileBroken'; orderId: string; reason: 'fall' | 'respawn' }
    | { kind: 'completed'; orderId: string; points: number; coins: number; bonuses: Bonus[]; inTime: boolean; expressOnTime: boolean | null }
    | { kind: 'lockoutEnded' };
  interface Totals { points: number; coins: number; deliveries: number }
  interface OrderSystemOptions { pois: Poi[]; distance: PathDistance; rules: OrderRules; cfg: OrdersConfig; rng: Rng; capacity: CarrierCapacity; totals?: Totals }
  class OrderSystem {
    offers: ReadonlyArray<Offer>; active: ReadonlyArray<ActiveOrder>; totals: Totals;
    capacity: CarrierCapacity; lockoutUntil: number; nextOfferAt: number;
    constructor(opts: OrderSystemOptions, now: number);
    setCapacity(c: CarrierCapacity): void;            // never drops active orders; blocks via canSwitchCapacity
    canSwitchCapacity(c: CarrierCapacity): boolean;   // false if active orders exceed c (slots or kg)
    usedSlots(): number; freeSlots(): number; carriedKg(): number;  // carriedKg counts packages picked up or not (reserved)
    canAccept(offerId: string, now: number): AcceptResult;         // precedence: gone, expired, no_slots, too_heavy
    accept(offerId: string, now: number): AcceptResult;
    cancel(orderId: string, now: number): CancelResult;            // sets lockoutUntil = now + cfg.lockout.seconds
    skipLockout(): void;                                            // dev/GAME stub: lockoutUntil = 0
    update(now: number, player: Vec3, zones: PlayerZones): OrderEvent[];
    onSimEvents(events: SimEvent[]): OrderEvent[];                  // fragile: landed fallHeight > maxFallMeters, respawned
    isCarried(a: ActiveOrder): boolean;                             // pickedUpAt !== null
    currentTarget(a: ActiveOrder): string;                          // pickup id until picked up, then dropoff id
    statModifiers(): StatModifiers;                                 // canSprint false while a carried order has weightClass 'bulky'
  }
  ```
  `update`: expire offers past `expiresAt`; if `now >= nextOfferAt` and `offers.length < maxShown` and `freeSlots() > 0` and `now >= lockoutUntil`, call `generateOffer` (Task 6) with `blockedDoors` = doors of offers + active, `recentlyUsed` = doors accepted within `spacing.reuseSeconds`; on `null` or success, `nextOfferAt = now + rng in [min,max]`; emit `lockoutEnded` once when the lockout passes; pickup when `zones.poiIds` has the pickup id (sets `pickedUpAt`, emits `pickedUp`); completion when carried and `zones.poiIds` has the dropoff id: `inTime = now - pickedUpAt <= timeLimit`, `expressOnTime` likewise for express, score via `scoreOrder`, add to totals.

- [ ] **Step 1: Write the failing tests** (use the Task 6 fixture; a fake `rng` sequence where needed)

```ts
test('an offer appears after the first interval and expires after lifetimeSeconds', () => {});
test('accept after expiresAt returns expired and the offer is gone', () => {});   // Review Focus 1
test('accept returns too_heavy when the package exceeds the remaining kg', () => {});  // Review Focus 2
test('accept returns no_slots when slots are full', () => {});
test('entering the pickup zone marks pickedUp; entering the dropoff before pickup does nothing', () => {});
test('completion within the time limit scores the bonus; late completion scores the base only', () => {});
test('cancel starts a 45 s lockout, no offers during it, lockoutEnded once', () => {});
test('cancel of a picked-up order removes it without points and starts one lockout', () => {});  // Review Focus 3
test('skipLockout clears the lockout', () => {});
test('a respawn breaks a carried Fragile once; a second respawn emits nothing', () => {});  // Review Focus 5
test('generateOffer returning null just advances nextOfferAt', () => {});  // Review Focus 4
test('statModifiers.canSprint is false while carrying a bulky package', () => {});
test('canSwitchCapacity false when active kg exceed the new capacity', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @dm/shared test -- OrderSystem`
Expected: FAIL

- [ ] **Step 3: Rewrite `OrderSystem.ts`** per the Interfaces block

- [ ] **Step 4: Run the shared package**

Run: `pnpm --filter @dm/shared typecheck && pnpm --filter @dm/shared test`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "feat(orders): OrderSystem v2 — offers, accept/cancel with lockout, pickup and dropoff completion"
git push
```

---

### Task 8: Progress store v2

**Files:**
- Modify: `packages/client/src/game/progress.ts`, `packages/client/test/progress.test.ts`

**Interfaces:**
- Produces: `interface Progress { totals: Totals; capacityTier: VehicleTier }`; `ProgressStore.load(): Progress` (defaults `{ totals: {0,0,0}, capacityTier: 'walk' }`, malformed storage → defaults), `save(p: Progress): void`. Storage key bumped to `dm.progress.v2` so SP1 saves don't load.

- [ ] **Step 1: Write the failing tests**
```ts
test('v2 key: an SP1 record is ignored and defaults load', () => {});
test('saves and loads totals and capacityTier', () => {});
```
- [ ] **Step 2: Run to see them fail** — `pnpm --filter @dm/client test -- progress` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run to see them pass** — PASS
- [ ] **Step 5: Commit and push** — `git commit -m "feat(client): progress store v2 with capacity tier"`

---

### Task 9: Delivery loop and HUD v2 on the client

**Files:**
- Modify: `packages/client/src/game/delivery.ts` (rewrite), `packages/client/src/ui/hudModel.ts` (rewrite), `packages/client/src/ui/hud.ts` (rewrite), `packages/client/src/ui/styles.css`, `packages/client/src/render/waypoints.ts` (count from `vehiclesConfig.car.slots`), `packages/client/src/game/Game.ts`, `config/client.json` (`ui.offerToastSeconds` not needed: toasts live while the offer does; add `ui.timerUrgentSeconds: 10`, remove `boardRefreshGuardSeconds`)
- Test: `packages/client/test/hudModel.test.ts` (rewrite), `packages/client/test/delivery.test.ts` (new, DOM-free parts)

**Interfaces:**
- `hudModel.ts`:
  ```ts
  interface HudOrder { id: string; kind: OrderKind; item: string; stage: string; targetName: string; target: Vec3; distance: number; timer: { secondsLeft: number; late: boolean } | null; express: { secondsLeft: number; late: boolean } | null; weightKg: number | null; fragileIntact: boolean | null }
  interface HudOffer { id: string; kind: OrderKind; pickupText: string; dropoffText: string; band: Band; weightKg: number | null; secondsLeft: number; reward: { points: number; coins: number } }  // reward = scoreOrder with every bonus
  interface HudModel { totals: Totals; load: { usedSlots: number; slots: number; carriedKg: number; maxPackageKg: number }; lockoutLeft: number; orders: HudOrder[]; offers: HudOffer[]; safeZone: string | null }
  function hudModel(orders: OrderSystem, map: MapData, player: Vec3, now: number, safeZone: string | null): HudModel
  function stageText(a: ActiveOrder, pois: PoiIndex): string   // "Pick up {item} from {name}" / "Deliver to {name}"
  class PoiIndex { get(id): Poi; target(id): Vec3 }
  ```
  Timers show `null` before pickup (they start at pickup, spec §3.2).
- `DeliveryLoop` (public surface used by `Game`, the phone and the debug API):
  ```ts
  constructor(deps: { host; scene; map; cfg; actions; progress; seed; now(); player(); capacityTier: VehicleTier })
  readonly orders: OrderSystem; carriedCount(): number; statModifiers(): StatModifiers;
  beforeStep(frame: InputFrame): InputFrame   // Y (accept.pressed) accepts the top offer; while the phone is open (Task 10) only look passes
  afterStep(simEvents, position, now): void  // onSimEvents, zones, update, announce events (popups)
  accept(offerId): AcceptResult; cancel(orderId): CancelResult; skipLockout(): void;
  setCapacityTier(t: VehicleTier): boolean   // false (and a warn popup) when canSwitchCapacity fails; saves progress
  draw(clockSeconds): void                   // waypoints to each active order's currentTarget, POI target markers, HUD at hudUpdateHz
  model(now): HudModel
  ```
- HUD layout (spec §8 HUD): top-left active orders (stage, name, distance, timer, kg); top-right totals (coins, pts, delivered) and load `2/3 · 25/50 kg`; bottom-right offer toasts with `[Y] Accept` on the top one; a centred "Safe zone · {hospital}" chip when `safeZone`; a "No new offers · {s} s" chip during lockout.

- [ ] **Step 1: Write the failing tests**

`hudModel.test.ts`: timers null before pickup and counting after; `load` strings; offers carry best-case reward; `lockoutLeft`.
`delivery.test.ts` (construct with a stub host via jsdom as existing tests do): `accept` via `beforeStep` with `accept.pressed` accepts the first offer; `setCapacityTier('walk')` refused while carrying a package.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @dm/client test -- hudModel delivery` → FAIL

- [ ] **Step 3: Rewrite `delivery.ts`, `hudModel.ts`, `hud.ts`; update `Game.ts` and `styles.css`**

Popups: "Offer accepted", "Picked up {item}", "Delivered! +N pts · +M coins" with bonus lines (`hot`: "Still hot", `par`: "Within par", `express`: "Express on time", `fragile`: "Fragile intact"), "Order cancelled · no new offers for 45 s", "Fragile package damaged".

- [ ] **Step 4: Run the client package** — `pnpm --filter @dm/client typecheck && pnpm --filter @dm/client test` → PASS

- [ ] **Step 5: Commit and push** — `git commit -m "feat(client): delivery loop v2 with offers, pickup/dropoff flow and the new HUD"`

---

### Task 10: The phone — shell, Orders app, Wallet app, stub apps

**Files:**
- Create: `packages/client/src/ui/phone/Phone.ts`, `packages/client/src/ui/phone/ordersApp.ts`, `packages/client/src/ui/phone/walletApp.ts`, `packages/client/src/ui/phone/stubApp.ts`
- Modify: `packages/client/src/game/delivery.ts` (open/close hooks, input gating), `packages/client/src/game/Game.ts` (Tab → `phone.toggle()`, release keys, exit pointer lock while open), `packages/client/src/ui/styles.css`, `packages/client/src/game/debugHooks.ts` (`phoneOpen(): boolean`, `openPhone(app: PhoneApp): void`, `offers(): Offer[]`, `active(): ActiveOrder[]`, `accept(id)`, `cancel(id)`, `totals()`), `packages/client/src/ui/dom.ts` (if a helper is missing)
- Test: `packages/client/test/phone.test.ts`, `packages/client/test/ordersApp.test.ts`

**Interfaces:**
- `type PhoneApp = 'orders' | 'map' | 'garage' | 'shop' | 'wallet' | 'wardrobe' | 'leaderboard' | 'settings'`
- `class Phone { constructor(host: HTMLElement, callbacks: { accept(id): void; cancel(id): void; skipLockout(): void; closed(): void }, closeCodes: string[]); readonly isOpen: boolean; open(app?: PhoneApp): void; close(): void; toggle(): void; show(app: PhoneApp): void; render(model: HudModel, now: number): void; setMapApp(view: { render(model: HudModel): void; el: HTMLElement }): void }`
- Orders app (`renderOrdersApp(root, model, cb)`): offers list (pickup text, dropoff text, band label, kg, reward, seconds left, Accept button disabled with the `acceptBlockedReason(result)` copy: `gone` "Taken", `expired` "Expired", `no_slots` "No free slot", `too_heavy` "Too heavy for your ride"); active list (stage, timer, Cancel button); lockout row "No new offers for {s} s" with a "Skip (burn GAME)" button that calls `skipLockout` and is labelled "dev stub" until SP6.
- Wallet app: Delivery Points, Coins, deliveries, and the line "GAME rewards arrive with the reward program (spec §9)" — no invented amounts.
- Stub apps (garage, shop, wardrobe, leaderboard, settings): the app name and "Coming in SP{4|6|6|7|3}"; settings shows the key bindings from `config/client.json`.
- While the phone is open: `beforeStep` passes only `look`; `actions.releaseAll()` on open; Esc or Tab closes; the HUD stays visible behind a dimmed backdrop.

- [ ] **Step 1: Write the failing tests**

`phone.test.ts`: `toggle` opens on 'orders' by default; `show('wallet')` switches the nav; `close` calls `closed`.
`ordersApp.test.ts`: renders one card per offer with the reward text; an expired offer (removed from the model) leaves no card (Review Focus 1); the lockout row appears when `lockoutLeft > 0`; Cancel calls back with the order id.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @dm/client test -- phone ordersApp` → FAIL

- [ ] **Step 3: Implement the phone shell and apps; wire Tab in `Game`/`DeliveryLoop`; extend the debug API**

- [ ] **Step 4: Run the client package** — `pnpm --filter @dm/client typecheck && pnpm --filter @dm/client test` → PASS

- [ ] **Step 5: Commit and push** — `git commit -m "feat(client): phone with Orders and Wallet apps, stub apps, Tab/Esc handling"`

---

### Task 11: The Map app

**Files:**
- Create: `packages/client/src/ui/phone/mapApp.ts`, `packages/client/src/ui/phone/mapProjection.ts`
- Test: `packages/client/test/mapProjection.test.ts`

**Interfaces:**
- `mapProjection.ts`: `class MapProjection { constructor(mapSize: number, canvasPx: number); toCanvas(p: Vec3): { x: number; y: number }; }` — north (−z) up, x east, uniform scale; `drawOrder: string[]`
- `mapApp.ts`: `createMapApp(map: MapData, proj: MapProjection): { el: HTMLElement; render(model: HudModel, player: Vec3, heading: number): void }` — draws on a `<canvas>`: ground, building footprints from `map.solids` (kind `building`), hospitals (red cross), the player (triangle with heading), each active order's current target (coloured dot matching its waypoint colour) with a straight line from the player (the per-vehicle route arrives in SP4), offers' pickups as hollow dots. Fictional POI names on hover are not required.

- [ ] **Step 1: Write the failing tests** — `toCanvas` maps map centre to canvas centre and north to −y; a corner maps to the canvas edge.
- [ ] **Step 2: Run to see them fail** — FAIL
- [ ] **Step 3: Implement**; register with `phone.setMapApp(...)`; `Phone.render` forwards to it when the Map app is shown.
- [ ] **Step 4: Run** — `pnpm --filter @dm/client test -- mapProjection` → PASS; `pnpm --filter @dm/client typecheck` → PASS
- [ ] **Step 5: Commit and push** — `git commit -m "feat(client): phone Map app — top-down canvas with player, targets and hospitals"`

---

### Task 12: Dev panel capacity preset, e2e tests, screenshots and docs

**Files:**
- Modify: `packages/client/src/ui/devPanel.ts`, `packages/client/src/game/devSettings.ts` (remove `backpackSlots`), `packages/client/src/game/Game.ts`, `packages/client/e2e/smoke.spec.ts`, `README.md`, `docs/superpowers/specs/2026-10-12-delivery-maxing-design.md` (§15 row 3 status line only), tests `devSettings.test.ts`
- Create: `docs/playtest/sp3/` screenshots

**Interfaces:**
- Dev panel: a `<select>` "Capacity (dev, until SP4)" over `VehicleTier`, calling `DeliveryLoop.setCapacityTier`; "Reset progress" kept; backpack slider removed.
- Debug API additions: `capacityTier(): VehicleTier`, `setCapacityTier(t): boolean`, `poiPosition(id)`, `hospitals()`.

- [ ] **Step 1: Write the e2e tests** (tick-driven via `?debug`, as the existing tests are)

```ts
test('spawns at a hospital inside its safe zone', ...);            // __dm.safeZone() is the first hospital's id at tick 0
test('an offer appears within 15 s of sim time and Y accepts it', ...);  // advance ticks, __dm.offers().length >= 1, press Y, __dm.active().length === 1
test('teleport to the pickup then the dropoff completes the order with points', ...);  // totals().deliveries === 1, popup text "Delivered!"
test('cancelling starts the lockout and no offer appears for 45 s', ...);
test('a package offer needs the car preset', ...);                 // walk: no package offers over 60 s; setCapacityTier('car'): a package offer within 60 s
test('phone: Tab opens Orders, Map and Wallet render; Esc closes', ...);  // screenshots sp3-phone-orders.png, sp3-phone-map.png, sp3-phone-wallet.png
test('HUD screenshot with an active order', ...);                  // sp3-hud.png
test('no parkour: speed never exceeds 12 m/s on foot over a 10 s sprint', ...);
test('draw calls stay under the budget', ...);                     // kept from SP1
```

- [ ] **Step 2: Run them to see the new ones fail** — `pnpm e2e` → FAIL on the new tests

- [ ] **Step 3: Implement the dev panel change and the debug API; fix whatever the e2e surfaces**

- [ ] **Step 4: Run everything**

Run: `pnpm check && pnpm e2e`
Expected: both PASS; screenshots written to `docs/playtest/sp3/`

- [ ] **Step 5: Docs**

README: controls table (Tab phone, Y accept, E interact, F mount reserved), the dev capacity preset, "no HUB" note. Spec §15 row 3: "Built (PR #5)". Project doc `claude/sp3-status.md` is written by the session, not this plan.

- [ ] **Step 6: Commit, push, open the PR**

```bash
git add -A && git commit -m "feat(client): dev capacity preset, SP3 e2e tests and playtest screenshots; docs"
git push
```
Open `[SP3] Core loop rework` against `main` with the `pnpm check` / `pnpm e2e` summary lines and the screenshots in the description.

---

## Self-review notes

- **Spec coverage.** §3.1 kinds and door roles (Tasks 3, 5, 6); §3.2 timers from pickup, Fragile fall/respawn (5, 7) — Fragile "being hit" and "vehicle crash" arrive with combat (SP7) and vehicles (SP4); §3.3 slots/weight/bulky-no-sprint/capacity switch blocked (5, 7, 9) — "every delivery ends on foot" is trivially true without vehicles; §3.4 offers (6, 7, 9); §3.5 cancel/lockout/skip stub (7, 10); §3.6 scoring (5); §4.1 on-foot kit and removals (1, 2), action layer keys (4); §4.2 capacity table only (5), physics in SP4; §5 spawn/respawn at hospitals (3, 4); §8 phone apps, HUD (9, 10, 11); §10 minimum plausible time needs the server (SP7); thieves are not on `main` (SP7). Points-to-GAME accrual is **Pending** in the spec, so the Wallet app shows no amount (10).
- **Types.** `CarrierCapacity`, `VehicleTier`, `Order.timeLimit`, `OrderEvent` names are used identically in Tasks 5–12. `nearestHospital` (Task 3) replaces Task 2's stopgap `map.spawn`.
- **Review Focus** items 1–5 each have a named test in Tasks 6, 7, 9 or 10.
- **Proportion.** Twelve tasks, signatures and tests only; no bodies beyond config JSON and copy the spec fixes.
