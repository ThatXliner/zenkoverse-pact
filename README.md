# Zenkoverse: Pact

A first- and third-person sandbox set in one rainy night district of the Zenkoverse. You carry one Technique, train it, and write Pacts in the Workshop to shape it into Abilities. Every Pact is a sacrifice the universe reads back to you before you inscribe it.

**Play it:** https://bryanhu.com/zenkoverse-pact/

## What is in it

- **Five Techniques**: Recoil, Shift, Rime, Blink, Echo. Each starts raw: one imprecise primitive and the baseline conscious-activation Pact.
- **Pacts** are authored in the Workshop against the Technique's parameters (direction, range, target, trigger, duration, resource, body). The grant is a qualitative change to the Ability. Resolve is estimated by the engine from the real capability surrendered, your other Pacts, and how you play. Risk, Wager, Sunset and Programming are clause types. Inscribing is permanent, behind a hold-to-confirm.
- **Training** is gameplay. Drills refine mastery stats; as Activation rises the hand sign shortens until activation is silent. Hold Alt to perform the full sign deliberately for a boost.
- **Maximum Output** plays a short cutscene: the world freezes, the camera cuts to third person, the full sign plays, and the hit resolves on the beat.
- **A district**: the Academy courtyard and crane drill, the dojo Workshop with a dummy room, a neon market street, back alleys with Underworld thugs, reachable rooftops, a steel bridge where the Ancient Echo Master waits, and the Kuroda house.
- **Aura Expansion** on F, with Aura Clash against the Ancient Echo Master's field.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Sprint |
| Space | Jump (mantles low ledges) |
| C | Dash |
| Mouse | Look |
| LMB / RMB | Primary / secondary Ability (hold where the Pact says held) |
| Q | Maximum Output when the ring is full |
| R | Declare a Wager |
| F | Aura Expansion |
| E | Interact: plaques, the Architect, drills, challenges |
| V | Toggle first / third person |
| Alt | Hold the full hand sign |
| Tab | Pact Workshop |
| Esc | Pause: menu, settings, codex, map |

## Run it locally

```sh
npm install
npm run dev
```

`npm run build` type-checks and writes a static site to `dist/`.

### Assets

Everything under `public/assets/` is CC0, listed in `CREDITS.md`. To rebuild them from raw downloads (Quaternius, KayKit, Kenney, ambientCG, Poly Haven), place the downloads in one folder and run:

```sh
npm run assets -- <raw-download-dir>            # everything
npm run assets -- <raw-download-dir> --only human  # just the character
```

The character comes from `raw/quaternius/Universal Base Characters[Standard]` and `raw/quaternius/Universal Animation Library[Standard]`, the Standard zips from itch.io, unzipped. `tools/human.mjs` cuts the first-person arms, generates the suit and sleeve shells, retargets the clips, and writes `characters/human.glb`.

The script compresses geometry with meshopt and textures to WebP, writes the byte manifest the loading bar reads, and regenerates `CREDITS.md`.

### Debug hooks

Append `?debug` to expose `window.game`:

```js
game.teleport('market')            // academy, dojo, market, alley, bridge, kuroda, roof, or [x, y, z]
game.skipTutorial(); game.god(true)
game.technique('rime'); game.camera('third'); game.look(yaw, pitch)
game.cast('primary'); game.hold('secondary', true)
game.encounter('kuroda'); game.drill('recoil-crane'); game.workshop(true)
game.tutorialStep('pact'); game.cutscene('max-echo')
game.loop(false); game.step(30)    // deterministic frame stepping
game.errors; game.stats()
```

### Capture harness

`tools/capture.mjs` drives the built game through those hooks to fixed scenarios and saves screenshots per gauntlet piece: first-person gestures at fixed frame offsets for every Technique, the third-person locomotion cycle, district vistas, Technique VFX and each Maximum Output cutscene, every encounter and the boss ultimate, the Workshop and every pause sheet at 1280×720 and 1920×1080 with a viewport-fit check, the tutorial steps, and the Recoil drill.

```sh
npm run build
npm run capture -- --out captures            # everything
npm run capture -- --only hands,workshop     # a subset
npm run capture -- --url http://localhost:5173/  # against a dev server
```

It writes `captures/report.json` with every screenshot path, modal-fit failures, and page errors, and exits non-zero on any failure. Pieces: `ui`, `hands`, `third-person`, `district`, `vfx`, `encounters`, `workshop`, `tutorial`, `drill`, `perf`.

## Layout

```
src/app         state machine, settings, input, asset loader, clock, game loop, debug hooks
src/render      renderer and post stack, environment, wet PBR materials
src/physics     Rapier world and queries
src/player      character controller, camera rig
src/character   human avatar: looks, locomotion blend at measured clip speeds, upper-body layer
src/hands       first-person arms on the human skeleton: calibrated IK rig, poses, gesture timelines
src/pacts       Pact schema, validator, JSON Schema, Resolve, readback, the player's book
src/mastery     mastery stats and gesture variant selection
src/techniques  Technique kit contract, runtime, VFX pool, kits/<technique>.ts
src/combat      player combat, enemies, encounters, aura
src/cutscene    data-driven cutscene player
src/tutorial    step machine
src/drills      drill runtime
src/world       district layout, facades, rain, neon, props, pedestrians
src/workshop    Pact Workshop UI
src/ui          App, HUD, sheets, styles
src/audio       Web Audio mixer
tools           build-assets.mjs, capture.mjs
```
