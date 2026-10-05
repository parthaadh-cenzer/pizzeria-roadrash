# Pizzeria Roadrash --- Gameplay Constants

These are initial locked gameplay constants. Centralize them in typed
configuration so tuning does not require changing gameplay code.

## Speed model

-   physics max speed: 80 m/s
-   displayed max speed: 400 km/h
-   display mapping: physics speed x5
-   all six bikes share the same max speed

The HUD speed is intentionally cinematic and is not literal SI
conversion.

## Bike balance

  Bike                           Accel m/s²   Handling   Stability
  ---------------------------- ------------ ---------- -----------
  Sci-Fi Motorcycle                    11.8       1.00        1.00
  Akira Class Cruiser                  10.0       0.82        1.20
  Hovering Engine Motorcycle           13.2       0.86        0.92
  Hover Rocket                         12.6       0.90        0.88
  TRON Light Cycle                     11.4       1.12        1.02
  Monobike Dragonseeker                10.8       1.18        0.78

-   max braking: 22 m/s²
-   reverse cap: 8 m/s
-   steering is progressively damped at high speed
-   visual lean target: \~48°, Monobike \~52°, Akira \~42°

## Steering

-   low-speed max yaw target: 105°/s
-   max-speed base yaw target: \~42°/s multiplied by handling
-   keyboard steer ramp to full: 0.16 s
-   keyboard release/recenter: 0.20 s
-   visual lean lag: \~90 ms
-   mobile gyro deadzone target: +/-3°
-   mobile full steer target: +/-28°
-   mobile sensor input must be smoothed
-   user-adjustable gyro sensitivity
-   neutral calibration occurs at Enter Race

## Mobile auto acceleration

Default mobile control has no throttle/brake UI.

-   auto throttle seeks the same bike speed envelope as desktop
-   mild corner-speed assist responds to sustained strong steering
-   assist may reduce throttle and add mild engine braking
-   assist never steers, chooses a line, avoids obstacles, or
    auto-corrects combat
-   gyro unavailable/denied -\> touch LEFT/RIGHT fallback

## Wet grip

  Condition        Grip multiplier
  -------------- -----------------
  Light rain                  1.00
  Moderate                    0.96
  Heavy                       0.90
  Torrential                  0.84
  Small puddle                0.78
  Large puddle                0.68

Large puddle: - \~8% immediate speed loss - steering effectiveness x0.80
for 0.65 s - strong tyre spray - lower-screen water splash/drain effect

Hover bikes use the same competitive grip model.

## Secret boost

Activation sequence: type `xyzzyspoon`, then `Shift+1`.

On successful activation: - grant 10 charges - show brief `BOOST x10` -
later `Shift+1` consumes one charge - charge duration: 1.25 s - boost
acceleration target: 80 m/s² - top speed remains 80 m/s / displayed 400
km/h - FOV/VFX/exhaust/emissive response intensifies - Hovering Engine
uses its boost flame geometry - keyboard only; never a normal mobile
button

## Combat

  -----------------------------------------------------------------------------------
  Attack          Reach    Wind-up     Active   Recovery      Total Effect
  ---------- ---------- ---------- ---------- ---------- ---------- -----------------
  Kick           1.05 m      .18 s      .10 s      .32 s      .60 s High
                                                                    destabilization

  Machete         .65 m      .16 s      .10 s      .28 s      .54 s Medium

  Katana         1.15 m      .22 s      .12 s      .36 s      .70 s Medium-high

  Morning        1.35 m      .34 s      .16 s      .50 s     1.00 s Highest
  Star                                                              

  Zabimaru       2.20 m      .28 s      .18 s      .46 s      .92 s Medium, longest
               extended                                             reach
  -----------------------------------------------------------------------------------

Suggested lateral reaction baselines: - Kick: 1.8 m/s - Machete: 1.15
m/s + yaw - Katana: 1.35 m/s + yaw - Morning Star: 2.05 m/s + strongest
yaw/lean - Zabimaru: 1.20 m/s

Scale by relative speed, target stability, and contact direction.

Transient instability decays toward zero in \~0.8 s. It is internal
physics state, not health.

Morning Star ball peak/contact trails hand by \~120 ms.

Attack targeting selects the nearest valid opponent in reach on the
appropriate side. No target -\> attack still plays.

## Bike collisions

Relative collision speed: - \<4 m/s: bump/scrape - 4--10 m/s:
displacement + steering disturbance - 10--16 m/s: severe wobble /
possible crash - \>16 m/s: strong crash candidate

Use simplified race colliders, never full visual meshes.

## World crash criteria

Glancing barrier impact under \~20°: scrape/sparks/speed loss, usually
continue.

Above \~35° at meaningful speed: crash candidate.

Strong eject candidates include: - impact severity threshold exceeded -
roll \>65° for 150 ms - hard landing roll/pitch \>28° - vertical landing
velocity \>8 m/s - major high-relative-speed frontal impact

## Crash/recovery timing

-   ragdoll minimum: 0.8 s
-   normal settle target: 1.2 s
-   forced settle timeout: 2.0 s
-   face-up -\> `anim_getup_back`
-   face-down -\> `anim_getup_prone`
-   run to reachable bike if within \~35 m
-   procedural lift target: \~1.25 s
-   procedural mount target: \~1.10 s
-   inaccessible/off-world recovery penalty: +3.0 s immobilized at last
    safe checkpoint

## Broken bridge jump

-   gap target: \~10 m
-   controlled launch vertical component: +2.0 m/s
-   preserve horizontal velocity
-   minimum comfortable approach target: \~25 m/s physics / 125
    displayed km/h
-   gentle road-normal landing assist allowed
-   bad lateral angle must not be auto-saved

## Network

-   physics simulation: 60 Hz
-   client input send: 30 Hz
-   authoritative snapshot: 20 Hz
-   remote interpolation buffer: 100 ms
-   local prediction: ON
-   server reconciliation: ON
-   combat/crash/checkpoint/finish validation: server authoritative
-   correction \>2.5 m: snap authoritative state with short visual
    smoothing

## Camera

-   chase distance: 5.2 m
-   base height: 2.15 m
-   FOV: 68° low speed -\> 84° max speed
-   boost FOV peak: \~92°
-   acceleration pullback: max \~0.45 m
-   braking push-in: max \~0.25 m
-   impact shake proportional to collision
-   crash camera follows rider, then reframes rider+bike during recovery

## Race/results

-   one lap
-   max 10 players
-   2x5 staggered grid
-   \~16 ordered checkpoints + finish
-   synchronized future server start timestamp
-   controls locked until GO
-   finish time server authoritative
-   results: position / name / finish time / gap
-   DNF stays DNF
