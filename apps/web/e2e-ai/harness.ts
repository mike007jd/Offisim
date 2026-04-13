import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import dotenv from 'dotenv';
import {
  clearAllTestState,
  openChat,
  seedTestCompanyAndProvider,
  sendChat,
  waitForResponse,
  waitForRuntime,
} from '../e2e/helpers/setup';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, '../../../.env.local'),
  quiet: true,
});

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY?.trim() ?? '';
const MINIMAX_SKIP_MESSAGE =
  'Skipping apps/web AI behavior tests because MINIMAX_API_KEY is missing in .env.local.';

export const aiWebServer = {
  command: 'pnpm exec vite --host 127.0.0.1 --port 5176 --strictPort',
  port: 5176,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
};

export function requireMinimaxKey(): string {
  test.skip(!MINIMAX_API_KEY, MINIMAX_SKIP_MESSAGE);
  return MINIMAX_API_KEY;
}

export async function seedCompanyAndWaitForRuntime(page: Page): Promise<void> {
  await clearAllTestState(page);
  await seedTestCompanyAndProvider(page, {
    companyId: 'c-ai-web-smoke',
    templateId: 'ai-startup',
  });
  await waitForRuntime(page);
}

export async function sendBossMessage(page: Page, message: string): Promise<string> {
  await openChat(page);
  await sendChat(page, message);
  return waitForResponse(page, 90_000);
}

export async function cleanupAiPage(page: Page): Promise<void> {
  await clearAllTestState(page);
}
