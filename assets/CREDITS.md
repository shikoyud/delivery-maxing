# Asset credits

Only CC0 assets (Kenney, Quaternius) may be used. List each asset's source and license here.

| File | Asset | Author | License | Source |
|---|---|---|---|---|
| `models/RobotExpressive.glb` | Robot Expressive (the courier) | Tomás Laulhé (Quaternius); modifications by Don McCurdy | CC0 1.0 (public domain dedication) | https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/models/gltf/RobotExpressive/RobotExpressive.glb (three.js repository, `examples/models/gltf/RobotExpressive/`) |

The file is committed unchanged. At runtime the game recolours its orange body material to the courier teal (fictional
courier branding, spec §16) and uses its Idle, Walking, Running and Jump clips.

## SP2 source packs (`assets/source/`)

These files are committed unchanged, exactly as distributed. The user downloaded them from quaternius.com and supplied
them for SP2 (2026-10-13). The SP2 asset pipeline converts them into the game's runtime models; each runtime file
will be listed here as it is added.

All files below: author **Quaternius** (https://quaternius.com, https://www.patreon.com/quaternius); license
**CC0 1.0 Universal (Public Domain Dedication)**, https://creativecommons.org/publicdomain/zero/1.0/ (the pack's own
`License.txt` is kept next to the files).

| Folder | Pack | Files |
|---|---|---|
| `source/quaternius/ultimate-textured-building-pack/buildings/` | Ultimate Textured Building Pack (Dec 2019), `Textured Models/Finished Textured Buildings/FBX` | `1Story`, `1Story_GableRoof`, `1Story_RoundRoof`, `1Story_Sign`, `2Story`, `2Story_2`, `2Story_Balcony`, `2Story_Center`, `2Story_Columns`, `2Story_Double`, `2Story_GableRoof`, `2Story_RoundRoof`, `2Story_Sidehouse`, `2Story_Sign`, `2Story_Slim`, `2Story_Stairs`, `2Story_Wide`, `2Story_Wide_2Doors`, `3Story_Balcony`, `3Story_Slim`, `3Story_Small`, `4Story`, `4Story_Center`, `4Story_Wide_2Doors`, `4Story_Wide_2Doors_Roof`, `6Story_Stack` (`.fbx`) |
| `source/quaternius/ultimate-textured-building-pack/parts/` | Ultimate Textured Building Pack (Dec 2019), `Textured Models/Base Modular Parts/FBX` | `AC_Unit`, `AC_Unitx4`, `Balcony`, `Bricks_Half`, `Bricks_Large`, `Bricks_LeftStraight`, `Bricks_RightStraight`, `Bricks_Single`, `Bricks_Small`, `Door1`–`Door5`, `Door_Double`, `Door_Window`, `Door_Window2`, `Pipe_L`, `Pipe_Straight`, `Pipe_Straight_Short`, `Sign_Bakery`, `Sign_Barbershop`, `Sign_Bookshop`, `Sign_Hardware`, `Sign_Pharmacy`, `Staircase`, `Stairs_Roof`, `Window`, `Window_Double`, `Window_Double_Roof`, `Window_Roof` (`.fbx`) |
| `source/quaternius/ultimate-textured-building-pack/textures/` | Ultimate Textured Building Pack (Dec 2019), `Textured Models/Textures` | `Texture_Blue`, `Texture_Dark`, `Texture_DarkBlue`, `Texture_DarkPurple`, `Texture_Green`, `Texture_Grey`, `Texture_Light`, `Texture_Light2`, `Texture_Red`, `Texture_Signs`, `Texture_Yellow` (`.png`, 32 × 32 palettes) |
| `source/quaternius/animated-men/` | Animated Men Characters (Feb 2019), `FBX` | `Male_Casual`, `Male_LongSleeve` (`.fbx`, with the pack's Idle, Walk, Run and Punch clips among others) |

Left out on purpose: the pack's casino sign (`CasinoSign.fbx`) and casino palette (`Texture_Casino.png`). The game
pays real-value rewards, so it avoids gambling imagery. The Downtown City MegaKit (Standard) was also supplied but is
not used in SP2: its photoreal PBR style doesn't match the low-poly look. It also costs about 18,000 triangles and 13
materials per building, roughly 3× the low-poly pack.
