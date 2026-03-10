import { test, expect } from '@playwright/test';
import { injectProvider, waitForRuntime, openChat, sendChat } from './helpers/setup';
import { getEmployeeCount, isCanvasRendered } from './helpers/scene-bridge';

test.describe('Smoke: Scene Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await injectProvider(page);
    await waitForRuntime(page);
  });

  test('PixiJS canvas renders with 3 default employees', async ({ page }) => {
    // Canvas should be in the DOM
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });

    // Debug bridge should report 3 employees
    const count = await getEmployeeCount(page);
    expect(count).toBe(3);
  });

  test('canvas element has non-zero dimensions', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });

    // Give PixiJS a moment to render
    await page.waitForTimeout(1000);

    const rendered = await isCanvasRendered(page);
    expect(rendered).toBe(true);
  });

  test('employee states change during chat execution', async ({ page }) => {
    await openChat(page);

    // Set up event listener before sending message
    const stateChanged = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const bus = (window as any).__AICS_DEBUG__?.eventBus;
        if (!bus) { resolve(false); return; }
        const unsub = bus.on('employee.state.changed', () => {
          unsub();
          resolve(true);
        });
        // Timeout fallback
        setTimeout(() => { unsub(); resolve(false); }, 50_000);
      });
    });

    await sendChat(page, 'Write a haiku about code.');
    const didChange = await stateChanged;
    expect(didChange).toBe(true);
  });
});
