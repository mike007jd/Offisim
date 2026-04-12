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

  test('install dialog shows error for invalid file type', async ({ page }) => {
    // Import a file with an unsupported extension — the hook rejects it
    // synchronously before attempting ZIP parsing.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'bad-package.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not-a-package'),
    });

    // Should show the "Error" dialog title with the invalid file type message.
    await expect(page.getByRole('heading', { name: /Error/i })).toBeVisible({ timeout: 10_000 });
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
