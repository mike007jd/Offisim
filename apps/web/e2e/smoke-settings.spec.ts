import { expect, test } from '@playwright/test';
import { injectProvider, waitForRuntime } from './helpers/setup';

test.describe('Smoke: Settings Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await injectProvider(page);
    await waitForRuntime(page);
  });

  test('opens settings and shows LLM Provider tab', async ({ page }) => {
    // Click the settings gear button (it's the last button in the header)
    const header = page.locator('header');
    await header.locator('button').last().click();

    // Dialog should be visible with title
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // LLM Provider tab should be active by default
    await expect(page.getByPlaceholder('sk-...')).toBeVisible();
    await expect(page.getByPlaceholder('model-name')).toBeVisible();
  });

  test('switches between LLM Provider and MCP Servers tabs', async ({ page }) => {
    const header = page.locator('header');
    await header.locator('button').last().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Switch to MCP Servers tab
    await page.getByRole('tab', { name: /MCP Servers/i }).click();

    // LLM fields should be hidden now
    await expect(page.getByPlaceholder('sk-...')).not.toBeVisible();

    // Switch back to LLM Provider
    await page.getByRole('tab', { name: /LLM Provider/i }).click();
    await expect(page.getByPlaceholder('sk-...')).toBeVisible();
  });

  test('saves provider config to localStorage', async ({ page }) => {
    const header = page.locator('header');
    await header.locator('button').last().click();

    // Change model name
    const modelInput = page.getByPlaceholder('model-name');
    await modelInput.clear();
    await modelInput.fill('test-model-name');

    // Click save
    await page.getByRole('button', { name: /Save Configuration/i }).click();

    // Dialog should close
    await expect(page.getByRole('heading', { name: 'Settings' })).not.toBeVisible({
      timeout: 5_000,
    });

    // Verify localStorage was updated
    const stored = await page.evaluate(() => localStorage.getItem('aics-provider-config'));
    expect(stored).toBeTruthy();
    if (!stored) {
      throw new Error('Expected aics-provider-config to be present in localStorage');
    }
    const parsed = JSON.parse(stored);
    expect(parsed.model).toBe('test-model-name');
  });
});
