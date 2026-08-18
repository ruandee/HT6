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
    port: 5170,
    // Fail loudly rather than drifting to the next free port: the proxy targets below are
    // hardcoded, so a launcher that silently moved would probe the wrong origins.
    strictPort: true,
    // Liveness probes for the three app cards. These have to be proxied rather than fetched
    // straight from the browser: each app is a different origin (:5173/:5174/:5175) and Vite's
    // dev server sends no CORS headers, so a direct fetch is blocked before it can tell us
    // anything. Proxying makes the probe same-origin.
    proxy: {
      '/up/diner': { target: 'http://localhost:5173', rewrite: () => '/' },
      '/up/restaurant': { target: 'http://localhost:5174', rewrite: () => '/' },
      '/up/mobile': { target: 'http://localhost:5175', rewrite: () => '/' },
    },
  },
});
