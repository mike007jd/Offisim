import { expect, test } from '@playwright/test';
import { collectJsErrors, injectAuth, navigateTo } from './helpers/market-setup';

test.describe('Smoke: Listing Detail', () => {
  test('listing page handles missing slug gracefully', async ({ page }) => {
    const response = await page.goto('/listing/nonexistent-package-slug');

    expect(response?.status()).toBeDefined();
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('listing page SSR renders without JavaScript errors', async ({ page }) => {
    const { assertNoUnexpectedErrors } = collectJsErrors(page);

    await page.goto('/listing/nonexistent-package-slug');
    await page.waitForLoadState('networkidle');

    assertNoUnexpectedErrors();
  });

  test('auth-dependent components hydrate correctly', async ({ page }) => {
    const { assertNoUnexpectedErrors } = collectJsErrors(page);

    await navigateTo(page, '/');
    await injectAuth(page);

    await page.goto('/listing/test-listing');
    await page.waitForLoadState('networkidle');

    assertNoUnexpectedErrors();
  });
});
