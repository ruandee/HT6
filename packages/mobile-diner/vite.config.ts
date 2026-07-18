import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mobile diner app. Port 5175 — 5173 (diner-frontend) and 5174 (restaurant-frontend) are taken.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    // app-services REST (§10.4) — frontends talk ONLY to this (§8 boundary rule).
    proxy: {
      '/pools': 'http://localhost:8080',
      '/me': 'http://localhost:8080',
      '/demo': 'http://localhost:8080',
      '/mock': 'http://localhost:8080',
      // stub settlement is driven from the browser — must reach app-services, not Vite.
      '/webhooks': 'http://localhost:8080',
    },
  },
});
