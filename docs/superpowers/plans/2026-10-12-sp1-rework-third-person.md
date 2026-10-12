# SP1 Rework — Third-Person Courier, Two-Way Zip Lines, Par Times — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the SP1 playtest decisions to the existing SP1 build. That means a third-person chase camera behind an animated courier, zip lines rideable both ways, and a par time on every order. Then redeploy for a second playtest.

**Architecture:**
- The shared sim gains a courier `heading`, the way the courier faces. It is decoupled from the camera yaw, and mantle, wall-run, zip and board read it.
- The client swaps the first-person camera for a chase camera. The camera is pure pose math plus a physics ray for collision.
- The client adds a skinned courier driven by a pure animation state function.
- Par times are one more order rule in `orders/rules.ts`. They flow through `OrderSystem` to the UI.

**Tech Stack:** the SP1 stack, unchanged. three.js 0.186 adds `GLTFLoader` and `AnimationMixer` from `three/addons`. Vite asset URLs are used for the model.

**Spec:** `docs/superpowers/specs/2026-10-12-delivery-maxing-design.md`, revised in 5e45d23. Read the decisions log (Camera, Par times), §3.2 Par time, §3.4, the §4 Camera paragraph and the Zip line row, and the §15 SP1 row. The original SP1 plan, `docs/superpowers/plans/2026-10-12-sp1-movement-delivery-loop.md`, describes the existing code.

## Global Constraints

- Branch `sp1/movement-delivery-loop`, PR #2. Plain `git push` only, after every task.
- All SP1 global constraints still hold:
  - tuning lives in `config/*.json`;
  - `packages/shared` never imports three, the DOM or `window`;
  - draw calls stay under `graphics.drawCallBudget` (150);
  - no Amazon names or trade dress;
  - no secrets.
- Camera (§4): chase camera about **4.5 m behind** and **1.6 m above** the courier, orbited with the mouse. It lags slightly, widens its FOV with speed, tilts during wall-runs, and pulls in when geometry blocks the view. Movement is camera-relative, and the courier faces its direction of travel. All values live in `config/client.json`.
- Zip line (§4):
  - You ride in the direction you face when you attach, uphill or downhill.
  - Speed is at least **10 m/s** both ways (`zipLine.baseSpeed`). Downhill accelerates up to **16 m/s** (`zipLine.maxSpeed`, capped by `speedCap`).
  - Momentum carries over on jump-off.
- Par time (§3.2): `route distance ÷ base sprint speed × 1.3 + 10 s`. It starts at accept. Within par pays **+1 point / +10 coins**. Express keeps its own timer, and both bonuses can be earned.
- Fragile intact pays **+2 / +20** (§3.4).
- The SP1 greybox keeps its bands, 150 m and 350 m. The 2 km bands are SP2.
- Courier model: Quaternius "Robot Expressive" (CC0 1.0; by Tomás Laulhé, modified by Don McCurdy), taken from the three.js repository. Commit it under `assets/models/` and list it in `assets/CREDITS.md`.

## Review Focus

1. **Camera inside geometry.** When the courier backs against a wall, stands in the 1.4 m crouch tunnel or rides a zip line next to a building, the camera must not clip into geometry or show the inside of a solid. It pulls in instead. Pinned in Task 4.
2. **Strafing into a ledge or wall.** Holding only D (or A) runs the courier sideways relative to the camera. It must still mantle the ledge it runs into, and still wall-run along a wall it runs beside. Pinned in Task 1.
3. **Uphill zip end.** Riding to the high end of a zip line must leave the courier standing safely on the start platform, never inside it. Pinned in Task 2.
4. **Model fails to load.** If the GLB 404s or fails to parse, for example because of a wrong Pages base path, the game must keep running with a simple fallback capsule and log one warning. Pinned in Task 5.
5. **Par on a reloaded or very long order.** Par is measured in sim time like Express, so a hidden tab (sim paused) never costs the bonus. Pinned in Task 3.

---

### Task 1: Courier heading drives mantle, wall-run and board

**Files:**
- Modify: `packages/shared/src/movement/types.ts` (add `heading: number` to PlayerState, a yaw in the `facing()` convention), `PlayerSim.ts`, `ground.ts`, `mantle.ts`, `wallRun.ts`, `board.ts`
- Test: `packages/shared/test/movement/heading.test.ts`; update `board.test.ts` where R18 (board steers toward the look yaw) changes

**Interfaces:**
- Produces:
  - `state.heading`. While there is movement input, it is set each tick to the yaw of `wishDirection(input)`; otherwise it is unchanged. On the board it equals `boardHeading`.
  - `yawOf(v: Vec3): number`, exported from `ground.ts` and moved there from `board.ts`.
- Mantle detection casts along `facing(state.heading)`. The forward-input gate becomes `dot(wish, facing(heading)) > 0.5`.
- `findWall` casts left and right of `heading`. The "forward input > 0" start condition becomes "has movement input".
- Board: the heading turns toward the **wish direction** at most `turnRate·dt` (this replaces R18). Input whose dot with the heading is below −0.5 brakes at `brakeDecel` and does not turn.
- `state.yaw` remains the camera yaw and is used only by `wishDirection`.

- [ ] **Step 1: Write the failing tests** (`heading.test.ts`)

```ts
it('heading follows the camera-relative wish direction and holds when input stops', ...); // yaw 0, hold D → heading = −π/2 (facing +X); release → unchanged
it('strafing right into a 1.5 m ledge mantles it (Review Focus 2)', ...);                  // camera yaw 0, ledge to +X, hold D+Shift → feet y = 1.5 ± 0.05
it('strafing alongside a wall starts a wall-run', ...);                                    // camera yaw 0, run along +X with D held, jump → mode 'wallrun' within 10 ticks
it('board steers toward the wish direction; S brakes without turning', ...);
```

- [ ] **Step 2:** Run `pnpm vitest run packages/shared/test/movement/heading.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as described in the Interfaces block. Existing movement tests that hold W with a yaw must keep passing unchanged, because W makes heading equal yaw. Update only the board tests that encode R18.
- [ ] **Step 4:** Run `pnpm vitest run packages/shared`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): courier heading drives mantle, wall-run and board`, then push.

---

### Task 2: Two-way zip lines with a safe end-of-line dismount

**Files:**
- Modify: `packages/shared/src/movement/zipLine.ts`, `PlayerSim.ts` (pass the body to `updateZip` for the dismount), `config/movement.json` and `config/types.ts` (remove `zipLine.levelThreshold`; add `zipLine.dismountReach: 3.0`), and `map/greybox.json` only if a line's end fails the new content test
- Test: `packages/shared/test/movement/zipLine.test.ts` (update and extend), `packages/shared/test/world/greyboxContent.test.ts` (extend)

**Interfaces:**
- `tryAttachZip(state, input, lines, cfg)` keeps its signature. Direction is `dir = sign(dot(facing(state.heading), b − a) horizontally)`. A tie (`|dot| < 0.1`) falls back to the sign of the horizontal velocity along the line, then to the downhill end.
- `updateZip(state, line, input, cfg, mods, dt, body: PlayerBody): 'riding' | 'detached'`. The speed rule is unchanged: `+ g·sinθ·dt` along the ride, clamped to `[baseSpeed, min(maxSpeed × speedMul, speedCap)]`. Uphill therefore holds at 10 m/s.
- End-of-line dismount:
  - On reaching an end, cast down from the cable end point over `zipLine.dismountReach`.
  - If a surface is hit and `body.fitsAt(top, false)`, place the feet on it with the ride's horizontal velocity, mode `ground`, and no `landed` fall.
  - Otherwise detach in the air at the hang point, as today.

- [ ] **Step 1: Write the failing tests**

```ts
it('facing uphill at the low end and pressing E rides uphill at ≥ baseSpeed (10)', ...);
it('facing downhill rides downhill and accelerates toward maxSpeed (16)', ...);
it('riding uphill to the end stands the courier on the start platform, not inside it (Review Focus 3)', ...); // feet y = platform top ± 0.05, fitsAt true, no landed fall > 0.1
it('riding off an end with nothing below detaches in the air with the ride velocity', ...);
// greyboxContent.test.ts
it('every zip line can be ridden both ways from its ends and both ends exit safely', ...); // grab at each end facing along the line; ride to the other end; no respawn, no fall > fragile.maxFallMeters, feet never inside a solid
```

- [ ] **Step 2:** Run `pnpm vitest run packages/shared/test/movement/zipLine.test.ts packages/shared/test/world/greyboxContent.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as described in the Interfaces block. Adjust zip-line ends in `map/greybox.json` only where the new content test fails. Keep the R7 ids.
- [ ] **Step 4:** Run `pnpm check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): two-way zip lines with platform dismount`, then push.

---

### Task 3: Par times and the Fragile bonus

**Files:**
- Modify: `config/orders.json` and `config/types.ts`:
  - add `"par": { "distanceFactor": 1.3, "extraSeconds": 10 }`
  - add `points.withinPar: 1` and `coins.withinPar: 10`
  - set `points.fragileIntact: 2` and `coins.fragileIntact: 20`
- Modify: `packages/shared/src/orders/types.ts`, `rules.ts`, `board.ts`, `OrderSystem.ts`
- Test: `packages/shared/test/orders/rules.test.ts`, `board.test.ts`, `OrderSystem.test.ts`, `test/config/config.test.ts`

**Interfaces:**
- `Bonus` gains `'par'`. `Order` gains `parLimit: number` (seconds, every order).
- `parLimit(routeDistance: number, baseSprintSpeed: number, cfg: OrdersConfig): number`.
- `scoreOrder(order, outcome: { onTime: boolean; intact: boolean; withinPar: boolean }, cfg)`. The par bonus applies to every type, Chain included, and stacks with the modifier bonus.
- The `completed` OrderEvent gains `withinPar: boolean`. `withinPar = now − acceptedAt ≤ parLimit`, using sim time as Express does.

- [ ] **Step 1: Write the failing tests**

```ts
expect(parLimit(160, 8, ordersConfig)).toBe(36);        // 160 / 8 × 1.3 + 10
expect(parLimit(320, 8, ordersConfig)).toBe(62);
it('within par adds +1/+10 on every type incl. chain; late adds nothing', ...);
it('express on time and within par earns both bonuses', ...);
it('fragile intact now adds +2/+20', ...);
it('OrderSystem completed event reports withinPar from sim time since accept', ...);
it('config pins par {1.3, 10}, withinPar 1/10, fragileIntact 2/20', ...);
```

- [ ] **Step 2:** Run `pnpm vitest run packages/shared/test/orders packages/shared/test/config`. Expected: FAIL.
- [ ] **Step 3:** Implement as described in the Interfaces block. `generateBoard` sets `parLimit` from the order's `routeDistance`.
- [ ] **Step 4:** Run `pnpm check`. Expected: PASS. Client type errors from the new fields are fixed in Task 6. If the client fails typecheck now, add the minimum (pass `withinPar` through) so `pnpm check` is green.
- [ ] **Step 5:** Commit `feat(shared): par times on every order; fragile +2`, then push.

---

### Task 4: Third-person chase camera

**Files:**
- Modify: `config/client.json` and `clientConfig.ts`. Add `camera.chase`:
  ```json
  { "distance": 4.5, "height": 1.6, "pivotHeight": 1.3, "crouchPivotHeight": 0.8,
    "pitchMinDeg": -55, "pitchMaxDeg": 35, "followEaseRate": 14, "collisionRadius": 0.25,
    "minDistance": 0.8, "pullInEaseRate": 30, "pushOutEaseRate": 6 }
  ```
  Remove the first-person-only `eyeHeight`, `crouchEyeHeight` and `pitchLimitDeg`. Keep the FOV, roll and crouch ease keys.
- Create: `packages/client/src/render/chaseCamera.ts`
- Modify: `render/cameraRig.ts` (drop `eyeHeight`/`easeEyeHeight`), `game/Game.ts`, `input/actionState.ts` (pitch clamped to `[pitchMinDeg, pitchMaxDeg]`)
- Test: `packages/client/test/chaseCamera.test.ts`, `cameraRig.test.ts` (update), `actionState.test.ts` (update), `e2e/smoke.spec.ts` (update screenshots)

**Interfaces:**
- `type RayCast = (from: Vec3, dir: Vec3, maxDist: number) => number | null` returns the distance to the first solid, or null.
- `chaseCameraPose(target: Vec3, yaw: number, pitch: number, cam: ChaseConfig, cast: RayCast): { position: Vec3; lookAt: Vec3; distance: number }`.
  - `target` is the interpolated feet position plus the pivot height.
  - The desired camera point is `target − forward(yaw, pitch) × distance + (0, height − pivotHeight, 0)`.
  - If `cast` from the target toward that point hits at `d`, the distance becomes `max(minDistance, d − collisionRadius)`.
- `class ChaseCamera { update(frameDt, target, yaw, pitch, speed, state): void; readonly camera: THREE.PerspectiveCamera }` eases position (`followEaseRate`) and distance. The distance pulls in fast (`pullInEaseRate`) and pushes out slowly (`pushOutEaseRate`). It also applies the existing `fovForSpeed`/`rollForWallRun` easing.
- `Game` builds `cast` from the PhysicsWorld (`world.castRay` excluding the player collider) and stops rendering the first-person view.

- [ ] **Step 1: Write the failing tests**

```ts
it('open ground: camera sits 4.5 m behind and 1.6 m above the courier', ...);       // yaw 0, pitch 0 → position ≈ (x, y+1.6, z+4.5)
it('a wall 2 m behind pulls the camera in to 2 − collisionRadius (Review Focus 1)', ...);
it('never closer than minDistance', ...);
it('pitch clamps to [−55°, 35°]', ...);                                               // actionState
// e2e
test('third-person view shows the courier', ...);  // screenshot sp1-third-person.png; courier visible in frame centre-bottom
test('camera stays outside geometry in the crouch tunnel and against a wall', ...);   // teleport into the tunnel / back to a wall; __dm.cameraInsideSolid() === false
```

  Add `__dm.cameraInsideSolid(): boolean` (a point-in-collider test of the camera position) to `debugHooks.ts`.

- [ ] **Step 2:** Run `pnpm vitest run packages/client`. Expected: FAIL.
- [ ] **Step 3:** Implement as described in the Interfaces block and wire it into `Game`.
- [ ] **Step 4:** Run `pnpm check && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`. Expected: PASS. Look at `sp1-third-person.png`.
- [ ] **Step 5:** Commit `feat(client): third-person chase camera`, then push.

---

### Task 5: Animated courier

**Files:**
- Create: `assets/models/RobotExpressive.glb`, downloaded from `https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/models/gltf/RobotExpressive/RobotExpressive.glb`. Stop and report if it can't be downloaded.
- Modify: `assets/CREDITS.md` (title, author, CC0 1.0, source URL)
- Create: `packages/client/src/render/courier/animState.ts` (pure), `courier/CourierModel.ts`
- Modify: `config/client.json` (add `courier`: `{ "height": 1.8, "turnEaseRate": 14, "crossFade": 0.15, "runSpeedForFullRun": 8 }`), `game/Game.ts`, `debugHooks.ts`
- Test: `packages/client/test/animState.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- `type CourierAnim = { clip: 'Idle' | 'Walking' | 'Running' | 'Jump'; timeScale: number; pose: 'none' | 'slide' | 'wallrunL' | 'wallrunR' | 'zip' | 'grind' | 'mantle' | 'board' | 'fall' }`
- `animFor(state: PlayerState, speed: number, cfg: ClientConfig['courier']): CourierAnim`
  - `pose` adds a procedural bone or root offset over the clip:
    - slide: crouch and lean back;
    - wall-run: lean away from the wall;
    - zip: arms up;
    - board: wide stance.
  - The `Running` timeScale scales with speed.
- `class CourierModel { static load(url: string): Promise<CourierModel | null>; readonly root: THREE.Object3D; update(dt, state, interpPos, speed): void; setPackages(n: number): void }`
  - Scale the model to `courier.height`.
  - Ease the root yaw toward `state.heading` (`turnEaseRate`).
  - `setPackages` shows one small box per carried package on the courier's back.
- A failed load (Review Focus 4) returns `null`, and `Game` shows a simple capsule mesh instead. Log one `console.warn`.
- Import the GLB with Vite's `?url`, so the Pages base path resolves.

- [ ] **Step 1: Write the failing tests**

```ts
it('idle when still, Walking below 4 m/s, Running above, timeScale grows with speed', ...);
it('poses: slide, wallrunL/R from wall side, zip, grind, mantle, board, fall (air & vy < −2)', ...);
// e2e
test('courier model loads and animates (mixer time advances)', ...); // __dm.courier(): { loaded: true, clip }
test('a missing model falls back to the capsule without console errors (Review Focus 4)', ...); // route the .glb to 404 → __dm.courier().loaded === false, game ready, only a warning
```

- [ ] **Step 2:** Run `pnpm vitest run packages/client/test/animState.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as described in the Interfaces block. Draw calls must stay under 150; the e2e budget test covers this.
- [ ] **Step 4:** Run `pnpm check && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`. Expected: PASS. Look at screenshots of run, slide, wall-run, zip and board poses, saved as `sp1-courier-*.png`.
- [ ] **Step 5:** Commit `feat(client): animated courier (Robot Expressive, CC0)`, then push.

---

### Task 6: Par time in the UI

**Files:**
- Modify: `packages/client/src/ui/hudModel.ts`, `hud.ts`, `orderBoard.ts`, `popups.ts`, `game/delivery.ts`
- Test: `packages/client/test/hudModel.test.ts`, `orderBoard.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- HudModel orders gain `par: { secondsLeft: number; late: boolean }`, present for every order.
- The HUD shows a par countdown on every active order and dims it once late. Express keeps its own timer line.
- Board cards show `Par m:ss` and the `+1 pt · +10 coins within par` line.
- The completion popup lists a `Within par` bonus line.

- [ ] **Step 1: Write the failing tests**

```ts
it('par secondsLeft counts down from parLimit and late flips after it', ...);
it('board card shows the par time and its bonus', ...);
// e2e: the delivered popup lists "Within par"
```

- [ ] **Step 2:** Run `pnpm vitest run packages/client`. Expected: FAIL.
- [ ] **Step 3:** Implement as described in the Interfaces block.
- [ ] **Step 4:** Run `pnpm check && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`. Expected: PASS. Look at `sp1-order-board.png`, `sp1-hud.png` and `sp1-delivered.png`.
- [ ] **Step 5:** Commit `feat(client): par times on HUD, board and popups`, then push.

---

### Task 7: Verification and second-playtest handoff

- [ ] **Step 1:** Run `pnpm lint && pnpm typecheck && pnpm test && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`, and the same e2e with `PAGES_BASE=/delivery-maxing/`. Expected: all pass. Keep the summary lines.
- [ ] **Step 2:** Copy the refreshed screenshots into `docs/playtest/sp1/`, replacing the first-person ones, and add the `sp1-third-person` and `sp1-courier-*` shots. Commit `docs: SP1 rework playtest screenshots`, then push.
- [ ] **Step 3:** Confirm the Pages run for the last commit deployed.
- [ ] **Step 4:** Update the PR description:
  - controls (mouse orbits the camera; W/A/S/D are camera-relative);
  - test summary lines;
  - screenshots;
  - a second-playtest checklist:
    - camera feel and collision;
    - courier animations;
    - zip uphill and downhill;
    - par bonus on each order type;
    - Fragile +2.
