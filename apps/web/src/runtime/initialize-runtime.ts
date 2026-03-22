import type { InMemoryEventBus } from '@aics/core/browser';
import type { ProviderConfig } from '@aics/ui-office';
import type { RuntimeBundle } from '../lib/browser-runtime';

export async function initializeRuntimeBundle(
  config: ProviderConfig | null,
  eventBus: InMemoryEventBus,
  tauri: boolean,
  companyId: string,
): Promise<RuntimeBundle | null> {
  if (tauri) {
    if (!config) {
      const { createTauriRuntimeReposOnly } = await import('../lib/tauri-runtime-lite');
      return createTauriRuntimeReposOnly(eventBus);
    }
    const { createTauriRuntime } = await import('../lib/tauri-runtime');
    return createTauriRuntime(config, eventBus, companyId);
  }

  const { createBrowserRuntime, createBrowserRuntimeReposOnly } = await import(
    '../lib/browser-runtime'
  );
  if (!config) {
    return createBrowserRuntimeReposOnly(eventBus, companyId);
  }
  return createBrowserRuntime(config, eventBus, companyId);
}
