import * as THREE from 'three';
import type { Arm } from './rig';
import type { GestureClock } from './performer';
import { toon } from '../render/materials';

// A thing a gesture puts in the right hand (`Gesture.holds`): shown while the
// gesture plays, on the first-person hands and on every body alike, since
// both play the same gesture data. Its flame, if it has one, shows from the
// gesture's impact on.
//
// It is placed in the hand's own frame as the poses define it (fingers
// along -Z, the back of the hand up, the thumb toward -X on the right hand),
// sized to the hand, and turned into the bone's axes once, so it sits the
// same in any skeleton.

// Wrist to middle knuckle on the hand the parts below are measured for, in metres.
const HAND = 0.09;
// A lighter held in the fist: standing across the palm, its top out past the
// index knuckle on the thumb's side.
const LIGHTER = { at: new THREE.Vector3(-0.028, -0.03, -0.055), up: new THREE.Vector3(-1, 0, 0) };

export class HeldThing {
  private obj: THREE.Group | null = null;
  private flame: THREE.Object3D | null = null;
  private t = 0;

  constructor(private arm: Arm) {}

  update(clock: GestureClock, dt: number): void {
    const g = clock.gesture;
    if (!g?.holds) { if (this.obj) this.obj.visible = false; return; }
    const o = this.obj ?? this.build();
    o.visible = true;
    const lit = clock.t >= g.impactAt;
    this.flame!.visible = lit;
    if (lit) {
      this.t += dt;
      const s = 0.85 + 0.25 * Math.sin(this.t * 47) * Math.sin(this.t * 19);
      this.flame!.scale.set(1, s, 1);
    }
  }

  // Only a lighter so far (`Holdable`).
  private build(): THREE.Group {
    const hand = this.arm.hand;
    const size = this.arm.fingers.middle[0]!.bone.position.length() / HAND;
    // From the hand's pose frame to the bone's own axes (see solveArm: the
    // bone's world rotation is frame * frameInv * rest).
    const toBone = hand.rest.clone().invert().multiply(hand.frameInv.clone().invert());
    const { group, flame } = makeLighter();
    group.quaternion.copy(toBone).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), LIGHTER.up));
    group.position.copy(LIGHTER.at).applyQuaternion(toBone).multiplyScalar(size);
    group.scale.setScalar(size);
    group.name = 'held:lighter';
    hand.bone.add(group);
    this.obj = group;
    this.flame = flame;
    return group;
  }
}

// A plain flip-top lighter, its base at the origin and its top up +Y, in metres.
function makeLighter(): { group: THREE.Group; flame: THREE.Object3D } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.042, 0.013), toon(0x9a2a24));
  body.position.y = 0.021;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.012, 0.013), toon(0xc9ccd2));
  cap.position.y = 0.048;
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 10), toon(0x55585e));
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(0.006, 0.058, 0);
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.045, 8), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, depthWrite: false }));
  outer.position.y = 0.022;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.022, 8), new THREE.MeshBasicMaterial({ color: 0xfff0a0, depthWrite: false }));
  inner.position.y = 0.012;
  flame.add(outer, inner);
  flame.position.set(-0.004, 0.056, 0);
  flame.visible = false;
  group.add(body, cap, wheel, flame);
  for (const m of [body, cap, wheel]) m.castShadow = true;
  return { group, flame };
}
