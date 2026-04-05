// This config runs against a production build (`vite build && vite preview`) to
// verify that the bundled app can reach vendor APIs from the browser — the
// dev-mode E2E suite cannot catch regressions in production-only code paths.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local for API keys (MINIMAX_API_KEY etc.) — mirrors playwright.config.ts.
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

export default defineConfig({
  testDir: './e2e-prod',
  testMatch: 'smoke-prod-bundle.spec.ts',
  // Free-tier LLM models may be slow / rate-limited; chat tests need extra time.
  timeout: 90_000,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5176',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `vite build` produces the prod bundle, then `vite preview` serves dist/
    // on the same port dev mode uses so baseURL and helpers stay unchanged.
    command: 'pnpm build && pnpm exec vite preview --port 5176 --strictPort',
    port: 5176,
    reuseExistingServer: !process.env.CI,
    // Prod builds are slow: shared-types/core/ui-office pre-bundling + Vite build.
    timeout: 300_000,
  },
});
