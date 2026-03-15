import { expect, test } from '@playwright/test';
import { assertSeoMeta, navigateTo } from './helpers/market-setup';

test.describe('Smoke: Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/');
  });

  test('renders hero section with title and CTA', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const cta = page.getByRole('link', { name: /browse/i }).first();
    await expect(cta).toBeVisible();
  });

  test('navigation bar renders with key links', async ({ page }) => {
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: /market|home/i })).toBeVisible();
  });

  test('showcase section renders listing cards', async ({ page }) => {
    // Look for heading elements in the showcase area rather than fragile CSS classes
    const headings = page.getByRole('heading', { level: 3 });
    const count = await headings.count();
    expect(count).toBeGreaterThan(0);
  });

  test('statistics section shows numbers', async ({ page }) => {
    const statsArea = page.getByText(/packages|installs|creators/i).first();
    await expect(statsArea).toBeVisible();
  });

  test('category grid renders browsable categories', async ({ page }) => {
    const categoryLinks = page.getByRole('link').filter({ hasText: /employee|skill|sop|template|layout|bundle/i });
    const count = await categoryLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test('page has valid SEO meta tags', async ({ page }) => {
    await assertSeoMeta(page, { title: /.+/, description: /.+/ });
  });

  test('JSON-LD structured data is present', async ({ page }) => {
    const jsonLd = page.locator('script[type="application/ld+json"]');
    const count = await jsonLd.count();
    expect(count).toBeGreaterThan(0);

    const content = await jsonLd.first().textContent();
    expect(content).toBeTruthy();
    const parsed = JSON.parse(content!);
    expect(parsed['@context']).toBe('https://schema.org');
  });
});
