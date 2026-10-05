# Pizzeria Roadrash --- Locked Game Spec

## Product

A browser-playable, installable PWA motorcycle racing/combat game
inspired by the feel of classic Road Rash, presented as a bright, rainy
cyberpunk night race. Up to 10 players join a host computer over the
same local network.

The game must remain readable at speed: dark night does not mean crushed
blacks. Neon, emissive signage, wet reflections, road markings, hazard
lighting, headlights, and atmospheric scattering preserve visibility.

## Platform and session model

-   Host: desktop/laptop on the local Wi-Fi/LAN.
-   Clients: desktop browsers and mobile browsers/PWA on the same LAN.
-   Maximum players: 10.
-   Host-authoritative simulation.
-   No gameplay cloud backend.
-   QR code and displayed LAN address are provided by the host lobby.
-   Secure LAN mode uses HTTPS/WSS so phone sensor APIs and PWA behavior
    have a secure context.
-   A normal non-secure development mode may exist for desktop
    debugging, but phone/PWA testing should use secure LAN mode.

## Core flow

Main Menu -\> Host/Join -\> Lobby -\> Character -\> 3 character colors
-\> Player Name -\> Bike -\> 3 bike colors -\> Weapon -\> Ready -\> Host
Start -\> synchronized race intro -\> race -\> finish -\> results.

Host may start only after every currently participating client is ready
or has been removed from the lobby.

Duplicate rider/bike choices are allowed. Player name, selected colors,
bike, and weapon distinguish players.

## Rider roster

1.  `RIDER_01_BLACKGUARD` --- male armored TRON-style rider.
2.  `RIDER_02_SCARLET_PROXY` --- female sci-fi rider; custom 93-joint
    rig; convert spec-gloss to metallic/roughness; hide/remove included
    sword.
3.  `RIDER_03_CYBERPUNK_MOHAWK` --- ReadyPlayerMe Cyberpunk;
    Mixamo-style rig.
4.  `RIDER_04_CYBERPUNK_ENFORCER` --- Cyberpunk Character; custom rig;
    mandatory scale and texture optimization.

All riders must support riding, steering/lean, melee, procedural kick,
crash ragdoll, face-up/face-down get-up, run to bike, lift, remount, and
results animation.

If a racer appearance is selected, suppress that exact appearance from
the nearby/start-grid crowd.

## Bike roster

All bikes share the same top speed. Acceleration, handling, stability,
geometry, riding pose, and VFX differ.

1.  Sci-Fi Motorcycle
2.  Akira Class Cruiser
3.  Hovering Engine Motorcycle
4.  Hover Rocket
5.  TRON Light Cycle
6.  Monobike Dragonseeker

BMW and Honda are not active roster bikes.

Each bike must define: `seatTarget`, `leftGripTarget`,
`rightGripTarget`, `leftFootTarget`, `rightFootTarget`,
`mountEntryPoint`, `recoveryApproachPoint`, `mountSide`,
`ridingSpineLean`, `ridingHipRotation`.

## Weapons

1.  Machete
2.  Morning Star
3.  Sci-Fi Katana
4.  Zabimaru

Weapons create destabilizing physical hits; there are no health bars,
durability, ammo, or RPG stats.

Zabimaru is the only transforming weapon. Its resting form is
compact/retracted; its attack extends separated segments to
approximately 2x gameplay reach, strikes, then retracts.

## Controls --- desktop

-   Arrow Up: throttle
-   Arrow Down: brake/reverse
-   Arrow Left/Right: steer
-   Space: kick
-   Enter: weapon attack

Secret keyboard-only cheat: type `xyzzyspoon`, then press `Shift+1`.
Successful activation grants 10 boost charges. Each later `Shift+1`
consumes one charge. The cheat is never exposed as a normal mobile
control.

## Controls --- mobile

The primary mobile experience is **landscape fullscreen + auto
acceleration + gyro steering**.

In-race primary screen controls: - large `KICK` button - large `HIT`
button

No normal throttle, brake, virtual steering stick, or boost button is
shown.

### Auto acceleration

The bike automatically accelerates toward its current allowed speed.
Sustained hard steering input applies corner-speed assistance: throttle
eases and mild engine braking occurs. Straightening the phone restores
full auto acceleration. This is assistance only; it must not choose the
racing line or steer for the player.

### Gyro steering

On `ENTER RACE`, the current comfortable landscape phone angle becomes
steering neutral.

Initial tuning target: - approximately +/-3 degrees deadzone -
approximately +/-28 degrees tilt = full steering - sensitivity
adjustable in settings - smoothing to prevent sensor jitter

If motion permission is denied or the device/browser does not provide
usable orientation data, switch to a touch fallback with translucent
`LEFT` and `RIGHT` steering zones while preserving `KICK` and `HIT`.

### Enter Race mobile flow

One explicit user gesture should attempt, in order where supported: 1.
request device orientation/motion permission, 2. request fullscreen, 3.
request/lock landscape orientation, 4. calibrate gyro neutral, 5.
continue to loaded/ready state.

Unsupported fullscreen/orientation lock must not block play. If portrait
is detected, show a rotate-to-landscape gate.

## Race

-   One lap.
-   Approximately 8.04 km centerline target.
-   Exactly two dedicated maximum-speed/boost opportunity straights.
-   Custom spline road; source city assets dress the track but never
    define topology.
-   2x5 staggered starting grid.
-   Approximately 16 ordered checkpoints plus finish.
-   Position uses checkpoint sequence + spline progress, not Euclidean
    distance.
-   World collision ON for track/world props.
-   Crowd collision OFF.
-   Track boundaries should visually be physical objects; emergency
    invisible containment is only a fallback.

## Race intro

Camera sweeps the grid and riders. Cyborg Oni flies in using its
existing clip, lands at the front, rises, performs/holds the countdown
gesture, then releases the race. A synchronized 3-2-1-GO follows with
colored smoke and engine launch.

The sequence is server-time synchronized. Controls unlock on the same
authoritative GO tick.

## Crash and recovery

Crash -\> rider ragdoll/ejection -\> settle -\> determine face-up/down
-\> appropriate get-up animation -\> run to reachable bike -\>
procedural lift -\> procedural remount -\> controls return.

If the bike/rider falls into inaccessible geometry, water, outside
containment, or cannot reach the bike, recover at the last safe
checkpoint with the specified penalty.

## Weather

Rain exists throughout the outdoor race and changes smoothly among
LIGHT, MODERATE, HEAVY, and TORRENTIAL. Tunnel rain is nearly absent,
while existing screen droplets drain away.

Weather is procedural/shader/VFX-driven. Do not runtime-load the entire
`after_the_rain` source scene.

Heavy rain includes puddles, stronger spray, reduced visibility, and
screen droplets. Large puddles create physical spray plus a lower-screen
splash that drains/fades.

## Crowd

Use optimized near models, LOD mid models, and far impostors/billboards.
Randomize animation phase, modest height, and material variants. Avoid
adjacent duplicates.

Barrier spectators use Cheer/Clap. Sidewalk NPCs use in-place Walk
driven along sidewalk waypoint/spline paths. Walkers never enter the
race surface.

## Results

Use the actual participating race avatars and selected colors.

-   #1: victory dance; selected bike parked behind in hero position.
-   #2--#3: Cheer/Clap.
-   #4 onward: Disappointed.
-   DNF/disconnected players are shown as DNF, never assigned fake
    finish times.

Camera: full lineup -\> winner push-in -\> player name + `1ST PLACE` -\>
result board.

## Explicit non-features

Do not add pickups, health, stamina, weapon durability, ammo, repair
systems, RPG progression, loot, or ordinary nitro pickups. The game is
about racing line, handling, melee positioning, rain, crashes, and
speed.
