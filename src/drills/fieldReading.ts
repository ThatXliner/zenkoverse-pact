import * as THREE from 'three';
import type { Game } from '../app/game';
import type { DrillDef, DrillItem } from './drills';
import { toon } from '../render/materials';
import { FieldView } from '../combat/fieldView';
import { PICKS, counterTo, type Pick } from '../net/clash';

// Reading the Field (気読み), the aura drill (issue #4). It trains refinement,
// the mastery stat that sets how dense and strong the player's field is. A
// listening stone in the yard opens a field and shows the clash tells one
// after another: it swells toward you before a push, draws tight before a
// hold, and flickers on its far side before a feint. The player answers each
// with the pick that beats it, before the tell fades. Any Technique can run
// it; the gains go to the Technique in hand, capped by its potential.

const STAND: [number, number, number] = [6, 0, 3.2];
const STONE = new THREE.Vector3(6, 0, -0.4);
const RADIUS = 3.1;
const COLOR = 0x9fe3ff;
const KEYS: Record<Pick, string> = { push: 'W', hold: 'S', feint: 'A or D' };
const WORDS: Record<Pick, string> = { push: 'It swells toward you', hold: 'It draws tight', feint: 'Its far side flickers' };
// The tell shows this long after an item starts.
const LEAD = 0.35;

export function fieldReading(game: Game): DrillDef {
  // The stone: a squat basalt post on a painted ring, so the spot reads from above.
  const stone = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 1.25, 7), toon(0x4a5160));
  post.position.y = 0.62;
  post.castShadow = post.receiveShadow = true;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.16, 7), toon(0x39404d));
  cap.position.y = 1.32;
  const mark = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.28, 48), new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.55, depthWrite: false }));
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 0.03;
  stone.add(post, cap, mark);
  stone.position.copy(STONE);
  game.renderer.scene.add(stone);
  game.physics.staticBox(STONE.clone().add(new THREE.Vector3(0, 0.7, 0)), new THREE.Vector3(0.4, 0.7, 0.4));

  let view: FieldView | null = null;
  let current: { tell: Pick; t: number; window: number; answered: boolean } | null = null;
  let last: Pick[] = [];

  const chooseTell = (): Pick => {
    const pool = PICKS.filter((p) => !(last.length >= 2 && last[last.length - 1] === p && last[last.length - 2] === p));
    const p = pool[Math.floor(Math.random() * pool.length)]!;
    last = [...last.slice(-2), p];
    return p;
  };

  return {
    id: 'field-reading', technique: null, title: 'Reading the Field', jp: '気読み',
    brief: 'Read the stone\'s field and answer with what beats it: W push, S hold, A or D feint. Push beats hold, hold beats feint, feint beats push.',
    position: STAND,
    cue: () => {
      if (!current || current.t < LEAD) return 'Push beats hold · hold beats feint · feint beats push';
      return `${WORDS[current.tell]}. Answer: ${KEYS.push} push · ${KEYS.hold} hold · ${KEYS.feint} feint`;
    },
    tiers: [
      { name: 'First Breath', count: 5, interval: 2.3, window: 1.4, pass: 4, gains: { refinement: 0.25 } },
      { name: 'Steady Hands', count: 7, interval: 1.9, window: 1.0, pass: 6, gains: { refinement: 0.3 } },
      { name: 'Unreadable', count: 9, interval: 1.55, window: 0.75, pass: 8, gains: { refinement: 0.35 } },
    ],
    hold(g) {
      // The answers are the movement keys, so the student stands still.
      g.player.rooted = Math.max(g.player.rooted, 0.1);
      view ??= new FieldView(g.renderer.scene, COLOR);
      view.tell(current && current.t >= LEAD && !current.answered ? current.tell : null, g.player.position.clone().sub(STONE));
      view.draw(1 / 60, g.clock.time, STONE, RADIUS, 0.6, { inside: false, dome: 0.9 });
    },
    end() { view?.hide(); current = null; },
    spawn(g, tier): DrillItem {
      const item = { tell: chooseTell(), t: 0, window: tier.window ?? 1, answered: false };
      current = item;
      return {
        update: (dt) => {
          item.t += dt;
          if (item.t < LEAD) return null;
          const inp = g.input;
          const pick: Pick | null = inp.hit('forward') ? 'push' : inp.hit('back') ? 'hold' : inp.hit('left') || inp.hit('right') ? 'feint' : null;
          if (pick) {
            item.answered = true;
            const right = pick === counterTo(item.tell);
            g.vfx.ring(g.player.position.clone().add(new THREE.Vector3(0, 0.06, 0)), right ? COLOR : 0xff6a5a, 0.3, right ? 2.4 : 1.2, 0.35);
            if (!right) view?.crack();
            if (current === item) current = null;
            return right ? 1 : 0;
          }
          if (item.t >= LEAD + item.window) { item.answered = true; view?.crack(); if (current === item) current = null; return 0; }
          return null;
        },
      };
    },
  };
}
