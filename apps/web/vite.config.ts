import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for apps/web — browser SPA.
 *
 * Key concerns:
 * 1. Alias node:async_hooks → browser polyfill (LangChain uses AsyncLocalStorage)
 * 2. Alias better-sqlite3 → empty stub (Node-only, unused in browser)
 * 3. Pre-bundle @aics/core so CJS transitive deps get ESM conversion
 * 4. LLM proxy middleware to avoid CORS during development
 */
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // Custom LLM proxy middleware for dev server
    {
      name: 'llm-proxy',
      configureServer(server) {
        // Allowlist of known LLM provider hostnames to prevent SSRF
        const ALLOWED_HOSTS = new Set([
          'generativelanguage.googleapis.com',
          'openrouter.ai',
          'api.kimi.com',
          'api.moonshot.cn',
          'api.openai.com',
          'api.anthropic.com',
        ]);

        server.middlewares.use(
          '/api/llm-proxy',
          async (req: IncomingMessage, res: ServerResponse) => {
            const targetBase = req.headers['x-llm-base-url'] as string;
            if (!targetBase) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Missing X-LLM-Base-URL header');
              return;
            }

            // Validate target against allowlist to prevent SSRF
            try {
              const targetHost = new URL(targetBase).hostname;
              if (!ALLOWED_HOSTS.has(targetHost)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end(
                  `Proxy target not allowed: ${targetHost}. Add it to ALLOWED_HOSTS in vite.config.ts`,
                );
                return;
              }
            } catch {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Invalid X-LLM-Base-URL header');
              return;
            }

            // Build target URL
            const targetURL = targetBase + (req.url ?? '');

            // Forward headers (except host and the custom one)
            const forwardHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(req.headers)) {
              if (key === 'host' || key === 'x-llm-base-url' || !value) continue;
              forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
            }

            try {
              // Collect request body
              const chunks: Buffer[] = [];
              for await (const chunk of req) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
              }
              const body = Buffer.concat(chunks);

              const response = await fetch(targetURL, {
                method: req.method ?? 'POST',
                headers: forwardHeaders,
                body: body.length > 0 ? body : undefined,
              });

              // Forward response status and headers
              const responseHeaders: Record<string, string> = {};
              response.headers.forEach((value, key) => {
                // Don't forward problematic headers
                if (key !== 'content-encoding' && key !== 'transfer-encoding') {
                  responseHeaders[key] = value;
                }
              });
              res.writeHead(response.status, responseHeaders);

              // Stream response body
              if (response.body) {
                const reader = response.body.getReader();
                const pump = async () => {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      res.end();
                      return;
                    }
                    res.write(value);
                  }
                };
                await pump();
              } else {
                res.end(await response.text());
              }
            } catch (err) {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
              res.end(`LLM Proxy Error: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
        );
      },
    },
  ],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      'node:async_hooks': path.resolve(__dirname, 'src/polyfills/async-local-storage.ts'),
      'better-sqlite3': path.resolve(__dirname, 'src/polyfills/empty-module.ts'),
    },
  },
  optimizeDeps: {
    include: ['@aics/core', '@aics/shared-types'],
  },
  build: {
    // vendor-llm (LLM SDKs) and vendor-pixi (PixiJS) are large but unavoidable.
    // vendor-llm is lazy-loaded on first chat; vendor-pixi is needed for scene rendering.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      external: [
        'better-sqlite3',
        '@langchain/langgraph-checkpoint-sqlite',
        // Tauri packages — only available in Tauri webview, not browser
        /^@tauri-apps\//,
      ],
      output: {
        // ---------------------------------------------------------------------------
        // Manual chunk splitting strategy:
        //   vendor-react   — React core (rarely changes, long cache)
        //   vendor-llm     — LLM SDKs + LangChain + zod (lazy on first chat)
        //   vendor-pixi    — PixiJS core (220 files, ~250 KB; renderer backends
        //                    auto-split by Vite via pixi.js dynamic imports)
        //   vendor-ui      — Radix primitives + lucide icons + animation helpers
        //   vendor-install — fflate + ajv + gray-matter + js-yaml
        //   vendor-drizzle — drizzle-orm (leaks via @aics/core barrel export)
        // ---------------------------------------------------------------------------
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;

          // React core — shared base, changes infrequently
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }

          // LLM stack — OpenAI SDK, LangChain, zod, Anthropic SDK
          if (
            id.includes('/openai/') ||
            id.includes('/@langchain/') ||
            id.includes('/langsmith/') ||
            id.includes('/zod/') ||
            id.includes('/@anthropic-ai/') ||
            id.includes('/langchain/') ||
            id.includes('/@modelcontextprotocol/')
          ) {
            return 'vendor-llm';
          }

          // PixiJS core — the big renderer library
          if (id.includes('/pixi.js/') || id.includes('/@pixi/')) {
            return 'vendor-pixi';
          }

          // UI stack — icons, Radix primitives, scroll-lock, GSAP
          if (
            id.includes('/lucide-react/') ||
            id.includes('/@radix-ui/') ||
            id.includes('/react-remove-scroll') ||
            id.includes('/use-callback-ref/') ||
            id.includes('/use-sidecar/') ||
            id.includes('/react-style-singleton/') ||
            id.includes('/gsap/')
          ) {
            return 'vendor-ui';
          }

          // Install stack — ZIP + JSON Schema + frontmatter
          if (
            id.includes('/fflate/') ||
            id.includes('/ajv/') ||
            id.includes('/ajv-formats/') ||
            id.includes('/gray-matter/') ||
            id.includes('/js-yaml/')
          ) {
            return 'vendor-install';
          }

          // Drizzle ORM — leaks via @aics/core barrel export, isolate it
          if (id.includes('/drizzle-orm/')) {
            return 'vendor-drizzle';
          }
        },
      },
    },
  },
});
