import { expect, test } from '@playwright/test';
import { getEmployeeCount, isCanvasRendered } from './helpers/scene-bridge';
import { injectProvider, openChat, sendChat, waitForRuntime } from './helpers/setup';

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

  test('scene reacts to graph events during chat execution', async ({ page }) => {
    await openChat(page);

    // Subscribe to graph.node.entered before sending message.
    // This event is emitted by the core graph for every node that runs,
    // and SceneManager uses it to drive employee visual state transitions.
    const nodeEntered = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        // biome-ignore lint/suspicious/noExplicitAny: window debug bridge access in E2E
        const bus = (window as any).__AICS_DEBUG__?.eventBus;
        if (!bus) {
          resolve(false);
          return;
        }
        const unsub = bus.on('graph.node.entered', () => {
          unsub();
          resolve(true);
        });
        // Timeout fallback
        setTimeout(() => {
          unsub();
          resolve(false);
        }, 55_000);
      });
    });

    await sendChat(page, 'Write a haiku about code.');
    const didEnter = await nodeEntered;
    expect(didEnter).toBe(true);
  });
});
