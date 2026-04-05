import { expect, test } from '@playwright/test';
import { clearAllTestState, seedTestCompanyAndProvider, waitForRuntime } from './helpers/setup';

test.describe('Smoke: Settings Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('opens settings and shows LLM Provider tab', async ({ page }) => {
    // Click the settings gear button (it's the last button in the header)
    const header = page.locator('header');
    await header.locator('button').last().click();

    // Dialog should be visible with title
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // LLM Provider tab should be active by default.
    // Use `model-name` placeholder — the apiKey placeholder flips to
    // 'Stored securely on this device' when a key is already seeded.
    await expect(page.getByPlaceholder('model-name')).toBeVisible();
  });

  test('switches between LLM Provider and MCP Servers tabs', async ({ page }) => {
    const header = page.locator('header');
    await header.locator('button').last().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Switch to MCP Servers tab
    await page.getByRole('tab', { name: /MCP Servers/i }).click();

    // LLM fields should be hidden now
    await expect(page.getByPlaceholder('model-name')).not.toBeVisible();

    // Switch back to LLM Provider
    await page.getByRole('tab', { name: /LLM Provider/i }).click();
    await expect(page.getByPlaceholder('model-name')).toBeVisible();
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
    const stored = await page.evaluate(() => localStorage.getItem('offisim-provider-config'));
    expect(stored).toBeTruthy();
    if (!stored) {
      throw new Error('Expected offisim-provider-config to be present in localStorage');
    }
    const parsed = JSON.parse(stored);
    expect(parsed.model).toBe('test-model-name');
  });
});
