import { expect, test } from '@playwright/test';
import {
  injectProvider,
  openChat,
  sendChat,
  waitForResponse,
  waitForRuntime,
} from './helpers/setup';

test.describe('Smoke: Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectProvider(page);
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
    await sendChat(page, 'Say hello in one sentence.');

    // EventLog should show events even before the full response finishes.
    // graph.node.entered is emitted as soon as the first node starts.
    await expect(page.getByText('No events yet')).not.toBeVisible({ timeout: 55_000 });
  });
});
