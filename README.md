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
- **Online rooms**: up to eight players in the compound, live, each with their own Technique and Pacts. Hit each other, go down, get back up, and watch the scoreboard.
- **Aura Expansion** on F, anywhere: it spends your whole aura on a field around you, where your Techniques are sharper and others are slowed. F again retracts it, with nothing refunded. Two fields that touch become an **Aura Clash**: a short side-on cutscene of quick push, hold or feint exchanges against the Ancient Echo Master or another player. The loser's field collapses and their guard breaks; nobody is hurt by the clash. Refinement, trained at the listening stone in the yard, sets how dense your field is, up to a potential that a broader Technique and more Pacts lower.
- **The look**: anime-leaning cel shading. Flat fills over one light ramp, hard shadows, ink lines from the depth buffer and an inverted hull on every character, stylized proportions, a late-afternoon sun. Characters and world are drawn the same way.

## Play online

Open https://zenkoverse.bryanhu.com/, choose **Play Online**, pick a Technique, type a name and a room code, and press **Enter the room**. Everyone with the same room code fights in the same compound. The room code lands in the address bar; send that link (or use **Copy room link** in the Esc menu), and whoever opens it lands on the same screen, ready to join. The default room is `dojo`, open to anyone. A room holds eight players.

Online, Esc and Tab do not stop the world: the room keeps going and you can be hit with a menu open. Health 0 puts you down for four seconds, then you get up at the spawn point farthest from everyone else, briefly protected. The scoreboard counts downs dealt and times downed. Maximum Output plays its cutscene for you alone; while it runs you cannot be hurt, and everyone else sees you glow. An Aura Clash between two players locks only those two: the server decides each exchange from both picks, everyone else keeps playing, and leaving mid-clash loses it. The single-player fights, drills and the rooftop trial stay in single-player. Your Pacts, mastery and key bindings come with you from this browser.

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
| F | Aura Expansion: expand (spends all your aura), or retract (no refund). It cannot expand again until the aura has refilled |
| W / S / A or D | In an Aura Clash: push / hold / feint. Push beats hold, hold beats feint, feint beats push |
| E | Interact: plaques, the Architect, drills, challenges |
| V | Camera view: top-down, over the shoulder, first person |
| Alt | Perform the full hand sign |
| Tab | Pact Workshop |
| Esc | Pause: menu, settings, codex, map |

## Hosting

The game is served from a self-hosted Mac at zenkoverse.bryanhu.com. `server/index.mjs` serves the build and hosts the realtime rooms at `/ws` on the same port (the Cloudflare tunnel passes WebSockets through). `server/deploy.sh` runs there as the vanityctl service `zenkoverse-deploy` (the server is `zenkoverse`): it rebuilds whenever `main` moves, so merging to `main` deploys. The old GitHub Pages URL redirects to the new host.

## Run it locally

```sh
npm install
npm run dev
```

`npm run build` type-checks and writes a static site to `dist/`.

### Online rooms locally

```sh
npm run build
npm run serve                        # http://127.0.0.1:8095/, rooms at ws://127.0.0.1:8095/ws
npm run serve -- --latency 120       # every realtime message waits 120 ms each way
npm run serve -- --host 0.0.0.0      # reachable from other machines on the network
```

Open the page in two browser windows (or on two machines) and join the same room code. `npm run dev` forwards `/ws` to a server on port 8095, so run `npm run serve` beside it to play online with hot reload. How the rooms work, and who owns what, is in `docs/DESIGN.md` under Multiplayer.

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

It writes `captures/report.json` with every screenshot path, modal-fit failures, and page errors, and exits non-zero on any failure. Pieces: `ui`, `hud`, `hands`, `variants`, `sign`, `poses`, `third-person`, `views`, `compound`, `vfx`, `encounters`, `roles` (every enemy role in a line-up and in close portraits), `workshop`, `tutorial`, `drill`, `perf`.

### Checks

Every `npm run check:*` script and `node tools/check-flow.mjs` drives the built game with real keys, clicks and the mouse: `check:controls` (the movement keys follow the camera's axes in all three views), `check:effects` (a restart leaves no effect behind, and the Master's field tints only a player inside it), `check:keybinds`, `check:locomotion`, `check:navigation`, `check:rooftop` (the whole trial), `check:sign`, `check:tints` (enemy suits and costumes read as cloth and apart from each other), `check:aura` (expansion spends the whole pool, retraction refunds nothing, no expansion before a full refill, the drill, refinement and potential, and a lost and a won clash against the Master with no health lost and the world still running), `check:multiplayer` (three browsers in one room: movement, an Ability hitting exactly once, a down and respawn, an Aura Clash that plays the same on every screen while a third player keeps walking, a forfeit by leaving, a server restart, leaving; add `--latency 120` to run it with added delay), and `check-flow` (the Workshop, the dummies and the whole tutorial). `tools/perf-rooftop.mjs` measures frame times in every view at DPR 2, with a field open and during a clash, and `tools/perf-multiplayer.mjs` does the same in a full room of eight.

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
src/combat      player combat, enemies, encounters, aura fields (rules, drawing) and the Aura Clash
src/net         online rooms: protocol, shared rules, the clash referee both sides run, socket, other players, effect mirroring
src/cutscene    data-driven cutscene player
src/tutorial    step machine
src/drills      drill runtime, the aura drill (Reading the Field)
src/world       the compound, props, waypoint shrines
src/workshop    Pact Workshop UI
src/ui          App, HUD, sheets, styles
src/audio       Web Audio mixer
server          index.mjs (static files and /ws), realtime.mjs (rooms), deploy.sh
tools           build-assets.mjs, manifest.mjs, capture.mjs, peek.mjs and the check scripts
```
