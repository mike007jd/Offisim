import { expect, test } from '@playwright/test';
import { clearAllTestState, seedTestCompanyAndProvider, waitForRuntime } from './helpers/setup';

test.describe('Smoke: Install Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('file import triggers install dialog', async ({ page }) => {
    // Trigger file import with a fake .aicspkg file via the hidden file input
    await page.evaluate(() => {
      const blob = new Blob(['fake-package-data'], { type: 'application/octet-stream' });
      const file = new File([blob], 'test-package.aicspkg', { type: 'application/octet-stream' });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // InstallDialog should open — wait for any dialog heading
    await expect(
      page.getByRole('heading', { name: /Loading Package|Review Package|Error/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('install dialog shows error for invalid package', async ({ page }) => {
    // Import a fake file that can't be parsed as a zip
    await page.evaluate(() => {
      const blob = new Blob(['not-a-real-zip'], { type: 'application/octet-stream' });
      const file = new File([blob], 'bad-package.aicspkg');
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
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
    await page.evaluate(() => {
      const blob = new Blob(['fake'], { type: 'application/octet-stream' });
      const file = new File([blob], 'test.aicspkg');
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
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
