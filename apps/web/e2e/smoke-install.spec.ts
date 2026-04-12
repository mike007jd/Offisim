import { expect, test } from '@playwright/test';
import { clearAllTestState, seedTestCompanyAndProvider, waitForRuntime } from './helpers/setup';

test.describe('Smoke: Install Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('file import triggers install dialog', async ({ page }) => {
    // Use Playwright's setInputFiles to trigger file import via the hidden input.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-package.offisimpkg',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('fake-package-data'),
    });

    // InstallDialog should open — wait for any dialog heading
    await expect(
      page.getByRole('heading', { name: /Loading Package|Review Package|Error/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('install dialog shows error for invalid package', async ({ page }) => {
    // Import a fake file that can't be parsed as a zip
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'bad-package.offisimpkg',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not-a-real-zip'),
    });

    // Should eventually show the "Installation Failed" heading inside the error content.
    // Use getByRole to avoid strict mode violation — both DialogTitle "Error"
    // and ErrorContent <h3> "Installation Failed" would match getByText.
    await expect(page.getByRole('heading', { name: 'Installation Failed' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('cancel closes dialog cleanly', async ({ page }) => {
    // Trigger import
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test.offisimpkg',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('fake'),
    });

    // Wait for dialog to appear
    await expect(
      page.getByRole('heading', { name: /Loading Package|Review Package|Error/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Close via Escape
    await page.keyboard.press('Escape');

    // Dialog should be gone
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
  });
});
