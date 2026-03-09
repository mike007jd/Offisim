import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@aics/db-local': path.resolve(__dirname, '../../packages/db-local/dist/index.js'),
      '@aics/core': path.resolve(__dirname, '../../packages/core/dist/index.js'),
      '@aics/shared-types': path.resolve(__dirname, '../../packages/shared-types/dist/index.js'),
    },
  },
});
