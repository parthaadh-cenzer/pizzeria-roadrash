# Pizzeria Roadrash --- Implementation Contract

This document defines how the locked design is implemented. It does not
authorize redesign.

## 1. Stack

Use: - TypeScript - Three.js - Rapier 3D physics - Node.js + Express -
Socket.IO - Vite - HTML/CSS overlay UI - PWA manifest + service worker

Avoid React unless a concrete existing codebase requirement makes it
necessary. Keep gameplay/render/network systems framework-independent.

## 2. Repository layout

Recommended structure:

``` text
/
├─ Assets/                         # immutable source assets
├─ HANDOFF/
│  ├─ 00_READ_FIRST.md
│  ├─ 01_LOCKED_GAME_SPEC.md
│  ├─ 02_TRACK_BLUEPRINT.md
│  ├─ 03_GAMEPLAY_CONSTANTS.md
│  ├─ 04_ART_DIRECTION.md
│  ├─ ARTBOARD.png
│  └─ reference/
├─ IMPLEMENTATION_CONTRACT.md
├─ CLAUDE_START_PROMPT.md
├─ tools/
│  └─ asset-pipeline/
├─ public/
│  └─ runtime-assets/
├─ src/
│  ├─ client/
│  ├─ server/
│  ├─ shared/
│  ├─ game/
│  ├─ render/
│  ├─ physics/
│  ├─ network/
│  ├─ input/
│  ├─ ui/
│  ├─ audio/
│  └─ config/
└─ tests/
```

The implementation may refine internal source folders, but must preserve
separation of shared protocol/config, client presentation, and
authoritative server simulation.

## 3. Required scripts

Provide at minimum: - `npm run assets:build` - `npm run assets:verify` -
`npm run dev` - `npm run dev:secure` - `npm run build` -
`npm run test` - `npm run typecheck`

`dev:secure` is the recommended mobile/PWA LAN mode.

## 4. Asset pipeline

Never mutate `Assets/`.

Pipeline responsibilities: - inspect source asset existence - normalize
scale/orientation/origin - convert unsupported spec-gloss materials to
metallic/roughness - downscale/compress oversized textures - produce
KTX2/Basis where appropriate - pack compatible ORM textures where
useful - decimate/LOD heavy meshes - merge safe static
meshes/materials - preserve animated pivots/bones - convert/prepare FBX
animation clips for runtime - generate deterministic runtime filenames -
emit runtime manifest with dimensions, orientation, mount targets, LODs,
material variants, animation bindings, and source hash - fail loudly on
missing required source assets

Do not directly serve raw GLBs/FBXs from `Assets/`.

### Known special processing

-   Blackguard: remove/hide displaced stray skinned parts.
-   Scarlet Proxy: spec-gloss conversion, skin/face atlas treatment,
    remove included sword, retarget map.
-   Cyberpunk Enforcer: scale normalize, texture downscale/compression,
    custom retarget map.
-   ReadyPlayerMe Mohawk: shared Mixamo-style animation compatibility.
-   Akira Cruiser: aggressive LOD/decimation/material merge while
    preserving wheel assemblies/emissives.
-   Monobike: spec-gloss conversion, split wheel/rim into procedural
    pivot, texture optimization.
-   Hover Rocket: texture optimization; preserve idle vent/flap
    animation.
-   Hovering Engine: merge safe static meshes; preserve rotating
    cylinders/flames; boost flame tied to cheat boost.
-   Sci-Fi Motorcycle: preserve articulated steering/wheel bones; do not
    loop entire showcase clip.
-   TRON Light Cycle: preserve tire/handle bones and prone mount
    profile.
-   Oni: trim/offset initial dead time; preserve landing clip;
    procedural countdown extension.
-   Zabimaru: split hilt/segments/tip and construct runtime
    retract/extend attack.
-   Katana: isolate one gameplay sword, remove duplicate/scabbard, merge
    unnecessary primitives.
-   Future Tunnel: create reusable optimized module/instance setup.
-   Bridge kit: optimize/instance modules; custom road remains
    authoritative.
-   Times Square: remove useless oversized/duplicate texture content
    where verified, spatially partition where practical.
-   Cyberpunk skyline: drop line primitives and use as distant skyline
    only.
-   `after_the_rain`: reference/material source only; never whole-scene
    runtime load.

## 5. Shared typed configuration

All locked gameplay constants must live in typed shared config. Avoid
magic numbers in systems.

Define IDs/enums for: - riders - bikes - weapons - weather intensity -
race state - player state - attack state - crash/recovery state -
checkpoints - graphics preset

## 6. Game state machines

### Global

`BOOT -> ASSET_CHECK -> MENU -> LOBBY -> LOADOUT -> READY -> INTRO -> COUNTDOWN -> RACING -> FINISHING -> RESULTS`

### Rider

`RIDING -> ATTACKING/KICKING -> DESTABILIZED -> RAGDOLL -> SETTLING -> GETTING_UP -> RUNNING_TO_BIKE -> LIFTING -> REMOUNTING -> RIDING`

### Race

Server owns: - lobby membership - ready state - future start timestamp -
GO tick - ordered checkpoint validity - race progress - finish time -
DNF/disconnect state - results order

## 7. Physics

Rapier simulation target: 60 Hz fixed step.

Use simplified colliders for bikes, riders during riding, track,
barriers, puddle triggers, checkpoints, and attack volumes.

Visual meshes never become full-resolution physics colliders by default.

Bike controller should combine stable arcade racing behavior with
physical collisions. It must remain controllable at 80 m/s physics max.

World units after normalization are meters.

## 8. Rider IK and animation

Create a common semantic humanoid layer independent of source bone
names.

Per-rider retarget maps convert source rigs to semantic bones.
Mixamo-compatible riders share animation mapping; custom rigs require
explicit mapping/rest-pose correction.

Riding is procedural/IK: - pelvis to seat - hands to grips - feet to
pegs - spine lean - steering/lean response

Melee is upper-body layered where possible.

Kick is procedural and mirrored left/right.

Crash is ragdoll.

Get-up chooses face-up/face-down animation.

Lift/remount are procedural IK/state sequences using bike-specific
targets.

Light Cycle uses its own prone riding profile.

## 9. Networking

Host-authoritative.

Transport: - Socket.IO over LAN - HTTPS/WSS in secure mobile mode

Rates: - server physics 60 Hz - input 30 Hz - snapshots 20 Hz - remote
interpolation \~100 ms

Local player: - immediate local input/prediction - authoritative
reconciliation

Remote players: - snapshot interpolation - short extrapolation only when
necessary - correction rules from gameplay constants

Server validates: - race start - checkpoint sequence - finish - combat
eligibility/contact - crash state - cheat activation/charges -
recovery/respawn

Never trust a client-reported finish or hit as authoritative.

## 10. LAN hosting and secure mobile mode

The host process binds to an accessible LAN interface and displays: -
local LAN URL - QR code - secure LAN URL when secure mode is active

No cloud relay is required.

Because mobile motion/PWA/fullscreen capabilities may depend on browser
security policy, provide `dev:secure` with a locally trusted HTTPS
certificate workflow.

Requirements: - document one-time certificate setup/trust steps - use
WSS under secure mode - detect insecure context on phone - show a clear
diagnostic instead of silently failing gyro/PWA features - gameplay
remains on the local LAN

Do not hard-code one host IP.

## 11. Mobile input

Primary: - auto acceleration - gyro tilt steering - KICK button - HIT
button - landscape fullscreen

`ENTER RACE` is the permission/calibration gesture.

Implement: - feature detection - permission request where required -
neutral calibration - deadzone - smoothing - sensitivity setting -
orientation change handling - safe-area CSS - fallback touch LEFT/RIGHT
zones

No normal mobile boost control.

Fullscreen/orientation-lock failure is non-fatal; show rotation guidance
when needed.

## 12. Desktop input

Arrow keys + Space + Enter exactly as locked.

Keyboard cheat parser: - race-only - recognizes `xyzzyspoon` - next
`Shift+1` activates/grants 10 charges - server confirms activation -
later `Shift+1` requests charge consumption - rate-limit/validate
server-side

## 13. Track generation

Build the track from the locked centerline anchors and smooth spline.

Generate: - render road - simplified collider - shoulders/curbs -
barrier placement - checkpoint gates - recovery nodes - rain zones -
puddle zones - crowd zones - district dressing anchors - tunnel module
anchors - bridge module anchors - jump launch/landing/recovery nodes

The elevated/bridge topology must not create progress ambiguity.

## 14. Weather/rendering

Implement the shader/VFX rules in `04_ART_DIRECTION.md`.

Weather intensity is data-driven by track region and smoothly blended.

Rendering must support High/Medium/Mobile presets without changing
gameplay.

Do not make post-processing mandatory for basic play; graceful
degradation is required.

## 15. Crowd

Crowd simulation is visual only and must not affect racing physics.

Use: - near optimized characters - mid LOD - far impostors - animation
phase randomization - appearance/color variation - adjacency duplicate
avoidance - sidewalk walker splines

Suppress nearby crowd duplicates of active racer appearances.

## 16. Camera

Implement the locked chase camera, speed FOV, acceleration/brake
offsets, impact shake, screen water, camera collision, and crash
rider-follow behavior.

Camera must never clip through nearby tunnel/bridge/world geometry when
a simple collision correction can prevent it.

## 17. UI

Screens: - main menu - host/join - lobby - loadout - ready - mobile
Enter Race permission/calibration - loading/progress - race HUD -
pause/settings - results - diagnostics/error state

Race HUD: - position - compact minimap/progress - displayed speed -
weapon - boost charges only after cheat activation - subtle connection
indicator

Mobile HUD prioritizes KICK/HIT and safe-area compliance.

## 18. PWA

Provide: - manifest - icons/placeholders generated within project if no
final branding asset exists - landscape orientation preference -
standalone/fullscreen display preference where supported - service
worker

Cache the client shell and stable runtime assets sensibly.

Do not imply offline multiplayer without a host. A cached client still
needs the LAN host/session for multiplayer.

## 19. Audio

Missing source audio must never crash the game.

Create named audio hooks for: - engines per bike class - rain
intensity - tyre spray - impacts - weapon swishes/hits - tunnel
ambience - bridge wind - countdown/GO - crowd - UI

If real audio files are absent, use silence or lightweight procedural
fallback and log a non-fatal warning.

## 20. Loading and errors

Show real loading progress for required runtime assets.

Required gameplay asset missing -\> block race start with explicit
diagnostic.

Optional cosmetic asset missing -\> degrade gracefully and warn.

Never swallow GLTF/material/animation errors silently.

## 21. Performance budgets

Design for 10 racers.

Mandatory: - LODs - texture compression/downscale - crowd impostors -
culling - instancing - limited dynamic lights/shadows - no raw Times
Square 8K texture load - no raw `after_the_rain` scene load - no
full-resolution visual-mesh colliders

Expose a simple debug performance overlay in development mode.

## 22. Reconnect/disconnect

A temporarily disconnected racer may reconnect to the same session
identity within a short grace window if practical.

During disconnect: - server remains authoritative - bike enters safe
neutral behavior - never allow reconnect to duplicate a player

If grace expires, mark DNF/remove according to race state.

## 23. Verification

`assets:verify` must check at least: - all required runtime assets
exist - source hashes recorded - required animation clips exist -
unsupported spec-gloss does not remain in required runtime assets -
required bike mount targets exist - required rider retarget maps exist -
no source asset path is referenced directly by production client -
texture size rules are respected for flagged heavy assets

## 24. Acceptance tests

A completed implementation must demonstrate:

1.  clean `npm install`
2.  `npm run assets:build`
3.  `npm run assets:verify`
4.  TypeScript typecheck passes
5.  tests pass
6.  host starts locally
7.  secure LAN mode starts
8.  QR/LAN URL is shown
9.  phone on same Wi-Fi can join
10. gyro permission/calibration flow works where supported
11. gyro-denied fallback steering works
12. mobile landscape/fullscreen flow degrades gracefully where
    unsupported
13. 10 lobby slots work
14. loadout choices synchronize
15. ready gating works
16. Oni intro is synchronized
17. GO unlocks controls on authoritative tick
18. desktop controls work
19. mobile auto acceleration works
20. KICK/HIT work on mobile
21. all six bikes load and share top speed
22. all four riders can ride/recover
23. all four weapons work
24. Zabimaru retract/extend works
25. secret boost grants/consumes exactly as specified
26. ordered checkpoints prevent shortcuts
27. rain intensity changes by region
28. puddle splash/grip behavior works
29. tunnel transition works
30. broken bridge jump/recovery works
31. results animations/board work
32. no required raw source asset is served from `Assets/`
33. graphics presets preserve gameplay visibility
34. missing optional audio does not crash
35. a generated `PRE_DEPLOYMENT_AUDIT.md` reports pass/fail against this
    list

## 25. Definition of done

Do not stop at scaffolding.

The deliverable is done when a host can run the documented commands, a
phone on the same LAN can join, players can select/load/ready, the
synchronized race can be completed through the locked track, and results
appear without TODO-dependent gameplay.
