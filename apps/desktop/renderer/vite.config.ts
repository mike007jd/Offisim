import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const uiOfficeSrc = path.resolve(__dirname, '../../../packages/ui-office/src');
const repoRoot = path.resolve(__dirname, '../../..');

/**
 * Dev-mode aliases: resolve @offisim/ui-office imports to source (.ts/.tsx) instead of
 * compiled dist, enabling HMR without rebuilding the package.
 *
 * SYNC: This list must mirror the `exports` field in packages/ui-office/package.json.
 * When adding a new subpath export there, add a matching alias here.
 *
 * Only active during `vite dev` (command === 'serve'). Production builds resolve
 * through node_modules, which requires ui-office to be built first (turbo handles this).
 */
function createUiOfficeAliases() {
  return [
    {
      find: /^@offisim\/ui-office$/,
      replacement: path.resolve(uiOfficeSrc, 'index.ts'),
    },
    {
      find: /^@offisim\/ui-office\/scene$/,
      replacement: path.resolve(uiOfficeSrc, 'scene.ts'),
    },
    {
      find: /^@offisim\/ui-office\/web$/,
      replacement: path.resolve(uiOfficeSrc, 'web.ts'),
    },
    {
      find: /^@offisim\/ui-office\/wizard$/,
      replacement: path.resolve(uiOfficeSrc, 'components/onboarding/CompanyCreationWizard.tsx'),
    },
    {
      find: /^@offisim\/ui-office\/dashboard$/,
      replacement: path.resolve(uiOfficeSrc, 'components/dashboard/DashboardOverlay.tsx'),
    },
    {
      find: /^@offisim\/ui-office\/employee-creator$/,
      replacement: path.resolve(uiOfficeSrc, 'components/employees/EmployeeCreatorOverlay.tsx'),
    },
    {
      find: /^@offisim\/ui-office\/office-editor$/,
      replacement: path.resolve(uiOfficeSrc, 'components/office/OfficeEditorOverlay.tsx'),
    },
    {
      find: /^@offisim\/ui-office\/install$/,
      replacement: path.resolve(uiOfficeSrc, 'components/install/InstallDialog.tsx'),
    },
    {
      find: /^@offisim\/ui-office\/studio$/,
      replacement: path.resolve(uiOfficeSrc, 'components/studio/StudioPage.tsx'),
    },
    {
      find: /^@offisim\/ui-office\/marketplace$/,
      replacement: path.resolve(uiOfficeSrc, 'components/marketplace/index.ts'),
    },
    {
      find: /^@offisim\/ui-office\/sop-view$/,
      replacement: path.resolve(uiOfficeSrc, 'sop-view.ts'),
    },
  ];
}

/**
 * Vite config for the desktop-owned Tauri WebView renderer.
 *
 * Key concerns:
 * 1. Alias node:async_hooks → browser polyfill (LangChain uses AsyncLocalStorage)
 * 2. Alias better-sqlite3 → empty stub (Node-only, unused in browser)
 * 3. Pre-bundle @offisim/core so CJS transitive deps get ESM conversion
 * 4. LLM proxy middleware to avoid CORS during development
 */
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const minimaxApiKey =
    command === 'serve' ? (env.MINIMAX_API_KEY ?? env.VITE_MINIMAX_API_KEY ?? '') : '';
  const minimaxBaseUrl =
    env.MINIMAX_BASE_URL ?? env.VITE_MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic';
  const minimaxModel = env.MINIMAX_MODEL ?? env.VITE_MINIMAX_MODEL ?? 'MiniMax-M2.7';

  return {
    define: {
      'import.meta.env.VITE_MINIMAX_API_KEY': JSON.stringify(minimaxApiKey),
      'import.meta.env.VITE_MINIMAX_BASE_URL': JSON.stringify(minimaxBaseUrl),
      'import.meta.env.VITE_MINIMAX_MODEL': JSON.stringify(minimaxModel),
    },
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
            'api.moonshot.ai',
            'api.moonshot.cn',
            'api.minimax.io',
            'api.minimaxi.com',
            'api.z.ai',
            'api.openai.com',
            'api.anthropic.com',
            'api.github.com',
            'localhost',
            '127.0.0.1',
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
      port: 5176,
      strictPort: true,
      hmr: { overlay: false },
    },
    resolve: {
      alias: [
        ...(command === 'serve' ? createUiOfficeAliases() : []),
        {
          find: 'node:async_hooks',
          replacement: path.resolve(__dirname, 'src/polyfills/async-local-storage.ts'),
        },
        {
          find: 'better-sqlite3',
          replacement: path.resolve(__dirname, 'src/polyfills/empty-module.ts'),
        },
        {
          find: /^node:(fs|path)$/,
          replacement: path.resolve(__dirname, 'src/polyfills/empty-module.ts'),
        },
        // Redirect bare `@offisim/core` imports (from @offisim/ui-office compiled output)
        // to the browser-safe barrel. This prevents LangGraph / OpenAI SDK / Anthropic SDK
        // from being pulled into the initial bundle via ui-office's static imports.
        // Heavy runtime modules (graph, LLM, MCP) use explicit @offisim/core subpaths
        // in tauri-runtime.ts to bypass this alias.
        // Uses regex with exact match ($ anchor) so @offisim/core/browser, @offisim/core/dist/...
        // are NOT affected.
        {
          find: /^@offisim\/core$/,
          replacement: path.resolve(__dirname, '../../../packages/core/dist/browser.js'),
        },
      ],
    },
    optimizeDeps: {
      include: ['@offisim/core', '@offisim/core/browser', '@offisim/shared-types'],
      exclude: [
        '@tauri-apps/api',
        '@tauri-apps/plugin-fs',
        '@tauri-apps/plugin-sql',
        '@tauri-apps/plugin-dialog',
        '@tauri-apps/plugin-opener',
      ],
      // Force re-bundle on every dev-server restart in serve mode. Workspace
      // deps (`@offisim/core`) are published as `dist/*` files; pnpm does not
      // bump package.json when the dist content changes, so Vite's default
      // pre-bundle cache keyed on dep-metadata stays stale even after a
      // fresh `pnpm --filter @offisim/core build`. This manifested as live
      // verify seeing fresh `employee-node` dist (direct import, not
      // pre-bundled) alongside stale `memory-repositories` dist (reached via
      // `@offisim/core/browser`, pre-bundled). `force: true` keeps the dev
      // workflow idempotent vs the canonical core rebuild cycle.
      force: command === 'serve',
    },
    build: {
      // The remaining large lazy chunks are intentional:
      // - vendor-llm (~1.08 MB minified) for provider SDKs
      // - collaboration rail (~1.28 MB minified) for the full chat/task surface
      // Both are split out of the entry path, so we set the warning budget to the
      // audited ceiling instead of the previous lower generic threshold.
      chunkSizeWarningLimit: 1300,
      rollupOptions: {
        external: ['better-sqlite3', '@langchain/langgraph-checkpoint-sqlite'],
        output: {
          // ---------------------------------------------------------------------------
          // Manual chunk splitting strategy:
          // Keep manual chunking limited to third-party/vendor islands and the install
          // toolchain. Application modules already have meaningful split points via
          // React.lazy() and route-level dynamic imports; forcing local ui-office code
          // into coarse manual chunks caused circular chunk warnings and oversized
          // "foundation" bundles.
          //
          //   vendor-react   — React core (rarely changes, long cache)
          //   vendor-llm     — LLM SDKs + LangChain + zod (lazy on first chat)
          //   vendor-3d      — Three.js + React Three Fiber (lazy on 3D view toggle)
          //   vendor-ui      — Radix primitives + lucide icons
          //   vendor-install — fflate + ajv + js-yaml
          //   vendor-drizzle — drizzle-orm (isolated from the browser-safe core barrel)
          //   app-install    — install-core + schema tooling
          // ---------------------------------------------------------------------------
          manualChunks(id: string) {
            if (
              id.includes('/packages/install-core/dist/') ||
              id.includes('/packages/asset-schema/dist/') ||
              id.includes('/packages/renderer/dist/') ||
              id.includes('/packages/core/dist/skills/') ||
              id.includes('/packages/core/dist/agents/skill-install-tools') ||
              id.endsWith('/apps/desktop/renderer/src/lib/skill-install-env.ts') ||
              id.endsWith('/apps/desktop/renderer/src/lib/tauri-skill-install-adapters.ts') ||
              id.endsWith('/apps/desktop/renderer/src/lib/github-tarball.ts')
            ) {
              return 'app-install';
            }

            if (!id.includes('node_modules')) return;

            // React core — shared base, changes infrequently
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
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

            // Post-processing remains a second lazy 3D chunk; Office3DView loads it only
            // for high/medium lighting tiers after the Canvas is already active.
            if (id.includes('/@react-three/postprocessing/') || id.includes('/postprocessing/')) {
              return 'vendor-postprocessing';
            }

            // Three.js + React Three Fiber (lazy on 3D view toggle)
            if (id.includes('/three/') || id.includes('/@react-three/')) {
              return 'vendor-3d';
            }

            // UI stack — icons, Radix primitives, scroll-lock
            if (
              id.includes('/lucide-react/') ||
              id.includes('/@radix-ui/') ||
              id.includes('/react-remove-scroll') ||
              id.includes('/use-callback-ref/') ||
              id.includes('/use-sidecar/') ||
              id.includes('/react-style-singleton/')
            ) {
              return 'vendor-ui';
            }

            // Install stack — ZIP + JSON Schema + frontmatter
            if (
              id.includes('/fflate/') ||
              id.includes('/ajv/') ||
              id.includes('/ajv-formats/') ||
              id.includes('/js-yaml/')
            ) {
              return 'vendor-install';
            }

            // Drizzle ORM — leaks via @offisim/core barrel export, isolate it
            if (id.includes('/drizzle-orm/')) {
              return 'vendor-drizzle';
            }
          },
        },
      },
    },
  };
});
