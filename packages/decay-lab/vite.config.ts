import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 5176. The three demo apps own 5173-5175 and the launcher 5170, and the lab is meant to be
// open alongside them on a second monitor while the demo runs.
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
  server: { port: 5176, strictPort: true },
});
