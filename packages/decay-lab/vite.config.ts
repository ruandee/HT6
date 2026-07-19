import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 5176. The three demo apps own 5173-5175 and the launcher 5170, and the lab is meant to be
// open alongside them on a second monitor while the demo runs.
export default defineConfig({
  plugins: [react()],
  server: { port: 5176 },
});
