# Zenkoverse: Pact

A proof of concept of the Zenkoverse power system as a game: one dojo compound at dusk, drawn as a living manga panel, seen top-down, over the shoulder or in first person. You carry one Technique, train it, and write Pacts in the Workshop to shape it into Abilities. Every Pact is a sacrifice the universe reads back to you before you inscribe it.

**Play it:** https://zenkoverse.bryanhu.com/

## What is in it

- **Five Techniques**: Recoil, Shift, Rime, Blink, Echo. Each starts raw: one imprecise primitive and the baseline conscious-activation Pact.
- **Pacts** are authored in the Workshop against the Technique's parameters (direction, range, target, trigger, duration, resource, body). The grant is a qualitative change to the Ability. Resolve is estimated by the engine from the real capability surrendered, your other Pacts, and how you play. Risk, Wager, Sunset and Programming are clause types. A Wager is tuned, not just picked: how hard the call is, which rewards it pays and how the stake splits between them, and what it puts up and how much. Its stake comes only from real doubt, measured from your own casts at that setting, and real loss. Inscribing is permanent, behind a hold-to-confirm.
- **Training** is gameplay. Drills refine mastery stats; as Activation rises the hand sign shortens until activation is silent. Alt performs the full sign deliberately for a boost. Ordinary play fills a stat to 40 at most; the drills take it the rest of the way, so a skilled newcomer can catch up in minutes. The Striking Posts east of the sparring ring train landing signed blows, for any Technique, in four short tiers.
- **Health comes back** a few seconds after a fight, away from enemies. Not during an encounter or the rooftop trial.
- **Maximum Output** plays a fighting-game ultimate: the nearest body in reach is pulled in front of you, the world holds still, the camera cuts to a close-up of the full sign, the name card slams in, and the blow lands on the beat with an impact frame and hit-stop. Then the camera eases back to your own view. The Kuroda Enforcer and the Master have their own. Settings sets how often they play in full: always, the first time only (repeats are cut short), or never. Space skips to your own view; the blow still lands on its beat.
- **One compound**: a training hall with the Workshop, the dummies and the Master's mat; a courtyard with the sparring ring, the koi pond and the hoist for the crane drill; a storehouse roof joined to the hall roof by a plank bridge; a wall walk round to the gate, where the Kuroda Enforcer waits. The hall roof hosts the eight-wave rooftop trial. The gate stands open onto a valley closed by cliffs: a road over a red bridge to a roadside shrine, a stream from a waterfall, rice terraces, tall grass, a training ground under an old ginkgo, and paths through the woods.
- **Three camera views**: top-down by default (you move with the screen and aim with the cursor), over the shoulder (the camera follows the mouse and you aim at the crosshair), and first person. V cycles them; Settings keeps the choice.
- **Online rooms**: up to eight players in the compound, live, each with their own Technique and Pacts. Hit each other, go down, get back up, and watch the scoreboard.
- **Aura Expansion** on F, anywhere: it spends your whole aura at once. Tap F and it wraps your body in a thin, dense layer, drawn as an inked rim round your outline: blows on you land softest and your Techniques' cooldowns run fastest, but it reaches nobody. Hold F to push the layer off your body into a field that grows until you let go, thinner the wider it goes (while you push, you barely move and cannot cast); inside it your hits land harder, you see what enemies are about to do sooner, and they are slowed. F again retracts it, and the time it did not use stays in your aura. A field that reaches another field or a body layer becomes an **Aura Clash** (two body layers alone never clash): a short side-on cutscene of quick push, hold or feint exchanges against the Ancient Echo Master or another player. The loser's field collapses and their guard breaks; nobody is hurt by the clash. Refinement, trained at the listening stone in the yard, sets how dense your field is, up to a potential that a broader Technique and more Pacts lower.
- **The look**: a coloured manga page in motion. Flat colour with screentone dots where the light turns, dot screens over shadows and hatching in the darkest shade; brush ink lines that swell toward the camera and split dry at their ends; warm paper inside a ruled panel border. Big hits get focus lines, ink impact frames and a lettered sound word; dashes get speed lines. Some Maximum Outputs change the whole page for a shot: sumi-e ink wash for Echo and the Master, watercolour for Rime, a negative for Blink. Characters, world and your own arms are drawn by the same hand. The Low quality preset keeps the tones and a plain ink line and drops the dry brush, paper fibre and painted looks.

## Play online

Open https://zenkoverse.bryanhu.com/, choose **Play Online**, pick a Technique, type a name and a room code, and press **Enter the room**. Everyone with the same room code fights in the same compound. The room code lands in the address bar; send that link (or use **Copy room link** in the Esc menu), and whoever opens it lands on the same screen, ready to join. The default room is `dojo`, open to anyone. A room holds eight players.

Online, Esc and Tab do not stop the world: the room keeps going and you can be hit with a menu open. Health 0 puts you down for four seconds, then you get up at the spawn point farthest from everyone else, briefly protected. The scoreboard counts downs dealt and times downed. A Maximum Output locks only its caster and the player it pulls in: both screens play the cutscene, neither can be hit by anyone else for its two to four seconds, and everyone else keeps playing and sees the two glow and stand still. The server holds the lock, ends it within four seconds, and refuses another Output from the same player for fifteen. An Aura Clash between two players locks only those two: the server decides each exchange from both picks, everyone else keeps playing, and leaving mid-clash loses it. Crates, barrels and the rest move, break and freeze the same on every screen, and Rime's pond ice holds everyone. The single-player fights, drills and the rooftop trial stay in single-player. Your Pacts, mastery and key bindings come with you from this browser.

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
| F | Aura Expansion: tap to wrap your body in a thin layer, hold to push it out into a wider, thinner field (spends all your aura), or retract (keeps the unused time). It cannot expand again until the aura has refilled |
| W / S / A or D | In an Aura Clash: push / hold / feint. Push beats hold, hold beats feint, feint beats push |
| E | Interact: plaques, the Architect, drills, challenges |
| V | Camera view: top-down, over the shoulder, first person |
| Alt | Perform the full hand sign |
| Tab | Pact Workshop |
| Esc | Pause: menu with your Technique and mastery stats, settings, controls, codex, map |
| M | Map |

In menus, Up and Down choose, Enter presses, Left and Right step along a row, and Q and E (or Page Up and Page Down) change tab. Tab stays the Workshop key, so menus do not use it.

### The HUD

The HUD keeps to the edges and shows what the moment needs. Top-left, in paper captions: the tutorial step, a drill's score and rules, the goal you are tracking (it steps aside in a fight), a plaque you are reading, passing messages, and a note when a mastery stat rises. A short key reminder fades in there when you stand idle; Settings turns it off. Top centre: the compass, with the tracked goal's distance, and a place's name as you arrive. Bottom-left: health, your Technique's resource and the aura; at rest only the bars and their kanji stay. Bottom-right: the Ability cards; a card says what its Ability does when the Ability is new to it, then folds to its name, and an empty extra slot shows only its key. The mastery numbers, the sign you cast with, and the camera view are on the pause menu.

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
game.teleport('hall')              // courtyard, hall, ring, pond, roof, store, gate, stairs, road, field, bridge, grounds, ginkgo, falls, terraces, shrine, or [x, y, z]
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

It writes `captures/report.json` with every screenshot path, modal-fit failures, and page errors, and exits non-zero on any failure. Pieces: `ui`, `hud`, `hands`, `variants`, `sign`, `poses`, `third-person`, `views`, `compound`, `vfx`, `style` (the look at 1920×1080 from every camera: the yard, the hall, a fight, every cast and every Maximum Output at its beats; `--techs` and `--views` narrow it), `encounters`, `roles` (every enemy role in a line-up and in close portraits), `workshop`, `tutorial`, `drill`, `perf`.

### Checks

Every `npm run check:*` script and `node tools/check-flow.mjs` drives the built game with real keys, clicks and the mouse: `check:casts` (every Technique's casts and full sign read on the body from the top-down and over-the-shoulder cameras: the hands travel and stand off the torso on screen, moves stay apart at impact, and the legs keep their stride under a cast; it saves a strip of frames per move), `check:controls` (the movement keys follow the camera's axes in all three views), `check:cutscenes` (every Maximum Output's cutscene and the bosses' run two to four seconds, land the blow on the beat to the frame, pull the target in, hold the world, return to each camera view, skip and shorten as set, and online lock only the two in it; it saves frames of each at its beats), `check:effects` (a restart leaves no effect behind, and the Master's field tints only a player inside it), `check:keybinds`, `check:locomotion`, `check:navigation`, `check:rooftop` (the whole trial), `check:scenes` (a fight won by a Maximum Output's blow ends, no drill or fight starts inside another, a new run ends a drill, Tab opens the Workshop from the pause menu, and no draft is tried in a real fight, even in the tutorial), `check:sign`, `check:valley` (out of the gate, round the walls, down the road to the shrine and back with real keys; the cliffs hold from every side; the map, the field, the cutaway, and a second player seeing the first out there), `check:tints` (enemy suits and costumes read as cloth and apart from each other), `check:training` (regen waits for the quiet spell and stays off near enemies, in encounters and on the roof; passive play stops every stat at the ceiling; the Striking Posts' four tiers for every Technique take every stat it uses to the top; a dummy hit grows by the potency added), `check:regen-online` (the server's regen, seen by the player and the room), `check:aura` (expansion spends the whole pool, retraction keeps the unused share of the field as pool, no expansion before a full refill, a tap's body layer with no area, a hold growing it outward with density falling every frame and the player slowed while pushing, reinforcement and faster cooldowns strongest at the layer, an enemy's blow sensed before its wind-up in a field but not in a layer, equal picks going to the denser aura, a field reaching a body layer contesting it and two layers never clashing, the drill, refinement and potential, the Master's density and reinforcement, clashes between her field and a body layer lost on tied picks untrained, won on the same picks refined and won by reading her tells, a field pushed into her edge clashing as it is and then pressing her, with no health lost and the world still running, a clash shot in the hall the fields do not wash out, her tells read from her pose, and the interact prompt clear of the Ability cards at four window sizes), `check:multiplayer` (three browsers in one room: movement, an Ability hitting exactly once, a down and respawn, two body layers at arm's length that do not clash, a field pushed out into a body layer that does and plays the same on every screen while a third player keeps walking, a forfeit by leaving, props, breakage and the pond ice shared between screens, a player's tab sent to the background and frozen, a server restart, leaving; add `--latency 120` to run it with added delay), and `check:audio` (nothing made or fetched before the first click, then the bed indoors and out, a footstep per surface, every Technique's casts and Maximum Output, hit weight, the aura, the drill, the interface and the volume settings, read from the mixer's cue log), `check-flow` (the Workshop, the dummies and the whole tutorial), and `check:hud` (the HUD and every sheet at 1280x720, 1920x1080, 390x844 and 844x390: nothing overlaps, leaves the window or is cut off sideways; it saves a screenshot of each scene). `tools/perf-rooftop.mjs` measures frame times in every view at DPR 2 (or `--size 1920x1080 --dpr 1 --quality medium`), with a wide field open and during a clash, and `tools/perf-multiplayer.mjs` does the same in a full room of eight.

## Layout

```
src/app         state machine, settings, input, asset loader, clock, game loop, debug hooks
src/render      renderer and post stack, screentone materials, the page (brush ink, paper, staging lines, painted looks), brush textures, the sky and sun
src/physics     Rapier world and queries
src/player      character controller, camera rig
src/character   human avatar: looks, locomotion blend at measured clip speeds, gesture layer on the arms
src/hands       first-person arms on the human skeleton: calibrated IK rig, poses, gesture timelines
src/pacts       Pact schema, validator, JSON Schema, Resolve, readback, the player's book
src/mastery     mastery stats and gesture variant selection
src/techniques  Technique kit contract, runtime, VFX pool, kits/<technique>.ts
src/combat      player combat, enemies, encounters, aura fields (rules, drawing) and the Aura Clash
src/net         online rooms: protocol, shared rules, the clash referee both sides run, socket, other players, effect mirroring
src/cutscene    data-driven cutscene player
src/tutorial    step machine
src/drills      drill runtime, the aura drill (Reading the Field)
src/world       the compound, the valley round it (valleyPlan.ts is its layout), props, waypoint shrines
src/workshop    Pact Workshop UI
src/ui          App, HUD, sheets, styles
src/audio       Web Audio mixer
server          index.mjs (static files and /ws), realtime.mjs (rooms), deploy.sh
tools           build-assets.mjs, manifest.mjs, capture.mjs, peek.mjs and the check scripts
```
