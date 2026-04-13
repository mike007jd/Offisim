import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { aiWebServer } from './e2e-ai/harness';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

const hasMinimaxKey = Boolean(process.env.MINIMAX_API_KEY?.trim());

export default defineConfig({
  testDir: './e2e-ai',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5176',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: hasMinimaxKey ? aiWebServer : undefined,
});
