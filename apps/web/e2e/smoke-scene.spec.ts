import { expect, test } from '@playwright/test';
import { getEmployeeCount, isCanvasRendered } from './helpers/scene-bridge';
import {
  SEEDED_EMPLOYEE_IDS,
  clearAllTestState,
  openChat,
  seedTestCompanyAndProvider,
  sendChat,
  waitForGraphNodeEntered,
  waitForRuntime,
} from './helpers/setup';

test.describe('Smoke: Scene Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('canvas renders with seeded employees', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });
    const count = await getEmployeeCount(page);
    expect(count).toBe(SEEDED_EMPLOYEE_IDS.length);
  });

  test('canvas element has non-zero dimensions', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });

    // Give the renderer a moment to draw.
    await page.waitForTimeout(1000);

    const rendered = await isCanvasRendered(page);
    expect(rendered).toBe(true);
  });

  test('scene reacts to graph events during chat execution', async ({ page }) => {
    // `graph.node.entered` is emitted by the core graph for every node that
    // runs, and SceneManager uses it to drive employee visual state transitions.
    await openChat(page);
    const nodeEntered = waitForGraphNodeEntered(page);
    await sendChat(page, 'Write a haiku about code.');
    expect(await nodeEntered).toBe(true);
  });
});
