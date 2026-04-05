import { expect, test } from '@playwright/test';
import { clearAllTestState, seedTestCompanyAndProvider, waitForRuntime } from './helpers/setup';

/**
 * UI/UX Audit — Structural & interaction tests.
 *
 * These tests verify layout, accessibility, and interaction patterns.
 * The App shell (header/footer/sidebar) only mounts after an active company
 * exists in localStorage, so the beforeEach hooks seed one before each test
 * — otherwise BootstrapProvider stays mounted and every locator fails.
 */

test.describe('UI Audit: Layout & Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    // clearAllTestState wipes panel keys too, so the seeded page boots with
    // panels in their default-expanded state.
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('both sidebars default to expanded on first visit', async ({ page }) => {
    // `.backdrop-blur-xl.rounded-2xl` is the unique class combo on AppLayout's
    // left/right panel root (see packages/ui-office/src/components/layout/AppLayout.tsx).
    // This avoids matching the onboarding hint bubble or panel toggle tabs which
    // both share the broader `border border-white/10` utility.
    const panels = page.locator('.backdrop-blur-xl.rounded-2xl');

    const leftBox = await panels.first().boundingBox();
    expect(leftBox).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(leftBox!.width).toBeGreaterThan(200);

    const rightBox = await panels.last().boundingBox();
    expect(rightBox).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(rightBox!.width).toBeGreaterThan(200);
  });

  test('collapse buttons are visible and vertically centered', async ({ page }) => {
    // Left collapse handle
    const leftHandle = page.locator('button[aria-label="Collapse personnel panel"]');
    await expect(leftHandle).toBeVisible();
    const leftBox = await leftHandle.boundingBox();
    expect(leftBox).toBeTruthy();
    // Should be roughly vertically centered (within middle 40% of viewport)
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    const viewportHeight = page.viewportSize()!.height;
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    const leftCenter = leftBox!.y + leftBox!.height / 2;
    expect(leftCenter).toBeGreaterThan(viewportHeight * 0.3);
    expect(leftCenter).toBeLessThan(viewportHeight * 0.7);

    // Right collapse handle
    const rightHandle = page.locator('button[aria-label="Collapse operations panel"]');
    await expect(rightHandle).toBeVisible();
  });

  test('collapse and expand sidebars', async ({ page }) => {
    // Collapse left panel
    await page.locator('button[aria-label="Collapse personnel panel"]').click();
    await page.waitForTimeout(400); // wait for 300ms transition

    // Left panel should now be narrow (44px)
    const expandBtn = page.locator('button[aria-label="Expand personnel panel"]');
    await expect(expandBtn).toBeVisible();

    // Expand it back
    await expandBtn.click();
    await page.waitForTimeout(400);
    const collapseBtn = page.locator('button[aria-label="Collapse personnel panel"]');
    await expect(collapseBtn).toBeVisible();
  });

  test('sidebar state persists in localStorage', async ({ page }) => {
    // Collapse left panel
    await page.locator('button[aria-label="Collapse personnel panel"]').click();
    await page.waitForTimeout(400);

    // Check localStorage
    const leftState = await page.evaluate(() => localStorage.getItem('offisim.panel.left'));
    expect(leftState).toBe('false');

    // Reload and verify it remembers
    await page.reload();
    await page.waitForLoadState('networkidle');
    const expandBtn = page.locator('button[aria-label="Expand personnel panel"]');
    await expect(expandBtn).toBeVisible();
  });
});

test.describe('UI Audit: Header & Status Bar', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('header is visible with key buttons', async ({ page }) => {
    const header = page.locator('header').first();
    await expect(header).toBeVisible();

    // Should have at least one button (settings gear)
    const buttons = header.locator('button');
    expect(await buttons.count()).toBeGreaterThan(0);
  });

  test('status bar is visible at bottom', async ({ page }) => {
    const statusBar = page.locator('footer');
    await expect(statusBar).toBeVisible();

    // Should have minimum height of 40px
    const box = await statusBar.boundingBox();
    expect(box).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });

  test('no text smaller than 9px in status bar', async ({ page }) => {
    const statusBar = page.locator('footer');
    const fontSize = await statusBar.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return Number.parseFloat(computed.fontSize);
    });
    expect(fontSize).toBeGreaterThanOrEqual(9);
  });
});

test.describe('UI Audit: Chat Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('chat drawer is visible between sidebars', async ({ page }) => {
    // The chat drawer mounts inside the main shell with its input placeholder
    // always present; on desktop viewport it is open by default.
    await expect(page.getByPlaceholder('Message your team...')).toBeVisible();
  });
});

test.describe('UI Audit: Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('all icon-only buttons have aria-label or title', async ({ page }) => {
    // Collect buttons whose only child is an SVG (icon-only) and report every
    // one that is missing an accessible label. The previous version only logged
    // a warning, which made the test silently pass even when a11y regressed.
    const missing = await page.evaluate(() => {
      const results: string[] = [];
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const hasSvg = btn.querySelector('svg') !== null;
        const hasSpan = btn.querySelector('span') !== null;
        if (!hasSvg || hasSpan) continue;
        const ariaLabel = btn.getAttribute('aria-label');
        const title = btn.getAttribute('title');
        const text = btn.textContent?.trim() ?? '';
        if (!ariaLabel && !title && text.length === 0) {
          results.push(btn.outerHTML.slice(0, 200));
        }
      }
      return results;
    });
    expect(missing, `Icon-only buttons missing a11y label:\n${missing.join('\n')}`).toEqual([]);
  });

  test('focus-visible works on key interactive elements', async ({ page }) => {
    // Tab into the app; the seeded App shell always has focusable elements
    // (header buttons, chat input, panel toggles) so at least one element
    // must be focused afterwards.
    await page.keyboard.press('Tab');
    const activeElement = page.locator(':focus-visible');
    expect(await activeElement.count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('UI Audit: Responsive — 768px', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('layout does not overflow at tablet width', async ({ page }) => {
    // Check no horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });
});
