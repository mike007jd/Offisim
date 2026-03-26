import { expect, test } from '@playwright/test';
import { collectJsErrors, navigateAuthenticated, navigateTo } from './helpers/market-setup';

test.describe('Smoke: Dashboard', () => {
  test('dashboard shows login prompt when not authenticated', async ({ page }) => {
    await navigateTo(page, '/dashboard');

    // Dashboard layout shows "Sign in to access your creator dashboard." when unauthenticated
    await expect(page.getByText('Sign in to access your creator dashboard.')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('dashboard renders authenticated state after login', async ({ page }) => {
    await navigateAuthenticated(page, '/dashboard');

    // Login prompt should be gone after auth injection
    await expect(page.getByText('Sign in to access your creator dashboard.')).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test('dashboard history page is accessible when authenticated', async ({ page }) => {
    await navigateAuthenticated(page, '/dashboard/history');

    // The history page should render (even if empty) without the login prompt
    await expect(page.getByText('Sign in to access your creator dashboard.')).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test('dashboard renders without JavaScript errors', async ({ page }) => {
    const { assertNoUnexpectedErrors } = collectJsErrors(page);

    await navigateAuthenticated(page, '/dashboard');

    assertNoUnexpectedErrors();
  });
});
