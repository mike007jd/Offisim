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
    exclude: ['@tauri-apps/api', '@tauri-apps/plugin-sql'],
  },
  build: {
    // The agent stack (pi agent-loop kernel + LLM SDKs + MCP SDK) lands in a
    // single ~1.5MB `desktop-agent-runtime` chunk. That chunk is intentionally
    // code-split: every consumer imports it via `await import(...)` and it is NOT
    // modulepreloaded in index.html, so it never blocks first paint — it loads
    // from local disk on chat-open. The size warning here is therefore expected
    // and honest; do NOT silence it by raising this limit, and do NOT add a
    // manualChunks split for the agent vendors: the eager entry transitively
    // touches a few `@anthropic-ai` modules through the
    // `@offisim/core/browser` barrel, so forcing those packages into named
    // vendor chunks pulls the whole 800KB+ into the entry's modulepreload set
    // (measured) — making first paint worse, not better. The real lever to move
    // execution out of the webview is a Node sidecar, which is blocked until a
    // Node runtime is bundled into the .app (same gap as the MCP sidecar).
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
