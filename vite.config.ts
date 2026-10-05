import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    // The LAN host (src/server/main.ts) embeds Vite in middleware mode; these settings apply there.
    fs: { deny: ['Assets/**', '.certs/**', '.pipeline-cache/**', 'HANDOFF/**'] },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4500, // the rapier chunk (~4.3 MB) is its compat build with inlined WASM
    rolldownOptions: {
      output: {
        // Stable vendor chunks cache independently of game-code updates (service worker: cache-first).
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /[\\/]node_modules[\\/]@dimforge[\\/]/ },
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
