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
