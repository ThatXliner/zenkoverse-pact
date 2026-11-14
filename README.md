# Zenkoverse: Pact

A proof of concept of the Zenkoverse power system as a game: one cel-shaded dojo compound at dusk, seen top-down, over the shoulder or in first person. You carry one Technique, train it, and write Pacts in the Workshop to shape it into Abilities. Every Pact is a sacrifice the universe reads back to you before you inscribe it.

**Play it:** https://zenkoverse.bryanhu.com/

## What is in it

- **Five Techniques**: Recoil, Shift, Rime, Blink, Echo. Each starts raw: one imprecise primitive and the baseline conscious-activation Pact.
- **Pacts** are authored in the Workshop against the Technique's parameters (direction, range, target, trigger, duration, resource, body). The grant is a qualitative change to the Ability. Resolve is estimated by the engine from the real capability surrendered, your other Pacts, and how you play. Risk, Wager, Sunset and Programming are clause types. Inscribing is permanent, behind a hold-to-confirm.
- **Training** is gameplay. Drills refine mastery stats; as Activation rises the hand sign shortens until activation is silent. Hold Alt to perform the full sign deliberately for a boost.
- **Maximum Output** plays a short cutscene: the world freezes, the camera cuts to third person, the full sign plays, and the hit resolves on the beat.
- **One compound**: a training hall with the Workshop, the dummies and the Master's mat; a courtyard with the sparring ring, the koi pond and the hoist for the crane drill; a storehouse roof joined to the hall roof by a plank bridge; a wall walk round to the gate, where the Kuroda Enforcer waits. The hall roof hosts the eight-wave rooftop trial.
- **Three camera views**: top-down by default (you move with the screen and aim with the cursor), over the shoulder (the camera follows the mouse and you aim at the crosshair), and first person. V cycles them; Settings keeps the choice.
- **Aura Expansion** on F, with Aura Clash against the Ancient Echo Master's field.
- **The look**: anime-leaning cel shading. Flat fills over one light ramp, hard shadows, ink lines from the depth buffer and an inverted hull on every character, stylized proportions, a late-afternoon sun. Characters and world are drawn the same way.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Sprint |
| Space | Jump (mantles low ledges) |
| C | Dash |
| Mouse | Aim: the cursor on the ground (top-down) or the crosshair (over the shoulder, first person) |
| LMB / RMB | Primary / secondary Ability (hold where the Pact says held) |
| Q | Maximum Output when the ring is full |
| R | Declare a Wager |
| F | Aura Expansion |
| E | Interact: plaques, the Architect, drills, challenges |
| V | Camera view: top-down, over the shoulder, first person |
| Alt | Perform the full hand sign |
| Tab | Pact Workshop |
| Esc | Pause: menu, settings, codex, map |

## Hosting

The game is served from a self-hosted Mac at zenkoverse.bryanhu.com. `server/index.mjs` serves the build (and will host realtime multiplayer). `server/deploy.sh` runs there as the vanityctl service `zenkoverse-deploy` (the server is `zenkoverse`): it rebuilds whenever `main` moves, so merging to `main` deploys. The old GitHub Pages URL redirects to the new host.

## Run it locally

```sh
npm install
npm run dev
```

`npm run build` type-checks and writes a static site to `dist/`.

### Assets

Everything under `public/assets/` is CC0, listed in `CREDITS.md`. To rebuild them from raw downloads (Quaternius, KayKit, Kenney), place the downloads in one folder and run:

```sh
npm run assets -- <raw-download-dir>            # everything
npm run assets -- <raw-download-dir> --only human  # just the character
```

The character comes from `raw/quaternius/Universal Base Characters[Standard]` and `raw/quaternius/Universal Animation Library[Standard]`, the Standard zips from itch.io, unzipped. `tools/human.mjs` cuts the first-person arms, generates the suit and sleeve shells, retargets the clips, and writes `characters/human.glb`.

The script compresses geometry with meshopt, writes the byte manifest the loading bar reads, and regenerates `CREDITS.md`. `npm run manifest` rewrites the manifest alone, after an asset is added or removed by hand.

### Debug hooks

Append `?debug` to expose `window.game`:

```js
game.teleport('hall')              // courtyard, hall, ring, pond, roof, store, gate, stairs, or [x, y, z]
game.skipTutorial(); game.god(true)
game.technique('rime'); game.camera('top'); game.look(yaw, pitch)   // top, third or first
game.cast('primary'); game.hold('secondary', true)
game.encounter('sparring'); game.drill('recoil-crane'); game.workshop(true)   // sparring, kuroda, ancient, dummy-room
game.tutorialStep('pact'); game.cutscene('max-echo')
game.loop(false); game.step(30)    // deterministic frame stepping
game.errors; game.stats()
```

### Capture harness

`tools/capture.mjs` drives the built game through those hooks to fixed scenarios and saves screenshots per piece: first-person gestures at fixed frame offsets for every Technique, the third-person locomotion cycle, every camera view in every part of the compound, the compound's vistas, Technique VFX and each Maximum Output cutscene, every encounter and the boss ultimate, the Workshop and every pause sheet at 1280×720 and 1920×1080 with a viewport-fit check, the tutorial steps, and the Recoil drill.

```sh
npm run build
npm run capture -- --out captures            # everything
npm run capture -- --only hands,workshop     # a subset
npm run capture -- --url http://localhost:5173/  # against a dev server
```

It writes `captures/report.json` with every screenshot path, modal-fit failures, and page errors, and exits non-zero on any failure. Pieces: `ui`, `hud`, `hands`, `variants`, `sign`, `poses`, `third-person`, `views`, `compound`, `vfx`, `encounters`, `workshop`, `tutorial`, `drill`, `perf`.

### Checks

Every `npm run check:*` script and `node tools/check-flow.mjs` drives the built game with real keys, clicks and the mouse: `check:controls` (the movement keys follow the camera's axes in all three views), `check:keybinds`, `check:locomotion`, `check:navigation`, `check:rooftop` (the whole trial), `check:sign`, `check:tints` (enemy suits read as cloth and apart from each other), and `check-flow` (the Workshop, the dummies and the whole tutorial). `tools/perf-rooftop.mjs` measures frame times in every view at DPR 2.

## Layout

```
src/app         state machine, settings, input, asset loader, clock, game loop, debug hooks
src/render      renderer and post stack, the ink line effect, toon materials, the sky and sun
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
src/world       the compound, props, waypoint shrines
src/workshop    Pact Workshop UI
src/ui          App, HUD, sheets, styles
src/audio       Web Audio mixer
tools           build-assets.mjs, manifest.mjs, capture.mjs, peek.mjs and the check scripts
```
