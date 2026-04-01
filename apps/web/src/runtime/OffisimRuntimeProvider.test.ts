import type { InMemoryEventBus } from '@offisim/core/browser';
import type { ProviderConfig } from '@offisim/ui-office';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeRuntimeBundle } from './initialize-runtime';

const createTauriRuntimeReposOnly = vi.fn();
const createTauriRuntime = vi.fn();
const createBrowserRuntimeReposOnly = vi.fn();
const createBrowserRuntime = vi.fn();

vi.mock('../lib/tauri-runtime-lite', () => ({
  createTauriRuntimeReposOnly,
}));

vi.mock('../lib/tauri-runtime', () => ({
  createTauriRuntime,
}));

vi.mock('../lib/browser-runtime', () => ({
  createBrowserRuntimeReposOnly,
  createBrowserRuntime,
}));

const TEST_COMPANY_ID = 'company-001';

describe('initializeRuntimeBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a repos-only runtime in Tauri when no provider config is saved', async () => {
    const eventBus = {} as InMemoryEventBus;
    const reposOnlyRuntime = { repos: { employees: {} } };
    createTauriRuntimeReposOnly.mockResolvedValueOnce(reposOnlyRuntime);

    const runtime = await initializeRuntimeBundle(null, eventBus, true, TEST_COMPANY_ID);

    expect(createTauriRuntimeReposOnly).toHaveBeenCalledWith(eventBus);
    expect(createTauriRuntime).not.toHaveBeenCalled();
    expect(runtime).toBe(reposOnlyRuntime);
  });

  it('creates the full Tauri runtime when provider config exists', async () => {
    const eventBus = {} as InMemoryEventBus;
    const config = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.4' } as ProviderConfig;
    const fullRuntime = { repos: { employees: {} }, graph: {} };
    createTauriRuntime.mockResolvedValueOnce(fullRuntime);

    const runtime = await initializeRuntimeBundle(config, eventBus, true, TEST_COMPANY_ID);

    expect(createTauriRuntime).toHaveBeenCalledWith(config, eventBus, TEST_COMPANY_ID, undefined);
    expect(createTauriRuntimeReposOnly).not.toHaveBeenCalled();
    expect(runtime).toBe(fullRuntime);
  });

  it('creates a repos-only runtime in browser mode when no provider config is saved', async () => {
    const eventBus = {} as InMemoryEventBus;
    const reposOnlyRuntime = { repos: { employees: {} } };
    createBrowserRuntimeReposOnly.mockResolvedValueOnce(reposOnlyRuntime);

    const runtime = await initializeRuntimeBundle(null, eventBus, false, TEST_COMPANY_ID);

    expect(createBrowserRuntimeReposOnly).toHaveBeenCalledWith(
      eventBus,
      TEST_COMPANY_ID,
      undefined,
    );
    expect(createBrowserRuntime).not.toHaveBeenCalled();
    expect(runtime).toBe(reposOnlyRuntime);
  });
});
