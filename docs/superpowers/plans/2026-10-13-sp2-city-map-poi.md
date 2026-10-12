# SP2 — City Map + POI System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SP1 greybox with a 2 × 2 km city of five districts built from the committed CC0 Quaternius packs. The city is streamed in chunks with LOD and holds 60 fps. It has about 150 navmesh-checked POIs (at least 40% elevated), the new distance bands, the §5.3 POI selection rules, single-player thieves (§7.3) and a map debug view. This plan also ships the three movement changes from SP1 playtest 2.

**Architecture:**

- **New `packages/tools` (Node only, never bundled).** It holds three build steps whose outputs are committed:
  - The asset pipeline turns `assets/source/**.fbx` into runtime GLBs and writes the piece catalog `map/pieces.json`.
  - A seeded city generator turns `map/city.source.json` into the placement file `map/city.json`.
  - The navmesh step (recast-navigation) builds the navmesh and the POI table, `map/city.navmesh.bin` and `map/city.poi.json`, and fails on unreachable POIs.
- **`packages/shared` gains what the SP4 server will also need:**
  - the city map types and parser, chunk maths and a collider pager;
  - the street graph and the thief sim;
  - a distance table, POI selection rules, robbery and local epoch points.
- **`packages/client`:**
  - Loads `city.json` at runtime with `fetch`.
  - Draws buildings as instanced meshes per piece and LOD ring, using one shared palette-atlas material. Code-built geometry is merged per 250 m render region.
  - Pages physics colliders around the player and renders the thieves.
  - Adds a map debug view (F4) and a `?perf=1` flythrough.

**Tech Stack:** As in SP1: TypeScript ~6.0.3, pnpm 10.28 workspaces, Vite 8.3.4, three.js 0.186.1, `@dimforge/rapier3d-compat` 0.21.0, Vitest 5, Playwright 1.64 and ESLint 10. New, in tools only: `recast-navigation` 0.43.1, `@gltf-transform/core`, `/functions` and `/extensions` 4.5.1, `meshoptimizer` 1.3.0, `fbx2gltf` 0.9.7-p1 (it ships a Linux FBX2glTF binary), `pngjs` 7.0.0 and `tsx` 4.23.15.

**Spec:** `docs/superpowers/specs/2026-10-12-delivery-maxing-design.md`, mainly §4 (movement changes, already updated in this plan PR), §5 (city and POIs), §7.3 (thieves), §11 (thief warning and epoch points), §12, §14, the §15 row for sub-project 2, and the §16 performance risk. The SP1 plans (`docs/superpowers/plans/2026-10-12-sp1-*.md`) describe the code this plan extends.

## Global Constraints

- All SP1 global constraints still apply: Node 22, pnpm 10.28, TS `~6.0.3`, Rapier exactly `0.21.0`, and `packages/shared` never imports `three`, the DOM or `window`. The sim runs at a fixed 30 Hz, and gameplay reads actions only.
- Rapier 0.21 has no `updateSceneQueries`. After you add or remove colliders, call `world.step()` so queries see them.
- `packages/tools` is Node-only. Neither the client nor shared may import it, and recast-navigation, gltf-transform and fbx2gltf never reach the browser bundle.
- Every tuning value lives in `config/*.json`. Spec values that must appear exactly:
  - **Movement (§4, revised 2026-10-13):**
    - Shift toggles sprint. Sprint is also off whenever no move key is held. The sprint state lives in `PlayerState`.
    - Starting a slide adds a +4 m/s burst, so a sprint slide reaches about 12 m/s, never above the 18 m/s cap.
    - The burst then has a 2 s cooldown, counted from the start of the boosted slide. A slide started during the cooldown keeps its speed but gets no burst.
    - Slides use lower friction. Crouch is C only.
  - **City (§5.1):** 2 × 2 km (x and z in [−1000, 1000]), with five districts: Central Plaza (HUB), Downtown Rooftops, Harbor Docks, Hillside, and Suburbs & Skatepark. Water and cliffs form the outer boundary. Falling into water or out of bounds respawns the player at the nearest checkpoint.
  - **POIs (§5.2, §5.3):**
    - About 150 candidates, each with an id, position, district and a kind (door, mailbox, counter or balcony). At least 40% are elevated, and each elevated POI has a way down with no fall over 7 m.
    - Bands use the one-way path distance from the HUB: Short < 500 m, Medium 500–1,200 m, Long > 1,200 m.
    - Spread 40 m, reuse 3 min, district balance, and Chain weighted higher than in SP1.
    - Unreachable candidates fail the build.
  - **Thieves (§7.3):**
    - They trigger on a carrying courier within 15 m with line of sight, and chase at 7 m/s for at most 10 s. A robbed courier is ignored for 20 s.
    - They stay on streets and plazas only, never enter the HUB plaza, and use no wall-run, mantle, zip, pad or rail.
    - A catch steals every carried package (those orders fail) and costs 1 Delivery Point from the current epoch, floored at 0. Uncollected Pick-up and Chain orders are kept.
  - **Performance (§1, §16):** 60 fps on a mid-range laptop, proven before the full city is authored (the Task 8 checkpoint).
- Assets: only the committed CC0 files in `assets/source/quaternius/` (see `assets/CREDITS.md`). Every runtime file is listed in CREDITS.md when added. No casino imagery, and no Amazon names, logos or trade dress.
- CI: this plan PR already adds `sp2/city-map-poi` to `pages.yml`. The only other CI-affecting change is `map:check` joining `pnpm check` (Task 14), which the user approves with this plan.
- Done means `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm map:check` and `pnpm e2e` all pass, with headless-Chromium screenshots in the PR. The user confirms 60 fps on their laptop at the Task 8 checkpoint and again at the playtest.

## Review Focus

1. **Respawn or teleport into chunks with no colliders loaded.** This happens on a fall into harbor water far from the loaded ring, a debug teleport, or a checkpoint across the map. The player should land on the ground and never fall through unloaded geometry. Pinned in Task 5: the pager loads the target chunks before the next move, plus a test that respawns 900 m away.
2. **The navmesh returns a partial path as success.** Recast's `computePath` reports `success: true` with a path that stops short of the target (seen in the planning spike). That could pass an unreachable POI. Pinned in Task 14: `reaches(path, target, tol)`, plus a one-way-ledge fixture that must be unreachable.
3. **The selection rules leave fewer than 6 candidates.** This happens with many active orders, recent reuse or a small district set. The board should show fewer cards and never throw or loop. Pinned in Task 15.
4. **A robbery with mixed orders** (a collected Chain, an uncollected Pick-up, a Heavy Drop-off). Only carried packages go: the Heavy jump penalty lifts, uncollected orders and their waypoints stay, and epoch points never go below 0. Pinned in Task 17.
5. **Stale instanced-mesh bounds after LOD reassignment.** three.js would frustum-cull buildings that are on screen after the player crosses the map. Pinned in Task 7: a test that every LOD0 mesh's bounding sphere contains all of its active instances after `update()` moves them.

## SP2 decisions (from the user, 2026-10-13)

- Shift toggles sprint, the slide boost uses an Apex-style cooldown, and crouch stays on C. These are already written into spec §4 in this plan PR.
- Assets come from the packs the user supplied, committed unchanged under `assets/source/quaternius/`.
- The Pages workflow also deploys `sp2/city-map-poi`, so the user can playtest.

## Assumptions to confirm at review

The spec is silent on these, so these are my defaults. Strike any you disagree with. Task 20 writes the confirmed ones into the spec.

1. **Slide cooldown start.** The 2 s counts from the start of the boosted slide, as in Apex. The intake said "about 2 s after the last boosted slide". Counting from the slide's start is what makes slide-hopping on cooldown work.
2. **Shift while standing still.** Pressing Shift with no move key leaves sprint off: it can only switch on while moving, because the release rule would switch it off on the same tick.
3. **Art set.**
   - The Ultimate Textured Building Pack supplies every building. It is baked at ×2.8, so one story is about 3.5 m, a single-width building is about 6 m wide, and `6Story_Stack` is about 22 m tall.
   - Downtown places buildings at ×3.2–4.2, so its blocks reach about 20–33 m.
   - The ground, roads, plaza, cliffs, containers, cranes and gameplay objects are built in code.
   - The Downtown City MegaKit is not used (photoreal PBR, about 3× heavier).
4. **Generated city.** A seeded generator expands `map/city.source.json` (district templates plus hand-placed landmarks) into the committed placement file `map/city.json`. It runs at build time, not in the browser.
5. **Layout.**
   - The Central Plaza is at the centre. Downtown is NE (x > 0, z < 0), Harbor SE, Hillside NW and Suburbs & Skatepark SW.
   - The north and west edges are cliffs; the east and south edges are quays over water (water surface at y = −1.5).
   - Hillside rises in terraces to about 40 m in the NW corner.
6. **Elevated POI.** A POI is elevated when its zone base is at least 2.5 m above the street-level ground at that spot. Rooftop deliveries use kind `door` (a roof door); balconies use `balcony`.
7. **Navmesh links.**
   - Jump pads are one-way, up. Zip lines are two-way. Mantle steps are two-way (mantle up, step down).
   - Drop links are one-way, down, and at most 7 m, the Fragile limit. They are part of the base movement kit.
   - The "way down" check is that a navmesh path from the POI back to the HUB exists. Since no drop link is over 7 m, any such path qualifies.
8. **Path distance.** It is the length of the navmesh straight path (3D polyline, links counted as straight segments). It counts only if the path ends within 1 m (config) of the target.
9. **Route distance.**
   - It uses the measured directions: a Pick-up is `fromHub + toHub` and a Chain is `fromHub(A) + A→B + toHub(B)`.
   - Bands still use one-way `fromHub`. SP1 used 2·d for a Pick-up.
10. **POI rules.**
    - A POI is "used" when an order containing it is accepted. It is not offered again for 180 s.
    - Spread is horizontal distance: every POI on the board is at least 40 m from every other board POI and from every POI of an active order.
    - District balance weights each POI by `1 / (1 + n)`, where n is how many of the last 6 accepted POIs were in its district.
    - The Chain type weight goes from 2 to 4.
11. **Thief movement and escape.**
    - Thieves move on a street graph (road and sidewalk strips), without physics colliders.
    - A catch needs the courier within 0.9 m horizontally and 1.6 m vertically. A courier more than 1.6 m above the thief can't be caught, and the thief gives up after 1 s of that.
    - A thief also gives up beyond 35 m, after 10 s, or when the courier enters the HUB plaza. Line of sight is a physics raycast.
12. **Epoch points.** They are kept locally in wall-clock 10-minute UTC windows (spec §9.4 boundaries) and shown on the HUD. The thief penalty applies to them, floored at 0. Lifetime PTS is unchanged. SP4 and SP5 move this server-side.
13. **Streaming.**
    - Chunks are 100 m. Physics colliders load for chunks within 150 m of the player and unload beyond 220 m.
    - Render LOD rings: LOD0 (full model) up to 160 m, LOD1 (small details dropped) up to 400 m, LOD2 (tinted box) up to 700 m, with fog ending at 700 m.
    - All models load at start (about 2–3 MB). Streaming decides which instances and colliders are active.
14. **Performance proof.**
    - CI checks proxies at fixed viewpoints, because headless SwiftShader can't measure real fps: draw calls ≤ 200 (up from 150) and triangles ≤ 700k.
    - Real fps is measured by the user on their laptop with `?perf=1`. The Task 8 checkpoint stops for this.
15. **SP1 greybox.** It stays as a test fixture and as `?map=greybox` (useful for movement tuning), with its own bands (150 / 350 m) in config.
16. **CI.** `pnpm check` adds `pnpm map:check`, which regenerates the map and POI table and fails if they differ from the committed files or any POI is unreachable. The project rule requires the user's OK on this CI change.

## File Structure

```
config/movement.json                 + slide.boostSpeed, slide.boostCooldown; slide.friction 2 → 1.2
config/world.json                    NEW chunkSize, physics load/unload radii
config/thieves.json                  NEW §7.3 values
config/orders.json                   bands per map; selection rules; epoch; chain weight 4
config/client.json                   budgets, fog, city LOD rings, thief render radius, perf route, F4 binding
map/city.source.json                 NEW hand-authored generator input (districts, landmarks, quotas)
map/pieces.json                      GENERATED piece catalog (assets:build)
map/city.json                        GENERATED placement file (map:build)
map/city.poi.json                    GENERATED POI table: distances, elevated, reachability (map:build)
map/city.navmesh.bin                 GENERATED recast navmesh export (map:build)
assets/city/                         GENERATED runtime GLBs + palette atlas (assets:build)
packages/tools/                      NEW (@dm/tools)
  package.json tsconfig.json vitest.config.ts
  assets.config.json                 per-source-file id, scale, kind, collider overrides
  src/assets/convert.ts atlas.ts pieceGeometry.ts pipeline.ts sheet.ts
  src/city/source.ts generate.ts layout.ts streets.ts boundary.ts hub.ts lots.ts kits.ts pois.ts
  src/city/districts/downtown.ts harbor.ts hillside.ts suburbs.ts
  src/nav/geometry.ts navmesh.ts poiTable.ts
  src/bin/assets-build.ts assets-sheet.ts map-build.ts map-check.ts
  test/…                             mirrors src; test/helpers/citySim.ts
packages/shared/src/
  movement/sprint.ts                 NEW updateSprint
  world/pieces.ts cityTypes.ts chunks.ts colliderPager.ts poiTable.ts streets.ts   NEW
  orders/distanceTable.ts selection.ts epoch.ts   NEW
  thieves/types.ts ThiefSystem.ts     NEW
packages/client/src/
  game/mapLoader.ts                  NEW picks city or greybox, loads JSON
  render/city/paletteMaterial.ts lodRings.ts regions.ts CityView.ts   NEW
  render/thieves/ThiefView.ts        NEW
  ui/mapDebug.ts perfOverlay.ts      NEW
  game/perf.ts                       NEW ?perf=1 flythrough
```

Branch: `sp2/city-map-poi`. Every commit step ends with `git push`, because sandboxes reset. Commit trailers follow the session's attribution rules. Tests run with `pnpm vitest run <path>` from the repo root.

---

### Task 1: Sprint toggle in the shared sim

**Files:**
- Create: `packages/shared/src/movement/sprint.ts`, `packages/shared/test/movement/sprint.test.ts`
- Modify: `packages/shared/src/movement/types.ts` (`PlayerState.sprinting`), `movement/PlayerSim.ts` (call `updateSprint` in step 1, initialise `sprinting: false`), `movement/ground.ts` (`targetGroundSpeed` reads `state.sprinting`), `movement/slide.ts` (`startSlide` reads `state.sprinting`)
- Modify: `packages/shared/test/helpers/simHarness.ts`, `test/movement/groundStall.test.ts`, `test/world/greyboxContent.test.ts` (sprint by toggle)
- Modify: `packages/client/index.html` (hint `Shift sprint (toggle)`), `packages/client/test/playHint.test.ts`, `packages/client/src/ui/debugOverlay.ts` (shows `sprint on/off`), `packages/client/e2e/smoke.spec.ts` (sprint by tapping Shift)

**Interfaces:**
- Produces: `updateSprint(state: PlayerState, input: InputFrame): void`. On `input.sprint.pressed` it flips `state.sprinting`. Then, if `!hasMoveInput(input)`, it sets `state.sprinting = false`. It runs every tick before locomotion (in `updateLookAndTimers`).
- Produces: `PlayerState.sprinting: boolean`. `targetGroundSpeed` uses `state.sprinting` in place of `input.sprint.held`. `InputFrame` is unchanged (the client already latches `sprint.pressed`).
- Produces (harness): `Hold.sprint` now means "sprint should be on". `makeInput` sets `sprint.pressed` on a tick where `(hold.sprint ?? false) !== sim.state.sprinting` and the hold has move input. Existing tests keep their meaning.

- [ ] **Step 1: Write the failing tests** in `sprint.test.ts`. Use raw `InputFrame`s, not the harness's `Hold.sprint`, so the toggle itself is under test:
  - `'a Shift tap while moving turns sprint on: holding W reaches 8 m/s within 0.5 s'`: `expect(state.sprinting).toBe(true)`, and after 15 ticks `horizontalLength(v)` is close to 8 (to 1 decimal).
  - `'a second Shift tap turns it off: speed settles to 5.5'`.
  - `'releasing every move key turns sprint off; W again runs at 5.5 without a new tap'`.
  - `'a Shift tap with no move key leaves sprint off'`.
  - `'sprint stays on through a jump while W is held'`.
- [ ] **Step 2: Run it to see it fail.** `pnpm vitest run packages/shared/test/movement/sprint.test.ts` → FAIL (`updateSprint` is not exported, and `sprinting` is undefined).
- [ ] **Step 3: Implement** `updateSprint`, the `PlayerState` field, and the `ground.ts` and `slide.ts` reads. Then update the harness (`makeInput` needs `sim.state`, so pass the state in). Switch the two content tests that set `input.sprint.held = true` to pressing Shift whenever `!sim.state.sprinting`.
- [ ] **Step 4: Run the whole shared suite.** `pnpm vitest run packages/shared` → all PASS. The SP1 movement tests are unchanged apart from the harness.
- [ ] **Step 5: Client.**
  - Hint text: `Shift sprint (toggle)`. In `playHint.test.ts`, assert `'Shift sprint'` is still contained.
  - Debug overlay line: `sprint  on`.
  - e2e: `'W then a Shift tap runs at ~8 m/s'` replaces `'holding W + Shift for 1 s runs at ~8 m/s'`. Every other e2e that sprints taps Shift once after pressing W.
  - Run `pnpm test && pnpm --filter @dm/client e2e` → PASS.
- [ ] **Step 6: Commit** `feat(movement): Shift toggles sprint (state in PlayerState)` and push.

### Task 2: Slide boost with cooldown, lower slide friction

**Files:**
- Modify: `config/movement.json` (`slide: { minEntrySpeed: 6, friction: 1.2, endSpeed: 3.5, slopeGravityScale: 1, boostSpeed: 4, boostCooldown: 2 }`), `packages/shared/src/config/types.ts`
- Modify: `packages/shared/src/movement/types.ts` (`PlayerState.slideBoostCooldown: number`; SimEvent `{ kind: 'slideStarted'; boosted: boolean }`), `movement/slide.ts`, `movement/PlayerSim.ts` (count the cooldown down by `dt` each step, as with `boostLeft`; push `slideStarted`)
- Test: `packages/shared/test/movement/slide.test.ts`

**Interfaces:**
- Consumes: `PlayerState.sprinting` (Task 1).
- Produces: `startSlide(state, input, cfg): 'none' | 'boosted' | 'plain'`.
  - It needs: crouch pressed, `state.sprinting`, grounded on foot in ground mode, not on the board, and speed ≥ `minEntrySpeed`.
  - When `slideBoostCooldown <= 0`, it adds `boostSpeed` along the horizontal velocity, clamps the horizontal speed to `speedCap`, sets `slideBoostCooldown = boostCooldown` and returns `'boosted'`. Otherwise it returns `'plain'`.
  - Landing-kept slides (R26) and chute slides never get a burst.
- Produces: SimEvent `slideStarted` with `boosted: boolean`, for client feedback later.

- [ ] **Step 1: Write the failing tests** in `slide.test.ts` (new `describe('slide boost')`):
  - `'a sprint slide starts at 12 m/s (8 + boostSpeed 4)'`: the speed on the slide-start tick is close to 12 (to 1 decimal).
  - `'keeps ≥ 11.3 m/s after 0.5 s on flat (friction 1.2)'`.
  - `'a second slide 1.0 s after the first boosted one gets no burst (keeps current speed)'`: the event has `boosted: false`, and the speed on that tick is ≤ the speed on the tick before.
  - `'the burst returns 2 s after the start of the boosted slide'`: the event has `boosted: true` at ≥ 60 ticks after the first.
  - `'the burst never passes speedCap: entering at 16 m/s gives 18'`: inject 16 m/s with `sim.state.velocity` on a sprinting, grounded player.
  - `'a landing slide (R26) and a chute slide never boost'`.
- [ ] **Step 2: Run them.** `pnpm vitest run packages/shared/test/movement/slide.test.ts` → the new tests FAIL. The old slide tests still pass.
- [ ] **Step 3: Implement** the config and type fields, the `startSlide` return value, the cooldown countdown in `step()` and the event push.
- [ ] **Step 4: Run** `pnpm vitest run packages/shared` → PASS. The dev panel shows the new `slide` fields automatically (it iterates the config sections). `pnpm --filter @dm/client test` → PASS.
- [ ] **Step 5: Commit** `feat(movement): slide boost +4 m/s with 2 s cooldown, slide friction 1.2` and push.

### Task 3: Tools package and asset pipeline

**Files:**
- Create: `packages/tools/package.json` (`@dm/tools`, private, `type: module`; scripts `assets:build`: `tsx src/bin/assets-build.ts`, `assets:sheet`, `map:build`, `map:check`, `typecheck`; dependencies pinned as in the Tech Stack line, plus `@dm/shared: workspace:*`), `tsconfig.json`, `vitest.config.ts`
- Modify: root `package.json` scripts `assets:build`, `map:build`, `map:check` (each `pnpm --filter @dm/tools <name>`); `eslint.config.js` if it needs the new package path
- Create: `packages/tools/assets.config.json`, `src/assets/convert.ts`, `src/assets/atlas.ts`, `src/assets/pieceGeometry.ts`, `src/assets/pipeline.ts`, `src/assets/sheet.ts`, `src/bin/assets-build.ts`, `src/bin/assets-sheet.ts`
- Create: `packages/shared/src/world/pieces.ts` (types and parser), export from `index.ts`
- Generated and committed: `assets/city/buildings/*.glb` (`<id>.glb` and `<id>.lod1.glb`), `assets/city/characters/thief-casual.glb` and `thief-longsleeve.glb`, `assets/city/palette-atlas.png`, `map/pieces.json`, `docs/playtest/sp2/pieces-sheet.png`
- Modify: `assets/CREDITS.md` (one row per runtime file, naming its source file)
- Test: `packages/tools/test/assets/pieceGeometry.test.ts`, `atlas.test.ts`, `catalog.test.ts`; `packages/shared/test/world/pieces.test.ts`

**Interfaces:**
- Produces (shared `world/pieces.ts`):
  ```ts
  export interface PieceCollider { center: Vec3; size: Vec3; rotationDeg?: Vec3 } // piece-local metres
  export interface PieceEntry {
    id: string;                       // 'b-4story', 'p-balcony', 'c-thief-casual'
    kind: 'building' | 'part' | 'character';
    lod0: string; lod1: string | null; // paths relative to assets/
    size: Vec3;                       // AABB after baking, metres; origin at footprint centre, y = 0 at the base; the door faces +z
    tris: [number, number];           // lod0, lod1 (0 when none)
    roofY: number | null;             // walkable flat roof height, null for gable/round roofs and parts
    colliders: PieceCollider[];
    avgColor: [number, number, number]; // linear RGB, used for LOD2 boxes
  }
  export type PieceCatalog = Record<string, PieceEntry>;
  export function parsePieceCatalog(json: unknown): PieceCatalog; // throws with the offending id on a malformed entry
  ```
- Produces (tools):
  - `convertFbx(src: string, outGlb: string): void`: runs `node_modules/fbx2gltf/bin/<platform>/FBX2glTF --binary`, and throws on a non-zero exit.
  - `bakeAndCentre(doc: Document, scale: number): void`: bakes the node transforms into the vertices (the FBX exports are Z-up, with a −90° X rotation and ×100 node scale), applies `scale`, and moves the origin to the footprint centre at the base.
  - `roofHeight(doc): number | null`: the highest 0.05 m level whose horizontal-face area (either winding) is ≥ 40% of the footprint area, and above 2 m.
  - `wallCollider(doc, roofY): PieceCollider`: x and z bounds of the vertices with 0.8 m < y < roofY − 0.8 m, height `roofY`.
  - `dropSmallIslands(doc, minDiagonal: number): void`: removes connected components (by shared quantised positions) whose AABB diagonal is < `minDiagonal` (1.4 m). This makes LOD1.
  - `buildPaletteAtlas(pngs: string[]): { png: Buffer; rows: string[] }`: stacks the 32 × 32 palettes vertically into 32 × (32·n), in `assets.config.json` order.
- Planning spike data, for the implementer: meshopt `simplify` only takes 4Story from 6,862 to 6,055 triangles (many separate small boxes), while dropping islands under 1.4 m leaves about 40%. Roof heights found by `roofHeight` at ×1: 4Story 4.85, 6Story_Stack 7.55, 2Story_Wide_2Doors 2.55.

- [ ] **Step 1: Write failing tests.**
  - `pieceGeometry.test.ts`, using a tiny in-memory glTF Document built in the test (two stacked boxes plus a 0.3 m cube):
    - `'bakeAndCentre bakes a -90° X node rotation and ×100 scale into vertices and puts the base at y = 0'`.
    - `'roofHeight finds the top slab, ignoring a small roof box above it'`.
    - `'dropSmallIslands removes the 0.3 m cube and keeps both big boxes'`.
    - `'wallCollider spans the walls, not a porch below 0.8 m'`.
  - `atlas.test.ts`: `'three 32×32 palettes stack into 32×96 with rows in config order'`.
  - Shared `pieces.test.ts`: `'parsePieceCatalog rejects an entry with lod1 tris > lod0 tris, a non-positive size, or a collider outside the AABB (±0.5 m)'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/tools packages/shared/test/world/pieces.test.ts` → FAIL.
- [ ] **Step 3: Implement** the modules above, plus `pipeline.ts`: `runAssetPipeline(cfg, srcRoot, outRoot): PieceCatalog`.
  - For each entry in `assets.config.json` (fields `{ src, id, kind, scale, colliders?, keepClips? }`): convert, bake, set every material to one material named `palette` (keep UVs), and write LOD0.
  - Buildings: write LOD1 (`dropSmallIslands`), and set `roofY` and colliders. Use the config's `colliders` override for `1Story_GableRoof`, `2Story_GableRoof`, `1Story_RoundRoof` and `2Story_RoundRoof` (eave box plus two roof slabs rotated to the roof pitch; author them from the sheet in Step 5).
  - Characters: keep only the clips `Man_Idle`, `Man_Walk`, `Man_Run` and `Man_Punch`, and scale so the height is 1.8 m.
  - Write `assets/city/palette-atlas.png` and `map/pieces.json`. Use stable key order and round numbers to 0.001.
  - Config scale: buildings and parts 2.8.
  - Ids: `b-` plus the lower-kebab source name for buildings, `p-` for parts, `c-thief-casual` and `c-thief-longsleeve`.
- [ ] **Step 4: Run** `pnpm assets:build`, then add `catalog.test.ts`, which reads the committed outputs:
  - `'every building has lod1 ≤ 50% of lod0 triangles'`.
  - `'flat-roof buildings have roofY within ±0.4 m of their AABB top or below it'`.
  - `'assets/city totals ≤ 6 MB'`.
  - `'no runtime file comes from CasinoSign or Texture_Casino'`.
  - Run it → PASS.
- [ ] **Step 5: Contact sheet.**
  - `pnpm --filter @dm/tools assets:sheet` uses Playwright to render every piece on a grid with its colliders as wireframes, its `roofY` plane and a +z arrow, into `docs/playtest/sp2/pieces-sheet.png`.
  - Open the image and check three things: colliders hug the walls, gable and round roof slabs match the roofs, and doors face +z. If a model's door faces another way, add `rotY` to that config entry and rebuild.
- [ ] **Step 6: CREDITS.** Add one row per runtime file (`assets/city/...` ← `assets/source/...`, Quaternius, CC0 1.0, "converted to GLB, baked to metres, LOD1 drops parts under 1.4 m"). Run `pnpm lint && pnpm typecheck` → PASS.
- [ ] **Step 7: Commit** `feat(tools): asset pipeline → runtime GLBs, LOD1, palette atlas, piece catalog` and push.

### Task 4: City map schema and chunk maths (shared)

**Files:**
- Create: `config/world.json` (`{ "chunkSize": 100, "physics": { "loadRadius": 150, "unloadRadius": 220 } }`); add `WorldConfig` to `config/types.ts` and `worldConfig` to `config/index.ts`
- Create: `packages/shared/src/world/cityTypes.ts`, `world/chunks.ts`; export both
- Modify: `world/mapTypes.ts` (`SolidKind` adds `'road' | 'sidewalk' | 'cliff' | 'container' | 'crane' | 'stairs'`; `Solid.hidden?: boolean` marks a collider whose look comes from a prop; `Poi.elevated?: boolean`)
- Test: `packages/shared/test/world/chunks.test.ts`, `cityTypes.test.ts`

**Interfaces:**
- Produces (`cityTypes.ts`):
  ```ts
  export type RotY = 0 | 90 | 180 | 270;
  export interface Prop { id: string; piece: string; position: Vec3; rotY: RotY; scale: number; palette: string | null }
  export interface StreetNode { id: string; p: Vec3; plaza: boolean }   // plaza: inside the HUB exclusion (thieves never use it)
  export interface StreetEdge { a: string; b: string; halfWidth: number; long: boolean } // halfWidth covers road + sidewalks
  export interface NavLink { id: string; kind: 'pad' | 'zip' | 'mantle' | 'drop'; from: Vec3; to: Vec3; bidirectional: boolean }
  export interface ThiefSpawn { id: string; node: string; district: District }
  export interface DistrictArea { district: District; rect: Rect }
  export interface CityMap extends MapData {
    kind: 'city'; seed: number; chunkSize: number; districts: DistrictArea[]; props: Prop[];
    streets: { nodes: StreetNode[]; edges: StreetEdge[] }; navLinks: NavLink[]; thiefSpawns: ThiefSpawn[];
  }
  export function parseCityMap(json: unknown, pieces: PieceCatalog): CityMap;
  ```
  `parseCityMap` throws when:
  - an id is duplicated;
  - a solid's x or z extent is larger than `chunkSize`;
  - a prop names an unknown piece or has an invalid `rotY`;
  - an edge names an unknown node;
  - something lies outside ±size/2 plus the margin.
- Produces (`chunks.ts`):
  - `type ChunkKey = string` (`"cx,cz"`).
  - `chunkOf(x, z, size): ChunkKey`.
  - `chunksOverlapping(rect: Rect, size): ChunkKey[]`.
  - `chunksWithin(center: Vec3, radius: number, size): ChunkKey[]`: chunks whose square comes within `radius` of the centre, measured horizontally.
  - `solidRect(s: Solid): Rect`: the horizontal AABB, with rotation honoured.

- [ ] **Step 1: Write failing tests.**
  - `chunks.test.ts`:
    - `'chunkOf(-0.01, 0, 100) is "-1,0"; chunkOf(99.99, 199.99, 100) is "0,1"'`.
    - `'chunksWithin radius 150 around (50,0,50) with size 100 returns the 5×5 block minus its corners'`.
    - `'solidRect of a 10×1×2 box rotated 90° about y is 2 × 10'`.
    - `'a 20 m box straddling x = 0 overlaps chunks -1,0 and 0,0'`.
  - `cityTypes.test.ts`: one minimal valid city passes, plus one failing case per throw rule above.
- [ ] **Step 2: Run** `pnpm vitest run packages/shared/test/world` → FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Run** → PASS, then `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(world): city map schema, chunk maths, world config` and push.

### Task 5: Collider pager (shared) and PlayerSim on a paged world

**Files:**
- Create: `packages/shared/src/world/colliderPager.ts`; export it
- Modify: `world/physicsWorld.ts` (factor out `addSolidCollider(world, rapier, s): Collider`, reused by both)
- Test: `packages/shared/test/world/colliderPager.test.ts`

**Interfaces:**
- Consumes: `chunksWithin`, `chunksOverlapping`, `solidRect`, `worldConfig` (Task 4).
- Produces:
  ```ts
  export interface PagedPhysicsWorld extends PhysicsWorld {
    /** Loads chunks within loadRadius of `center`, unloads beyond unloadRadius; calls world.step() if anything changed. Returns whether it changed. */
    update(center: Vec3): boolean;
    loadAll(): void;                  // tests, tools and the SP4 server
    loadedChunks(): ReadonlySet<ChunkKey>;
  }
  export function createPagedPhysicsWorld(rapier: Rapier, map: MapData, chunkSize: number, radii: WorldConfig['physics']): PagedPhysicsWorld;
  ```
  - A solid that spans several chunks is reference-counted: it is created once, and removed when its last chunk unloads.
  - `surfaceOf` covers paged colliders.
  - The pager never touches colliders it didn't create, such as the player capsule.
- Game contract (Task 7 wires it): call `physics.update(sim.state.position)` before every `sim.step`, and `physics.update(p)` inside `Game.teleport` before `sim.teleport`.

- [ ] **Step 1: Write the failing tests.** Use a 1,000 m strip of 100 m ground tiles plus a wall at x = 450:
  - `'a ray at the far wall misses until update() near it, then hits'`.
  - `'hysteresis: a chunk at 180 m stays loaded, one at 230 m unloads'`.
  - `'a solid spanning two chunks exists while either chunk is loaded'`.
  - `'surfaceOf reports chute for a paged chute collider'`.
  - `'PlayerSim sprinting 900 m across the strip with update() before each step never drops below y = -0.05'`.
  - `'Review Focus 1: respawn to a checkpoint 900 m away, then update(); grounded within 3 ticks and y ≥ -0.05'`. Force the respawn by teleporting below `outOfBoundsY` with a far checkpoint.
- [ ] **Step 2: Run** `pnpm vitest run packages/shared/test/world/colliderPager.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Index the solids by chunk once, at construction.
- [ ] **Step 4: Run** → PASS. Then `pnpm vitest run packages/shared` → PASS. `createPhysicsWorld` behaves as before.
- [ ] **Step 5: Commit** `feat(world): chunked collider pager with hysteresis` and push.

### Task 6: City generator core (layout, streets, boundary, hub, filler buildings)

**Files:**
- Create: `map/city.source.json`
- Create in `packages/tools/src/city/`:
  - `source.ts`: `CitySource` type and `parseCitySource`.
  - `generate.ts`: `generateCity`.
  - `layout.ts`: arterials and district street grids.
  - `streets.ts`: road and sidewalk solids and the street graph.
  - `boundary.ts`: cliffs, quays and water.
  - `hub.ts`: ports the SP1 plaza, kiosk and drop zone.
  - `lots.ts`: places pieces on lots.
  - `stableJson.ts`.
  - `../bin/map-build.ts`: in this task it writes only `map/city.json`.
- Generated and committed: `map/city.json`
- Test: `packages/tools/test/city/generate.test.ts`

**Interfaces:**
- Consumes: `PieceCatalog` (Task 3); `CityMap` and the chunk maths (Task 4).
- `CitySource`:
  - `seed`, `size: 2000` and `hub` (the SP1 hub values, centre (0, 0, 0), plaza radius 30).
  - `arterials: { pitch: 200, halfWidth: 10 }`.
  - `districts`: one entry per quadrant, each `{ district, rect, template, params }`. `template` is `'downtown' | 'harbor' | 'hillside' | 'suburbs'`; until Tasks 9–12 every template runs the `filler`.
  - `boundary: { cliffEdges: ['north','west'], waterEdges: ['east','south'], cliffHeight: 40, quayInset: 30 }`.
  - `landmarks: []`, filled by the district tasks.
  - `pois: { total: 150, elevatedTarget: 0.45, minSpacing: 25, perDistrict: {…}, perBandMin: 20 }` and `checkpoints: { spacing: 150 }`.
- Produces: `generateCity(src: CitySource, pieces: PieceCatalog): CityMap`. It is deterministic (one `mulberry32(seed)` stream per district, keyed by district name). Every coordinate is rounded to 0.01.
- Produces: `writeStableJson(path, value)`: sorted keys and 2-space indentation, so diffs stay readable.
- Produces (the district builder contract, used by Tasks 9–13):
  ```ts
  export interface PoiSlot { position: Vec3; kind: PoiKind; elevated: boolean; district: District; access: 'street' | 'kit' | 'route' }
  export interface DistrictContext { district: District; rect: Rect; rng: Rng; pieces: PieceCatalog; move: MovementConfig; params: Record<string, unknown> }
  export interface DistrictOutput {
    solids: Solid[]; props: Prop[]; zipLines: ZipLine[]; jumpPads: JumpPad[]; boostOrbs: BoostOrb[]; rails: Rail[];
    checkpoints: Checkpoint[]; navLinks: NavLink[]; streets: { nodes: StreetNode[]; edges: StreetEdge[] }; poiSlots: PoiSlot[];
  }
  export function buildFiller(ctx: DistrictContext): DistrictOutput; // local street grid + lots filled with buildings; door slots at fronts
  ```
  `generateCity` merges the outputs of all districts with the core (arterials, boundary, hub, ground). Ids are prefixed by district, so they never clash.
- Rules this task fixes:
  - Ground is one 100 × 100 tile per chunk (y top = 0). Water edges have no ground beyond the quay line.
  - Cliffs are split into ≤ 100 m segments.
  - Roads (kind `road`, top y = 0.02) and sidewalks (kind `sidewalk`, top y = 0.15) are split at chunk borders.
  - Lots are the rectangles between streets. `lots.ts` fills each lot with building props (palette chosen by rng from the 10 non-sign palettes), and for each prop adds `hidden: true` solids from `piece.colliders`, transformed by `rotY` and scale.
  - Props face the nearest street (`rotY`). No prop overlaps a road, sidewalk or the plaza.

- [ ] **Step 1: Write failing tests** in `generate.test.ts`, using the real `map/city.source.json` and `map/pieces.json`:
  - `'same seed → byte-identical JSON'`.
  - `'parseCityMap accepts the output'`. This covers the chunk-size, id and bounds rules.
  - `'the street graph is connected from the node nearest the hub'` (BFS).
  - `'no building collider overlaps a road, sidewalk or the plaza circle'`.
  - `'every chunk inside the land area has a ground tile, and none lies beyond a water edge'`.
  - `'filler density: at least 1,500 building props'`. This is the stress load for Task 8.
- [ ] **Step 2: Run** `pnpm vitest run packages/tools/test/city/generate.test.ts` → FAIL.
- [ ] **Step 3: Implement** the modules and the `map:build` bin (in this task: `generateCity` → `map/city.json`).
- [ ] **Step 4: Run** `pnpm map:build && pnpm vitest run packages/tools` → PASS. Commit `map/city.json`, and check its size: it should be ≤ 3 MB, gzip ≤ 600 KB.
- [ ] **Step 5: Commit** `feat(city): seeded generator core — streets, boundary, hub, filler blocks` and push.

### Task 7: Client city renderer, map loader and streaming wiring

**Files:**
- Create: `packages/client/src/game/mapLoader.ts`, `render/city/paletteMaterial.ts`, `render/city/lodRings.ts`, `render/city/regions.ts`, `render/city/CityView.ts`
- Modify:
  - `game/Game.ts`: `?map=city` loads the city. The default stays the greybox until Task 15, because the city has no POIs or distances before then and the SP1 delivery e2e tests need them. Call `PagedPhysicsWorld.update` before each step and in `teleport` (the greybox uses `loadAll()`).
  - `render/Renderer.ts`: `info()` already returns calls and triangles.
  - `main.ts`: reads `?map=`.
  - `game/debugHooks.ts`: `renderInfo` already exists; add `loadedChunks()`.
- Modify `config/client.json`:
  - `graphics.drawCallBudget` 200, `graphics.triangleBudget` 700000, `graphics.fogFar` 700, `camera.far` 1000.
  - `city: { lodRadii: [160, 400, 700], relodDistance: 25, renderRegion: 250 }`.
  - `perf: { route: [ …8 viewpoints {feet, target} spread over all districts… ], seconds: 60, speed: 12 }`.
- Test: `packages/client/test/lodRings.test.ts`, `regions.test.ts`, `paletteMaterial.test.ts`; e2e in `smoke.spec.ts`

**Interfaces:**
- Consumes: `parseCityMap`, `parsePieceCatalog`, `createPagedPhysicsWorld`, `worldConfig`.
- Produces:
  - `loadMap(kind: 'city' | 'greybox'): Promise<{ map: MapData; city: CityMap | null; pieces: PieceCatalog | null }>`. It uses `fetch` on `?url` imports, so the JSON never enters the JS bundle.
  - `assignLods(props: readonly Prop[], center: Vec3, radii: [number, number, number]): { lod0: number[]; lod1: number[]; lod2: number[] }`. It is pure, takes the indices into `props`, and ignores props beyond `radii[2]`.
  - `regionOf(x, z, size): string`.
  - `buildRegionMeshes(map, regionSize): Map<string, THREE.Group>`. This merges the non-hidden solids per region: one vertex-coloured Lambert mesh, plus a ground mesh with the SP1 grid texture.
  - `createPaletteMaterial(atlas: THREE.Texture, rows: number): THREE.MeshLambertMaterial`. Its `onBeforeCompile` adds an `aPalette` instanced attribute and remaps `uv.y` to the row. The atlas uses nearest filtering and no mipmaps.
  - `class CityView { static load(city, pieces, cfg): Promise<CityView>; readonly group: THREE.Group; update(center: Vec3): void; stats(): { lod0: number; lod1: number; lod2: number } }`.
    - It builds one `InstancedMesh` per piece for LOD0 and another for LOD1 (capacity = that piece's prop count), plus one LOD2 box `InstancedMesh` with `instanceColor` from `avgColor`.
    - `update` reassigns instances when the centre has moved more than `relodDistance` or crossed into another chunk. It then sets `count`, flags `instanceMatrix` (and `aPalette`) for update, and calls `computeBoundingSphere()` (Review Focus 5).
    - Only LOD0 casts shadows. Regions beyond `lodRadii[2]` are hidden.

- [ ] **Step 1: Write failing unit tests.**
  - `lodRings.test.ts`:
    - `'a prop at 159 m is lod0, 161 m lod1, 401 m lod2, 701 m none'`.
    - `'distance is horizontal (a prop 300 m above is still lod0 at 0 m horizontal)'`.
  - `regions.test.ts`: `'(249.9, 0) and (250, 0) fall in different 250 m regions'`.
  - `paletteMaterial.test.ts`: `'the compiled vertex shader declares aPalette and divides uv.y by rows'`. Inspect the shader string after `onBeforeCompile`, with a fake shader object.
- [ ] **Step 2: Run** `pnpm vitest run packages/client/test/lodRings.test.ts packages/client/test/regions.test.ts packages/client/test/paletteMaterial.test.ts` → FAIL.
- [ ] **Step 3: Implement** the modules and the Game wiring. The spawn is `map.hub.spawn`. The city e2e tests below open `?debug&map=city`.
- [ ] **Step 4: Write failing e2e tests.**
  - `'city loads, renders and reports ready with no console errors'`.
  - `'draw calls ≤ drawCallBudget and triangles ≤ triangleBudget at every perf-route viewpoint'`.
  - `'Review Focus 5: after teleporting 1,500 m, each LOD0 InstancedMesh bounding sphere contains all its active instance positions'`. Expose this through the debug hooks as `cityBoundsOk()`.
  - `'the default (no ?map) still loads the SP1 greybox, and all SP1 e2e tests still pass'`.
  - Screenshot: `sp2-city-overview.png` (high viewpoint over the plaza).
- [ ] **Step 5: Run** `pnpm --filter @dm/client e2e` → PASS. Open the screenshot and check the buildings show their palette colours (not a single grey), the doors face the streets, and there are no holes at region borders.
- [ ] **Step 6: Commit** `feat(client): streamed city renderer — instanced pieces, LOD rings, palette atlas, region meshes` and push.

### Task 8: Perf mode and the 60 fps checkpoint (stop for the user)

**Files:**
- Create: `packages/client/src/game/perf.ts`, `packages/client/src/ui/perfOverlay.ts`
- Modify: `main.ts` (`?perf=1`), `game/debugHooks.ts` (`perf(): PerfResult | null`)
- Test: `packages/client/test/perfStats.test.ts`; e2e `'?perf=1 completes a short run (seconds=5) and reports a result'`

**Interfaces:**
- Produces: `summarize(frameMs: number[]): { p50: number; p95: number; p99: number; max: number; frames: number }`. It is pure; percentiles are nearest-rank.
- Produces: `runPerf(game, cfg.perf): Promise<PerfResult>`. It glides the player along `perf.route` at `perf.speed` m/s with the chase camera, for `perf.seconds`. It records the frame times and the maximum draw calls and triangles, then shows `perfOverlay` (p50/p95/p99 ms, fps at p95, max calls and triangles, GPU renderer string from `WEBGL_debug_renderer_info` when available) and a "Copy result" button.

- [ ] **Step 1: Write the failing test.** `perfStats.test.ts`: `'summarize([10×16.6, 1×40]) has p50 16.6, p99 40, frames 11'`.
- [ ] **Step 2: Run it** → FAIL. **Step 3: Implement** it. **Step 4: Run it** → PASS. Then run the e2e with `?perf=1&perfSeconds=5` → PASS.
- [ ] **Step 5: Commit** `feat(client): ?perf=1 flythrough with frame-time summary` and push. Wait for the Pages deploy of `sp2/city-map-poi` to succeed.
  - If the deploy job fails with "Branch … is not allowed to deploy to github-pages due to environment protection rules", ask the user to add `sp2/city-map-poi` under Settings → Environments → github-pages → Deployment branches. This session can't read that setting.
- [ ] **Step 6: CHECKPOINT. Stop and ask the user.**
  - Post the link `https://shikoyud.github.io/delivery-maxing/?map=city&perf=1` and ask them to run it on their mid-range laptop and paste the result.
  - Go on to Task 9 only when p95 ≤ 16.7 ms.
  - Otherwise tune only config, in this order, re-deploying each time: `city.lodRadii`, `graphics.fogFar`, `graphics.shadowMapSize` and `shadowExtent`, then `graphics.maxPixelRatio`. Record each result in the PR description.
  - If config tuning can't reach the target, stop and report. Don't redesign silently.

### Task 9: Downtown Rooftops district

**Files:**
- Create: `packages/tools/src/city/districts/downtown.ts`, `packages/tools/src/city/kits.ts` (shared feature builders), `packages/tools/test/helpers/citySim.ts`, `packages/tools/test/city/downtown.content.test.ts`
- Modify: `generate.ts` (dispatch the template), `map/city.source.json` (downtown params), `map/city.json` (regenerated)

**Interfaces:**
- Produces (`kits.ts`, used by Tasks 9–13):
  - `padLaunchFor(start: Vec3, target: Vec3, apexAbove: number, gravity: number): Vec3`: the ballistic launch velocity that peaks at `max(start.y, target.y) + apexAbove` and lands on `target`.
  - `mantleSteps(base: Vec3, top: Vec3, dir: RotY, rise: number): Solid[]`: crate steps, each rise ≤ `rise` (1.2 m), 1.5 m deep.
  - `zipBetween(a: Vec3, b: Vec3, id: string): ZipLine`.
  - `navLinkFor(feature: ZipLine | JumpPad | { kind: 'mantle' | 'drop'; from: Vec3; to: Vec3 }): NavLink`: zips are bidirectional, pads and drops one-way, mantle stacks bidirectional.
- Consumes: `DistrictContext`, `DistrictOutput`, `PoiSlot` (Task 6).
- Produces: `buildDowntown(ctx: DistrictContext): DistrictOutput`. Params in `city.source.json`:
  - block pitch 60 m, roads `halfWidth` 7;
  - props at scale 3.2–4.2, in rows with roof gaps of 2.5–4.5 m and height steps ≤ 1.2 m up or ≤ 7 m down along marked rooftop routes;
  - at least 6 wall-run alleys (4 m wide, walls ≥ 20 m long and ≥ 8 m high);
  - jump pads from street to roofs;
  - zip lines between rooftop clusters and down to street level;
  - boost orbs along rooftop routes.
- `citySim.ts`: `cityHarness(city: CityMap): Promise<Harness>`. This is the SP1 harness API, on the city with `loadAll()` physics.

- [ ] **Step 1: Write failing content tests**, run through PlayerSim on the generated city:
  - `'every downtown jump pad lands its rider on its target roof (feet within 1.5 m of the target, grounded, fall ≤ 7 m)'`.
  - `'every downtown zip line rides both ways and ends in a dismount (mode ground on the detach tick)'`. Reuse SP1's `rideZip` pattern from `greyboxContent.test.ts`.
  - `'each wall-run alley: a sprint-jump along the wall starts a wall-run'`.
  - `'each marked rooftop gap is cleared by a sprint jump from the edge'`.
  - `'downtown has ≥ 6 alleys and ≥ 12 pads'`.
  - Unit test: `'padLaunchFor lands on target in closed form (±0.05 m)'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/tools/test/city/downtown.content.test.ts` → FAIL.
- [ ] **Step 3: Implement** them. Then `pnpm map:build`.
- [ ] **Step 4: Run** → PASS, and the Task 6 generator tests still pass. Add the e2e screenshot `sp2-downtown.png` (a rooftop viewpoint over the alleys) and check the picture.
- [ ] **Step 5: Commit** `feat(city): Downtown Rooftops — tall blocks, rooftop gaps, wall-run alleys, pads, zips` and push.

### Task 10: Harbor Docks district

**Files:**
- Create: `packages/tools/src/city/districts/harbor.ts`, `packages/tools/test/city/harbor.content.test.ts`
- Modify: `map/city.source.json`, `map/city.json`

**Interfaces:**
- Produces: `buildHarbor(ctx): DistrictOutput`.
  - Quays along the east and south water edges, with checkpoints every ≤ 150 m along the quay.
  - Container yards: code-built `container` solids (6 × 2.6 × 2.4 m, stacks of 1–3) reached by `mantleSteps`.
  - At least 3 cranes (code-built `crane` frames 30–40 m tall, with a ladder replaced by pads to the jib).
  - Long zip lines (120–300 m) from crane jibs to the yards and quay.
  - Warehouse props (wide pieces, scale 2.8).

- [ ] **Step 1: Write failing content tests:**
  - `'every harbor zip line rides both ways and dismounts'`.
  - `'≥ 3 harbor zips are ≥ 120 m long'`.
  - `'every container stack top is reachable via its mantle steps (run at the steps, end on top)'`.
  - `'falling off the quay into the water respawns at a harbor checkpoint within 150 m and keeps packages'`. Use an `OrderSystem` with a carried drop-off.
  - `'no ground solid lies beyond the quay line'`.
- [ ] **Step 2: Run them** → FAIL. **Step 3: Implement** them, then `pnpm map:build`. **Step 4: Run them** → PASS, and add the e2e screenshot `sp2-harbor.png`.
- [ ] **Step 5: Commit** `feat(city): Harbor Docks — quays, container yards, cranes, long zip lines` and push.

### Task 11: Hillside district

**Files:**
- Create: `packages/tools/src/city/districts/hillside.ts`, `packages/tools/test/city/hillside.content.test.ts`
- Modify: `map/city.source.json`, `map/city.json`

**Interfaces:**
- Produces: `buildHillside(ctx): DistrictOutput`.
  - Terraces (flat ground plateaus) rising toward the NW corner up to about 40 m.
  - Steep streets: rotated `road` solids of 15–25°, which must stay under `controller.maxSlopeClimbDeg` (50); the street graph nodes carry y.
  - Stairs: `stairs` solids with a rise of 0.3 m per step, so they are walkable under `maxStepHeight` 0.4.
  - At least 3 long downhill slides (`chute` solids, 100–300 m).
  - Uphill jump pads.
  - Houses: gable and round pieces, scale 2.8.
  - A cliff boundary on the north and west edges.

- [ ] **Step 1: Write failing content tests:**
  - `'every hillside chute slides start to end without stopping (mode slide until the end, speed ≥ endSpeed)'`.
  - `'every steep street can be sprinted up (no stall; reaches the top terrace)'`.
  - `'every stair run can be walked up'`.
  - `'every uphill pad lands on its terrace'`.
  - `'the hillside top terrace is ≥ 35 m above y = 0'`.
- [ ] **Step 2: Run them** → FAIL. **Step 3: Implement** them, then `pnpm map:build`. **Step 4: Run them** → PASS, and add the e2e screenshot `sp2-hillside.png` (looking up a slide).
- [ ] **Step 5: Commit** `feat(city): Hillside — terraces, steep streets, stairs, long slides, uphill pads` and push.

### Task 12: Suburbs & Skatepark district

**Files:**
- Create: `packages/tools/src/city/districts/suburbs.ts`, `packages/tools/test/city/suburbs.content.test.ts`
- Modify: `map/city.source.json`, `map/city.json`

**Interfaces:**
- Produces: `buildSuburbs(ctx): DistrictOutput`.
  - Wide roads (`halfWidth` 10).
  - Houses (1–2 story pieces, scale 2.8) on yards.
  - A skatepark of at least 120 × 120 m, with at least 8 rails (`Rail`), quarter-pipe ramps (`ramp` solids) and a bowl.
  - Grind rails along at least 2 streets.
  - The south edge is water, with a beach-front quay and checkpoints.

- [ ] **Step 1: Write failing content tests:**
  - `'every suburbs rail can be grinded end to end on the board at railMinSpeed'`.
  - `'every rail can be grinded on foot at minSpeedFoot'`. Use the SP1 rail test pattern.
  - `'every skatepark ramp is rideable on the board (no stall)'`.
  - `'south quay checkpoints exist every ≤ 150 m'`.
- [ ] **Step 2: Run them** → FAIL. **Step 3: Implement** them, then `pnpm map:build`. **Step 4: Run them** → PASS, and add the e2e screenshot `sp2-suburbs-skatepark.png`.
- [ ] **Step 5: Commit** `feat(city): Suburbs & Skatepark — wide roads, houses, skatepark rails, ramps` and push.

### Task 13: POI candidates and access kits

**Files:**
- Create: `packages/tools/src/city/pois.ts`, `packages/tools/test/city/pois.test.ts`, `packages/tools/test/city/poiAccess.content.test.ts`
- Modify: `generate.ts` (POI pass after the districts), `map/city.source.json` (quotas), `map/city.json`

**Interfaces:**
- Consumes: `DistrictOutput.poiSlots`, `kits.ts`.
- Produces: `placePois(slots: PoiSlot[], ctx: PoiContext): { pois: Poi[]; extras: Partial<DistrictOutput> }`. It picks `pois.total` (150) slots and works as follows:
  - **Quotas:** `perDistrict` quotas, and at least `minSpacing` (25 m) between POIs.
  - **Elevated share:** ≥ `elevatedTarget` (0.45) elevated, so the 40% rule keeps a margin after the navmesh check.
  - **Bands:** at least `perBandMin` (20) per band, estimated with straight-line distance × 1.25 (the navmesh confirms in Task 14).
  - **Access kits:** for each elevated slot with `access: 'kit'`:
    - roof ≤ 7 m: mantle steps up and a drop link down;
    - roof > 7 m: a pad up and a zip line down to street level.
  - **Kinds:** door slots at building fronts (from the piece's +z face), mailbox slots on sidewalks (code-built mailbox), counter slots at code-built stalls and kiosks, balcony slots on code-built balcony ledges (3 × 1.5 m) fixed to facades at floor heights, and roof `door` slots.
  - **Ids:** `poi-<district>-<nn>`. `Poi.elevated` is set.

- [ ] **Step 1: Write failing tests.**
  - `pois.test.ts`:
    - `'150 POIs, ids unique'`.
    - `'≥ 45% elevated'`.
    - `'every district meets its quota'`.
    - `'no two POIs within 25 m'`.
    - `'≥ 20 POIs per estimated band'`.
    - `'every POI kind appears'`.
  - `poiAccess.content.test.ts`:
    - `'every kit pad lands on its POI roof'`.
    - `'every kit mantle stack is climbable to the POI'`.
    - `'every kit zip rides down and dismounts'`.
    - `'every drop link is ≤ 7 m'`.
- [ ] **Step 2: Run them** → FAIL. **Step 3: Implement** them, then `pnpm map:build`. **Step 4: Run them** → PASS.
- [ ] **Step 5: Commit** `feat(city): ~150 POI candidates with access kits, ≥45% elevated` and push.

### Task 14: Navmesh build, POI table and `map:check`

**Files:**
- Create: `packages/tools/src/nav/geometry.ts`, `nav/navmesh.ts`, `nav/poiTable.ts`, `packages/tools/src/bin/map-check.ts`
- Create: `packages/shared/src/world/poiTable.ts` (`PoiTableFile` type and `parsePoiTable`)
- Modify: `bin/map-build.ts` (also writes `map/city.poi.json` and `map/city.navmesh.bin`; exits 1 on validation errors unless `--allow-unreachable`); root `package.json` `check` script: `pnpm lint && pnpm typecheck && pnpm test && pnpm map:check` (CI change, user-approved)
- Test: `packages/tools/test/nav/*.test.ts`, `packages/shared/test/world/poiTable.test.ts`

**Interfaces:**
- Produces (shared):
  ```ts
  export interface PoiRow { id: string; district: District; elevated: boolean; fromHub: number; toHub: number; reachable: boolean }
  export interface PoiTableFile { version: 1; pois: PoiRow[]; between: number[][]; unreachable: { id: string; reason: string }[] }
  // between[i][j] = path metres from pois[i] to pois[j] (index order of `pois`), -1 when there is no path
  export function parsePoiTable(json: unknown): PoiTableFile;
  ```
- Produces (tools):
  - `solidsToTriangles(solids: Solid[]): { positions: Float32Array; indices: Uint32Array }` (12 triangles per box, rotation honoured).
  - `buildCityNavMesh(city: CityMap, move: MovementConfig): NavMesh`. It uses `generateTiledNavMesh` with:
    - `cs` 0.4, `ch` 0.2, `tileSize` 64;
    - `walkableRadius = ceil(capsule.radius / cs)`, `walkableHeight = ceil(capsule.height / ch)`, `walkableClimb = floor(maxStepHeight / ch)`, `walkableSlopeAngle = maxSlopeClimbDeg`;
    - `offMeshConnections` from `city.navLinks` (radius 0.6, `bidirectional` as given). Call `init()` once.
  - `pathLength(path: Vec3[]): number`.
  - `reaches(path: Vec3[], target: Vec3, tol: number): boolean`: true when the last point is within `tol` of the target (Review Focus 2).
  - `computePoiTable(city, navMesh, tol = 1.0): PoiTableFile`. `fromHub` and `toHub` are measured to and from `hub.center`. A POI is `reachable` only if both directions reach; the matrix is computed in both directions. Values are rounded to 0.1 m.
  - `validatePoiTable(table: PoiTableFile, city: CityMap, orders: OrdersConfig): string[]`: one error for each of these:
    - any POI is unreachable;
    - the elevated share among reachable POIs is < 0.40;
    - a band (`orders.bands.city`) has fewer than 20 POIs;
    - a drop link is longer than `fragile.maxFallMeters` (7);
    - there are fewer than 140 reachable POIs.
  - `map:check`: regenerates into a temp dir and byte-compares `city.json` and `city.poi.json` with the committed files, then runs the validation. It exits 1 with a diff summary when they differ.
- Navmesh size budget: `city.navmesh.bin` ≤ 6 MB. If it is bigger, raise `cs` to 0.5 in config and note it in the PR.

- [ ] **Step 1: Write failing tests.**
  - Fixture with two platforms, the HUB on the ground and a POI on a 6 m roof:
    - `'with only a pad link the POI is unreachable (way back fails); reaches() catches the partial path recast reports as success'` (Review Focus 2).
    - `'adding a 6 m drop link makes it reachable; fromHub ≈ path length'`.
    - `'a 9 m drop link fails validation'`.
  - `'solidsToTriangles of a 90°-rotated box matches its rotated corners'`.
  - `'computePoiTable is deterministic (two runs, identical JSON)'`.
  - Shared: `'parsePoiTable rejects a between matrix with the wrong size'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/tools/test/nav packages/shared/test/world/poiTable.test.ts` → FAIL.
- [ ] **Step 3: Implement** them. Then `pnpm map:build`.
  - Fix the content until there are no validation errors. Fixes go in the generator or kits, never in tolerances.
  - Commit the three map outputs.
- [ ] **Step 4: Run** `pnpm map:check` → exit 0. Then `pnpm check` → PASS. Record the `map:build` time and the file sizes in the PR.
- [ ] **Step 5: Commit** `feat(nav): recast navmesh, POI table, build fails on unreachable; map:check in pnpm check` and push.

### Task 15: Distance table, per-map bands and POI selection rules

**Files:**
- Create: `packages/shared/src/orders/distanceTable.ts`, `orders/selection.ts`
- Modify: `config/orders.json`:
  - `bands`: `{ "city": { "shortMax": 500, "mediumMax": 1200 }, "greybox": { "shortMax": 150, "mediumMax": 350 } }`
  - `selection`: `{ "spreadMeters": 40, "reuseSeconds": 180, "districtWindow": 6 }`
  - `mix.typeWeights.chain`: 4
- Modify: `config/types.ts`, `world/distance.ts` (`bandFor` unchanged; `buildPoiTable` → `buildPoiInfo(map, table: DistanceTable, bands)`; `PoiInfo` gains `elevated: boolean`), `orders/board.ts`, `orders/OrderSystem.ts`, `packages/client/src/game/delivery.ts` (picks the table and bands by map kind)
- Test: `packages/shared/test/orders/selection.test.ts`, `distanceTable.test.ts`, updates in `board.test.ts`, `OrderSystem.test.ts`, `rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DistanceTable { fromHub(poiId: string): number; toHub(poiId: string): number; between(a: string, b: string): number }
  export function streetDistanceTable(map: MapData): DistanceTable;           // SP1 |dx|+|dz| (greybox)
  export function navDistanceTable(file: PoiTableFile): DistanceTable;        // throws on an unknown id or a -1 entry
  export interface SelectionContext { now: number; recentUse: ReadonlyMap<string, number>; activePois: readonly Vec3[]; recentDistricts: readonly District[] }
  export function eligiblePois(pois: readonly PoiInfo[], ctx: SelectionContext, cfg: OrdersConfig['selection']): PoiInfo[];
  export function districtWeight(d: District, ctx: SelectionContext, cfg: OrdersConfig['selection']): number; // 1/(1+n) over the last districtWindow
  ```
- `BoardContext`:
  - `distance: PathDistance` and `hub` are replaced by `distances: DistanceTable`, and a `selection: SelectionContext` is added.
  - Routes: Drop-off `fromHub(p)`; Pick-up `fromHub(p) + toHub(p)`; Chain `fromHub(a) + between(a, b) + toHub(b)`. The band uses `fromHub`.
  - Each pick is weighted by `districtWeight` (via `pickWeighted`), and the pool is cut by `spreadMeters` against the POIs already on this board.
- `OrderSystem`:
  - Records `recentUse` (POI id → accept time) and `recentDistricts` (most recent first, capped at `districtWindow`) on `accept`.
  - Builds the `SelectionContext` from its active orders' POI positions on each `generate`.
  - `OrderSystemOptions` replaces `distance`/`hub` with `distances: DistanceTable`. Active-order POI positions come from `opts.pois` by id.

- [ ] **Step 1: Write failing tests.**
  - `selection.test.ts`:
    - `'a POI within 40 m (horizontal) of an active order's POI is excluded'`.
    - `'a POI accepted at t=100 is excluded at t=279 and allowed at t=280'`.
    - `'districtWeight is 1/3 for a district appearing twice in the last 6'`.
  - `board.test.ts`:
    - `'no two board POIs are within 40 m'`.
    - `'pickup route = fromHub + toHub; chain route = fromHub(A) + between(A,B) + toHub(B)'`.
    - `'bands use city limits 500/1200 with a nav table'`.
    - `'Review Focus 3: with 8 POIs all within 40 m of an active order, the board is empty and generate() returns []'`.
  - `distanceTable.test.ts`: `'navDistanceTable throws on an unknown id and on -1'`.
  - `OrderSystem.test.ts`:
    - `'accepting records reuse and district history'`.
    - `'the 6-card board shrinks, never throws, when rules exhaust candidates'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/shared/test/orders` → FAIL.
- [ ] **Step 3: Implement** them, and wire `DeliveryLoop`: the city uses `navDistanceTable` and `bands.city`; the greybox uses `streetDistanceTable` and `bands.greybox`. Then make the city the default map; `?map=greybox` selects the SP1 map. SP1 e2e tests that rely on greybox features (playground, crouch tunnel, the zip beside a building) open `?map=greybox`.
- [ ] **Step 4: Run** `pnpm test` → PASS. Then e2e `'accept a drop-off at the kiosk and deliver it'` on the city: teleport through the debug hook to the POI.
- [ ] **Step 5: Commit** `feat(orders): navmesh distances, city bands, spread/reuse/district-balance rules, chain weight 4` and push.

### Task 16: Thief sim (shared)

**Files:**
- Create: `config/thieves.json`:
  ```json
  { "triggerRadius": 15, "chaseSpeed": 7, "patrolSpeed": 2.2, "returnSpeed": 3.5, "maxChaseSeconds": 10,
    "robbedCooldownSeconds": 20, "catchRadius": 0.9, "catchHeight": 1.6, "aboveGiveUpSeconds": 1.0,
    "loseDistance": 35, "plazaMargin": 6, "eyeHeight": 1.6, "penaltyPoints": 1,
    "perDistrict": { "downtown": 4, "harbor": 3, "hillside": 3, "suburbs": 3 }, "longStreetExtra": 4 }
  ```
  Add `ThievesConfig` and `thievesConfig`.
- Create: `packages/shared/src/world/streets.ts`, `packages/shared/src/thieves/types.ts`, `thieves/ThiefSystem.ts`; export them
- Modify: `packages/tools/src/city/generate.ts` (thief spawns from `perDistrict`, plus `longStreetExtra` on `long` edges, which are arterial edges whose midpoint is > 600 m from the hub; spawn nodes never `plaza`); `map/city.json`
- Test: `packages/shared/test/world/streets.test.ts`, `packages/shared/test/thieves/ThiefSystem.test.ts`

**Interfaces:**
- Produces:
  - `class StreetGraph { constructor(data: CityMap['streets'], hub: Hub, plazaMargin: number); ... }`, with these methods:
    - `project(p: Vec3): { p: Vec3; edge: number }`: the nearest point inside any edge strip (capsule of `halfWidth`), with y interpolated along the edge, and never inside `hub.plazaRadius + plazaMargin`.
    - `nextNode(from: string, prev: string | null, rng: Rng): string`: a random neighbour, preferring not to turn back, never a `plaza` node.
    - `route(fromNode: string, toNode: string): string[]`: A* over the edges.
    - `nearestNode(p: Vec3): string`.
  - Thief types:
    ```ts
    export type ThiefMode = 'patrol' | 'chase' | 'return';
    export interface ThiefState { id: string; position: Vec3; heading: number; speed: number; mode: ThiefMode; chaseTime: number; aboveTime: number; route: string[]; prevNode: string | null }
    export interface CourierInfo { position: Vec3; carrying: number; inPlaza: boolean }
    export type ThiefEvent =
      | { kind: 'chaseStarted'; thiefId: string }
      | { kind: 'chaseEnded'; thiefId: string; reason: 'timeout' | 'distance' | 'above' | 'plaza' }
      | { kind: 'caught'; thiefId: string };
    export class ThiefSystem {
      constructor(city: CityMap, cfg: ThievesConfig, rng: Rng);
      readonly thieves: ThiefState[];
      /** Sim time until which the courier is ignored (robbed cooldown). */
      ignoreUntil: number;
      step(dt: number, now: number, courier: CourierInfo, lineOfSight: (from: Vec3, to: Vec3) => boolean): ThiefEvent[];
    }
    ```
- Rules in `step()`:
  - **Trigger:** a patrol thief starts a chase when the courier carries ≥ 1, is not in the plaza, `now ≥ ignoreUntil`, is within `triggerRadius` (3D), and `lineOfSight(thiefEye, courierChest)` holds. At most one thief chases at a time.
  - **Chase:** the thief moves toward the courier at `chaseSpeed`, projected onto the streets. It ends on timeout (`maxChaseSeconds`), on distance (> `loseDistance`), on `above` (the courier is more than `catchHeight` above the thief for `aboveGiveUpSeconds`), or on `plaza`.
  - **Catch:** horizontal distance ≤ `catchRadius` and |dy| ≤ `catchHeight`. It emits `caught`, sets `ignoreUntil = now + robbedCooldownSeconds`, and the thief returns to its route.
  - **Return:** the thief routes back to the nearest node at `returnSpeed`, then patrols at `patrolSpeed`.

- [ ] **Step 1: Write failing tests.**
  - `streets.test.ts`:
    - `'project keeps a point inside the strip and lifts y along a ramp edge'`.
    - `'project never returns a point inside the plaza exclusion'`.
    - `'route finds the shortest node path'`.
  - `ThiefSystem.test.ts`, on a small fixture city with one long street and a plaza at one end:
    - `'no chase when the courier carries 0'`.
    - `'chase starts within 15 m with line of sight, not at 16 m, not without LOS'`.
    - `'chase speed: 7 m in 1 s (±0.1)'`.
    - `'a courier running away at 5.5 m/s is caught'`.
    - `'a courier sprinting away at 8 m/s escapes (ends with distance or timeout, never caught)'`.
    - `'gives up after 10 s'`.
    - `'a courier 3 m above the street can't be caught and the thief gives up after 1 s'`.
    - `'entering the plaza ends the chase (reason plaza)'`.
    - `'after a catch the courier is ignored for 20 s'`.
    - `'property: over 5 simulated minutes of random patrol and chases (seeded), every thief position stays on the street strips and outside the plaza'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/shared/test/thieves packages/shared/test/world/streets.test.ts` → FAIL.
- [ ] **Step 3: Implement** them. Generate the spawns, then `pnpm map:build`.
- [ ] **Step 4: Run** `pnpm test && pnpm map:check` → PASS.
- [ ] **Step 5: Commit** `feat(thieves): street-graph thief sim — trigger, chase, escape, catch, cooldown (§7.3)` and push.

### Task 17: Robbery, local epoch points and HUD

**Files:**
- Create: `packages/shared/src/orders/epoch.ts`; export it
- Modify:
  - `config/orders.json`: `"epoch": { "seconds": 600 }`
  - `orders/OrderSystem.ts`: `rob()` and the `robbed` event
  - `packages/client/src/game/progress.ts`: v2 key `dm.progress.v2` with `{ totals, epoch: { id, points } }`, migrating from v1
  - `game/delivery.ts`: owns the `ThiefSystem` (city map only; the greybox has no streets), steps it after `sim.step`, applies `caught`, and adds epoch points on `completed`
  - `game/Game.ts`: LOS via a Rapier `castRay` that excludes the player collider
  - `ui/hudModel.ts`, `ui/hud.ts`: epoch points stat, chase banner
  - `ui/popups.ts`: the robbed popup
- Test: `packages/shared/test/orders/epoch.test.ts`, `OrderSystem.test.ts`, `packages/client/test/progress.test.ts`, `hudModel.test.ts`; e2e

**Interfaces:**
- Produces:
  - `epochIdAt(utcMs: number, seconds: number): number` (`floor(utcMs / 1000 / seconds)`).
  - `interface EpochPoints { id: number; points: number }`.
  - `addEpochPoints(e: EpochPoints, utcMs, seconds, n): EpochPoints`: rolls over to `{ id: new, points: 0 }` first when the epoch changed.
  - `penalizeEpoch(e, utcMs, seconds, n): EpochPoints`: floored at 0.
- Produces: `OrderSystem.rob(): OrderEvent`, which returns `{ kind: 'robbed'; lostOrderIds: string[] }`.
  - It removes every active order with `isCarried(a)` (no points or coins).
  - It keeps Pick-up and Chain orders not yet collected (`stepIndex 0`).
  - `statModifiers()` then reflects the remaining load.
- HUD:
  - `HudModel.epochPoints: number`.
  - `HudModel.chase: { secondsLeft: number } | null`, shown as the banner `Thief! Sprint, climb or reach the HUB · 7s`.
  - Robbed popup: `Robbed! N package(s) stolen · −1 epoch point`. When the epoch points were already 0, the second part reads `· epoch points already 0`.

- [ ] **Step 1: Write failing tests.**
  - `epoch.test.ts`:
    - `'600 s windows: 599.999 s and 600 s are different epochs'`.
    - `'adding across a boundary resets to n'`.
    - `'penalize never goes below 0'`.
  - `OrderSystem.test.ts`, Review Focus 4, with active orders: a Heavy drop-off, a collected Chain at step 1, an uncollected Pick-up:
    - `'rob() removes the Heavy drop-off and the Chain, keeps the Pick-up'`.
    - `'statModifiers returns NO_MODS after the Heavy one is stolen'`.
    - `'totals are unchanged by rob()'`.
  - `progress.test.ts`:
    - `'v1 data migrates to v2 with epoch {id: current, points: 0}'`.
    - `'a stored epoch from an earlier window loads as 0 points'`.
  - `hudModel.test.ts`: `'chase banner text shows whole seconds left'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/shared/test/orders packages/client/test` → FAIL.
- [ ] **Step 3: Implement** them. Wire `DeliveryLoop`:
  - Each tick, step the thieves with `CourierInfo { position, carrying: carriedCount(), inPlaza: zones.inPlaza }`.
  - On `caught`: call `rob()`, apply `penalizeEpoch` (`penaltyPoints`), save progress, show the popup, and remove the stolen orders' waypoints.
  - Add debug hooks `thieves(): ThiefState[]` and `placeThief(id, p)` for tests.
- [ ] **Step 4: Run the e2e tests:**
  - `'a thief catches a carrying courier: popup, order gone, epoch points down by 1 (not below 0)'`.
  - `'a courier with no package is never chased'`.
  - `pnpm test && pnpm --filter @dm/client e2e` → PASS.
- [ ] **Step 5: Commit** `feat(thieves): robbery fails carried orders, −1 local epoch point, HUD chase banner` and push.

### Task 18: Thief rendering

**Files:**
- Create: `packages/client/src/render/thieves/ThiefView.ts`, `packages/client/test/thiefAnim.test.ts`
- Modify: `config/client.json` (`thieves: { renderRadius: 150, crossFade: 0.15, runSpeedForFullRun: 7 }`), `game/Game.ts` (draws thieves each frame, interpolating between ticks as the courier does)

**Interfaces:**
- Consumes: `ThiefState` (Task 16); the `c-thief-*` pieces (Task 3).
- Produces: `thiefClip(mode: ThiefMode, speed: number, catching: boolean): { clip: 'Man_Idle' | 'Man_Walk' | 'Man_Run' | 'Man_Punch'; timeScale: number }`. It is pure:
  - `Man_Punch` for 0.5 s after a catch;
  - `Man_Run` when chasing;
  - `Man_Walk` on patrol or return at speed > 0.3;
  - `Man_Idle` otherwise.
- Produces: `class ThiefView { static load(pieces): Promise<ThiefView>; update(dt, thieves: ThiefState[], center: Vec3): void }`.
  - It clones one skinned model per thief with `SkeletonUtils.clone`, alternating the two variants.
  - Only thieves within `renderRadius` are visible and have their mixer updated.
  - If loading fails, it falls back to a dark capsule, with one warning (as with the SP1 courier).

- [ ] **Step 1: Write the failing test.** `thiefAnim.test.ts` covers each branch of `thiefClip`, including the timeScale ratio for running.
- [ ] **Step 2: Run it** → FAIL. **Step 3: Implement** it.
- [ ] **Step 4: Run the e2e tests:**
  - `'thieves near the plaza edge are visible and animate (mixer time advances)'`.
  - Screenshot `sp2-thief-chase.png`: place a thief 6 m behind a carrying courier on a street, then step 1 s.
  - Check the screenshot: the thief is on the street, faces the courier and plays the run clip.
  - Run → PASS.
- [ ] **Step 5: Commit** `feat(client): animated thieves with render radius` and push.

### Task 19: Map debug view (F4)

**Files:**
- Create: `packages/client/src/ui/mapDebug.ts`, `packages/client/test/mapDebug.test.ts`
- Modify: `config/client.json` (`input.bindings.mapDebug: ["F4"]`), `clientConfig.ts` (`BindingName` adds `'mapDebug'`), `input/actionState.ts` (`UiKey` adds `'mapDebug'`), `ui/devPanel.ts` (a "Map debug" checkbox), `game/Game.ts`

**Interfaces:**
- Consumes: `PoiTableFile`, `CityMap`, `PagedPhysicsWorld.loadedChunks()`, `ThiefSystem.thieves`.
- Produces: `poiMarkerStyle(row: PoiRow, bands): { color: number; label: string }`. It is pure:
  - Colours: Short teal, Medium amber, Long violet, unreachable red.
  - Label: `poi-downtown-07 · 640 m · elevated`.
- Produces: `class MapDebugView { constructor(scene, city, table, bands); setVisible(v: boolean): void; update(center: Vec3, loaded: ReadonlySet<ChunkKey>, thieves: readonly ThiefState[]): void }`.
  - Each POI gets a vertical beam and a canvas-sprite label, shown only within 500 m.
  - The overlay shows the chunk grid lines and tints the physics-loaded chunks.
  - Each thief gets a label with its mode and chase time.
  - With `map:build --allow-unreachable`, unreachable rows show in red. With a normal build there are none.

- [ ] **Step 1: Write failing tests.**
  - `mapDebug.test.ts`:
    - `'band colours by fromHub with city bands (499 → short, 500 → medium, 1201 → long)'`.
    - `'an unreachable row is red and labelled unreachable'`.
  - `actionState.test.ts`: `'F4 fires onUiKey("mapDebug")'`.
- [ ] **Step 2: Run them** → FAIL. **Step 3: Implement** them.
- [ ] **Step 4: Run the e2e test** `'F4 toggles the map debug view'` and add the screenshot `sp2-map-debug.png` from above the plaza, showing banded POI labels and loaded chunks → PASS.
- [ ] **Step 5: Commit** `feat(client): F4 map debug view — POIs, distances, bands, loaded chunks, thief states` and push.

### Task 20: Spec record, docs and final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-delivery-maxing-design.md`. Record the assumptions the user confirmed (elevated definition, link kinds, route distance directions, POI rule definitions, thief escape details, local epoch points, streaming values) in §5.2, §5.3, §7.3 and §12 (`packages/tools`), and in the decisions log.
- Modify: `README.md` (`assets:build`, `map:build`, `map:check`, `?map=greybox`, `?perf=1`, F4), `assets/CREDITS.md` (final check: every file under `assets/city/` is listed)
- Create: `docs/playtest/sp2/*.png` (the screenshots from the e2e runs)

- [ ] **Step 1: Write the spec text** described above, and check §15 row 2 item by item against the delivered work in the PR description.
- [ ] **Step 2: Verify.** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm map:check && pnpm e2e`. Every command must exit 0. Paste the summary lines (test counts, e2e counts, `map:check` OK) into the PR.
- [ ] **Step 3: Sizes and budgets.** Record in the PR:
  - `assets/city` MB, `city.json` and `city.poi.json` KB, navmesh MB;
  - client bundle size (`vite build` output);
  - max draw calls and triangles on the perf route;
  - the user's `?perf=1` numbers from Task 8 and any re-run.
- [ ] **Step 4: Push.** Confirm the Pages deploy of `sp2/city-map-poi` succeeded and the site loads the city. Update the PR description with screenshots, the checklist against §15, and how to playtest: the link, F4, `?perf=1`, `?map=greybox`.
- [ ] **Step 5: Commit** `docs: SP2 spec record, README, credits` and push. SP2 is then ready for the user's playtest.
