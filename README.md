# Delivery Maxing

A first-person, low-poly parkour courier game for the browser. You run, slide,
zip-line and skate across a fictional city delivering packages. All names and
places are invented; no real brands are used.

Status: sub-project 1 (SP1), a single-player greybox of the movement and
delivery loop. SP1 has no blockchain or token features.

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

Play the latest build at <https://shikoyud.github.io/delivery-maxing/>.

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the page to lock the pointer) |
| Space | Jump |
| Shift | Sprint |
| C | Crouch; crouch-slide while sprinting |
| E | Interact (zip line, Order Board at the HUB kiosk) |
| Q | Skateboard |
| Left mouse | Hit (does nothing until SP4) |
| F3 | Toggle the debug overlay (arrives in Task 19) |
| `` ` `` (backtick) | Open the dev panel (arrives in Task 19) |

Add `?debug=1` to the URL to turn on the debug hooks and overlay.
Points and Coins persist in your browser's localStorage.

### One-time Pages setup

1. Make the repository public.
2. Settings → Pages → Source = "GitHub Actions".
3. Settings → Environments → `github-pages` → Deployment branches: include
   `sp1/movement-delivery-loop`.

Every push to `main` or `sp1/movement-delivery-loop` then builds, tests and
deploys the client.
