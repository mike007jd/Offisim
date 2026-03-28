import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    css: false,
  },
  resolve: {
    alias: {
      '@offisim/db-local': path.resolve(__dirname, '../../packages/db-local/dist/index.js'),
      '@offisim/core/browser': path.resolve(__dirname, '../../packages/core/dist/browser.js'),
      '@offisim/core': path.resolve(__dirname, '../../packages/core/dist/index.js'),
      '@offisim/shared-types': path.resolve(__dirname, '../../packages/shared-types/dist/index.js'),
      '@offisim/ui-office': path.resolve(__dirname, '../../packages/ui-office/src/index.ts'),
    },
  },
});
