import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, inkHullMaterial } from '../render/materials';

// Costumes: what each enemy role wears over its suit, so a role reads by its
// silhouette from the top-down camera and by its clothes up close. A costume
// is data: flat-coloured pieces (bands, skirts, domes, boxes, cones) fixed to
// bones. Every piece is a toon fill over the shared ramp with an ink hull,
// the same drawing as the bodies. The pieces on one bone merge into one mesh,
// so a costume costs a few draw calls whatever it holds.

type Vec3 = [number, number, number];

export type Shape =
  // A flat ring around the bone's Y: a belt, a headband, a cuff, a collar.
  | { kind: 'band'; r: [number, number]; h: number; t?: number }
  // An open frustum hanging down Y: a robe, a skirt, a sleeve, a cape (`arc`
  // keeps only the back, in radians around it).
  | { kind: 'skirt'; top: number; bottom: number; h: number; depth?: number; arc?: number }
  // Part of an ellipsoid from its crown down to `cut` (radians from the top),
  // with an optional opening at the front: a hood, a pauldron, a cap.
  | { kind: 'dome'; r: Vec3; cut?: number; open?: number }
  | { kind: 'ball'; r: Vec3 }
  | { kind: 'box'; size: Vec3 }
  | { kind: 'cone'; r: number; h: number; sides?: number };

// `at` is in metres from the bone, `rot` in radians. In the `body` frame
// (the default) +x is the character's right, +y up and -z forward, measured
// in the idle pose; in the `bone` frame the axes are the bone's own, with +y
// running along the bone (down an arm toward the hand).
export interface Piece { bone: string; shape: Shape; color: number; at?: Vec3; rot?: Vec3; frame?: 'body' | 'bone' }

export type CostumeId = 'thug' | 'bruiser' | 'runner' | 'husk' | 'dummy' | 'kuroda' | 'ancient';

// Pieces are authored on a body 1.8 m tall and scale with the role's height.
const REF_HEIGHT = 1.8;
// The torso bones widen with a role's `build`, so their pieces do too.
const TORSO = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01']);

const both = (p: Omit<Piece, 'bone'> & { bone: string }): Piece[] => {
  const mirror = (v?: Vec3): Vec3 | undefined => (v ? [-v[0], v[1], v[2]] : undefined);
  const r = p.rot;
  return [
    { ...p, bone: `${p.bone}_l`, at: p.frame === 'bone' ? p.at : mirror(p.at), rot: p.frame === 'bone' || !r ? r : [r[0], -r[1], -r[2]] },
    { ...p, bone: `${p.bone}_r` },
  ];
};

// Colours. None reads as bare skin (tools/check-tints.mjs holds them to it).
const INKY = 0x1c1a22;
const IRON = 0x3c4250;
const WHITE = 0xeef0f2;

export const COSTUMES: Record<CostumeId, Piece[]> = {
  // The street grunt: a red hachimaki whose tails stream behind the head, a
  // wide black belt with a brass plate, and taped wrists.
  thug: [
    { bone: 'Head', shape: { kind: 'band', r: [0.125, 0.135], h: 0.05 }, color: 0xc0283a, at: [0.015, 0.135, -0.045], rot: [-0.12, 0, 0] },
    { bone: 'Head', shape: { kind: 'box', size: [0.05, 0.22, 0.012] }, color: 0xc0283a, at: [0.04, 0.07, 0.11], rot: [0.75, 0, -0.3] },
    { bone: 'Head', shape: { kind: 'box', size: [0.05, 0.19, 0.012] }, color: 0xc0283a, at: [-0.02, 0.07, 0.105], rot: [0.6, 0, 0.35] },
    { bone: 'spine_01', shape: { kind: 'band', r: [0.175, 0.15], h: 0.12 }, color: INKY, at: [0, -0.05, 0.01] },
    { bone: 'spine_01', shape: { kind: 'box', size: [0.1, 0.08, 0.02] }, color: 0xb88a2a, at: [0, -0.05, -0.145] },
    ...both({ bone: 'lowerarm', frame: 'bone', shape: { kind: 'band', r: [0.052, 0.052], h: 0.09 }, color: WHITE, at: [0, 0.18, 0] }),
  ],
  // The heavy: spiked iron pauldrons that double his shoulder line, a
  // braided rope belt, a topknot, and iron bracers.
  bruiser: [
    ...both({ bone: 'upperarm', frame: 'bone', shape: { kind: 'dome', r: [0.16, 0.17, 0.16], cut: 1.5 }, color: IRON, at: [0, 0.06, 0], rot: [Math.PI, 0, 0] }),
    ...both({ bone: 'upperarm', frame: 'bone', shape: { kind: 'band', r: [0.16, 0.16], h: 0.04, t: 0.03 }, color: 0xd9a032, at: [0, 0.06, 0] }),
    ...both({ bone: 'upperarm', frame: 'bone', shape: { kind: 'cone', r: 0.045, h: 0.12 }, color: 0xd9a032, at: [0, -0.12, 0], rot: [Math.PI, 0, 0] }),
    { bone: 'spine_01', shape: { kind: 'band', r: [0.19, 0.165], h: 0.07, t: 0.04 }, color: 0x6b4423, at: [0, -0.02, 0.01] },
    { bone: 'spine_01', shape: { kind: 'band', r: [0.185, 0.16], h: 0.06, t: 0.04 }, color: 0x4a2c16, at: [0, -0.085, 0.01] },
    { bone: 'Head', shape: { kind: 'ball', r: [0.045, 0.035, 0.08] }, color: 0x2a1a14, at: [0.02, 0.29, 0.0] },
    ...both({ bone: 'lowerarm', frame: 'bone', shape: { kind: 'band', r: [0.065, 0.065], h: 0.13, t: 0.02 }, color: IRON, at: [0, 0.16, 0] }),
  ],
  // The leaper: a long yellow scarf whose tail flies behind, a hood-less
  // half mask, and shin wraps.
  runner: [
    { bone: 'neck_01', shape: { kind: 'band', r: [0.09, 0.09], h: 0.08, t: 0.03 }, color: 0xf0c419, at: [0, 0.02, 0.02] },
    { bone: 'neck_01', shape: { kind: 'box', size: [0.09, 0.5, 0.015] }, color: 0xf0c419, at: [0.06, -0.1, 0.24], rot: [0.95, 0, -0.15] },
    { bone: 'Head', shape: { kind: 'band', r: [0.11, 0.12], h: 0.07 }, color: 0x16301f, at: [0.02, 0.06, -0.05], rot: [0.1, 0, 0] },
    ...both({ bone: 'calf', frame: 'bone', shape: { kind: 'band', r: [0.06, 0.06], h: 0.16 }, color: WHITE, at: [0, 0.22, 0] }),
  ],
  // The shell: a deep pointed hood, a tattered cape to the knees, and a
  // ring of bone spikes at the collar.
  husk: [
    { bone: 'Head', shape: { kind: 'dome', r: [0.2, 0.25, 0.22], cut: 2.1, open: 1.25 }, color: 0x2b1f33, at: [0.02, 0.1, 0.0] },
    { bone: 'Head', shape: { kind: 'cone', r: 0.11, h: 0.3, sides: 8 }, color: 0x2b1f33, at: [0.02, 0.3, 0.14], rot: [-1.05, 0, 0] },
    { bone: 'spine_03', shape: { kind: 'skirt', top: 0.2, bottom: 0.4, h: 1.05, depth: 0.85, arc: 3.6 }, color: 0x3d2a4a, at: [0, -0.45, 0.08] },
    { bone: 'spine_03', shape: { kind: 'band', r: [0.22, 0.2], h: 0.08, t: 0.05 }, color: 0x2b1f33, at: [0, 0.14, 0.04] },
    ...[-0.5, 0, 0.5].map((a): Piece => ({ bone: 'spine_03', shape: { kind: 'cone', r: 0.035, h: 0.16 }, color: 0xd9d4e0, at: [Math.sin(a) * 0.17, 0.2, 0.12 + Math.cos(a) * 0.05], rot: [0.5, 0, -a * 0.8] })),
  ],
  // The training dummy: a canvas sack over the head, a target painted on
  // the chest, rope bindings, and the wooden crossbar it hangs from.
  dummy: [
    { bone: 'Head', shape: { kind: 'dome', r: [0.145, 0.19, 0.155], cut: 2.3 }, color: 0xd5d9d2, at: [0.02, 0.13, -0.04] },
    { bone: 'Head', shape: { kind: 'band', r: [0.1, 0.105], h: 0.04 }, color: 0x4a2c16, at: [0.02, 0.0, -0.03] },
    { bone: 'spine_03', shape: { kind: 'band', r: [0.205, 0.17], h: 0.03 }, color: 0x4a2c16, at: [0, -0.1, 0.06] },
    { bone: 'spine_03', shape: { kind: 'ball', r: [0.12, 0.12, 0.02] }, color: WHITE, at: [0, -0.02, -0.135], rot: [0.15, 0, 0] },
    { bone: 'spine_03', shape: { kind: 'ball', r: [0.085, 0.085, 0.02] }, color: 0xc0283a, at: [0, -0.02, -0.14], rot: [0.15, 0, 0] },
    { bone: 'spine_03', shape: { kind: 'ball', r: [0.04, 0.04, 0.02] }, color: WHITE, at: [0, -0.02, -0.145], rot: [0.15, 0, 0] },
    { bone: 'spine_03', shape: { kind: 'box', size: [1.25, 0.07, 0.07] }, color: 0x5a3b26, at: [0, 0.17, 0.13] },
    { bone: 'spine_03', shape: { kind: 'box', size: [0.07, 0.5, 0.07] }, color: 0x5a3b26, at: [0, 0.2, 0.17] },
  ],
  // The Kuroda Enforcer: a long open black jacket with an orange hem and
  // twin fuel tanks on its back, shoulder plates, a black obi, a half mask,
  // and hair swept back in spikes.
  kuroda: [
    { bone: 'spine_03', shape: { kind: 'skirt', top: 0.21, bottom: 0.26, h: 0.72, depth: 0.78, arc: 4.4 }, color: 0x24222b, at: [0, -0.19, 0.03] },
    { bone: 'spine_03', shape: { kind: 'skirt', top: 0.262, bottom: 0.265, h: 0.05, depth: 0.79, arc: 4.4 }, color: 0xff6a1a, at: [0, -0.53, 0.03] },
    ...[-1, 1].map((s): Piece => ({ bone: 'spine_03', shape: { kind: 'skirt', top: 0.075, bottom: 0.075, h: 0.42 }, color: 0x3a3f48, at: [s * 0.085, -0.06, 0.27] })),
    ...[-1, 1].map((s): Piece => ({ bone: 'spine_03', shape: { kind: 'ball', r: [0.075, 0.05, 0.075] }, color: 0x3a3f48, at: [s * 0.085, 0.15, 0.27] })),
    { bone: 'spine_03', shape: { kind: 'band', r: [0.2, 0.09], h: 0.06 }, color: 0xff6a1a, at: [0, -0.02, 0.27] },
    ...both({ bone: 'upperarm', frame: 'bone', shape: { kind: 'box', size: [0.22, 0.05, 0.22] }, color: 0x24222b, at: [0, 0.03, 0] }),
    { bone: 'spine_01', shape: { kind: 'band', r: [0.18, 0.155], h: 0.14 }, color: INKY, at: [0, -0.04, 0.01] },
    { bone: 'Head', shape: { kind: 'ball', r: [0.075, 0.04, 0.045] }, color: INKY, at: [0.02, 0.015, -0.14] },
    ...[-0.6, -0.2, 0.2, 0.6].map((x): Piece => ({ bone: 'Head', shape: { kind: 'cone', r: 0.045, h: 0.28 }, color: 0x1a1216, at: [0.02 + x * 0.12, 0.27 - Math.abs(x) * 0.06, 0.13], rot: [-1.2, 0, -x * 0.5] })),
  ],
  // The Master: a white robe to the ankles under a jade obi, wide bell
  // sleeves with jade cuffs, and a high collar.
  ancient: [
    { bone: 'pelvis', shape: { kind: 'skirt', top: 0.19, bottom: 0.42, h: 0.86, depth: 0.85 }, color: WHITE, at: [0, -0.34, -0.01] },
    { bone: 'pelvis', shape: { kind: 'band', r: [0.42, 0.36], h: 0.06, t: 0.03 }, color: 0x2e8b6b, at: [0, -0.74, -0.01] },
    { bone: 'spine_01', shape: { kind: 'band', r: [0.17, 0.145], h: 0.16 }, color: 0x2e8b6b, at: [0, -0.02, 0.07] },
    { bone: 'spine_01', shape: { kind: 'box', size: [0.2, 0.12, 0.06] }, color: 0x2e8b6b, at: [0, -0.02, 0.24] },
    { bone: 'neck_01', shape: { kind: 'skirt', top: 0.1, bottom: 0.13, h: 0.12, depth: 0.95 }, color: WHITE, at: [0, 0.03, 0.03] },
    ...both({ bone: 'lowerarm', frame: 'bone', shape: { kind: 'skirt', top: 0.075, bottom: 0.19, h: 0.36 }, color: WHITE, at: [0, 0.17, 0], rot: [Math.PI, 0, 0] }),
    ...both({ bone: 'lowerarm', frame: 'bone', shape: { kind: 'band', r: [0.19, 0.19], h: 0.04, t: 0.02 }, color: 0x2e8b6b, at: [0, 0.34, 0] }),
  ],
};

function shapeGeometry(s: Shape): THREE.BufferGeometry {
  switch (s.kind) {
    case 'band': {
      const t = (s.t ?? 0.025) / ((s.r[0] + s.r[1]) / 2);
      const h = s.h / 2;
      const g = new THREE.LatheGeometry([new THREE.Vector2(1 - t, -h), new THREE.Vector2(1, -h), new THREE.Vector2(1, h), new THREE.Vector2(1 - t, h), new THREE.Vector2(1 - t, -h)], 24);
      return g.scale(s.r[0], 1, s.r[1]);
    }
    case 'skirt': {
      // Theta 0 is +z, the back: an arc is centred there. Open-ended, so the hem stays open.
      const arc = s.arc ?? Math.PI * 2;
      return new THREE.CylinderGeometry(s.top, s.bottom, s.h, 20, 1, true, -arc / 2, arc).scale(1, 1, s.depth ?? 1);
    }
    case 'dome': {
      const open = s.open ?? 0;
      // Phi 3pi/2 is -z, the face: an opening is centred there.
      const g = new THREE.SphereGeometry(1, 20, 12, 1.5 * Math.PI + open / 2, Math.PI * 2 - open, 0, s.cut ?? Math.PI / 2);
      return g.scale(...s.r);
    }
    case 'ball': return new THREE.SphereGeometry(1, 16, 10).scale(...s.r);
    case 'box': return new THREE.BoxGeometry(...s.size);
    case 'cone': return new THREE.ConeGeometry(s.r, s.h, s.sides ?? 6);
  }
}

// The ink hull wants one normal per position, or a box's corners split open.
function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', g.getAttribute('position').clone());
  if (g.index) p.setIndex(g.index.clone());
  const m = mergeVertices(p);
  m.computeVertexNormals();
  return m;
}

function strip(g: THREE.BufferGeometry, color: THREE.Color | null): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  if (color) {
    const n = out.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return out;
}

interface Baked { bone: string; body: THREE.BufferGeometry; hull: THREE.BufferGeometry }
const baked = new Map<string, Baked[]>();
const hullMaterial = inkHullMaterial(0.0075);

// Fixes a costume to a posed skeleton. The model's root must be at the
// origin, unturned, and in its idle pose: pieces are placed in that pose.
// Geometry is baked once per costume and body, then shared.
export function dress(model: THREE.Object3D, bones: Map<string, THREE.Bone>, id: CostumeId, height: number, build: number): THREE.MeshToonMaterial {
  model.updateMatrixWorld(true);
  const key = `${id}|${height}|${build}`;
  let parts = baked.get(key);
  if (!parts) {
    const k = height / REF_HEIGHT;
    const byBone = new Map<string, { body: THREE.BufferGeometry[]; hull: THREE.BufferGeometry[] }>();
    for (const p of COSTUMES[id]) {
      const bone = bones.get(p.bone);
      if (!bone) throw new Error(`costume ${id}: no bone ${p.bone}`);
      const bonePos = new THREE.Vector3(), boneQuat = new THREE.Quaternion();
      bone.matrixWorld.decompose(bonePos, boneQuat, new THREE.Vector3());
      const at = new THREE.Vector3(...(p.at ?? [0, 0, 0])).multiplyScalar(k);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
      const scale = new THREE.Vector3(k, k, k);
      let world: THREE.Matrix4;
      if (p.frame === 'bone') world = new THREE.Matrix4().compose(bonePos.clone().add(at.applyQuaternion(boneQuat)), boneQuat.clone().multiply(rot), scale);
      else {
        if (TORSO.has(p.bone)) { at.x *= build; at.z *= build; scale.x *= build; scale.z *= build; }
        world = new THREE.Matrix4().compose(bonePos.clone().add(at), rot, scale);
      }
      const toBone = bone.matrixWorld.clone().invert().multiply(world);
      const geo = shapeGeometry(p.shape);
      const slot = byBone.get(p.bone) ?? { body: [], hull: [] };
      slot.body.push(strip(geo, new THREE.Color(p.color)).applyMatrix4(toBone));
      slot.hull.push(strip(smooth(geo), null).applyMatrix4(toBone));
      byBone.set(p.bone, slot);
      geo.dispose();
    }
    parts = [...byBone].map(([bone, s]) => ({ bone, body: mergeGeometries(s.body)!, hull: mergeGeometries(s.hull)! }));
    baked.set(key, parts);
  }
  const material = toon(0xffffff, { side: THREE.DoubleSide });
  material.vertexColors = true;
  for (const p of parts) {
    const bone = bones.get(p.bone)!;
    const body = new THREE.Mesh(p.body, material);
    body.castShadow = true;
    body.receiveShadow = true;
    body.name = `costume_${p.bone}`;
    const hull = new THREE.Mesh(p.hull, hullMaterial);
    hull.name = `costume_${p.bone}_ink`;
    bone.add(body, hull);
  }
  return material;
}
