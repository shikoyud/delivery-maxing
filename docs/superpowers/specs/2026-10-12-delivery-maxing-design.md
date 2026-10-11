# Delivery Maxing — Game Design Spec

- **Date:** 2026-10-12
- **Status:** Approved
- **Game name:** Delivery Maxing

## 1. Summary

Delivery Maxing is a first-person, low-poly, multiplayer parkour courier game that runs in the browser. Players take orders at a central HUB and deliver packages on foot across a compact city built for movement: wall-runs, slides, zip lines, jump pads and speed boost orbs. Players can buy a skateboard. They can also shove each other for a short knockback and stun. There are no health points.

Every 10 minutes (one **epoch**), a share of an on-chain reward pool is paid out in **AMZNx** (tokenized Amazon stock on Solana, mint `Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg`). Each player gets an amount proportional to the Delivery Points they earned in that epoch. Players who **lock GAME** in the reward program get a points multiplier of up to +30%. The pool is funded by Pump.fun creator fees from the game's own token, **GAME**, which is launched on Pump.fun paired with AMZNx.

GAME is spent (burned, at fixed USD prices) on high-impact upgrades and premium board skins. Cosmetics and low-impact upgrades are bought with **Coins**, an off-chain currency earned by playing.

### Design goals

1. **Movement is the fun.** If running around the city is not enjoyable on its own, nothing else matters.
2. **Skill decides most of the outcome.** Upgrades reach their ceiling quickly. Lockers get a capped edge (at most +30%). Beyond that, route knowledge and movement skill decide earnings.
3. **Rewards are honest and verifiable.** The pool, epoch results, locks and claims live on-chain. Delivery validation is server-authoritative.
4. **Token demand comes from use.** GAME is burned on upgrades and premium skins, and locked for the points bonus.

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
| Token launch | GAME is launched on Pump.fun as a Custom Pair quoted in AMZNx. Creator fees are paid in AMZNx. |
| Fee collection | The Pump.fun creator-fee split sends a share to the reward program's vault. Harvesting into the vault is permissionless. |
| Reward pool | Fully on-chain program. Each epoch pays a fraction of the unreserved vault. Players claim their rewards. |
| GAME pricing | Everything bought with GAME has a fixed USD price. A price keeper posts a 30-minute average GAME→USD rate, bounded by on-chain safety limits. |
| GAME uses | Burned on token upgrades and premium board skins. Locked for a points multiplier. |
| Spender advantage | Lock-to-boost only: up to +30% Delivery Points, with diminishing returns. No VIP levels. |
| Ranks | Kept. They unlock Express and Chain orders and cosmetics. No shortcut doors. |
| Catch-up | Upgrades hit their ceiling fast. No rookie boost. |
| Boost orbs | Shared within a room: first to touch takes it. |
| Art | Free CC0 low-poly packs (Kenney, Quaternius). Gameplay objects are built in code. |

## 3. Core loop

1. The player stands at the **HUB** (Central Plaza) and opens their **personal Order Board**.
2. They accept orders up to their free backpack slots.
3. They travel across the city to complete each order.
4. Each completed order earns **Delivery Points** (the reward share) and **Coins** (the shop currency).
5. Coins and GAME are spent on upgrades and cosmetics. Ranks rise with total deliveries.

### 3.1 Order types

| Type | Flow | Completes when |
|---|---|---|
| **Drop-off** | Package leaves the HUB → POI | The player enters the POI zone |
| **Pick-up** | Go to the POI, collect the package → HUB | The player enters the HUB drop zone carrying it |
| **Chain** (Pro rank) | Collect at POI A → deliver to POI B → return to the HUB | The player enters the HUB drop zone |

### 3.2 Order modifiers

A modifier can be added to a Drop-off or Pick-up order.

| Modifier | Rule | Unlocked at |
|---|---|---|
| **Express** | Has a timer: `1.5 × (route distance ÷ base sprint speed) + 10 s`. Delivering in time earns a bonus. Delivering late still completes the order, without the bonus. | Courier |
| **Fragile** | Earns a bonus if delivered intact. A fall of more than 7 m, being hit by another player, or an out-of-bounds respawn cancels the bonus. The order itself is never lost. | Rookie |
| **Heavy** | Takes 2 backpack slots and reduces jump height by 10% while carried. Earns a bonus. Offered only to players whose backpack has 2 or more slots. | Rookie |

**Order distances.** An order's distance band (§3.4, §5.3) uses the one-way path distance from the HUB to its POI. The **route distance** is the full trip the order needs: HUB → POI for a Drop-off, HUB → POI → HUB for a Pick-up. The Express timer and the minimum plausible time (§10) use the route distance.

### 3.3 Order Board

- Each player has their own board, so players never compete for the same order.
- The board shows **6 orders** and refreshes every **60 seconds**. Accepted orders leave the board and are replaced at the next refresh.
- Orders can only be **accepted** at the HUB.
- Orders can only be **cancelled** at the HUB. Cancelling starts a **30-second cooldown** before new orders can be accepted.
- The order mix is weighted by rank. Express and Chain orders appear only once they are unlocked.

### 3.4 Points and Coins per order

| Component | Delivery Points | Coins |
|---|---|---|
| Short (path < 150 m) | 1 | 10 |
| Medium (150–350 m) | 2 | 20 |
| Long (> 350 m) | 3 | 30 |
| Chain (flat) | 4 | 40 |
| Express, on time | +1 | +10 |
| Fragile, intact | +1 | +10 |
| Heavy | +1 | +10 |

Every value in this table is a tuning value stored in config.

## 4. Movement

All movement code lives in the shared package. It runs on a fixed **30 Hz** simulation step on both client and server, and rendering interpolates between steps. The values below are starting points, stored in config.

| Move | Behavior |
|---|---|
| Run / sprint | Base sprint speed 8 m/s, sprint held with Shift. No stamina. |
| Jump | About 1.2 m high. Coyote time 100 ms, jump buffer 100 ms. |
| Mantle | Automatically climbs ledges up to 1.5 m high. |
| Crouch-slide | Triggered while sprinting. Keeps speed and gains speed downhill. |
| Wall-run | Up to 1.5 s on a wall. A wall-jump chains to the next wall. |
| Zip line | Press E to attach. Momentum carries over when you jump off. |
| Jump pad | Launches the player along an authored vector. |
| Boost orb | +40% speed for 3 s. Orbs are **shared**: the first player to touch one takes it (the server decides ties), and it disappears for everyone in the room until it respawns 30 s later. |
| Slides (map) | Long low-friction chutes. |
| Grind rails | Usable on foot and on the skateboard. |
| Skateboard | Q to pull out or put away. Faster on flat ground and rails. Cannot wall-run or mantle. Getting hit knocks the player off the board. |
| Speed cap | Horizontal speed is capped at 18 m/s. |

**Momentum rule:** chaining moves preserves horizontal speed, up to the speed cap.

**Input layer:** raw input (keys and mouse, later touch) is mapped to actions: `move`, `look`, `jump`, `crouch`, `sprint`, `interact`, `hit`, `board`. Gameplay code only reads actions.

## 5. City and POIs

### 5.1 Layout

The city is about 600 × 600 m. A skilled runner crosses it in roughly 75 s. Water and cliffs form the outer boundary.

| District | Main features |
|---|---|
| **Central Plaza (HUB)** | Order board, shop, drop zone, combat safe zone |
| **Downtown Rooftops** | Tall blocks, rooftop gaps, wall-run alleys, jump pads |
| **Harbor Docks** | Cranes and containers, long zip lines, water edge |
| **Hillside** | Steep streets, long slides downhill, stairs and jump pads uphill |
| **Suburbs & Skatepark** | Wide roads, rails, ramps |

Falling into water or out of bounds respawns the player at the nearest checkpoint. They keep their packages, but Fragile bonuses are lost.

### 5.2 How the map is built

- **Placement file** (`map/city.json`): lists the asset-pack pieces and their transforms, plus gameplay objects (zip lines, jump pads, orbs, slides, rails, checkpoints) and about **150 POI candidates**. Each POI candidate has an id, position, district and kind (door, mailbox, counter, balcony).
- **Navmesh:** generated at build time with `recast-navigation`. Jump pads, zip lines and mantle-able ledges are added as off-mesh links, so the navmesh represents the base movement kit with no upgrades.
- **Generated POI table:** the build computes each candidate's path distance from the HUB and checks it is reachable. Unreachable candidates fail the build.
- **Debug view:** an in-game overlay shows POIs, their distances and band colors, and any unreachable spots.

### 5.3 POI selection rules

| Rule | Value |
|---|---|
| Distance bands (one-way path distance from the HUB) | Short < 150 m, Medium 150–350 m, Long > 350 m |
| Reachability | Only candidates that pass the build-time check are used |
| Spread | No two of a player's active orders within 40 m of each other |
| Reuse | The same POI is not reused within 3 minutes for the same player |
| District balance | Board generation favors districts the player has not been sent to recently |

## 6. Progression and economy

### 6.1 Ranks

Ranks are based on total completed orders. A Chain order counts as one.

| Rank | Deliveries | Unlocks |
|---|---|---|
| Rookie | 0 | Short, Medium and Long orders; Fragile and Heavy modifiers |
| Courier | 25 | Express modifier |
| Pro | 100 | Chain orders |
| Legend | 300 | Legend outfit and nameplate (cosmetic only) |

### 6.2 Token upgrades

These are paid by burning GAME at a fixed USD price. Ownership is recorded on-chain against the wallet and is permanent. Tiers must be bought in order.

| Upgrade | Tiers | Effect (starting values) |
|---|---|---|
| Backpack | 2 → 3 → 4 → 5 slots (4 purchases) | More concurrent orders. The base is 1 slot. |
| Shoes | 5 tiers | +3.5% sprint speed per tier, plus small jump and slide gains. Fully maxed is about +17.5%. |
| Skateboard | Buy the board, then 3 tiers | Base board top speed 12 m/s. Each tier adds top speed and turning, up to 15 m/s. |
| Premium board skins | Individual items (up to 64) | Cosmetic only |

USD prices are set in the program's settings by the admin multisig.

### 6.3 Coin purchases

Coins are off-chain, stored in the database, and cannot be traded or withdrawn.

| Item | Tiers | Effect |
|---|---|---|
| Gloves | 3 | Faster zip line and mantle. Hit cooldown 5 s → 4 s → 3 s. |
| GPS Watch | 2 | Tier 1: improved waypoint line. Tier 2: boost orbs shown on the minimap. |
| Cosmetics | — | Outfits, trails, emotes, backpack skins, basic board skins |

### 6.4 USD pricing mechanism

This applies to everything bought with GAME (§6.2) and to valuing locked GAME (§6.5).

- Each GAME-priced item has `usd_price` (6 decimals) stored on-chain.
- The **price keeper** computes a **30-minute average** GAME→USD rate (the GAME/AMZNx pool average × the AMZNx/USD average) and posts it every few minutes.
- At purchase time: `game_to_burn = usd_price ÷ rate`.
- **Safety limits (enforced on-chain):**
  - The rate must be younger than 15 minutes; otherwise purchases fail.
  - A single update may change the rate by at most 20%.
  - The buyer passes `max_game`, and the purchase fails if `game_to_burn > max_game`.
- The shop displays both values, for example "$10 ≈ 41,250 GAME", updated live.
- The keeper reads the bonding-curve price before GAME graduates and the PumpSwap pool price after.

### 6.5 Lock-to-boost

Players can lock GAME in the reward program to multiply the Delivery Points that count toward their epoch payout. Locked GAME is **not burned**; it is returned in full on unlock.

- **Valued in USD** with the §6.4 rate at each epoch's settlement, so the same dollar amount always gives the same bonus.
- **Curve (diminishing returns):** `bonus = 30% × √(min(locked USD, $1,500) ÷ $1,500)`

  | Locked value | Bonus |
  |---|---|
  | $15 | +3.0% |
  | $150 | +9.5% |
  | $375 | +15.0% |
  | $1,500 or more | +30.0% (cap) |

- **Warm-up:** newly locked GAME starts counting **24 hours** after deposit. Each new deposit restarts the warm-up timer for the not-yet-active amount only.
- **Unlocking:** the player requests an unlock. That amount stops counting **immediately** and can be withdrawn after a **7-day cooldown**. Unlock requests take from the warming amount first, then from the active amount.
- **Scope:** the multiplier applies only to the reward share. Ranks use base points.
- **Custody:** locked GAME sits in a program-owned vault, separate from the AMZNx reward vault. No admin instruction can move it. The emergency pause can temporarily stop withdrawals, but can never redirect funds.
- All values (30% cap, $1,500 cap, 24 h, 7 days) are program config, changeable by the admin multisig.

## 7. Multiplayer and combat

### 7.1 Rooms and networking

- Each city room holds **24 players**. Matchmaking fills the fullest room that has space and opens new rooms on demand.
- Epochs are **global**: points from every room count toward the same epoch.
- Clients send **inputs only**. The server simulates at 30 Hz and is authoritative.
- The local player uses client-side prediction with reconciliation. Remote players are interpolated about 100 ms behind.
- **Reconnects:** a player who reconnects within 60 s keeps their active orders. After 60 s, the orders are cancelled with no penalty.

### 7.2 Combat

| Rule | Value |
|---|---|
| Hit | Left click, 2.5 m range, frontal cone |
| Effect | Knockback impulse plus a 1.75 s stun. The stunned player can look around but not move. |
| Cooldown | 5 s (reduced by Gloves to 4 s, then 3 s) |
| Stun immunity | 4 s after a stun ends |
| Safe zone | No hits inside the HUB plaza |
| Zip line / skateboard | A hit knocks the target off |
| Fragile | Being hit cancels the target's Fragile bonuses; orders are never lost |
| Lag compensation | The server rewinds targets up to 150 ms to validate hits |

**Visible to other players:** outfit, nameplate, rank badge and the packages on the backpack.

## 8. Wallet and accounts

- **Sign-in:** the player connects a wallet through the Solana Wallet Adapter / Wallet Standard. Phantom, Solflare and OKX Wallet are listed explicitly. The player signs a Sign-In With Solana message containing a server nonce. The server verifies it and issues a session token bound to the wallet.
- **The wallet is the account.** Coins, ranks, cosmetics and Delivery Points are keyed by wallet address.
- **On-chain actions from the client:** buying upgrades and skins, locking, unlocking, withdrawing and claiming rewards. All are signed by the player's wallet.
- **Server sync:** the server reads each player's on-chain upgrade and lock accounts when they join and subscribes to changes. Purchases take effect only after they are confirmed on-chain.

## 9. Reward program (Solana, Anchor)

### 9.1 Funding

- GAME launches on Pump.fun as a Custom Pair quoted in AMZNx, so creator fees accrue in AMZNx.
- Pump.fun's creator fee sharing splits the fees: by default **80% to the reward vault PDA** and **20% to the team wallet** (configured on Pump.fun).
- **Warning:** Pump.fun allows only one post-launch change to the fee recipients, after which the setting is permanently locked. The program must be audited and deployed, and its vault address final, **before** the fee configuration is set.

### 9.2 Accounts

| Account | Contents |
|---|---|
| `Config` | Admin (multisig), server key, keeper key, GAME mint, AMZNx mint, payout fraction (default 10%), price limits, lock settings (§6.5), pause flags, USD prices of upgrades and premium skins |
| `Vault` | PDA-owned AMZNx token account; tracks `reserved` (allocated but not yet claimed) |
| `LockVault` | PDA-owned GAME token account holding all locked GAME |
| `Rate` | GAME→USD rate and last-updated timestamp |
| `Epoch` (latest) | Epoch number, Merkle root of cumulative totals, allocation |
| `Claimed` (per wallet) | Total AMZNx already claimed |
| `Upgrades` (per wallet) | Backpack tier, shoes tier, board tier (0 = not owned), premium skin bitset |
| `Lock` (per wallet) | `active`, `warming`, `warming_since`, `unlocking`, `unlock_at` |

### 9.3 Instructions

| Instruction | Signer | Behavior |
|---|---|---|
| `harvest` | Anyone | Claims accrued Pump.fun creator fees into the vault through a CPI, with the vault PDA as signer. The only destination is the vault. |
| `settle_epoch` | Server key | Takes `(epoch_number, merkle_root, allocation)`. Requires `epoch_number = last + 1` and `allocation ≤ payout_fraction × (vault balance − reserved)`. Stores the root and increases `reserved`. |
| `claim` | Player | Takes `(cumulative_amount, proof)`. Verifies the leaf `(wallet, cumulative_amount)` against the latest root, pays `cumulative_amount − claimed`, and updates `Claimed` and `reserved`. |
| `buy_upgrade` | Player | Takes `(upgrade, tier_or_skin, max_game)`. Checks pause, rate freshness, tier order (or that the skin isn't already owned), computes `game_to_burn`, burns the player's GAME and records the purchase, all in one instruction. |
| `lock` | Player | Moves GAME into `LockVault` and adds it to `warming` (restarting `warming_since`). |
| `request_unlock` | Player | Moves an amount from `warming`, then `active`, to `unlocking`, and sets `unlock_at = now + 7 days`. |
| `withdraw` | Player | After `unlock_at`, returns the `unlocking` GAME to the player's own wallet. |
| `update_rate` | Keeper key | Updates the rate within the change-cap limit. |
| `update_config` / `set_pause` | Admin multisig | Changes settings and keys, and pauses or unpauses actions. |

### 9.4 Epoch settlement (off-chain part)

1. Epochs are aligned to wall-clock 10-minute boundaries (UTC). A delivery belongs to the epoch in which the server recorded it.
2. At the boundary, the settler triggers `harvest`, reads the vault, and computes `allocation = payout_fraction × unreserved`.
3. The settler reads every `Lock` account and the current `Rate`. Each player's effective locked GAME is `active`, plus `warming` if `warming_since + 24 h` is at or before the epoch end. That amount is converted to USD and gives the bonus from §6.5.
4. **Weighted points** = base points × (1 + bonus). Each player's share is `allocation × weighted_points ÷ total_weighted_points`, rounded down. Points held for review (see §10) are excluded.
5. Each share is added to the player's **cumulative total**. The settler builds a Merkle tree of `(wallet, cumulative_total)` over all players ever paid, stores the tree in Postgres, and calls `settle_epoch`.
6. If no points were earned, the epoch settles with allocation 0.
7. If submission fails, the settler retries. Missed epochs are settled in order, each using the lock state and rate recorded at its own boundary.

Players fetch their proof from the game server's API, then call `claim`.

### 9.5 Guarantees

- No epoch can allocate more than the payout fraction of the unreserved balance.
- Epochs cannot be skipped or settled twice.
- Reserved AMZNx is never re-allocated.
- Claims are idempotent. Cumulative totals make double payment impossible.
- A purchase burns GAME and records the upgrade or skin in one instruction, so the buyer always gets both or neither.
- Locked GAME can only ever return to the wallet that locked it. No admin instruction can move it.
- **Admin key:** a Squads 2-of-3 multisig.

## 10. Anti-cheat

| Layer | Mechanism |
|---|---|
| Server authority | The client sends only inputs; the server simulates all movement. |
| Delivery validation | The player must be inside the POI or HUB zone on the server. Each order has a minimum plausible time: `route distance (§3.2) ÷ max legal speed × 0.8`. Faster deliveries are rejected and flagged. |
| Behavior flags | Repeated identical routes, overly regular input timing, many wallets per IP. Flagged players' points are held. |
| Review | An admin page lists held points. Approved points are added to the current open epoch; rejected points are discarded. |
| Per-wallet epoch cap | Available in config, **off by default** |

No system fully stops a well-built bot that genuinely plays the game. These layers raise the cost and make bots detectable.

## 11. HUD and UI

- **HUD:** active orders with waypoints and distances, Express timers, Coins, epoch countdown, current-epoch points and share %, lock bonus %, claimable AMZNx with a Claim button.
- **HUB screens:**
  - Order Board
  - Shop: Coins tab; Token tab (upgrades and premium skins) with USD and GAME prices
  - Lock panel: locked value, current bonus, warm-up and unlock timers, a preview of the bonus for a given amount
  - Wardrobe
  - Epoch leaderboard
- **Feedback:** hit impact effects and sound; a stun tumble with stars over the head; delivery-complete popups showing points and Coins.

## 12. System architecture

```
delivery-maxing/
  packages/
    shared/    movement sim, order rules, POI selection, combat rules, config types
    client/    Three.js + Vite: rendering, input layer, HUD/UI, wallet
    server/    Colyseus rooms, auth, Postgres access, epoch settler, admin page
    keeper/    price keeper service
  programs/
    rewards/   Anchor program
  config/      tuning JSON (movement, orders, prices, combat, economy)
  map/         city.json placement file, generated POI table and navmesh
  assets/      CC0 models and textures
```

- **Package manager:** pnpm workspaces.
- **Database tables:** `players`, `deliveries`, `epochs`, `epoch_points`, `cumulative_rewards`, `merkle_trees`, `flags`.
- **Data flow:**
  - Inputs go from client to server.
  - The server sends state snapshots back to clients.
  - Each completed delivery is written to Postgres immediately.
  - The settler reads Postgres and writes epoch results on-chain.
  - Clients read on-chain state for claims, upgrades and locks, and the server subscribes to those accounts.

## 13. Error handling

| Failure | Behavior |
|---|---|
| Wallet rejects or fails a transaction | A clear message is shown. Nothing is charged and nothing is granted. |
| Purchase or lock transaction pending | The upgrade, skin or lock appears in-game only after on-chain confirmation. |
| Withdraw attempted before the cooldown ends | Rejected on-chain. The Lock panel shows the time remaining. |
| Claim fails | Safe to retry. |
| Settlement fails | Points stay in Postgres. The settler retries and settles missed epochs in order. |
| Rate is stale | The shop shows "Prices updating, purchases paused." |
| Harvest fails | Retried before the next epoch. Fees wait at Pump.fun. |
| Server crashes | Completed deliveries are already saved. Active orders are restored when the player reconnects. |

## 14. Testing

- **Shared logic:** Vitest unit tests for movement, orders, POI selection, points, upgrade stats and combat timings.
- **Reward program:** Anchor tests on a local validator covering every guarantee in §9.5, plus a stale-rate pause, the change cap, the emergency pause, wrong-signer rejection, and the lock warm-up, unlock and withdraw timings.
- **Settler math:** unit tests for the lock bonus curve and weighted shares, including rounding and the zero-points case. Then a full devnet rehearsal with mock GAME and AMZNx mints.
- **Pump.fun harvest:** a standalone devnet/mainnet-fork spike, done before the rest of the program is built on it.
- **Server:** simulated rooms filled with bot clients; anti-cheat tests that feed impossible inputs and expect rejection.
- **Client:** a Playwright smoke test (load, sign in with a mock wallet, run, deliver). Performance target: 60 fps on a mid-range laptop.
- **Release gates:** a playtest at the end of each sub-project, and a professional audit of the reward program before mainnet.

## 15. Sub-projects and build order

Each sub-project gets its own implementation plan.

| # | Sub-project | Done when |
|---|---|---|
| 1 | **Movement + delivery loop** | Single-player greybox city. Full movement kit on the shared fixed-step sim. HUB, Order Board, all order types and modifiers with about 20 POIs. Points and Coins tracked locally. Playtest confirms movement is fun. |
| 2 | **City map + POI system** | Five districts built from CC0 packs, about 150 POIs, navmesh build step, POI selection rules, debug view, 60 fps target met. |
| 3 | **Upgrades, shop, ranks** | Ranks, Coin shop, Gloves, GPS Watch, cosmetics, token upgrades, premium skins and Lock panel, all wired to a mock on-chain source. |
| 4 | **Multiplayer + combat** | Colyseus rooms, prediction and interpolation, shared boost orbs, wallet sign-in, Postgres persistence, combat, anti-cheat layer, reconnects. |
| 5 | **Reward program + launch** | Harvest spike, Anchor program (pool, upgrades, locks), price keeper, epoch settler with lock bonus, claim UI, devnet rehearsal, audit, then mainnet and the Pump.fun launch. |

**Sub-project 1 note:** the navmesh arrives in sub-project 2. Until then, path distance is the street-grid distance `|dx| + |dz|` measured on the greybox city's street grid.

## 16. Risks, legal and open items

**Risks and legal:**
- **Eligibility:** AMZNx is a tokenized certificate available only to eligible participants, and some jurisdictions (including the US) are restricted. A geo-block or eligibility policy for claims is needed. Get legal advice; this spec is not legal advice.
- **Real-value rewards:** paying rewards funded by token trading fees may be regulated as securities, gambling or another category depending on the country. Get legal advice before launch.
- **Lock-to-boost:** locking a token to increase a real-money payout can be treated like staking for yield in some jurisdictions. Include it in the legal review.
- **Custody:** the program holds both the AMZNx pool and players' locked GAME, which makes it a high-value target. The audit must cover the lock vault.
- **Branding:** no Amazon name, logo or trade dress in the game. Courier branding is fictional.

**Open items to verify:**
- Confirm AMZNx is offered in Pump.fun's Custom Pair selector.
- Confirm that a program PDA can be a creator-fee recipient and can claim through a CPI, for both bonding-curve and PumpSwap fees. This is the first task of sub-project 5.
- Choose the creator fee percentage at launch (Pump.fun allows 0.05%–1%).
- Set the USD price of each token upgrade and premium skin before launch.

**Not in v1 (later ideas):** mobile touch controls, per-route daily speed boards, Rush Hour events, billboard rentals, private rooms.

**Considered and rejected:** VIP levels based on spending or holdings (too pay-to-win), holder badges (replaced by locking), race wagers (gambling risk), Courier Pass, rotating premium shop and limited drops, crews, gifting (too much for v1).
