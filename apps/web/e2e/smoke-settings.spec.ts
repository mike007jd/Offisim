import { expect, test } from '@playwright/test';
import { clearAllTestState, seedTestCompanyAndProvider, waitForRuntime } from './helpers/setup';

test.describe('Smoke: Settings Page', () => {
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

  test('switches between Provider and MCP tabs', async ({ page }) => {
    const header = page.locator('header');
    await header.locator('button').last().click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Switch to MCP tab via sidebar nav button
    await page.getByRole('button', { name: /^MCP$/i }).click();

    // LLM fields should be hidden now
    await expect(page.getByPlaceholder('model-name')).not.toBeVisible();

    // Switch back to Provider
    await page.getByRole('button', { name: /^Provider$/i }).click();
    await expect(page.getByPlaceholder('model-name')).toBeVisible();
  });

  test('saves provider config to localStorage', async ({ page }) => {
    const header = page.locator('header');
    await header.locator('button').last().click();

    // Change model name
    const modelInput = page.getByPlaceholder('model-name');
    await modelInput.clear();
    await modelInput.fill('test-model-name');

    // Click save — Settings is a workspace page, stays open after save.
    // Saving triggers a runtime reinit which may briefly remount the page.
    await page.getByRole('button', { name: /Save settings/i }).click();

    // Poll localStorage until the model name appears (save is async + reinit)
    await expect
      .poll(
        async () => {
          const stored = await page.evaluate(() => localStorage.getItem('offisim-provider-config'));
          if (!stored) return null;
          try {
            return JSON.parse(stored).model;
          } catch {
            return null;
          }
        },
        { timeout: 10_000 },
      )
      .toBe('test-model-name');
  });
});
