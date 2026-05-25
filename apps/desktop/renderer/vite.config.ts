import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(here, 'src') },
      // @offisim/core/browser pulls LangGraph/LangChain, which import
      // node:async_hooks (AsyncLocalStorage) + node-only sqlite deps. In the
      // WebKit webview these have no implementation, so alias them to browser
      // polyfills / empty stubs — otherwise module eval throws and the app
      // renders a blank white screen.
      {
        find: 'node:async_hooks',
        replacement: path.resolve(here, 'src/polyfills/async-local-storage.ts'),
      },
      { find: 'better-sqlite3', replacement: path.resolve(here, 'src/polyfills/empty-module.ts') },
      {
        find: /^node:(fs|path)$/,
        replacement: path.resolve(here, 'src/polyfills/empty-module.ts'),
      },
    ],
  },
  optimizeDeps: {
    include: ['@offisim/core/browser', '@offisim/shared-types', '@offisim/db-local', 'drizzle-orm'],
    exclude: ['@tauri-apps/api', '@tauri-apps/plugin-sql'],
  },
  build: {
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      external: ['better-sqlite3', '@langchain/langgraph-checkpoint-sqlite'],
    },
  },
  server: {
    port: 5176,
    strictPort: true,
    hmr: { overlay: false },
  },
}));
