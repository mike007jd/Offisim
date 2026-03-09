import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

/**
 * Vite config for apps/web — browser SPA.
 *
 * Key concern: packages/core imports Node-only modules (better-sqlite3,
 * @langchain/langgraph-checkpoint-sqlite, drizzle-orm) and LangChain uses
 * node:async_hooks. We polyfill/stub these for browser compatibility.
 *
 * Strategy:
 * 1. Alias node:async_hooks → browser polyfill
 * 2. Alias better-sqlite3 → empty stub
 * 3. Pre-bundle @aics/core so all its CJS transitive deps (camelcase,
 *    decamelize, p-queue, mustache, ansi-styles) get properly converted
 */
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      // Polyfill node:async_hooks with browser-compatible AsyncLocalStorage
      'node:async_hooks': path.resolve(__dirname, 'src/polyfills/async-local-storage.ts'),
      // Stub Node-only modules that are exported by @aics/core but unused in browser
      'better-sqlite3': path.resolve(__dirname, 'src/polyfills/empty-module.ts'),
    },
  },
  optimizeDeps: {
    // Pre-bundle workspace packages so their CJS transitive deps get converted to ESM.
    // @aics/core re-exports SqliteSaver from @langchain/langgraph-checkpoint-sqlite,
    // but better-sqlite3 is aliased to an empty stub so it's inert in browser.
    include: ['@aics/core', '@aics/shared-types'],
  },
  build: {
    rollupOptions: {
      external: [
        // Never bundle Node-only native modules
        'better-sqlite3',
        '@langchain/langgraph-checkpoint-sqlite',
      ],
    },
  },
});
