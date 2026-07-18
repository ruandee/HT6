import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // app-services REST (§10.4) — frontend talks ONLY to this (§8 boundary rule).
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
