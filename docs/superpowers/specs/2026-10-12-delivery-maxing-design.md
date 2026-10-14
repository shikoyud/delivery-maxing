# Delivery Maxing — Game Design Spec

- **Date:** 2026-10-12
- **Status:** Approved v1 (2026-10-12, revised after the SP1 playtests and SP2). **Revision 2 (2026-10-14, the redesign) approved by the owner on 2026-10-14:** no HUB, point-to-point food and package orders, vehicles and fuel, an in-game phone, hospitals as spawn points and safe zones, no parkour, no ranks, a SOL-paired token, rewards paid in GAME per order, and a new 1.2 km terraced city (`2026-10-14-city-map-design.md`). Sections marked **Pending** need the owner's input before they are built.
- **Game name:** Delivery Maxing

## 1. Summary

Delivery Maxing is a third-person, low-poly, multiplayer courier game that runs in the browser. Players take food and package orders on their **phone** and deliver them from one place in the city to another: from a bakery to an apartment, from a factory to a construction site. They get around on foot or on a vehicle they own: **skateboard, bicycle, motorbike or car**. Better vehicles carry more and heavier orders and earn more. Players can shove each other, vehicles knock people over, and street thieves chase couriers on foot. There are no health points.

Every completed order adds **GAME** to the player's **Wallet** app on the phone; the player claims it on-chain whenever they like and pays the transaction fee. The reward pool is funded by the Pump.fun creator fees of the game's own token **GAME** (paired with SOL) and by part of every vehicle purchase, and pays out in GAME bought back from the market. How much each order pays is **Pending** (§9).

Vehicles and token upgrades are bought by burning GAME at fixed USD prices. Fuel and cosmetics are bought with **Coins**, an off-chain currency earned by playing.

### Design goals

1. **Getting around the city is the fun.** Moving through a dense, hilly city on foot and on wheels must feel good on its own.
2. **Spending buys a stronger courier.** Each vehicle tier carries more and earns more than the one below it. Skill (routes, shortcuts, order choice) decides the rest.
3. **Rewards are honest and verifiable.** The pool, payouts and claims live on-chain. Delivery validation is server-authoritative.
4. **Token demand comes from use.** GAME is burned on vehicles and upgrades and paid out for work.

## 2. Decisions log

| Topic | Decision |
|---|---|
| Platform | Web game. Desktop (keyboard + mouse) first. Touch controls later, through an input abstraction layer. |
| Engine | Three.js + Vite, TypeScript |
| Physics | Rapier (`@dimforge/rapier3d-compat`), shared by client and server |
| Multiplayer | Node.js + Colyseus, server-authoritative, TypeScript |
| Database | PostgreSQL |
| Chain | Solana. Reward program written in Rust with Anchor. |
| Account | Wallet required from the start (Phantom, Solflare, OKX Wallet, plus any Wallet Standard wallet) |
| Camera | Third-person chase camera behind a visible courier (changed from first-person after the SP1 playtest). |
| Sprint and slide | Shift toggles sprint; starting a slide gives a speed burst with a cooldown; crouch is C only (SP1 playtest 2). |
| **Core loop (rev. 2)** | No HUB. Orders go pickup → dropoff between buildings, food or package, offered on the phone anywhere in the city (§3). |
| **Vehicles (rev. 2)** | Walk, skateboard, bicycle, motorbike, car. Slots 1/1/2/3/5; packages only on motorbike (≤ 50 kg) and car (≤ 150 kg); top speeds 8/12/16/22/28 m/s. No truck. Each tier is strictly better than the one below (§4). |
| **Fuel (rev. 2)** | Motorbike and car use fuel, refilled at gas stations with Coins (§4.4). |
| **Parkour (rev. 2)** | Removed: wall-runs, wall-jumps, zip lines, jump pads, grind rails, map slide chutes, boost orbs. Kept: sprint, jump, crouch-slide, low mantle (≤ 1.2 m). |
| **Phone (rev. 2)** | The main UI: orders, map, garage, shop, wallet, wardrobe, leaderboard, settings (§8). |
| **Spawning and safe zones (rev. 2)** | Four hospitals are the only spawn points and the only safe zones. |
| **Cancelling (rev. 2)** | Cancel any order from the phone, anywhere. No cooldown, but the server stops sending you offers for a while; burning GAME skips the wait (§3.5). |
| **Ranks (rev. 2)** | Removed. |
| **City (rev. 2)** | 1.2 × 1.2 km terraced Western bay city built from the owner's Megatropolis and Tropical City packs; dense wall-to-wall blocks, four levels (§5, `2026-10-14-city-map-design.md`). Replaces the SP2 2 × 2 km city. |
| **Token (rev. 2)** | GAME launches on Pump.fun paired with SOL (no AMZNx). Creator fees accrue in SOL. |
| **Rewards (rev. 2)** | Paid in GAME (bought back with pool SOL), accrued per completed order into the Wallet app, claimed by the player who pays the fees. Payout math **Pending** (§9). |
| **Vehicle purchases (rev. 2)** | Paid in GAME at fixed USD prices: 80% burned, 20% sent to the reward pool. |
| **Spender advantage (rev. 2)** | Intentional: better vehicles earn more. The legal risk this adds is in §16. |
| Thieves | Street NPCs chase couriers on foot carrying orders; a catch fails the carried orders. Kept from SP2, adapted to vehicles (§7.3). |
| Art (rev. 2) | The owner's Megatropolis and Tropical City `.glb` packs for the city; the CC0 Quaternius courier; code-built placeholders for anything missing. Licensed Unity Asset Store packs, kept out of git (§16, `assets/CREDITS.md`). |
| Map build | A seeded generator writes the committed layout and generated files; `pnpm map:check` regenerates and byte-compares them in CI (kept from SP2). |

## 3. Core loop

1. The player spawns at a hospital, on foot or next to their parked vehicle.
2. **Offers** arrive on the phone. The player accepts the ones that fit their free slots and their vehicle's weight limit.
3. They ride or walk to each **pickup**, collect the order at the door, then take it to the **dropoff** door.
4. Each completed order earns **Delivery Points** (score and reward weight), **Coins**, and a **GAME** reward credited to the Wallet app (amount **Pending**, §9).
5. Coins buy fuel and cosmetics; GAME buys vehicles and token upgrades.

### 3.1 Order kinds

| Kind | From → to | Rules |
|---|---|---|
| **Food** | Restaurant, café, kiosk or beach bar → home, office, hotel, hospital… | Always timed: delivering within the hot time earns the hot bonus. Weightless; takes one slot. Dropoff is 150–800 m from the pickup. |
| **Package** | Supermarket, auto service, factory, rail station, post office or warehouse → any dropoff that accepts packages | Has a weight (§3.3). Has a par time; Express and Fragile modifiers can apply. |

Which buildings send or receive what is defined per catalog model (city map design §6). The order text names the item and the building, e.g. "Pick up 2 baguettes and a sourdough from Crumb & Co. Bakery, 14 Market St."

### 3.2 Timers and modifiers

All times use the **path distance from pickup to dropoff** and a reference speed of 8 m/s (on-foot sprint). Values are in config.

| Rule | Value |
|---|---|
| Hot time (food) | `distance ÷ 8 m/s × 1.3 + 20 s`, counted from pickup |
| Par time (package) | `distance ÷ 8 m/s × 1.3 + 10 s`, counted from pickup |
| Express (package modifier) | `distance ÷ 8 m/s × 1.1 + 10 s`; a bonus if delivered in time |
| Fragile (package modifier) | A bonus if delivered intact. A fall of more than 7 m, being hit or knocked over, crashing a vehicle above 10 m/s into a wall, or an out-of-bounds respawn cancels the bonus. The order is never lost. |
| Late delivery | Still completes the order, without the time bonus |

Faster vehicles beat the timers more easily; that is intended (design goal 2).

### 3.3 Slots and weight

| | Walk | Skateboard | Bicycle | Motorbike | Car |
|---|---|---|---|---|---|
| Slots (food and packages share them) | 1 | 1 | 2 | 3 | 5 |
| Max total package weight | — | — | — | 50 kg | 150 kg |

- Food uses a slot and has no weight. A package uses a slot and its weight counts against the vehicle's limit.
- Package weight classes: Small 1–10 kg, Medium 10–25 kg, Large 25–50 kg, Bulky 50–150 kg (car only).
- Offers are filtered by the vehicle the player is using (or last parked): package offers only appear on a motorbike or car, and only if the weight fits.
- **Every delivery ends on foot.** The player gets off, carries the order to the door, and walks back. Carrying a Bulky package by hand disables sprint and slide.
- Switching to a smaller vehicle while carrying orders it can't hold is blocked.

### 3.4 Offers

| Rule | Value (config) |
|---|---|
| Offers shown at once | Up to 3 |
| Offer lifetime | 20 s, then it disappears |
| New offers | Every 8–15 s while the player has a free slot |
| Pickup distance | The pickup is at most 400 m (path) from the player when offered |
| Accepting | One tap on the phone, anywhere; while driving, a one-key accept on the notification |
| Selection rules | Distance bands, door spacing, reuse and reachability per city map design §6.4 |

Players never compete for the same order: each player's offers are their own.

### 3.5 Cancelling

- Any accepted order can be cancelled from the phone, anywhere, at any time. There is no cancel cooldown.
- Cancelling starts an **offer lockout**: the server sends that player no new offers for 45 s (config). Orders already accepted continue normally.
- The lockout can be skipped by burning GAME at a fixed USD price (§6.3). The price is **Pending**.
- A cancelled order that was already picked up simply disappears. No points, Coins or GAME.

### 3.6 Points and Coins per order

| Component | Delivery Points | Coins |
|---|---|---|
| Short (path < 350 m) | 1 | 10 |
| Medium (350–800 m) | 2 | 20 |
| Long (> 800 m) | 3 | 30 |
| Package weight multiplier (on the band value) | Small ×1 · Medium ×1.5 · Large ×2 · Bulky ×3 | same |
| Food within hot time | +1 | +10 |
| Package within par time | +1 | +10 |
| Express, on time | +1 | +10 |
| Fragile, intact | +2 | +20 |

Every value is a tuning value in config. Points are rounded to the nearest whole point. A thief catch (§7.3) subtracts points. How points relate to the GAME reward is **Pending** (§9).

## 4. Movement and vehicles

**Camera:** a third-person chase camera about 4.5 m behind and 1.6 m above the courier, orbited with the mouse. It lags slightly, widens its field of view with speed, and pulls in when geometry would block the view. On vehicles it sits further back and higher (config). Movement is relative to the camera.

All movement and vehicle code lives in the shared package and runs on the fixed **30 Hz** step on client and server; rendering interpolates between steps.

### 4.1 On foot

| Move | Behavior |
|---|---|
| Run / sprint | Base sprint speed 8 m/s. Shift toggles sprint on and off. Sprint switches off whenever no move key is held. No stamina. The sprint state is part of the shared sim state. |
| Jump | About 1.2 m high. Coyote time 100 ms, jump buffer 100 ms. |
| Mantle | Automatically climbs ledges up to **1.2 m** (stoops, low walls, loading docks). |
| Crouch-slide | Pressing C while sprinting on the ground starts a slide with a +4 m/s burst (never above the on-foot cap), low friction, and speed gain downhill. The burst has a 2 s cooldown from the start of the boosted slide. |
| Speed cap | 12 m/s horizontal on foot |

**Removed in revision 2:** wall-runs, wall-jumps, zip lines, jump pads, grind rails, map slide chutes, boost orbs.

**Input layer:** raw input is mapped to actions: `move`, `look`, `jump`, `crouch`, `sprint`, `interact`, `hit`, `mount`, `phone`, `accept`. Gameplay code only reads actions. Default keys: WASD move, mouse look, Space jump (on a vehicle: handbrake), C crouch, Shift sprint (toggle; on a vehicle: boost is not used), E interact (pick up, hand over, refuel), F mount/dismount, Tab phone, Y accept the top offer, left click hit. Crouch is C only, never Ctrl (Ctrl+W closes the tab).

### 4.2 Vehicles

| | Walk | Skateboard | Bicycle | Motorbike | Car |
|---|---|---|---|---|---|
| Top speed | 8 m/s | 12 m/s | 16 m/s | 22 m/s | 28 m/s |
| Slots | 1 | 1 | 2 | 3 | 5 |
| Max package weight | — | — | — | 50 kg | 150 kg |
| Fuel | — | — | — | Yes | Yes |
| Price | Free | GAME (**Pending**) | GAME (**Pending**) | GAME (**Pending**) | GAME (**Pending**) |

- **Physics:** an arcade vehicle model in the shared package (kinematic, like the character controller), not Rapier dynamic-body cars, so server authority and client prediction stay simple. Each vehicle has acceleration, braking, turn rate, grip and slope behavior in config.
- **Mount and dismount:** F next to an owned vehicle. A dismounted vehicle stays parked where it was left; other players can't use it.
- **Summon:** from the phone's Garage, an owned vehicle more than 100 m away is moved to the nearest legal road spot next to the player. Cooldown 60 s.
- **Speed caps:** each vehicle's top speed is its server-enforced cap (§10).
- **Ownership:** recorded on-chain against the wallet and permanent (§6.2). Only one vehicle of each tier is needed; a player may own several tiers and switch at any parked vehicle.
- **Models:** the skateboard, bicycle and motorbike are not in the art packs yet (placeholders until supplied); the car is chosen from the pack's cars.

### 4.3 Where each vehicle can go

| Surface | Walk | Skateboard | Bicycle | Motorbike | Car |
|---|---|---|---|---|---|
| Avenues, streets, switchback roads, Hillcrest Drive | ✓ | ✓ | ✓ | ✓ | ✓ |
| Alleys (4 m) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Steep lanes (14%) | ✓ | ✗ | ✓ | ✓ | ✗ |
| Stairs | ✓ | ✗ (carried) | ✗ | ✗ | ✗ |
| Boardwalk, pier, park paths | ✓ | ✓ | ✓ | ✗ | ✗ |

Every package door is within 30 m of a road cars can use, and at most 15% of food dropoffs are alley- or stair-only, so small vehicles get shortcuts but cars always earn more on average.

### 4.4 Fuel

| Rule | Value (config, starting values) |
|---|---|
| Tank range | Motorbike 6 km, car 5 km of driving |
| Refuel | At any of the 6 gas stations: stop at a pump and hold E. A full tank costs 40 Coins (motorbike) or 80 Coins (car); partial fills cost proportionally. |
| Empty tank | The vehicle still moves at 3 m/s so the player is never stranded |
| HUD | Fuel gauge while riding; the phone Map shows gas stations |

## 5. City and POIs

The city is defined in **`2026-10-14-city-map-design.md`**: a 1.2 × 1.2 km Western bay city that climbs north from the water in four terraces (Waterfront 2 m, Bayview 10 m, Midtown 24 m, Uptown 38 m, Hillcrest ridge 48–60 m), joined by switchback roads, steep lanes and stairs. Blocks are wall to wall (about 2,600 buildings); four hospitals and six gas stations are fixed landmarks; about 800 POI doors are placed only on buildings that would plausibly send or receive orders.

- **Building blocks:** the owner's Megatropolis and Tropical City packs, used at 1:1, listed in `map/catalog.json`. Missing types (post office, warehouse, school, courier vehicles, containers, cranes) render as placeholders until supplied.
- **Layout data:** `map/city.layout.json` (lots, roads, connectors, POI doors), generated deterministically and then editable; swapping a model never moves a lot.
- **Streaming and LOD (kept from SP2):** 100 m chunks; colliders paged around the player; render LOD rings (LOD0 near, simplified LOD1, placeholder boxes far) with radial fog; one merged mesh and one compound collider per block.
- **Navmeshes:** generated at build time per vehicle class (foot, two-wheeler, car). A path counts only if it really reaches both ends (recast reports partial paths as success). Path distance is the navmesh straight-path length.
- **Debug view:** an overlay shows POI doors with their roles, catalog ids and distance bands, the chunk grid, physics-loaded chunks and thief states.
- Falling into the water or out of bounds respawns the player at the nearest hospital. They keep their orders; Fragile bonuses are lost.

## 6. Progression and economy

### 6.1 Coins

Coins are off-chain, stored in the database, and cannot be traded or withdrawn.

| Item | Effect |
|---|---|
| Fuel | §4.4 |
| Cosmetics | Outfits, helmets, vehicle colours, bag skins, emotes, phone cases |

### 6.2 GAME purchases

Paid with GAME at a fixed USD price (§6.4). Ownership is recorded on-chain against the wallet and is permanent.

| Item | Effect | GAME split |
|---|---|---|
| Skateboard, bicycle, motorbike, car | The vehicle (§4.2). Tiers can be bought in any order. | 80% burned, 20% to the reward pool |
| Shoes (5 tiers, in order) | +3.5% on-foot sprint speed per tier (about +17.5% maxed) | 100% burned |
| Premium skins | Cosmetic only | 100% burned |
| Offer-lockout skip | Ends the cancel lockout (§3.5) | 100% burned |

USD prices are set in the program's settings by the admin multisig and are **Pending**.

**Removed in revision 2:** Backpack tiers (slots now come from the vehicle), skateboard tiers, Gloves, the GPS Watch (its features are standard on the phone), ranks and rank unlocks.

### 6.3 USD pricing mechanism

- Each GAME-priced item has `usd_price` (6 decimals) stored on-chain.
- The **price keeper** computes a **30-minute average** GAME→USD rate (the GAME/SOL pool average × a SOL/USD oracle average, e.g. Pyth) and posts it every few minutes. It reads the bonding curve before GAME graduates and the PumpSwap pool after.
- At purchase time: `game_to_spend = usd_price ÷ rate`.
- **Safety limits (on-chain):** the rate must be younger than 15 minutes; one update may move it at most 20%; the buyer passes `max_game` and the purchase fails above it.
- The shop shows both values, e.g. "$10 ≈ 41,250 GAME", updated live.

### 6.4 Lock-to-boost — **Pending**

The v1 lock-to-boost (lock GAME for up to +30% epoch points) was designed for epoch payouts. Whether it survives with per-order payouts is decided together with §9.

## 7. Multiplayer and combat

### 7.1 Rooms and networking

- Each city room holds **24 players**. Matchmaking fills the fullest room that has space.
- Clients send **inputs only**. The server simulates at 30 Hz and is authoritative. The local player uses client-side prediction with reconciliation; remote players and vehicles are interpolated about 100 ms behind.
- **Reconnects:** within 60 s the player keeps their orders and parked vehicles; after that, accepted orders are cancelled with no penalty and no lockout.

### 7.2 Combat and collisions

| Rule | Value |
|---|---|
| Hit (on foot) | Left click, 2.5 m range, frontal cone. Knockback plus a 1.75 s stun. Cooldown 5 s; 4 s stun immunity after a stun. |
| Hitting a rider | A hit knocks a skateboard, bicycle or motorbike rider off. Car drivers can't be hit. |
| Vehicle collisions | A moving vehicle that hits a player on foot or a two-wheel rider knocks them away and stuns them for **2 s**. Car-to-car contact only pushes. |
| Safe zones | The four hospitals (18 m radius around each lot): no hits and no vehicle knockback inside. |
| Fragile | Being hit or knocked over cancels the target's Fragile bonuses; orders are never lost. |
| Lag compensation | The server rewinds targets up to 150 ms to validate hits and collisions. |

**Visible to other players:** outfit, nameplate, vehicle and the orders being carried.

### 7.3 Thieves

Thieves are street NPCs (kept from SP2) that make carrying orders on foot risky.

| Rule | Value (config) |
|---|---|
| Where | Streets and plazas; they stay on their level and never enter hospital safe zones |
| Trigger | A courier **on foot or on a skateboard** carrying at least one order comes within 15 m in line of sight |
| Chase | 7 m/s for at most 10 s; one chaser at a time |
| Escape | Out-run them, mount a faster vehicle, or reach a hospital |
| Catch | Within 0.9 m: every carried order fails (no points, Coins or GAME); orders not yet picked up are kept. 1 Delivery Point is subtracted from the player's current total, floored at 0. |
| Cooldown | A robbed courier is ignored by thieves for 20 s |
| Authority | Server-simulated and shared in multiplayer |

## 8. Phone

The phone replaces the HUB screens. Tab raises it in the courier's hand; the full phone works on foot or when stopped. While riding, only notifications show, with a one-key accept for the top offer. A player using the phone can still be hit.

| App | Contents |
|---|---|
| Orders | Incoming offers (item, pickup and dropoff names, distance band, weight, timer, reward), active orders, cancel, lockout timer and skip |
| Map | City map, route to the next stop for the current vehicle class, hospitals, gas stations; standard waypoint line (the old GPS Watch) |
| Garage | Owned vehicles, where each is parked, fuel, switch, summon |
| Shop | Coins tab (fuel cards, cosmetics) and Token tab (vehicles, Shoes, premium skins) with USD and GAME prices |
| Wallet | Accrued GAME from orders, Claim button (the player signs and pays the fee), claim history |
| Wardrobe | Outfits, vehicle colours, bag and phone skins |
| Leaderboard | Daily and weekly Delivery Points |
| Settings | Controls, audio, graphics |

**HUD (always on screen):** the next stop with distance and arrow, active order timers, the vehicle's speed, fuel and load (slots and kg), offer notifications, Coins, and the Wallet's accrued GAME. **Feedback:** hit and crash effects, a stun tumble, delivery-complete popups with points, Coins and GAME.

## 9. Reward program (Solana, Anchor) — **Pending**

**This section is a draft. The owner will define the payout design; nothing here is approved for implementation.** Any change to the reward program needs the owner's explicit approval.

What is decided:
- **Funding:** Pump.fun creator fees from the GAME/SOL pair (in SOL) go to the reward vault through the fee-sharing split, harvested permissionlessly as in v1; plus 20% of the GAME spent on every vehicle purchase (§6.2).
- **Payout currency:** GAME. The vault's SOL is used to buy back GAME (PumpSwap) and that GAME is paid to players.
- **Accrual:** each completed order adds its reward to the player's balance shown in the Wallet app.
- **Claim:** the player claims whenever they like; the claim is a transaction the player signs and pays the fee for.
- **Warning kept from v1:** Pump.fun allows only one post-launch change to the fee recipients. The program must be audited and deployed, and its vault address final, before the fee configuration is set.

What is **Pending** (owner): how much one order pays and how that depends on the pool (fixed fraction per order, a per-order cap, points-weighted share of a periodic budget, …); buyback timing and slippage limits; how accrued balances are proven on-chain (signed vouchers or cumulative Merkle roots, as in v1); the fate of lock-to-boost (§6.4).

Guarantees any design must keep: payouts can never exceed what the vault holds; claims are idempotent and can't double-pay; purchases burn and record in one instruction; only the admin multisig changes settings; an emergency pause can stop claims but never redirect funds.

## 10. Anti-cheat

| Layer | Mechanism |
|---|---|
| Server authority | The client sends only inputs; the server simulates all movement and vehicles. Each vehicle's top speed is a hard cap. |
| Delivery validation | The player must be at the pickup and dropoff doors on the server, on foot. Each order has a minimum plausible time: `path distance ÷ top speed of the vehicle used × 0.8`. Faster deliveries are rejected and flagged. |
| Behavior flags | Repeated identical routes, overly regular input timing, many wallets per IP. Flagged players' rewards are held. |
| Review | An admin page lists held rewards. Approved rewards are credited; rejected ones are discarded. |

No system fully stops a well-built bot that genuinely plays the game. These layers raise the cost and make bots detectable.

## 11. Wallet and accounts

- **Sign-in:** the player connects a wallet through the Solana Wallet Adapter / Wallet Standard (Phantom, Solflare and OKX Wallet listed explicitly) and signs a Sign-In With Solana message with a server nonce. The server verifies it and issues a session token bound to the wallet.
- **The wallet is the account.** Coins, cosmetics, Delivery Points and accrued rewards are keyed by wallet address.
- **On-chain actions from the client:** buying vehicles, Shoes, skins and lockout skips, and claiming rewards. All are signed by the player's wallet.
- **Server sync:** the server reads each player's on-chain ownership when they join and subscribes to changes. Purchases take effect only after on-chain confirmation.

## 12. System architecture

```
delivery-maxing/
  packages/
    shared/    movement and vehicle sim, order rules, offer selection, combat rules, config types
    client/    Three.js + Vite: rendering, input layer, phone UI and HUD, wallet
    server/    Colyseus rooms, auth, Postgres access, reward accrual, admin page
    keeper/    price keeper service
    tools/     Node-only build steps: asset import and check, city generator, navmeshes, POI table (never bundled)
  programs/
    rewards/   Anchor program
  config/      tuning JSON (movement, vehicles, orders, fuel, prices, combat, economy)
  map/         catalog.json, city.layout.json, generated POI table and navmeshes
  assets/      CC0 courier; packs/ (git-ignored) holds the owner's model packs
```

- **Package manager:** pnpm workspaces.
- **Database tables:** `players`, `vehicles`, `deliveries`, `reward_accruals`, `claims`, `flags`.
- **Data flow:** inputs go from client to server; the server sends snapshots back; each completed delivery and its reward accrual is written to Postgres immediately; claims go on-chain from the client; the server subscribes to ownership and claim accounts.

## 13. Error handling

| Failure | Behavior |
|---|---|
| Wallet rejects or fails a transaction | A clear message. Nothing is charged and nothing is granted. |
| Purchase pending | The vehicle or item appears only after on-chain confirmation. |
| Claim fails | Safe to retry; the balance stays in the Wallet app. |
| Rate is stale | The shop shows "Prices updating, purchases paused." |
| Harvest or buyback fails | Retried later; fees wait at Pump.fun or in the vault. |
| Server crashes | Completed deliveries and accruals are already saved. Active orders are restored when the player reconnects. |
| Vehicle stuck | Summon from the Garage (§4.2) or respawn at a hospital from Settings. |

## 14. Testing

- **Shared logic:** Vitest unit tests for movement, vehicles (speed caps, slopes, access per surface), slots and weight, offer selection, timers, points, fuel, cancel lockout, combat and collision stuns, thieves.
- **Map:** the layout validator (no overlaps, no lots on roads, package doors within 30 m of a car road, the 15% food-only cap, reachability per vehicle class) runs in `pnpm map:check` and CI.
- **Reward program:** Anchor tests on a local validator for every guarantee in §9, once the design is approved.
- **Server:** simulated rooms with bot clients; anti-cheat tests that feed impossible inputs and expect rejection.
- **Client:** Playwright smoke tests (load, sign in with a mock wallet, take an offer, ride, deliver), driven by sim ticks. Performance target: 60 fps on a mid-range laptop, proven with the SP2 `?perf=1` method.
- **Release gates:** a playtest at the end of each sub-project, and a professional audit of the reward program before mainnet.

## 15. Sub-projects and build order

Each sub-project gets its own implementation plan, the owner's approval and a playtest.

| # | Sub-project | Status / done when |
|---|---|---|
| 1 | Movement + delivery loop | Done (PR #2) |
| 2 | City map + POI system (2 × 2 km, Quaternius) | Built on branch `sp2/city-map-poi`; PR #3 was closed unmerged on 2026-10-14 because revision 2 replaces its map. Its streaming, LOD, navmesh, generator and perf tooling are reused from that branch in SP5. |
| 3 | **Core loop rework** | Built (PR #5). HUB, Order Board and parkour kit removed; food and package orders pickup → dropoff; offers, slots and weight, timers, cancel lockout; the phone (Orders, Map, Wallet stub); hospitals as spawn points; on the current map with placeholder POI roles. |
| 4 | **Vehicles** | Skateboard, bicycle, motorbike and car on the shared sim; mount, park, summon; access per surface; per-class navmeshes and routing; fuel and gas stations; vehicle collisions; tuned on a greybox test town with slopes, alleys and stairs. |
| 5 | **City v2** | The terraced bay city from `2026-10-14-city-map-design.md`: asset import and `assets:check`, catalog, layout generator and validator, placeholders, business names and addresses, streaming and LOD with the new packs, 60 fps re-proved. |
| 6 | **Economy** | Coin shop (fuel, cosmetics), token shop (vehicles, Shoes, skins, lockout skip) wired to a mock on-chain source, Garage and Wallet apps. |
| 7 | **Multiplayer + combat** | Colyseus rooms, prediction and interpolation for players and vehicles, server-authoritative thieves, wallet sign-in, Postgres persistence, combat and collisions, anti-cheat, reconnects. |
| 8 | **Reward program + launch** | After the owner's payout design (§9): harvest spike, Anchor program, buyback, price keeper, claims, devnet rehearsal, audit, then mainnet and the Pump.fun launch. |

## 16. Risks, legal and open items

**Risks and legal:**
- **Real-value rewards:** paying rewards funded by token trading fees may be regulated as securities, gambling or another category depending on the country. Get legal advice before launch; this spec is not legal advice.
- **Spending for advantage:** revision 2 deliberately lets spending (vehicles bought with GAME) increase earnings. Combined with real-value payouts, this strengthens the case that the game is an investment product or gambling in some jurisdictions. Include it in the legal review. (The v1 spec had rejected spend-for-advantage designs as too pay-to-win.)
- **Asset licence:** the Megatropolis and Tropical City packs are the owner's Unity Asset Store purchase (Low Poly Asset Bundle, Standard EULA, Single Entity). They may ship inside the game but not be redistributed, so they are git-ignored and fetched privately in CI (`assets/CREDITS.md`). The project rule "CC0 assets only" must be updated to cover them.
- **Custody:** the program holds the reward pool, which makes it a high-value target. The audit must cover it.
- **Branding:** no Amazon or real delivery-app names, logos or trade dress (Grab, ShopeeFood, Uber Eats, DoorDash…). Business names in the city are fictional.

**Performance risk:** the dense city places about 2,600 buildings (7.3 M triangles at full detail). City v2 must re-prove 60 fps with merged blocks, LOD and fog, and keep the first download under about 40 MB with compression.

**Open items (owner):**
- The reward payout design (§9) and lock-to-boost (§6.4).
- USD prices of vehicles, Shoes, skins and the lockout skip.
- Models for the skateboard, bicycle, motorbike, post office, warehouse, school, containers and cranes.
- Confirm the creator fee percentage at launch (Pump.fun allows 0.05%–1%).

**Not in v1 (later ideas):** mobile touch controls, NPC traffic and pedestrians, Rush Hour events, private rooms.

**Considered and rejected:** a truck tier; separate cc classes of motorbike (merged into one); ranks; per-epoch payouts (replaced by per-order accrual); VIP levels; race wagers (gambling risk).
