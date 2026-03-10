import { test, expect } from '@playwright/test';
import { injectProvider, waitForRuntime, openChat, sendChat, waitForResponse } from './helpers/setup';

test.describe('Smoke: Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectProvider(page);
    await waitForRuntime(page);
  });

  test('sends a message and receives an AI response', async ({ page }) => {
    await openChat(page);
    await sendChat(page, 'Say hello in one sentence.');

    // Wait for AI response (real API call — up to 45s)
    const response = await waitForResponse(page, 45_000);
    expect(response.length).toBeGreaterThan(0);
  });

  test('EventLog shows graph node events after chat', async ({ page }) => {
    await openChat(page);
    await sendChat(page, 'Say hello in one sentence.');
    await waitForResponse(page, 45_000);

    // EventLog should have moved past "No events yet"
    await expect(page.getByText('No events yet')).not.toBeVisible({ timeout: 5_000 });
  });
});
