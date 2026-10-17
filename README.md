# Delivery Maxing

A third-person, low-poly courier game for the browser. You take food and
package orders on your phone, run them from pickup to dropoff across a
fictional city, and earn Delivery Points and Coins. All names and places are
invented; no real brands or delivery apps are used.

Status: sub-project 5 (SP5), City v2: single player in the 1.2 × 1.2 km
terraced bay city (four levels joined by switchback roads, steep lanes and
stairs; about 2,600 buildings, four hospitals, six gas stations), on foot or
on a skateboard, bicycle, motorbike or car. Offers arrive on the phone, you
accept one, pick it up and deliver it on foot before its timer runs out; every
pickup and dropoff is a named business or household with a street address.
You spawn and respawn at the nearest hospital, whose safe zone is marked on the
HUD. There are no blockchain or token features yet.

The city is the default map. `?map=greybox` loads the SP4 greybox test town
instead (kept for its vehicle tests); progress is saved per map. Without the
owner's model packs (below) every building is drawn as a box coloured by its
category, which is what the GitHub Pages build shows.

There is no HUB and no Order Board any more: every order starts as an offer on
the phone, and there are no parkour props (wall-runs, zip lines, rails, pads)
in the city.

## Local development

Requires Node 22 (see `.nvmrc`) and pnpm (version pinned by `packageManager`).

```bash
pnpm install
pnpm dev      # Vite dev server for the client
pnpm check    # lint + typecheck + unit tests + map:check
pnpm e2e      # builds the client, then runs the Playwright tests
```

In a sandbox with a preinstalled Chromium, point Playwright at it:

```bash
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm e2e
```

To test the build exactly as it is served on GitHub Pages, also set
`PAGES_BASE=/delivery-maxing/`.

## Playtest

Play the GitHub Pages build at <https://shikoyud.github.io/delivery-maxing/>,
which is deployed from `main`. To play the current `main` locally instead:

```bash
git checkout main
pnpm install && pnpm dev   # then open the URL Vite prints
```

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the page to lock the pointer) |
| Space | Jump; climb onto ledges up to chest height. On a vehicle: handbrake |
| C | Crouch; crouch-slide while sprinting |
| Shift | Sprint on / off (toggle); drains the stamina ring top left. Unused on a vehicle |
| E | Hold at a gas pump, stopped on the motorbike or car, to refuel (Coins) |
| F | Get on the nearest parked vehicle (within 2.5 m), else put the skateboard down and ride it; F again gets off |
| Tab | Phone: Orders, Map, Garage (Summon), Wallet, Settings (Respawn) (Esc, Tab or M closes it). On a vehicle only when stopped |
| M | Map view (the phone opened straight on the Map app) |
| Y | Accept the top offer |
| F3 | Toggle the debug overlay |
| F4 | Toggle the map debug view (city): lot ids and roles within 80 m, distance bands, chunks, access zones |
| `` ` `` (backtick) | Open the dev panel |

Your slots and the package weight you can take follow the vehicle you ride, or
last rode (`config/vehicles.json`): one order and no packages on foot or on the
skateboard, packages only on the motorbike and car. Every pickup and hand-over
is on foot: get off at the door. New offers only arrive while you have a free
slot. Cancelling an order on the phone blocks new offers for 45 s.

### Vehicles

All four vehicles are yours from the start (the shop comes in SP6): the
bicycle, motorbike and car wait in the bay beside the first hospital (Bayview
General in the city) and the skateboard is carried. Cars stay out of alleys,
steep lanes, stairs and paths. Holding S while stopped reverses the car; the
bicycle and motorbike turn round toward it first, and back up at walking pace
only while a wall stops the turn. The Map app and minimap mark hospitals, gas
stations and your parked vehicles. On `?map=greybox` the test town has a steep
lane, stairs, a park path, a boardwalk and two gas stations to try them on.
The dev panel (backtick) has
an **Owned** box per vehicle, **Fill all tanks**, **+500 coins** and **Reset
progress** (zero totals, every vehicle back in the bay).

Add `?debug=1` to the URL to turn on the debug hooks and overlay.
Points, Coins, deliveries, your vehicles and the last ride persist in your
browser's localStorage, one save per map: the city starts fresh, and an SP4
save stays with `?map=greybox`. Add `?seed=N` to make the offer stream reproducible.

### Frame-rate check (`?perf=1`)

`?perf=1` flies the camera over the city for 60 s (eight viewpoints from
`config/perf.json`, 7.5 s each) and then shows a result panel: PASS when the
p95 frame time is 16.7 ms or less, the draw calls and triangles per viewpoint
against the budgets (200 calls, 700 k triangles), and the city and pack-model
counts. Input is ignored during the run; keep the tab in front. It only runs
on the city: with `?map=greybox` it logs a warning and is ignored.

1. With the packs in `assets/packs/`: `pnpm assets:import assets/packs`, then
   `pnpm dev` (or `pnpm build && pnpm --filter @dm/client preview`).
2. Open the printed URL with `?perf=1` appended, e.g.
   `http://localhost:5173/?perf=1`, in a normal (not
   headless) browser window at the size you play at.
3. When the panel appears, press **Copy result** and paste the JSON into the
   thread (it records the GPU, screen, pixel ratio and every number above).

`&seconds=5` shortens the run (a quick smoke check; too few frames for a
verdict); with `&debug=1` the result is also on `window.__dm.perfResult()`.

### One-time Pages setup

1. Make the repository public.
2. Settings → Pages → Source = "GitHub Actions".
3. Settings → Environments → `github-pages` → Deployment branches: include
   `sp1/movement-delivery-loop`.

Every push to `main` or `sp1/movement-delivery-loop` then builds, tests and
deploys the client.

### Asset packs and catalog tools

The city's buildings come from the owner's licensed Megatropolis and Tropical
City packs (`assets/CREDITS.md`). They are never committed: unpack them into
the git-ignored `assets/packs/` with their original folder names, then run
`pnpm assets:import assets/packs`, which writes the runtime models (compressed,
with LOD1 files and a manifest) into `packages/client/public/packs/` and a copy
of the manifest into `packages/client/src/packs/`, both git-ignored. Rebuild or
restart `pnpm dev` afterwards. Without that folder the
game makes no model requests, logs one "pack models not installed" warning and
draws boxes.

`map/catalog.json` lists every model of the packs.
`pnpm assets:check [folder]` compares it with the packs: missing, extra, empty and resized models. It exits 1 on
a placed entry that is missing, empty or grew by more than 0.5 m, and prints `assets:check: packs folder not found`
(exit 1) where the packs are absent. `pnpm assets:sheet` renders each placed building from its `front` side into
`docs/playtest/sp5/sheet-<category>.png` (needs the packs and Chromium via `PW_CHROMIUM_PATH`; the PNGs are not committed),
so a building whose door is not on its `+z` side can be given a `front` override in `map/catalog.json` by hand.
