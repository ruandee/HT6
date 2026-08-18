import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /* One-project deploy. scripts/build-web.mjs mounts each client under its own path and sets
     these; a plain `vite build` still behaves exactly as it always did.

     Env rather than CLI flags on purpose: `--base=/` gets rewritten to a Windows path by MSYS
     when the build is driven from Git Bash, which produced asset URLs pointing at
     C:/Program Files/Git/. An env var passes through every shell untouched. */
  base: process.env.VITE_BASE ?? '/',
  build: {
    outDir: process.env.VITE_OUT_DIR ?? 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // The launcher proxies /up/diner straight at 5173, so drifting to another port would
    // leave it reporting this app as down.
    strictPort: true,
    // app-services REST (§10.4). The frontend talks ONLY to this (§8 boundary rule).
    proxy: {
      '/pools': 'http://localhost:8080',
      '/me': 'http://localhost:8080',
      '/demo': 'http://localhost:8080',
      '/mock': 'http://localhost:8080',
      // stub settlement is driven from the browser, so it must reach app-services instead of Vite.
      '/webhooks': 'http://localhost:8080',
    },
  },
});
