# Pizzeria Roadrash --- READ FIRST

This folder is the authoritative implementation handoff for the
browser/PWA LAN motorcycle racing game **Pizzeria Roadrash**.

## Authority order

When documents conflict, use this order:

1.  `01_LOCKED_GAME_SPEC.md`
2.  `02_TRACK_BLUEPRINT.md`
3.  `03_GAMEPLAY_CONSTANTS.md`
4.  `04_ART_DIRECTION.md`
5.  `05_IMPLEMENTATION_CONTRACT.md`
6.  `reference/ASSET_MANIFEST.json`
7.  `reference/ASSET_AUDIT.md`
8.  `reference/PROJECT_BRAIN_HISTORICAL.md`

`PROJECT_BRAIN_HISTORICAL.md` is context only. It contains superseded
decisions and must never override a locked document.

## Source asset rule

`Assets/` is immutable source material. Never modify, overwrite, rename,
delete, or serve raw source assets directly.

Pipeline:

`Assets/ -> tools/asset-pipeline/ -> public/runtime-assets/`

Generated/optimized runtime assets belong only in
`public/runtime-assets/`.

## Visual authority

`ARTBOARD.png` is the visual target for mood, readability, lighting,
rain, wet-road response, neon balance, speed, combat readability, tunnel
mood, bridge mood, and mobile HUD restraint. It is **not** a literal
asset inventory and does not override the actual asset manifest.

`04_ART_DIRECTION.md` translates the artboard into implementation rules
and has authority over shader/post-processing decisions.

## Implementation posture

Do not redesign the product. Do not ask the user to make architecture
decisions already covered here. Resolve ordinary implementation details
in the least surprising way consistent with this handoff.

No TODO placeholders, fake implementations, "coming later" stubs, or
silent asset failures in the completed build.

The intended completion path is:

`npm install -> npm run assets:build -> npm run assets:verify -> npm run dev:secure -> Host Game -> phone joins LAN -> select -> ready -> synchronized Oni intro -> race -> results`

The multiplayer host remains a **local PC/laptop on the same LAN**. No
cloud backend is required for gameplay.
