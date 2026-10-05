# PIZZERIA ROADRASH — PROJECT BRAIN

This file is the persistent context for the implementation phase.

- **Section A** lists the fixed product requirements exactly as given. Nothing has been added.
- **Section B** contains only findings proven by the asset audit of 2026-09-26.

Companion files:

- `ASSET_AUDIT.md`: full forensic report.
- `ASSET_MANIFEST.json`: machine-readable per-asset data with stable logical IDs.

**Status:** pre-production. No game code exists. **All 26 source assets are unmodified**: SHA-256 hashes match before and after the audit.

---

## A. FIXED PRODUCT REQUIREMENTS

- **Platform**
  - Browser playable.
  - Installable PWA.
  - Fullscreen landscape support.
- **Multiplayer**
  - LAN multiplayer.
  - Maximum 10 players.
- **Setting and genre**
  - Cyberpunk rainy nighttime city.
  - Road Rash-inspired race/combat gameplay.
- **Player setup**
  - Character selection.
  - 3 color choices per character.
  - Player name selection.
  - Bike selection.
  - 3 color choices per bike.
  - Bikes have different acceleration/handling characteristics.
  - All bikes ultimately share the same gameplay top-speed target.
  - Melee selection.
- **Keyboard controls**
  - Space = kick.
  - Enter = melee attack.
  - Arrow keys = bike movement.
- **Cheat**
  - Keyboard-only secret cheat sequence: `xyzzyspoon` followed by `Shift+1`.
  - The cheat grants 10 speed-boost charges.
  - Intended boost behaviour includes reaching full speed in approximately one second.
- **Track**
  - The custom race track must contain significant bends.
  - The track must contain two intentionally useful long straight boost opportunities.
- **Collisions and crashes**
  - Collisions with relevant street/world objects.
  - Audience collision disabled.
  - Crashes can eject the rider.
  - The rider must recover, return to the bike, lift/remount it, and continue.
- **Race start**
  - Synchronized cinematic race start.
  - Cyborg Oni is intended as race starter.
- **Weather and visuals**
  - Constant rain with changing intensity.
  - High-intensity rain regions may contain substantial puddles.
  - Large puddle crossings should create a lower-screen water/splash effect that subsequently drains/runs away.
  - Wet streets/reflections are important to the visual identity.
  - Animated cyberpunk advertising/billboards/holographic-style elements.
- **Crowd**
  - Crowd density should reflect city density.
  - Obvious adjacent duplicate crowd appearances should be avoided.
- **Weapons**
  - Zabimaru is intended to be the longest melee weapon and expand during its attack if technically feasible.

---

## B. VERIFIED TECHNICAL KNOWLEDGE

Legend: **[V]** means verified from the files. **[UNRESOLVED]** means it can't be determined from the files. Anything marked "Recommendation" is advice only and hasn't been done.

### B1. Global file facts [V]

- 26 GLB files, all glTF 2.0 (Sketchfab exports), all parse and all import into Blender 5.2.1. The total is 1,050,404,120 bytes.
- All textures are embedded: 403 PNG or JPEG images, all of which decode.
- No file contains cameras, lights, audio, morph targets, Draco or meshopt compression, or KTX2 textures.
- Every file's root node `Sketchfab_model` has a matrix that converts a Z-up source to glTF Y-up, sometimes with a scale factor. After that, **+Y is up for every asset**.
- Units, forward axis and origin are **inconsistent across assets**. Every asset needs a load-time normalisation transform: scale, rotation to a common forward axis, and an origin offset. The per-asset values are below and in the manifest.
- **KHR_materials_pbrSpecularGlossiness is *required* with no metal-rough fallback** in `BIKE_04_MONOBIKE_DRAGONSEEKER`, `RIDER_03_SCIFI_GIRL` and `WEATHER_01_AFTER_THE_RAIN`. Current three.js (r147+) doesn't support it, so these render untextured unless converted.
- **Other material extensions in use:** clearcoat (BMW, Oni, cyberpunk_city_-_1, rain drops), transmission (Honda, Oni), specular, and emissive_strength.
- **Licences embedded in the files:**
  - CC-BY-NC-SA-4.0: BMW, scifi girl, female_character, Ready Player Me.
  - CC-BY-NC-4.0: machete, After the rain.
  - CC-BY-4.0: all others (attribution required).
  - [UNRESOLVED] Whether the non-commercial licences, the third-party IP designs (TRON, Bleach, BMW, Honda) and the real trademarks on the Times Square billboards are acceptable.

### B2. Usable assets and their verified capabilities

**Riders (Characters)**

| ID | Rig | Status |
|---|---|---|
| `RIDER_05_TRON_BLACKGUARD` | **66-joint Mixamo (`mixamorig:*`), T-pose**, full fingers | **The only rigged rider.** Body mesh `Object_7` is 1.87 units tall, feet at y≈0. Skinned parts `Object_9`, `Object_13`, `Object_14` (≈46–59 units below) and `Object_11` (a coiled cable ≈1,180 units below) are displaced and must be hidden by node name. Its clip `mixamo.com` is a 0 s pose. |
| `RIDER_04_TRON_CHARACTER` | none (static) | Bind-like pose, a good auto-rig candidate. 929 units tall. |
| `RIDER_03_SCIFI_GIRL` | none | Spec-gloss required. About 196k triangles of blended overlay meshes plus a ground plane. |
| `RIDER_01_CAT_EARS` | none | Sculpted non-bind pose (hands together). 2.88 tall. |
| `RIDER_02_FUTURISTIC_BIKER` | none | Sculpted pose. **Duplicate body mesh.** 0.053 tall. |

- [V] **No rider file has riding, melee, kick, crash, get-up, walk or remount animations.**
- [V] Four of five riders cannot be posed or animated without rigging.

**Audience**

| ID | Rig | Notes |
|---|---|---|
| `AUDIENCE_04_READYPLAYERME_CYBERPUNK` | 66 joints, Mixamo names without prefix | 18.5k tris. **Per-part materials** (easy recolour). 1.89 tall. No clips. |
| `AUDIENCE_05_RUFFLE_DRESS_FEMALE` | 66 Mixamo | **16.633 s idle `mixamo.com`.** 442,569 tris (heavy). Origin at mid-body. |
| `AUDIENCE_01_CYBERPUNK_CHARACTER` | 56 custom-named | 0 s `A-pose` clip. 3.02 tall. 7 × 4096² textures. |
| `AUDIENCE_02_FEMALE_TRIPO` | none | T-pose, **1,970,634 tris**, 8192² texture. |
| `AUDIENCE_03_FEMALE_CHARACTER_HORNED` | none | A-pose-like. Whole body uses one BLEND material. |

**Bikes.** All values are native file units. See the full table in ASSET_AUDIT §4.2.

- **`BIKE_01_BMW_S1000RR`**
  - Forward −Z.
  - 46-bone rig: `wheel_lf_23` (front, centre (−0.002,−0.177,−0.848)), `wheel_lr_29` (rear, (−0.021,−0.157,0.806)), `forks_u_25` and `forks_l_24` (≈23° rake), `handlebars_21`, `swingarm_30`, `seat_32` (−0.002,0.407,0.359).
  - Grips `hbgrip_l_17` (−0.366,0.443,−0.438) and `hbgrip_r_18` (0.323,0.456,−0.445).
  - Ground at y≈−0.51, so the origin is *not* on the ground.
  - Paint material `vehicle_generic_smallspecmap_PRIMARY` is a colour factor.
  - 117 draw calls, 313k tris.
- **`BIKE_02_HONDA_PCX`** (a scooter)
  - Forward +X, metre scale (1.91 long).
  - Wheel groups `Dianteira_46` (front, (0.715,0.255,−0.011)) and `Traseira_97` (rear, (−0.573,0.253,−0.010)) have centred pivots.
  - Clip `Animation` (10 s: wheels spin 10 revs) and clip `banco.002Action` (0.833 s: seat opens 70°).
  - There's no common steering pivot node.
  - Seat top y≈0.80. Grips ≈(0.27, 1.03, ±0.30…0.38).
  - Paint material `Body` is a colour factor.
  - 118 draw calls, 464k tris.
- **`BIKE_03_HOVER_ROCKET`**
  - No wheels. Rigid parts are parented to joints.
  - Clip `Armature|Idle` (1.967 s, loopable: fans spin, wings flutter, 0.2-unit bob).
  - 845 units long; unit [UNRESOLVED].
  - The craft floats 17 units above its origin.
  - Forward +X is inferred from the layout (medium confidence).
- **`BIKE_04_MONOBIKE_DRAGONSEEKER`**
  - One node, and it requires spec-gloss.
  - The tyre and rim are separable connected islands centred at (0,0.376,0), r≈0.385, but not a node.
  - Forward +Z (medium confidence).
- **`BIKE_05_TRON_LIGHT_CYCLE`**
  - Forward +Z, ground y=0.
  - Bones `Front_Tire_02` (0,0.391,0.936), `Rear_Tire_04` (0,0.385,−0.859), `L_Handle_06`/`R_Handle_07` (handle ends at (±0.204,0.779,0.753)), `Hood_05`, and the speed brakes.
  - Emissive `Glow` (recolourable factor).
  - Clip `Argon_LightCycle|Argon_LightCycleAction` (11.25 s, rear engine spins).
  - The riding position is prone under a canopy.
  - 1.8 MB, 34.8k tris.

**Weapons**

- **`WEAPON_01_MACHETE`:** 0.50 long, metre-like. Blade toward −X. **Origin is inside the grip** (handle x −0.084…0.083). 3k tris.
- **`WEAPON_02_MORNING_STAR`:** a flail, 93 units long (likely cm). Origin at the handle end. **12-bone chain rig** (Handle, Chain…Chain.7, Ball). Ball at z≈−78.8.
- **`WEAPON_03_KATANA`:** the file contains **two swords and two scabbard-like objects**. The handle primitive `Corp_4` is centred at (0,0.286,−1.194), and the blade runs along +Z. The clip `Take 01` (6.667 s) is decorative only.
- **`WEAPON_04_ZABIMARU`**
  - Modelled **already extended**. It is **6 blade segments stored as disconnected islands** inside 2 primitives under 1 node, with no bones and no clips.
  - Segment centres:

    | Segment | Centre |
    |---|---|
    | 1 | (0.058,2.684,0.153) |
    | 2 | (−0.49,0.248,1.01) |
    | 3 | (−1.873,−1.311,2.572) |
    | 4 | (−3.896,−1.531,3.905) |
    | 5 | (−5.893,−0.708,4.235) |
    | 6 | (−7.497,0.412,3.638) |
    | tip | (−8.333,1.034,3.331) |

  - Handle island centre (0,5.708,0), 1.235 long. **The origin is about 5.7 units from the grip.**
  - Blade arc ≈15.2 units, straight reach ≈9.8 units, about 12× the handle length.
  - No sealed or compact form exists.

**Race starter: `RACE_STARTER_CYBORG_ONI`**

- **Rig:** 98 joints: hips/waist/chest, head, eyes, hair chains, full fingers, wings (pitch/fold), boosters, tail, swords and sword hinges. The rest pose is an A-pose (34°).
- **Clip `clip`** (duration 6.333 s, **keys from 1.00 to 7.33 s**):
  - fly-in from about 14–15 units away and about 1.7 units above rest height;
  - **landing crouch at about 4.5 s**;
  - stands;
  - arm raised to head at about 5.9 s;
  - ends with an arm extended holding a blade sideways at about 7.3 s.
- **Clip `pose`** (0 s) is a static pose.
- There is no walk or locomotion cycle.
- 34k tris; 31 textures, about 437 MB uncompressed.

### B3. City and road capabilities [V]

**`CITY_CORE_TIMES_SQUARE`**

- **Scale:** a miniature, 29.84 × 20.54 × 15.74 units. [UNRESOLVED] real scale. The ratios suggest roughly 10–13 m per unit.
- **Road mesh:** node `landscape_02_landscape_01_0_19` / mesh `Object_32`, material `Material.003`, 2,976 tris.
  - It is **one separate mesh containing all roads and sidewalks**.
  - Roadway is at y≈0.000–0.003 and sidewalks at y≈0.006–0.009, with 1,022 curb faces.
  - Lane markings and crosswalks are baked into the 4096² base texture (image 5).
- **Network:**
  - Main east-west road: x −12.62…17.12, z −1.01…0.12 (≈29.7 × 1.13).
  - Six north-south cross streets spanning z −7.91…7.25, at x≈−8.37…−7.27 (w 1.10), −3.02…−2.38, 1.76…2.40, 6.50…7.16, 11.30…11.96 and 16.06…16.74 (w≈0.64–0.68).
  - A diagonal spur runs from the west edge into cross street 1.
  - There are 6 four-way junctions.
  - **No closed loop** exists, because every road exits the map edge.
- **Everything else** (buildings, street furniture, signs) is **merged by material across the entire scene**, so it can't be loaded selectively or culled per building. Road pieces aren't modular.
- **Emissive materials:** `Material.007`, `Material.001`, `Material.008` and `Material.002` (billboard atlases, strength 1.5–2.0), and `white_neon` (pink, strength 2.0). **The billboards are static** and contain **real brand logos**.
- **Cost:**
  - 1,257,909 tris, 68 draw calls.
  - About 1,963 MB of textures uncompressed, including **four 8192² images**.
  - Image 2 is **all black**, and image 8 **duplicates** image 7.
  - Blender's textured render ran out of host memory.

**Other city files**

- **`CITY_03_POST_APOCALYPTIC`:** its road mesh `Object_8` uses the material **`8k_Wet_road_with_puddles`**, with 2048² base, metallic-roughness and normal maps: wet asphalt with lane lines and puddle roughness variation. The theme is industrial ruin.
- **`CITY_01_CYBERPUNK_SKYLINE`:** 1.79M tris plus 16 LINES primitives. 68 chunks each span the whole city (44,837 × 89,572 units), and the blocks are visibly repeated. Suitable only as a far skyline.
- **`CITY_02_CYBERPUNK_DIORAMA`:** a 9 × 3 × 9-unit untextured stylised diorama with 8 colour emissives. Cheap.

### B4. Weather capabilities [V]

**Supplied by the files:**

- A static rain-streak texture (512 JPEG emissive plus 512 PNG with alpha) on vertical planes (`WEATHER_02`).
- A 1024² **rain-ripple normal map** (`WEATHER_02`).
- A clearcoat wet ground quad (`WEATHER_02`).
- The wet-asphalt/puddle material set (`CITY_03`).
- A wet-cobblestone reference look in spec-gloss (`WEATHER_01`, not renderable as-is).

**Not in any file, so it needs runtime code, shaders or VFX:**

- Falling rain and intensity variation.
- Animated ripples.
- Puddle geometry or placement.
- Wet reflections.
- Wheel splashes.
- The lower-screen splash and drain effect.
- Screen water streaks.
- Rain audio.

**Rain-drops placement:** `WEATHER_02` is centred at about (−21,909, 322, 16,674) and has unreadable (U+FFFD) node names.

**After the rain:** `WEATHER_01` is a cobbled European street, 962k tris and 172 images (about 1.6 GB). **Not suitable at runtime.**

### B5. Recolour feasibility (3 variants) [V basis]

- **Easy, using material colour or emissive factors:**
  - BMW (`vehicle_generic_smallspecmap_PRIMARY`);
  - Honda (`Body`);
  - light cycle (`Glow`);
  - Ready Player Me (per-part materials);
  - Blackguard and Tron character (emissive trim).
- **Atlas-baked, so a hue-shift or tint shader or authored masks are needed:**
  - hover bike, monobike;
  - cat ears, futuristic biker;
  - cyberpunk_character, female, female_character, ruffle dress.

### B6. Recommended attachment and mount points (Recommendation; derived from [V] data above)

- **Weapon to hand:**
  - Attach to `mixamorig:RightHand_035` (Blackguard), `RightHand_47` (Ready Player Me) or `CyberdemonRig:JNT_wrist_r_042` (Oni).
  - Weapon grip offsets:
    - **machete:** origin is at the grip;
    - **morning star:** grip ≈ 10–20 units down the handle from the origin at the handle end;
    - **katana:** `Corp_4` centre;
    - **Zabimaru:** handle island centre (0,5.708,0).
- **Rider to bike:**
  - **Hips:** BMW `seat_32`/`seat_f_16`; Honda seat top (≈−0.15,0.80,0); light cycle prone under `Hood_05`.
  - **Hands, via IK to grips:** BMW `hbgrip_l/r`; light cycle `L/R_Handle_end`; Honda handlebar extremes.
  - **Hover bike and monobike:** mount points must be calibrated manually. There are no named seat or grip nodes.
- **Wheel spin:** BMW wheel bones, Honda `Dianteira_46`/`Traseira_97`, light cycle tire bones. Monobike needs the island split first.
- **Steering:** BMW fork and handlebar bones. Honda needs a runtime pivot group. The light cycle has no steer bones.

### B7. Verified performance concerns

- **Texture memory:** about 6.8 GB uncompressed across all assets. The biggest are Times Square (1,963 MB), After the rain (1,600), cyberpunk_character (597), female (512), Oni (437), hover bike (341) and Tron character (277).
- **8192² textures** (Times Square ×4, female ×1) exceed common mobile `MAX_TEXTURE_SIZE` (4096).
- **Draw calls:** BMW 117 and Honda 118 per bike, which is more than 1,000 draws for 10 players unless merged.
- **Heavy meshes:** female 1.97M, cyberpunk_city 1.79M, Times Square 1.26M, After the rain 0.96M, Honda 464k, ruffle dress 442k (skinned).
- **Merged-by-material city meshes** defeat frustum culling.
- **Transparent overdraw:** scifi girl (about 196k blended tris), female_character (whole-body BLEND), rain planes.

### B8. Preprocessing requirements (Recommendation)

- **All textured assets:** texture resize and KTX2 compression. Delete Times Square image 2 (black) and image 8 (duplicate).
- **Spec-gloss → metal-rough conversion:** monobike, scifi girl (and After the rain, if it's used at all).
- **Rigging:** cat ears, futuristic biker (+ remove duplicate body), scifi girl, Tron character, and the static audience members if they are to animate.
- **Shared humanoid animation set** on a Mixamo-compatible skeleton:
  - **Native fit:** Blackguard, Ready Player Me, ruffle dress.
  - **Retarget map needed:** cyberpunk_character, Oni.
- **Decimation / LOD:** female, ruffle dress, Honda, BMW, cyberpunk_city (drop LINES).
- **Zabimaru:** split the 6 segments into a transform or bone chain (can be done at load time on a copy).
- **Times Square:** spatially split the merged meshes, add collision proxies, deal with the logos.
- **Normalisation table** (scale, forward, origin) per asset.

### B9. Unresolved matters

1. Real units for Times Square, the hover bike, monobike, katana, Zabimaru, cyberpunk_city and Tron character.
2. Facing of Oni, hover bike and monobike (medium or low confidence), and of the audience/rider meshes marked medium.
3. Licence and IP acceptability (see B1).
4. What Blackguard's displaced parts are meant to be.
5. Whether the katana's `Cube` objects are scabbards.
6. Whether the post-apocalyptic wet-road texture tiles seamlessly.
7. Actual GPU memory and performance on target phones; the figures here are uncompressed estimates.
8. Track topology: Times Square has no loop. How to close the circuit is a design decision for the next phase.
