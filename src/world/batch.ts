import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The compound is a few thousand hand-placed boxes and cylinders, and drawn
// one by one that is a thousand draw calls before anyone moves. Once it is
// built, every mesh that never moves on its own is baked into one mesh per
// material (and shadow setting), in world space. A mesh opts out with
// `userData.keep` (it animates, or code holds on to it).

const KEEP_ATTRS = ['position', 'normal', 'uv'] as const;

function bakeable(m: THREE.Mesh): boolean {
  if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) return false;
  if (Array.isArray(m.material)) return false;
  for (let o: THREE.Object3D | null = m; o; o = o.parent) if (o.userData.keep) return false;
  return true;
}

// One geometry in world space with only the attributes every merge shares.
function worldGeometry(m: THREE.Mesh): THREE.BufferGeometry {
  const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  const out = new THREE.BufferGeometry();
  const n = src.getAttribute('position').count;
  for (const a of KEEP_ATTRS) {
    const attr = src.getAttribute(a);
    out.setAttribute(a, attr ? attr.clone() : new THREE.BufferAttribute(new Float32Array(n * (a === 'uv' ? 2 : 3)), a === 'uv' ? 2 : 3));
  }
  out.applyMatrix4(m.matrixWorld);
  src.dispose();
  return out;
}

// Merges a set of meshes that share one material into one mesh, added to
// `parent` in their place. Returns the merged mesh (or the only one).
export function mergeMeshes(meshes: THREE.Mesh[], parent: THREE.Object3D): THREE.Mesh {
  if (meshes.length === 1) return meshes[0]!;
  const geo = mergeGeometries(meshes.map(worldGeometry), false);
  if (!geo) throw new Error('mergeMeshes: geometries do not match');
  const first = meshes[0]!;
  const merged = new THREE.Mesh(geo, first.material);
  merged.castShadow = first.castShadow;
  merged.receiveShadow = first.receiveShadow;
  merged.userData = { ...first.userData };
  for (const m of meshes) m.parent?.remove(m);
  parent.add(merged);
  return merged;
}

// Bakes every bakeable mesh under `root` (but not in `skip`) into one mesh
// per material and shadow setting. Empty groups left behind are removed.
export function bakeStatic(root: THREE.Object3D, skip: Set<THREE.Object3D>): void {
  root.updateMatrixWorld(true);
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip.has(m) || !bakeable(m) || !m.visible) return;
    const mat = m.material as THREE.Material;
    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
    const list = groups.get(key);
    if (list) list.push(m); else groups.set(key, [m]);
  });
  for (const list of groups.values()) if (list.length > 1) mergeMeshes(list, root);
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && !(o as THREE.Mesh).isMesh && o.children.length === 0 && o.type === 'Group') empty.push(o); });
  for (const o of empty) o.parent?.remove(o);
}
