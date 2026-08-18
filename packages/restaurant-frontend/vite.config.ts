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
    // 5174, because the diner app owns 5173 and the demo runs both side by side.
    port: 5174,
    // The launcher proxies /up/restaurant straight at 5174, so drifting would leave it
    // reporting this app as down.
    strictPort: true,
    // app-services REST (§10.4). The issuer dashboard talks ONLY to this (§8 boundary rule):
    // frontends NEVER touch the chain.
    proxy: {
      '/restaurant': 'http://localhost:8080',
      '/pools': 'http://localhost:8080',
      '/demo': 'http://localhost:8080',
    },
  },
});
