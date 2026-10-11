# SP1 — Movement + Delivery Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-player greybox city, playable in the browser, where the full §4 movement kit runs on a shared 30 Hz fixed-step sim. It includes the HUB, a personal Order Board, every order type and modifier across about 20 POIs, and Points and Coins tracked locally. The client deploys to GitHub Pages for playtesting.

**Architecture:** This is a pnpm monorepo with two packages.

- `packages/shared` holds everything the SP4 server will reuse. That covers the typed config, the Rapier player sim (one module per move), the map schema and greybox expansion, the pure order rules, and the `OrderSystem` state machine. It never imports three.js or the DOM.
- `packages/client` (Vite + three.js) turns input into `InputFrame`s and steps the shared sim through a `FixedStepper`. It interpolates rendering between ticks and draws the HUD and Order Board as DOM overlays.

Tuning lives in `config/*.json`. The greybox source is `map/greybox.json`, which is expanded deterministically at load.

**Tech Stack:** TypeScript 6.0, pnpm 10 workspaces, Vite 8, three.js 0.186, `@dimforge/rapier3d-compat` 0.21, Vitest 5, Playwright 1.64, ESLint 10 + typescript-eslint 8.71, lil-gui 0.21, GitHub Actions + GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-12-delivery-maxing-design.md`, mainly §3, §4, §5.1, §12, §14 and the §15 row for sub-project 1. This PR also clarifies §3.2, §5.3, §10 and §15 to record the decisions below.

## Global Constraints

- Node 22 (`.nvmrc` is `22`) and pnpm 10.28 (set in the `packageManager` field). Workspaces are `packages/*`.
- Pin TypeScript to `~6.0.3`. typescript-eslint 8.71 supports `<6.1.0`, so don't take TS 7.
- Pin `@dimforge/rapier3d-compat` to exactly `0.21.0`. Rapier 0.21 has no `updateSceneQueries`: after you add or move colliders, call `world.step()` so queries see them.
- `packages/shared` must never import `three`, the DOM or `window`, because the SP4 server runs it in Node.
- The sim runs at a fixed 30 Hz (`tickRate: 30` in `config/movement.json`), and rendering interpolates between steps (§4).
- Gameplay reads actions only: `move, look, jump, crouch, sprint, interact, hit, board` (§4).
- Every tuning value lives in `config/*.json`. None are hard-coded. Spec values that must appear exactly:
  - Movement:
    - Sprint 8 m/s, held with Shift, no stamina.
    - Jump about 1.2 m, with coyote time 100 ms and a jump buffer of 100 ms.
    - Mantle up to 1.5 m. Wall-run up to 1.5 s.
    - Boost orb: +40 % for 3 s, respawning after 30 s.
    - Horizontal speed cap 18 m/s. Board top speed 12 m/s.
  - Orders:
    - Board of 6 orders, refreshing every 60 s, with a 30 s cancel cooldown. Base backpack is 1 slot.
    - Bands: Short < 150 m, Medium 150–350 m, Long > 350 m.
    - Points and Coins per §3.4.
    - Express timer: `1.5 × (route ÷ 8 m/s) + 10 s`.
    - Fragile is lost on a fall of more than 7 m. Heavy takes 2 slots and gives ×0.9 jump height.
- Input is keyboard and mouse only. Bindings:
  - WASD move, mouse look, Space jump, C crouch, Shift sprint.
  - E interact, Q board.
  - Left mouse button is hit, which does nothing until SP4.
- No Amazon names, logos, orange-on-black trade dress, or smile or arrow motifs. Courier branding is fictional.
- SP1 uses no external assets: the greybox is built in code. `assets/CREDITS.md` exists and starts listing CC0 sources in SP2.
- SP1 contains no wallet code, keys or secrets.
- Done means `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm e2e` all pass, with headless-Chromium screenshots in the PR. Draw calls stay under `graphics.drawCallBudget` (150), which serves the 60 fps target.

## Review Focus

1. **Huge frame gaps** (hidden tab, laptop sleep, a debugger pause). The game should resume where it was, with no burst of hundreds of ticks and no tunnelling through walls. Pinned in Task 2 (`FixedStepper` drops the backlog).
2. **Focus or pointer lock lost while keys are held** (Alt-Tab or Esc mid-sprint). Every held action should release so the player stops running. Pinned in Task 14 (`ActionState.releaseAll`).
3. **The board refreshes while the Order Board is open.** Accept on a card that was just replaced must not accept a different order. Accept takes an order id and returns `'gone'`. Pinned in Task 13.
4. **Crouch released under a low ceiling after a slide.** The player should stay crouched instead of popping into the geometry. Pinned in Task 5.
5. **Browser storage blocked** (private window or site data blocked). The game should run with zero progress instead of crashing. Pinned in Task 17 and Task 19.

## SP1 decisions (confirmed 2026-10-12)

- Heavy orders are offered only when backpack capacity is 2 or more. The spec's numbers are unchanged.
- SP1 path distance is the street-grid distance `|dx| + |dz|` from the HUB centre. SP2 swaps in navmesh distance behind the same `PathDistance` type.
- Bands use the one-way HUB → POI distance. The Express timer uses the route: HUB → POI for a Drop-off, HUB → POI → HUB for a Pick-up.
- The client deploys to GitHub Pages on every push to `main` and to `sp1/movement-delivery-loop`. The repository will be made public.

## Assumptions to confirm at review

The spec is silent on these, so these are my defaults. Strike any you disagree with.

1. Everyone has a skateboard in SP1. Buying it comes in SP3.
2. Express and Chain orders appear regardless of rank. Board generation takes an `unlocks` input so SP3 can gate them by rank.
3. An order carries at most one modifier. Chain orders never carry one and use 1 slot.
4. Each 60 s refresh replaces all 6 board slots. An accepted slot stays empty until then.
5. HUB rules:
   - Packages for Pick-up and Chain orders are collected automatically when the player enters the POI zone.
   - The board opens with E at the HUB kiosk.
   - Accept and cancel work anywhere in the HUB plaza (radius 30 m).
   - Pick-up and Chain orders complete in the drop zone (radius 6 m).
6. Fall height is the highest point of an airborne stretch minus the landing height. Zip lines, rails, wall-runs and jump pads start a new stretch. Fragile and Heavy apply only while the package is carried; for a Pick-up, that is after collection.
7. The Express timer starts when the order is accepted. Respawn goes to the checkpoint nearest the last grounded position.
8. Starting values for tuning the spec doesn't set (all in config):
   - Running without Shift: 5.5 m/s.
   - Gravity: 20 m/s².
   - Crouch-walk (crouch while not sprinting): 3 m/s.
   - Zip lines: 10–16 m/s, riding toward the lower end.
   - Board turn rate: 2.5 rad/s.
9. Grabbing a zip line puts the board away. The board can only be toggled on the ground.
10. Points, Coins and the delivery count persist in localStorage. A dev panel, opened with the backtick key (`` ` ``), exposes live movement tuning and backpack slots 1–5 for playtests.

## File Structure

```
.github/workflows/pages.yml        check, e2e, build and deploy the client to Pages
package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js  vitest.config.ts  .nvmrc  .gitignore  README.md
assets/CREDITS.md
config/movement.json               §4 tuning
config/orders.json                 §3 tuning
config/client.json                 camera, graphics, input bindings (client only)
map/greybox.json                   SP1 greybox source: grid params, districts, hand-placed features, POIs
packages/shared/src/
  index.ts                         re-exports
  config/types.ts  config/index.ts
  math/vec3.ts                     Vec3 helpers, closestOnSegment
  util/rng.ts                      mulberry32, pickWeighted
  sim/fixedStep.ts                 FixedStepper
  input/inputFrame.ts              InputFrame, ButtonState, emptyInput, ACTIONS
  world/mapTypes.ts                MapData and feature types, GreyboxSource
  world/greybox.ts                 expandGreybox
  world/physicsWorld.ts            initRapier, createPhysicsWorld
  world/distance.ts                PathDistance, streetDistance, bandFor, buildPoiTable
  world/zones.ts                   inCylinder, playerZones
  movement/types.ts                PlayerState, MoveMode, StatModifiers, SimEvent, WorldFeatureState
  movement/body.ts                 PlayerBody: Rapier capsule + KinematicCharacterController
  movement/PlayerSim.ts            per-tick orchestration
  movement/ground.ts  jump.ts  slide.ts  mantle.ts  wallRun.ts  zipLine.ts  triggers.ts  rail.ts  board.ts
  orders/types.ts  orders/rules.ts  orders/board.ts  orders/OrderSystem.ts
packages/shared/test/              mirrors src/; test/helpers/simHarness.ts
packages/client/
  index.html  vite.config.ts  playwright.config.ts
  src/main.ts  src/clientConfig.ts
  src/game/Game.ts  progress.ts  devSettings.ts  debugHooks.ts
  src/input/actionState.ts  InputManager.ts
  src/render/Renderer.ts  greyboxMeshes.ts  featureMeshes.ts  hubMeshes.ts  waypoints.ts  cameraRig.ts
  src/ui/hudModel.ts  hud.ts  orderBoard.ts  popups.ts  devPanel.ts  debugOverlay.ts  styles.css
  test/                            unit tests for pure client modules (node environment)
  e2e/smoke.spec.ts                Playwright: load, run, deliver, screenshots
```

Every commit step ends with `git push` (sandboxes can reset). Commit trailers follow the session's attribution rules.

---

### Task 1: Workspace scaffold and tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`, `.nvmrc`, `.gitignore`, `assets/CREDITS.md`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/util/rng.ts`
- Test: `packages/shared/test/util/rng.test.ts`

**Interfaces:**
- Produces root scripts:
  - `lint`: `eslint .`
  - `typecheck`: `pnpm -r typecheck`, where each package runs `tsc --noEmit -p .`
  - `test`: `vitest run`
  - `build`: `pnpm --filter @dm/client build`
  - `e2e`: `pnpm --filter @dm/client e2e`
  - `check`: `pnpm lint && pnpm typecheck && pnpm test`
- Produces package `@dm/shared` (`"type": "module"`, `"exports": { ".": "./src/index.ts" }`). It has no build step; consumers compile the source.
- Produces in `util/rng.ts`:
  - `type Rng = () => number` (values in [0, 1))
  - `mulberry32(seed: number): Rng`
  - `pickWeighted<K extends string>(rng: Rng, weights: Record<K, number>): K`. Keys with weight ≤ 0 are never picked. It throws if every weight is ≤ 0.

- [ ] **Step 1: Write the root tooling files**

  `tsconfig.base.json`:
  - `target` ES2022, `module` preserve, `moduleResolution` bundler.
  - `strict`, `noUncheckedIndexedAccess`, `resolveJsonModule`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck`.
  - `types: []`. Each package adds its own types: `node` for shared tests, `vite/client` for the client.

  `eslint.config.js`: `@eslint/js` recommended plus `typescript-eslint` recommended, ignoring `**/dist`, `**/e2e-artifacts`, `**/playwright-report` and `**/test-results`.

  `vitest.config.ts`: `test.projects: ['packages/*']`.

  `.gitignore`: `node_modules`, `dist`, `e2e-artifacts`, `playwright-report`, `test-results`.

  `assets/CREDITS.md`: a heading, the CC0-only rule, and "No external assets yet (SP1 greybox is code-built)."

- [ ] **Step 2: Write the failing test** `packages/shared/test/util/rng.test.ts`

```ts
it('mulberry32 is deterministic per seed', () => {
  const a = mulberry32(42), b = mulberry32(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});
it('mulberry32 values are in [0, 1)', () => { /* 10_000 samples: every v >= 0 && v < 1 */ });
it('pickWeighted never picks zero-weight keys', () => { /* 1000 picks of {a:1,b:0} are all 'a' */ });
it('pickWeighted follows weights', () => { /* 4000 picks of {a:3,b:1}: share of 'a' in [0.70, 0.80] */ });
it('pickWeighted throws when all weights are zero', () => {
  expect(() => pickWeighted(mulberry32(1), { a: 0 })).toThrow();
});
```

- [ ] **Step 3: Run it and confirm it fails**

  Run: `pnpm install && pnpm test`
  Expected: FAIL, because `rng.ts` does not exist yet.

- [ ] **Step 4: Implement `mulberry32` and `pickWeighted` in `packages/shared/src/util/rng.ts`, and export them from `index.ts`**

- [ ] **Step 5: Run the whole check**

  Run: `pnpm check`
  Expected: lint clean, typecheck clean, `Test Files  1 passed`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: pnpm workspace, tooling and seeded RNG" && git push -u origin sp1/movement-delivery-loop
```

---

### Task 2: Config, fixed-step clock, input frame and vector helpers

**Files:**
- Create: `config/movement.json`, `config/orders.json`
- Create: `packages/shared/src/config/types.ts`, `packages/shared/src/config/index.ts`, `packages/shared/src/sim/fixedStep.ts`, `packages/shared/src/input/inputFrame.ts`, `packages/shared/src/math/vec3.ts`
- Test: `packages/shared/test/config/config.test.ts`, `packages/shared/test/sim/fixedStep.test.ts`, `packages/shared/test/math/vec3.test.ts`

**Interfaces:**
- Produces `MovementConfig` and `OrdersConfig`, whose keys mirror the JSON below.
  - `movementConfig: MovementConfig` and `ordersConfig: OrdersConfig` are typed JSON imports. A missing or renamed key fails typecheck.
- Produces `class FixedStepper`:
  - `constructor(tickRate: number, maxStepsPerFrame: number)`
  - `readonly dt: number`
  - `advance(frameSeconds: number): number`, which returns the number of steps to run now
  - `readonly alpha: number`, the interpolation factor in [0, 1)
- Produces the input types:
  - `interface ButtonState { held: boolean; pressed: boolean }`
  - `interface InputFrame { move: { x: number; y: number }; look: { yaw: number; pitch: number }; jump, crouch, sprint, interact, hit, board: ButtonState }`
  - `move.x` is strafe-right positive and `move.y` is forward positive; the vector's length is at most 1. Yaw 0 faces −Z, and positive yaw turns left (three.js convention).
  - `emptyInput(): InputFrame`
  - `ACTIONS` (the 8 action names as a const tuple)
- Produces in `vec3.ts`:
  - `interface Vec3 { x; y; z }` and `vec3(x, y, z)`
  - `add`, `sub`, `scale`, `dot`, `length`, `horizontalLength`, `normalize`, `lerpVec3`
  - `clampHorizontal(v: Vec3, max: number): Vec3`
  - `closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { s: number; point: Vec3; dist: number }`, where `s` is metres from `a`

- [ ] **Step 1: Write `config/movement.json`**

  The values marked "spec" come from §4. Everything else is a starting value to tune in playtest.

```json
{
  "tickRate": 30, "maxStepsPerFrame": 5, "gravity": 20, "speedCap": 18,
  "capsule": { "radius": 0.35, "height": 1.8, "crouchHeight": 1.1 },
  "controller": { "offset": 0.02, "maxStepHeight": 0.4, "minStepWidth": 0.2, "snapToGround": 0.3, "maxSlopeClimbDeg": 50, "minSlopeSlideDeg": 55 },
  "run": { "runSpeed": 5.5, "sprintSpeed": 8, "crouchSpeed": 3, "groundAccel": 60, "groundDecel": 40, "airAccel": 14, "overspeedDecay": 4 },
  "jump": { "height": 1.2, "coyoteTime": 0.1, "bufferTime": 0.1 },
  "mantle": { "minHeight": 0.4, "maxHeight": 1.5, "reach": 0.8, "duration": 0.3 },
  "slide": { "minEntrySpeed": 6, "friction": 2, "endSpeed": 3.5, "slopeGravityScale": 1 },
  "chute": { "friction": 0.4, "steerAccel": 4 },
  "wallRun": { "maxTime": 1.5, "minSpeed": 5, "checkDistance": 0.6, "gravityScale": 0.15, "maxApproachAngleDeg": 60, "wallJumpPush": 6, "sameWallDot": 0.7 },
  "zipLine": { "attachDistance": 2, "hangDrop": 2.0, "baseSpeed": 10, "maxSpeed": 16, "levelThreshold": 0.5 },
  "jumpPad": { "retriggerCooldown": 0.5 },
  "boostOrb": { "radius": 1.0, "speedMultiplier": 1.4, "duration": 3, "respawnTime": 30 },
  "rail": { "snapDistance": 0.6, "friction": 0.5, "minSpeedFoot": 6 },
  "board": { "topSpeed": 12, "accel": 6, "brakeDecel": 12, "friction": 1, "turnRate": 2.5, "railMinSpeed": 10 },
  "fall": { "outOfBoundsY": -3, "boundsMargin": 20 }
}
```

- [ ] **Step 2: Write `config/orders.json`**

  The values come from §3, the §6.2 base backpack, and the SP1 decisions.

```json
{
  "board": { "size": 6, "refreshSeconds": 60, "cancelCooldownSeconds": 30 },
  "backpack": { "baseSlots": 1, "maxSlots": 5 },
  "bands": { "shortMax": 150, "mediumMax": 350 },
  "points": { "short": 1, "medium": 2, "long": 3, "chain": 4, "expressOnTime": 1, "fragileIntact": 1, "heavy": 1 },
  "coins": { "short": 10, "medium": 20, "long": 30, "chain": 40, "expressOnTime": 10, "fragileIntact": 10, "heavy": 10 },
  "express": { "distanceFactor": 1.5, "extraSeconds": 10 },
  "fragile": { "maxFallMeters": 7 },
  "heavy": { "slots": 2, "jumpHeightMultiplier": 0.9 },
  "mix": { "typeWeights": { "dropoff": 5, "pickup": 4, "chain": 2 }, "modifierWeights": { "none": 5, "express": 2, "fragile": 2, "heavy": 2 } },
  "zones": { "poiRadius": 3, "poiHeight": 4 }
}
```

  The Express base sprint speed is `movementConfig.run.sprintSpeed`. It is deliberately not duplicated here.

- [ ] **Step 3: Write the failing tests**

```ts
// config.test.ts — pins the spec values
expect(movementConfig.tickRate).toBe(30);
expect(movementConfig.run.sprintSpeed).toBe(8);
expect(movementConfig.speedCap).toBe(18);
expect(movementConfig.jump).toMatchObject({ height: 1.2, coyoteTime: 0.1, bufferTime: 0.1 });
expect(movementConfig.mantle.maxHeight).toBe(1.5);
expect(movementConfig.wallRun.maxTime).toBe(1.5);
expect(movementConfig.boostOrb).toMatchObject({ speedMultiplier: 1.4, duration: 3, respawnTime: 30 });
expect(movementConfig.board.topSpeed).toBe(12);
expect(ordersConfig.board).toEqual({ size: 6, refreshSeconds: 60, cancelCooldownSeconds: 30 });
expect(ordersConfig.points).toEqual({ short: 1, medium: 2, long: 3, chain: 4, expressOnTime: 1, fragileIntact: 1, heavy: 1 });
expect(ordersConfig.coins).toEqual({ short: 10, medium: 20, long: 30, chain: 40, expressOnTime: 10, fragileIntact: 10, heavy: 10 });
expect(ordersConfig.bands).toEqual({ shortMax: 150, mediumMax: 350 });
expect(ordersConfig.express).toEqual({ distanceFactor: 1.5, extraSeconds: 10 });
expect(ordersConfig.fragile.maxFallMeters).toBe(7);
expect(ordersConfig.heavy).toEqual({ slots: 2, jumpHeightMultiplier: 0.9 });
expect(ordersConfig.backpack.baseSlots).toBe(1);

// fixedStep.test.ts
it('runs exactly 30 steps per simulated second however frames are split', () => {
  // 144 frames of 1/144 s → 30 steps; 7 frames of 1/7 s → 30 steps (fresh stepper each)
});
it('alpha is the leftover fraction of a tick', () => {
  const s = new FixedStepper(30, 5);
  expect(s.advance(1 / 60)).toBe(0);
  expect(s.alpha).toBeCloseTo(0.5, 5);
});
it('caps a 10 s gap at maxStepsPerFrame and drops the backlog (Review Focus 1)', () => {
  const s = new FixedStepper(30, 5);
  expect(s.advance(10)).toBe(5);
  expect(s.advance(1 / 60)).toBeLessThanOrEqual(1);
});
it('ignores negative and NaN frame times', () => { /* advance(-1) === 0, advance(NaN) === 0 */ });

// vec3.test.ts
it('clampHorizontal caps x/z length and keeps y', () => { /* (30,5,40) max 10 → (6,5,8) */ });
it('closestOnSegment clamps to the ends', () => { /* p beyond b → s = |b−a|, point = b */ });
```

- [ ] **Step 4: Run them and confirm they fail**

  Run: `pnpm test`
  Expected: FAIL (modules missing).

- [ ] **Step 5: Implement the config modules, `FixedStepper`, `inputFrame.ts` and `vec3.ts`**

  `FixedStepper` compares the accumulator against `dt - 1e-9` so that floating-point drift can't drop a step.

- [ ] **Step 6: Run the check**

  Run: `pnpm check`
  Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(shared): tuning config, fixed-step clock, input frame, vec3" && git push
```

---

### Task 3: Map schema, greybox expansion, physics world, distances and zones

**Files:**
- Create: `map/greybox.json` (a small starter: HUB, one district, 3 POIs, 1 checkpoint; Task 18 fills in the city)
- Create: `packages/shared/src/world/mapTypes.ts`, `greybox.ts`, `physicsWorld.ts`, `distance.ts`, `zones.ts`
- Test: `packages/shared/test/world/greybox.test.ts`, `physicsWorld.test.ts`, `distance.test.ts`, `zones.test.ts`

**Interfaces:**
- Produces the map types in `mapTypes.ts`:

```ts
type Surface = 'default' | 'chute';
type SolidKind = 'ground' | 'building' | 'prop' | 'ramp' | 'chute' | 'hub';
interface Solid { id: string; kind: SolidKind; center: Vec3; size: Vec3; rotationDeg?: Vec3 /* XYZ Euler */; surface?: Surface }
interface ZipLine { id: string; a: Vec3; b: Vec3 }
interface JumpPad { id: string; position: Vec3; radius: number; launch: Vec3 }
interface BoostOrb { id: string; position: Vec3 }
interface Rail { id: string; points: Vec3[] }           // ≥ 2 points, polyline
interface Checkpoint { id: string; position: Vec3 }
type District = 'hub' | 'downtown' | 'harbor' | 'hillside' | 'suburbs';
type PoiKind = 'door' | 'mailbox' | 'counter' | 'balcony';
interface Poi { id: string; position: Vec3 /* ground point of the zone */; district: District; kind: PoiKind }
interface Hub { center: Vec3; plazaRadius: number; dropZoneRadius: number; zoneHeight: number; kiosk: Vec3; kioskRange: number; spawn: Vec3; spawnYaw: number }
interface MapData { size: number; solids: Solid[]; zipLines: ZipLine[]; jumpPads: JumpPad[]; boostOrbs: BoostOrb[]; rails: Rail[]; checkpoints: Checkpoint[]; pois: Poi[]; hub: Hub }
interface Rect { minX: number; minZ: number; maxX: number; maxZ: number }
interface GreyboxDistrict { district: District; rect: Rect; heightMin: number; heightMax: number; fillChance: number }
interface GreyboxSource extends MapData {   // `solids` here are the hand-placed ones
  seed: number; grid: { pitch: number; roadWidth: number; alleyWidth: number }; districts: GreyboxDistrict[]; reserved: Rect[] }
```

- Produces `expandGreybox(src: GreyboxSource): MapData`.
- Produces in `physicsWorld.ts`:
  - `type Rapier = typeof import('@dimforge/rapier3d-compat').default`
  - `initRapier(): Promise<Rapier>`, which memoises `RAPIER.init()`
  - `interface PhysicsWorld { rapier: Rapier; world: World; surfaceOf(c: Collider): Surface }`
  - `createPhysicsWorld(rapier: Rapier, map: MapData): PhysicsWorld`
- Produces in `distance.ts`:
  - `type PathDistance = (from: Vec3, to: Vec3) => number`
  - `streetDistance: PathDistance`
  - `type Band = 'short' | 'medium' | 'long'`
  - `bandFor(d: number, bands: OrdersConfig['bands']): Band`
  - `interface PoiInfo { poi: Poi; hubDistance: number; band: Band }`
  - `buildPoiTable(map: MapData, dist: PathDistance, bands): PoiInfo[]`
- Produces in `zones.ts`:
  - `inCylinder(p: Vec3, base: Vec3, radius: number, height: number): boolean`. Horizontal distance must be ≤ radius, and `base.y − 0.5 ≤ p.y ≤ base.y + height`.
  - `interface PlayerZones { inPlaza: boolean; inDropZone: boolean; poiIds: ReadonlySet<string> }`
  - `playerZones(p: Vec3, map: MapData, zonesCfg: OrdersConfig['zones']): PlayerZones`

- [ ] **Step 1: Write the failing tests**

```ts
// greybox.test.ts (uses an inline small GreyboxSource fixture)
it('is deterministic for a seed', () => { expect(expandGreybox(src)).toEqual(expandGreybox(src)); });
it('adds a ground slab whose top is y = 0 and spans size × size', ...);
it('never places a generated building over a reserved rect', ...);
it('keeps generated buildings inside block interiors (never on roads)', ...);
it('keeps hand-placed solids and features unchanged', ...);

// physicsWorld.test.ts (hand-built MapData)
it('a ray cast down at (10, 50, 10) hits the ground at y = 0', ...);
it('a box rotated 15° about X has its top surface where the rotation puts it', ...);
it("surfaceOf returns 'chute' for chute solids and 'default' otherwise", ...);

// distance.test.ts
expect(streetDistance(vec3(0, 0, 0), vec3(30, 5, -40))).toBe(70);   // ignores y
expect(bandFor(149.9, b)).toBe('short');
expect(bandFor(150, b)).toBe('medium');
expect(bandFor(350, b)).toBe('medium');
expect(bandFor(350.01, b)).toBe('long');
it('buildPoiTable measures from map.hub.center', ...);

// zones.test.ts
it('inCylinder is inclusive at the radius and rejects points above base + height', ...);
it('playerZones reports plaza, drop zone and every POI containing the point', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm test`
  Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `expandGreybox`**

  1. Add a ground slab: `{ id: 'ground', kind: 'ground', center: (0, −0.5, 0), size: (size, 1, size) }`.
  2. Block centres sit at `pitch/2 + k·pitch` within ±size/2.
  3. Split each block into 2×2 square lots. Each lot's side is `(pitch − roadWidth − alleyWidth) / 2`, and the lots are separated by `alleyWidth`.
  4. A lot gets a building (`kind: 'building'`, id `b-<bx>-<bz>-<lot>`) only if all three hold:
     - Its centre lies in a district rect.
     - Its footprint doesn't intersect any `reserved` rect.
     - `rng() < fillChance`.
  5. Building height is `heightMin + rng()·(heightMax − heightMin)`, rounded to 0.5 m, with the base at y = 0.
  6. Draw from one `mulberry32(seed)` in a fixed iteration order.
  7. Append the hand-placed `solids`.

- [ ] **Step 4: Implement `createPhysicsWorld`**

  Set the world gravity to `(0, 0, 0)`; the sim applies gravity itself. Create one fixed cuboid collider per solid, with half extents `size / 2` and the rotation built from `rotationDeg` as an XYZ Euler quaternion. Keep the collider-handle → surface map, then call `world.step()` once.

- [ ] **Step 5: Implement `distance.ts` and `zones.ts`, and write the starter `map/greybox.json`**

  The starter map is:
  - `size` 600, with grid pitch 50, road 12 and alley 4.
  - A HUB at the origin: plaza radius 30, drop zone radius 6, zone height 6, kiosk at (0, 0, −8), kiosk range 3, spawn at (0, 0, 5) with yaw 0.
  - One reserved rect, `[−40, 40]²`.
  - One `downtown` district, 3 POIs and 1 checkpoint.

- [ ] **Step 6: Run the check**

  Run: `pnpm check`
  Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(shared): map schema, greybox expansion, physics world, street distance, zones" && git push
```

---

### Task 4: Player body, ground movement and jump

**Files:**
- Create: `packages/shared/src/movement/types.ts`, `body.ts`, `ground.ts`, `jump.ts`, `PlayerSim.ts`
- Create: `packages/shared/test/helpers/simHarness.ts`
- Test: `packages/shared/test/movement/ground.test.ts`, `jump.test.ts`

**Interfaces:**
- Consumes: `PhysicsWorld`, `MapData`, `MovementConfig`, `InputFrame`, and the `Vec3` helpers (Tasks 2–3).
- Produces the types in `movement/types.ts`. Later tasks add their own fields to `PlayerState` and their own variants to `SimEvent`.

```ts
type MoveMode = 'ground' | 'air' | 'slide' | 'wallrun' | 'mantle' | 'zipline' | 'grind';
interface PlayerState {
  position: Vec3;          // feet (bottom of capsule)
  velocity: Vec3;
  yaw: number; pitch: number;
  mode: MoveMode;
  onBoard: boolean; crouched: boolean;
  grounded: boolean; groundNormal: Vec3; lastGrounded: Vec3;
  airTicks: number;               // 0 on the first airborne tick
  jumpPressAge: number | null;    // ticks since the last unconsumed jump press; 0 on the press tick
  airApexY: number;
}
interface StatModifiers { speedMul: number; jumpHeightMul: number }
const NO_MODS: StatModifiers;            // { speedMul: 1, jumpHeightMul: 1 }
type SimEvent = { kind: 'jumped' } | { kind: 'landed'; fallHeight: number };
interface WorldFeatureState { orbAvailableAt: Map<string, number> }   // filled by Task 9
```

- Produces `class PlayerSim`:
  - `constructor(physics: PhysicsWorld, map: MapData, cfg: MovementConfig, spawn: Vec3, yaw?: number)`
  - `readonly state: PlayerState` and `readonly dt: number` (`1 / cfg.tickRate`)
  - `step(input: InputFrame, mods: StatModifiers, world: WorldFeatureState, time: number): SimEvent[]`
  - `teleport(position: Vec3, velocity?: Vec3): void`
  - `cfg` is held by reference, so later edits from the dev panel apply on the next tick.
- Produces `class PlayerBody` in `body.ts`:
  - `constructor(physics: PhysicsWorld, cfg: MovementConfig, feet: Vec3)`
  - `move(desired: Vec3, snapToGround: boolean): MoveResult`
  - `setFeet(p: Vec3): void` and `readonly feet: Vec3`
  - `setCrouched(c: boolean): boolean`, which returns false when standing is blocked
  - `fitsAt(feet: Vec3, crouched: boolean): boolean`
  - `castRay(from: Vec3, dir: Vec3, maxDist: number): { point: Vec3; normal: Vec3; distance: number } | null`
  - `interface MoveResult { grounded: boolean; groundNormal: Vec3; groundSurface: Surface; wallNormals: Vec3[] }`. Wall normals are collision normals with |n.y| < 0.3.
- Produces in `ground.ts`:
  - `wishDirection(input: InputFrame): Vec3`, a world-space horizontal unit vector or zero, built from `move` and `look.yaw`
  - `targetGroundSpeed(input, state, cfg, mods): number`
  - `applyGroundVelocity(state, wish, target, cfg, dt): void`
  - `applyAirVelocity(state, wish, target, cfg, dt): void`
- Produces in `jump.ts`:
  - `jumpVelocity(cfg, mods): number`, which is `√(2·g·jump.height·jumpHeightMul)`
  - `tryJump(state, input, cfg, mods, dt): boolean`
- Produces the test harness:
  - `makeSim(opts: { floor?: boolean; solids?: Solid[]; zipLines?; jumpPads?; boostOrbs?; rails?; checkpoints?; spawn?: Vec3; yaw?: number }): Promise<Harness>`. Unless `floor: false`, it adds a 200 × 1 × 200 floor slab with its top at y = 0.
  - `interface Hold { forward?: number; strafe?: number; sprint?: boolean; crouch?: boolean; jump?: boolean; yaw?: number }`
  - `interface Harness { sim; world; time: number; tick(hold?: Hold, press?: ('jump'|'crouch'|'interact'|'board')[], mods?: StatModifiers): SimEvent[]; run(ticks: number, hold?: Hold, mods?): SimEvent[]; runUntil(pred: (s: PlayerState) => boolean, maxTicks: number, hold?: Hold): number }`
  - `box(id, center, size, extra?): Solid`

- [ ] **Step 1: Write the failing tests**

```ts
// ground.test.ts
it('sprint reaches 8 m/s within 0.5 s and holds it', ...);   // after 15 ticks ≥ 7.9; after 60 ticks in [7.95, 8.05]
it('running without Shift settles at runSpeed 5.5', ...);
it('releasing input stops a sprinting player within 0.25 s', ...);
it('speedMul 1.175 raises sprint to 9.4 m/s', ...);            // hook for SP3 shoes and the Task 9 boost
it('horizontal speed never exceeds the 18 m/s cap', ...);      // teleport v = (30,0,0) on the ground, one tick → ≤ 18
it('above sprint speed the ground only decays at overspeedDecay (momentum rule)', ...);  // v0 = 14 sprinting, 30 ticks → 10 ± 0.2
it('walls stop the player', ...);                                // sprint into a box; feet.x stays ≤ face − radius + 0.05
it('auto-steps a 0.3 m curb but is blocked by a 0.6 m block', ...);

// jump.test.ts
it('jump apex is 1.2 m (± 0.03)', ...);
it('jumpHeightMul 0.9 (Heavy) gives an apex of 1.08 m (± 0.03)', ...);
it('coyote: jump pressed on airTicks 3 (100 ms after leaving a ledge) still jumps', ...);  // platform top y = 5
it('coyote: jump pressed on airTicks 4 (133 ms) does not jump', ...);
it('buffer: jump pressed 3 ticks before the landing tick jumps on the landing tick', ...); // dry run finds the landing tick
it('buffer: jump pressed 4 ticks before the landing tick does not jump', ...);
it('jumping keeps horizontal speed through the air and the landing', ...);          // ≥ 7.9 mid-air and 2 ticks after landing
it('landed reports fallHeight = apex − landing height', ...);                       // walk off a 10 m box → 10 ± 0.1
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/movement`
  Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `PlayerBody`**

  - Use a `kinematicPositionBased` rigid body with a capsule collider: half height `(height − 2·radius) / 2`, positioned at feet + half height + radius.
  - Call `world.createCharacterController(offset)`, then `enableAutostep(maxStepHeight, minStepWidth, false)`, `setMaxSlopeClimbAngle` and `setMinSlopeSlideAngle` (both in radians).
  - `move()`:
    1. Call `enableSnapToGround(snapToGround)` when `snapToGround` is true, otherwise `disableSnapToGround()`.
    2. Call `computeColliderMovement(collider, desired, undefined, undefined, c => c !== collider)`.
    3. Read `computedMovement()`, `computedGrounded()` and `computedCollision(i)` normals.
    4. Call `setNextKinematicTranslation`, then `world.step()`.
  - `groundNormal` comes from a short down ray. `groundSurface` comes from `surfaceOf`.

- [ ] **Step 4: Implement `ground.ts`, `jump.ts` and `PlayerSim.step` for the ground, air and jump modes**

  The order of operations inside `step` (later tasks slot in at the marked points):
  1. Update look and timers.
  2. *(Tasks 6, 8, 10: special modes run here and return early.)*
  3. Compute the wish direction and apply ground or air velocity.
  4. `tryJump`.
  5. Apply gravity.
  6. `clampHorizontal(speedCap)`.
  7. Move: snap only when `velocity.y <= 0`.
  8. Handle landing and apex tracking, then emit `landed`.
  9. *(Tasks 5, 7, 9: post-move checks run here.)*

  Rules:
  - Integrate vertical motion exactly for constant gravity: `dy = vy·dt − ½·g·dt²`, then `vy −= g·dt`. This makes the 1.2 m apex exact at 30 Hz.
  - On the ground, if speed is above the target, speed decays at most `overspeedDecay·dt` per tick. Otherwise it accelerates or decelerates at `groundAccel` or `groundDecel`.
  - In the air, `airAccel` can only raise speed toward `max(currentSpeed, target)`.
  - Coyote time and the buffer are counted in ticks: `coyoteTicks = round(coyoteTime × tickRate)` and `bufferTicks = round(bufferTime × tickRate)`, which are 3 each at 30 Hz.
    - A jump happens when `jumpPressAge ≤ bufferTicks` and either `grounded` or `airTicks ≤ coyoteTicks`.
    - Jumping clears `jumpPressAge` and pushes `airTicks` past the coyote window.
    - `jumpPressAge` goes back to null once it exceeds `bufferTicks`.
  - While airborne, `airApexY = max(airApexY, feet.y)`. On landing, emit `landed` with `fallHeight = airApexY − feet.y`.

- [ ] **Step 5: Run the tests and confirm they pass**

  Run: `pnpm vitest run packages/shared/test/movement`
  Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(shared): player body, run/sprint, jump with coyote time and buffer" && git push
```

---

### Task 5: Crouch, crouch-slide and chutes

**Files:**
- Create: `packages/shared/src/movement/slide.ts`
- Modify: `packages/shared/src/movement/PlayerSim.ts`, `body.ts`
- Test: `packages/shared/test/movement/slide.test.ts`

**Interfaces:**
- Consumes: `PlayerBody.setCrouched` / `fitsAt`, `MoveResult.groundSurface` / `groundNormal` (Task 4).
- Produces:
  - `startSlide(state, input, cfg): boolean`. It needs all of these: crouch pressed this tick, grounded, sprint held, not on the board, and horizontal speed ≥ `slide.minEntrySpeed`.
  - `updateSlide(state, move: MoveResult, input, cfg, dt): void`.
  - Crouch-walk: holding crouch while not sliding sets `crouched` and caps the target speed at `run.crouchSpeed`.

- [ ] **Step 1: Write the failing tests**

```ts
it('crouch while sprinting at 8 m/s starts a slide that keeps speed (≥ 6.9 after 0.5 s on flat)', ...);
it('crouch at 5.5 m/s (below minEntrySpeed 6) crouch-walks at ≤ 3 m/s instead', ...);
it('a slide gains speed down a 15° slope (speed after 1 s > entry + 1)', ...);
it('jumping out of a slide keeps horizontal speed (momentum rule)', ...);
it('a slide that drops below endSpeed becomes a crouch', ...);
it('releasing crouch under a 1.4 m ceiling keeps the player crouched; they stand once clear (Review Focus 4)', ...);
  // feet.y stays 0 ± 0.05 inside the tunnel, crouched === true; after exiting, crouched === false
it('grounded on a chute: slides without crouch and accelerates downhill', ...);   // 20° chute solid, surface 'chute'
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/movement/slide.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `slide.ts` and wire it into `PlayerSim`**

  - Slide physics: friction `slide.friction` (or `chute.friction` on a chute) acts against velocity. Downhill acceleration along the slope is `g · slopeGravityScale · (n.x, n.z)`, projected onto the ground plane.
  - On a chute surface, input steers only through `chute.steerAccel`, and the mode stays `slide` without crouch.
  - A slide ends when speed falls below `endSpeed` (the player becomes crouched) or when crouch is released off a chute and `setCrouched(false)` succeeds.
  - `setCrouched` resizes the capsule (`setHalfHeight`) and keeps the feet planted.

- [ ] **Step 4: Run the movement tests and confirm they pass**

  Run: `pnpm vitest run packages/shared/test/movement`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): crouch, crouch-slide and chute surfaces" && git push
```

---

### Task 6: Mantle

**Files:**
- Create: `packages/shared/src/movement/mantle.ts`
- Modify: `PlayerSim.ts` and `types.ts` (adds `mantle: MantleState | null`)
- Test: `packages/shared/test/movement/mantle.test.ts`

**Interfaces:**
- Produces:
  - `interface MantleState { from: Vec3; to: Vec3; t: number; horizontalVelocity: Vec3 }`
  - `findLedge(body: PlayerBody, state: PlayerState, cfg): Vec3 | null`, which returns the feet position on top of the ledge
  - `updateMantle(state, cfg, dt): boolean`, which returns true when the mantle finishes

- [ ] **Step 1: Write the failing tests**

```ts
it('running into a 1.5 m ledge ends standing on top (feet y = 1.5 ± 0.05) within duration + 0.2 s', ...);
it('a 1.0 m ledge mantles too', ...);
it('a 1.8 m wall does not mantle (feet y < 0.1 after pushing for 1 s)', ...);
it('air mantle: jumping at a 2.6 m ledge reaches the top', ...);       // apex 1.2 m → ledge 1.4 m above the feet
it('no mantle when there is no headroom on top', ...);                  // ceiling 1.0 m above the ledge top
it('keeps ≥ 90 % of horizontal speed after the mantle', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/movement/mantle.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `mantle.ts` and wire it in**

  Ledge detection runs when the player isn't on the board, forward input is above 0, and the mode is ground or air:
  1. Cast a ray forward from the feet + 1.0 m for `radius + mantle.reach`. It must hit a face with |n.y| < 0.3.
  2. Cast a ray down from `hit + forward·(radius + 0.1)` at height `feet.y + maxHeight + 0.1`, over a distance of `maxHeight + 0.2`.
  3. The top's height above the feet must be in `(minHeight, maxHeight]`, and `body.fitsAt(top, false)` must be true.

  The mantle then ignores collisions for `mantle.duration`. For the first 60 % it lerps up to `top.y`, and for the remaining 40 % it lerps forward to `top`. It finishes in ground mode, with the stored horizontal velocity restored.

- [ ] **Step 4: Run the movement tests and confirm they pass**

  Run: `pnpm vitest run packages/shared/test/movement`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): mantle up to 1.5 m" && git push
```

---

### Task 7: Wall-run and wall-jump

**Files:**
- Create: `packages/shared/src/movement/wallRun.ts`
- Modify: `PlayerSim.ts` and `types.ts` (adds `wallRun: { time: number; normal: Vec3 | null; lastNormal: Vec3 | null }`)
- Test: `packages/shared/test/movement/wallRun.test.ts`

**Interfaces:**
- Produces:
  - `findWall(body, state, cfg): Vec3 | null`. It casts rays left and right at waist height (feet + 0.9) for `radius + wallRun.checkDistance` and returns the normal of a near-vertical hit.
  - `canStartWallRun(state, normal, input, cfg): boolean`
  - `updateWallRun(state, body, input, cfg, dt): void`
  - `wallJump(state, cfg, mods): void`

- [ ] **Step 1: Write the failing tests**

```ts
it('jumping alongside a wall at sprint starts a wall-run within 10 ticks', ...);  // 40 m wall, 0.5 m away
it('a wall-run lasts at most 1.5 s (≤ 46 ticks in wallrun)', ...);
it('falls slower while wall-running than in free fall', ...);
it('keeps along-wall speed (≥ 7.5 m/s after 1 s from 8)', ...);
it('wall-jump pushes off the wall (v·n ≥ wallJumpPush − 0.5) and keeps along-wall speed ≥ 7.5', ...);
it('wall-jump chains to the facing wall across a 4 m alley and the timer resets', ...);  // second wallrun with time < 0.2 s
it('cannot wall-run the same wall again before landing', ...);
it('no wall-run below 5 m/s', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/movement/wallRun.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `wallRun.ts` and wire it in**

  Start conditions — all must hold:
  - Airborne and not on the board.
  - Forward input above 0.
  - Horizontal speed ≥ `minSpeed`.
  - The angle between the velocity and the wall plane is ≤ `maxApproachAngleDeg`.
  - `lastNormal` is null, or `dot(normal, lastNormal) < sameWallDot`.

  While running:
  - Velocity is projected onto the wall plane, so along-wall speed is kept.
  - Gravity is scaled by `gravityScale`.
  - The player is pulled 0.5 m/s toward the wall so contact holds.

  The run ends when `time ≥ maxTime`, the wall is lost, forward input is released, or the player lands.

  `wallJump`: `velocity = alongWall + normal·wallJumpPush + up·jumpVelocity(cfg, mods)`. It also sets `lastNormal = normal`.

  Landing resets `lastNormal`. A wall-run or wall-jump sets `airApexY` to the current feet y.

- [ ] **Step 4: Run the movement tests and confirm they pass**

  Run: `pnpm vitest run packages/shared/test/movement`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): wall-run and chaining wall-jumps" && git push
```

---

### Task 8: Zip lines

**Files:**
- Create: `packages/shared/src/movement/zipLine.ts`
- Modify: `PlayerSim.ts` and `types.ts` (adds `zip: { id: string; s: number; dir: 1 | -1; speed: number } | null`)
- Test: `packages/shared/test/movement/zipLine.test.ts`

**Interfaces:**
- Consumes: `closestOnSegment` (Task 2), `jumpVelocity` (Task 4).
- Produces:
  - `tryAttachZip(state, input, lines: ZipLine[], cfg): boolean`
  - `updateZip(state, line: ZipLine, input, cfg, mods, dt): 'riding' | 'detached'`

- [ ] **Step 1: Write the failing tests**

```ts
it('E within 2 m of a line attaches and rides toward the lower end', ...);
it('E farther than 2 m does not attach', ...);
it('ride speed stays within [10, 16] m/s and rises on a slope', ...);
it('jumping off keeps the ride velocity (horizontal ≥ 95 % of ride speed) and adds upward speed', ...);
it('reaching the end detaches with the ride velocity', ...);
it('a level line (|Δy| < 0.5 m) rides in the facing direction', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/movement/zipLine.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `zipLine.ts` and wire it in**

  - Attach happens when `interact.pressed` is true and the hand point (feet + capsule height) is within `attachDistance` of the nearest line. The line direction runs toward the lower end; if |Δy| < `levelThreshold`, it runs toward the end the player faces.
  - The starting speed is `max(baseSpeed, velocity · dir)`.
  - While riding, collisions are ignored and the feet sit at `linePoint(s) − (0, hangDrop, 0)`. Speed changes by `g · sinθ · dt` and is clamped to `[baseSpeed, maxSpeed × speedMul]`.
  - Detach happens at the end of the line, or on `jump.pressed`, which also adds `jumpVelocity`. Both set the mode to air and `airApexY` to the current feet y.

- [ ] **Step 4: Run the movement tests and confirm they pass**

  Run: `pnpm vitest run packages/shared/test/movement`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): zip lines with momentum carry-over" && git push
```

---

### Task 9: Jump pads, boost orbs and out-of-bounds respawn

**Files:**
- Create: `packages/shared/src/movement/triggers.ts`
- Modify: `PlayerSim.ts`, `ground.ts` (boost in `targetGroundSpeed`) and `types.ts`. State gains `boostLeft: number` and `padCooldown: Record<string, number>`. `SimEvent` gains `{ kind: 'jumpPad'; padId }`, `{ kind: 'orbCollected'; orbId }` and `{ kind: 'respawned'; checkpointId }`.
- Test: `packages/shared/test/movement/triggers.test.ts`

**Interfaces:**
- Produces:
  - `createWorldFeatureState(map: MapData): WorldFeatureState`, with every orb available from time 0
  - `applyTriggers(state, body, map, world, cfg, time): SimEvent[]`, called after the move

- [ ] **Step 1: Write the failing tests**

```ts
it('stepping onto a jump pad sets velocity to its launch vector', ...);   // next-tick v ≈ launch − (0, g·dt, 0) ± 0.05
it('a pad does not retrigger within retriggerCooldown', ...);
it('a boost orb raises sprint to 11.2 m/s for 3 s, then back to 8', ...);
it('a collected orb is unavailable for 30 s, then can be collected again', ...);
it('boosted speed still respects the 18 m/s cap', ...);
it('falling below outOfBoundsY respawns at the checkpoint nearest the last grounded spot, with zero velocity', ...);
it('leaving the island edge (beyond size/2 + boundsMargin) also respawns', ...);
it('respawning mid zip line clears the ride', ...);   // a line that ends over the void
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/movement/triggers.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `triggers.ts` and the boost in `targetGroundSpeed`**

  - **Pad:** triggers when the feet are inside the pad cylinder (radius, 0.5 m tall) and the pad's cooldown has expired. It sets `velocity = launch`, mode air, `airApexY = feet.y`, and the cooldown.
  - **Orb:** collected when `|feet + (0, 1, 0) − orb| ≤ boostOrb.radius + capsule.radius` and `time ≥ orbAvailableAt`. It sets `boostLeft = duration` and `orbAvailableAt = time + respawnTime`.
  - **Boost:** while `boostLeft > 0`, `targetGroundSpeed` (and the board top speed in Task 11) multiplies by `speedMultiplier`. The cap still applies afterwards.
  - **Out of bounds:** triggers when `feet.y < outOfBoundsY`, or |x| or |z| > `size/2 + boundsMargin`. The player teleports to the checkpoint nearest `lastGrounded`, with velocity zeroed. Mantle, zip, wall-run and grind state are cleared, and the mode becomes air.

- [ ] **Step 4: Run the movement tests and confirm they pass**

  Run: `pnpm vitest run packages/shared/test/movement`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): jump pads, boost orbs, out-of-bounds respawn" && git push
```

---

### Task 10: Grind rails

**Files:**
- Create: `packages/shared/src/movement/rail.ts`
- Modify: `PlayerSim.ts` and `types.ts` (adds `grind: { id: string; segment: number; s: number; dir: 1 | -1; speed: number } | null`)
- Test: `packages/shared/test/movement/rail.test.ts`

**Interfaces:**
- Produces:
  - `tryStartGrind(state, rails: Rail[], cfg): boolean`
  - `updateGrind(state, rail: Rail, input, cfg, mods, dt): 'grinding' | 'detached'`
  - `railMinSpeed(state, cfg): number`, which returns `rail.minSpeedFoot` on foot. Task 11 makes it return `board.railMinSpeed` on the board.

- [ ] **Step 1: Write the failing tests**

```ts
it('landing on a rail from above starts grinding along it', ...);
it('a level rail keeps speed minus friction (after 1 s ≥ entry − friction − 0.05)', ...);
it('follows a bent rail across segments', ...);
it('leaving the rail end launches along the last segment direction', ...);
it('jumping off keeps speed and adds upward velocity', ...);
it('on foot, grind speed is at least minSpeedFoot 6 (enter at 3 m/s → 6)', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/movement/rail.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `rail.ts` and wire it in**

  - A grind snaps on when the player is airborne, `velocity.y ≤ 0`, the feet are within `snapDistance` of a segment's closest point, and the feet are no lower than rail y − 0.1.
  - `dir` is the sign of `velocity · segmentDir`. Speed is `max(|horizontal v · dir|, railMinSpeed)`.
  - While grinding, collisions are ignored and the feet sit at the rail point + (0, 0.05, 0). Speed changes by `−friction·dt + g·slope·dt`, then is clamped to `[railMinSpeed, speedCap]`. The grind advances across segments.
  - Detach happens at the end of the rail, or on jump, which adds `jumpVelocity`. Both set the mode to air and `airApexY` to the current feet y.

- [ ] **Step 4: Run the movement tests and confirm they pass**

  Run: `pnpm vitest run packages/shared/test/movement`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): grind rails" && git push
```

---

### Task 11: Skateboard

**Files:**
- Create: `packages/shared/src/movement/board.ts`
- Modify: `PlayerSim.ts`, `zipLine.ts` (attaching puts the board away), `rail.ts` (`railMinSpeed`), `mantle.ts` and `wallRun.ts` (both blocked on the board). `SimEvent` gains `{ kind: 'boardToggled'; onBoard: boolean }`.
- Test: `packages/shared/test/movement/board.test.ts`

**Interfaces:**
- Produces:
  - `toggleBoard(state): boolean`. It only works when grounded, in ground mode and not crouched.
  - `applyBoardVelocity(state, input, cfg, mods, dt): void`

- [ ] **Step 1: Write the failing tests**

```ts
it('Q on the ground toggles the board; Q in the air does nothing', ...);
it('reaches 12 m/s on flat ground (≥ 11.9 after 4 s) and no more', ...);
it('turning 90° takes at least (π/2) / turnRate seconds', ...);
it('cannot wall-run on the board', ...);        // the Task 7 wall setup never enters 'wallrun'
it('cannot mantle on the board', ...);          // a 1.0 m ledge blocks it
it('board grind speed is at least 10 m/s', ...);
it('grabbing a zip line while on the board puts the board away (boardToggled false)', ...);
it('crouch on the board does not slide', ...);
it('boost raises board top speed to 16.8 m/s', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/movement/board.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `board.ts` and the guards**

  - The board heading turns toward the wish direction at no more than `turnRate·dt`. There is no strafing.
  - Forward input accelerates at `accel` toward `topSpeed × speedMul × boost`. Back input brakes at `brakeDecel`. With no input, `friction` slows the board.
  - On a slope the board gains `g·sinθ` downhill.
  - On the board, crouch is ignored.

- [ ] **Step 4: Run all shared tests and confirm they pass**

  Run: `pnpm vitest run packages/shared`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): skateboard" && git push
```

---

### Task 12: Order rules and board generation

**Files:**
- Create: `packages/shared/src/orders/types.ts`, `rules.ts`, `board.ts`
- Test: `packages/shared/test/orders/rules.test.ts`, `board.test.ts`

**Interfaces:**
- Consumes: `PoiInfo`, `PathDistance`, `Band`, `bandFor` (Task 3), and `Rng` / `pickWeighted` (Task 1).
- Produces the order types:

```ts
type OrderType = 'dropoff' | 'pickup' | 'chain';
type Modifier = 'express' | 'fragile' | 'heavy';
type Bonus = 'express' | 'fragile' | 'heavy';
type Step = { kind: 'poi'; poiId: string } | { kind: 'hub' };
interface Order {
  id: string; type: OrderType; modifier: Modifier | null; steps: Step[];
  band: Band | null;          // null for chain
  hubDistance: number;        // one-way HUB → first POI
  routeDistance: number;      // dropoff d; pickup 2d; chain hub→A + A→B + B→hub
  slots: number; expressLimit: number | null;   // seconds, express only
}
interface Unlocks { express: boolean; chain: boolean }
```

- Produces in `rules.ts`:
  - `orderSteps(type, poiIds: string[]): Step[]`
  - `expressLimit(routeDistance: number, baseSprintSpeed: number, cfg: OrdersConfig): number`
  - `slotsFor(modifier: Modifier | null, cfg): number`
  - `scoreOrder(order, outcome: { onTime: boolean; intact: boolean }, cfg): { points: number; coins: number; bonuses: Bonus[] }`
- Produces in `board.ts`:
  - `interface BoardContext { pois: PoiInfo[]; distance: PathDistance; hub: Vec3; rng: Rng; cfg: OrdersConfig; baseSprintSpeed: number; unlocks: Unlocks; backpackCapacity: number; nextId: () => string }`
  - `generateBoard(ctx: BoardContext): Order[]`

- [ ] **Step 1: Write the failing tests**

```ts
// rules.test.ts
it('base points/coins by band: short 1/10, medium 2/20, long 3/30, chain 4/40', ...);
it('express on time adds +1/+10; late adds nothing', ...);
it('fragile intact adds +1/+10; broken adds nothing', ...);
it('heavy always adds +1/+10', ...);
expect(expressLimit(160, 8, ordersConfig)).toBe(40);   // drop-off 160 m: 1.5 × 160 / 8 + 10
expect(expressLimit(320, 8, ordersConfig)).toBe(70);   // pick-up 160 m one-way → 320 m route
it('steps: dropoff [poi], pickup [poi, hub], chain [A, B, hub]', ...);
it('heavy uses 2 slots; everything else uses 1', ...);

// board.test.ts (fixture: 20 PoiInfo rows spread over the three bands)
it('returns cfg.board.size (6) orders', ...);
it('is deterministic for a seed', ...);
it('never repeats a POI on one board', ...);
it('offers no heavy at capacity 1, and offers heavy at capacity 2 (over 200 seeded boards)', ...);
it('offers no express or chain when locked', ...);
it('chain orders use two different POIs and have no modifier', ...);
it('carries at most one modifier per order', ...);
it('drop-off/pick-up band equals the POI band', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/orders`
  Expected: FAIL.

- [ ] **Step 3: Implement `rules.ts` and `board.ts`**

  For each slot:
  1. Pick a type with `pickWeighted(typeWeights)`. Chain's weight is zeroed unless `unlocks.chain`.
  2. For a Drop-off or Pick-up, pick a modifier with `pickWeighted(modifierWeights)`. Express is zeroed unless `unlocks.express`; Heavy is zeroed when `backpackCapacity < heavy.slots`; `none` maps to null.
  3. Pick POIs uniformly from those not yet on this board. A Chain picks two.

  If the board runs out of POIs, generation stops early.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `pnpm vitest run packages/shared/test/orders`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): order rules, scoring, express timer and board generation" && git push
```

---

### Task 13: OrderSystem — HUB rules, progress and completion

**Files:**
- Create: `packages/shared/src/orders/OrderSystem.ts`
- Test: `packages/shared/test/orders/OrderSystem.test.ts`

**Interfaces:**
- Consumes: `generateBoard`, `scoreOrder`, `slotsFor` (Task 12), `PlayerZones` (Task 3), `SimEvent` and `StatModifiers` (Tasks 4 and 9).
- Produces:

```ts
interface ActiveOrder { order: Order; acceptedAt: number; stepIndex: number; fragileIntact: boolean }
type AcceptResult = 'ok' | 'not_in_hub' | 'no_slots' | 'cooldown' | 'gone';
type CancelResult = 'ok' | 'not_in_hub' | 'unknown';
type OrderEvent =
  | { kind: 'boardRefreshed' }
  | { kind: 'stepReached'; orderId: string; stepIndex: number; step: Step }
  | { kind: 'fragileBroken'; orderId: string; reason: 'fall' | 'respawn' }
  | { kind: 'completed'; orderId: string; points: number; coins: number; bonuses: Bonus[]; onTime: boolean | null };
interface Totals { points: number; coins: number; deliveries: number }
class OrderSystem {
  constructor(opts: { pois: PoiInfo[]; distance: PathDistance; hub: Vec3; cfg: OrdersConfig; baseSprintSpeed: number;
                      rng: Rng; unlocks: Unlocks; backpackCapacity: number; totals?: Totals }, now: number);
  readonly board: ReadonlyArray<Order | null>;    // length cfg.board.size; null = accepted, waiting for refresh
  readonly active: ReadonlyArray<ActiveOrder>;
  readonly totals: Totals;
  readonly nextRefreshAt: number; readonly cancelCooldownUntil: number;
  readonly backpackCapacity: number;
  setBackpackCapacity(n: number): void;
  usedSlots(): number; freeSlots(): number;
  canAccept(orderId: string, now: number, inPlaza: boolean): AcceptResult;   // pure check for UI reasons
  accept(orderId: string, now: number, inPlaza: boolean): AcceptResult;
  cancel(orderId: string, now: number, inPlaza: boolean): CancelResult;
  update(now: number, zones: PlayerZones): OrderEvent[];
  onSimEvents(events: SimEvent[]): OrderEvent[];
  isCarried(a: ActiveOrder): boolean;             // dropoff: true; pickup/chain: stepIndex ≥ 1
  currentStep(a: ActiveOrder): Step;
  statModifiers(): StatModifiers;                 // jumpHeightMul = heavy.jumpHeightMultiplier while a Heavy package is carried
}
```

- [ ] **Step 1: Write the failing tests**

  The tests use a fixture OrderSystem with seeded rng, unlocks all true, and capacity 1 unless a test says otherwise.

```ts
it('accept outside the HUB plaza → not_in_hub', ...);
it('accept without enough free slots → no_slots (second order at capacity 1; Heavy at 1 free slot)', ...);
it('an accepted order leaves its slot null until the 60 s refresh, which replaces all 6 slots', ...);
it('accepting an id that a refresh replaced → gone (Review Focus 3)', ...);
it('cancel only in the plaza; it starts a 30 s cooldown; accept during cooldown → cooldown; at +30 s → ok', ...);
it('cancelling frees the slots', ...);
it('a drop-off completes on entering its POI zone; totals add its points and coins; deliveries + 1', ...);
it('pick-up: the POI collects (stepReached); the plaza does not complete it; the drop zone does', ...);
it('chain: B before A does nothing; A → B → drop zone completes with 4 pts / 40 coins', ...);
it('express: on time earns +1; late still completes without it', ...);
it('fragile: a 7.5 m fall while carried breaks it; 7.0 m does not; falls before pick-up collection do not count', ...);
it('fragile: respawn while carried breaks it', ...);
it('heavy: statModifiers().jumpHeightMul is 0.9 only while a Heavy package is carried', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/shared/test/orders/OrderSystem.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `OrderSystem`**

  - **`update`:**
    - When `now ≥ nextRefreshAt`, it regenerates the board and advances `nextRefreshAt` by `refreshSeconds`.
    - For each active order, the current step is reached when its `poiId` is in `zones.poiIds`, or for a `hub` step when `zones.inDropZone` is true. That advances `stepIndex` and emits `stepReached`.
    - When the last step is reached, the order is scored with `onTime` (null unless Express; otherwise `now − acceptedAt ≤ expressLimit`) and `intact`, the totals are updated, and the order is removed.
  - **`onSimEvents`:** a `landed` event with `fallHeight > fragile.maxFallMeters`, or a `respawned` event, breaks every carried Fragile order. Being hit by another player also breaks Fragile, but that arrives with combat in SP4.
  - **Constructor:** generates the first board at `now` and sets `nextRefreshAt = now + refreshSeconds`.
  - **`accept`:** does nothing unless `canAccept` returns `'ok'`.

- [ ] **Step 4: Run all shared tests and confirm they pass**

  Run: `pnpm vitest run packages/shared`
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): OrderSystem with HUB rules, steps, express, fragile and heavy" && git push
```

---

### Task 14: Client bootstrap — greybox rendering, input and the fixed-step loop

**Files:**
- Create: `config/client.json`
- Create: `packages/client/package.json`, `tsconfig.json`, `index.html`, `vite.config.ts`, `playwright.config.ts`
- Create: `packages/client/src/main.ts`, `src/clientConfig.ts`, `src/game/Game.ts`, `src/game/debugHooks.ts`
- Create: `src/input/actionState.ts`, `src/input/InputManager.ts`
- Create: `src/render/Renderer.ts`, `greyboxMeshes.ts`, `cameraRig.ts`
- Create: `src/ui/styles.css`
- Dependencies: `three@0.186.1`, `@dm/shared` (workspace). Dev dependencies: `@types/three@0.186.0`, `vite@8.3`, `@playwright/test@1.64`.
- Test: `packages/client/test/actionState.test.ts`, `cameraRig.test.ts`, `packages/client/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: everything exported by `@dm/shared` so far.
- Produces `config/client.json`:

```json
{
  "camera": { "fovBase": 80, "fovMax": 96, "fovSpeedMin": 8, "fovSpeedMax": 18, "wallRunRollDeg": 8, "eyeHeight": 1.6, "crouchEyeHeight": 1.0, "pitchLimitDeg": 89 },
  "graphics": { "maxPixelRatio": 2, "shadows": true, "shadowMapSize": 2048, "shadowExtent": 80, "fogNear": 150, "fogFar": 650, "drawCallBudget": 150 },
  "input": { "mouseSensitivity": 0.0022, "invertY": false, "bindings": {
    "forward": ["KeyW"], "back": ["KeyS"], "left": ["KeyA"], "right": ["KeyD"], "jump": ["Space"], "crouch": ["KeyC"],
    "sprint": ["ShiftLeft", "ShiftRight"], "interact": ["KeyE"], "board": ["KeyQ"], "hit": ["Mouse0"],
    "devPanel": ["Backquote"], "debugOverlay": ["F3"] } }
}
```

- Produces `ClientConfig` (the type of the JSON above) and `clientConfig` in `src/clientConfig.ts`.
- Produces `class ActionState`:
  - `constructor(input: ClientConfig['input'], pitchLimitRad: number)`
  - `keyDown(code)`, `keyUp(code)`, `mouseDown(button)`, `mouseUp(button)`, `mouseMove(dx, dy)`, `releaseAll()`
  - `sampleTick(): InputFrame`. It consumes pressed edges: a press made and released between two ticks still reports `pressed` on the next tick.
  - `look(): { yaw: number; pitch: number }`, for the per-frame camera
  - `onUiKey: ((name: 'devPanel' | 'debugOverlay') => void) | null`
- `InputManager(target: HTMLElement, actions: ActionState, opts: { requirePointerLock: boolean })` wires the DOM:
  - keydown and keyup, ignoring `repeat`
  - mousemove using `movementX` / `movementY`, only while locked
  - `blur`, `visibilitychange` (hidden) and `pointerlockchange` (unlocked) all call `releaseAll()`
  - a click requests pointer lock
- `Game.create(host: HTMLElement, opts: { debug: boolean }): Promise<Game>` and `start(): void`.
- `fovForSpeed(speed: number, cam): number` and `eyeHeight(state: PlayerState, cam): number`.
- `buildGreyboxMeshes(map: MapData): THREE.Group` merges all static solids into one geometry per kind, with vertex colours tinted by a hash of the id.
- In debug mode only (`?debug`), `window.__dm` provides:
  - `ready: boolean` and `tick: number`
  - `player(): { position; velocity; mode; onBoard }`
  - `teleport(p: Vec3): void`
  - `renderInfo(): { calls: number; triangles: number }`

- [ ] **Step 1: Write the failing unit tests**

```ts
// actionState.test.ts
it('W gives move.y = 1; W + D is normalised to length 1', ...);
it('a tap between ticks reports pressed on the next tick only', ...);
it('a held key does not re-trigger pressed on repeated keyDown', ...);
it('releaseAll clears held buttons and movement (Review Focus 2)', ...);
it('pitch is clamped to ±89°', ...);
it('unbound keys are ignored; Backquote and F3 call onUiKey', ...);

// cameraRig.test.ts
it('fovForSpeed: 80 at ≤ 8 m/s, 96 at ≥ 18 m/s, linear in between', ...);
it('eyeHeight is 1.0 when crouched or sliding and 1.6 otherwise', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/client`
  Expected: FAIL.

- [ ] **Step 3: Implement the input modules and `cameraRig.ts`**

- [ ] **Step 4: Implement `Renderer`, `greyboxMeshes` and `Game`, and set up Vite**

  - **`Renderer`:**
    - three.js `WebGLRenderer` with pixel ratio `min(devicePixelRatio, maxPixelRatio)` and a `ResizeObserver`.
    - Hemisphere light plus a directional light whose shadow camera follows the player (`shadowExtent`), fog, and a flat sky colour.
    - Use a fictional courier palette (for example teal and coral). Do not use orange on black.
  - **`Game` loop:** on each animation frame, call `stepper.advance(frameDt)`. For each step:
    1. Copy the previous position.
    2. `events = sim.step(inputFrame, NO_MODS, world, tick / tickRate)`. Task 17 replaces `NO_MODS` with `orders.statModifiers()`.
    3. Then render, with the camera position interpolated by `lerpVec3(prev, cur, alpha)` + `eyeHeight`, and the camera yaw and pitch taken from `actions.look()` every frame.
  - **`vite.config.ts`:**
    - `base: process.env.PAGES_BASE ?? '/'`
    - `server.fs.allow` includes the repo root, since `config/` and `map/` sit outside the client
    - `build.target: 'es2022'`
  - **`playwright.config.ts`:**
    - `webServer: { command: 'pnpm preview --port 4173 --strictPort', url }`
    - `use.baseURL: 'http://localhost:4173' + (PAGES_BASE ?? '/')`
    - `launchOptions.executablePath: process.env.PW_CHROMIUM_PATH` (set it to `/opt/pw-browsers/chromium` in the cloud sandbox)
    - launch args `--use-angle=swiftshader --enable-unsafe-swiftshader`
  - **Client `e2e` script:** `vite build && playwright test`.

- [ ] **Step 5: Write the e2e smoke test** `packages/client/e2e/smoke.spec.ts`

```ts
test('loads, renders the greybox and reports ready', async ({ page }) => {
  // goto('?debug=1'); wait for __dm.ready; no console errors; canvas visible
  // screenshot → e2e-artifacts/sp1-spawn.png
});
test('holding W + Shift for 1 s runs at ~8 m/s', async ({ page }) => {
  // keyboard.down('KeyW'), ('ShiftLeft'); wait 1000 ms; horizontal speed in [7.5, 8.5]; moved > 5 m
});
test('draw calls stay under the budget', async ({ page }) => {
  // __dm.renderInfo().calls < clientConfig.graphics.drawCallBudget
});
```

- [ ] **Step 6: Run everything**

  Run: `pnpm check && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`
  Expected: all unit tests pass; `3 passed` in Playwright.

- [ ] **Step 7: Look at `e2e-artifacts/sp1-spawn.png` and confirm the city and the HUB area are visible, then commit**

```bash
git add -A && git commit -m "feat(client): greybox render, input layer, fixed-step loop with interpolation" && git push
```

---

### Task 15: GitHub Pages deploy

**Files:**
- Create: `.github/workflows/pages.yml`, `README.md` (project overview, local dev commands, a playtest section with controls and the Pages URL, and one-time Pages setup)

**Interfaces:**
- Consumes: the root scripts `check` and `e2e` (Task 1), and `PAGES_BASE` support in Vite and Playwright (Task 14).
- Produces: a deployed site at `https://shikoyud.github.io/delivery-maxing/` after each push to `main` or `sp1/movement-delivery-loop`.

- [ ] **Step 1: Write `.github/workflows/pages.yml`**

```yaml
name: Deploy client to GitHub Pages
on:
  push:
    branches: [main, sp1/movement-delivery-loop]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      PAGES_BASE: /delivery-maxing/
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm --filter @dm/client exec playwright install --with-deps chromium
      - run: pnpm e2e            # builds dist with PAGES_BASE and tests that exact build
      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: e2e-artifacts
          path: packages/client/e2e-artifacts
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: packages/client/dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: Confirm the base path works locally**

  Run: `PAGES_BASE=/delivery-maxing/ PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`
  Expected: `3 passed`. The assets resolve under `/delivery-maxing/`.

- [ ] **Step 3: Validate the workflow YAML**

  Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pages.yml'))" && echo ok`
  Expected: `ok`

- [ ] **Step 4: Write the README playtest section**

  It covers:
  - The controls table.
  - `?debug=1`, which turns on the debug hooks and overlay.
  - The dev panel key (`` ` ``).
  - The one-time setup: make the repository public; set Settings → Pages → Source to "GitHub Actions"; add `sp1/movement-delivery-loop` under Settings → Environments → `github-pages` → Deployment branches.

- [ ] **Step 5: Commit, push and check the run**

```bash
git add -A && git commit -m "ci: deploy client to GitHub Pages" && git push
```

  Then run `gh run list --branch sp1/movement-delivery-loop --limit 1`. If the API is blocked from the sandbox, ask the user to check the Actions tab.
  Expected: build succeeds. Deploy succeeds once the one-time setup is done; until then it fails at `deploy-pages`, which is expected and should be reported.

---

### Task 16: Movement feature visuals and camera feel

**Files:**
- Create: `packages/client/src/render/featureMeshes.ts`
- Modify: `cameraRig.ts`, `Game.ts`, `debugHooks.ts`
- Modify: `map/greybox.json`. Add one zip line, jump pad, boost orb, rail and chute near the HUB, so the e2e tests have features before Task 18 builds the full city.
- Test: `packages/client/test/cameraRig.test.ts` (extend), `e2e/smoke.spec.ts` (extend)

**Interfaces:**
- Produces `buildFeatureMeshes(map: MapData): { group: THREE.Group; setOrbVisible(id: string, visible: boolean): void; update(timeSeconds: number): void }`:
  - zip lines: a cable with end posts
  - rails: tubes
  - jump pads: discs with an arrow along the horizontal part of `launch`
  - boost orbs: emissive, bobbing
  - chutes: a striped colour
- Produces `rollForWallRun(state: PlayerState, cam): number` in radians. When wall-running, it leans away from the wall by `wallRunRollDeg` (wall on the right gives a negative roll); otherwise it returns 0. The renderer eases toward it.
- `window.__dm.orbVisible(id): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
it('rollForWallRun: wall on the right → −8°; wall on the left → +8°; not wall-running → 0', ...);
// e2e
test('a collected orb disappears', ...);   // teleport into the starter-map orb; __dm.orbVisible(id) === false
test('feature screenshot', ...);           // teleport to a viewpoint → e2e-artifacts/sp1-features.png
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/client && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`
  Expected: FAIL.

- [ ] **Step 3: Implement the feature meshes and the camera roll/FOV, and hide or show orbs every frame from `world.orbAvailableAt`**

- [ ] **Step 4: Run the tests and look at the screenshot**

  Run: `pnpm check && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`
  Expected: everything passes, and the screenshot shows each feature clearly.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(client): visuals for zip lines, rails, pads, orbs, chutes; FOV kick and wall-run roll" && git push
```

---

### Task 17: Delivery UI — HUB, Order Board, HUD, waypoints and local progress

**Files:**
- Create: `packages/client/src/game/progress.ts`
- Create: `src/render/hubMeshes.ts`, `waypoints.ts`
- Create: `src/ui/hudModel.ts`, `hud.ts`, `orderBoard.ts`, `popups.ts`
- Modify: `Game.ts`, `debugHooks.ts`, `styles.css`
- Test: `packages/client/test/progress.test.ts`, `hudModel.test.ts`, `e2e/smoke.spec.ts` (extend)

**Interfaces:**
- Consumes: `OrderSystem`, `playerZones`, `buildPoiTable`, `streetDistance` and `generateBoard` (through `OrderSystem`).
- Produces in `progress.ts`:
  - `interface ProgressStore { load(): Totals; save(t: Totals): void }`
  - `createProgressStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null): ProgressStore`. The key is `dm.progress.v1`. Thrown errors or malformed JSON give `{ points: 0, coins: 0, deliveries: 0 }`, and `save` swallows errors.
  - `browserStorage(): Storage | null`, which reads `window.localStorage` inside try/catch.
- Produces in `hudModel.ts`:
  - `poiLabel(poi: Poi): string`, for example `"Mailbox · Harbor"`
  - `hudModel(orders: OrderSystem, map: MapData, player: Vec3, now: number): HudModel`

```ts
interface HudModel {
  totals: Totals; slots: { used: number; capacity: number };
  refreshIn: number; cooldownLeft: number;
  orders: Array<{ id: string; title: string; modifier: Modifier | null; stage: string; target: Vec3;
                  distance: number /* straight-line metres, rounded */;
                  express: { secondsLeft: number; late: boolean } | null; fragileIntact: boolean | null }>;
}
```

  The stage strings are:
  - Drop-off: `Deliver to {poi}`
  - Pick-up: `Collect at {poi}`, then `Return to HUB`
  - Chain: `Collect at {A}`, then `Deliver to {B}`, then `Return to HUB`

- `OrderBoardView`:
  - `open(): void`, `close(): void`, `readonly isOpen: boolean`
  - `render(orders: OrderSystem, now: number, inPlaza: boolean): void`
  - Every card carries `data-order-id`. A disabled Accept button shows its reason from `canAccept`: `Needs {n} free slot(s)`, `Cooldown {s} s`, or `Return to the HUB`.
  - Active orders are listed with Cancel buttons.
  - Opening releases pointer lock. Esc or E closes the board.
- `Popups.show(text: string, lines?: string[])`.
- `window.__dm.orders` provides `{ board(); active(); totals(); accept(id): AcceptResult }`.

- [ ] **Step 1: Write the failing tests**

```ts
// progress.test.ts
it('round-trips totals', ...);
it('returns zeros when getItem throws (Review Focus 5)', ...);
it('returns zeros for malformed JSON', ...);
it('save does not throw when setItem throws', ...);
it('null storage returns zeros', ...);

// hudModel.test.ts
it('pick-up stage reads "Collect at …" then "Return to HUB" after collection', ...);
it('express secondsLeft counts down; late flips after the limit', ...);
it('distance is the straight-line distance to the current target, rounded to 1 m', ...);
it('refreshIn = nextRefreshAt − now; cooldownLeft is never negative', ...);

// e2e (extend smoke.spec.ts)
test('accept a drop-off at the kiosk and deliver it', async ({ page }) => {
  // teleport to the kiosk, press E → board visible → screenshot sp1-order-board.png
  // pick a dropoff id from __dm.orders.board(); click [data-order-id=id] .accept; press Escape
  // teleport to that POI position → popup contains "pts" → totals.points ≥ 1 → screenshot sp1-delivered.png
});
test('progress survives a reload', ...);
test('HUD shows the active order with distance', ...);   // screenshot sp1-hud.png
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/client`
  Expected: FAIL.

- [ ] **Step 3: Implement the modules and wire them into `Game`**

  Each tick:
  1. `mods = orders.statModifiers()`
  2. `simEvents = sim.step(modalOpen ? emptyInput() with current look : frame, mods, world, now)`
  3. `orders.onSimEvents(simEvents)`
  4. `orders.update(now, playerZones(...))`
  5. Send the resulting events to the popups, and save progress on `completed`.

  Interact behaviour: if E was pressed this tick, the player is within `hub.kioskRange` of `hub.kiosk`, and the mode isn't `zipline`, open the board.

  Other wiring:
  - The `OrderSystem` capacity comes from `ordersConfig.backpack.baseSlots`; Task 19 overrides it.
  - Unlocks are `{ express: true, chain: true }`.
  - The board seed comes from a `?seed=N` query parameter when one is present, and from `Date.now()` otherwise. The e2e tests pass a fixed seed whose first board includes a Drop-off; the test asserts that, so it fails deterministically instead of flaking.
  - `hubMeshes` draws the plaza ring, the drop-zone disc, the kiosk and a post for every POI. POIs that are current targets are highlighted.
  - `waypoints` draws a translucent beam at each active order's current target, with one colour per order slot.

- [ ] **Step 4: Run everything and look at the three screenshots**

  Run: `pnpm check && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`
  Expected: everything passes, and the screenshots show the board, the HUD and the delivery popup legibly.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(client): HUB, Order Board, HUD, waypoints, popups, local progress" && git push
```

---

### Task 18: Greybox city content

**Files:**
- Modify: `map/greybox.json` (the full city)
- Test: `packages/shared/test/world/greyboxContent.test.ts`, `packages/client/e2e/smoke.spec.ts` (overview screenshot)

**Interfaces:**
- Consumes: `expandGreybox`, `createPhysicsWorld`, `buildPoiTable`, `streetDistance`.
- Produces the playable city. Its layout follows §5.1 in greybox form, with +x east and −z north:

| Area | Where | Content |
|---|---|---|
| HUB plaza | centre, reserved ≥ 60 × 60 m | kiosk, drop zone |
| Movement playground | east of the HUB, reserved | mantle blocks of 1.0, 1.5 and 1.8 m; a wall-run alley (two 20 m × 6 m walls, 4 m apart); a 1.4 m crouch tunnel; a chute; a zip line from a 12 m tower; a jump pad onto a 10 m roof; 3 orbs in a line; a rail; a skate ramp |
| Downtown | NE | buildings 12–40 m, fill 0.85; 4 m alleys form wall-run lanes and rooftop gaps; jump pads give rooftop access |
| Harbor | SE | containers and warehouses 3–9 m, fill 0.6; long zip lines from crane towers; water edge |
| Hillside | NW | hand-placed ramp streets rising to a 20 m plateau; chutes back down; houses fill 0.4 on the flat parts |
| Suburbs & Skatepark | SW | houses 4–8 m, fill 0.5; a reserved skatepark with ramps and at least 3 rails |

- [ ] **Step 1: Write the failing content tests**

```ts
it('has 18–22 POIs with unique ids, ≥ 4 in each of downtown/harbor/hillside/suburbs, all four kinds', ...);
it('has ≥ 5 POIs in each band by street distance from the HUB', ...);
it('no POI is inside a solid, and each has ground within 0.5 m below', ...);   // point-in-OBB + physics ray
it('has ≥ 6 zip lines (≥ 2 longer than 80 m), ≥ 8 jump pads, ≥ 10 orbs, ≥ 3 chutes, ≥ 6 rails', ...);
it('has ≥ 1 checkpoint per district plus one at the HUB', ...);
it('keeps every feature inside the island (|x|, |z| ≤ size/2)', ...);
it('has no zip line end or orb inside a solid, and every jump pad on a surface', ...);
it('keeps the HUB plaza and the playground clear of generated buildings', ...);
```

- [ ] **Step 2: Run them and confirm they fail against the starter map**

  Run: `pnpm vitest run packages/shared/test/world/greyboxContent.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Author `map/greybox.json` until the tests pass**

  Keep POIs at doors and road edges, or on low roofs that a mantle, pad or zip line can reach. Each feature gets an id prefixed by its district (for example `downtown-pad-03`).

- [ ] **Step 4: Run everything and take the overview screenshots**

  Run: `pnpm check && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`

  Add an e2e test that teleports to (0, 120, 200) looking at the HUB and saves `sp1-city-overview.png`, plus one for the playground (`sp1-playground.png`).

  Expected: everything passes, and draw calls are still under budget.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(map): greybox city with five areas, ~20 POIs and the full feature set" && git push
```

---

### Task 19: Dev tuning panel

**Files:**
- Create: `packages/client/src/game/devSettings.ts`, `src/ui/devPanel.ts`, `src/ui/debugOverlay.ts`
- Modify: `Game.ts`, `packages/client/package.json` (adds `lil-gui@0.21`)
- Test: `packages/client/test/devSettings.test.ts`

**Interfaces:**
- Produces in `devSettings.ts`:
  - `interface DevSettings { backpackSlots: number; movement: MovementConfig }`
  - `createDevSettingsStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): { load(): DevSettings; save(s: DevSettings): void; reset(): DevSettings }`. The key is `dm.dev.v1`. Saved values are deep-merged over the config defaults. Unknown keys and non-number values are dropped. Storage failures return the defaults.
- Produces `mountDevPanel(settings: DevSettings, hooks: { onBackpack(n: number): void; onReset(): void; onResetProgress(): void }): { toggle(): void }`:
  - It uses lil-gui, with one folder per movement section except `capsule`, `controller` and `tickRate`, which need a body rebuild.
  - A backpack slots slider from 1 to `backpack.maxSlots`.
  - Buttons: "Copy movement JSON" (clipboard, falling back to a textarea), "Reset tuning" and "Reset progress".
  - The panel edits the same `MovementConfig` object that `PlayerSim` holds, so changes apply on the next tick.
- `debugOverlay` (F3) shows FPS, draw calls, speed, mode, `onBoard`, the tick and the player position.

- [ ] **Step 1: Write the failing tests**

```ts
it('defaults equal config/movement.json and backpackSlots = baseSlots (1)', ...);
it('saved overrides merge over defaults; unknown keys and non-numbers are dropped', ...);
it('storage that throws falls back to defaults (Review Focus 5)', ...);
it('reset removes the saved overrides', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `pnpm vitest run packages/client/test/devSettings.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement it and wire it into `Game`**

  The movement config passed to `PlayerSim` is a deep clone of the dev settings' `movement`, so the shared config import is never mutated.

- [ ] **Step 4: Run everything**

  Run: `pnpm check && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`
  Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(client): dev tuning panel and debug overlay" && git push
```

---

### Task 20: Verification and playtest handoff

**Files:**
- Create: `docs/playtest/sp1/*.png` (screenshots copied from `e2e-artifacts`)
- Modify: the PR description (no code)

- [ ] **Step 1: Run the full verification**

  Run: `pnpm lint && pnpm typecheck && pnpm test && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`
  Expected: everything passes. Keep the summary lines (ESLint, `tsc`, `Test Files … passed`, `Tests … passed`, Playwright `N passed`).

- [ ] **Step 2: Check the base-path build**

  Run: `PAGES_BASE=/delivery-maxing/ PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`
  Expected: everything passes.

- [ ] **Step 3: Copy the screenshots and commit them**

  Copy `sp1-spawn`, `sp1-features`, `sp1-playground`, `sp1-city-overview`, `sp1-order-board`, `sp1-hud` and `sp1-delivered` into `docs/playtest/sp1/`, then:

```bash
git add docs/playtest/sp1 && git commit -m "docs: SP1 playtest screenshots" && git push
```

- [ ] **Step 4: Confirm the Pages run for the last commit is green and the site loads at `https://shikoyud.github.io/delivery-maxing/`**

- [ ] **Step 5: Update the PR description**

  Include the Pages URL, the controls, the test summary lines, the screenshots, and this playtest checklist:

  - **Movement:**
    - Sprint, then jump; walk off a ledge and jump late (coyote time).
    - Mantle the 1.0 m and 1.5 m blocks; fail the 1.8 m block.
    - Crouch-slide on flat ground and downhill.
    - Wall-run the alley and chain a wall-jump.
    - Ride a zip line and jump off.
    - Take a jump pad, a boost orb, a chute and a rail on foot and on the board.
    - Toggle the board with Q.
    - Fall into the water and respawn.
  - **Delivery:**
    - Complete one of each order type and each modifier, using the dev panel to set 2+ slots for Heavy.
    - Make an Express delivery on time and one late.
    - Break a Fragile bonus with a big drop.
    - Cancel an order and check the 30 s cooldown.
    - Watch a board refresh.
    - Reload and confirm Points and Coins persist.
  - **Feel:** is moving around fun on its own? Note any value you changed in the dev panel ("Copy movement JSON" makes this easy).

- [ ] **Step 6: Run the final review chosen at handoff (a whole-branch reviewer), fix what it finds, then tell the user the build is ready to playtest**
