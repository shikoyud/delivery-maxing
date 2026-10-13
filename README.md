# Delivery Maxing

A third-person, low-poly parkour courier game for the browser. You run, slide,
zip-line and skate across a fictional city delivering packages. All names and
places are invented; no real brands are used.

Status: sub-project 2 (SP2), a single-player 2 × 2 km city with five districts,
about 150 delivery spots and street thieves, on top of the SP1 movement and
delivery loop. There are no blockchain or token features yet.

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
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e
```

To test the build exactly as it is served on GitHub Pages, also set
`PAGES_BASE=/delivery-maxing/`.

## Playtest

Play the latest build at <https://shikoyud.github.io/delivery-maxing/>.

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the page to lock the pointer) |
| Space | Jump |
| Shift | Toggle sprint |
| C | Crouch; crouch-slide while sprinting |
| E | Interact (zip line, Order Board at the HUB kiosk) |
| Q | Skateboard |
| Left mouse | Hit (does nothing until SP4) |
| F3 | Toggle the stats overlay |
| F4 | Toggle the map debug view (POIs, distances, bands, chunks, thieves) |
| `` ` `` (backtick) | Open the dev panel |

In short: Shift toggles sprint, C crouch/slide, Space jump, E interact, Q board.
Points, Coins and the current epoch's points persist in your browser's
localStorage.

### URL options

| Option | Effect |
| --- | --- |
| `?map=city` | The SP2 city (the default) |
| `?map=greybox` | The SP1 greybox city |
| `?perf=1` | Runs the 60 s performance flythrough and shows frame-time results (PASS = p95 ≤ 18 ms) |
| `?debug` | Turns on the debug hooks and overlay |
| `?seed=N` | Seeds the Order Board (default: the current time) |

Options combine, e.g. `?map=city&perf=1`.

## City map and assets (SP2)

The city is generated, and every generated file is committed, so `pnpm dev`
and `pnpm e2e` need no build step beyond `pnpm install`.

```bash
pnpm assets:build  # converts the committed CC0 source packs in assets/source/
                   # into the runtime models in assets/city/ (outputs are committed)
pnpm map:build     # map/city.source.json -> map/city.json, city.poi.json, city.navmesh.bin
pnpm map:check     # regenerates the map files, byte-compares them with the
                   # committed ones and validates them (part of pnpm check and CI)
```

Run `pnpm map:build` after changing `map/city.source.json`, `map/pieces.json`
or the generator, and commit its outputs. Asset sources and licenses are listed
in `assets/CREDITS.md`.

### One-time Pages setup

1. Make the repository public.
2. Settings → Pages → Source = "GitHub Actions".
3. Settings → Environments → `github-pages` → Deployment branches: include
   `sp1/movement-delivery-loop` and `sp2/city-map-poi`.

Every push to `main`, `sp1/movement-delivery-loop` or `sp2/city-map-poi` then
builds, tests and deploys the client.
