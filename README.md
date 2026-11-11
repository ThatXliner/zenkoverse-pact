# Zenkoverse: Pact

A small 3D arena game built on the Zenkoverse power system. You pick a Technique, hold a rooftop in the rain for eight waves, and grow your output the way the setting says you must: by giving things up.

**Play it:** https://bryanhu.com/zenkoverse-pact/

## What is in it

- **Five Techniques**: Recoil, Shift, Rime, Blink, Echo. Each has a primary, a secondary, and a Maximum Output.
- **Pacts** between waves. Choose one of three permanent restrictions for more output. Two Pacts built on the same sacrifice share its value (the anti-loophole rule), so stacking "stand still" twice buys almost nothing.
- **Wagers**: press R to declare that your next attack will connect. x3 if it does. If it misses, your Technique is sealed.
- **Risk** Pacts: fire Maximum Output early and pay in health, or keep casting on an empty resource and pay in blood.
- **Eyes** after wave 3. Installing one replaces a natural eye for good. Horizon shows attacks before they land, Empty reveals the veiled, Thread shows and exploits Pact Architect links, Vault houses a second Technique.
- **Aurabending** after wave 4. Hold F to expand your aura. When it meets the Ancient Echo Master's field the two clash, and holding your ground while she presses is how you break her guard.
- Two bosses: the Kuroda Enforcer, whose "fire" is fuel you can see before it lights, and the Ancient Echo Master.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| LMB | Technique primary |
| RMB | Technique secondary (hold for Recoil's Absorption and Echo's Quiet) |
| Space | Dash |
| Q | Maximum Output, when the ring is full |
| R | Declare a Wager on your next attack |
| F | Aura Expansion (after wave 4) |
| E | Vault Eye: use the housed Technique |
| Esc | Pause and read the codex |

## Run it locally

```sh
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`. Append `?debug` to the URL to expose `window.game`, `K` to clear the current wave, and `G` for god mode.

## Stack

Vite, three.js, vanilla JavaScript, synthesized audio. All geometry is procedural; the only assets are small thumbnails of the author's concept art.
