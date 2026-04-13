import { expect, test } from '@playwright/test';
import {
  cleanupAiPage,
  requireMinimaxKey,
  seedCompanyAndWaitForRuntime,
  sendBossMessage,
} from './harness';

test.describe('Phase 0 - runtime smoke [AI]', () => {
  test.beforeAll(() => {
    requireMinimaxKey();
  });

  test.afterEach(async ({ page }) => {
    await cleanupAiPage(page);
  });

  test('opens the web runtime and renders a non-empty employee reply', async ({ page }) => {
    await seedCompanyAndWaitForRuntime(page);
    const reply = await sendBossMessage(
      page,
      'Reply with one short sentence confirming the employee UI is working.',
    );
    expect(reply.trim().length).toBeGreaterThan(0);
  });
});
