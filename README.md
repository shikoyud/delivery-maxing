# Delivery Maxing

A third-person, low-poly courier game for the browser. You take food and
package orders on your phone, run them from pickup to dropoff across a
fictional city, and earn Delivery Points and Coins. All names and places are
invented; no real brands or delivery apps are used.

Status: sub-project 3 (SP3), the core loop rework: single player on the
greybox map, on foot. Offers arrive on the phone, you accept one, pick it up
and deliver it before its timer runs out. You spawn and respawn at the nearest
hospital, whose safe zone is marked on the HUD. Vehicles arrive in SP4. There
are no blockchain or token features yet.

There is no HUB and no Order Board any more: every order starts as an offer on
the phone, and there are no parkour props (wall-runs, zip lines, rails, pads)
in the city.

## Local development

Requires Node 22 (see `.nvmrc`) and pnpm (version pinned by `packageManager`).

```bash
pnpm install
pnpm dev      # Vite dev server for the client
pnpm check    # lint + typecheck + unit tests
pnpm e2e      # builds the client, then runs the Playwright tests
```

In a sandbox with a preinstalled Chromium, point Playwright at it:

```bash
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e
```

To test the build exactly as it is served on GitHub Pages, also set
`PAGES_BASE=/delivery-maxing/`.

## Playtest

The GitHub Pages build at <https://shikoyud.github.io/delivery-maxing/> is
deployed only from `main` and `sp1/movement-delivery-loop`, so it does not
have SP3 yet. Until SP3 (branch `sp3/core-loop-rework`) is merged into `main`,
play it locally:

```bash
git checkout sp3/core-loop-rework
pnpm install && pnpm dev   # then open the URL Vite prints
```

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the page to lock the pointer) |
| Space | Jump; climb onto ledges up to chest height |
| C | Crouch; crouch-slide while sprinting |
| Shift | Sprint on / off (toggle) |
| E | Interact |
| F | Mount (reserved for vehicles in SP4; does nothing yet) |
| Q | Skateboard |
| Tab | Phone: Orders, Map, Wallet (Esc or Tab closes it) |
| Y | Accept the top offer |
| F3 | Toggle the debug overlay |
| `` ` `` (backtick) | Open the dev panel |

On foot you carry one order at a time and no packages; new offers only arrive
while you have a free slot. Cancelling an order on the phone blocks new offers
for 45 s.

### Dev capacity preset

Until vehicles exist (SP4), the dev panel (backtick) has a **Capacity (dev,
until SP4)** select that switches your carrier tier: walk, skateboard,
bicycle, motorbike or car. The tier sets your slots and the package weight you
can take (`config/vehicles.json`), so package offers only appear on the
motorbike and car presets. The switch is refused, with a warning, while your
accepted orders would not fit the new tier. **Reset progress** zeroes your
totals and puts the tier back to walk.

Add `?debug=1` to the URL to turn on the debug hooks and overlay.
Points, Coins, deliveries and the capacity tier persist in your browser's
localStorage. Add `?seed=N` to make the offer stream reproducible.

### One-time Pages setup

1. Make the repository public.
2. Settings → Pages → Source = "GitHub Actions".
3. Settings → Environments → `github-pages` → Deployment branches: include
   `sp1/movement-delivery-loop`.

Every push to `main` or `sp1/movement-delivery-loop` then builds, tests and
deploys the client.
