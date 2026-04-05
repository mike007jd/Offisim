import { expect, test } from '@playwright/test';
import {
  clearAllTestState,
  openChat,
  seedTestCompanyAndProvider,
  sendChat,
  waitForGraphNodeEntered,
  waitForResponse,
  waitForRuntime,
} from './helpers/setup';

test.describe('Smoke: Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('sends a message and receives an AI response', async ({ page }) => {
    await openChat(page);
    await sendChat(page, 'Say hello in one sentence.');

    // Wait for AI response (real API call — free-tier models can be slow)
    const response = await waitForResponse(page, 55_000);
    expect(response.length).toBeGreaterThan(0);
  });

  test('EventLog shows graph node events after chat', async ({ page }) => {
    await openChat(page);
    const nodeEntered = waitForGraphNodeEntered(page);
    await sendChat(page, 'Say hello in one sentence.');
    expect(await nodeEntered).toBe(true);
  });
});
