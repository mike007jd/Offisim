import { expect, test } from '@playwright/test';
import {
  clearAllTestState,
  openChat,
  seedTestCompanyAndProvider,
  sendChat,
  waitForResponse,
} from '../e2e/helpers/setup';

// Validates the production bundle end-to-end: vite build output served by
// `vite preview` must boot the runtime, seed a company, and complete a real
// MiniMax round-trip. Dev-mode E2E cannot cover prod-only code paths (minified
// bundle, no HMR shim, prod env guards), so regressions land here first.
//
// Note: this spec deliberately does NOT call `waitForRuntime`. The
// `window.__OFFISIM_DEBUG__` bridge is gated on `import.meta.env.DEV` inside
// OffisimRuntimeProvider and therefore absent from production bundles. We
// wait on visible UI (chat input placeholder) as the runtime-ready signal —
// which is also the more honest "user perspective" assertion for prod smoke.
test.describe('Smoke: Production Bundle', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedTestCompanyAndProvider(page);
    // Wait for the chat input to be enabled, not just visible. The placeholder
    // mounts with the shell but the textarea is `disabled` until the async
    // runtime init (loadProviderConfig → createBrowserRuntime → orch ready)
    // completes and ChatPanel flips `isReady = true`.
    await expect(page.getByPlaceholder('Message your team...')).toBeEnabled({
      timeout: 30_000,
    });
  });

  test('prod bundle reaches vendor API and renders AI response', async ({ page }) => {
    await openChat(page);
    await sendChat(page, 'Say hello in one sentence.');

    const response = await waitForResponse(page, 55_000);
    expect(response.length).toBeGreaterThan(0);
  });
});
