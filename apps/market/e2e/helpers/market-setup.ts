import { type Page, expect } from '@playwright/test';

const AUTH_STORAGE_KEY = 'offisim-auth-token';

/**
 * Inject a mock auth JWT into localStorage to simulate logged-in state.
 * The token must be a valid JWT structure (header.payload.signature) because
 * useAuth's decodeTokenPayload parses parts[1] as JSON with {sub, email, display_name}.
 * Must be called after navigating to a page (localStorage is origin-scoped).
 */
export async function injectAuth(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = btoa(
      JSON.stringify({
        sub: 'e2e-user-1',
        email: 'e2e@test.local',
        display_name: 'E2E Test User',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    const mockJwt = `${header}.${payload}.e2e-signature`;
    localStorage.setItem(key, mockJwt);
  }, AUTH_STORAGE_KEY);
}

/**
 * Wait for Next.js hydration to complete.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  // In Next.js dev mode, networkidle may resolve before hydration completes.
  // Wait for document.readyState to ensure all scripts have executed.
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15_000 });
}

/**
 * Assert that essential SEO meta tags are present on the page.
 */
export async function assertSeoMeta(
  page: Page,
  expectations: { title?: RegExp | string; description?: RegExp | string },
): Promise<void> {
  if (expectations.title) {
    await expect(page).toHaveTitle(expectations.title);
  }
  if (expectations.description) {
    const meta = page.locator('meta[name="description"]');
    await expect(meta).toHaveAttribute('content', expectations.description);
  }
}

/**
 * Navigate to a market page and wait for hydration.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForHydration(page);
}

/**
 * Navigate to a page with auth pre-injected. Navigates first to establish
 * origin, injects auth into localStorage, then reloads.
 */
export async function navigateAuthenticated(page: Page, path: string): Promise<void> {
  await navigateTo(page, path);
  await injectAuth(page);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Collect JS errors during test execution and assert none are unexpected.
 * Must be called before any navigation to capture all errors.
 */
export function collectJsErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return {
    assertNoUnexpectedErrors() {
      const unexpected = errors.filter(
        (e) => !e.includes('fetch') && !e.includes('404') && !e.includes('NetworkError'),
      );
      expect(unexpected).toHaveLength(0);
    },
  };
}
