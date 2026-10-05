# Pizzeria Roadrash --- Art Direction & Shader Bible

`ARTBOARD.png` is the visual reference. It is a mood/readability target,
not a literal asset sheet. Actual asset identities come from the
manifest and locked spec.

## Visual thesis

**Rain-soaked neon speed with industrial weight.**

The game should feel cinematic and expensive without becoming dark,
muddy, or photorealistically dull. The road must remain readable at 400
displayed km/h. The visual hierarchy is:

1.  raceable road and hazards,
2.  riders/bikes/opponents,
3.  combat contact/VFX,
4.  navigation/checkpoint cues,
5.  city spectacle.

Neon spectacle must never obscure gameplay.

## Palette

Primary night base: - deep blue-black / navy environment - cool
steel/charcoal materials

Primary emissive accents: - cyan/electric blue - magenta/purple -
controlled red - industrial orange - hazard amber/yellow

White is reserved for headlights, wet specular peaks, critical UI, and
selected signage.

Do not tint the entire image purple/cyan. Maintain neutral/dark material
anchors so neon has contrast.

## Exposure and tone

Use a filmic tone-mapping path appropriate to Three.js. Keep exposure
stable during normal driving; do not use aggressive auto-exposure
pumping.

Targets: - blacks retain texture/detail - bright emissives bloom but
retain a readable core - wet-road reflections remain colorful without
becoming a mirror-white smear - tunnel entrance/exit transitions are
eased, not hard exposure jumps

## Lighting

Use a layered lighting strategy: - low-cost ambient/hemisphere fill for
baseline readability - limited key directional/moon light - headlights
for local road readability - emissive materials for visual sources -
carefully budgeted local lights near hero areas - baked/fake light
contribution where a real dynamic light adds little

Dynamic shadows prioritize riders/bikes and nearby hero objects. Crowd
and distant city should not consume expensive dynamic shadow budgets.

## Wet road shader

Base comes from the post-apocalyptic wet-asphalt source where useful,
then becomes a reusable runtime material.

Required response: - darkened wet diffuse - reduced roughness in wet
regions - view-dependent specular/reflection response - animated ripple
normal under rain - subtle micro-normal breakup - puddle masks are
separate from generic wetness - neon/headlight reflection response
should be stretched in the road direction rather than perfect planar
mirror reflection

Do not require full ray tracing.

Desktop/high preset may use screen-space or selective reflection
techniques if stable. Mobile should use cheaper environment/reflection
probes, emissive reflection approximations, and shader response.

## Puddles

Puddles are authored gameplay zones plus visual masks.

Visual: - lower roughness - stronger normal ripples - shallow depth cue
at edge - tire displacement/splash - nearby emissive reflection
enhancement

Gameplay grip comes from gameplay constants, not from shader sampling.

## Rain

Use a hybrid: - near-camera GPU streak particles - mid/far
screen/world-space streak treatment - road ripple normals - wheel
spray/mist - screen droplets - large-puddle splash overlay

Rain streak density, length, wind slant, fog, and spray scale with
weather intensity.

Do not runtime-load the full `after_the_rain` GLB.

## Screen water

Large puddle splash begins from lower screen, rises irregularly, then
drains/fades downward. Heavy rain creates smaller droplets/streaks that
accumulate and drain.

Effects must never hide the center racing line for long.

## Neon and bloom

Bloom is selective and restrained: - emissive bike accents - signage -
tunnel strips - hazard lamps - holograms - key city lights

Avoid full-screen glow haze. Geometry edges and opponent silhouettes
must remain crisp enough for combat.

## Holograms / fictional ads

Use CSS/canvas/video-texture/procedural assets or internally generated
fictional graphics. No dependency on external ad services.

Shader ideas: - scanline modulation - subtle RGB split at edges -
occasional glitch slices - opacity noise - light volumetric suggestion -
low-frequency flicker

Glitches should be infrequent; constant glitching becomes visual noise.

## Bike material unification

All six source bikes must be normalized into one visual language: -
coherent PBR response - consistent metal/paint roughness ranges - three
selectable color schemes per bike - emissive accents integrated
intentionally - dirt/wetness response consistent with environment - rain
droplets/sheen where practical

Do not erase each bike's identity.

## Rider material unification

Normalize: - human scale - PBR workflow - skin response - armor/clothing
roughness - emissive accents - color variant strategy

Scarlet Proxy exposed skin requires atlas-aware masking/editing rather
than tinting the entire material.

## District signatures

### Neon Core

Brightest signage, cyan/magenta/red reflections, dense crowd, strongest
city spectacle.

### Commercial

Cool neon mixed with warmer storefront practicals. Readable silhouettes
and sidewalks.

### Storm

Cooler palette, stronger rain/fog, sparse signage, hazard amber to guide
braking.

### Industrial

Charcoal steel/concrete, orange/red practicals, steam, wet grime,
occasional cyan tech accents.

### Future Tunnel

Controlled strip-light sequence: cold white -\> cyan -\> magenta -\> red
hazard -\> cyan exit. Highly readable wet-road reflections; no
uncontrolled darkness.

### Broken Bridge

Cold storm blue, lightning/sky contrast, red/amber hazard lights, wet
concrete/steel, distant neon skyline. Damage silhouette must be readable
early enough at speed.

### Final Neon Run

Return to richer neon density and crowd energy; finish line is visually
unmistakable.

## Fog and atmosphere

Use distance fog/height haze to: - hide LOD transitions - integrate
heterogeneous source assets - strengthen depth - control skyline cost

Fog must not erase road boundaries or opponents.

## Speed VFX

Speed perception comes from: - FOV progression - road-side parallax -
rain streak elongation - wheel spray - subtle peripheral motion
streaks - camera pullback - environment light streak response

Do not use heavy global motion blur that destroys combat readability.

## Combat VFX

Keep hits readable and brief: - small sparks for metal contact -
directional impulse - short camera shake - weapon trail only during
active window - morning-star ball trail follows delayed physics -
Zabimaru extension visually clear but not screen-filling

No blood/gore system is required.

## Bridge jump

At jump: - stronger wind/rain streaks - skyline/water depth cue - short
camera release/pullback - landing suspension/compression cue - bad
landing uses impact shake/sparks

Do not turn it into a slow-motion cutscene during live multiplayer.

## UI style

HUD should be minimal, high-contrast, semi-transparent, and readable
against neon.

Desktop: - position - minimap/track progress - displayed speed - weapon
icon/name - boost charges only after cheat unlock - network/ping
indicator kept subtle

Mobile: - landscape fullscreen - large KICK and HIT buttons in thumb
reach - speed/position/minimap compact - no permanent
throttle/brake/joystick - gyro steering has a small optional
calibration/sensitivity indicator in settings, not a giant on-screen
wheel

Use safe-area insets for phones with notches/cutouts.

## Performance tiers

### High/Desktop

Full rain density, richer reflections, hero shadows, more crowd, higher
LOD distances, selective post effects.

### Medium

Reduced rain/crowd/shadow distances, cheaper reflections, same gameplay
readability.

### Mobile

Aggressive LODs/impostors, reduced particles, simplified reflections,
limited dynamic lights/shadows, same core wet/neon art direction.

Never change gameplay physics or visibility of hazards by graphics
preset.

## Non-negotiable visual acceptance

A screenshot from Neon Core, Industrial, Tunnel, Broken Bridge, and
Final Run should look like the same game despite mixed source assets.

At racing speed: - road edges readable - opponents readable - puddles
readable before contact - bridge damage readable before jump - KICK/HIT
readable on phone - rain feels heavy without becoming opaque
