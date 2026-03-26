import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/smoke/**/*.smoke.ts'],
    testTimeout: 60_000,
  },
});
