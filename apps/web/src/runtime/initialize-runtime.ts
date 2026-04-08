import type { InMemoryEventBus } from '@offisim/core/browser';
import type { InteractionMode } from '@offisim/shared-types';
import type { ProviderConfig } from '@offisim/ui-office/web';
import type { RuntimeBundle } from '../lib/browser-runtime';

export async function initializeRuntimeBundle(
  config: ProviderConfig | null,
  eventBus: InMemoryEventBus,
  tauri: boolean,
  companyId: string,
  opts?: { defaultInteractionMode?: InteractionMode },
): Promise<RuntimeBundle | null> {
  if (tauri) {
    if (!config) {
      const { createTauriRuntimeReposOnly } = await import('../lib/tauri-runtime-lite');
      return createTauriRuntimeReposOnly(eventBus);
    }
    const { createTauriRuntime } = await import('../lib/tauri-runtime');
    return createTauriRuntime(config, eventBus, companyId, opts);
  }

  const { createBrowserRuntime, createBrowserRuntimeReposOnly } = await import(
    '../lib/browser-runtime'
  );
  if (!config) {
    return createBrowserRuntimeReposOnly(eventBus, companyId, opts);
  }
  return createBrowserRuntime(config, eventBus, companyId, opts);
}
