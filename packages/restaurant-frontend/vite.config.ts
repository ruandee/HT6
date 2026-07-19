import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5174, because the diner app owns 5173 and the demo runs both side by side.
    port: 5174,
    // app-services REST (§10.4). The issuer dashboard talks ONLY to this (§8 boundary rule):
    // frontends NEVER touch the chain.
    proxy: {
      '/restaurant': 'http://localhost:8080',
      '/pools': 'http://localhost:8080',
      '/demo': 'http://localhost:8080',
    },
  },
});
