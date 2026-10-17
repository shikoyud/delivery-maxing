# Delivery Maxing — Game Design Spec

- **Date:** 2026-10-12
- **Status:** Approved v1 (2026-10-12, revised after the SP1 playtests and SP2). **Revision 2 (2026-10-14, the redesign) approved by the owner on 2026-10-14:** no HUB, point-to-point food and package orders, vehicles and fuel, an in-game phone, hospitals as spawn points and safe zones, no parkour, no ranks, a SOL-paired token, rewards paid in GAME per order, and a new 1.2 km terraced city (`2026-10-14-city-map-design.md`). **SP5 playtest changes (2026-10-17, the owner's decisions):** a full-screen map instead of the phone's Map app, a food-prep progress bar, a skateboard jump, getting off at any speed, WASD-only vehicle controls with the mouse for looking, and a 3 min pickup deadline with a 3 min offer lockout. **Revision 3 (2026-10-17, the economy) approved by the owner in the SP6 plan thread:** every order pays a random USD-valued amount of GAME whose range the vehicle sets, four upgrade lines (Vehicle, Bag, Shoes, Dispatcher), lock-to-boost, fixed ranges that pay nothing from an empty vault (§3.6, §6, §9). Sections marked **Pending** need the owner's input before they are built.
- **Game name:** Delivery Maxing

## 1. Summary

Delivery Maxing is a third-person, low-poly, multiplayer courier game that runs in the browser. Players take food and package orders on their **phone** and deliver them from one place in the city to another: from a bakery to an apartment, from a factory to a construction site. They get around on foot or on a vehicle they own: **skateboard, bicycle, motorbike or car**. Better vehicles carry more and heavier orders and earn more. Players can shove each other, vehicles knock people over, and street thieves chase couriers on foot. There are no health points.

Every completed order adds **GAME** to the player's **Wallet** app on the phone; the player claims it on-chain whenever they like and pays the transaction fee. The reward pool is funded by the Pump.fun creator fees of the game's own token **GAME** (paired with SOL) and by part of every vehicle purchase, and pays out in GAME bought back from the market. Each order pays a random USD-valued amount whose range the vehicle sets (§3.6).

Vehicles and token upgrades are bought by burning GAME at fixed USD prices. Fuel and cosmetics are bought with **Coins**, an off-chain currency earned by playing.

### Design goals

1. **Getting around the city is the fun.** Moving through a dense, hilly city on foot and on wheels must feel good on its own.
2. **Spending buys a stronger courier.** Each tier of every upgrade line is strictly better than the one below it: a better vehicle earns more per order whatever the route. Skill (routes, shortcuts, order choice) decides the rest.
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
| **Phone (rev. 2)** | The main UI: orders, garage, shop, wallet, wardrobe, leaderboard, settings (§8). |
| **Map (SP5 playtest)** | A game feature, not a phone app: M opens a full-screen map of the whole city at any time (§8). |
| **Vehicle controls (SP5 playtest)** | WASD only: W throttle, S brake and reverse, A/D steer. The mouse only looks. Get off at any speed. The skateboard jumps (§4.2). |
| **Spawning and safe zones (rev. 2)** | Four hospitals are the only spawn points and the only safe zones. |
| **Cancelling (rev. 2)** | Cancel any order from the phone, anywhere. No cooldown, but the server stops sending you offers for a while; burning GAME skips the wait (§3.5). |
| **Pickup deadline (SP5 playtest)** | 3 min from accepting to reach the pickup; missing it fails the order and locks offers for 3 min (§3.4). |
| **Ranks (rev. 2)** | Removed. |
| **City (rev. 2)** | 1.2 × 1.2 km terraced Western bay city built from the owner's Megatropolis and Tropical City packs; dense wall-to-wall blocks, four levels (§5, `2026-10-14-city-map-design.md`). Replaces the SP2 2 × 2 km city. |
| **Token (rev. 2)** | GAME launches on Pump.fun paired with SOL (no AMZNx). Creator fees accrue in SOL. |
| **Rewards (rev. 2)** | Paid in GAME (bought back with pool SOL), accrued per completed order into the Wallet app, claimed by the player who pays the fees. Payout math in §3.6 (rev. 3). |
| **Vehicle purchases (rev. 2)** | Paid in GAME at fixed USD prices: 80% burned, 20% sent to the reward pool. |
| **Spender advantage (rev. 2)** | Intentional: better vehicles earn more. The legal risk this adds is in §16. |
| **Payout per order (rev. 3)** | A random USD-valued GAME amount; the order's vehicle tier sets the range, so each tier is strictly better by payout (§3.6). Ranges are fixed; an empty vault pays nothing (§9). |
| **Upgrade lines (rev. 3)** | Vehicle (payout range), Bag (slots and weight), Shoes (on-foot speed), Dispatcher (offer frequency and quality): five tiers each, bought in order with GAME (§6.2). |
| **Lock-to-boost (rev. 3)** | GAME locked for 7 days gives up to +30% on every payout (§6.4). |
| Thieves | Street NPCs chase couriers on foot carrying orders; a catch fails the carried orders. Kept from SP2, adapted to vehicles (§7.3). |
| Art (rev. 2) | The owner's Megatropolis and Tropical City `.glb` packs for the city; the CC0 Quaternius courier; code-built placeholders for anything missing. Licensed Unity Asset Store packs, kept out of git (§16, `assets/CREDITS.md`). |
| Map build | A seeded generator writes the committed layout and generated files; `pnpm map:check` regenerates and byte-compares them in CI (kept from SP2). |

## 3. Core loop

1. The player spawns at a hospital, on foot or next to their parked vehicle.
2. **Offers** arrive on the phone. The player accepts the ones that fit their free slots and their vehicle's weight limit.
3. They ride or walk to each **pickup**, collect the order at the door, then take it to the **dropoff** door.
4. Each completed order earns **Delivery Points** (score and reward weight), **Coins**, and a **GAME** reward credited to the Wallet app (§3.6).
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

Capacity comes from the **Bag** (an upgrade line, §6.2), capped by the vehicle (revision 3; before, the vehicle alone set it).

| Bag tier | 0 (free) | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| Slots (food and packages share them) | 1 | 2 | 3 | 4 | 5 | 6 |
| Max total package weight | — | 10 kg | 25 kg | 50 kg | 100 kg | 150 kg |

| Vehicle cap | Walk | Skateboard | Bicycle | Motorbike | Car |
|---|---|---|---|---|---|
| Slots at most | 2 | 2 | 3 | 4 | 6 |
| Package weight at most | 10 kg | 10 kg | 25 kg | 50 kg | 150 kg |

The player's capacity is the smaller of the two. All values are config.

- Food uses a slot and has no weight. A package uses a slot and its weight counts against the capacity.
- Package weight classes: Small 1–10 kg, Medium 10–25 kg, Large 25–50 kg, Bulky 50–150 kg (car only).
- Offers are filtered by the player's capacity for the vehicle they are using (or last parked): a package offer appears only if its weight fits.
- **Every delivery ends on foot.** The player gets off, carries the order to the door, and walks back. Carrying a Bulky package by hand disables sprint and slide.
- Switching to a smaller vehicle while carrying orders it can't hold is blocked.

### 3.4 Offers

| Rule | Value (config) |
|---|---|
| Offers shown at once | At most 3, 3, 4, 4, 5, 5 at Dispatcher tiers 0–5 (`lines.dispatcher.maxShown`). The cap counts the offers still within their lifetime, so it is reached only when the lifetime allows: at the tier 5 interval (9–15 s) and a 25 s lifetime about two or three offers are up at once |
| Offer lifetime | 25 s (`offers.lifetimeSeconds`), then it disappears |
| New offers | Every 18–30 s (`offers.minIntervalSeconds`–`maxIntervalSeconds`) while the player has a free slot, scaled by the Dispatcher tier: ×1.0, 0.9, 0.8, 0.7, 0.6, 0.5 at tiers 0–5 (`lines.dispatcher.intervalScale`; 9–15 s at tier 5) |
| Pickup distance | The pickup is at most 400 m (path) from the player when offered |
| Accepting | One tap on the phone, anywhere; while driving, a one-key accept on the notification |
| Pickup deadline | After accepting, the courier has **3 min** to reach the pickup door. Missing it fails the order (no points, Coins or GAME) and starts a 3 min offer lockout (§3.5). |
| Selection rules | Distance bands, door spacing, reuse and reachability per city map design §6.4; higher Dispatcher tiers weight long and modified orders more (§6.2) |

Players never compete for the same order: each player's offers are their own.

### 3.5 Cancelling

- Any accepted order can be cancelled from the phone, anywhere, at any time. There is no cancel cooldown.
- Cancelling starts an **offer lockout**: the server sends that player no new offers for 45 s (config). Orders already accepted continue normally.
- Missing the pickup deadline (§3.4) also fails the order and starts a longer lockout of 3 min (config). A longer lockout replaces a shorter one still running; it never shortens one.
- The lockout can be skipped by burning GAME at a fixed USD price (§6.3). The price is a placeholder in §6.2.
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

Every value is a tuning value in config. Points are rounded to the nearest whole point. A thief catch (§7.3) subtracts points.

**GAME reward per order (revision 3).** Every completed order also pays a random USD-valued amount of GAME, in the style of a fishing game where the rod sets the price range of what you catch:

| Order's vehicle tier | Walk | Skateboard | Bicycle | Motorbike | Car |
|---|---|---|---|---|---|
| Payout range (USD, config starting values) | $0.005–0.03 | $0.01–0.06 | $0.02–0.12 | $0.03–0.30 | $0.05–0.60 |

- The **order's vehicle tier** is the tier its offer was made for (the vehicle in use or last parked when it was accepted, §3.3). Ranges never overlap in average: each tier's expected payout per hour is above the tier below on any route, so a better vehicle is strictly better however the city is laid out.
- The roll: `payout = min + (max − min) × (0.6 × quality + 0.4 × luck)`, where `quality` is the order's points divided by the most points that order could have earned (so band, weight, hot or par time, Express and Fragile all pull the roll up) and `luck` is a uniform random number the server draws and records with the delivery. Weights are config.
- Lock-to-boost (§6.4) multiplies the result by up to 1.3.
- The USD amount is converted to GAME at the keeper's rate (§6.3) when the order completes and credited to the Wallet app (§9). An order completed while the vault cannot cover the payout pays points and Coins only, and the Wallet app says so.
- Late, cold, damaged or over-par orders still roll, with the lower `quality` they earned. A cancelled, failed or stolen order pays nothing.

## 4. Movement and vehicles

**Camera:** a third-person chase camera about 4.5 m behind and 1.6 m above the courier, orbited with the mouse. It lags slightly, widens its field of view with speed, and pulls in when geometry would block the view. On vehicles it sits further back and higher (config). On foot, movement is relative to the camera. On a vehicle, WASD alone drives it (W throttle, S brake and reverse, A/D steer) and the mouse only looks around; the camera swings back behind the vehicle once the mouse has been still for 1.5 s, while the vehicle moves faster than 2 m/s (`camera.ride`).

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

**Input layer:** raw input is mapped to actions: `move`, `look`, `jump`, `crouch`, `sprint`, `interact`, `hit`, `mount`, `phone`, `accept`. Gameplay code only reads actions. Default keys: WASD move (on a vehicle: W throttle, S brake and reverse, A/D steer), mouse look, Space jump (on the skateboard: jump; on the other vehicles: handbrake), C crouch, Shift sprint (toggle; on a vehicle: boost is not used), E interact (pick up, hand over, refuel), F mount/dismount, Tab phone, M map, Y accept the top offer, left click hit. Crouch is C only, never Ctrl (Ctrl+W closes the tab).

### 4.2 Vehicles

| | Walk | Skateboard | Bicycle | Motorbike | Car |
|---|---|---|---|---|---|
| Top speed | 8 m/s | 12 m/s | 16 m/s | 22 m/s | 28 m/s |
| Slot cap (the Bag sets the rest, §3.3) | 2 | 2 | 3 | 4 | 6 |
| Package weight cap | 10 kg | 10 kg | 25 kg | 50 kg | 150 kg |
| Payout range (§3.6) | $0.005–0.03 | $0.01–0.06 | $0.02–0.12 | $0.03–0.30 | $0.05–0.60 |
| Fuel | — | — | — | Yes | Yes |
| Price (USD, placeholder config) | Free | $2 | $5 | $12 | $25 |

- **Physics:** an arcade vehicle model in the shared package (kinematic, like the character controller), not Rapier dynamic-body cars, so server authority and client prediction stay simple. Each vehicle has acceleration, braking, turn rate, grip and slope behavior in config.
- **Mount and dismount:** F next to an owned vehicle. F gets off at any speed: the vehicle stops and stays parked where it was left, and the courier steps off beside it keeping the vehicle's momentum up to the on-foot speed cap. Other players can't use a parked vehicle. The skateboard is the exception: it is carried when you get off (never parked), and F on foot puts it down and rides it.
- **Skateboard jump:** Space makes the skateboard jump (about 0.8 m, config), keeping its speed.
- **Summon:** from the phone's Garage, an owned vehicle more than 100 m away is moved to the nearest legal road spot next to the player. Cooldown 60 s.
- **Reverse:** S brakes, then reverses: the car at 6 m/s, the bicycle and motorbike at walking pace (2 and 2.5 m/s, `config/riding.json`); the skateboard only brakes. A/D turn every vehicle on the spot when stopped, so a wedged bike can always get out.
- **Speed caps:** each vehicle's top speed is its server-enforced cap (§10).
- **Crashes:** hitting a wall above 10 m/s costs a carried Fragile bonus (§3.2). It does not knock the rider off until combat and collisions (SP7).
- **Ownership:** recorded on-chain against the wallet and permanent (§6.2). Vehicles are an upgrade line bought in order (skateboard first, car last); a player owns every tier up to the one bought and switches at any parked vehicle. A new player owns no vehicle; the dev panel's Owned boxes grant and revoke tiers on the mock chain (SP6).
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
| Fuel can | Bought in the Shop's Coins tab: adds 25% of a tank to the ridden or last-ridden motorbike or car wherever it is, for 1.5 × the pump price of that fuel (motorbike 15 Coins, car 30 Coins). Not for sale without a motorbike or car to fill. |
| HUD | Fuel gauge while riding; the map (M) shows gas stations |

## 5. City and POIs

The city is defined in **`2026-10-14-city-map-design.md`**: a 1.2 × 1.2 km Western bay city that climbs north from the water in four terraces (Waterfront 2 m, Bayview 10 m, Midtown 24 m, Uptown 38 m, Hillcrest ridge 48–60 m), joined by switchback roads, steep lanes and stairs. Blocks are wall to wall (about 2,600 buildings); four hospitals and six gas stations are fixed landmarks; about 800 POI doors are placed only on buildings that would plausibly send or receive orders.

- **Building blocks:** the owner's Megatropolis and Tropical City packs, used at 1:1, listed in `map/catalog.json`. Missing types (post office, warehouse, school, courier vehicles, containers, cranes) render as placeholders until supplied.
- **Layout data:** `map/city.layout.json` (lots, roads, connectors, POI doors), generated deterministically and then editable; swapping a model never moves a lot.
- **Streaming and LOD (kept from SP2):** 100 m chunks; colliders paged around the player; render LOD rings (LOD0 near, simplified LOD1, placeholder boxes far) with radial fog; one merged mesh and one compound collider per block.
- **Navmeshes:** generated at build time, one per tier (five: walk, skateboard, bicycle, motorbike, car), gzipped (`map/nav/city-<tier>.bin.gz`). A path counts only if it really reaches both ends (recast reports partial paths as success). Path distance is the navmesh straight-path length.
- **Debug view:** an overlay shows POI doors with their roles, catalog ids and distance bands, the chunk grid, physics-loaded chunks and thief states.
- Falling into the water or out of bounds respawns the player at the nearest hospital. They keep their orders; Fragile bonuses are lost. A vehicle ridden out of bounds is towed to that hospital's vehicle bay.

## 6. Progression and economy

### 6.1 Coins

Coins are off-chain, stored in the database, and cannot be traded or withdrawn.

| Item | Effect |
|---|---|
| Fuel | §4.4: pumps, and fuel cans in the Shop |
| Cosmetics (as built in SP6) | Six colours per slot, the first one free: outfit colours (the courier's main material: Teal, Coral, Sky, Lime, Plum, Charcoal), vehicle paint for every owned ride, the pack car included (Factory, Cherry, Ocean, Sunflower, Mint, Midnight), bag colours (the boxes the courier carries: Cardboard, Crimson, Navy, Olive, Lavender, Snow) and phone cases (the phone's frame: Slate, Rose, Aqua, Lemon, Grape, Pearl), 50 to 200 Coins each. Helmets and emotes wait for models and animations. |

Premium skins (GAME, §6.2) are three finishes, **Gold, Chrome and Neon**, each for the outfit and for vehicle paint (six skins). They show in the Wardrobe once the chain owns them.

### 6.2 GAME purchases

Paid with GAME at a fixed USD price (§6.3). Ownership is recorded on-chain against the wallet and is permanent.

**Four upgrade lines (revision 3)**, each with tiers bought in order (tier 0 is free), each strictly better than the tier below:

| Line | What a tier gives | Tiers | USD per tier (placeholder config) | GAME split |
|---|---|---|---|---|
| **Vehicle** | The payout range (§3.6), speed, and the capacity cap (§4.2) | Skateboard, bicycle, motorbike, car | $2, $5, $12, $25 | 80% burned, 20% to the reward vault |
| **Bag** | Slots and max package weight (§3.3) | 5 | $1, $2, $4, $8, $15 | 80% burned, 20% to the vault |
| **Shoes** | +3.5% on-foot sprint speed per tier (about +17.5% maxed) | 5 | $1, $2, $3, $4, $5 | 80% burned, 20% to the vault |
| **Dispatcher** | Offers more often (interval ×0.9, 0.8, 0.7, 0.6, 0.5 of 18–30 s), more at once (a cap of 3, 3, 4, 4, 5, 5 from tier 0, counted within the 25 s offer lifetime, §3.4), and weighted toward long and modified orders (the top of the payout range) | 5 | $1, $3, $6, $10, $15 | 80% burned, 20% to the vault |

Other GAME purchases:

| Item | Effect | GAME split |
|---|---|---|
| Premium skins | Cosmetic only: Gold, Chrome and Neon finishes for the outfit and for vehicle paint (§6.1) | 100% burned |
| Offer-lockout skip | Ends the cancel or missed-pickup lockout (§3.5) | 100% burned |

USD prices are set in the program's settings by the admin multisig; the values above are the config starting values until the owner sets the real ones.

**Removed in revision 2:** skateboard tiers, Gloves, the GPS Watch (its features are standard on the phone), ranks and rank unlocks. Revision 3 brings slots back as the Bag line.

### 6.3 USD pricing mechanism

- Each GAME-priced item has `usd_price` (6 decimals) stored on-chain.
- The **price keeper** computes a **30-minute average** GAME→USD rate (the GAME/SOL pool average × a SOL/USD oracle average, e.g. Pyth) and posts it every few minutes. It reads the bonding curve before GAME graduates and the PumpSwap pool after.
- At purchase time: `game_to_spend = usd_price ÷ rate`. At order completion: `game_paid = usd_payout ÷ rate` (§3.6).
- **Safety limits (on-chain):** the rate must be younger than 15 minutes; one update may move it at most 20%; the buyer passes `max_game` and the purchase fails above it.
- The shop shows both values, e.g. "$10 ≈ 41,250 GAME", updated live.

### 6.4 Lock-to-boost

Decided in revision 3 (the "boat": holding the token makes you a better courier, checkably).

- The player locks GAME in the reward program for **7 days**; the lock renews for another 7 days unless the player withdraws after it ends. Locked GAME is not spent.
- **Withdraw window** (`lock.withdrawWindowHours: 24`): a lock can be withdrawn from the end of its period, and a renewed lock stays withdrawable for the first 24 h of its new period, so a player who comes back after the end can still take it out. After that window it is locked until the next end.
- Every order payout (§3.6) is multiplied by `1 + 0.3 × min(1, locked_usd ÷ 100)`: +30% at $100 of GAME locked (valued at the keeper's rate when locked), linear below. The cap and the amount are config and program settings.
- Locking rather than holding means the same tokens cannot boost several wallets, and the boost is readable on-chain by the server.
- The Wallet app shows the locked amount, the boost and the unlock date.

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
| Orders | Incoming offers (item, business and addressee names with street addresses, distance band, weight, timer, reward) with Accept, active orders with Cancel (a food order being prepared shows its bar), the lockout row (cancelled or missed pickup) with its timer and Skip, which opens the same GAME confirm sheet as the Shop |
| Garage | All four vehicles: each owned tier with where it is (riding, carried, parked and how far), fuel, its payout range, Switch (on foot: the tier offers, capacity and the payout range follow; refused when the carried orders don't fit) and Summon; tiers not owned show their range and Buy, which opens the Shop's Token tab |
| Shop | The GAME balance and Coins with the Mock wallet badge. Coins tab: fuel can, outfits, vehicle paint, bags, phone cases (bought on one tap). Token tab: the four upgrade ladders (owned tiers ticked, the next one Buy, later ones locked), premium skins, the lockout skip; prices as "$12 ≈ 50,000 GAME". A GAME Buy opens a confirm sheet (price, "You pay at most …" with the 2% slippage, where the GAME goes, Confirm and Cancel); the row shows "Confirming…" until the chain confirms; a stale rate shows "Prices updating, purchases paused" |
| Wallet | The wallet address with the Mock wallet badge and the GAME balance; Earned (accrued GAME, Claim, claim history); the reward vault in GAME and USD ("Vault empty · orders pay no GAME"); Boost (the Lock form with the boost previewed, then the locked amount, the boost, the unlock date and Withdraw in the withdraw window); the last payouts (USD, GAME, tier, kind) and purchases (Confirming…, Confirmed, Failed with the reason); Delivery Points, Coins and deliveries. The Claim on the real chain (the player signs and pays the fee) is SP8; the mock claim is instant |
| Wardrobe | Outfits, vehicle paint, bags and phone cases (§6.1): owned items Equip or show Equipped, Coin items not owned are greyed "In the Shop", premium finishes appear once owned |
| Leaderboard | Daily and weekly Delivery Points |
| Settings | Controls, audio, graphics |

**Map (M):** not a phone app (SP5 playtest; the phone has no Map tab, seven apps). M opens a full-screen map of the whole city on foot or riding, at any speed (mouse-wheel zoom 1× to 6× toward the cursor, drag to pan, a legend; M or Esc closes it): routes to the next stops for the current vehicle class, hospitals, gas stations, parked vehicles and offers, with the standard waypoint line (the old GPS Watch). The minimap stays on the HUD.

**HUD (always on screen):** the next stop with distance and arrow, active order timers (a food order being prepared shows a progress bar, not a countdown), the vehicle's speed, fuel and load (slots and kg), offer notifications, Coins, and the Wallet's accrued GAME. **Feedback:** hit and crash effects, a stun tumble, delivery-complete popups with points, Coins and the GAME payout.

## 9. Reward program (Solana, Anchor)

**The payout design was decided by the owner in revision 3 (2026-10-17).** Any change to it needs the owner's explicit approval. The program itself is built in SP8 after an audit; until then SP6 plays the same rules against a browser mock (§15).

What is decided:
- **Funding:** Pump.fun creator fees from the GAME/SOL pair (in SOL) go to the reward vault through the fee-sharing split, harvested permissionlessly as in v1; plus 20% of the GAME spent on every vehicle purchase (§6.2).
- **Payout currency:** GAME. The vault's SOL is used to buy back GAME (PumpSwap) and that GAME is paid to players.
- **Payout per order:** the random USD-valued roll of §3.6, converted to GAME at the keeper's rate, times the lock-to-boost multiplier (§6.4). Ranges are fixed: they never scale with the vault.
- **Empty vault:** when the vault cannot cover an order's payout, that order pays no GAME (points and Coins as usual). Nothing is owed later. The Wallet app shows the vault balance so this is never a surprise.
- **Accrual:** each completed order adds its payout to the player's balance shown in the Wallet app; the server records the roll (the luck number, the quality, the rate) with the delivery.
- **Lock-to-boost:** locked GAME is held by the program (§6.4).
- **Claim:** the player claims whenever they like; the claim is a transaction the player signs and pays the fee for.
- **Warning kept from v1:** Pump.fun allows only one post-launch change to the fee recipients. The program must be audited and deployed, and its vault address final, before the fee configuration is set.

Still open for the SP8 plan (engineering, not game design): buyback timing and slippage limits; how accrued balances are proven on-chain (signed vouchers or cumulative Merkle roots, as in v1).

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
| 4 | **Vehicles** | Built (PR #10). Skateboard, bicycle, motorbike and car on the shared sim; mount, park, summon; access per surface; per-class navmeshes and routing; fuel and gas stations; vehicle collisions; tuned on a greybox test town with slopes, alleys and stairs. |
| 5 | **City v2** | Built (PR #12). The terraced bay city from `2026-10-14-city-map-design.md`: asset import and `assets:check`, catalog, layout generator and validator, placeholders, business names and addresses, streaming and LOD with the new packs. Draw-call and triangle budgets proved on the placeholder city in the sandbox; 60 fps with the pack models awaits the owner's `?perf=1` run. The city is the default map; `?map=greybox` keeps the SP4 test town. |
| 6 | **Economy** | Built (PR #14). The revision 3 economy on a browser mock of the chain: the four upgrade lines (Vehicle, Bag, Shoes, Dispatcher) and the Coin shop (fuel, cosmetics), the per-order GAME payout roll, lock-to-boost, the Garage, Wallet and Wardrobe apps; plus the SP5 playtest changes: the full-screen map, the food-prep bar, the skateboard jump, getting off at any speed, WASD vehicle controls and the 3 min pickup deadline. |
| 7 | **Multiplayer + combat** | Colyseus rooms, prediction and interpolation for players and vehicles, server-authoritative thieves, wallet sign-in, Postgres persistence, combat and collisions, anti-cheat, reconnects. |
| 8 | **Reward program + launch** | The §9 program for real: harvest spike, Anchor program (purchases, locks, payouts, claims), buyback, price keeper, replacing SP6's mock, devnet rehearsal, audit, then mainnet and the Pump.fun launch. |

## 16. Risks, legal and open items

**Risks and legal:**
- **Real-value rewards:** paying rewards funded by token trading fees may be regulated as securities, gambling or another category depending on the country. Get legal advice before launch; this spec is not legal advice.
- **Spending for advantage:** revision 2 deliberately lets spending (vehicles bought with GAME) increase earnings. Combined with real-value payouts, this strengthens the case that the game is an investment product or gambling in some jurisdictions. Include it in the legal review. (The v1 spec had rejected spend-for-advantage designs as too pay-to-win.)
- **Asset licence:** the Megatropolis and Tropical City packs are the owner's Unity Asset Store purchase (Low Poly Asset Bundle, Standard EULA, Single Entity). They may ship inside the game but not be redistributed, so they are git-ignored (`assets/CREDITS.md`); fetching them privately in CI waits for the owner, and until then GitHub Pages deploys the placeholder city. The asset rule is: CC0, or the owner's licensed packs listed in `assets/CREDITS.md` (the project instructions' "CC0 assets only" is for the owner to update).
- **Custody:** the program holds the reward pool, which makes it a high-value target. The audit must cover it.
- **Branding:** no Amazon or real delivery-app names, logos or trade dress (Grab, ShopeeFood, Uber Eats, DoorDash…). Business names in the city are fictional.

**Performance risk:** the dense city places about 2,600 buildings (7.3 M triangles at full detail). City v2 must re-prove 60 fps with merged blocks, LOD and fog, and keep the first download under about 40 MB with compression.

**Open items (owner):**
- The real USD prices of every upgrade tier, skins and the lockout skip (placeholders in §6.2), and the real payout ranges (§3.6).
- Models for the skateboard, bicycle, motorbike, post office, warehouse, school, containers and cranes.
- Confirm the creator fee percentage at launch (Pump.fun allows 0.05%–1%).

**Not in v1 (later ideas):** mobile touch controls, NPC traffic and pedestrians, Rush Hour events, private rooms.

**Considered and rejected:** a truck tier; separate cc classes of motorbike (merged into one); ranks; per-epoch payouts (replaced by per-order accrual); VIP levels; race wagers (gambling risk); payout ranges that scale with the vault (rev. 3: fixed ranges, honest about an empty vault); higher tiers going everywhere lower tiers go (rev. 3: the city's shortcuts stay); hold-to-boost without a lock (gameable across wallets).
