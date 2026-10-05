# Claude Opus 5.5 --- Start Prompt

You are implementing **Pizzeria Roadrash** in the existing project
directory.

Before writing or modifying implementation code, read these files in
full, in this order:

1.  `HANDOFF/00_READ_FIRST.md`
2.  `HANDOFF/01_LOCKED_GAME_SPEC.md`
3.  `HANDOFF/02_TRACK_BLUEPRINT.md`
4.  `HANDOFF/03_GAMEPLAY_CONSTANTS.md`
5.  `HANDOFF/04_ART_DIRECTION.md`
6.  `IMPLEMENTATION_CONTRACT.md`
7.  `HANDOFF/reference/ASSET_MANIFEST.json`
8.  `HANDOFF/reference/ASSET_AUDIT.md`

Then inspect the actual current `Assets/` tree recursively and reconcile
real filenames with the locked asset identities.

`HANDOFF/reference/PROJECT_BRAIN_HISTORICAL.md` is historical context
only. Read it only if useful; it has the lowest authority and contains
superseded decisions.

Also inspect `HANDOFF/ARTBOARD.png`. Treat it as the visual target for
lighting, wet-road response, rain, neon balance, speed readability,
district mood, combat readability, and mobile HUD restraint. It is not a
literal asset inventory.

## Non-negotiable execution rules

-   Do not redesign the game.
-   Do not ask the user to choose architecture already specified in the
    handoff.
-   Do not modify, rename, delete, or overwrite source files under
    `Assets/`.
-   Build optimized runtime assets through `tools/asset-pipeline/` into
    `public/runtime-assets/`.
-   Never directly serve raw source assets from `Assets/`.
-   Use the locked local-LAN host-authoritative model. Do not introduce
    a cloud gameplay backend.
-   Preserve secure HTTPS/WSS LAN mode for mobile gyro/PWA behavior.
-   Primary mobile control is auto acceleration + gyro steering +
    KICK/HIT in landscape fullscreen, with touch LEFT/RIGHT fallback
    only when gyro is unavailable/denied.
-   Implement the art direction rather than relying on source asset
    default materials.
-   Do not leave TODOs, fake buttons, placeholder gameplay, or
    "implement later" comments in required systems.
-   Missing optional audio may degrade gracefully; missing required
    gameplay assets must fail explicitly.
-   Prefer deterministic data/configuration over hidden magic numbers.
-   Keep gameplay constants centralized and typed.
-   Server owns authoritative race, hit, crash, checkpoint, cheat,
    finish, and result state.

## Work sequence

1.  Audit current repository and actual `Assets/` filenames.
2.  Create/repair project structure and dependency setup.
3.  Implement the deterministic asset pipeline and runtime manifest.
4.  Implement shared types/config/protocol.
5.  Implement authoritative server/session/lobby/network loop.
6.  Implement track spline/generation/checkpoints/recovery nodes.
7.  Implement bike physics/controller and six bike profiles.
8.  Implement rider retargeting/IK/animation/recovery.
9.  Implement combat and four weapons.
10. Implement weather, puddles, camera, shaders, district dressing,
    tunnel, bridge, crowd.
11. Implement desktop input.
12. Implement secure mobile gyro/auto-acceleration/fullscreen flow and
    fallback touch steering.
13. Implement lobby/loadout/ready/UI/HUD/results.
14. Implement PWA/service worker/secure LAN documentation.
15. Implement tests, asset verification, performance diagnostics, and
    graceful error handling.
16. Run build/typecheck/tests and fix failures.
17. Perform the acceptance tests in `IMPLEMENTATION_CONTRACT.md`.
18. Create `PRE_DEPLOYMENT_AUDIT.md` with every acceptance item marked
    PASS/FAIL and concrete evidence/remaining blocker.

Do not merely describe the implementation. Make the changes.

If an actual asset filename differs from the handoff but its identity is
unambiguous, map it in the runtime manifest rather than renaming the
source. If a required asset is genuinely absent after recursive
inspection, continue all independent work and record the exact missing
requirement in the audit instead of inventing an asset.

Start by reading the handoff and inspecting the repository. Then execute
the implementation plan through completion.
