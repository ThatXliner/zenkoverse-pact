declare module 'n8ao' {
  import type { Scene, Camera, Color } from 'three';
  import { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: { aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean; color: Color; aoSamples: number; denoiseSamples: number; denoiseRadius: number; screenSpaceRadius: boolean; gammaCorrection: boolean };
    enabled: boolean;
  }
}
