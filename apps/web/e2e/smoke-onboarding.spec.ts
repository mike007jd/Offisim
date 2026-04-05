import { expect, test } from '@playwright/test';
import {
  clearAllTestState,
  openChat,
  readOnboardingState,
  seedTestCompanyAndProvider,
  sendChat,
  waitForRuntime,
} from './helpers/setup';

// Third test runs a real MiniMax call end-to-end — exercises Boss → delegate →
// employee execution and can take up to 80s on free-tier models.
test.describe('Smoke: Onboarding Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    await waitForRuntime(page);
  });

  test('provider_configured is marked on mount', async ({ page }) => {
    await expect
      .poll(async () => (await readOnboardingState(page)).account?.provider_configured, {
        timeout: 5_000,
      })
      .toBe(true);
  });

  test('first_task_sent is marked when the user sends a message', async ({ page }) => {
    await openChat(page);
    await sendChat(page, 'Draft a one-paragraph mission statement for an indie tools studio.');

    await expect
      .poll(
        async () => {
          const state = await readOnboardingState(page);
          return Object.values(state.companies).some((c) => c?.first_task_sent === true);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test('first_deliverable_seen is marked after the runtime emits deliverable.created', async ({
    page,
  }) => {
    await openChat(page);

    // Install the listener BEFORE sending — avoids the race where the event
    // fires between sendChat resolving and evaluate() setting up the handler.
    const deliverablePromise = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        // biome-ignore lint/suspicious/noExplicitAny: window debug bridge access in E2E
        const bus = (window as any).__OFFISIM_DEBUG__?.eventBus;
        if (!bus) {
          resolve(false);
          return;
        }
        const off = bus.on('deliverable.created', () => {
          off();
          resolve(true);
        });
        setTimeout(() => {
          off();
          resolve(false);
        }, 80_000);
      });
    });

    await sendChat(page, 'Draft a one-paragraph mission statement for an indie tools studio.');

    const fired = await deliverablePromise;
    expect(fired).toBe(true);

    await expect
      .poll(
        async () => {
          const state = await readOnboardingState(page);
          return Object.values(state.companies).some((c) => c?.first_deliverable_seen === true);
        },
        { timeout: 5_000 },
      )
      .toBe(true);
  });
});
