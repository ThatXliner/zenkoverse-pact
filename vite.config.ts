import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  // `npm run dev` reaches the realtime rooms of a local `npm run serve`.
  server: { proxy: { '/ws': { target: 'ws://127.0.0.1:8095', ws: true } } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], rapier: ['@dimforge/rapier3d-compat'], post: ['postprocessing'] },
      },
    },
  },
});
