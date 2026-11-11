import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], rapier: ['@dimforge/rapier3d-compat'], post: ['postprocessing', 'n8ao'] },
      },
    },
  },
});
