# Pizzeria Roadrash --- Track Blueprint

## Coordinate convention

-   X = east/west
-   Y = elevation
-   Z = north/south
-   world units = meters after normalization
-   control anchors are spline design anchors, not polygon corners

## Locked route skeleton

  ID            X    Y      Z Role
  -------- ------ ---- ------ --------------------------------
  SF         -400    0   -700 Start/Finish
  N1          200    0   -700 Neon Boulevard
  N2          550    4   -550 Neon Sweep
  N3          700    8   -250 Commercial
  N4          550   10      0 Commercial
  N5          250   12    150 Dense Streets
  N6         -100   14    200 Dense Streets
  N7         -450   12    100 Storm Entry
  B1_IN      -650   10      0 Boost #1 Entry
  B1_OUT     -650   12    850 Boost #1 Exit
  S1         -350   10   1050 Storm Braking
  S2           50    8   1100 Heavy Rain
  I1          350    4    950 Industrial
  I2          450    0    700 Industrial
  I3          300   -2    450 Tunnel Approach
  T_IN        300   -2    350 Tunnel Entrance
  T_OUT       300   -2      0 Tunnel Exit
  BA          500    4   -200 Bridge Climb
  BR_IN       650   14   -350 Broken Bridge / Boost #2 Entry
  BR_OUT     -150   14   -350 Broken Bridge Exit
  W1         -350    8   -250 Western Technical
  W2         -550    4   -350 Final Technical
  W3         -600    0   -550 Neon Re-entry
  SF         -400    0   -700 Finish

Generate a smooth Catmull-Rom/Bezier-derived road centerline from these
anchors. Tune handles/radii so the road is drivable at the specified
speed model and never behaves like a hard polyline.

## District sequence

### Neon Core

Start grid width 18 m, tapering to approximately 14 m. Highest crowd
density, Times Square visual language, holograms, wet reflections, Oni
intro, MODERATE rain.

### Commercial Combat District

Road approximately 10--14 m. Sweeping bends and S transitions encourage
side-by-side melee. Use `cyberpunk_city_-_1` and custom dressing. LIGHT
to MODERATE rain.

### Storm Sector / Boost #1

`B1_IN -> B1_OUT` is approximately 850 m and approximately 16 m wide. It
is the first dedicated maximum-speed opportunity. Keep an
avoidable/clean central line. Outer lanes may contain puddles. End with
clear braking cues and a high-speed corner. HEAVY -\> TORRENTIAL rain.

### Heavy Rain Technical

Puddles create line choice. Short inside lines may be wetter; longer
outer lines may be cleaner. Road approximately 10--12 m.

### Industrial

Use post-apocalyptic industrial visual assets, pipes, tanks, pylons,
steam, concrete barriers, ruins. Road approximately 11--13 m. HEAVY
rain. Descend toward Y=-2 m.

### Future Tunnel

Use `future_tunnel.glb` as modular wall/ceiling/light structure, not as
the authoritative road collider.

Target: - source module length approximately 29.38 m - approximately 12
repeated/instanced modules - approximately 350 m total - widen
approximately X x2.55 to about 12.1 m - height approximately Y x1.25 to
about 4.4 m - custom wet race road continues through it

Lighting progression: cold white -\> cyan -\> magenta -\> red hazard -\>
cyan exit.

Outdoor rain particles nearly vanish inside. Existing screen droplets
drain. Tunnel wall collision ON.

### Bridge Climb

Rise from tunnel exit to approximately Y=+14 m. Reveal open
skyline/industrial water before entering bridge.

### Broken Bridge / Boost #2

`BR_IN -> BR_OUT` is approximately 800 m and is the signature second
dedicated maximum-speed section.

Use `bridges_and_street_assets.glb` as modular visual structure/damage
kit. The custom spline road remains authoritative for racing and
simplified collision.

Progression: - first \~550 m: mostly intact boost run - \~550--650 m:
increasing debris/damaged barriers - \~650--710 m: damaged
asphalt/slanted structure - \~710--735 m: ramp preparation - physical
gap target: \~10 m - landing/recovery deck - damaged bridge exit

The jump is mandatory. No alternate bypass.

Missed jump/inaccessible fall -\> crash visual -\> last safe pre-jump
recovery checkpoint -\> recovery penalty.

### Western Technical

Allow \~100 m after bridge landing for stabilization/braking, then
tighten to 10--12 m. This is the final major melee zone. TORRENTIAL rain
gradually eases.

### Final Neon Run

Road opens from \~10 m toward 18 m. Crowd density rises. Final \~250 m
permits overtaking/combat but is not a third dedicated boost zone.
MODERATE rain at finish.

## Track construction

Generate four conceptual layers: 1. visual road mesh, 2. simplified road
collider, 3. shoulder/curb, 4. physical barriers/world boundaries.

Prefer concrete barriers, guardrails, parked vehicles, planters,
construction barricades, tunnel walls, buildings, and bridge rails over
invisible walls.

## Checkpoints

Use ordered checkpoint gates distributed through all major sections,
with extra gates around topology that could be shortcut. Include
separate pre-jump and post-jump bridge gates.

Race progress = ordered checkpoint index + projected spline progress
toward the next checkpoint.

Respawn/recovery = last valid safe recovery node, never geometrically
nearest road point.

## Start grid

10 spawn positions, 2 columns x 5 staggered rows, aligned with track
tangent. Ensure no collider overlap. Oni landing/countdown zone is
safely ahead of the front row.

## Crowd zones

-   Start/finish: maximum spectators; Cheer/Clap.
-   Commercial: spectators + walkers.
-   Storm straight: sparse except protected viewing areas.
-   Industrial: sparse.
-   Tunnel: no normal crowd.
-   Bridge: sparse/no exposed spectators.
-   Final Neon Run: density ramps to maximum near finish.
