import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In production the backend serves dashboard/dist. In dev, Vite proxies API calls to the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
