# Zenkoverse: Pact — rebuild design

## Goal

The player explores a rainy night district of the Zenkoverse in first or third person. They fight, experiment, and learn the power system by doing. Each Technique has visible hands and body motion and physically changes the world. The bar is AAA presentation in a browser. A player should not be able to tell an AI built it. Finish each system before adding another, and leave nothing that reads as placeholder: lighting, materials, animation, camera feel, sound, UI, and feedback all done to a studio standard. Anything that looks generic or "AI-made" counts as a bug.

The private wiki lives at `../Zenkoverse` (outside this repo). Read it for content. Never copy its files into the repo.

## Art direction

**Realistic world, MAPPA-grade motion.** The rendering is realistic: PBR materials, physically plausible night lighting, wet asphalt, volumetric haze around neon, realistic proportions. The motion and fight direction are at the level of MAPPA's Jujutsu Kaisen fights:

- Strong anticipation, fast snaps, and overshoot. Every ability has a readable silhouette.
- Impact frames on big hits: one to three frames of inverted or high-contrast color, then a hold.
- Hit-stop scaled to the blow. Smear and motion-trail VFX on fast limbs.
- Debris and shock rings that follow real physics.
- Short cinematic camera moves for Maximum Output: a dolly-in, a dutch angle, a brief slow-mo, and a cut back to gameplay control, all skippable.

Hand gestures are choreographed like key animation, not tweened between two poses. References to judge against: the JJK S2 Shibuya fights (Gojo vs Jogo, Yuji vs Mahito), the hand and arm animation in Ghostrunner and Mirror's Edge Catalyst, and the night streets of Marvel's Spider-Man and Cyberpunk 2077.

## Stack

- Vite + TypeScript (strict). three.js 0.170.
- Physics: `@dimforge/rapier3d-compat` (WASM inlined, so it works on GitHub Pages). Use the kinematic character controller for the player and NPCs, and dynamic rigid bodies for props.
- Rendering: `postprocessing` (pmndrs) for SMAA, bloom, tone mapping, and vignette, plus `n8ao` for ambient occlusion. An HDR environment (Poly Haven, CC0) handles reflections on wet surfaces.
- UI: Preact + @preact/signals for menus and HUD. The DOM sits over the canvas. Never build HTML strings.
- Assets: only CC0 or similarly permissive assets, committed under `public/assets/`, each listed in `CREDITS.md` with source URL and license. Candidates: Quaternius and KayKit (characters and animations, CC0), Kenney (city kits, props, sounds, CC0), Poly Haven and ambientCG (HDRIs and PBR textures, CC0). Compress them: Draco or meshopt for glTF, KTX2 or WebP for textures. Keep the first load under about 25 MB.

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

type CameraMode = 'first' | 'third';  // V toggles, with an eased transition

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

1. **Player and camera.** A Rapier character controller handles walking, sprinting, jumping, mantling small ledges, and the dash. Pointer-lock mouse look. First person shows viewmodel arms in a separate overlay pass with its own FOV, plus head bob, sway, landing dip, and FOV kick. Third person uses an over-the-shoulder spring-arm camera with collision. The same rigged character plays locomotion clips through an AnimationMixer, with an upper-body cast layer and procedural arm aim for the Technique gesture.
2. **Hands.** Use rigged, skinned first-person arms with finger bones, either from a CC0 source or built from a skinned mesh. Never use capsules. Each Technique has signature gestures, for example:
   - Recoil braces both palms forward to absorb, then throws a punch.
   - Rime's nails frost over and grow claws, and it slams a palm to the ground for Icebreak.
   - Blink cups its eyes, and the hands flinch back on the pulse.
   - Echo presses a palm flat to a surface, and Ring is a snap.
   - Shift makes a two-finger point before translating.

   Idle hands breathe and react to the rain.
3. **Techniques in the world.** Rime freezes puddles and water into walkable ice and pins props. Recoil absorbs falling or thrown props and relaunches them. Echo resonates a resonant prop or structure until it fractures into pre-broken pieces. Blink shoves props and people. Shift translates through walls and must handle occupied destinations.
4. **District.** One dense, hand-placed district of about 200 × 200 m, not procedural soup. It contains:
   - The Academy courtyard, where the tutorial runs.
   - The Pact Workshop, a small dojo interior with a Pact Architect NPC.
   - A market street of neon signs, vending machines, and stalls.
   - Alleys where Criminal Underworld thugs start fights.
   - Rooftops you can reach.
   - A steel bridge over a canal, where the Ancient Echo Master can be challenged.
   - The Kuroda house exterior, with a fight that reveals their "fire" is fuel.

   Add ambient pedestrians, rain with splashes, wet PBR surfaces, puddles, steam vents, and flickering signs. Lore plaques with short wiki excerpts are collectible.
5. **Combat.** Use the same rules as the arena version (Pacts, Resolve, Risk, Wagers on R, Maximum Output on Q, Eyes, Aura Expansion and Aura Clash on F). Enemies are rigged and animated, with hit reactions and ragdoll-lite knockback through physics impulses.
6. **Pact Workshop.** Lesson from the arena version: its random offer of "Unmoving Stance (+50% while still)" next to "Rooted Vow (+60% while still)" was a non-choice. Anything that presents Pact options side by side must offer distinct sacrifices, never two that share a sacrifice tag. Every modal must fit the viewport at 1280×720 and 1920×1080 with nothing clipped; the capture harness checks this.
    Build a Pact from parts: sacrifice, condition, benefit, duration, and an optional Risk or Wager. Show Resolve live, including the anti-loophole rule ("this sacrifice is already counted"). Programming is a small IF/THEN rule builder. A training dummy room lets you test Pacts.
7. **Tutorial.** Run it at the Academy as a step machine, covering movement, look, the camera toggle, the primary and secondary abilities, a Pact, a Wager, and Maximum Output. It can be skipped and replayed from the menu.
8. **UI.** Treat the UI as a design system. It has a title screen with a slow 3D camera flyover, a loading screen with real progress, a radial or diegetic-leaning HUD that stays out of the way, and a settings menu covering sensitivity, FOV, quality preset, volume, camera mode, and invert Y. The pause menu holds a codex and a map. The UI is fully keyboard navigable, with transitions on every surface. Japanese-influenced typography, used tastefully.
9. **Audio.** Layer CC0 sound effects with Web Audio: rain ambience that is muffled indoors, footsteps per surface, Technique sounds, and UI sounds.
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

Rebuild in place on the `rebuild` branch. Delete the arena code once it is superseded. Do not keep it alive alongside. Commit each phase after it builds and passes the headless check. Keep the `?debug` hook: expose `window.game` and add teleport and skip-tutorial helpers.

## Phase A deviations and known gaps

Each line names a departure from the sections above, with the reason.

- **One realistic human serves first and third person.** Every character is the Quaternius Universal Base Character (CC0) with clips from the Universal Animation Library (CC0), both retargeted and packed into `public/assets/characters/human.glb` by `tools/human.mjs`. The rig has three finger bones per finger. The first-person arms are the arm cut of that same mesh, driven by the pose and gesture data in `src/hands/`. The base character is unclothed, so the suit, sleeve and cuff are offset shells generated from the skin mesh at build time; a look (`src/character/avatar.ts`) picks hair, skin tone and suit colour. The KayKit Adventurers of Phase A are gone.
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
- **Textures are WebP, not KTX2.** `toktx` is not available in the build environment. Geometry is meshopt-compressed. First load is 24.8 MB.
- **Rain ambience is synthesized** (filtered noise through Web Audio) because no CC0 rain loop was available for automated download; it is muffled indoors.
- **Navigation (issues #33, #35)** reads one registry, `POIS` in `src/nav/poi.ts` (name, kanji, landmark, label anchor, waypoint shrine, fast-travel landing). The compass, the tracked marker with its edge clamp, the world light column and ground trail (`src/nav/trail.ts`), landmark name labels, the map, and the shrines (`src/world/waypoints.ts`) all derive from it. The tracked target is the map pin, else the tutorial step, else the first goal in `GOALS` whose waypoint is still locked. A waypoint unlocks when the player stands within 6 m of its shrine; unlocks and the pin persist in localStorage. Fast travel works only from the open world, not in a fight or the tutorial. M opens the map; clicking a place selects it, and Track or Fast travel act on it. The HUD margin is `--hud-pad`; the top-left column (`src/ui/nav/TopLeft.tsx`) holds the tracker and the key hints in one flow, and `tools/capture.mjs --only hud` checks the corner margins, overlaps and on-screen fit at 1280×720, 1920×1080, 2000×1000 and 2560×1440. `tools/check-navigation.mjs` (`npm run check:navigation`) drives the map, tracking, marker, waypoint unlock and fast travel with real input.
- **Rooftop trial (issue #34)** replaces the classic `/arena/` build, which is deleted. It lives in `src/rooftop/`, one file per concern: `waves.ts` (the eight waves, scaling and score as data), `offers.ts` (the Pact templates and the rule that no two offers share a sacrifice, plus `audit` that rolls them), `arena.ts` (the tower on the canal's east bank, its deck and its lift), `rooftop.ts` (the run as a state machine: fight, offer, over) and `RooftopUi.tsx` (run strip, Pact, Eye and Aura sheets, end screen). The title's Rooftop button and the lift both start it. The offers are templates authored in the #3 schema that pair two or three sacrifices the engine enforces (trigger, range, direction, target, resource, standing still), plus any catalogue Ability the key is not using. Taking one inscribes and binds it for the run only: the book is exported at the start and imported at the end, and again at boot if a run was closed mid-way, so the trial never rewrites the player's real Pacts. The Eye is also lost at the end. Eyes in the trial have a rule each (Horizon wide telegraphs and softer blows, Empty more damage, Thread a share of each hit to a neighbour); the Vault Eye is not offered because a second Technique has no home in the rebuild yet. Regular enemies carry half their district health and 65% of their damage, and the crowd takes turns to wind up (`Encounters.claimAttack`), because a wave is a dozen bodies where a district fight is two. `tools/check-rooftop.mjs` plays all eight waves to victory and to defeat in both camera modes and asserts every offer; `tools/perf-rooftop.mjs` measures a full wave.
