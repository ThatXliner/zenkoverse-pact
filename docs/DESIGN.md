# Zenkoverse: Pact — design

## Goal

A proof of concept that the Zenkoverse power system plays well as a game (issue #48). The player trains in one walled dojo compound at dusk. They fight, experiment, and learn the power system by doing: Techniques, Pacts and the Workshop, Resolve, the full hand sign, Maximum Output, drills, the tutorial and the rooftop trial. Each Technique has visible hands and body motion and physically changes the world. Polish goes to the fights and to the readability of the power system, not to world size: a very well-built small area beats a half-finished city. Finish each system before adding another, and leave nothing that reads as placeholder. Anything that looks generic or "AI-made" counts as a bug.

The private wiki lives at `../Zenkoverse` (outside this repo). Read it for content. Never copy its files into the repo.

## Art direction

**One stylized drawing, anime-leaning cel shading.** The whole frame, characters and world alike, is drawn the same way (`src/render/materials.ts`, `src/render/ink.ts`):

- Every surface is a `MeshToonMaterial` over one shared four-step light ramp: core shadow, half tone, lit, highlight. Shadow maps are snapped to a hard band before the ramp sees them, so cast shadows are shapes, not gradients.
- Flat fills. No PBR textures, no HDR environment, no roughness maps. Wood, plaster, paving and tile are painted colours from one palette (`PALETTE` in `src/world/compound.ts`); the only textures are flat flagstone and plank patterns drawn on a canvas at start.
- Ink lines. A post effect draws a line wherever the depth buffer breaks: a fine one at a crease (a wall meeting a roof, the edge of a box), a full one at a silhouette. Characters and the first-person arms also carry an inverted hull, so their outline keeps its weight at any distance.
- Stylized people. One rigged human (Quaternius, CC0) in flat skin, flat hair and a flat suit in the role's colour, with the head and hands drawn large. No skin textures and no face detail. Enemy roles read by suit colour and silhouette (height, chest width); `tools/check-tints.mjs` keeps the suits apart from skin tones and from each other.
- Late afternoon. A low warm sun from the west, long hard shadows, blue shade, a painted sky gradient with flat cloud bands, lanterns already lit. Mood from light, not from detail count.

The motion and fight direction stay at the level of MAPPA's Jujutsu Kaisen fights:

- Strong anticipation, fast snaps, and overshoot. Every ability has a readable silhouette.
- Impact frames on big hits: one to three frames of inverted or high-contrast color, then a hold.
- Hit-stop scaled to the blow. Smear and motion-trail VFX on fast limbs.
- Debris and shock rings that follow real physics.
- Short cinematic camera moves for Maximum Output: a dolly-in, a dutch angle, a brief slow-mo, and a cut back to gameplay control, all skippable.

Hand gestures are choreographed like key animation, not tweened between two poses. References to judge against: the JJK S2 Shibuya fights (Gojo vs Jogo, Yuji vs Mahito) for motion; for the look, the flat colour and ink of The Legend of Zelda: Breath of the Wild's painted world, Hi-Fi Rush and Guilty Gear Strive's cel characters, and Okami's drawn landscapes.

## Stack

- Vite + TypeScript (strict). three.js 0.170.
- Physics: `@dimforge/rapier3d-compat` (WASM inlined, so it works on GitHub Pages). Use the kinematic character controller for the player and NPCs, and dynamic rigid bodies for props.
- Rendering: `postprocessing` (pmndrs) for the ink lines, SMAA, bloom, a hue-preserving tone curve and vignette. Toon materials over one light ramp; no ambient occlusion pass and no HDR environment.
- UI: Preact + @preact/signals for menus and HUD. The DOM sits over the canvas. Never build HTML strings.
- Assets: only CC0 or similarly permissive assets, committed under `public/assets/`, each listed in `CREDITS.md` with source URL and license. In use: Quaternius (the rigged human and its animations), Kenney (furniture, crates, barrels, sounds) and KayKit (crates). Geometry is meshopt-compressed. The first load is under 2 MB.

## Core data shapes

Each organizing structure is chosen so that adding content means adding data, not adding branches.

```ts
// App flow: one state machine, not booleans.
type AppState =
  | { kind: 'boot'; progress: number }
  | { kind: 'title' }
  | { kind: 'tutorial'; step: TutorialStepId }
  | { kind: 'explore' }
  | { kind: 'workshop' }            // Pact workshop UI open, world paused
  | { kind: 'encounter'; id: EncounterId }
  | { kind: 'paused'; resume: AppState };

type CameraMode = 'top' | 'third' | 'first';  // V cycles, with an eased transition; top is the default

// Techniques: a registry keyed by id. An ability is data plus an effect function.
interface TechniqueDef {
  id: TechniqueId; name: string; color: number; resource: ResourceDef;
  abilities: Record<AbilitySlot, AbilityDef>;   // 'primary' | 'secondary' | 'max'
}
interface AbilityDef {
  gesture: GestureId;                            // drives the hands and body
  phases: { windup: number; active: number; recover: number };
  cost: number;
  effect(ctx: AbilityContext): void;             // acts on the physics world and actors
}

// Hands: poses are data. A gesture is a timeline of poses blended with springs.
interface HandPose { wrist: Euler; fingers: Record<Finger, [number, number, number]>; armOffset: Vector3 }
interface Gesture { keys: { t: number; left: HandPose; right: HandPose }[]; camera?: CameraKick }

// Pacts: a composable rule, evaluated each hit. Programming is IF/THEN rules.
type Condition =
  | { kind: 'still' } | { kind: 'range'; max: number } | { kind: 'facing'; deg: number }
  | { kind: 'healthBelow'; frac: number } | { kind: 'named' } | { kind: 'grounded' } | { kind: 'airborne' };
interface Pact {
  id: string; name: string;
  sacrifice: SacrificeTag;          // anti-loophole: a tag already paid for earns nothing more
  condition: Condition; benefit: { output: number };
  duration: 'permanent' | { seconds: number } | { encounters: number };
  risk?: { extends: Condition; cost: Cost };
  wager?: { declare: Prediction; reward: number; forfeit: Cost };
}

// World: props are data with physical and Technique-response traits.
interface PropDef { model: string; mass: number; breakable?: { pieces: string; hp: number }; traits: PropTrait[] }
type PropTrait = 'freezable' | 'resonant' | 'flammable' | 'porous' | 'kinetic-source';

// Tutorial: a data-driven step list, each with an objective predicate.
interface TutorialStep { id: TutorialStepId; title: string; body: string; objective(g: GameView): boolean; highlight?: UiAnchor }
```

## Systems

1. **Player and camera.** A Rapier character controller handles walking, sprinting, jumping, mantling small ledges, and the dash. Three camera views, cycled with V and chosen in Settings (`src/player/camera.ts`); switching eases the camera from where it was to where the new view wants it.
   - **Top-down (default).** The classic arena's high angle: the camera hangs above and behind a point between the player and the cursor and always looks north, so up on the screen is north on the map. No pointer lock: the cursor is visible, the body faces it, and Techniques fire at the point under it on the ground. Movement is screen-relative (W is up the screen whichever way the body faces) and sprint works in any direction. Roofs and walls that stand between the camera and the player fade out, and whatever is dressed on a faded roof hides with it, so a fight in the hall is as readable as one in the yard.
   - **Over the shoulder.** Pointer-lock mouse look turns the body; the spring arm collides with the world; the player aims at the crosshair.
   - **First person.** Viewmodel arms in a separate overlay pass with their own FOV, plus head bob, sway, landing dip and FOV kick; aim at the crosshair.
   The same rigged character plays locomotion clips through an AnimationMixer, with an upper-body cast layer and procedural arm aim for the Technique gesture. `PlayerController` keeps the facing (`yaw`) and the movement heading (`moveYaw`) apart; `tools/check-controls.mjs` proves the keys move along the camera's axes in every view. Input (`Input`) and player state (position, velocity, yaw, moveYaw) stay plain data a network layer can read and apply.
2. **Hands.** Use rigged, skinned first-person arms with finger bones, either from a CC0 source or built from a skinned mesh. Never use capsules. Each Technique has signature gestures, for example:
   - Recoil braces both palms forward to absorb, then throws a punch.
   - Rime's nails frost over and grow claws, and it slams a palm to the ground for Icebreak.
   - Blink cups its eyes, and the hands flinch back on the pulse.
   - Echo presses a palm flat to a surface, and Ring is a snap.
   - Shift makes a two-finger point before translating.

   Idle hands breathe and flex a finger now and then.
3. **Techniques in the world.** Rime freezes the koi pond into a floor you can stand on and pins props. Recoil absorbs falling or thrown props and relaunches them. Echo resonates a resonant prop or structure until it fractures into pre-broken pieces. Blink shoves props and people. Shift translates through walls and must handle occupied destinations.
4. **The compound.** One walled dojo compound, 48 by 40 m inside the walls, hand placed to the last post (`src/world/compound.ts`). A full lap takes well under a minute. It contains:
   - The training hall on the north side: the Pact Architect's desk (the Workshop), the dummies at the back, the Master's mat. Its flat roof deck is the rooftop trial's floor, reached by the stair on its west side.
   - The courtyard: the sparring ring (sand, a stone kerb, a painted boundary) where the sparring partners fight, the koi pond, the hoist for the Recoil crane drill, stone lanterns, benches, trees, crates and barrels for the Techniques to throw.
   - The storehouse on the east wall, its roof joined to the hall roof by a plank bridge.
   - A wall walk along the east and south walls from the storehouse roof to the gatehouse roof, and a stair down beside the gate. The Kuroda Enforcer answers a challenge at the gate.
   - Outside the walls: meadow, a tree line and painted hills, seen from the roofs.

   Every surface is complete: walls, roofs and the stair are closed solids, the roofs have rails and the walls an invisible rail above them, so nothing floats, nothing shows a seam and nobody falls out. Lore plaques with short wiki excerpts are collectible.
5. **Combat.** Use the same rules as the arena version (Pacts, Resolve, Risk, Wagers on R, Maximum Output on Q, Eyes, Aura Expansion and Aura Clash on F). Enemies are rigged and animated, with hit reactions and ragdoll-lite knockback through physics impulses.
6. **Pact Workshop.** Lesson from the arena version: its random offer of "Unmoving Stance (+50% while still)" next to "Rooted Vow (+60% while still)" was a non-choice. Anything that presents Pact options side by side must offer distinct sacrifices, never two that share a sacrifice tag. Every modal must fit the viewport at 1280×720 and 1920×1080 with nothing clipped; the capture harness checks this.
    Build a Pact from parts: sacrifice, condition, benefit, duration, and an optional Risk or Wager. Show Resolve live, including the anti-loophole rule ("this sacrifice is already counted"). Programming is a small IF/THEN rule builder. A training dummy room lets you test Pacts.
7. **Tutorial.** Run it in the courtyard as a step machine, covering movement, aiming, the camera views, the primary and secondary abilities, the extra slots, a Pact, a Wager, and Maximum Output. It can be skipped and replayed from the menu. `tools/check-flow.mjs` plays it from the first step to the last with real keys and the mouse.
8. **UI.** Treat the UI as a design system. It has a title screen with a slow orbit over the compound, a loading screen with real progress, a HUD that stays out of the way, and a settings menu covering sensitivity, FOV, quality preset, volume, the camera view, and invert Y. The pause menu holds a codex and a map of the compound. The UI is fully keyboard navigable, with transitions on every surface. Japanese-influenced typography, used tastefully.
9. **Audio.** Layer CC0 sound effects with Web Audio: an evening wind bed that drops indoors, footsteps per surface, Technique sounds, and UI sounds.
10. **Performance.** Hold 60 fps on an M1-class laptop on the High preset, with a Low preset. Use instancing for repeated props, frustum culling, and texture budgets.

## Delivery

**Phase A, foundation (one owner).** Put every system in place, playable end to end, at the highest quality one pass can reach. Keep module boundaries clean along the gauntlet pieces below, so each piece can be improved without touching the others.

**Phase B, gauntlet loop.** The lead splits the game into independently improvable pieces:
- first-person hands and gestures
- third-person character animation
- the district's look
- Technique VFX and fight direction
- encounters and enemy animation
- UI
- tutorial and workshop
- audio

Each piece gets a builder agent and a separate critic agent. The critic judges recordings and screenshots against the named real-world references and writes concrete failures. The builder revises until the critic passes it. Nobody grades their own work.

Delete code once it is superseded. Do not keep it alive alongside. Commit each phase after it builds and passes the headless checks. Keep the `?debug` hook: expose `window.game` and add teleport and skip-tutorial helpers.

**The proof-of-concept pivot (#48).** The district, pedestrians, cars, neon, rain, fast travel and the realistic look were cut and their code and assets deleted. What remains is the power system and one finished area. Realtime multiplayer (#44) is built on top of this; see the Multiplayer section.

## Phase A deviations and known gaps

Each line names a departure from the sections above, with the reason.

- **One rigged human serves first and third person, drawn cel-shaded.** Every character is the Quaternius Universal Base Character (CC0) with clips from the Universal Animation Library (CC0), both retargeted and packed into `public/assets/characters/human.glb` by `tools/human.mjs`. The rig has three finger bones per finger. The first-person arms are the arm cut of that same mesh, driven by the pose and gesture data in `src/hands/`. The base character is unclothed, so the suit, sleeve and cuff are offset shells generated from the skin mesh at build time. At runtime (`src/character/avatar.ts`) every material becomes a toon fill (the file's skin textures are not used), an ink hull is added around each skinned mesh, and the head and hand bones are scaled up for drawn proportions; a look picks hair and skin tone, and an enemy's `tint` and `build` pick its suit colour and chest width.
- **Pacts are the issue #3 model, not the stat-buff table.** `src/pacts/schema.ts` is the single source of truth, with a validator and an exported JSON Schema for issue #16. Catalogue Abilities are pre-authored as example Pacts the player can inscribe or edit. Resolve shows as a number plus a qualitative read. Both open questions can change inside `src/pacts` and `src/workshop` only.
- **Technique kit contract.** Every Technique is one module exporting `TechniqueKit` (`src/techniques/kit.ts`). Two things still sit outside the kit: the Blink blindness overlay reads `blinkUi` directly in `src/ui/App.tsx`, and Rime's canal ice platforms touch the physics world from inside the kit. Both should move behind a kit `ui`/`world` hook when Tier 2 lands.
- **Mastery (issue #17)** lives in `src/mastery/mastery.ts` with its tuning in `MASTERY_CONFIG`. Only the Recoil crane drill exists; it is the data template for the rest.
- **The full hand sign (issue #42)** is a state on `Techniques`, `SignState`: idle, signing (with progress), primed (with time left). Alt (`fullsign`, rebindable) starts the kit's `sign` gesture. Nothing cancels it: the player is rooted for its length and cannot cast, Wager or open the Workshop, and hits land without interrupting it. A finished sign primes the Technique for `MASTERY_CONFIG.sign.window` seconds; the next cast plays the flick variant and its potency carries `Mastery.signBoost`, which rises with Activation from `boost.novice` to `boost.master` along `activation^curve`. Every kit's sign shares the 1.6 s shape in `signGesture`: anticipation, the seal at about 0.5 s, a hold, the release at 1.2 s, and a primed stance the hands hold until the cast or the window's end. In third person the camera plays a front three-quarter shot for the sign and the avatar's arms fold into the seal procedurally (`Avatar.seal`), because the retargeted upper-body clips read as the same stance from the front. Maximum Output keeps its always-full sign in the cutscene. The old hold-Alt modifier and the `fullSignHold` setting are gone. `tools/check-sign.mjs` (`npm run check:sign`) drives it with real keys and saves the first- and third-person frames at the sign's beats; `tools/capture.mjs --only sign` shoots every Technique's sign for the hands critic.
- **Cutscenes (issue #27)** are `CutsceneDef` data in `src/cutscene/cutscene.ts`. Anchors are caster- or target-relative. All five Maximum Outputs and the Ancient Echo Master's ultimate route through it.
- **Aura (issue #4)** keeps the arena rules in `src/combat/aura.ts` and nothing else depends on its internals.
- **Workshop lesson.** The Workshop offers no side-by-side random options at all. Per issue #29 the readback sentence is the editor: each phrase the engine enforces is a button, the panel under the sentence shows that term's alternatives (a body diagram, direction tiles, range rings, a duration timeline, glyph tiles) with what each is worth to this player, and one bar reads Resolve. A sacrifice another Pact in use already pays shows struck through with that Pact's name. Every sheet is capped to the viewport and the capture harness checks the fit at 1280×720 and 1920×1080; `tools/check-flow.mjs` drives the whole flow with real clicks and times the 30-second test. `tools/check-keybinds.mjs` (`npm run check:keybinds`) drives the slots and rebinding with real input. Every check script takes the URL as a bare argument or `--url`, and serves `dist/` itself when it gets none (`tools/lib/target.mjs`).
- **Catalogue Abilities start inscribed (issue #3).** `PactBook` keeps an explicit binding per key. A key falls back to the raw Technique when the player unbinds it. Resolve is judged against the Pacts in use, so an unbound Pact's sacrifices stop counting. A draft can be tried on the dummies before it is inscribed.
- **Ability slots and key bindings (issue #41)** are two registries. `SLOT_DEFS` in `src/pacts/slots.ts` lists every slot: `primary`, `secondary`, `max`, the four extras `art1` to `art4`, and `passive` (no key). Each row names the kinds it accepts and its default key. A kind (`primary`, `secondary`, `max`) says how an Ability is cast, and `KIND_DEFS` holds its cooldown and base cost. A kit's `shapes` list the kinds they allow (`kinds`), and its gesture, avatar clip and audio tables are keyed by kind, so a Pact on `art2` casts as its shape's kind and no code branches on a slot. `ACTIONS` in `src/app/keymap.ts` lists every rebindable action, and each slot with a key is one. A binding is up to two cells per action (a main key and an alternate) holding a `KeyboardEvent.code` or `Mouse0` to `Mouse4`. No code sits in two cells: `assign` swaps or unbinds on a clash, and the Controls tab (`src/ui/Controls.tsx`) asks the player which. Bindings persist in `zenko.keys.v1`. Every label reads `keyLabel(action)` or `keyPhrase(action)`: the HUD, the Workshop readback and key picker, the tutorial cards, the key hints and the rooftop sheets. Escape is fixed, because it leaves pointer lock.
- **Auto-bind and save migration (issue #41).** A catalogue Ability binds to its own slot, or to the first free extra slot when another Ability holds it, so Shockline starts on 1. `PactBook` keeps a `claimed` list of catalogue Abilities that have had their turn, so one the player unbinds stays unbound after a reload. A save from before extra slots has no list: an Ability that holds its slot, or whose slot the player emptied, counts as placed, and the rest move to a free extra slot. Existing bindings are never changed. A Pact sits on one slot, so binding it empties the slot it left, and the Workshop offers swap or replace when the target is taken.
- **Rooftop offers (issue #41).** Offer templates name a kind. Each becomes a Pact on the slot that casts that kind, and, while an extra slot is empty, a second Pact on the first empty extra slot. The card reads "Adds to 2". Adding counts as stronger than any replacement, so fewer offers are pure sidegrades.
- **No PBR textures.** The cel look is flat fills; the only textures are the flagstone and plank patterns drawn on a canvas at start, and the Kenney palette maps the props arrive with. Geometry is meshopt-compressed. First load is under 2 MB. `tools/manifest.mjs` rewrites the byte manifest the loading bar reads whenever an asset is added or removed by hand.
- **The wind bed is synthesized** (brown noise through a breathing low-pass in Web Audio), and drops indoors.
- **Navigation (issues #33, #35), scaled to the compound** reads one registry, `POIS` in `src/nav/poi.ts` (name, kanji, where it is, label anchor, shrine). The compass, the tracked marker with its edge clamp, the ground trail (`src/nav/trail.ts`), landmark name labels, the map (a plan of the compound) and the shrines (`src/world/waypoints.ts`) all derive from it. The tracked target is the map pin, else the tutorial step, else the first goal in `GOALS` whose place has not been visited. A place counts as visited when the player stands within 5 m of its shrine; visits and the pin persist in localStorage. There is no fast travel: nothing in the compound is more than a short walk away. The compass reads the camera's heading, which is north in the top-down view. M opens the map; clicking a place selects it and Track pins it. The HUD margin is `--hud-pad`; the top-left column (`src/ui/nav/TopLeft.tsx`) holds the tracker and the key hints in one flow, and `tools/capture.mjs --only hud` checks the corner margins, overlaps and on-screen fit at 1280×720, 1920×1080, 2000×1000 and 2560×1440. `tools/check-navigation.mjs` (`npm run check:navigation`) drives the map, tracking, the marker and a visit with real input.
- **Rooftop trial (issue #34)** fights on the training hall's roof deck. It lives in `src/rooftop/`, one file per concern: `waves.ts` (the eight waves, scaling and score as data), `offers.ts` (the Pact templates and the rule that no two offers share a sacrifice, plus `audit` that rolls them), `arena.ts` (the trial's dressing on the deck: the painted ring, the marks where a wave climbs on, lanterns, cover and the board), `rooftop.ts` (the run as a state machine: fight, offer, over) and `RooftopUi.tsx` (run strip, Pact, Eye and Aura sheets, end screen). The title's Rooftop button and the board at the top of the hall stair both start it; the stair itself is walked. The offers are templates authored in the #3 schema that pair two or three sacrifices the engine enforces (trigger, range, direction, target, resource, standing still), plus any catalogue Ability the key is not using. Taking one inscribes and binds it for the run only: the book is exported at the start and imported at the end, and again at boot if a run was closed mid-way, so the trial never rewrites the player's real Pacts. The Eye is also lost at the end. Eyes in the trial have a rule each (Horizon wide telegraphs and softer blows, Empty more damage, Thread a share of each hit to a neighbour); the Vault Eye is not offered because a second Technique has no home in the rebuild yet. Regular enemies carry half their yard health and 65% of their damage, and the crowd takes turns to wind up (`Encounters.claimAttack`), because a wave is a dozen bodies where a yard fight is two. `tools/check-rooftop.mjs` plays all eight waves to victory in the top-down and first-person views and to defeat in the over-the-shoulder and top-down views, and asserts every offer; `tools/perf-rooftop.mjs` measures a full wave in all three views.

## Multiplayer (#44)

Realtime rooms of up to eight players fighting in the compound, live, each with their own Technique and Pacts. Play Online on the title, or a link with `?room=<code>`, opens the Technique screen with a name field (kept in `zenko.name`) and the room code (default `dojo`). The address bar carries the room code once inside, and the online menu copies the link.

**Shape.** `server/realtime.mjs` hangs off the game server's port at `/ws` and keeps rooms in memory. The client side is `src/net/`: `protocol.ts` (the message shapes, the reference for both sides), `rules.json` (every number both sides share: tick rate, interpolation delay, health, respawn, bounds, spawn points; the server imports it too), `net.ts` (the socket, reconnect, and the bridge to the game), `remote.ts` (another player's body), `fxwire.ts` (effect mirroring). `src/ui/Online.tsx` holds the join form, name plates, scoreboard, feed and the downed card.

**Authority, and why.** Responsiveness and agreement under 50 to 150 ms matter more than cheating for now, so:

- Each client simulates its own movement, Technique, Pacts and Resolve, exactly as offline. Nothing about moving or casting waits on the network. The Pact engine runs unchanged on the caster's client, so it stays one deterministic module.
- The attacker's client decides whether its Ability hit, against other players drawn where it sees them (favour the shooter: what you aimed at is what you hit). Kits never learn they are online: another player is a `RemotePlayer`, which is an `Enemy` with no AI, so cones, spheres, rays against the enemy group, Wagers and the Maximum Output target all treat players like any other body. Its `hurt` sends a hit to the server instead of taking health.
- The server is the only place health changes. It checks each hit against bounds (both standing, the victim past spawn protection, within 48 m, a sane amount, a send-rate limit) rather than replaying the attacker's simulation. It then asks the victim's client what its own defences let through (Recoil's brace, Echo's quiet, the Horizon Eye, the grace after a hit), because those are rules of the victim's Technique state, applies the answer once, and announces it to the room. A victim that does not answer in 1.5 s takes the full amount. Every hit carries a per-attacker sequence number and a server hit id, so a resent or duplicate hit never applies twice and an answer after the timeout is ignored. Since the attacker decides and the server announces, every screen agrees on who was hit.
- The server owns downs (health 0), the score (downs dealt, times downed), respawns (4 s later, at the spawn point farthest from everyone standing) and 1.5 s of spawn protection.
- Health a player spends on itself (Risk costs, a health-priced Ability) is sent as self damage and applied the same way.

**Movement.** Clients send their state 20 times a second, stamped with their own clock. The server relays everything received at a fixed 20 Hz tick. Receivers interpolate each player on that player's own timeline, 100 ms behind the newest sample (the offset is the least-delayed arrival over the last two seconds, so jitter and the tick's bunching are absorbed). A gap of more than 5 m between samples (a respawn, a Shift) is a cut, not a slide. Past the newest sample a body coasts on its velocity for at most 150 ms.

**Seeing Abilities.** Casts are announced with the caster's clock, so the other screens play the avatar's cast clip and the cast sound (quieter with distance) when the drawn body reaches that moment. Everything a Technique draws through the shared effect pool (`Vfx`: rings, sparks, trails, frost, ice, afterimages) is recorded and replayed on the other screens from the same calls, also on the caster's timeline. The pool is wrapped from outside, so kits are untouched. The attacker sees its number at once and the name plate's bar drops on the blow, settled when the server answers; a hit the victim's defences stopped reads "blocked".

**Single-player assumptions, answered online (the list in #44).**

- *Pause freezes the world.* Online the menu, the map and the Workshop are overlays: the world keeps running and you can be hit (the menu says so).
- *Maximum Output freezes time.* Online the cutscene is the caster's own camera only. The world runs at full speed; the caster cannot be hurt for the cutscene's length and glows on the other screens, and the others get a "Maximum Output" notice.
- *Hit-stop and slow-mo bend the clock.* `GameClock.shared` keeps time at its real rate online; the shake, kick and impact frame remain as local presentation.
- *Wagers, encounters, the aura clash.* A Wager counts hits on players. The sparring partners, the gate, the Master, the drills and the rooftop trial are single-player and are not offered online (the Workshop's dummies still work, locally). Aura Expansion works as before; the clash only exists against the Master's field, and a clash between players should lock only the two players involved when Aura (#4) is built.
- *Saves.* The Pact book, mastery and bindings stay in this browser's storage and travel with the player into rooms. There are no accounts.
- *Client authority.* As above: checked against bounds, not replayed.

**Rooms and connections.** A room is created on first join and dropped once empty. A dropped socket keeps its seat and score for 20 s: a reload or a reconnect takes them back (one token per tab in sessionStorage). Choosing to leave gives the seat up at once. The server pings sockets to find dead tabs. A background tab stops sending, so others see it marked away and standing still; hits on it still resolve, because the socket keeps handling messages. If the server restarts, clients keep playing locally and rejoin with backoff.

**Known gaps.** The world itself is not shared: props, breakage and Rime's ice floor are simulated on each screen separately (their effects are mirrored, their physics are not). Another player's Aura field is not drawn. A hit travels four network legs before health settles (attacker, server, victim, server), so with 120 ms each way a down lands about half a second after the blow on the attacker's screen; the name plate's predicted bar hides most of that.

**Checks.** `npm run check:multiplayer` serves `dist/` through `server/index.mjs` and drives two browsers in one room through the join form with real keys and clicks: each sees the other walk and stop within centimetres of the true position with no frame-to-frame jump, one Ability damages the other exactly once by the amount sent, a down, the score and a respawn replicate, both rejoin after a server restart, and a player who leaves disappears. `--latency 120` adds 120 ms to every message in each direction (also a `server/index.mjs` option). `tools/perf-multiplayer.mjs` measures frame times in each view with seven protocol bots (`tools/lib/bots.mjs`) running round the player.

Rules for new work stay as before: no new global time changes, and game rules stay in deterministic modules apart from rendering and input.
