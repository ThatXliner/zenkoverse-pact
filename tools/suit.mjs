#!/usr/bin/env node
// Regenerates the third-person suit shell inside the built
// public/assets/characters/human.glb from the skin already in it, with the
// same cut tools/human.mjs makes from the raw downloads. Use it after
// changing `suitShell` when the raw Quaternius packs are not at hand.
//   node tools/suit.mjs
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { Soup, suitShell } from './human.mjs';
import { writeManifest } from './manifest.mjs';

const root = new URL('..', import.meta.url).pathname;
const file = join(root, 'public/assets/characters/human.glb');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
await doc.transform(dequantize());

const nodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
const body = nodes.get('Body');
const skin = body.getSkin();
const prims = body.getMesh().listPrimitives();
const skinPrim = prims.find((p) => p.getMaterial()?.getName() === 'Skin');
const oldSuit = prims.find((p) => p.getMaterial()?.getName() === 'Suit');
if (!skinPrim || !oldSuit) throw new Error('human.glb: Body needs a Skin and a Suit primitive');

// Quantization left the vertices in a box of their own and moved its
// transform into the inverse bind matrices. Every joint at rest gives back
// the same matrix, which carries the vertices to the bones' bind space.
const j0 = skin.listJoints()[0];
const toBind = new Matrix4().fromArray(j0.getWorldMatrix()).multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getElement(0, [])));
const fromBind = toBind.clone().invert();

const soup = Soup.fromPrimitive(skinPrim, ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']);
const v = new Vector3();
for (const p of soup.streams.POSITION) v.fromArray(p).applyMatrix4(toBind).toArray(p);
const bonePos = (name) => { const m = nodes.get(name).getWorldMatrix(); return new Vector3(m[12], m[13], m[14]); };
const suit = suitShell(soup, skin.listJoints().map((j) => j.getName()), bonePos);
for (const p of suit.streams.POSITION) v.fromArray(p).applyMatrix4(fromBind).toArray(p);

const buffer = doc.getRoot().listBuffers()[0];
body.getMesh().removePrimitive(oldSuit);
body.getMesh().addPrimitive(suit.toPrimitive(doc, buffer, oldSuit.getMaterial()));
oldSuit.dispose();

// Written plain; the CLI compresses it again below, as build-assets.mjs does.
for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
const tmp = file.replace(/\.glb$/, '.suit.tmp.glb');
await io.write(tmp, doc);
const gltf = (...args) => execFileSync('npx', ['gltf-transform', ...args], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
gltf('weld', tmp, tmp);
gltf('meshopt', tmp, file, '--level', 'high');
rmSync(tmp);
writeManifest(root);
console.log(`suit: ${suit.tris.length} triangles`);
