import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    css: false,
  },
  resolve: {
    alias: {
      // drizzle-repositories.ts uses a `@offisim/db-local/dist/schema.js` subpath
      // import; this must come BEFORE the generic `@offisim/db-local` alias so
      // the longer prefix wins during vitest resolution.
      '@offisim/db-local/dist/schema.js': path.resolve(
        __dirname,
        '../../packages/db-local/dist/schema.js',
      ),
      '@offisim/db-local': path.resolve(__dirname, '../../packages/db-local/dist/index.js'),
      '@offisim/core/browser': path.resolve(__dirname, '../../packages/core/dist/browser.js'),
      '@offisim/core': path.resolve(__dirname, '../../packages/core/dist/index.js'),
      '@offisim/shared-types': path.resolve(__dirname, '../../packages/shared-types/dist/index.js'),
      '@offisim/ui-office/web': path.resolve(__dirname, '../../packages/ui-office/src/web.ts'),
      '@offisim/ui-office': path.resolve(__dirname, '../../packages/ui-office/src/index.ts'),
    },
  },
});
