# PIZZERIA ROADRASH — Pre-Production Asset Audit

**Date:** 2026-09-26 · **Scope:** every file under `G:\Pizzeria Roadrash\Assets` (26 files, all `.glb`) · **Phase:** audit only. No game code was written.

**Method (read-only).**

- **Parser:** a custom Python/NumPy glTF parser read each GLB's JSON and binary chunks. It decoded every accessor and applied node transforms and skinning in the default pose to get world bounds. It also counted connected components, hashed vertex data to find duplicates, and decoded headers for all 403 embedded images. Every image was also fully decoded with Pillow, and all decoded.
- **Blender:** Blender 5.2.1 LTS imported each GLB into an empty scene. It never saved or exported anything. It rendered orthographic front/side/top views plus a perspective view, and 8–10 frame strips for animated assets.
- **Textures:** embedded textures were copied out to a temporary folder to be looked at.
- **Integrity:** the SHA-256 of all 26 source files was recorded before and after. **All 26 hashes are identical, so no source asset was modified.**

**Conventions.**

- "VERIFIED FACT" means measured from the files or seen in a render. "RECOMMENDATION" is advice for later phases and has not been done.
- Coordinates are glTF world space after all node transforms, with +Y up. glTF units are metres by spec, but the real unit differs per asset, so it is stated for each one.
- GPU texture memory is estimated as width × height × 4 bytes × 4/3 (RGBA8 plus mipmaps, uncompressed). Actual memory depends on the engine and on compression.
- `UNKNOWN` or `NOT DETERMINABLE` means the files don't contain the information.

---

## 1. Executive summary

### VERIFIED FACT

1. **All 26 files are valid glTF 2.0 binaries (GLB)** exported from Sketchfab. All parse, and all import into Blender. Textures are embedded. No file contains cameras, lights (`KHR_lights_punctual`), audio, Draco or meshopt compression, or KTX2 textures.
2. **Total footprint:**
   - About 1.05 GB on disk (1,050,404,120 bytes).
   - 8.32 M triangles.
   - About 6.8 GB of estimated uncompressed GPU texture memory.

   Two files dominate texture memory: Times Square (about 1.96 GB, including four 8192² images) and After the rain (about 1.6 GB, 172 images).
3. **Riders (Characters): only one is rigged.** `tron_uprising_blackguard.glb` has a 66-joint Mixamo skeleton in a T-pose. The other four riders are **static meshes with no skeleton**, and two of them are sculpted in non-bind poses. None of the rider files has a riding, attack, kick, crash, or remount animation.
4. **Audience:** three of the five are rigged: `cyberpunk_character` (56 joints), `readyplayerme_cyberpunk` (66, Mixamo-style names) and `rigged_female_fashion_character_in_ruffle_dress` (66, Mixamo). The only real motion clip among them is a 16.6 s standing idle on the ruffle-dress character. `female.glb` is a static T-posed mesh with **1.97 M triangles**.
5. **Bikes:**
   - **BMW S1000RR:** a bone-driven rig with separate wheel, fork (about 23° rake), handlebar and swingarm bones.
   - **Honda PCX:** separate front and rear wheel groups with centred pivots, plus a wheel-spin clip. It is a scooter.
   - **TRON light cycle:** tire, handle and hood bones.
   - **Hover bike:** has no wheels. Rigid parts are animated by an idle clip.
   - **Monobike:** one node, and its wheel is not a separate node. The tyre and rim are separable connected islands. It also **requires** the spec-gloss material extension.
6. **Times Square is the only asset with a usable, separate road surface.**
   - **Road mesh:** one flat mesh (`Object_32`) has roadway at y≈0 and sidewalks raised about 0.009 units with curb faces.
   - **Layout:** one main east-west road (about 29.7 × 1.13 units), 6 north-south cross streets and a diagonal spur.
   - **No loop:** there is **no closed loop**, because every road runs off the map edge.
   - **Merged buildings:** everything else is merged by material across the whole scene, so individual buildings can't be loaded or culled separately.
   - **Scale:** the scene is a miniature (about 30 × 20 × 16 units).
7. **Race starter (Cyborg Oni):**
   - **Rig:** 98 joints, including fingers, head, eyes, hair, wings and sword bones.
   - **Clip `clip` (6.333 s):** a verified fly-in, then a crouched landing, then standing, then an arm-raise gesture, then a sword-extended pose.
   - **Clip `pose`:** a static pose.
8. **Weather:** neither file contains particles, animated rain, puddle geometry or water surfaces.
   - `rain_drops_circles…glb` is a static 84-triangle rig: vertical rain-streak planes, a ripple normal map, and a clearcoat ground quad.
   - `after_the_rain…glb` is a wet cobbled European street, 962k triangles. It **requires** the spec-gloss material extension with no fallback.
9. **Zabimaru** is modelled in its **extended** whip form. It has 6 physically separate blade segments stored as disconnected islands in 2 merged primitives under one node, with no bones or animation. Expanding it needs segment splitting.
10. **Material compatibility risk:** 3 files declare `KHR_materials_pbrSpecularGlossiness` as *required* and have no metallic-roughness fallback: the monobike, the scifi girl, and After the rain. Current three.js removed support for this extension in r147, so these would render without their textures unless converted.
11. **Licences recorded in the asset metadata:**
    - 6 assets are non-commercial: CC-BY-NC-SA (BMW, scifi girl, female_character, Ready Player Me) and CC-BY-NC (machete, After the rain).
    - The rest are CC-BY-4.0.
    - Times Square billboards contain **real trademarks**.
    - Several models depict third-party IP (TRON, Bleach, BMW, Honda).

### RECOMMENDATION (headline)

- Treat Times Square's road mesh as the base for the track, and treat its buildings and billboards as heavy set dressing. The texture set must be reduced before any mobile target.
- Build a shared humanoid animation set around a Mixamo-compatible skeleton. Blackguard, Ready Player Me and the ruffle dress already match that naming. Rig the static riders before they can be selected.
- Plan procedural and shader VFX for all rain, puddle, splash and screen-water effects. The supplied weather assets only provide textures and reference looks.

---

## 2. Asset inventory

Figures are verified. Tris and draws are summed over every mesh instance in the default scene; draw calls are unbatched primitives.

| # | Logical ID | Source path | Size (MB) | Tris | Draws | Mats | Images (max res) | Est. GPU tex (MB) | Rigged | Clips | Class |
|---|---|---|---:|---:|---:|---:|---|---:|---|---:|---|
| 1 | `AUDIENCE_01_CYBERPUNK_CHARACTER` | `Assets/Audience/cyberpunk_character.glb` | 74.94 | 24,500 | 9 | 4 | 7 (4096) | 597.3 | yes | 1 | PASS WITH OPTIMIZATION |
| 2 | `AUDIENCE_02_FEMALE_TRIPO` | `Assets/Audience/female.glb` | 116.46 | 1,970,634 | 18 | 1 | 3 (8192) | 512.0 | no | 0 | UNSUITABLE AS-IS |
| 3 | `AUDIENCE_03_FEMALE_CHARACTER_HORNED` | `Assets/Audience/female_character.glb` | 13.07 | 25,575 | 2 | 1 | 4 (2048) | 85.3 | no | 0 | HIGH RISK |
| 4 | `AUDIENCE_04_READYPLAYERME_CYBERPUNK` | `Assets/Audience/readyplayerme_cyberpunk.glb` | 5.35 | 18,509 | 10 | 9 | 19 (1024) | 49.0 | yes | 0 | PASS WITH OPTIMIZATION |
| 5 | `AUDIENCE_05_RUFFLE_DRESS_FEMALE` | `Assets/Audience/rigged_female_fashion_character_in_ruffle_dress.glb` | 36.42 | 442,569 | 5 | 1 | 3 (2048) | 64.0 | yes | 1 | HIGH RISK |
| 6 | `BIKE_01_BMW_S1000RR` | `Assets/Bikes/bmw_s1000_rr.glb` | 26.42 | 313,174 | 117 | 74 | 57 (1024) | 32.7 | yes | 0 | PASS WITH OPTIMIZATION |
| 7 | `BIKE_02_HONDA_PCX` | `Assets/Bikes/honda_pcx.glb` | 15.75 | 463,852 | 118 | 32 | 5 (1024) | 14.7 | no | 2 | PASS WITH OPTIMIZATION |
| 8 | `BIKE_03_HOVER_ROCKET` | `Assets/Bikes/hover_bike_-_the_rocket.glb` | 39.02 | 25,246 | 10 | 1 | 4 (4096) | 341.3 | yes | 1 | PASS WITH OPTIMIZATION |
| 9 | `BIKE_04_MONOBIKE_DRAGONSEEKER` | `Assets/Bikes/monobike_-_toriyama_dragonseeker.glb` | 36.97 | 47,422 | 2 | 2 | 9 (2048) | 192.0 | no | 0 | HIGH RISK |
| 10 | `BIKE_05_TRON_LIGHT_CYCLE` | `Assets/Bikes/tron_uprising_-_argoncity_light_cycle.glb` | 1.82 | 34,808 | 8 | 8 | 1 (512) | 1.3 | yes | 1 | PASS |
| 11 | `RIDER_01_CAT_EARS` | `Assets/Characters/cat_ears_biker_girl.glb` | 2.52 | 54,000 | 2 | 2 | 2 (1024) | 10.7 | no | 0 | UNSUITABLE AS-IS |
| 12 | `RIDER_02_FUTURISTIC_BIKER` | `Assets/Characters/futuristic_biker_character.glb` | 5.17 | 45,946 | 7 | 6 | 4 (2048) | 85.3 | no | 0 | UNSUITABLE AS-IS |
| 13 | `RIDER_03_SCIFI_GIRL` | `Assets/Characters/scifi_girl_v.01.glb` | 24.32 | 326,973 | 17 | 12 | 17 (1024) | 69.7 | no | 0 | UNSUITABLE AS-IS |
| 14 | `RIDER_04_TRON_CHARACTER` | `Assets/Characters/tron_character.glb` | 2.88 | 27,760 | 1 | 1 | 4 (4096) | 277.3 | no | 0 | HIGH RISK |
| 15 | `RIDER_05_TRON_BLACKGUARD` | `Assets/Characters/tron_uprising_blackguard.glb` | 13.1 | 80,734 | 5 | 4 | 12 (2048) | 128.0 | yes | 1 | PASS WITH OPTIMIZATION |
| 16 | `CITY_01_CYBERPUNK_SKYLINE` | `Assets/City/cyberpunk_city.glb` | 119.21 | 1,788,188 | 68 | 18 | 8 (1024) | 12.2 | no | 0 | HIGH RISK |
| 17 | `CITY_02_CYBERPUNK_DIORAMA` | `Assets/City/cyberpunk_city_-_1.glb` | 4.21 | 64,171 | 30 | 30 | 0 (-) | 0.0 | no | 0 | PASS |
| 18 | `CITY_03_POST_APOCALYPTIC` | `Assets/City/post-apocalyptic_city.glb` | 65.6 | 278,820 | 8 | 4 | 10 (2048) | 213.3 | no | 0 | PASS WITH OPTIMIZATION |
| 19 | `CITY_CORE_TIMES_SQUARE` | `Assets/City/times square.glb` | 156.59 | 1,257,909 | 68 | 16 | 12 (8192) | 1962.7 | no | 0 | HIGH RISK |
| 20 | `RACE_STARTER_CYBORG_ONI` | `Assets/Race starter/cyborg_oni.glb` | 15.12 | 34,042 | 10 | 9 | 31 (2048) | 437.3 | yes | 2 | PASS WITH OPTIMIZATION |
| 21 | `WEAPON_01_MACHETE` | `Assets/Weapons/free_realistic_modern_machete_with_uv_low-poly.glb` | 3.87 | 3,066 | 1 | 1 | 3 (2048) | 64.0 | no | 0 | PASS WITH OPTIMIZATION |
| 22 | `WEAPON_02_MORNING_STAR` | `Assets/Weapons/morning_star_low_poly.glb` | 2.47 | 4,708 | 1 | 1 | 3 (1024) | 16.0 | yes | 0 | PASS WITH OPTIMIZATION |
| 23 | `WEAPON_03_KATANA` | `Assets/Weapons/no_name_-_katana.glb` | 0.67 | 11,582 | 30 | 5 | 0 (-) | 0.0 | no | 1 | PASS WITH OPTIMIZATION |
| 24 | `WEAPON_04_ZABIMARU` | `Assets/Weapons/zabimaru_v2_-_bleach.glb` | 6.29 | 9,646 | 2 | 2 | 8 (1024) | 42.7 | no | 0 | PASS WITH OPTIMIZATION |
| 25 | `WEATHER_01_AFTER_THE_RAIN` | `Assets/Weather/after_the_rain..._-_vr__sound.glb` | 206.49 | 962,642 | 134 | 71 | 172 (2048) | 1600.3 | no | 0 | UNSUITABLE AS-IS |
| 26 | `WEATHER_02_RAIN_DROPS_CIRCLES` | `Assets/Weather/rain_drops_circles__download__like_please.glb` | 7.0 | 84 | 3 | 3 | 5 (1024) | 18.7 | no | 0 | PASS WITH OPTIMIZATION |

**Footprint by category (verified):**

| Category | Files | Size (MB) | Triangles | Est. GPU tex (MB) | Draw calls |
|---|---:|---:|---:|---:|---:|
| Audience | 5 | 246.2 | 2,481,787 | 1,307.6 | 44 |
| Bikes | 5 | 120.0 | 884,502 | 582.0 | 255 |
| Characters | 5 | 48.0 | 535,413 | 571.0 | 32 |
| City | 4 | 345.6 | 3,389,088 | 2,188.2 | 174 |
| Race starter | 1 | 15.1 | 34,042 | 437.3 | 10 |
| Weapons | 4 | 13.3 | 29,002 | 122.7 | 34 |
| Weather | 2 | 213.5 | 962,726 | 1,619.0 | 137 |
| **Total** | **26** | **1,001.7** (1.05 GB decimal) | **8,316,560** | **6,827.8** | **686** |

---

## 3. Per-file forensic results

### AUDIENCE_01_CYBERPUNK_CHARACTER — `Assets/Audience/cyberpunk_character.glb`

**VERIFIED FACT**

- File: `cyberpunk_character.glb` · 78,584,864 bytes (74.94 MB) · SHA-256 `d2f3e41be8ee3d02…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-15.42.0` · extensionsUsed ['KHR_materials_specular'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 85 · mesh nodes (objects) 9 · meshes 9 · primitives 9 · vertices 17,222 · triangles 24,500 · draw calls (unbatched) 9
- Materials 4 (emissive 0, non-opaque 2; material extensions ['KHR_materials_specular']) · textures 7 · images 7 (all embedded: True) · resolutions 4096x4096 png · image bytes 73.42 MB · est. GPU 597.3 MB
- Bounding box size [0.9627, 3.0215, 0.661] (min [-0.3847, 0.011, -0.3283], max [0.578, 3.0325, 0.3327]) · up +Y · forward: -Z (Blender render from +Z side showed the model's back) (confidence medium)
- Scale: Standing height ~3.02 units (feet ~0.01, top ~3.03). If 1 unit = 1 m this is ~1.7x human scale.
- Skins: 56 joints used by 6 mesh nodes · default pose: arms down ~73 deg below horizontal (node default pose); a 0-second clip named 'A-pose' also exists
- Morph targets: none · cameras 0 · lights 0
- Animations: `A-pose` 0.0 s (94 channels, 55 target nodes, paths {'rotation': 41, 'translation': 53})
- Visual inspection: Male figure in black jacket/trousers with helmet-like head covering and one cybernetic arm (visual check of Blender render).
- Verified capabilities: Loads in glTF parser and Blender; Skinned humanoid, 56 joints, 6 skinned mesh nodes; Full finger bones; Clip 'A-pose' (0 s static pose)
- Limitations: No locomotion/idle animation - only a 0 s pose clip; 7 x 4096x4096 textures (~597 MB GPU uncompressed) for a 24.5k-tri crowd character; Non-standard bone names; Scale ~3 units tall

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Geometry is light (24.5k tris, 9 draws) but texture set is 7x4096^2 (~597 MB RGBA8+mips); must be reduced/compressed before use, especially on mobile.

**RECOMMENDATION:** role — Crowd/audience NPC (rigged; needs external idle animation or static pose). Preprocessing — Texture downscale + KTX2/Basis compression; Uniform scale to target height; Bone-name retarget map for shared crowd animations.

### AUDIENCE_02_FEMALE_TRIPO — `Assets/Audience/female.glb`

**VERIFIED FACT**

- File: `female.glb` · 122,112,844 bytes (116.46 MB) · SHA-256 `4e80b54646a638a1…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-17.17.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 22 · mesh nodes (objects) 18 · meshes 18 · primitives 18 · vertices 1,161,827 · triangles 1,970,634 · draw calls (unbatched) 18
- Materials 1 (emissive 0, non-opaque 0; material extensions none) · textures 3 · images 3 (all embedded: True) · resolutions 4096x4096 jpeg, 4096x4096 png, 8192x8192 jpeg · image bytes 14.1 MB · est. GPU 512.0 MB
- Bounding box size [0.2031, 0.9806, 0.9408] (min [-0.1009, -0.4902, -0.4707], max [0.1022, 0.4904, 0.4702]) · up +Y · forward: +X (render: profile visible from front camera, face toward +X) (confidence medium)
- Scale: Height ~0.98 units (T-pose arm span ~0.94 along Z).
- Skins: none · pose: T-pose (static mesh)
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Photoreal-style female in black crop top/shorts, sneakers, T-pose; generated mesh (node/material names 'tripo_...').
- Verified capabilities: Loads; Static mesh (no skin, no animations)
- Limitations: 1,970,634 triangles in 18 mesh chunks (65k-vertex split) - extremely heavy; Static T-pose; no rig; 8192x8192 base colour + 2 x 4096 maps (~512 MB GPU); Single material, textures baked (no garment separation)

**CLASSIFICATION:** UNSUITABLE AS-IS — ~2M triangles and an 8192^2 texture for a single static background figure; a T-posed static mesh also cannot read as a natural crowd member without rigging.

**RECOMMENDATION:** role — Not recommended for runtime without heavy decimation (>=50x) and auto-rigging; possibly unused. Preprocessing — Mesh decimation; Texture downscale (8192 exceeds MAX_TEXTURE_SIZE on many mobile GPUs); Auto-rig or re-pose; Uniform scale.

### AUDIENCE_03_FEMALE_CHARACTER_HORNED — `Assets/Audience/female_character.glb`

**VERIFIED FACT**

- File: `female_character.glb` · 13,707,252 bytes (13.07 MB) · SHA-256 `1f11170c3ae12ce9…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-12.63.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-NC-SA-4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
- Scenes 1 · nodes 4 · mesh nodes (objects) 2 · meshes 2 · primitives 2 · vertices 15,873 · triangles 25,575 · draw calls (unbatched) 2
- Materials 1 (emissive 1, non-opaque 1; material extensions none) · textures 4 · images 4 (all embedded: True) · resolutions 2048x2048 png · image bytes 12.05 MB · est. GPU 85.3 MB
- Bounding box size [1.9792, 2.7179, 0.742] (min [-0.9896, -1.0305, -0.6259], max [0.9896, 1.6874, 0.1161]) · up +Y · forward: +Z (confidence medium)
- Scale: Height ~2.72 units including horns.
- Skins: none · pose: A-pose-like, arms spread downward (static)
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Stylised female with horns, braids, open long coat, platform shoes; A-pose-like stance (static).
- Verified capabilities: Loads; Static mesh, 25.6k tris, 2 draws, 1 material
- Limitations: No rig/animation; Its only material is alphaMode BLEND (whole character transparent-sorted); Static A-pose looks unnatural in a crowd; Licence CC-BY-NC-SA-4.0

**CLASSIFICATION:** HIGH RISK — Light geometry but whole-body BLEND material causes sorting/overdraw issues and the static A-pose requires rigging or re-posing to be usable.

**RECOMMENDATION:** role — Distant/static crowd filler only after re-posing, or unused. Preprocessing — Change alpha mode to OPAQUE/MASK if texture alpha permits (inspect); Re-pose or auto-rig; Uniform scale.

### AUDIENCE_04_READYPLAYERME_CYBERPUNK — `Assets/Audience/readyplayerme_cyberpunk.glb`

**VERIFIED FACT**

- File: `readyplayerme_cyberpunk.glb` · 5,613,180 bytes (5.35 MB) · SHA-256 `cde6cd4d6a92a5b6…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-12.65.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-NC-SA-4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
- Scenes 1 · nodes 91 · mesh nodes (objects) 10 · meshes 10 · primitives 10 · vertices 11,685 · triangles 18,509 · draw calls (unbatched) 10
- Materials 9 (emissive 1, non-opaque 1; material extensions none) · textures 19 · images 19 (all embedded: True) · resolutions 1024x1024 jpeg, 1024x1024 png, 128x128 jpeg, 128x128 png, 1x1 jpeg, 256x256 jpeg, 256x256 png, 512x512 jpeg, 512x512 png · image bytes 4.22 MB · est. GPU 49.0 MB
- Bounding box size [0.7663, 1.8873, 0.4329] (min [-0.385, 0.0012, -0.2334], max [0.3813, 1.8885, 0.1995]) · up +Y · forward: +Z (confidence medium-high)
- Scale: Height ~1.89 units; consistent with metres. Feet at y~0.
- Skins: 66 joints used by 10 mesh nodes · default pose: arms down ~66 deg below horizontal
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Male avatar with pink mohawk, fur-collared vest, purple trousers, cyber arm; arms-down rest pose.
- Verified capabilities: Loads; Skinned humanoid 66 joints, 10 skinned meshes; Separate materials per body part (Body, Outfit Top/Bottom/Footwear, Hair, Skin, Eye, Glass); Light: 18.5k tris, ~49 MB textures; Metre-like scale
- Limitations: No animation clips; Licence CC-BY-NC-SA-4.0

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Light geometry and textures; only needs compressed textures and shared animations; 10 draw calls per instance.

**RECOMMENDATION:** role — Primary rigged crowd NPC template (best crowd candidate). Preprocessing — Optional: KTX2 textures, merge draws for crowd.

### AUDIENCE_05_RUFFLE_DRESS_FEMALE — `Assets/Audience/rigged_female_fashion_character_in_ruffle_dress.glb`

**VERIFIED FACT**

- File: `rigged_female_fashion_character_in_ruffle_dress.glb` · 38,193,600 bytes (36.42 MB) · SHA-256 `4aabf51a770f8bc7…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-17.15.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 78 · mesh nodes (objects) 5 · meshes 5 · primitives 5 · vertices 268,096 · triangles 442,569 · draw calls (unbatched) 5
- Materials 1 (emissive 1, non-opaque 0; material extensions none) · textures 3 · images 3 (all embedded: True) · resolutions 2048x2048 jpeg, 2048x2048 png · image bytes 8.04 MB · est. GPU 64.0 MB
- Bounding box size [0.7403, 1.8981, 0.4304] (min [-0.3727, -0.9508, -0.2156], max [0.3676, 0.9473, 0.2148]) · up +Y · forward: +Z (confidence medium)
- Scale: Height ~1.90 units; origin at mid-body (feet at y~-0.95), NOT at feet.
- Skins: 66 joints used by 5 mesh nodes · default pose: arms down ~76 deg below horizontal
- Morph targets: none · cameras 0 · lights 0
- Animations: `mixamo.com` 16.6333 s (90 channels, 52 target nodes, paths {'translation': 38, 'rotation': 52})
- Visual inspection: Female in ruffle-collar fitted dress, heels; arms-down pose; idle animation.
- Verified capabilities: Loads; Skinned 66-joint Mixamo rig; Clip 'mixamo.com' 16.633 s - visually a subtle standing idle / weight shift (8 sampled frames)
- Limitations: 442,569 triangles (very heavy for a crowd member); Origin at mid-body; Single material/atlas

**CLASSIFICATION:** HIGH RISK — 442k skinned triangles per instance is far beyond crowd budgets; needs weight-preserving decimation/LOD.

**RECOMMENDATION:** role — Crowd NPC after decimation; its idle clip is reusable for other Mixamo rigs. Preprocessing — Skinned-mesh decimation (preserve weights); Re-origin to feet (or offset at runtime); Texture compression.

### BIKE_01_BMW_S1000RR — `Assets/Bikes/bmw_s1000_rr.glb`

**VERIFIED FACT**

- File: `bmw_s1000_rr.glb` · 27,701,788 bytes (26.42 MB) · SHA-256 `5dbe5053d5c6c19a…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-0.13.0` · extensionsUsed ['KHR_materials_specular', 'KHR_materials_clearcoat', 'KHR_materials_emissive_strength'] · extensionsRequired [] · licence (asset extras): CC-BY-NC-SA-4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
- Scenes 1 · nodes 203 · mesh nodes (objects) 117 · meshes 117 · primitives 117 · vertices 264,698 · triangles 313,174 · draw calls (unbatched) 117
- Materials 74 (emissive 15, non-opaque 4; material extensions ['KHR_materials_clearcoat', 'KHR_materials_emissive_strength', 'KHR_materials_specular']) · textures 57 · images 57 (all embedded: True) · resolutions 1024x1024 png, 1024x512 png, 128x128 png, 16x16 png, 256x128 png, 256x256 png, 32x32 png, 4x4 png, 512x256 png, 512x512 png, 64x64 png · image bytes 2.07 MB · est. GPU 32.7 MB
- Bounding box size [0.9163, 1.3396, 2.3397] (min [-0.4482, -0.5097, -1.1805], max [0.4681, 0.8298, 1.1593]) · up +Y · forward: -Z (front wheel bone z=-0.848, rear z=+0.806) (confidence high)
- Scale: Length 2.34, height 1.34 units; root scale 1.1474 applied. A real S1000RR is ~2.07 m long, so the model is ~13% oversize if units are metres.
- Skins: 46 joints used by 113 mesh nodes
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Duplicate geometry: 1 group(s) of byte-identical vertex data stored more than once (e.g. ['Object_6', 'Object_7'], 803 tris each)
- Visual inspection: Detailed sport bike (fairing, exhaust, forks, discs, dash), no rider.
- bike.wheelsSeparate: Yes - skinned rigid parts driven by bones 'wheel_lf_23' (front) and 'wheel_lr_29' (rear)
- bike.wheelCentres: {'front': [-0.0017, -0.177, -0.8477], 'rear': [-0.0207, -0.1567, 0.8058]}
- bike.wheelRadiusApprox: 0.33
- bike.wheelbase: 1.654
- bike.groundY: -0.51
- bike.steering: Bones 'forks_u_25','forks_l_24' and 'handlebars_21' exist; fork bone axis tilted ~23 deg (rake) - steering by rotating fork/handlebar bones is feasible
- bike.suspension: 'forks_u/forks_l' (front) and 'swingarm_30' (rear) bones
- bike.seat: bone 'seat_32' at [-0.002,0.407,0.359]; 'seat_f_16' at [0,0.453,0.356]
- bike.handGrips: {'left': [-0.3659, 0.4426, -0.4384], 'right': [0.323, 0.4559, -0.4451]}
- bike.lights: bones 'headlight_l_14','headlight_r_15','brakelight_l_39'; 15 emissive materials (dials, lamps)
- bike.originNote: Origin ~0.51 above ground, near mid-chassis
- Verified capabilities: Loads; 46-joint skin drives 113 rigid part meshes (wheel/fork/handlebar/swingarm/seat bones); Wheel spin + steering via bone rotation feasible; Emissive lamp/dial materials; Paint material 'vehicle_generic_smallspecmap_PRIMARY' is a plain colour factor [0.7,0,0]
- Limitations: 313k tris, 117 primitives / draw calls, 74 materials; Uses KHR_materials_clearcoat/specular (engine support varies); Licence CC-BY-NC-SA-4.0; real-brand model

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Verified functional rig but 117 draw calls and 313k tris per bike; with up to 10 bikes this must be merged/decimated, particularly for mobile.

**RECOMMENDATION:** role — Selectable bike (visual model driven by invisible physics chassis). Preprocessing — Material/draw-call merging by bone; Decimation / LOD; Scale normalisation; Texture compression.

### BIKE_02_HONDA_PCX — `Assets/Bikes/honda_pcx.glb`

**VERIFIED FACT**

- File: `honda_pcx.glb` · 16,513,852 bytes (15.75 MB) · SHA-256 `02bec16a1ae52ea4…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-15.53.0` · extensionsUsed ['KHR_materials_transmission'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 225 · mesh nodes (objects) 118 · meshes 118 · primitives 118 · vertices 299,819 · triangles 463,852 · draw calls (unbatched) 118
- Materials 32 (emissive 0, non-opaque 8; material extensions ['KHR_materials_transmission']) · textures 5 · images 5 (all embedded: True) · resolutions 1024x1024 png, 512x512 jpeg, 512x512 png · image bytes 0.61 MB · est. GPU 14.7 MB
- Bounding box size [1.9109, 1.162, 0.7437] (min [-0.94, -0.0028, -0.3829], max [0.9709, 1.1591, 0.3609]) · up +Y · forward: +X (front wheel node 'Dianteira_46' at x=+0.715, rear 'Traseira_97' at x=-0.573) (confidence high)
- Scale: Length 1.91, height 1.16 units - matches the real PCX (~1.92 m); metres.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: `Animation` 10.0 s (5 channels, 5 target nodes, paths {'rotation': 5}); `banco.002Action` 0.8333 s (1 channels, 1 target nodes, paths {'rotation': 1})
- Duplicate geometry: 2 group(s) of byte-identical vertex data stored more than once (e.g. ['Object_16', 'Object_17'], 60 tris each)
- Visual inspection: Honda PCX step-through scooter (navy body, brown seat) - a scooter, not a sport motorcycle.
- bike.wheelsSeparate: Yes - node groups 'Dianteira_46' (front) and 'Traseira_97' (rear), pivots at wheel centres
- bike.wheelCentres: {'front': [0.7153, 0.2551, -0.0108], 'rear': [-0.5726, 0.2527, -0.0104]}
- bike.wheelRadiusApprox: 0.255
- bike.wheelbase: 1.288
- bike.steering: Handlebar meshes are separate sibling nodes ('BASE_*HandleBar*'), but there is no single steering/fork pivot node; a pivot would have to be created at runtime (re-parenting in the scene graph, not in the source)
- bike.suspension: Rear shock meshes exist visually; no suspension pivots identified
- bike.seat: Seat node 'banco.002_3' (hinge at [0.083,0.612,-0.011]); seat top y~0.80 spanning x -0.70..0.09
- bike.handGrips: {'approx': 'x~0.25-0.30, y~1.0-1.1, z~+/-0.30-0.38 (handlebar mesh extremes)'}
- bike.lights: Headlight/tail-light meshes (materials 'FarolPCX','LanternaPCX'); no emissive materials
- bike.originNote: Origin at ground level
- bike.animations: 'Animation' 10.0 s: both wheel groups rotate 3599 deg (10 revs) + whole bike sways 1 deg; 'banco.002Action' 0.833 s: seat hinges open 70 deg
- Verified capabilities: Loads; Separate front/rear wheel groups with centred pivots; Wheel-spin clip present; Real-world scale; Body paint 'Body' is a plain colour factor
- Limitations: 463,852 tris, 118 draw calls - heavy; No emissive lights; Scooter silhouette/seating differs from sport bikes; Uses KHR_materials_transmission

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Structure is ideal (wheel pivots, metre scale) but triangle and draw-call counts must be cut for 10-player/mobile use.

**RECOMMENDATION:** role — Selectable bike (scooter class). Preprocessing — Decimation + draw-call merging (keep wheel groups separate); Runtime steering pivot.

### BIKE_03_HOVER_ROCKET — `Assets/Bikes/hover_bike_-_the_rocket.glb`

**VERIFIED FACT**

- File: `hover_bike_-_the_rocket.glb` · 40,914,192 bytes (39.02 MB) · SHA-256 `f5ab1de65cf30598…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-15.50.0` · extensionsUsed ['KHR_materials_emissive_strength'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 46 · mesh nodes (objects) 10 · meshes 10 · primitives 10 · vertices 23,458 · triangles 25,246 · draw calls (unbatched) 10
- Materials 1 (emissive 1, non-opaque 0; material extensions ['KHR_materials_emissive_strength']) · textures 4 · images 4 (all embedded: True) · resolutions 4096x4096 png · image bytes 37.63 MB · est. GPU 341.3 MB
- Bounding box size [845.5087, 245.0058, 413.3998] (min [-401.8982, 17.0404, -206.6998], max [443.6105, 262.0462, 206.7001]) · up +Y · forward: +X (engine intake 'VentMain' at x~+385, wings at x~-300) (confidence medium - inferred from layout)
- Scale: 845.5 x 245 x 413 units; unit not determinable (if cm -> ~8.5 m long, very large for a bike). Lowest point is 17 units above origin (hovering).
- Skins: 18 joints used by 0 mesh nodes
- Morph targets: none · cameras 0 · lights 0
- Animations: `Armature|Idle` 1.9667 s (7 channels, 7 target nodes, paths {'rotation': 6, 'translation': 1})
- Visual inspection: Jet-engine hover bike: large front turbofan intake, open seat, rear wings/flaps; no wheels.
- bike.wheelsSeparate: No wheels (hover vehicle)
- bike.steering: No steering parts; wings/flaps are separate animated parts
- bike.seat: Seat region between engine and wings (not a named node)
- bike.lights: Single material 'Test' with emissive texture (strength 10)
- bike.originNote: Origin below the craft (craft floats 17 units above origin)
- bike.animations: 'Armature|Idle' 1.967 s: VentMain spins 360 deg, VentSub 720 deg, flaps/wings flutter 1-2 deg, Root bobs 0.2 units - loopable idle
- Verified capabilities: Loads; Rigid meshes parented under joint nodes (skin with 18 joints is unused by meshes, but node animation moves parts); Loopable idle animation with spinning fans; Very light geometry (25k tris, 10 draws)
- Limitations: 4 x 4096^2 textures (~341 MB GPU); Unit scale unknown; No rider grips/seat nodes

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Cheap geometry; textures must be reduced; scale must be normalised.

**RECOMMENDATION:** role — Selectable unconventional bike (hover). Preprocessing — Texture downscale/compression; Uniform scale; Rider mount calibration.

### BIKE_04_MONOBIKE_DRAGONSEEKER — `Assets/Bikes/monobike_-_toriyama_dragonseeker.glb`

**VERIFIED FACT**

- File: `monobike_-_toriyama_dragonseeker.glb` · 38,768,744 bytes (36.97 MB) · SHA-256 `f01229c48f9f78e3…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-12.67.0` · extensionsUsed ['KHR_materials_pbrSpecularGlossiness'] · extensionsRequired ['KHR_materials_pbrSpecularGlossiness'] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 5 · mesh nodes (objects) 2 · meshes 2 · primitives 2 · vertices 33,366 · triangles 47,422 · draw calls (unbatched) 2
- Materials 2 (emissive 1, non-opaque 0; material extensions ['KHR_materials_pbrSpecularGlossiness']) · textures 9 · images 9 (all embedded: True) · resolutions 2048x2048 jpeg, 2048x2048 png · image bytes 34.9 MB · est. GPU 192.0 MB
- Bounding box size [0.612, 0.9925, 1.1172] (min [-0.306, -0.0088, -0.732], max [0.306, 0.9836, 0.3852]) · up +Y · forward: +Z (handlebars/headlamp toward +Z in renders) (confidence medium)
- Scale: 0.61 x 0.99 x 1.12 units - small relative to other bikes; unit not determinable.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Toriyama-style monowheel: one large wheel enclosing engine, seat, round headlamp with kanji disc, rusty orange paint.
- bike.wheelsSeparate: Not as a node - whole bike is 2 primitives under one node. Connected-component analysis: primitive 2 contains the tyre as a separate island (5,395 verts, 0.086 x 0.77 x 0.77, centre [0,0.376,0]) and a rim ring island (diameter 0.642, same centre); so the wheel can be split by components (runtime or offline)
- bike.wheelCentres: {'single': [0.0, 0.376, 0.0]}
- bike.wheelRadiusApprox: 0.385
- bike.steering: No separate steering node (handlebar-sized islands exist)
- bike.lights: Emissive texture on material 'Monobike_U2'
- bike.originNote: Origin at ground
- Verified capabilities: Loads (Blender); Light geometry (47k tris, 2 draws)
- Limitations: extensionsRequired KHR_materials_pbrSpecularGlossiness with NO metal-rough fallback - current three.js (removed in r147) would render it untextured; No wheel node - wheel spin requires splitting the tyre/rim islands; 9 textures (2048) ~192 MB GPU

**CLASSIFICATION:** HIGH RISK — Material model is not renderable as authored in current three.js and the wheel is not a separate node (islands are separable).

**RECOMMENDATION:** role — Selectable unconventional bike only after spec-gloss->metal-rough conversion and wheel separation. Preprocessing — Convert spec-gloss to metallic-roughness; Split tyre+rim islands into a separate node pivoted at [0,0.376,0]; Texture compression; Scale calibration.

### BIKE_05_TRON_LIGHT_CYCLE — `Assets/Bikes/tron_uprising_-_argoncity_light_cycle.glb`

**VERIFIED FACT**

- File: `tron_uprising_-_argoncity_light_cycle.glb` · 1,903,880 bytes (1.82 MB) · SHA-256 `8cb3f8ae9c5000e6…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-16.95.0` · extensionsUsed ['KHR_materials_specular', 'KHR_materials_emissive_strength'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 35 · mesh nodes (objects) 8 · meshes 8 · primitives 8 · vertices 25,987 · triangles 34,808 · draw calls (unbatched) 8
- Materials 8 (emissive 2, non-opaque 1; material extensions ['KHR_materials_emissive_strength', 'KHR_materials_specular']) · textures 1 · images 1 (all embedded: True) · resolutions 512x512 png · image bytes 0.0 MB · est. GPU 1.3 MB
- Bounding box size [0.6734, 1.0236, 2.583] (min [-0.3367, 0.001, -1.2583], max [0.3367, 1.0246, 1.3247]) · up +Y · forward: +Z (Front_Tire_02 z=+0.936, Rear_Tire_04 z=-0.859) (confidence high)
- Scale: 2.58 x 1.02 x 0.67 units; plausible metres.
- Skins: 19 joints used by 8 mesh nodes
- Morph targets: none · cameras 0 · lights 0
- Animations: `Argon_LightCycle|Argon_LightCycleAction` 11.25 s (2 channels, 1 target nodes, paths {'scale': 1, 'rotation': 1})
- Visual inspection: TRON: Uprising light cycle - black body, orange-red glow strips, canopy, hubless-looking wheels.
- bike.wheelsSeparate: Yes - bones 'Front_Tire_02' and 'Rear_Tire_04' (plus 'Rear_Engine_03' co-located with rear tire)
- bike.wheelCentres: {'front': [0.0, 0.3905, 0.9358], 'rear': [0.0, 0.3852, -0.8591]}
- bike.wheelRadiusApprox: 0.39
- bike.wheelbase: 1.795
- bike.steering: No fork/steer bone; 'L_Handle_06'/'R_Handle_07' bones only
- bike.suspension: 'L_SpeedBrake_08','R_SpeedBrake_09','Hood_05' bones
- bike.seat: Rider sits under canopy ('Hood_05' at [0,0.857,-0.183]); prone riding position
- bike.handGrips: {'left': [0.2039, 0.7787, 0.7529], 'right': [-0.2039, 0.7787, 0.7529]}
- bike.lights: Emissive 'Glow' (orange-red, strength 4.37) and 'Headlights' (white, strength 10)
- bike.originNote: Origin at ground, centred
- bike.animations: 'Argon_LightCycle|Argon_LightCycleAction' 11.25 s: Rear_Engine_03 rotates ~3824 deg (~10.6 revs); scale track constant
- Verified capabilities: Loads; 19-joint skin with tire/handle/hood/speedbrake bones; Emissive glow material easily recoloured; Tiny file (1.8 MB), 34.8k tris, 8 draws
- Limitations: Prone riding pose differs from other bikes; IP: TRON is a Disney property (licence of the model is CC-BY-4.0 but the design is derivative)

**CLASSIFICATION:** PASS — Light geometry/texture, functional bones, emissive factors only.

**RECOMMENDATION:** role — Selectable bike (light cycle). Preprocessing — Orientation normalisation at load.

### RIDER_01_CAT_EARS — `Assets/Characters/cat_ears_biker_girl.glb`

**VERIFIED FACT**

- File: `cat_ears_biker_girl.glb` · 2,646,424 bytes (2.52 MB) · SHA-256 `dafc90c8e51c5488…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-16.8.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 6 · mesh nodes (objects) 2 · meshes 2 · primitives 2 · vertices 41,296 · triangles 54,000 · draw calls (unbatched) 2
- Materials 2 (emissive 0, non-opaque 0; material extensions none) · textures 2 · images 2 (all embedded: True) · resolutions 1024x1024 png · image bytes 0.64 MB · est. GPU 10.7 MB
- Bounding box size [0.9951, 2.8786, 0.894] (min [-0.4102, -0.0069, -0.5027], max [0.5849, 2.8717, 0.3913]) · up +Y · forward: +X (profile toward +X in front render) (confidence medium)
- Scale: Height ~2.88 units incl. helmet ears.
- Skins: none · pose: Posed (hands together in front of chest), not T/A pose
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Female biker in black leathers with yellow cat-ear helmet; standing with hands held together in front (not a bind pose).
- Verified capabilities: Loads; Static mesh 54k tris, 2 draws, 2 materials (mesh names 'Mesh_0010.rip' suggest a ripped game mesh)
- Limitations: No rig, no animations; Non-bind pose hampers auto-rigging; Cannot sit/ride/attack without rigging

**CLASSIFICATION:** UNSUITABLE AS-IS — A rider must sit, grip, swing and remount; a static posed mesh cannot do any of these without rigging and re-posing.

**RECOMMENDATION:** role — Selectable rider only after rigging (source provenance should also be checked). Preprocessing — Rigging (manual; auto-rig difficult due to pose); Uniform scale.

### RIDER_02_FUTURISTIC_BIKER — `Assets/Characters/futuristic_biker_character.glb`

**VERIFIED FACT**

- File: `futuristic_biker_character.glb` · 5,418,440 bytes (5.17 MB) · SHA-256 `375c2aadac42be0e…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-16.59.0` · extensionsUsed ['KHR_materials_specular'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 17 · mesh nodes (objects) 7 · meshes 7 · primitives 7 · vertices 27,681 · triangles 45,946 · draw calls (unbatched) 7
- Materials 6 (emissive 0, non-opaque 0; material extensions ['KHR_materials_specular']) · textures 4 · images 4 (all embedded: True) · resolutions 2048x2048 jpeg · image bytes 3.79 MB · est. GPU 85.3 MB
- Bounding box size [0.0202, 0.0526, 0.0111] (min [-0.0108, -0.0253, -0.005], max [0.0094, 0.0273, 0.0061]) · up +Y · forward: +Z (confidence medium)
- Scale: Height only ~0.053 units (tiny) - needs ~33x scale for 1.75 m.
- Skins: none · pose: Posed (hand on hip)
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Duplicate geometry: 1 group(s) of byte-identical vertex data stored more than once (e.g. ['Object_0', 'Object_6'], 17087 tris each)
- Visual inspection: Female biker, white jacket, black leather trousers, helmet with open visor, hand on hip.
- Verified capabilities: Loads; Static, 7 mesh nodes, 46k tris
- Limitations: No rig/animation; Two identical 17,087-tri body meshes at the same position (duplicate geometry / z-fighting); Tiny scale; Material names 'desirefx.me' (provenance)

**CLASSIFICATION:** UNSUITABLE AS-IS — Static posed mesh with duplicated body geometry; rider role needs rigging.

**RECOMMENDATION:** role — Selectable rider only after de-duplication and rigging. Preprocessing — Remove duplicate body mesh; Rigging; Scale x~33.

### RIDER_03_SCIFI_GIRL — `Assets/Characters/scifi_girl_v.01.glb`

**VERIFIED FACT**

- File: `scifi_girl_v.01.glb` · 25,505,476 bytes (24.32 MB) · SHA-256 `59453388b1d02323…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-12.67.0` · extensionsUsed ['KHR_materials_pbrSpecularGlossiness'] · extensionsRequired ['KHR_materials_pbrSpecularGlossiness'] · licence (asset extras): CC-BY-NC-SA-4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
- Scenes 1 · nodes 19 · mesh nodes (objects) 17 · meshes 17 · primitives 17 · vertices 465,309 · triangles 326,973 · draw calls (unbatched) 17
- Materials 12 (emissive 2, non-opaque 7; material extensions ['KHR_materials_pbrSpecularGlossiness']) · textures 17 · images 17 (all embedded: True) · resolutions 1024x1024 jpeg, 1024x1024 png, 256x256 png, 512x512 jpeg, 512x512 png · image bytes 5.26 MB · est. GPU 69.7 MB
- Bounding box size [1.6, 1.9331, 1.6] (min [-0.8, -0.0139, -0.8], max [0.8, 1.9192, 0.8]) · up +Y · forward: +X (profile in front render) (confidence medium)
- Scale: Height ~1.93 units (includes ground plane at y=-0.014).
- Skins: none · pose: Relaxed A-pose (static)
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: White-haired female in grey dress with lace/transparent overlay, A-pose-like; includes a 1.6x1.6 ground plane.
- Verified capabilities: Loads (Blender); Static, 17 meshes
- Limitations: extensionsRequired KHR_materials_pbrSpecularGlossiness, no metal-rough fallback; ~196k of 327k tris are six 65k-vertex BLEND meshes (material 'material') - heavy transparency; 7 transparent materials; No rig; Licence CC-BY-NC-SA-4.0

**CLASSIFICATION:** UNSUITABLE AS-IS — Unsupported material model in current three.js, heavy blended overdraw, no rig.

**RECOMMENDATION:** role — Rider only after conversion, transparency reduction and rigging. Preprocessing — Spec-gloss -> metal-rough; Remove ground plane; Reduce BLEND meshes; Rigging.

### RIDER_04_TRON_CHARACTER — `Assets/Characters/tron_character.glb`

**VERIFIED FACT**

- File: `tron_character.glb` · 3,018,592 bytes (2.88 MB) · SHA-256 `65344a3a84ffc937…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-12.66.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 5 · mesh nodes (objects) 1 · meshes 1 · primitives 1 · vertices 15,174 · triangles 27,760 · draw calls (unbatched) 1
- Materials 1 (emissive 1, non-opaque 0; material extensions none) · textures 4 · images 4 (all embedded: True) · resolutions 2048x2048 png, 4096x4096 png · image bytes 1.86 MB · est. GPU 277.3 MB
- Bounding box size [621.219, 929.4265, 139.7691] (min [-310.6095, -3.6081, -69.7396], max [310.6095, 925.8184, 70.0295]) · up +Y · forward: +Z (confidence low-medium)
- Scale: Height ~929 units (likely cm or mm); ~0.0019 scale for 1.75 m.
- Skins: none · pose: Arms out and slightly down (bind-like pose), static
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Black suit with white glowing circuit lines, helmet; A/T-like bind pose.
- Verified capabilities: Loads; Single static mesh 27.8k tris, 1 draw, emissive texture
- Limitations: No rig; 2048/4096 textures (~277 MB GPU); Scale; TRON IP

**CLASSIFICATION:** HIGH RISK — Geometry is clean and in a bind-like pose (good auto-rig candidate) but requires rigging before any rider use.

**RECOMMENDATION:** role — Selectable rider after auto-rigging. Preprocessing — Auto-rig (e.g. Mixamo-compatible); Scale; Texture compression.

### RIDER_05_TRON_BLACKGUARD — `Assets/Characters/tron_uprising_blackguard.glb`

**VERIFIED FACT**

- File: `tron_uprising_blackguard.glb` · 13,734,276 bytes (13.1 MB) · SHA-256 `c7b19ce31cdb6b1c…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-16.74.0` · extensionsUsed ['KHR_materials_specular'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 84 · mesh nodes (objects) 5 · meshes 5 · primitives 5 · vertices 69,110 · triangles 80,734 · draw calls (unbatched) 5
- Materials 4 (emissive 4, non-opaque 0; material extensions ['KHR_materials_specular']) · textures 12 · images 12 (all embedded: True) · resolutions 1024x1024 png, 2048x2048 png · image bytes 7.7 MB · est. GPU 128.0 MB
- Bounding box size [105.355, 1228.9086, 72.1315] (min [-89.5756, -1227.039, -3.2531], max [15.7794, 1.8696, 68.8784]) · up +Y · forward: +Z (confidence medium)
- Scale: Body mesh 'Object_7' is 1.87 units tall (metres-like). Whole-file bbox is 1,229 units tall because of displaced parts.
- Skins: 66 joints used by 5 mesh nodes · default pose: T-pose (upper arm 3.6 deg below horizontal)
- Morph targets: none · cameras 0 · lights 0
- Animations: `mixamo.com` 0.0 s (47 channels, 46 target nodes, paths {'rotation': 46, 'translation': 1})
- Visual inspection: Male armoured suit character (body mesh verified in isolation), T-pose.
- Verified capabilities: Loads; 66-joint Mixamo skeleton, T-pose; Clip 'mixamo.com' (0 s single pose); Body 71.5k tris; 4 emissive materials
- Limitations: Skinned parts Object_9, Object_13, Object_14 (~46-59 units below) and Object_11 (a 7,275-tri coiled cable ~1,180 units below) are displaced far from the body in bind pose; No motion clips; TRON IP

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Only rider with a verified humanoid rig; stray meshes must be hidden/removed and animations supplied externally.

**RECOMMENDATION:** role — Selectable rider (rig ready for Mixamo-style animation retargeting). Preprocessing — Hide/remove Object_9/11/13/14 (or hide at runtime by node name); Supply ride/attack/kick/crash/recover/remount animations.

### CITY_01_CYBERPUNK_SKYLINE — `Assets/City/cyberpunk_city.glb`

**VERIFIED FACT**

- File: `cyberpunk_city.glb` · 125,005,672 bytes (119.21 MB) · SHA-256 `d76d1c0f2c9b5c12…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-16.95.0` · extensionsUsed ['KHR_materials_specular'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 73 · mesh nodes (objects) 68 · meshes 68 · primitives 68 · vertices 3,441,516 · triangles 1,788,188 · draw calls (unbatched) 68
- Materials 18 (emissive 0, non-opaque 6; material extensions ['KHR_materials_specular']) · textures 8 · images 8 (all embedded: True) · resolutions 1024x1024 jpeg, 1024x512 png, 256x128 jpeg, 256x256 png · image bytes 1.47 MB · est. GPU 12.2 MB
- Bounding box size [44837.1224, 15518.6875, 89572.3965] (min [-992.3919, -373.9375, -64800.6602], max [43844.7305, 15144.75, 24771.7363]) · up +Y · forward: n/a (environment)
- Scale: 44,837 x 15,519 x 89,572 units. Unit not stated; if inches (SketchUp default) ~1.14 x 0.39 x 2.28 km - UNVERIFIED.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Very large dense skyline of repeated tower blocks (SketchUp/Collada export); visibly repeated clusters.
- city.roads: No distinct road meshes identified; single 12-tri ground plane 'auto__1'
- city.separability: 68 meshes chunked at the 65,535-vertex limit, each spanning nearly the whole city - not separable by block
- city.lineGeometry: 16 primitives are mode=1 LINES (SketchUp edge lines, materials 'edge_color*', ~700k vertices, BLEND alpha 0)
- city.emissive: none (window lights are textures)
- Verified capabilities: Loads (Blender 15 s); Low texture cost (~12 MB)
- Limitations: 1.79M triangles + ~700k line vertices; Chunks not spatially separable -> no culling; Edge-line primitives useless at runtime; 6 BLEND materials

**CLASSIFICATION:** HIGH RISK — Geometry is heavy and chunked across the whole extent so frustum culling cannot help; line primitives must be discarded.

**RECOMMENDATION:** role — Distant skyline backdrop only (after dropping line primitives + decimation, or baked to impostor/cubemap). Preprocessing — Drop LINES primitives; Decimate / impostor bake; Scale calibration.

### CITY_02_CYBERPUNK_DIORAMA — `Assets/City/cyberpunk_city_-_1.glb`

**VERIFIED FACT**

- File: `cyberpunk_city_-_1.glb` · 4,415,176 bytes (4.21 MB) · SHA-256 `25a02f40fc00c70c…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-15.25.0` · extensionsUsed ['KHR_materials_clearcoat'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 34 · mesh nodes (objects) 30 · meshes 30 · primitives 30 · vertices 113,021 · triangles 64,171 · draw calls (unbatched) 30
- Materials 30 (emissive 8, non-opaque 0; material extensions ['KHR_materials_clearcoat']) · textures 0 · images 0 (all embedded: True) · resolutions none · image bytes 0.0 MB · est. GPU 0.0 MB
- Bounding box size [9.1787, 3.1069, 8.8285] (min [-2.9137, -0.0, -3.0401], max [6.265, 3.1069, 5.7884]) · up +Y · forward: n/a (environment)
- Scale: 9.18 x 3.11 x 8.83 units (miniature); real scale not determinable.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Small stylised untextured cyberpunk city diorama with irregular light-grey roads, towers and an elevated tube/monorail.
- city.roads: Light-grey road/plaza surfaces merged into material-grouped meshes
- city.separability: 30 meshes grouped by material across whole diorama
- city.emissive: 8 emissive colour materials (no textures)
- Verified capabilities: Loads; 64k tris, 30 draws, no textures; 8 emissive neon-colour materials
- Limitations: Stylised low detail - visually inconsistent with Times Square; Meshes grouped by material, not by object

**CLASSIFICATION:** PASS — Very cheap (no textures, 64k tris).

**RECOMMENDATION:** role — Optional distant backdrop / reference; not a primary track source. Preprocessing — none required.

### CITY_03_POST_APOCALYPTIC — `Assets/City/post-apocalyptic_city.glb`

**VERIFIED FACT**

- File: `post-apocalyptic_city.glb` · 68,791,340 bytes (65.6 MB) · SHA-256 `32348aab8020dcf0…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-16.82.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 14 · mesh nodes (objects) 8 · meshes 8 · primitives 8 · vertices 357,489 · triangles 278,820 · draw calls (unbatched) 8
- Materials 4 (emissive 0, non-opaque 0; material extensions none) · textures 10 · images 10 (all embedded: True) · resolutions 2048x2048 jpeg, 2048x2048 png · image bytes 41.82 MB · est. GPU 213.3 MB
- Bounding box size [71.1426, 17.823, 64.2097] (min [-37.5724, -0.9137, -31.5901], max [33.5702, 16.9092, 32.6196]) · up +Y · forward: n/a (environment)
- Scale: 71.1 x 17.8 x 64.2 units; plausible metres.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Ruined industrial block: storage tanks, chimneys, pylons with cables, broken buildings, two straight road strips.
- city.roads: Mesh 'Object_8' (364 tris, 42.0 x 0.62 x 55.0) with material '8k_Wet_road_with_puddles' (2048 base/MR/normal) - two straight strips
- city.separability: Only 8 meshes; buildings merged into 6 large chunks
- city.emissive: none
- Verified capabilities: Loads; Contains a reusable wet-asphalt-with-puddles material set (base colour with lane lines, metallic-roughness with puddle variation, normal)
- Limitations: Theme is post-apocalyptic/industrial, not neon cyberpunk; Merged chunks - not separable; 213 MB GPU textures

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Moderate geometry (279k tris, 8 draws); textures need compression.

**RECOMMENDATION:** role — Source of wet-road material textures; optional background props. Preprocessing — Texture compression; Extract wet-road material textures for reuse (copy, not modify).

### CITY_CORE_TIMES_SQUARE — `Assets/City/times square.glb`

**VERIFIED FACT**

- File: `times square.glb` · 164,191,716 bytes (156.59 MB) · SHA-256 `7b3965fc54e4d42b…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-16.68.0` · extensionsUsed ['KHR_materials_emissive_strength'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 193 · mesh nodes (objects) 68 · meshes 68 · primitives 68 · vertices 1,836,889 · triangles 1,257,909 · draw calls (unbatched) 68
- Materials 16 (emissive 5, non-opaque 0; material extensions ['KHR_materials_emissive_strength']) · textures 12 · images 12 (all embedded: True) · resolutions 4096x2048 jpeg, 4096x2048 png, 4096x4096 jpeg, 4096x4096 png, 8192x8192 jpeg · image bytes 71.75 MB · est. GPU 1962.7 MB
- Bounding box size [29.8378, 20.5374, 15.742] (min [-12.7141, -0.286, -8.2154], max [17.1237, 20.2514, 7.5266]) · up +Y · forward: n/a (environment)
- Scale: 29.84 x 20.54 x 15.74 units (miniature). Exact scale NOT DETERMINABLE; roadway width (~1.1 units) and curb height (~0.009 units) are consistent with roughly 10-13 m per unit.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Times Square-style district: skyscrapers, dense billboard atlases with real-world brand logos, street furniture, one main avenue with cross streets.
- city.roads: Single mesh 'Object_32' (node 'landscape_02_landscape_01_0_19', material 'Material.003', 2,976 tris): roadway at y~0.000-0.003, sidewalks raised to y~0.006-0.009, 1,022 near-vertical curb faces
- city.roadNetwork: 1 main E-W road spanning full X (-12.62..17.12, width ~1.13, z~-1.01..0.12); 6 N-S cross streets spanning full Z (-7.9..7.25) at x~-8.37..-7.27 (w~1.1), -3.02..-2.38, 1.76..2.40, 6.50..7.16, 11.30..11.96, 16.06..16.74 (w~0.64); 1 diagonal spur at the west end; a slight jog in the main road near x~7..11. No closed loop exists within the file - every road leaves the map edge.
- city.intersections: 6 four-way junctions on the main road (plus spur junction)
- city.roadTexture: 4096x4096 base colour (image 5) with baked lane markings/crosswalks + 4096 metallic-roughness (image 6)
- city.separability: Buildings, furniture and signs are merged per material across the whole scene (e.g. 'metal_gray' chunk spans 23.6 x 13.3 x 15.7) - individual buildings cannot be selectively loaded; the road/sidewalk mesh IS a separate node and can be used alone at runtime
- city.emissive: 5 emissive materials: Material.007, Material.001, Material.008, Material.002 (billboard atlases, strength 1.5-2.0) and white_neon (pink, strength 2.0)
- city.billboards: Static billboard atlases (images 0,1,9,11) containing real trademarks; no UV animation/animation clips
- city.textureWaste: Image 2 (8192^2, used by 'advertising_screens_texture_01') is entirely black; image 8 (8192^2) is the same picture as image 7 (4096^2)
- Verified capabilities: Loads (Blender 8.7 s; textured render ran out of host memory, material-colour render succeeded); Road/sidewalk surface is one separate, flat mesh with curbs; Billboard/neon emissive materials
- Limitations: 1.26M tris; 1,963 MB estimated GPU texture memory; 4 textures at 8192^2 (exceeds MAX_TEXTURE_SIZE on many mobile GPUs); Merged-by-material meshes defeat culling/selective loading; Real brand logos on billboards; No closed road loop

**CLASSIFICATION:** HIGH RISK — Texture memory alone exceeds mobile budgets and 8K textures may fail to upload on mobile; merged meshes prevent culling. Road mesh itself is cheap and directly usable.

**RECOMMENDATION:** role — Primary environment and road source (road mesh as racing surface; buildings/billboards as trackside set dressing after texture reduction). Preprocessing — Texture downscale to <=2048/4096 + KTX2; Discard black 8K texture and duplicate 8K texture; Split merged meshes spatially for culling; Replace/obscure real brand logos (legal); Collision proxies.

### RACE_STARTER_CYBORG_ONI — `Assets/Race starter/cyborg_oni.glb`

**VERIFIED FACT**

- File: `cyborg_oni.glb` · 15,855,300 bytes (15.12 MB) · SHA-256 `9041cea55000f5e8…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-12.68.0` · extensionsUsed ['KHR_materials_clearcoat', 'KHR_materials_transmission'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 122 · mesh nodes (objects) 10 · meshes 10 · primitives 10 · vertices 30,674 · triangles 34,042 · draw calls (unbatched) 10
- Materials 9 (emissive 7, non-opaque 1; material extensions ['KHR_materials_clearcoat', 'KHR_materials_transmission']) · textures 31 · images 31 (all embedded: True) · resolutions 1024x1024 png, 2048x2048 png · image bytes 12.02 MB · est. GPU 437.3 MB
- Bounding box size [2.9309, 2.5077, 2.0423] (min [-1.4655, -0.0001, -1.0099], max [1.4655, 2.5076, 1.0324]) · up +Y · forward: +Z (rest pose; not visually confirmed) (confidence low)
- Scale: Rest-pose bbox 2.93 x 2.51 x 2.04 units (wings included); head ~2.25 above feet.
- Skins: 98 joints used by 10 mesh nodes · default pose: A-pose (upper arm ~34 deg below horizontal)
- Morph targets: none · cameras 0 · lights 0
- Animations: `clip` 6.3333 s (149 channels, 96 target nodes, paths {'rotation': 96, 'translation': 53}); `pose` 0.0 s (90 channels, 87 target nodes, paths {'rotation': 87, 'translation': 3})
- Visual inspection: Black cyborg female oni with horn, long hair, red accents, large mechanical wings/boosters, wrist/leg blades.
- Verified capabilities: Loads; 98-joint skeleton incl. fingers, head, eyes, hair, wings, swords; Clip 'clip' 6.333 s (keys t=1.00-7.33): fly-in approach (root starts ~14-15 units away horizontally, ~1.7 above rest height), landing crouch at ~t=4.5 s, stands, raises arm to head (~t=5.9 s), ends with arm extended holding a blade sideways (~t=7.3 s) - verified from curves + 10 sampled frames; Clip 'pose' 0 s static pose; 7 emissive materials
- Limitations: Clip keys start at t=1.0 s (first second holds first key in most players); 31 textures (~437 MB GPU); Uses clearcoat + transmission

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Light geometry (34k tris, 10 draws) with a rich rig and a landing clip; textures need reduction.

**RECOMMENDATION:** role — Race starter for the synchronised pre-race cinematic. Preprocessing — Texture compression; Trim/offset clip start (runtime).

### WEAPON_01_MACHETE — `Assets/Weapons/free_realistic_modern_machete_with_uv_low-poly.glb`

**VERIFIED FACT**

- File: `free_realistic_modern_machete_with_uv_low-poly.glb` · 4,058,272 bytes (3.87 MB) · SHA-256 `6b50a939106b32a4…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-13.81.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)
- Scenes 1 · nodes 5 · mesh nodes (objects) 1 · meshes 1 · primitives 1 · vertices 3,096 · triangles 3,066 · draw calls (unbatched) 1
- Materials 1 (emissive 0, non-opaque 0; material extensions none) · textures 3 · images 3 (all embedded: True) · resolutions 2048x2048 png · image bytes 3.64 MB · est. GPU 64.0 MB
- Bounding box size [0.5003, 0.0246, 0.0821] (min [-0.4175, -0.0168, -0.0415], max [0.0828, 0.0078, 0.0406]) · up +Y · forward: -X (tip at x=-0.418, handle end at x=+0.083) (confidence high)
- Scale: 0.50 x 0.025 x 0.082 units - realistic metres.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Realistic modern machete, grey blade with serrated spine, dark wrapped handle.
- weapon.grip: Handle x in [-0.084, +0.083] (thickness 0.025 vs blade 0.0096); origin lies inside the handle
- weapon.bladeLength: 0.334
- weapon.totalLength: 0.5
- weapon.components: 1
- weapon.colliderRecommendation: Capsule along -X from x=-0.08 to -0.42, radius ~0.04
- Verified capabilities: Loads; 3k tris, 1 draw; Origin in grip - direct hand attachment
- Limitations: 3 x 2048 textures (64 MB GPU) for 3k tris; Licence CC-BY-NC-4.0

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Trivial geometry; textures oversized.

**RECOMMENDATION:** role — Melee weapon (short reach). Preprocessing — Texture downscale (512-1024).

### WEAPON_02_MORNING_STAR — `Assets/Weapons/morning_star_low_poly.glb`

**VERIFIED FACT**

- File: `morning_star_low_poly.glb` · 2,588,724 bytes (2.47 MB) · SHA-256 `a440d525e82ac5b0…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-13.93.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 19 · mesh nodes (objects) 1 · meshes 1 · primitives 1 · vertices 3,124 · triangles 4,708 · draw calls (unbatched) 1
- Materials 1 (emissive 0, non-opaque 0; material extensions none) · textures 3 · images 3 (all embedded: True) · resolutions 1024x1024 png · image bytes 2.19 MB · est. GPU 16.0 MB
- Bounding box size [17.3146, 16.5557, 93.0427] (min [-8.6754, -8.2916, -91.9094], max [8.6392, 8.2642, 1.1333]) · up +Y · forward: -Z (handle end z=+0.51 -> chain start z=-47.96 -> ball z=-78.76) (confidence high)
- Scale: 17.3 x 16.6 x 93.0 units (likely cm -> ~0.93 m).
- Skins: 12 joints used by 1 mesh nodes
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Flail-type morning star: wooden handle, chain, spiked iron ball.
- weapon.grip: Handle from z~+1.1 to z~-48 (bones 'Handle End_00','Handle_01'); origin at handle end
- weapon.totalLength: 93.04
- weapon.components: 1
- weapon.rig: 12-joint skin: Handle End, Handle, Chain, Chain.1-7, Ball
- weapon.colliderRecommendation: Sphere on 'Ball_010' (radius ~8.6 units) + optional capsule on handle
- Verified capabilities: Loads; Chain is rigged (8 chain bones) - procedural/physics swing feasible; 4.7k tris, 1 draw
- Limitations: cm-like scale; No animation

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Cheap; needs scale normalisation.

**RECOMMENDATION:** role — Melee weapon (flail, medium reach, chain physics). Preprocessing — Uniform scale ~0.01.

### WEAPON_03_KATANA — `Assets/Weapons/no_name_-_katana.glb`

**VERIFIED FACT**

- File: `no_name_-_katana.glb` · 704,596 bytes (0.67 MB) · SHA-256 `979bda22febe62d9…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-12.78.0` · extensionsUsed [] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 43 · mesh nodes (objects) 30 · meshes 30 · primitives 30 · vertices 17,904 · triangles 11,582 · draw calls (unbatched) 30
- Materials 5 (emissive 1, non-opaque 0; material extensions none) · textures 0 · images 0 (all embedded: True) · resolutions none · image bytes 0.0 MB · est. GPU 0.0 MB
- Bounding box size [0.1353, 1.3551, 4.0792] (min [-0.0677, -0.4092, -1.7038], max [0.0677, 0.9459, 2.3754]) · up +Y · forward: +Z (blade 'Lame' z -0.83..2.30, handle 'Manche' z -1.55..-0.84) (confidence high)
- Scale: Katana body ~3.85 units long; handle 0.72 units. Real scale not determinable.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: `Take 01` 6.6667 s (7 channels, 4 target nodes, paths {'translation': 3, 'rotation': 4})
- Duplicate geometry: 14 group(s) of byte-identical vertex data stored more than once (e.g. ['Ailes 2.001_0', 'Ailes 2_0'], 16 tris each)
- Visual inspection: Stylised sci-fi katana (purple/black with magenta emissive trim); file contains two katana bodies ('Corp','Corp.001') and two 'Cube' objects that appear to be scabbards (one sword appears sheathed).
- weapon.grip: Node 'Corp' primitive 'Corp_4' (material 'Manche'), centre [0,0.286,-1.194], length 0.72 along Z
- weapon.components: 30 primitives in 11 nodes; 14 duplicate-geometry groups (second copy)
- weapon.animations: 'Take 01' 6.667 s: small 'Ailes 1/2/3' wing pieces translate/rotate and 'Cylinder' spins ~1079 deg on the first sword (decorative mechanism)
- weapon.colliderRecommendation: Capsule along blade (z -0.83..2.30), radius ~0.05 units (before scaling)
- Verified capabilities: Loads; 11.6k tris total; Emissive 'Light' material; Decorative animation
- Limitations: Two swords + scabbards in one file - one node set must be selected at runtime; 30 draw calls for the whole file

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Light, but needs a single sword isolated and primitives merged.

**RECOMMENDATION:** role — Melee weapon (long blade). Preprocessing — Isolate one sword node set; Merge primitives; Scale.

### WEAPON_04_ZABIMARU — `Assets/Weapons/zabimaru_v2_-_bleach.glb`

**VERIFIED FACT**

- File: `zabimaru_v2_-_bleach.glb` · 6,594,976 bytes (6.29 MB) · SHA-256 `9e50be5ef2fa2b63…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-16.59.0` · extensionsUsed ['KHR_materials_specular'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 7 · mesh nodes (objects) 2 · meshes 2 · primitives 2 · vertices 7,559 · triangles 9,646 · draw calls (unbatched) 2
- Materials 2 (emissive 0, non-opaque 0; material extensions ['KHR_materials_specular']) · textures 8 · images 8 (all embedded: True) · resolutions 1024x1024 png · image bytes 5.83 MB · est. GPU 42.7 MB
- Bounding box size [9.5932, 8.6707, 5.4515] (min [-8.7662, -2.1845, -0.2062], max [0.8271, 6.4862, 5.2453]) · up +Y · forward: Handle along +Y (y~5.09..6.33), blade curves down and toward -X/+Z (confidence high)
- Scale: 9.59 x 8.67 x 5.45 units overall; handle island 1.235 units long.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Zabimaru (Bleach) modelled in its EXTENDED segmented whip-blade form: handle and guard, then 6 curved blade segments with hooked teeth, curving through 3D.
- weapon.grip: Handle island centre [0,5.708,0], length 1.235 along Y; guard at y~4.95-5.06. Origin is NOT at the grip (handle ~5.7 units above origin).
- weapon.components: 2 mesh primitives under ONE node, no skin, no animation. Connected-component analysis: primitive 'Material_228' = 12 islands (6 blade segments x 2 parts); primitive 'Zabimaru_low' = 24 islands (handle, guard parts, 6 segment teeth/joints, tip).
- weapon.segmentCentres: [[0.058, 2.684, 0.153], [-0.49, 0.248, 1.01], [-1.873, -1.311, 2.572], [-3.896, -1.531, 3.905], [-5.893, -0.708, 4.235], [-7.497, 0.412, 3.638]]
- weapon.tipCentre: [-8.333, 1.034, 3.331]
- weapon.arcLengthGuardToTip: 15.2
- weapon.straightLineGuardToTip: 9.79
- weapon.extensionAnalysis: {'existingAnimation': 'None', 'transformsOfExistingComponents': 'Not possible directly - all segments share one node', 'proceduralSegmentation': 'Required: split each segment island into its own object/bone (runtime geometry splitting by connected components is possible without altering the source file, or offline preprocessing)', 'maxVisualExtension': 'As modelled (fully extended): ~15.2 units of blade arc, ~9.8 units straight reach from guard - about 12x the handle length. A compact (sealed) form does not exist in the file and would have to be produced by collapsing segments.'}
- weapon.colliderRecommendation: Chain of 6 capsules/spheres following segment centres; update per frame if animated
- Verified capabilities: Loads; 6 physically separate segment islands (verified); 9.6k tris, 2 draws
- Limitations: No per-segment nodes or bones; Origin far from grip; Extended form only

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Cheap geometry; segmentation work needed for the expanding attack.

**RECOMMENDATION:** role — Special longest-reach melee weapon; expansion via per-segment transforms after segmentation. Preprocessing — Segment split (runtime or offline); Re-pivot to grip; Scale; Texture compression.

### WEATHER_01_AFTER_THE_RAIN — `Assets/Weather/after_the_rain..._-_vr__sound.glb`

**VERIFIED FACT**

- File: `after_the_rain..._-_vr__sound.glb` · 216,517,188 bytes (206.49 MB) · SHA-256 `ed3364a08befddb9…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-12.68.0` · extensionsUsed ['KHR_materials_pbrSpecularGlossiness'] · extensionsRequired ['KHR_materials_pbrSpecularGlossiness'] · licence (asset extras): CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)
- Scenes 1 · nodes 258 · mesh nodes (objects) 134 · meshes 134 · primitives 134 · vertices 1,177,953 · triangles 962,642 · draw calls (unbatched) 134
- Materials 71 (emissive 1, non-opaque 10; material extensions ['KHR_materials_pbrSpecularGlossiness']) · textures 172 · images 172 (all embedded: True) · resolutions 1024x1024 png, 1024x512 png, 2048x2048 png, 256x256 png, 512x1024 png, 512x512 jpeg, 512x512 png · image bytes 155.05 MB · est. GPU 1600.3 MB
- Bounding box size [263.5589, 211.5227, 371.0831] (min [-6.3102, -0.1628, -296.541], max [257.2487, 211.3599, 74.5421]) · up +Y · forward: n/a (environment)
- Scale: 263.6 x 211.5 x 371.1 units overall (zeppelin far away); street ~110 units long, buildings 6-13 units tall - plausible metres.
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Duplicate geometry: 14 group(s) of byte-identical vertex data stored more than once (e.g. ['bat1-structure.002_0', 'bat1-structure.003_0'], 1075 tris each)
- Visual inspection: Curved old European (French-named) terraced street after rain: 12 building types (several duplicated), cobbled ground with glossy wet patches, fences, lamp posts, trees, barrels/crates, a distant zeppelin. No rain itself.
- weather.wetMaterials: Ground materials 'ground1/2/3' use spec-gloss with glossiness 1.0 and gloss masks (alpha of spec-gloss textures) giving wet/puddle patches; baked, non-tiling cobblestone textures
- weather.reflective: Glossy ground (spec-gloss) only
- weather.audio: None - glTF contains no audio (the 'Sound' in the title refers to the Sketchfab scene)
- Verified capabilities: Loads (Blender 19 s); Wet-cobblestone look authored in textures
- Limitations: extensionsRequired KHR_materials_pbrSpecularGlossiness on all 71 materials with NO metal-rough fallback; 962k tris, 134 draws, 172 images (~1.6 GB GPU); Not cyberpunk; Licence CC-BY-NC-4.0

**CLASSIFICATION:** UNSUITABLE AS-IS — Would render untextured in current three.js and exceeds any mobile texture budget; content does not provide rain.

**RECOMMENDATION:** role — Reference for wet-surface look only; not a runtime asset. Preprocessing — If used at all: spec-gloss->metal-rough conversion, texture reduction, selective extraction.

### WEATHER_02_RAIN_DROPS_CIRCLES — `Assets/Weather/rain_drops_circles__download__like_please.glb`

**VERIFIED FACT**

- File: `rain_drops_circles__download__like_please.glb` · 7,343,756 bytes (7.0 MB) · SHA-256 `2c8551e08fcb5fdf…` · parses: **True** · Blender 5.2.1 import: **OK**
- glTF 2.0 · generator `Sketchfab-15.98.0` · extensionsUsed ['KHR_materials_specular', 'KHR_materials_clearcoat'] · extensionsRequired [] · licence (asset extras): CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Scenes 1 · nodes 9 · mesh nodes (objects) 3 · meshes 3 · primitives 3 · vertices 168 · triangles 84 · draw calls (unbatched) 3
- Materials 3 (emissive 1, non-opaque 3; material extensions ['KHR_materials_clearcoat', 'KHR_materials_specular']) · textures 5 · images 5 (all embedded: True) · resolutions 1024x1024 png, 512x512 jpeg, 512x512 png · image bytes 6.99 MB · est. GPU 18.7 MB
- Bounding box size [962.9922, 645.0, 961.6455] (min [-22390.043, -0.0, 16192.7549], max [-21427.0508, 645.0, 17154.4004]) · up +Y · forward: n/a (environment)
- Scale: 963 x 645 x 962 units, centred at x~-21,909, z~16,674 (far from origin). Node names are stored as U+FFFD replacement characters (unrecoverable).
- Skins: none
- Morph targets: none · cameras 0 · lights 0
- Animations: none
- Visual inspection: Rain volume box: transparent helper shell, crossing vertical rain-streak planes, and one ground quad with a rain-ripple normal map + clearcoat.
- weather.rainGeometry: Yes - static vertical planes (mesh 2, 24 tris) with emissive rain-streak texture (image 1, 512 JPEG) and white base texture with alpha (image 0, 512 PNG LA), BLEND
- weather.waterSurfaces: One 2-tri ground quad ('material_2', BLEND alpha 0.81) at y=45
- weather.rippleGeometry: No geometry; ripple rings exist only as a 1024 normal map (image 3), also used as clearcoat normal
- weather.wetMaterials: Ground quad: clearcoat 1.0, clearcoat roughness 0.42, specular texture
- weather.helperShell: Mesh 1 (58 tris) material alpha 0 (invisible box)
- weather.animations: None (no clips, no KHR_texture_transform) - fully static
- Verified capabilities: Loads; 84 tris; Reusable rain-streak and ripple-normal textures
- Limitations: Static - no falling motion or ripple animation; Positioned ~27 km-units from origin; Uses clearcoat/specular extensions

**CLASSIFICATION:** PASS WITH OPTIMIZATION — Negligible geometry; must be re-centred and animated by shader to be useful.

**RECOMMENDATION:** role — Texture source for shader rain streaks and ripple normals. Preprocessing — Re-centre; Animate via UV scroll shader.


---

## 4. Category-specific findings

### 4.1 Characters (riders) + Audience

**VERIFIED FACT**

| Asset | Rig | Pose | Standing height (units) | Hands/fingers | Existing motion | Recolour route |
|---|---|---|---:|---|---|---|
| RIDER_01_CAT_EARS | none | sculpted pose, hands together in front | 2.88 | mesh only | none | 2 baked atlases |
| RIDER_02_FUTURISTIC_BIKER | none | sculpted pose, hand on hip | 0.053 | mesh only | none | per-part atlases |
| RIDER_03_SCIFI_GIRL | none | relaxed A-pose | 1.93 | mesh only | none | per-part materials (spec-gloss) |
| RIDER_04_TRON_CHARACTER | none | bind-like, arms out and slightly down | 929 | mesh only | none | emissive tint |
| RIDER_05_TRON_BLACKGUARD | 66 Mixamo | T-pose (3.6°) | 1.87 (body mesh) | full fingers | 0 s pose only | emissive tint |
| AUDIENCE_01 | 56 custom | arms down (73°); 0 s `A-pose` clip | 3.02 | fingers | none | baked atlases |
| AUDIENCE_02 | none | T-pose | 0.98 | mesh only | none | single 8K atlas |
| AUDIENCE_03 | none | A-pose-like | 2.72 | mesh only | none | single atlas (BLEND) |
| AUDIENCE_04 RPM | 66 Mixamo-style | arms down (66°) | 1.89 | fingers | none | **per-part materials** |
| AUDIENCE_05 ruffle | 66 Mixamo | arms down (76°) | 1.90 | fingers | 16.6 s idle | single atlas |

Other verified points:

- **Blackguard strays:** in bind pose, several skinned parts sit far from the body. `Object_9/13/14` are 46–59 units below it. `Object_11` is a coiled cable 7,275 triangles in size, about 1,180 units below.
- **Ruffle-dress origin:** its origin is at mid-body, with the feet at y≈−0.95.
- **Futuristic biker duplicate:** it stores an identical 17k-triangle body mesh twice at the same position.
- **Scifi girl:** it includes a 1.6 × 1.6 ground plane and about 196k triangles of blended overlay meshes.

**RECOMMENDATION**

- **Seated pose:** needs a rig. Blackguard can be posed procedurally now by bending hips and knees, reaching the arms to the handlebars with 2-bone IK, and pitching the spine forward. The static riders first need rigging; auto-riggers want a T/A-pose, which Tron character and scifi girl roughly have and cat-ears and futuristic biker don't.
- **Weapon attachment:** attach to the right-hand bone of each rig. Use the `RightHand` bone on Mixamo rigs.
- **Three colour variants per character:**
  - Easy on Ready Player Me (per-part materials) and on TRON-style emissive trims (factor tint).
  - For atlas-textured characters, use a hue-shift or tint shader, or author colour masks in preprocessing.
- **Crowd:**
  - Use Ready Player Me as the main template.
  - Use the ruffle dress only after decimation.
  - Don't use `female.glb` without heavy decimation.
  - Use GPU-instanced impostors or a baked-animation approach for density. Skinned meshes can't share a single InstancedMesh draw without custom vertex animation textures.

### 4.2 Bikes

**VERIFIED FACT: mount and pivot data** (glTF world units, native file, before normalisation)

| Bike | Forward | Length×Height×Width | Wheel parts | Wheel centres (front / rear) | Wheel r | Wheelbase | Ground y | Steering parts | Grips (L / R) | Seat reference |
|---|---|---|---|---|---:|---:|---:|---|---|---|
| BMW S1000RR | −Z | 2.34×1.34×0.92 | bones `wheel_lf_23`, `wheel_lr_29` | (−0.002,−0.177,−0.848) / (−0.021,−0.157,0.806) | ≈0.33 | 1.654 | −0.51 | `forks_u_25`, `forks_l_24`, `handlebars_21` (≈23° rake) | (−0.366,0.443,−0.438) / (0.323,0.456,−0.445) | bone `seat_32` (−0.002,0.407,0.359) |
| Honda PCX (scooter) | +X | 1.91×1.16×0.74 | nodes `Dianteira_46`, `Traseira_97` | (0.715,0.255,−0.011) / (−0.573,0.253,−0.010) | ≈0.255 | 1.288 | 0.0 | separate handlebar nodes, **no common steering pivot** | ≈(0.27,1.03,±0.30…0.38) | seat top y≈0.80, x −0.70…0.09; hinge node `banco.002_3` |
| Hover "Rocket" | +X (layout inference) | 845.5×245×413 | none (hover) | – | – | – | craft floats 17 units above origin | none; animated wings/flaps | none identified | not a named node |
| Monobike | +Z (visual, medium) | 1.12×0.99×0.61 | not a node; **tyre and rim are separate islands** in primitive 2 | single wheel (0,0.376,0) | ≈0.385 | – | ≈0 | none (handlebar-sized islands exist) | not determined | not determined |
| TRON light cycle | +Z | 2.58×1.02×0.67 | bones `Front_Tire_02`, `Rear_Tire_04` | (0,0.391,0.936) / (0,0.385,−0.859) | ≈0.39 | 1.795 | 0.0 | handle bones only | `L_Handle_end` (0.204,0.779,0.753) / `R_Handle_end` (−0.204,0.779,0.753) | prone under canopy (`Hood_05` (0,0.857,−0.183)) |

- **Lights:** no bike file contains light objects. Emissive materials are listed below:
  - **BMW:** 15, covering dials and lamps.
  - **Light cycle:** `Glow`, orange-red with strength 4.37, and `Headlights` with strength 10.
  - **Hover bike:** an emissive texture at strength 10.
  - **Monobike:** an emissive texture.
  - **Honda:** none.
- **Suspension:** BMW has fork and swingarm bones. The light cycle has speed-brake and hood bones. The others have none.

**RECOMMENDATION**

- **Chassis:** use a normalised invisible physics chassis (box or capsule plus raycast wheels) and let it drive every visual model. All bikes need a per-bike correction transform: rotate forward to the engine convention, rescale to target length, and offset the origin to the ground contact point. BMW is 0.51 above ground; the hover bike floats 17 units up.
- **Wheel spin:**
  - Rotate the bones or nodes for BMW, Honda and the light cycle.
  - The monobike needs its tyre and rim islands split out first.
  - The hover bike needs none; use its idle clip plus procedural tilt instead.
- **Colliders:** derive chassis dimensions from wheelbase × width × height. Example: BMW about 1.65 × 0.9 × 1.3 before scale normalisation.

### 4.3 Weapons

**VERIFIED FACT**

| Weapon | Native length | Grip / origin | Axis | Components / rig | Animation |
|---|---|---|---|---|---|
| Machete | 0.50 (metres-like; blade 0.334, handle 0.167) | handle x −0.084…+0.083; **origin inside grip** | blade toward −X | 1 mesh | none |
| Morning star (flail) | 93.0 units (likely cm) | origin at handle end; handle to z≈−48, chain to ball at z≈−78.8 | −Z | 12-joint skin: handle, 8 chain bones, ball | none |
| Katana | ≈3.85 units per sword; handle 0.72 | handle primitive `Corp_4`, centre (0,0.286,−1.194) | blade +Z | **2 swords + 2 scabbard-like objects**, 30 primitives | `Take 01` 6.667 s (decorative wing pieces and spinning cylinder) |
| Zabimaru | 9.59 × 8.67 × 5.45 overall; handle 1.235 | handle island centre (0,5.708,0); **origin ≈5.7 units below grip** | handle +Y, blade curves −X/+Z | 2 primitives, 1 node, no rig | none |

**Relative scale:** the weapons don't share a scale. The machete is metre-like, the morning star cm-like, and the katana and Zabimaru have arbitrary units. Real-world reach can only be set by normalising, for example handle length to about 0.25–0.30 m.

**ZABIMARU SPECIAL AUDIT (verified)**

- **Hierarchy:** `Sketchfab_model › …fbx › RootNode › Zabimaru_low › Object_4`. That node holds two primitives: `Zabimaru_low` (6,191 vertices, 7,798 tris) and `Material #228` (1,368 vertices, 1,848 tris).
- **Islands:**
  - `Material #228` has **12 islands**: 6 blade segments × 2 parts, 108–120 vertices each.
  - `Zabimaru_low` has **24 islands**:
    - hilt parts: handle, guard plates, collar and rivets;
    - 6 segment tooth/joint pieces, 98–146 vertices each;
    - a tip piece.
- **Segment centres:**

  | Segment | Centre |
  |---|---|
  | 1 | (0.058, 2.684, 0.153) |
  | 2 | (−0.49, 0.248, 1.01) |
  | 3 | (−1.873, −1.311, 2.572) |
  | 4 | (−3.896, −1.531, 3.905) |
  | 5 | (−5.893, −0.708, 4.235) |
  | 6 | (−7.497, 0.412, 3.638) |
  | tip | (−8.333, 1.034, 3.331) |

- **Answers:**
  - **Segments separate?** Yes geometrically, no structurally: they are disconnected islands inside shared primitives on one node.
  - **Extension by existing animation?** No, there are no clips.
  - **Extension by transforms of existing components?** No, because there are no per-segment nodes or bones.
  - **Procedural segmentation required?** Yes.
  - **Maximum visually reasonable extension:** the modelled pose *is* the fully extended form. That's about 15.2 units of blade arc from guard to tip and about 9.79 units straight reach, roughly 12× the handle length. With a 0.28 m handle that's about 3.4 m of arc and 2.2 m of straight reach. No compact "sealed" form exists in the file.

**RECOMMENDATION (not implemented)**

- **Split:** separate the 6 segments by connected-component analysis. This can run at load time on a copy of the geometry, so the source stays unmodified, or offline in preprocessing.
- **Chain:** parent each segment to a chain of 6 transforms or bones, pivoted at the joint between consecutive segments.
- **Animate:** for "sealed", collapse the segments toward the handle axis; for "expanded", interpolate to the authored positions, with a procedural whip wave along the chain.
- **Collision:** give each segment its own collider (sphere or capsule).
- **Grip:** re-pivot the whole weapon to the grip.

### 4.4 Race starter

See §5 and §6 for clips and rig. **VERIFIED:**

- **Landing:** yes, a crouched landing around t≈4.5 s inside `clip`.
- **Locomotion:** none, meaning no walk or run cycle.
- **Arm/hand/head articulation:** yes, with full finger chains, wrist rotation up to about 149°, plus head, eyes and hair chains.
- **Other bones:** wings, boosters and swords are separately articulated.

**RECOMMENDATION:**

- Use `clip` as the landing-to-gesture base.
- Hold or loop the final pose, and add a procedural countdown gesture (finger count or arm raise, driven by the finger and arm bones) before a release gesture.
- Offset the playback start by 1.0 s, because the keys begin at t=1.0.
- Use a camera path in engine; the file has no cameras.

### 4.5 City and 4.6 Weather

See §8 and §9.

---

## 5. Animation inventory (verified, exact names)

| Asset | Clip name (exact) | Duration (s) | Key range (s) | Channels | Targets | Paths |
|---|---|---:|---|---:|---:|---|
| `AUDIENCE_01_CYBERPUNK_CHARACTER` | `A-pose` | 0.0 | 0.0–0.0 | 94 | 55 | {'rotation': 41, 'translation': 53} |
| `AUDIENCE_05_RUFFLE_DRESS_FEMALE` | `mixamo.com` | 16.6333 | 0.0–16.6333 | 90 | 52 | {'translation': 38, 'rotation': 52} |
| `BIKE_02_HONDA_PCX` | `Animation` | 10.0 | 0.0–10.0 | 5 | 5 | {'rotation': 5} |
| `BIKE_02_HONDA_PCX` | `banco.002Action` | 0.8333 | 0.0–0.8333 | 1 | 1 | {'rotation': 1} |
| `BIKE_03_HOVER_ROCKET` | `Armature|Idle` | 1.9667 | 0.0–1.9667 | 7 | 7 | {'rotation': 6, 'translation': 1} |
| `BIKE_05_TRON_LIGHT_CYCLE` | `Argon_LightCycle|Argon_LightCycleAction` | 11.25 | 0.0–11.25 | 2 | 1 | {'scale': 1, 'rotation': 1} |
| `RIDER_05_TRON_BLACKGUARD` | `mixamo.com` | 0.0 | 0.0–0.0 | 47 | 46 | {'rotation': 46, 'translation': 1} |
| `RACE_STARTER_CYBORG_ONI` | `clip` | 6.3333 | 1.0–7.3333 | 149 | 96 | {'rotation': 96, 'translation': 53} |
| `RACE_STARTER_CYBORG_ONI` | `pose` | 0.0 | 0.0–0.0 | 90 | 87 | {'rotation': 87, 'translation': 3} |
| `WEAPON_03_KATANA` | `Take 01` | 6.6667 | 0.0333–6.7 | 7 | 4 | {'translation': 3, 'rotation': 4} |

**Verified behaviour of each clip:**

- **`cyborg_oni` `clip`:**
  - Keys run from 1.00 to 7.33 s.
  - The root starts about 14–15 units away horizontally and about 1.7 units above rest height, then travels in. Wings are spread and the root rotates through up to 138° during flight.
  - It lands in a crouch around t≈4.5 s, with the root at 39 against a rest value of 109 in rig units.
  - It then stands (≈108), raises an arm to the head (≈5.9 s), and ends with an arm extended holding a blade sideways (≈7.3 s).
  - The sword joints translate over large distances.
- **`cyborg_oni` `pose`:** a single-key static pose.
- **`rigged_female_fashion…` `mixamo.com`:** a subtle standing idle / weight shift, 500 keys.
- **`honda_pcx` `Animation`:** both wheel groups spin 10 revolutions in 10 s, and the whole bike sways by 1°.
- **`honda_pcx` `banco.002Action`:** the seat hinge opens 70°.
- **`tron…light_cycle` action:** `Rear_Engine_03` rotates about 10.6 revolutions in 11.25 s; its scale track is constant.
- **`hover_bike` `Armature|Idle`:** a loopable 1.967 s idle. Fans spin 360° and 720°, wings and flaps flutter 1–2°, and the root bobs 0.2 units.
- **`katana` `Take 01`:** decorative "Ailes" pieces move and a cylinder spins 1,079°.
- **`cyberpunk_character` `A-pose`, `blackguard` `mixamo.com`:** 0 s single-key poses.

**Missing everywhere:** no riding, steering, melee, kick, crash, get-up, walk or remount clips exist in any file.

---

## 6. Rigging inventory (verified)

| Asset | Rigged | Joints | Skinned mesh nodes | Naming | Fingers | Default pose |
|---|---|---:|---:|---|---|---|
| `AUDIENCE_01_CYBERPUNK_CHARACTER` | yes | 56 | 6 | custom lower-case with spaces ('l arm_028', 'r forearm_010', extra 'l elbow_046') | True | arms down ~73 deg below horizontal (node default pose); a 0-second clip named 'A-pose' also exists |
| `AUDIENCE_02_FEMALE_TRIPO` | no | - | - | - | - | T-pose (static mesh) |
| `AUDIENCE_03_FEMALE_CHARACTER_HORNED` | no | - | - | - | - | A-pose-like, arms spread downward (static) |
| `AUDIENCE_04_READYPLAYERME_CYBERPUNK` | yes | 66 | 10 | Mixamo-style names without prefix (Hips, Spine, LeftArm, LeftHand, LeftHandIndex1...) | True | arms down ~66 deg below horizontal |
| `AUDIENCE_05_RUFFLE_DRESS_FEMALE` | yes | 66 | 5 | Mixamo ('mixamorig:*') | True | arms down ~76 deg below horizontal |
| `BIKE_01_BMW_S1000RR` | yes | 46 | 113 | - | - | - |
| `BIKE_02_HONDA_PCX` | no | - | - | - | - | - |
| `BIKE_03_HOVER_ROCKET` | yes | 18 | 0 | - | - | - |
| `BIKE_04_MONOBIKE_DRAGONSEEKER` | no | - | - | - | - | - |
| `BIKE_05_TRON_LIGHT_CYCLE` | yes | 19 | 8 | - | - | - |
| `RIDER_01_CAT_EARS` | no | - | - | - | - | Posed (hands together in front of chest), not T/A pose |
| `RIDER_02_FUTURISTIC_BIKER` | no | - | - | - | - | Posed (hand on hip) |
| `RIDER_03_SCIFI_GIRL` | no | - | - | - | - | Relaxed A-pose (static) |
| `RIDER_04_TRON_CHARACTER` | no | - | - | - | - | Arms out and slightly down (bind-like pose), static |
| `RIDER_05_TRON_BLACKGUARD` | yes | 66 | 5 | Mixamo ('mixamorig:*') | True | T-pose (upper arm 3.6 deg below horizontal) |
| `CITY_01_CYBERPUNK_SKYLINE` | no | - | - | - | - | - |
| `CITY_02_CYBERPUNK_DIORAMA` | no | - | - | - | - | - |
| `CITY_03_POST_APOCALYPTIC` | no | - | - | - | - | - |
| `CITY_CORE_TIMES_SQUARE` | no | - | - | - | - | - |
| `RACE_STARTER_CYBORG_ONI` | yes | 98 | 10 | 'CyberdemonRig:JNT_*' custom (typos: 'shourder','erbow','ankre','rittre') | True | A-pose (upper arm ~34 deg below horizontal) |
| `WEAPON_01_MACHETE` | no | - | - | - | - | - |
| `WEAPON_02_MORNING_STAR` | yes | 12 | 1 | - | - | - |
| `WEAPON_03_KATANA` | no | - | - | - | - | - |
| `WEAPON_04_ZABIMARU` | no | - | - | - | - | - |
| `WEATHER_01_AFTER_THE_RAIN` | no | - | - | - | - | - |
| `WEATHER_02_RAIN_DROPS_CIRCLES` | no | - | - | - | - | - |

Other rigs:

- **Bikes:** BMW has 46 joints, all rigid part bones. The light cycle has 19. The hover bike has 18 joints that no mesh is skinned to; its parts are node children of the joints instead.
- **Weapons:** the morning star has 12 joints.
- **No morph targets** exist in any file.

**Humanoid compatibility:**

- **Mixamo naming:** Blackguard and the ruffle dress use `mixamorig:` names. Ready Player Me uses the same names without the prefix. These three can share Mixamo animations directly.
- **Custom naming, needs an explicit retarget map:**
  - `cyberpunk_character` uses `l arm_028`-style names.
  - The Oni uses `CyberdemonRig:JNT_*`, including misspellings `shourder`, `erbow`, `ankre` and `rittre`.

---

## 7. Material / texture inventory (verified)

| Asset | Mats | Emissive materials | Non-opaque | Material extensions | Images | Max res | Image MB in file | Est. GPU MB |
|---|---:|---|---:|---|---:|---:|---:|---:|
| `AUDIENCE_01_CYBERPUNK_CHARACTER` | 4 | - | 2 | KHR_materials_specular | 7 | 4096 | 73.42 | 597.3 |
| `AUDIENCE_02_FEMALE_TRIPO` | 1 | - | 0 | - | 3 | 8192 | 14.1 | 512.0 |
| `AUDIENCE_03_FEMALE_CHARACTER_HORNED` | 1 | `initialShadingGroup` | 1 | - | 4 | 2048 | 12.05 | 85.3 |
| `AUDIENCE_04_READYPLAYERME_CYBERPUNK` | 9 | `Wolf3D_Glasses` | 1 | - | 19 | 1024 | 4.22 | 49.0 |
| `AUDIENCE_05_RUFFLE_DRESS_FEMALE` | 1 | `Material.001` | 0 | - | 3 | 2048 | 8.04 | 64.0 |
| `BIKE_01_BMW_S1000RR` | 74 | `script_rt_dials_race`, `rgbab60000ff`, `script_rt_dials_race.001`, `vehicle_generic_smallspecmap.027`, `vehicle_generic_smallspecmap.028`, `vehicle_generic_smallspecmap.029` (+9) | 4 | KHR_materials_clearcoat, KHR_materials_emissive_strength, KHR_materials_specular | 57 | 1024 | 2.07 | 32.7 |
| `BIKE_02_HONDA_PCX` | 32 | - | 8 | KHR_materials_transmission | 5 | 1024 | 0.61 | 14.7 |
| `BIKE_03_HOVER_ROCKET` | 1 | `Test` | 0 | KHR_materials_emissive_strength | 4 | 4096 | 37.63 | 341.3 |
| `BIKE_04_MONOBIKE_DRAGONSEEKER` | 2 | `Monobike_U2` | 0 | KHR_materials_pbrSpecularGlossiness | 9 | 2048 | 34.9 | 192.0 |
| `BIKE_05_TRON_LIGHT_CYCLE` | 8 | `Glow`, `Headlights` | 1 | KHR_materials_emissive_strength, KHR_materials_specular | 1 | 512 | 0.0 | 1.3 |
| `RIDER_01_CAT_EARS` | 2 | - | 0 | - | 2 | 1024 | 0.64 | 10.7 |
| `RIDER_02_FUTURISTIC_BIKER` | 6 | - | 0 | KHR_materials_specular | 4 | 2048 | 3.79 | 85.3 |
| `RIDER_03_SCIFI_GIRL` | 12 | `cloth`, `light` | 7 | KHR_materials_pbrSpecularGlossiness | 17 | 1024 | 5.26 | 69.7 |
| `RIDER_04_TRON_CHARACTER` | 1 | `03_-_Default` | 0 | - | 4 | 4096 | 1.86 | 277.3 |
| `RIDER_05_TRON_BLACKGUARD` | 4 | `material_0`, `Material_0.002`, `38_BeckMesh_1_0_0.003`, `38_BeckSuitMain1MAT_1_0_0.003` | 0 | KHR_materials_specular | 12 | 2048 | 7.7 | 128.0 |
| `CITY_01_CYBERPUNK_SKYLINE` | 18 | - | 6 | KHR_materials_specular | 8 | 1024 | 1.47 | 12.2 |
| `CITY_02_CYBERPUNK_DIORAMA` | 30 | `Meshpart8Mtl`, `Meshpart13Mtl`, `Meshpart14Mtl`, `Meshpart16Mtl`, `Meshpart17Mtl`, `Meshpart22Mtl` (+2) | 0 | KHR_materials_clearcoat | 0 | - | 0.0 | 0.0 |
| `CITY_03_POST_APOCALYPTIC` | 4 | - | 0 | - | 10 | 2048 | 41.82 | 213.3 |
| `CITY_CORE_TIMES_SQUARE` | 16 | `Material.007`, `Material.001`, `Material.008`, `Material.002`, `white_neon` | 0 | KHR_materials_emissive_strength | 12 | 8192 | 71.75 | 1962.7 |
| `RACE_STARTER_CYBORG_ONI` | 9 | `CyberdemonRigcyberdemonmat_face`, `CyberdemonRigcyberdemonmat_leg`, `CyberdemonRigcyberdemonMat_torso`, `CyberdemonRigcyberdemonmat_arm`, `CyberdemonRigcyberdemonMat_hand`, `CyberdemonRigcyberdemonMat_gears` (+1) | 1 | KHR_materials_clearcoat, KHR_materials_transmission | 31 | 2048 | 12.02 | 437.3 |
| `WEAPON_01_MACHETE` | 1 | - | 0 | - | 3 | 2048 | 3.64 | 64.0 |
| `WEAPON_02_MORNING_STAR` | 1 | - | 0 | - | 3 | 1024 | 2.19 | 16.0 |
| `WEAPON_03_KATANA` | 5 | `Light` | 0 | - | 0 | - | 0.0 | 0.0 |
| `WEAPON_04_ZABIMARU` | 2 | - | 0 | KHR_materials_specular | 8 | 1024 | 5.83 | 42.7 |
| `WEATHER_01_AFTER_THE_RAIN` | 71 | `caisse` | 10 | KHR_materials_pbrSpecularGlossiness | 172 | 2048 | 155.05 | 1600.3 |
| `WEATHER_02_RAIN_DROPS_CIRCLES` | 3 | `-_-_15x15` | 3 | KHR_materials_clearcoat, KHR_materials_specular | 5 | 1024 | 6.99 | 18.7 |

Notable verified texture facts:

- **All 403 embedded images decode.** They are PNG or JPEG; there is no WebP or KTX2.
- **8192² images:**
  - `times square.glb` has 4: images 2, 8, 9 and 11.
  - `female.glb` has 1.
- **Times Square waste:**
  - Image 2 (8192², used by `advertising_screens_texture_01`) is **entirely black**.
  - Image 8 (8192²) is **the same picture** as image 7 (4096²), with a mean pixel difference of 1.9/255.
- **Spec-gloss required, no fallback:** monobike (2 materials), scifi girl (12), After the rain (71).
- **Other material extensions used:**
  - clearcoat: BMW, Oni, cyberpunk_city_-_1, rain drops;
  - transmission: Honda, Oni;
  - specular: several files;
  - emissive_strength: several files.
- **Times Square billboards:** static atlases (images 0, 1, 9, 11) showing real brands such as Toshiba, Disney/The Lion King, Ricoh, Lyft, American Eagle, M&M's, McDonald's, X-Men, Levi's and TKTS. There is no texture animation and no `KHR_texture_transform`.

---

## 8. City / road findings

### VERIFIED FACT

**Overview:**

| File | Extent (units) | Road geometry | Separability | Emissive | Notes |
|---|---|---|---|---|---|
| times square.glb | 29.8 × 20.5 × 15.7 | **Separate flat road + sidewalk mesh** `Object_32` | Road mesh separate; everything else merged per material across the whole scene | 5 materials (billboards, neon) | miniature scale |
| cyberpunk_city.glb | 44,837 × 15,519 × 89,572 | 12-tri ground plane only | 68 chunks, each spanning the whole city (65k-vertex splits) | none | 16 LINES primitives (edge lines); visibly repeated blocks |
| cyberpunk_city_-_1.glb | 9.2 × 3.1 × 8.8 | Light-grey irregular road/plaza surfaces merged by material | 30 material-grouped meshes | 8 colour-only emissives | untextured stylised diorama |
| post-apocalyptic_city.glb | 71.1 × 17.8 × 64.2 | `Object_8`: two straight strips (42 × 55 extent, 364 tris), material `8k_Wet_road_with_puddles` | 8 meshes (6 merged building chunks) | none | industrial ruin theme |

### TIMES SQUARE SPECIAL AUDIT (verified)

**Road surface.** The road surface is node `landscape_02_landscape_01_0_19` / mesh `Object_32`, material `Material.003`. It has 2,976 triangles:

- 1,935 face up;
- 1,022 are near-vertical curb faces;
- 19 face down.

Roadway (y 0.000–0.003) covers about 98 units² and sidewalks/plazas (y 0.006–0.009) about 169 units². The base-colour texture (image 5, 4096²) carries the lane markings, crosswalks and turn arrows. The metallic-roughness texture is image 6.

**Road dimensions (plan view):**

- **Main east-west road:** x −12.62 → 17.12 (length ≈29.7), z ≈ −1.01 → 0.12 (width ≈1.13). There's a slight jog and taper around x≈7…11.
- **Six north-south cross streets**, each spanning the full depth z −7.91 → 7.25 (≈15.2):

  | # | x range | Width |
  |---|---|---:|
  | 1 | −8.37 → −7.27 | ≈1.10 |
  | 2 | −3.02 → −2.38 | ≈0.64 |
  | 3 | 1.76 → 2.40 | ≈0.64 |
  | 4 | 6.50 → 7.16 | ≈0.66 |
  | 5 | 11.30 → 11.96 | ≈0.66 |
  | 6 | 16.06 → 16.74 | ≈0.68 |

- **Diagonal spur:** runs from the west edge (x −12.6, z ≈ 2.5–3.8) to cross street 1.

**Intersections:** 6 four-way junctions on the main road, plus the spur junction on cross street 1.

**Network topology:** it's a comb/grid **with no closed loop**. Every street ends at the map boundary, and there's no second east-west road.

**Sidewalks and barriers:** raised sidewalks with curb faces surround all blocks. Barrier-like street furniture sits on the plazas and road edges: railings, benches, poles and planters, in merged `metal_gray`, `metal_black`, `chrom` and `advertising_screens_texture_01` chunks. These chunks are merged with other objects, so they can't be extracted individually.

**Buildings bordering roads:** every block borders the main road or the cross streets. Building meshes (e.g. `metal_gray` chunks up to 23.6 × 13.3 × 15.7, and `skyscraper_wall`) are merged across many blocks.

**Billboards and signage:** billboard atlases and neon are in materials `Material.007`, `Material.001`, `Material.008` and `Material.002` (emissive strength 1.5–2.0, emissive texture = base texture) and `white_neon` (pink, strength 2.0).

**Road pieces:** they're not modular. The road network is one continuous mesh, and repeated road pieces don't exist as reusable parts.

**Cost of the full scene:**

- 1.26 M triangles.
- 68 draw calls.
- About 1,963 MB of estimated uncompressed texture memory, with 8192² images that exceed `MAX_TEXTURE_SIZE` on many mobile GPUs.
- The Blender textured render of this file ran out of host memory. The material-colour render succeeded.

**Scale:** not determinable exactly. The ratios (road ≈1.1 units wide, curb ≈0.009 units, towers up to about 20 units) are consistent with roughly 10–13 m per unit. At that scale the main road is about 300–390 m long and the cross streets about 150–200 m.

### RECOMMENDATION

- **Most valuable parts:**
  - the road/sidewalk mesh and its 4K road texture, as the racing surface and its markings;
  - the billboard and neon materials, for cyberpunk identity;
  - skyscraper silhouettes, as trackside walls.
- **Road selection:** load `Object_32` selectively by node name. That works at runtime from the unmodified file. Clip or extend it in engine to build the circuit.
- **No closed loop:** the track design must add connecting road segments, use an off-map connector, or use hairpin turnarounds. This is a design decision for the next phase.
- **Using the whole scene:** too expensive as-is for mobile. Needs texture reduction (≤2048–4096 plus KTX2), dropping the black and duplicate 8K textures, spatially splitting the merged chunks, and LOD.
- **Collision:**
  - build simple box proxies per building block and curb lines from the road mesh's vertical faces;
  - no collision on billboards, neon strips, overhead signs or crowd;
  - street-furniture chunks can't be isolated as-is.
- **cyberpunk_city.glb:** only as a far skyline (drop the LINES primitives, decimate or impostor).
- **cyberpunk_city_-_1:** optional background.
- **post-apocalyptic_city:** mainly a source of wet-road material textures.

---

## 9. Weather findings

### VERIFIED FACT

| Capability | after_the_rain…glb | rain_drops_circles…glb |
|---|---|---|
| Rain geometry | none | **static vertical rain-streak planes** (24 tris), BLEND, emissive streak texture (512 JPEG) plus white alpha texture (512 PNG) |
| Particle-like geometry | none | none (planes, not particles) |
| Puddles | none as geometry; **gloss-mask puddle patches baked in ground spec-gloss textures** | none |
| Water surfaces | none | one 2-tri ground quad (alpha 0.81, clearcoat 1.0, clearcoat roughness 0.42) |
| Ripple geometry | none | none; **ripple rings exist as a 1024² normal map** (also the clearcoat normal) |
| Wet-road materials | glossy wet cobblestones (spec-gloss, glossiness 1.0, non-tiling baked textures) | clearcoat ground quad |
| Reflective materials | glossy ground only | clearcoat ground |
| Environment meshes | full street: 12 building types, fences, lamps, trees, crates, barrels, a zeppelin (962k tris) | invisible helper shell (alpha 0, 58 tris) |
| Animations | none | none (no clips, no texture transform) |
| Audio | none (glTF has no audio; "VR & Sound" is the Sketchfab title) | none |
| Cameras / lights | none / none | none / none |
| Placement | origin near street start | centred ≈(−21,909, 322, 16,674), far from origin |
| Reusable components | wet-look reference; baked textures not tileable | rain-streak texture, ripple normal map |

The `post-apocalyptic_city.glb` wet-road material also provides a tileable-looking wet-asphalt base with lane lines, a roughness map with puddle variation, and a normal map. This is verified visually, not measured for seamless tiling.

### A. Already supplied by the assets (verified)

- Rain-streak texture (static).
- Ripple normal-map texture (static).
- A wet cobblestone reference look (spec-gloss, not directly renderable in three.js).
- A wet-asphalt-with-puddles texture set (post-apocalyptic city).
- Emissive billboards and neon that will reflect on wet roads (Times Square).

### B. Will require runtime VFX, shaders or code (verified absent from the files)

- Falling rain motion and **variable intensity**: GPU particles or scrolling streak planes around the camera.
- Animated ripples in puddles: normal-map UV animation or flipbook.
- Wet-road reflections: screen-space or planar reflections, or a roughness/normal treatment.
- Puddle placement and depth.
- **Wheel splashes** and spray.
- **Large-puddle screen splash** with the water draining down the screen: a full-screen post-process or overlay.
- Water streaks on the camera or screen.
- Rain audio: there is none in the files.
- Lightning or light changes, if wanted.

---

## 10. Performance findings

### VERIFIED FACT

**Largest files (MB):**

| File | MB |
|---|---:|
| after_the_rain | 206.5 |
| times square | 156.6 |
| cyberpunk_city | 119.2 |
| female | 116.5 |
| cyberpunk_character | 74.9 |
| post-apocalyptic_city | 65.6 |

**Highest-poly assets (triangles):**

| Asset | Triangles |
|---|---:|
| female (audience) | 1,970,634 |
| cyberpunk_city | 1,788,188 |
| times square | 1,257,909 |
| after_the_rain | 962,642 |
| honda_pcx | 463,852 |
| ruffle dress | 442,569 |
| scifi_girl | 326,973 |
| bmw | 313,174 |
| post-apocalyptic | 278,820 |

**Largest texture consumers (estimated GPU MB, uncompressed):**

| Asset | MB |
|---|---:|
| times square | 1,962.7 |
| after_the_rain | 1,600.3 |
| cyberpunk_character | 597.3 |
| female | 512.0 |
| cyborg_oni | 437.3 |
| hover bike | 341.3 |
| tron_character | 277.3 |
| post-apocalyptic | 213.3 |

**Draw-call hot spots:**

- **Bikes:** BMW has 117 draw calls and Honda 118, per bike. With up to 10 players that's more than 1,000 draw calls just for those bikes.
- **Environments:** after_the_rain 134, katana 30, cyberpunk_city_-_1 30.

**Skinned meshes:**

- BMW skins 113 mesh nodes to 46 bones.
- The ruffle dress has 442k skinned triangles.

**Chunked geometry:** meshes split at 65,535 vertices appear in female, cyberpunk_city, times square, post-apocalyptic, scifi girl and after_the_rain. These files use 16-bit indices.

### Classification summary (verified reasons in §3)

- **PASS:** BIKE_05_TRON_LIGHT_CYCLE, CITY_02_CYBERPUNK_DIORAMA.
- **PASS WITH OPTIMIZATION:** AUDIENCE_01, AUDIENCE_04, BIKE_01_BMW, BIKE_02_HONDA, BIKE_03_HOVER, RIDER_05_BLACKGUARD, CITY_03_POST_APOCALYPTIC, RACE_STARTER_CYBORG_ONI, all four weapons, WEATHER_02_RAIN_DROPS.
- **HIGH RISK:** AUDIENCE_03, AUDIENCE_05, BIKE_04_MONOBIKE, RIDER_04_TRON_CHARACTER, CITY_01_CYBERPUNK_SKYLINE, CITY_CORE_TIMES_SQUARE.
- **UNSUITABLE AS-IS:** AUDIENCE_02_FEMALE_TRIPO, RIDER_01_CAT_EARS, RIDER_02_FUTURISTIC_BIKER, RIDER_03_SCIFI_GIRL, WEATHER_01_AFTER_THE_RAIN.

### Likely bottlenecks (derived from verified numbers)

**Mobile:**

- Texture memory: several single assets exceed 400 MB uncompressed, and 8K textures may not upload at all.
- Bike draw calls × 10 players.
- Skinned crowd.
- Transparent overdraw: the scifi girl's blended meshes, rain planes, glass.
- Download size: about 1 GB raw.

**Desktop:**

- Draw calls from the multi-part bikes.
- Times Square + After the rain texture memory, if both are loaded.
- 2M-triangle static audience meshes.

### RECOMMENDATION (not executed)

- **Lazy loading:** load per race and per selection. Only load the bikes, riders and weapons that were chosen, and stream environment parts.
- **LOD:** 2–3 levels for bikes, riders and crowd; impostors for distant crowd and skyline.
- **Textures:** resize to at most 2048 (mobile ≤1024 for props), compress to KTX2/Basis, delete the black and duplicate Times Square 8K textures, and pack ORM maps.
- **Mesh simplification:**
  - `female.glb` ≥50×;
  - ruffle dress, Honda and BMW about 4–10×;
  - cyberpunk_city: drop the LINES primitives.
- **Instancing:** street furniture after spatial split; crowd via instanced impostors or vertex-animation textures.
- **Animation optimisation:** resample and compress clips; strip unused channels such as the Oni sword translations if they aren't needed.
- **Selective scene loading:** use node-name filtering on Times Square, e.g. load the road `Object_32` independently.
- **Culling:** spatially split the merged-by-material meshes so frustum culling works.
- **Shadows:** dynamic shadows only for bikes and riders, baked or none for the city, and none for the crowd.

---

## 11. Compatibility risks (verified causes)

1. **Spec-gloss required with no fallback:** monobike, scifi girl and After the rain would render untextured or white in current three.js unless converted.
2. **8192² textures:** Times Square ×4 and female ×1 exceed common mobile `MAX_TEXTURE_SIZE` (4096).
3. **Inconsistent units and axes:**
   - Heights range from 0.053 (futuristic biker) to 929 (Tron character) and 1,229 (Blackguard's whole-file box).
   - Bike forward axes differ: −Z, +X and +Z.
   - Weapon origins vary: origin in the grip for the machete, at the handle end for the morning star, about 5.7 units from the grip for Zabimaru.
4. **Stray, displaced skinned parts** in Blackguard (up to about 1,180 units away) will distort bounds and culling unless hidden.
5. **LINES primitives** in cyberpunk_city: many engines ignore them or draw them as 1-px lines.
6. **Material extensions:** clearcoat, transmission and specular need engine support; three.js supports them in `MeshPhysicalMaterial`, at extra cost.
7. **Whole-body BLEND materials:** female_character has one (sorting and overdraw).
8. **Clip time offset:** Oni `clip` keys start at t=1.0 s.
9. **Unreadable node names:** the rain-drops node names are stored as U+FFFD replacement characters.
10. **Licensing and IP:**
    - Non-commercial licences on 6 assets.
    - Real trademarks in the Times Square billboards.
    - Third-party IP designs: TRON, Bleach, BMW and Honda.
    - Material names such as `desirefx.me` and `.rip` mesh names suggest uncertain provenance for two riders.

---

## 12. Missing capabilities (verified absent)

- **Rider animations:** riding or seated pose, steering lean, melee swings, kick, crash/ragdoll, get-up, walk or run back to the bike, bike lift, remount.
- **Crowd animations:** cheer, clap, idle variety. Only one idle exists (ruffle dress).
- **Rigs** on 4 of 5 riders and 2 of 5 audience members.
- **Weather motion:** any rain particle system, puddle geometry, splash assets or screen-water assets.
- **Animated billboards:** none, whether UV-animated, video or flipbook.
- **Track loop:** no closed road loop in Times Square.
- **Monobike parts:** no separate wheel node; the islands can be split.
- **Zabimaru:** no per-segment structure and no sealed form.
- **Collision:** no collision proxies or physics data in any file.
- **Audio:** none in any file.
- **Other:** no LODs, no lights, no cameras.

---

## 13. Assets requiring preprocessing later (recommendation)

| Asset | Required preprocessing |
|---|---|
| Times Square | texture reduction + KTX2; remove black and duplicate 8K textures; spatial split of merged meshes; collision proxies; logo replacement (legal) |
| After the rain | only if used: spec-gloss→metal-rough conversion, heavy texture reduction, extraction |
| Monobike | spec-gloss conversion; split tyre+rim islands to a pivoted node; scale |
| Scifi girl | spec-gloss conversion; remove ground plane; reduce blended meshes; rigging |
| Cat ears, futuristic biker, Tron character | rigging (+ de-duplication and scale for futuristic biker; scale for Tron) |
| Blackguard | hide/remove stray `Object_9/11/13/14`; add animation set |
| female.glb | decimation + rig, or drop |
| Ruffle dress | skinned decimation; re-origin |
| cyberpunk_character | texture reduction; scale; bone retarget map |
| BMW, Honda | draw-call merging, decimation, LOD, scale/orientation normalisation |
| Hover bike, Oni, machete, post-apocalyptic, cyberpunk_character | texture reduction/compression |
| Morning star, katana, Zabimaru | scale/pivot normalisation; katana: isolate one sword; Zabimaru: segment split |
| cyberpunk_city | drop LINES, decimate or impostor |
| Rain drops | re-centre; shader animation |

---

## 14. Assets usable immediately (recommendation, based on verified facts)

These can load in a WebGL runtime without file changes, given load-time transforms (scale, axis, origin) and, for textures, acceptance of current memory cost on desktop:

- **TRON light cycle:** full wheel and handle bones, emissive recolour.
- **Honda PCX:** wheel pivots and a spin clip. Heavy, but works on desktop.
- **BMW S1000RR:** a bone rig. Heavy draw calls on mobile.
- **Hover bike:** idle clip.
- **Blackguard:** Mixamo rig; hide 4 stray nodes by name at runtime.
- **Ready Player Me:** crowd template, Mixamo-compatible.
- **Cyborg Oni:** landing clip.
- **Weapons:** machete (origin in grip), morning star (rigged chain, scale 0.01), katana (select one node set at runtime).
- **Times Square road mesh:** `Object_32`, loaded selectively. Desktop only until the textures are reduced.
- **cyberpunk_city_-_1**, as background.
- **Textures from rain drops and post-apocalyptic city**, as shader inputs.

---

## 15. Open questions that can't be answered from the files

1. **Real-world units** for Times Square, the hover bike, the monobike, the katana, Zabimaru, cyberpunk_city and the Tron character. Only ratios are known.
2. **Intended facing** of the Oni in its rest pose, and exact facing for assets where it's inferred with medium or low confidence.
3. **Licences:**
   - Whether non-commercial licences (6 assets) and third-party IP (TRON, Bleach, BMW, Honda, Times Square brand logos) are acceptable for the product's distribution.
   - Whether the `desirefx.me` and `.rip` provenance of two rider meshes is acceptable.
4. **Unidentified parts:** what Blackguard's displaced parts are meant to be (helmet? baton? cable?) and whether they belong on the character.
5. **Katana scabbards:** whether the `Cube` objects are scabbards; this is visual interpretation only.
6. **Texture tiling:** whether the post-apocalyptic wet-road texture tiles seamlessly. It was checked visually, not measured.
7. **GPU memory on real devices:** it depends on engine, compression and texture limits; the figures above are uncompressed estimates.
8. **Crowd pose:** whether the audience should be animated at all, or can be static. That's a design decision.
9. **Monobike wheel:** the tyre and rim islands were found, but whether every wheel-attached detail (spokes, hub) is a clean island was not exhaustively verified.
