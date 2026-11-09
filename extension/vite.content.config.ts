import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Build 2 of 2: content script as one self-contained IIFE.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'FargainContent',
      fileName: () => 'content.js',
    },
  },
});
