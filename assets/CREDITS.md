# Asset credits

Assets are either CC0 (Kenney, Quaternius) or the owner's licensed Unity Asset Store packs listed below. List each asset's source and license here.

| File | Asset | Author | License | Source |
|---|---|---|---|---|
| `models/RobotExpressive.glb` | Robot Expressive (the courier) | Tomás Laulhé (Quaternius); modifications by Don McCurdy | CC0 1.0 (public domain dedication) | https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/models/gltf/RobotExpressive/RobotExpressive.glb (three.js repository, `examples/models/gltf/RobotExpressive/`) |

The file is committed unchanged. At runtime the game recolours its orange body material to the courier teal (fictional
courier branding, spec §16) and uses its Idle, Walking, Running and Jump clips.

Everything else in the SP1 greybox is built in code.

SP4 adds no asset files: the skateboard, bicycle, motorbike and car, the two gas stations and the access-zone overlay
are code-built placeholders (`packages/client/src/render/vehicles/`, `gasStationMeshes.ts`, `accessZoneMeshes.ts`)
until the owner supplies models.

## Owner-licensed packs (not in git)

| Folder | Asset | Author / store | License | Source |
|---|---|---|---|---|
| `assets/packs/megatropolis */`, `assets/packs/tropical city */` | Low Poly Asset Bundle (Megatropolis and Tropical City packs), converted to `.glb` with glTFast | Unity Asset Store, purchased by the project owner | Unity Asset Store EULA, Standard license, **Single Entity** seat. The packs may be shipped inside the game (deployed bundle) but their source files may not be redistributed, so they are **git-ignored** (`assets/packs/`) and never committed to this public repository. Contractors need their own seat. | https://assetstore.unity.com/packages/3d/environments/low-poly-asset-bundle-196214 |

The catalog of these models is `map/catalog.json`; see `docs/superpowers/specs/2026-10-14-city-map-design.md`.

| Model | Used as | Source | License |
|---|---|---|---|
| `mega/Car_01` (`assets/packs/megatropolis vehicles/Car_01.glb`) | The player's car (Decision 11), 1:1, placed by its catalog pivot on the car's feet; the code-built car is drawn when it is missing | Low Poly Asset Bundle (above) | Owner-licensed, not in git |

**Runtime folder.** `pnpm assets:import assets/packs` writes the models the city uses (every catalog entry with a file
whose `use` is not `unused`) into `packages/client/public/packs/`, quantised and meshopt-compressed, with `.lod1.glb`
files, the two pack textures (`textures/`) and `manifest.json`. That folder is derived from the packs, so it is
**git-ignored** too and never committed; Vite copies it into the build, so a deployed bundle built with it contains the
models. Without it the build has no model files and the city draws every lot as a category-coloured box.
