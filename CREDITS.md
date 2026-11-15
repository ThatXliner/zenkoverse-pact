# Credits

Every third-party asset in `public/assets/` is listed here with its source and license. `tools/build-assets.mjs` compresses them from the raw downloads (meshopt for geometry) and writes this file.

| Asset | Author | License | Source | Used for |
| --- | --- | --- | --- | --- |
| Universal Base Characters (Standard) | Quaternius | CC0 1.0 | https://quaternius.com/packs/universalbasecharacters.html | The rigged human with finger bones behind every character: the first-person arms and hands, the player and the enemies. Drawn cel-shaded at runtime with flat fills and an ink hull; its skin textures are not used. The suit, sleeve and cuff are generated from the skin mesh by tools/human.mjs. |
| Universal Animation Library (Standard) | Quaternius | CC0 1.0 | https://quaternius.com/packs/universalanimationlibrary.html | Locomotion, jump, hit, death and casting clips, retargeted onto the base character by bone name. |
| City Kit (Suburban) | Kenney | CC0 1.0 | https://kenney.nl/assets/city-kit-suburban | Planters in the courtyard. |
| Food Kit | Kenney | CC0 1.0 | https://kenney.nl/assets/food-kit | Barrels, a steamer and a pot: things for the Techniques to throw. |
| Furniture Kit | Kenney | CC0 1.0 | https://kenney.nl/assets/furniture-kit | The training hall's furniture, benches, cardboard boxes, stools, chairs and the coat-rack training dummies. |
| KayKit City Builder Bits 1.0 | Kay Lousberg | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0 | Crates. |
| Impact Sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds | Footsteps on stone, wood and grass, and the physical layer of every hit, catch and landing. |
| Interface Sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds | Menu, Workshop, toast and drill feedback. |
| Digital Audio | Kenney | CC0 1.0 | https://kenney.nl/assets/digital-audio | Technique layers. |
| RPG Audio | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio | Gravel and sand footsteps, cloth swishes under the hand signs and swings, the hall's creaking boards, the Workshop's pages, Shift's cut. |

Every recording in `public/assets/audio/sounds.pack`, by the Kenney pack (CC0 1.0) it comes from. Each is transcoded to mono Opus and kept under its original name:

- Impact Sounds (https://kenney.nl/assets/impact-sounds): footstep_concrete_000, footstep_concrete_001, footstep_concrete_002, footstep_concrete_003, footstep_concrete_004, footstep_wood_000, footstep_wood_001, footstep_wood_002, footstep_wood_003, footstep_wood_004, footstep_grass_000, footstep_grass_001, footstep_grass_002, footstep_grass_003, footstep_grass_004, footstep_snow_000, footstep_snow_001, footstep_snow_002, impactPunch_heavy_000, impactPunch_heavy_001, impactPunch_heavy_002, impactPunch_medium_000, impactPunch_medium_001, impactPunch_medium_002, impactSoft_heavy_000, impactSoft_heavy_001, impactSoft_heavy_002, impactSoft_medium_000, impactSoft_medium_001, impactSoft_medium_002, impactGeneric_light_000, impactGeneric_light_001, impactGeneric_light_002, impactMetal_heavy_000, impactMetal_heavy_001, impactMetal_medium_000, impactMetal_light_000, impactMetal_light_001, impactGlass_heavy_000, impactGlass_heavy_001, impactGlass_heavy_002, impactGlass_medium_000, impactGlass_medium_001, impactGlass_light_000, impactGlass_light_001, impactGlass_light_002, impactWood_heavy_000, impactWood_heavy_001, impactWood_medium_000, impactWood_medium_001, impactWood_light_000, impactWood_light_001, impactPlank_medium_000, impactPlank_medium_001, impactBell_heavy_000, impactBell_heavy_001, impactBell_heavy_002, impactPlate_heavy_000, impactPlate_heavy_001, impactMining_000, impactMining_001, impactMining_002.
- RPG Audio (https://kenney.nl/assets/rpg-audio): footstep00, footstep01, footstep02, footstep03, footstep04, footstep05, cloth1, cloth2, cloth3, cloth4, knifeSlice, knifeSlice2, creak1, creak2, creak3, bookFlip1, bookFlip2, bookPlace1, beltHandle1, drawKnife1.
- Interface Sounds (https://kenney.nl/assets/interface-sounds): click_002, click_003, select_001, select_002, select_003, confirmation_001, confirmation_002, error_004, error_006, open_001, close_001, tick_001, tick_002, question_002, glass_002, pluck_001, bong_001, glitch_001, switch_002.
- Digital Audio (https://kenney.nl/assets/digital-audio): phaseJump3, powerUp9, zapTwoTone, lowDown, spaceTrash1.

Typography is loaded from Google Fonts under the SIL Open Font License: Shippori Mincho B1, Zen Kaku Gothic New, and Inter.

The compound itself (walls, hall, roofs, stair, bridge, ring, pond, lanterns, trees and hills), the cel-shading materials, the ink line effect, the sky, the ice, aura and shock-ring effects, the generated clothing shells, the hand poses and gestures, all UI, and every synthesized sound (the ambience beds, the music, and the whooshes, risers, booms and shimmers layered into the Techniques, src/audio) are original to this repository.
