import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const backendHostPermission = (() => {
  const configured = process.env.VITE_BACKEND_URL;
  if (!configured) return null;
  const backend = new URL(configured);
  if (backend.protocol !== 'https:' && backend.protocol !== 'http:') {
    throw new Error('VITE_BACKEND_URL must use http or https');
  }
  return `${backend.origin}/*`;
})();

const addBackendHostPermission: Plugin = {
  name: 'fargain-backend-host-permission',
  closeBundle() {
    if (!backendHostPermission) return;
    const manifestPath = resolve(import.meta.dirname, 'dist/manifest.json');
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      host_permissions?: string[];
    };
    manifest.host_permissions = [
      ...new Set([...(manifest.host_permissions ?? []), backendHostPermission]),
    ];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  },
};

// Build 1 of 2: side panel (HTML + React) and the MV3 service worker (ES module).
// The content script is built separately as a single IIFE (see vite.content.config.ts)
// because MV3 content scripts cannot use ES module imports.
export default defineConfig({
  plugins: [react(), addBackendHostPermission],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
