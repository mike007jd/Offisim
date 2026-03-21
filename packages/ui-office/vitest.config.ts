import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },
});
