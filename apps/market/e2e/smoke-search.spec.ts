import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers/market-setup';

test.describe('Smoke: Search', () => {
  test('search page renders with search input', async ({ page }) => {
    await navigateTo(page, '/search');

    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
    await expect(searchInput).toBeVisible();
  });

  test('search page accepts query parameter', async ({ page }) => {
    await navigateTo(page, '/search?q=employee');
    expect(page.url()).toContain('q=employee');
  });

  test('search from homepage navigates to search page', async ({ page }) => {
    await navigateTo(page, '/');

    const searchLink = page.getByRole('navigation').getByRole('link', { name: /browse/i });
    await searchLink.click();
    await page.waitForURL(/\/search/);
  });

  test('search page renders kind filter or category links', async ({ page }) => {
    await navigateTo(page, '/search');

    const filterElements = page.getByText(/employee|skill|sop|template/i);
    const count = await filterElements.count();
    expect(count).toBeGreaterThan(0);
  });

  test('empty search shows appropriate state', async ({ page }) => {
    await navigateTo(page, '/search?q=zzznonexistent999');

    await expect(page.getByRole('searchbox').or(page.getByPlaceholder(/search/i))).toBeVisible();
  });
});
