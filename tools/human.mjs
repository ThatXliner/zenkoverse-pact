// Builds public/assets/characters/human.glb from the Quaternius Universal Base
// Characters and Universal Animation Library (both CC0). One file carries the
// skeleton, the full body for third person, the first-person arm cut, hair, and
// the animation clips with their measured ground speeds. Everything that reads
// as clothing is generated here as an offset shell of the skin, so the mesh
// stays one topology and the skin is complete under it.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { Matrix4, Vector3, Plane, Quaternion } from 'three';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// Clips the game uses. Anything else in the library is dropped to save bytes.
export const CLIPS = ['Idle_Loop', 'Idle_Talking_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Punch_Jab', 'Punch_Cross', 'Hit_Chest', 'Hit_Head', 'Death01', 'Roll', 'Interact', 'PickUp_Table', 'Spell_Simple_Enter', 'Spell_Simple_Exit', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Sword_Attack', 'Crouch_Idle_Loop'];

const HAIR = ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Long', 'Hair_Buns', 'Hair_Beard'];
const ARM_BONES = (side) => new RegExp(`^(clavicle|upperarm|lowerarm|hand|thumb_\\d+|index_\\d+|middle_\\d+|ring_\\d+|pinky_\\d+)(_\\d+_leaf)?_${side}$`);
const HAND_BONES = (side) => new RegExp(`^(hand|thumb_\\d+|index_\\d+|middle_\\d+|ring_\\d+|pinky_\\d+)(_\\d+_leaf)?_${side}$`);
const SHELL = 0.004;
// The library's jog and sprint twist the chest up to 48 degrees against the
// hips each stride, about three times what a runner does, so the torso reads
// as spinning. These bones keep that share of their twist about their own
// long axis; lean and bob are untouched.
const CALM_CHEST = { clips: ['Jog_Fwd_Loop', 'Sprint_Loop'], bones: { spine_02: 'spine_03', spine_03: 'neck_01' }, keep: 0.35 };
const CUFF_ABOVE_WRIST = 0.035;

// Reads a .gltf whose image URIs may name files that do not exist in the pack
// (the Godot export points at *_png.png copies). Resolves them to the files
// that are there.
async function readGltf(file) {
  const dir = dirname(file);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const present = new Set(readdirSync(dir));
  const resources = {};
  for (const img of json.images ?? []) {
    if (!img.uri) continue;
    const candidates = [img.uri, img.uri.replace(/_png\.png$/, '.png'), img.uri.replace(/\.png$/, '_png.png')];
    const found = candidates.find((c) => present.has(decodeURIComponent(c)));
    if (!found) throw new Error(`missing image ${img.uri} for ${file}`);
    img.uri = found;
    resources[found] = new Uint8Array(readFileSync(join(dir, decodeURIComponent(found))));
  }
  for (const b of json.buffers) if (b.uri) resources[b.uri] = new Uint8Array(readFileSync(join(dir, decodeURIComponent(b.uri))));
  return io.readJSON({ json, resources });
}

// In-memory triangle soup with named vertex streams, so triangles can be
// filtered, clipped and offset before they go back into glTF accessors.
class Soup {
  constructor(semantics) { this.sem = semantics; this.streams = Object.fromEntries(semantics.map((s) => [s.name, []])); this.tris = []; }
  static fromPrimitive(prim, keep) {
    const semantics = keep.filter((n) => prim.getAttribute(n)).map((n) => { const a = prim.getAttribute(n); return { name: n, size: a.getElementSize(), type: a.getType(), int: n.startsWith('JOINTS') }; });
    const s = new Soup(semantics);
    const n = prim.getAttribute('POSITION').getCount();
    const accs = semantics.map((x) => prim.getAttribute(x.name));
    for (let i = 0; i < n; i++) s.push(accs.map((a) => a.getElement(i, [])));
    const idx = prim.getIndices();
    const count = idx ? idx.getCount() : n;
    for (let i = 0; i < count; i += 3) s.tris.push([idx ? idx.getScalar(i) : i, idx ? idx.getScalar(i + 1) : i + 1, idx ? idx.getScalar(i + 2) : i + 2]);
    return s;
  }
  push(vertex) { this.sem.forEach((x, i) => this.streams[x.name].push(vertex[i])); return this.count - 1; }
  get count() { return this.streams.POSITION.length; }
  vertex(i) { return this.sem.map((x) => this.streams[x.name][i]); }
  pos(i) { return this.streams.POSITION[i]; }
  // Keeps the triangles the predicate accepts and compacts the vertex streams.
  filter(pred) {
    const out = new Soup(this.sem);
    const map = new Map();
    const remap = (i) => { if (!map.has(i)) map.set(i, out.push(this.vertex(i))); return map.get(i); };
    for (const t of this.tris) if (pred(t)) out.tris.push(t.map(remap));
    return out;
  }
  // Splits every triangle against the plane and keeps the side where
  // plane.distanceToPoint is negative. Interpolated vertices lerp the float
  // streams; skinning streams come from the nearer endpoint.
  clip(plane) {
    const out = new Soup(this.sem);
    const d = Array.from({ length: this.count }, (_, i) => plane.distanceToPoint(new Vector3(...this.pos(i))));
    const map = new Map();
    const keep = (i) => { if (!map.has(i)) map.set(i, out.push(this.vertex(i))); return map.get(i); };
    const cut = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (map.has(key)) return map.get(key);
      const t = d[a] / (d[a] - d[b]);
      const va = this.vertex(a), vb = this.vertex(b);
      const v = this.sem.map((x, k) => (x.int || x.name.startsWith('WEIGHTS') ? (t < 0.5 ? va[k] : vb[k]) : va[k].map((p, j) => p + (vb[k][j] - p) * t)));
      const id = out.push(v);
      map.set(key, id);
      return id;
    };
    for (const [a, b, c] of this.tris) {
      const inside = [a, b, c].filter((i) => d[i] <= 0);
      if (inside.length === 3) { out.tris.push([keep(a), keep(b), keep(c)]); continue; }
      if (inside.length === 0) continue;
      // Rotate so the odd vertex is first and winding is preserved.
      let [p, q, r] = [a, b, c];
      const odd = inside.length === 1 ? (i) => d[i] <= 0 : (i) => d[i] > 0;
      while (!odd(p)) [p, q, r] = [q, r, p];
      const pq = cut(p, q), pr = cut(p, r);
      if (inside.length === 1) out.tris.push([keep(p), pq, pr]);
      else { out.tris.push([pq, keep(q), keep(r)]); out.tris.push([pq, keep(r), pr]); }
    }
    for (const n of out.streams.NORMAL ?? []) { const l = Math.hypot(...n) || 1; n[0] /= l; n[1] /= l; n[2] /= l; }
    return out;
  }
  offset(dist) {
    const out = new Soup(this.sem);
    for (let i = 0; i < this.count; i++) { const v = this.vertex(i); const pi = this.sem.findIndex((x) => x.name === 'POSITION'), ni = this.sem.findIndex((x) => x.name === 'NORMAL'); v[pi] = v[pi].map((p, j) => p + v[ni][j] * dist); out.push(v); }
    out.tris = this.tris.map((t) => [...t]);
    return out;
  }
  concat(other) {
    const out = new Soup(this.sem);
    for (let i = 0; i < this.count; i++) out.push(this.vertex(i));
    out.tris = this.tris.map((t) => [...t]);
    const base = out.count;
    for (let i = 0; i < other.count; i++) out.push(other.vertex(i));
    for (const t of other.tris) out.tris.push(t.map((i) => i + base));
    return out;
  }
  toPrimitive(doc, buffer, material) {
    const prim = doc.createPrimitive().setMaterial(material);
    for (const x of this.sem) {
      const flat = this.streams[x.name].flat();
      const arr = x.int ? new Uint16Array(flat) : new Float32Array(flat);
      prim.setAttribute(x.name, doc.createAccessor().setType(x.type).setArray(arr).setBuffer(buffer));
    }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(this.tris.flat())).setBuffer(buffer));
    return prim;
  }
}

// Scales the twist of each keyframe rotation away from `rest` about `axis`, the
// bone's long axis in its own frame.
function scaleTwist(values, rest, axis, keep) {
  const restInv = rest.clone().invert();
  const q = new Quaternion();
  for (let i = 0; i < values.length; i += 4) {
    const d = restInv.clone().multiply(q.fromArray(values, i));
    const along = axis.x * d.x + axis.y * d.y + axis.z * d.z;
    const twist = new Quaternion(axis.x * along, axis.y * along, axis.z * along, d.w).normalize();
    const swing = d.clone().multiply(twist.clone().invert());
    rest.clone().multiply(swing).multiply(new Quaternion().slerp(twist, keep)).toArray(values, i);
  }
  return values;
}

function worldPos(node) { const m = node.getWorldMatrix(); return new Vector3(m[12], m[13], m[14]); }

async function webp(image, size, quality) {
  return new Uint8Array(await sharp(Buffer.from(image)).resize(size, size, { fit: 'fill' }).webp({ quality }).toBuffer());
}

export async function buildHuman(raw, out) {
  const ubc = join(raw, 'quaternius', 'Universal Base Characters[Standard]');
  const ual = join(raw, 'quaternius', 'Universal Animation Library[Standard]', 'Unreal-Godot');
  const doc = await readGltf(join(ubc, 'Base Characters', 'Godot - UE', 'Superhero_Male_FullBody.gltf'));
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const scene = root.listScenes()[0];

  // The body primitive is the big one; the face meshes stay as they are.
  const bodyNode = root.listNodes().find((n) => n.getMesh()?.listPrimitives().some((p) => p.getMaterial()?.getName() === 'MI_Superhero_Male'));
  const skin = bodyNode.getSkin();
  const joints = skin.listJoints();
  const bodyPrim = bodyNode.getMesh().listPrimitives()[0];
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) for (const sem of p.listSemantics()) if (/^(COLOR_|TEXCOORD_[1-9])/.test(sem)) p.setAttribute(sem, null);

  const skinMat = bodyPrim.getMaterial().setName('Skin').setRoughnessFactor(1).setMetallicFactor(0);
  const suitMat = doc.createMaterial('Suit').setBaseColorFactor([0.055, 0.06, 0.075, 1]).setRoughnessFactor(0.88).setMetallicFactor(0).setDoubleSided(true);

  // Per-vertex bone-class weights decide which triangles belong to an arm or a hand.
  const soup = Soup.fromPrimitive(bodyPrim, ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']);
  const classWeight = (i, re) => { const j = soup.streams.JOINTS_0[i], w = soup.streams.WEIGHTS_0[i]; let s = 0; for (let k = 0; k < 4; k++) if (re.test(joints[j[k]].getName())) s += w[k]; return s; };
  const anyVertex = (re, min) => (t) => t.some((i) => classWeight(i, re) > min);

  const cuffPlane = (side) => {
    const wrist = worldPos(nodes.get(`hand_${side}`)), elbow = worldPos(nodes.get(`lowerarm_${side}`));
    const axis = wrist.clone().sub(elbow).normalize();
    return new Plane().setFromNormalAndCoplanarPoint(axis, wrist.clone().addScaledVector(axis, -CUFF_ABOVE_WRIST));
  };
  const collar = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), worldPos(nodes.get('neck_01')).add(new Vector3(0, 0.01, 0)));

  // Third-person suit: the whole skin, cut at the collar and the cuffs, pushed out 4 mm.
  const suit = soup.clip(collar).clip(cuffPlane('l')).clip(cuffPlane('r')).offset(SHELL);
  bodyNode.getMesh().addPrimitive(suit.toPrimitive(doc, buffer, suitMat)).setName('Body');
  bodyNode.setName('Body');

  // First-person arms: skin of both arms, and a sleeve shell that stops at the cuff.
  let armSkin = null, sleeve = null;
  for (const side of ['l', 'r']) {
    const arm = soup.filter(anyVertex(ARM_BONES(side), 0.5));
    const sleeveSide = soup.filter(anyVertex(ARM_BONES(side), 0.15)).clip(cuffPlane(side)).offset(SHELL);
    armSkin = armSkin ? armSkin.concat(arm) : arm;
    sleeve = sleeve ? sleeve.concat(sleeveSide) : sleeveSide;
  }
  const armsMesh = doc.createMesh('Arms').addPrimitive(armSkin.toPrimitive(doc, buffer, skinMat)).addPrimitive(sleeve.toPrimitive(doc, buffer, suitMat));
  scene.addChild(doc.createNode('Arms').setMesh(armsMesh).setSkin(skin));

  // Hair is a static mesh modelled on the T-pose head; parent it to the head bone.
  const head = nodes.get('Head');
  const headInv = new Matrix4().fromArray(head.getWorldMatrix()).invert();
  const hairMats = new Map();
  for (const name of HAIR) {
    const hdoc = await readGltf(join(ubc, 'Hairstyles', 'Origin at 0', 'glTF (Godot)', `${name}.gltf`));
    const hprim = hdoc.getRoot().listMeshes()[0].listPrimitives()[0];
    const hs = Soup.fromPrimitive(hprim, ['POSITION', 'NORMAL', 'TEXCOORD_0']);
    const srcMat = hprim.getMaterial();
    const key = srcMat.getBaseColorTexture()?.getName() ?? name;
    if (!hairMats.has(key)) {
      const m = doc.createMaterial(`Hair_${hairMats.size + 1}`).setRoughnessFactor(0.75).setMetallicFactor(0);
      const bc = srcMat.getBaseColorTexture();
      if (bc) m.setBaseColorTexture(doc.createTexture(bc.getName()).setImage(bc.getImage()).setMimeType(bc.getMimeType()));
      const nm = srcMat.getNormalTexture();
      if (nm) m.setNormalTexture(doc.createTexture(nm.getName()).setImage(nm.getImage()).setMimeType(nm.getMimeType()));
      hairMats.set(key, m);
    }
    const mesh = doc.createMesh(name).addPrimitive(hs.toPrimitive(doc, buffer, hairMats.get(key)));
    head.addChild(doc.createNode(name).setMesh(mesh).setMatrix(headInv.toArray()));
  }

  // Animations: copy the library's rotation tracks onto this skeleton by bone
  // name. Pelvis and root translation scale by the leg length ratio so the
  // hips sit on this body.
  const lib = await io.read(join(ual, 'UAL1_Standard.glb'));
  const libRm = await io.read(join(ual, 'UAL1_Standard_RM.glb'));
  const libNodes = new Map(lib.getRoot().listNodes().map((n) => [n.getName(), n]));
  const ratio = worldPos(nodes.get('pelvis')).y / worldPos(libNodes.get('pelvis')).y;
  const speeds = {};
  for (const a of libRm.getRoot().listAnimations()) {
    const ch = a.listChannels().find((c) => c.getTargetNode()?.getName() === 'root' && c.getTargetPath() === 'translation');
    if (!ch) continue;
    const o = ch.getSampler().getOutput();
    const first = o.getElement(0, []), last = o.getElement(o.getCount() - 1, []);
    const dur = ch.getSampler().getInput().getMax([])[0];
    const speed = Math.hypot(last[0] - first[0], last[2] - first[2]) / dur;
    if (speed > 0.05) speeds[a.getName()] = +speed.toFixed(3);
  }
  for (const a of lib.getRoot().listAnimations()) {
    if (!CLIPS.includes(a.getName())) continue;
    const anim = doc.createAnimation(a.getName());
    for (const ch of a.listChannels()) {
      const target = nodes.get(ch.getTargetNode()?.getName());
      const path = ch.getTargetPath();
      if (!target || path === 'scale') continue;
      if (path === 'translation' && !/^(root|pelvis)$/.test(target.getName())) continue;
      const src = ch.getSampler();
      const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(src.getInput().getArray())).setBuffer(buffer);
      let outArr = new Float32Array(src.getOutput().getArray());
      if (path === 'translation') outArr = outArr.map((v) => v * ratio);
      const child = CALM_CHEST.bones[target.getName()];
      if (path === 'rotation' && child && CALM_CHEST.clips.includes(a.getName())) {
        const axis = new Vector3(...libNodes.get(child).getTranslation()).normalize();
        outArr = scaleTwist(outArr, new Quaternion(...libNodes.get(target.getName()).getRotation()), axis, CALM_CHEST.keep);
      }
      const output = doc.createAccessor().setType(src.getOutput().getType()).setArray(outArr).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(src.getInterpolation());
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(path).setSampler(sampler));
    }
  }
  // The eye position is measured here because meshopt quantizes vertex
  // positions into a normalized box at the end of the pipeline.
  const eyesPrim = root.listNodes().find((n) => n.getName() === 'Eyes').getMesh().listPrimitives()[0];
  const eb = eyesPrim.getAttribute('POSITION');
  const eye = eb.getMin([]).map((v, i) => +((v + eb.getMax([])[i]) / 2).toFixed(4));
  root.setExtras({ clipSpeeds: speeds, eye, source: 'Quaternius Universal Base Characters + Universal Animation Library (CC0)' });

  // Textures: the player's hands fill the screen, so skin colour and normal
  // stay at 2048. Everything else shrinks.
  const lightSkin = readFileSync(join(ubc, 'Base Characters', 'Textures', 'T_Superhero_Male_Ligh.png'));
  for (const t of root.listTextures()) {
    const n = t.getName();
    let size = 1024, q = 82, img = t.getImage();
    if (/Superhero_Male_(Dark|Light)/.test(n)) { size = 2048; q = 86; img = lightSkin; t.setName('T_Skin_Color'); }
    else if (/Superhero_Male_Normal/.test(n)) { size = 2048; q = 90; }
    else if (/Roughness/.test(n)) { size = 1024; q = 80; }
    else if (/Hair/.test(n)) { size = 512; q = 82; }
    else if (/Eye/.test(n)) { size = 256; q = 85; }
    t.setImage(await webp(img, size, q)).setMimeType('image/webp');
  }
  const dark = await webp(readFileSync(join(ubc, 'Base Characters', 'Godot - UE', 'T_Superhero_Male_Dark.png')), 1024, 82);
  writeFileSync(join(out, 'textures', 'HumanSkinDark', 'color.webp'), dark);

  await io.write(join(out, 'characters', 'human.raw.glb'), doc);
  return speeds;
}
