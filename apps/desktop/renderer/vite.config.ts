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
      // `@offisim/core/browser` and the provider/db SDKs it bundles reference
      // node-only built-ins (node:async_hooks / better-sqlite3 / node:fs|path)
      // that have no implementation in the WebKit webview. Alias them to browser
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
    exclude: ['@tauri-apps/api'],
  },
  build: {
    // The desktop agent UI layer is code-split behind explicit dynamic imports
    // and is not modulepreloaded in index.html, so it does not block first paint.
    // Keep this warning honest instead of raising it or forcing vendor chunks
    // into the eager entry. Pi Agent execution itself runs through the bundled
    // Tauri host resource, not an Offisim-owned provider/runtime stack.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      external: ['better-sqlite3'],
    },
  },
  server: {
    port: 5176,
    strictPort: true,
    hmr: { overlay: false },
  },
}));
