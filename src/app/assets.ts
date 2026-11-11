import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

interface ManifestFile { url: string; bytes: number }
interface Manifest { files: ManifestFile[]; total: number }

export type ProgressFn = (fraction: number, label: string) => void;

// Loads every asset through fetch so progress is measured in real bytes,
// then hands the bytes to the three.js parsers.
export class Assets {
  readonly gltf = new Map<string, GLTF>();
  readonly textures = new Map<string, THREE.Texture>();
  readonly audio = new Map<string, ArrayBuffer>();
  hdr: THREE.DataTexture | null = null;
  private loaded = 0;
  private manifest: Manifest = { files: [], total: 1 };
  private gltfLoader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();

  constructor(private base: string, private onProgress: ProgressFn) {
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  async loadAll(): Promise<void> {
    const res = await fetch(`${this.base}assets/manifest.json`);
    this.manifest = (await res.json()) as Manifest;
    const files = this.manifest.files;
    const queue = [...files];
    const workers = Array.from({ length: 6 }, () => this.worker(queue));
    await Promise.all(workers);
    this.onProgress(1, 'Ready');
  }

  private async worker(queue: ManifestFile[]): Promise<void> {
    for (;;) {
      const f = queue.shift();
      if (!f) return;
      await this.loadOne(f);
    }
  }

  private async loadOne(f: ManifestFile): Promise<void> {
    const url = `${this.base}${f.url}`;
    const buf = await (await fetch(url)).arrayBuffer();
    const name = f.url.replace(/^assets\//, '');
    if (name.endsWith('.glb')) {
      const g = await this.gltfLoader.parseAsync(buf, '');
      this.gltf.set(name.replace(/\.glb$/, ''), g);
    } else if (name.endsWith('.webp')) {
      const blob = new Blob([buf], { type: 'image/webp' });
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
      const tex = new THREE.Texture(bitmap);
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      if (name.endsWith('color.webp')) tex.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(name.replace(/\.webp$/, ''), tex);
    } else if (name.endsWith('.hdr')) {
      const tex = new RGBELoader().parse(buf);
      const dt = new THREE.DataTexture(tex.data, tex.width, tex.height, THREE.RGBAFormat, tex.type);
      dt.mapping = THREE.EquirectangularReflectionMapping;
      dt.needsUpdate = true;
      this.hdr = dt;
    } else if (name.endsWith('.ogg')) {
      this.audio.set(name.replace(/^audio\//, '').replace(/\.ogg$/, ''), buf);
    }
    this.loaded += f.bytes;
    this.onProgress(Math.min(0.999, this.loaded / this.manifest.total), label(name));
  }

  model(name: string): GLTF {
    const g = this.gltf.get(name);
    if (!g) throw new Error(`missing model ${name}`);
    return g;
  }

  texture(name: string): THREE.Texture | undefined { return this.textures.get(name); }
}

function label(name: string): string {
  if (name.startsWith('characters/')) return 'Waking the fighters';
  if (name.startsWith('props/')) return 'Placing the district';
  if (name.startsWith('textures/')) return 'Wetting the streets';
  if (name.startsWith('hdri/')) return 'Lighting the night';
  if (name.startsWith('audio/')) return 'Tuning the rain';
  return 'Loading';
}
