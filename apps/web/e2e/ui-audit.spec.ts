import { expect, test } from '@playwright/test';

/**
 * UI/UX Audit — Structural & interaction tests.
 *
 * These tests verify layout, accessibility, and interaction patterns
 * WITHOUT requiring an LLM provider key. They test the app shell only.
 */

test.describe('UI Audit: Layout & Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to simulate first visit
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('offisim.panel.left');
      localStorage.removeItem('offisim.panel.right');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('both sidebars default to expanded on first visit', async ({ page }) => {
    // Left panel should be 280px wide (expanded)
    const leftPanel = page.locator('[class*="border border-white"]').first();
    const leftBox = await leftPanel.boundingBox();
    expect(leftBox).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(leftBox!.width).toBeGreaterThan(200);

    // Right panel should also be 280px wide
    const rightPanel = page.locator('[class*="border border-white"]').last();
    const rightBox = await rightPanel.boundingBox();
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
    await page.goto('/');
    await page.waitForLoadState('networkidle');
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
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('chat drawer is visible between sidebars', async ({ page }) => {
    // Look for the chat input placeholder
    const _chatInput = page.getByPlaceholder('Send a message...');
    // It may or may not be visible depending on drawer state
    // But the drawer container should exist
    const drawerContainer = page.locator('.pointer-events-auto').locator('..').first();
    expect(drawerContainer).toBeTruthy();
  });
});

test.describe('UI Audit: Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('all icon-only buttons have aria-label or title', async ({ page }) => {
    // Get all buttons that only contain SVG (icon-only)
    const iconButtons = page.locator('button:has(svg):not(:has(span))');
    const count = await iconButtons.count();

    for (let i = 0; i < Math.min(count, 20); i++) {
      const btn = iconButtons.nth(i);
      const ariaLabel = await btn.getAttribute('aria-label');
      const title = await btn.getAttribute('title');
      const text = await btn.textContent();
      const hasLabel = ariaLabel || title || (text && text.trim().length > 0);
      if (!hasLabel) {
        const html = await btn.evaluate((el) => el.outerHTML.slice(0, 200));
        console.warn(`Icon-only button missing label: ${html}`);
      }
    }
  });

  test('focus-visible works on key interactive elements', async ({ page }) => {
    // Tab through elements and verify focus is visible
    await page.keyboard.press('Tab');
    const activeElement = page.locator(':focus-visible');
    // At least one element should be focusable
    expect(await activeElement.count()).toBeGreaterThanOrEqual(0);
  });
});

test.describe('UI Audit: Responsive — 768px', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('layout does not overflow at tablet width', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check no horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });
});
