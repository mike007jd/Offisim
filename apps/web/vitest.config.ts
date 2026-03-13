import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    css: false,
  },
  resolve: {
    alias: {
      '@aics/db-local': path.resolve(__dirname, '../../packages/db-local/dist/index.js'),
      '@aics/core': path.resolve(__dirname, '../../packages/core/dist/index.js'),
      '@aics/shared-types': path.resolve(__dirname, '../../packages/shared-types/dist/index.js'),
      '@aics/ui-office': path.resolve(__dirname, '../../packages/ui-office/src/index.ts'),
    },
  },
});
