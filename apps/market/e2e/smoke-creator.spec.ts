import { expect, test } from '@playwright/test';
import { collectJsErrors } from './helpers/market-setup';

test.describe('Smoke: Creator Page', () => {
  test('creator page handles unknown handle gracefully', async ({ page }) => {
    const { assertNoUnexpectedErrors } = collectJsErrors(page);

    const response = await page.goto('/creator/nonexistent-handle');

    expect(response?.status()).toBeDefined();
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForLoadState('networkidle');

    assertNoUnexpectedErrors();
  });
});
