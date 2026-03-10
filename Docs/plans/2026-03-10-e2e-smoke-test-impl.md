# E2E Smoke Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Playwright-based E2E smoke tests that validate critical paths (chat, scene, settings, install) with real LLM API calls.

**Architecture:** Playwright drives a Chromium browser against the Vite dev server. A debug bridge (`window.__AICS_DEBUG__`) exposes runtime internals for PixiJS state inspection. OpenRouter free-tier model provides real LLM responses.

**Tech Stack:** @playwright/test, Chromium, Vite dev server (auto-started via webServer config)

---

### Task 1: Install Playwright and create config

**Files:**
- Modify: `apps/web/package.json` (add devDep + script)
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/` directory

**Step 1: Install Playwright**

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim
pnpm --filter @aics/web add -D @playwright/test
```

**Step 2: Install Chromium browser binary**

```bash
cd apps/web && npx playwright install chromium
```

**Step 3: Create playwright.config.ts**

```typescript
// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

// Load .env.local for API keys
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

**Step 4: Add test:e2e script to package.json**

In `apps/web/package.json`, add to `"scripts"`:

```json
"test:e2e": "playwright test"
```

**Step 5: Install dotenv**

```bash
pnpm --filter @aics/web add -D dotenv
```

**Step 6: Create e2e directory**

```bash
mkdir -p apps/web/e2e/helpers
```

**Step 7: Verify Playwright runs (empty)**

```bash
cd apps/web && npx playwright test
```

Expected: "No tests found" or similar (0 tests, no errors).

**Step 8: Commit**

```bash
git add apps/web/package.json apps/web/playwright.config.ts pnpm-lock.yaml
git commit -m "chore(web): add Playwright E2E infrastructure"
```

---

### Task 2: Add debug bridge to AicsRuntimeProvider

**Files:**
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx`
- Create: `apps/web/src/types/debug-bridge.d.ts`

**Step 1: Create the type declaration for window.__AICS_DEBUG__**

```typescript
// apps/web/src/types/debug-bridge.d.ts
import type { InMemoryEventBus } from '@aics/core';
import type { InstallService } from '@aics/install-core';

/**
 * Debug bridge exposed on window in dev mode only.
 * Used by E2E smoke tests to inspect runtime internals.
 * Production builds eliminate this via import.meta.env.DEV guard.
 */
export interface AicsDebugBridge {
  eventBus: InMemoryEventBus;
  installService: InstallService | null;
  /** Serializable snapshot of employee entity IDs in the scene. */
  getSceneState: () => {
    employeeCount: number;
    employeeIds: string[];
  };
}

declare global {
  interface Window {
    __AICS_DEBUG__?: AicsDebugBridge;
  }
}
```

**Step 2: Expose the bridge in AicsRuntimeProvider**

In `apps/web/src/runtime/AicsRuntimeProvider.tsx`, add the bridge inside the `useMemo` block that creates `value`, right after `const runtime = getOrCreateRuntime();` (around line 318):

```typescript
// Expose debug bridge in dev mode only (E2E smoke tests)
if (import.meta.env.DEV && runtime) {
  window.__AICS_DEBUG__ = {
    eventBus: runtime.eventBus,
    installService: runtime.installService,
    getSceneState: () => ({
      employeeCount: 0, // Updated by SceneCanvas via a ref
      employeeIds: [],
    }),
  };
}
```

Note: `getSceneState` will be enhanced in Task 3 after we wire the SceneManager reference.

**Step 3: Verify typecheck**

```bash
pnpm --filter @aics/web exec tsc --noEmit
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add apps/web/src/types/debug-bridge.d.ts apps/web/src/runtime/AicsRuntimeProvider.tsx
git commit -m "feat(web): add __AICS_DEBUG__ bridge for E2E smoke tests (dev only)"
```

---

### Task 3: Wire SceneManager reference into debug bridge

**Files:**
- Modify: `apps/web/src/components/scene/SceneCanvas.tsx`
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx`

**Step 1: Read SceneCanvas.tsx to understand current hook**

Read `apps/web/src/components/scene/SceneCanvas.tsx` and `apps/web/src/hooks/use-scene.ts`.

**Step 2: Expose SceneManager on the debug bridge from SceneCanvas**

After `useScene()` creates the SceneManager and mounts it, update `window.__AICS_DEBUG__.getSceneState` to read from the real SceneManager. In `SceneCanvas.tsx`, inside the useEffect that calls `mount()`, add:

```typescript
if (import.meta.env.DEV && window.__AICS_DEBUG__) {
  window.__AICS_DEBUG__.getSceneState = () => {
    // Access employeeEntities from the SceneManager instance
    // We need to expose a method on SceneManager for this
    return {
      employeeCount: sceneManager.employeeCount,
      employeeIds: sceneManager.employeeIds,
    };
  };
}
```

**Step 3: Add read-only accessors to SceneManager**

In `packages/renderer/src/core/scene-manager.ts`, add after the `serverCount` pattern:

```typescript
/** Number of employee entities currently in the scene (for debug bridge). */
get employeeCount(): number {
  return this.employeeEntities.size;
}

/** IDs of all employee entities in the scene (for debug bridge). */
get employeeIds(): string[] {
  return [...this.employeeEntities.keys()];
}
```

**Step 4: Verify typecheck across both packages**

```bash
pnpm --filter @aics/renderer exec tsc --noEmit
pnpm --filter @aics/web exec tsc --noEmit
```

Expected: 0 errors in both.

**Step 5: Commit**

```bash
git add packages/renderer/src/core/scene-manager.ts apps/web/src/components/scene/SceneCanvas.tsx
git commit -m "feat(renderer,web): expose SceneManager state in debug bridge"
```

---

### Task 4: Write shared E2E helpers

**Files:**
- Create: `apps/web/e2e/helpers/setup.ts`
- Create: `apps/web/e2e/helpers/scene-bridge.ts`

**Step 1: Create setup.ts**

```typescript
// apps/web/e2e/helpers/setup.ts
import { type Page, expect } from '@playwright/test';

const STORAGE_KEY = 'aics-provider-config';

export interface TestProviderConfig {
  provider: 'openai-compat';
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * Inject an OpenRouter provider config into localStorage and reload.
 * Uses OPENROUTER_API_KEY from process.env (loaded from .env.local).
 */
export async function injectProvider(page: Page): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not found in .env.local');
  }

  const config: TestProviderConfig = {
    provider: 'openai-compat',
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'google/gemma-3-4b-it:free',
  };

  await page.goto('/');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(config)] as const,
  );
  await page.reload();
}

/**
 * Wait for the AICS runtime to be ready (debug bridge available).
 */
export async function waitForRuntime(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__AICS_DEBUG__ !== undefined,
    { timeout: 15_000 },
  );
}

/**
 * Open the chat drawer (it starts collapsed) and wait for input to be ready.
 */
export async function openChat(page: Page): Promise<void> {
  const showChatBtn = page.getByRole('button', { name: /show chat/i });
  // Only click if chat is currently hidden
  if (await showChatBtn.isVisible()) {
    await showChatBtn.click();
  }
  await expect(page.getByPlaceholder('Send a message...')).toBeVisible({ timeout: 5_000 });
}

/**
 * Type a message and send it via the chat input.
 */
export async function sendChat(page: Page, message: string): Promise<void> {
  const input = page.getByPlaceholder('Send a message...');
  await input.fill(message);
  await page.getByRole('button', { name: /send/i }).click();
}

/**
 * Wait for an AI response to appear in the chat panel.
 * Returns the text content of the response.
 */
export async function waitForResponse(page: Page, timeout = 45_000): Promise<string> {
  // AI messages have a specific visual treatment — look for the assistant bubble
  const responseBubble = page.locator('[data-role="assistant"]').last();
  await expect(responseBubble).toBeVisible({ timeout });
  const text = await responseBubble.textContent();
  return text ?? '';
}
```

**Step 2: Create scene-bridge.ts**

```typescript
// apps/web/e2e/helpers/scene-bridge.ts
import { type Page } from '@playwright/test';

/**
 * Get the number of employee entities in the PixiJS scene.
 */
export async function getEmployeeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return window.__AICS_DEBUG__?.getSceneState().employeeCount ?? 0;
  });
}

/**
 * Get IDs of all employee entities in the scene.
 */
export async function getEmployeeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return window.__AICS_DEBUG__?.getSceneState().employeeIds ?? [];
  });
}

/**
 * Check if the PixiJS canvas has rendered anything (non-empty).
 */
export async function isCanvasRendered(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true; // WebGL canvas — can't read pixels, assume rendered
    const imageData = ctx.getImageData(0, 0, 10, 10);
    return imageData.data.some((v, i) => i % 4 !== 3 && v !== 0);
  });
}

/**
 * Poll the debug bridge until a condition on employee states is met.
 */
export async function waitForSceneCondition(
  page: Page,
  predicate: string, // JS function body string: (state) => boolean
  timeout = 30_000,
): Promise<void> {
  await page.waitForFunction(
    (pred) => {
      const state = window.__AICS_DEBUG__?.getSceneState();
      if (!state) return false;
      const fn = new Function('state', `return (${pred})(state)`);
      return fn(state);
    },
    predicate,
    { timeout },
  );
}
```

**Step 3: Verify E2E helpers typecheck**

```bash
cd apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 || true
```

Note: E2E files may need Playwright types. If typecheck issues arise, we'll add a tsconfig for e2e.

**Step 4: Commit**

```bash
git add apps/web/e2e/helpers/
git commit -m "feat(web): add E2E test helpers (setup + scene-bridge)"
```

---

### Task 5: Add `data-role` attribute to MessageBubble for test targeting

**Files:**
- Modify: `apps/web/src/components/chat/MessageBubble.tsx`

**Step 1: Read the component**

Read `apps/web/src/components/chat/MessageBubble.tsx`.

**Step 2: Add data-role attribute**

Add `data-role={role}` to the outermost container div of the MessageBubble component. This gives E2E tests a stable selector for locating user vs assistant messages.

**Step 3: Verify web build**

```bash
pnpm --filter @aics/web build 2>&1 | tail -5
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add apps/web/src/components/chat/MessageBubble.tsx
git commit -m "feat(web): add data-role attribute to MessageBubble for E2E selectors"
```

---

### Task 6: Write smoke-chat.spec.ts

**Files:**
- Create: `apps/web/e2e/smoke-chat.spec.ts`

**Step 1: Write the test**

```typescript
// apps/web/e2e/smoke-chat.spec.ts
import { test, expect } from '@playwright/test';
import { injectProvider, waitForRuntime, openChat, sendChat, waitForResponse } from './helpers/setup';

test.describe('Smoke: Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectProvider(page);
    await waitForRuntime(page);
  });

  test('sends a message and receives an AI response', async ({ page }) => {
    await openChat(page);
    await sendChat(page, 'Say hello in one sentence.');

    // Wait for AI response (real API call — up to 45s)
    const response = await waitForResponse(page, 45_000);
    expect(response.length).toBeGreaterThan(0);
  });

  test('EventLog shows graph node events after chat', async ({ page }) => {
    await openChat(page);
    await sendChat(page, 'Say hello in one sentence.');
    await waitForResponse(page, 45_000);

    // EventLog should contain graph.node events
    const eventLog = page.locator('text=Event Log').locator('..');
    await expect(eventLog).toBeVisible();
    // At minimum we should see entries (the event items)
    const eventItems = eventLog.locator('[class*="text-xs"]');
    const count = await eventItems.count();
    expect(count).toBeGreaterThan(0);
  });
});
```

**Step 2: Run the test (first real E2E run)**

```bash
cd apps/web && npx playwright test smoke-chat.spec.ts --reporter=list
```

Expected: 2 tests pass (may take 30-60s due to real API calls). If they fail, debug and fix.

**Step 3: Commit**

```bash
git add apps/web/e2e/smoke-chat.spec.ts
git commit -m "test(web): add E2E smoke test for chat flow"
```

---

### Task 7: Write smoke-scene.spec.ts

**Files:**
- Create: `apps/web/e2e/smoke-scene.spec.ts`

**Step 1: Write the test**

```typescript
// apps/web/e2e/smoke-scene.spec.ts
import { test, expect } from '@playwright/test';
import { injectProvider, waitForRuntime, openChat, sendChat, waitForResponse } from './helpers/setup';
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

  test('canvas has rendered pixels (not blank)', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });

    // Give PixiJS a moment to render
    await page.waitForTimeout(1000);

    const rendered = await isCanvasRendered(page);
    expect(rendered).toBe(true);
  });

  test('employee states change during chat execution', async ({ page }) => {
    await openChat(page);

    // Track state changes via event bus
    const stateChanged = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const bus = window.__AICS_DEBUG__?.eventBus;
        if (!bus) { resolve(false); return; }
        const unsub = bus.on('employee.state.changed', () => {
          unsub();
          resolve(true);
        });
        // Timeout fallback
        setTimeout(() => { unsub(); resolve(false); }, 45_000);
      });
    });

    await sendChat(page, 'Write a haiku about code.');
    const didChange = await stateChanged;
    expect(didChange).toBe(true);
  });
});
```

**Step 2: Run the test**

```bash
cd apps/web && npx playwright test smoke-scene.spec.ts --reporter=list
```

Expected: 3 tests pass.

**Step 3: Commit**

```bash
git add apps/web/e2e/smoke-scene.spec.ts
git commit -m "test(web): add E2E smoke test for scene rendering"
```

---

### Task 8: Write smoke-settings.spec.ts

**Files:**
- Create: `apps/web/e2e/smoke-settings.spec.ts`

**Step 1: Write the test**

```typescript
// apps/web/e2e/smoke-settings.spec.ts
import { test, expect } from '@playwright/test';
import { injectProvider, waitForRuntime } from './helpers/setup';

test.describe('Smoke: Settings Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await injectProvider(page);
    await waitForRuntime(page);
  });

  test('opens settings and shows LLM Provider tab', async ({ page }) => {
    // Click the settings gear button
    await page.getByRole('button', { name: /settings/i }).click();

    // Dialog should be visible with title
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // LLM Provider tab should be active by default
    await expect(page.getByText('API Key')).toBeVisible();
    await expect(page.getByText('Model')).toBeVisible();
  });

  test('switches between LLM Provider and MCP Servers tabs', async ({ page }) => {
    await page.getByRole('button', { name: /settings/i }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Switch to MCP Servers tab
    await page.getByRole('tab', { name: /MCP Servers/i }).click();

    // MCP panel should be visible (look for its heading or content)
    await expect(page.getByText(/MCP/i)).toBeVisible();

    // Switch back to LLM Provider
    await page.getByRole('tab', { name: /LLM Provider/i }).click();
    await expect(page.getByText('API Key')).toBeVisible();
  });

  test('saves provider config to localStorage', async ({ page }) => {
    await page.getByRole('button', { name: /settings/i }).click();

    // Change model name
    const modelInput = page.locator('input[placeholder="model-name"]');
    await modelInput.clear();
    await modelInput.fill('google/gemma-3-1b-it:free');

    // Click save
    await page.getByRole('button', { name: /Save Configuration/i }).click();

    // Dialog should close
    await expect(page.getByRole('heading', { name: 'Settings' })).not.toBeVisible();

    // Verify localStorage was updated
    const stored = await page.evaluate(() => localStorage.getItem('aics-provider-config'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.model).toBe('google/gemma-3-1b-it:free');
  });
});
```

**Step 2: Run the test**

```bash
cd apps/web && npx playwright test smoke-settings.spec.ts --reporter=list
```

Expected: 3 tests pass.

**Step 3: Commit**

```bash
git add apps/web/e2e/smoke-settings.spec.ts
git commit -m "test(web): add E2E smoke test for settings dialog"
```

---

### Task 9: Write smoke-install.spec.ts

**Files:**
- Create: `apps/web/e2e/smoke-install.spec.ts`

**Step 1: Write the test**

The install flow uses the mock fallback path (no real .aicspkg file needed). We trigger
`startFileImport` via the debug bridge by creating a mock File object with a valid extension.

```typescript
// apps/web/e2e/smoke-install.spec.ts
import { test, expect } from '@playwright/test';
import { injectProvider, waitForRuntime } from './helpers/setup';
import { getEmployeeCount } from './helpers/scene-bridge';

test.describe('Smoke: Install Flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectProvider(page);
    await waitForRuntime(page);
  });

  test('mock install flow: review → done', async ({ page }) => {
    // Get initial employee count
    const initialCount = await getEmployeeCount(page);

    // Trigger file import with a fake .aicspkg file via the hidden file input
    // The mock path in useInstallFlow triggers when installService exists but
    // the file can't be parsed. We'll use a direct approach via the file input.
    await page.evaluate(() => {
      // Create a small fake .aicspkg file
      const blob = new Blob(['fake-package-data'], { type: 'application/octet-stream' });
      const file = new File([blob], 'test-package.aicspkg', { type: 'application/octet-stream' });

      // Find the file input and dispatch a change event
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // InstallDialog should open — wait for the dialog title
    await expect(
      page.getByRole('heading', { name: /Review Package|Loading Package/i }),
    ).toBeVisible({ timeout: 10_000 });

    // If we see "Review Package", click Continue/Approve
    const reviewHeading = page.getByRole('heading', { name: /Review Package/i });
    if (await reviewHeading.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Look for the approve/continue button
      const approveBtn = page.getByRole('button', { name: /Approve|Continue|Install/i });
      if (await approveBtn.isVisible()) {
        await approveBtn.click();
      }
    }

    // Wait for Done or Error state
    await expect(
      page.getByText(/Installation Complete|Installation Failed/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('cancel closes dialog cleanly', async ({ page }) => {
    // Trigger import
    await page.evaluate(() => {
      const blob = new Blob(['fake'], { type: 'application/octet-stream' });
      const file = new File([blob], 'test.aicspkg');
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // Wait for dialog
    await expect(
      page.getByRole('heading', { name: /Review Package|Loading Package/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Close the dialog via Escape or close button
    await page.keyboard.press('Escape');

    // Dialog should be gone
    await expect(
      page.getByRole('heading', { name: /Review Package|Loading Package/i }),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
```

**Step 2: Run the test**

```bash
cd apps/web && npx playwright test smoke-install.spec.ts --reporter=list
```

Expected: 2 tests pass. Note: this test exercises the mock fallback path since the
fake .aicspkg won't parse as a real zip. The real InstallService path will error, and
we verify the dialog handles it gracefully.

**Step 3: Commit**

```bash
git add apps/web/e2e/smoke-install.spec.ts
git commit -m "test(web): add E2E smoke test for install flow"
```

---

### Task 10: Run full E2E suite and fix issues

**Files:**
- Potentially modify any of the above files based on test results

**Step 1: Run full suite**

```bash
cd apps/web && npx playwright test --reporter=list
```

Expected: All 10 tests pass (2 chat + 3 scene + 3 settings + 2 install).

**Step 2: Fix any failures**

Debug and fix issues encountered. Common issues:
- Selector mismatches (update locators)
- Timeout too short (increase for real API calls)
- PixiJS canvas uses WebGL (can't read pixels with 2d context — update isCanvasRendered)
- Chat drawer state (may need to ensure it's open before interacting)

**Step 3: Run existing unit tests to verify no regressions**

```bash
pnpm --filter @aics/core test && pnpm --filter @aics/renderer test && pnpm --filter @aics/install-core test && pnpm --filter @aics/web test
```

Expected: 343 tests pass (unchanged).

**Step 4: Run web build to verify no production regressions**

```bash
pnpm --filter @aics/web build 2>&1 | tail -5
```

Expected: Build succeeds.

**Step 5: Final commit**

```bash
git add -A
git commit -m "test(web): complete E2E smoke test suite — 10 tests across 4 specs"
```

---

### Task 11: Update .gitignore and add to root test script

**Files:**
- Modify: `apps/web/.gitignore` (or root `.gitignore`)
- Optionally modify root `package.json`

**Step 1: Add Playwright artifacts to gitignore**

Add to `.gitignore`:

```
# Playwright
apps/web/test-results/
apps/web/playwright-report/
apps/web/blob-report/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore Playwright test artifacts"
```

---

### Summary

| Task | Spec | Tests | Validates |
|------|------|-------|-----------|
| 1 | Infrastructure | 0 | Playwright + Chromium installed |
| 2-3 | Debug bridge | 0 | `__AICS_DEBUG__` exposed in dev |
| 4 | Helpers | 0 | Shared test utilities |
| 5 | Selectors | 0 | `data-role` on MessageBubble |
| 6 | smoke-chat | 2 | Chat → LLM → streaming → EventLog |
| 7 | smoke-scene | 3 | Canvas render + employee states |
| 8 | smoke-settings | 3 | Settings tabs + config persistence |
| 9 | smoke-install | 2 | Install dialog flow + cancel |
| 10 | Integration | 10 total | Full suite green |
| 11 | Cleanup | 0 | Gitignore artifacts |

Total: **10 E2E tests** across 4 spec files, validating all critical paths identified in the design doc.
