# E2E Smoke Test Design

> Date: 2026-03-10
> Status: Approved
> Approach: Playwright E2E with real LLM API calls

## Context

Mega-Phase A (Core Execution Loop) is complete with 343 unit/integration tests passing.
However, the entire UI layer and end-to-end user flows have never been validated in a
real browser. This design covers Playwright-based smoke tests that exercise the critical
paths with real LLM API calls (OpenRouter free tier).

## Architecture

### Technology Choice: Playwright

Selected over Vitest browser mode (experimental) and manual scripting (non-repeatable).
Playwright provides:

- `webServer` auto-start of Vite dev server
- Mature API for DOM assertions with configurable timeouts
- `page.evaluate()` for PixiJS canvas state inspection
- CI-ready with built-in retry support

### File Structure

```
apps/web/
├── e2e/
│   ├── smoke-chat.spec.ts       — Chat → Graph → streaming → EventLog
│   ├── smoke-scene.spec.ts      — SceneCanvas render + employee state animation
│   ├── smoke-settings.spec.ts   — SettingsDialog → Provider switch → runtime reinit
│   ├── smoke-install.spec.ts    — InstallDialog → ManifestReview → new employee in scene
│   └── helpers/
│       ├── setup.ts             — Shared fixtures: provider config, wait for runtime
│       └── scene-bridge.ts      — page.evaluate() utilities for SceneManager state
├── playwright.config.ts
└── package.json                 — @playwright/test devDep + "test:e2e" script
```

### Debug Bridge

`AicsRuntimeProvider` exposes internal references on `window.__AICS_DEBUG__` in dev mode
only (guarded by `import.meta.env.DEV`, eliminated in production builds):

```typescript
window.__AICS_DEBUG__ = {
  eventBus,          // Subscribe/inspect events
  sceneManager,      // Check employeeEntities, meetingRoom state
  runtime,           // BrowserRuntime or TauriRuntime reference
  installService,    // Trigger install flow directly (spec 4)
};
```

### API Key Strategy

Tests read `OPENROUTER_API_KEY` from `.env.local` via `process.env`, then inject into
browser localStorage through `helpers/setup.ts`. Keys are never hardcoded in test files.

## Test Specifications

### Spec 1: `smoke-chat.spec.ts` — Chat Core Flow

**Validates**: User input → AicsRuntimeProvider → OrchestrationService → LLM Proxy →
real API → streaming render → EventLog

Steps:
1. Inject OpenRouter provider config (gemma-3-4b-it:free) into localStorage
2. Wait for runtime ready (ChatDrawer visible)
3. Type "Say hello in one sentence" in ChatInput
4. Click send
5. Assert: AI response text appears in ChatPanel within 30s (non-empty)
6. Assert: EventLog has at least 1 `graph.node.entered` event
7. Assert: EventLog has `graph.node.exited` event (graph completed normally)

### Spec 2: `smoke-scene.spec.ts` — Scene Rendering + State Feedback

**Validates**: Graph execution → EventBus events → SceneManager → EmployeeEntity state

Steps:
1. Inject provider config
2. Wait for PixiJS canvas element in DOM
3. Via `__AICS_DEBUG__`: verify `employeeEntities.size === 3`
4. Send message that triggers employee execution ("Write a haiku")
5. Poll `__AICS_DEBUG__`: within 30s, at least 1 employee state !== 'idle'
6. Wait for completion: all employees back to 'idle'
7. Assert: canvas has non-black pixels (PixiJS rendered something)

### Spec 3: `smoke-settings.spec.ts` — Settings & Provider Switching

**Validates**: SettingsDialog UI → localStorage → runtime reinit → new provider works

Steps:
1. Click settings gear icon in Header
2. Assert: LLM Provider tab visible with provider, model, apiKey fields
3. Switch to MCP Servers tab
4. Assert: MCP config panel visible
5. Switch back to LLM Provider tab, change model to "google/gemma-3-1b-it:free"
6. Click save
7. Assert: localStorage `aics-provider-config` updated
8. Send a chat message
9. Assert: response received (new provider config active)

### Spec 4: `smoke-install.spec.ts` — Install Flow

**Validates**: InstallDialog → ManifestReview → BindingForm → Materializer →
employee.installed event → SceneManager.addEmployee()

Steps:
1. Via `page.evaluate()`: inject mock manifest JSON through `__AICS_DEBUG__.installService`
2. Assert: InstallDialog opens, shows ManifestReview
3. Click "Continue" (to BindingForm)
4. Assert: BindingForm shows model binding field
5. Click "Confirm Install"
6. Assert: Dialog closes
7. Via `__AICS_DEBUG__`: verify `employeeEntities.size` increased
8. Optional: screenshot to confirm new employee rendered on canvas

## Shared Helpers

### `helpers/setup.ts`

- `injectProvider(page, config)` — Write localStorage + reload
- `waitForRuntime(page)` — Poll for `__AICS_DEBUG__` existence
- `sendChat(page, message)` — Locate input → type → click send
- `waitForResponse(page, timeout)` — Wait for new AI message in ChatPanel

### `helpers/scene-bridge.ts`

- `getEmployeeCount(page)` — Read `__AICS_DEBUG__.sceneManager.employeeEntities.size`
- `getEmployeeStates(page)` — Serialize Map<id, state> and return
- `isCanvasRendered(page)` — Check canvas for non-empty pixels
- `waitForEmployeeState(page, predicate, timeout)` — Poll until predicate satisfied

## Playwright Configuration

```typescript
// playwright.config.ts key settings
{
  webServer: {
    command: 'pnpm --filter @aics/web dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  timeout: 60_000,           // Global test timeout (real API is slow)
  retries: 1,                // Allow 1 retry for network flakiness
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
}
```

Only Chromium — smoke tests are not cross-browser compatibility tests.

## Out of Scope

- **Meeting subgraph smoke test**: No UI entry point for `entryMode='meeting'` yet
- **Tauri desktop E2E**: Different launch path, separate effort
- **Visual regression testing**: Not needed for smoke; screenshots are optional debug aids
- **CI integration**: Future work; smoke tests are initially local-only

## Dependencies

- `@playwright/test` (devDependency in apps/web)
- Chromium browser binary (installed via `npx playwright install chromium`)
- `.env.local` with `OPENROUTER_API_KEY`
