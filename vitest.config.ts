import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against shared source so they never depend on a stale shared/dist build.
    alias: {
      '@fargain/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['{shared,backend,extension,dashboard,scripts,mock-seller}/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
