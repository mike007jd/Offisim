import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

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
        server.middlewares.use('/api/llm-proxy', async (req: IncomingMessage, res: ServerResponse) => {
          const targetBase = req.headers['x-llm-base-url'] as string;
          if (!targetBase) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing X-LLM-Base-URL header');
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
                  if (done) { res.end(); return; }
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
        });
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
    rollupOptions: {
      external: [
        'better-sqlite3',
        '@langchain/langgraph-checkpoint-sqlite',
      ],
    },
  },
});
