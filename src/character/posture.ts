import * as THREE from 'three';

// How a body carries itself, over whatever its clips are doing. Every role
// shares one rig and one set of clips, so the posture is what lets a player
// tell a hunched street thug from an upright enforcer or a stooped old master
// at a glance, from above as well as from behind. All values are radians.
export interface Posture {
  // The spine bends forward by this much; negative arches the chest out.
  hunch?: number;
  // The head lifts back against the hunch, so the eyes stay on the fight.
  head?: number;
  // The shoulders rise toward the ears.
  shrug?: number;
  // The upper arms are held out from the sides.
  spread?: number;
  // The upper arms are carried forward (positive) or back.
  swing?: number;
  // The hands clasped together behind the back (0 to 1). Gives way to the
  // arm swing of a run.
  clasp?: number;
  // The legs stand apart.
  stance?: number;
}

export const POSTURES = {
  // The street grunt: chin down behind rolled, raised shoulders, arms held
  // off the body as if ready to swing.
  thug: { hunch: 0.24, head: 0.2, shrug: 0.14, spread: 0.26, stance: 0.06 },
  // The heavy: square, wide-armed, planted.
  bruiser: { hunch: 0.08, head: 0.06, shrug: 0.1, spread: 0.42, stance: 0.1 },
  // The leaper: tipped forward onto the balls of the feet.
  runner: { hunch: 0.16, head: 0.12, spread: 0.1, swing: 0.12 },
  // The shell: folded over, arms hanging forward.
  husk: { hunch: 0.5, head: 0.36, shrug: 0.2, swing: 0.3 },
  // The enforcer: upright, chest out, chin up, arms away from the coat.
  kuroda: { hunch: -0.12, head: -0.1, spread: 0.2, stance: 0.08 },
  // The Master: stooped with age, hands clasped behind the back.
  ancient: { hunch: 0.2, head: 0.28, clasp: 1 },
} satisfies Record<string, Posture>;

// The clasp behind the back: how far the upper arms draw back and out, the
// elbows bend, and the forearms fold in toward the spine.
const CLASP = { back: 0.55, out: 0.12, bend: 1.0, fold: 1.5 };

type Turn = (bone: string, axis: THREE.Vector3, angle: number) => void;

// Lays the posture over the pose. `amt` scales all of it (a gesture or a
// clash stance takes the body over); `moving` is 0 standing to 1 at a run.
export function applyPosture(p: Posture, turn: Turn, right: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3, amt: number, moving: number): void {
  if (amt < 0.002) return;
  const hunch = (p.hunch ?? 0) * amt;
  for (const s of ['spine_01', 'spine_02', 'spine_03']) turn(s, right, -hunch / 3);
  turn('Head', right, (p.head ?? 0) * amt);
  const shrug = (p.shrug ?? 0) * amt, spread = (p.spread ?? 0) * amt, swing = (p.swing ?? 0) * amt;
  const clasp = (p.clasp ?? 0) * amt * (1 - moving * 0.85);
  for (const [side, m] of [['r', 1], ['l', -1]] as const) {
    // Turning about the forward axis raises the outer end of a right bone
    // with a negative angle and of a left one with a positive.
    turn(`clavicle_${side}`, fwd, -m * shrug);
    turn(`upperarm_${side}`, fwd, -m * spread);
    turn(`upperarm_${side}`, right, swing - clasp * CLASP.back);
    if (clasp > 0) {
      // Elbows drawn back and a little out, forearms bent up and swung in
      // to meet across the small of the back.
      turn(`upperarm_${side}`, fwd, -m * clasp * CLASP.out);
      turn(`lowerarm_${side}`, right, clasp * CLASP.bend);
      turn(`lowerarm_${side}`, up, m * clasp * CLASP.fold);
    }
    turn(`thigh_${side}`, fwd, -m * (p.stance ?? 0) * amt);
  }
}
