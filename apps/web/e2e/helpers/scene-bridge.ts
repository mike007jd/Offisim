import type { Page } from '@playwright/test';

/**
 * Get the number of employee entities in the PixiJS scene.
 * Returns 0 if the debug bridge is not available yet.
 */
export async function getEmployeeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: window debug bridge access in E2E
    return (window as any).__AICS_DEBUG__?.getSceneState()?.employeeCount ?? 0;
  });
}

/**
 * Get IDs of all employee entities in the scene.
 * Returns an empty array if the debug bridge is not available yet.
 */
export async function getEmployeeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: window debug bridge access in E2E
    return (window as any).__AICS_DEBUG__?.getSceneState()?.employeeIds ?? [];
  });
}

/**
 * Check if the PixiJS canvas has been rendered (exists in DOM and has dimensions).
 * Note: PixiJS uses WebGL by default, so we cannot read 2D pixels directly.
 * Instead we check that a canvas element exists and has non-zero dimensions.
 */
export async function isCanvasRendered(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    return canvas.width > 0 && canvas.height > 0;
  });
}

/**
 * Wait until the debug bridge reports a specific employee count.
 */
export async function waitForEmployeeCount(
  page: Page,
  expectedCount: number,
  timeout = 15_000,
): Promise<void> {
  await page.waitForFunction(
    (count) => {
      // biome-ignore lint/suspicious/noExplicitAny: window debug bridge access in E2E
      const state = (window as any).__AICS_DEBUG__?.getSceneState();
      return state?.employeeCount === count;
    },
    expectedCount,
    { timeout },
  );
}
