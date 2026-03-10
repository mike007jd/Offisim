import {
  buildAicsGraph,
  createRuntimeContext,
  createGateway,
  InMemoryEventBus,
  ModelResolver,
  MockToolExecutor,
} from '@aics/core';
import type { ProviderConfig } from './provider-config';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { createTauriRepositories } from './tauri-repos';
import { TauriCheckpointSaver } from './tauri-checkpoint';
import { seedTauriDb } from './tauri-seed';

const COMPANY_ID = 'company-001';
const THREAD_ID = 'thread-001';

/**
 * Create the full runtime stack for Tauri desktop mode.
 *
 * Differences from browser mode:
 * 1. Repos: Drizzle sqlite-proxy → persistent SQLite (not memory)
 * 2. Checkpointer: TauriCheckpointSaver → persistent (not MemorySaver)
 * 3. Gateway: Direct API calls, no Vite proxy (tauri-plugin-cors-fetch handles CORS)
 * 4. DB seed: Run once on first launch
 *
 * @param config - Provider configuration (API key, model, etc.)
 * @param eventBus - Shared EventBus instance from the Provider. Using a shared
 *   bus avoids the "EventBus churn" problem where async init would create a
 *   different bus than what UI hooks subscribe to.
 */
export async function createTauriRuntime(config: ProviderConfig, eventBus: InMemoryEventBus) {
  await seedTauriDb();

  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db);

  // No proxy needed — tauri-plugin-cors-fetch hooks fetch() transparently
  const gateway = createGateway({
    provider: config.provider,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    dangerouslyAllowBrowser: true,
  });

  const modelResolver = new ModelResolver(null, {
    provider: config.provider,
    model: config.model,
    temperature: 0.7,
    maxTokens: 4096,
  });

  const checkpointer = new TauriCheckpointSaver();
  const graph = buildAicsGraph({ checkpointer });

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver,
    toolExecutor: new MockToolExecutor(),
    companyId: COMPANY_ID,
    threadId: THREAD_ID,
  });

  // TODO: Wire InstallService for Tauri mode once Drizzle install repos are ready.
  // For now, install is browser-only (memory repos).
  return { eventBus, graph, runtimeCtx, installService: null };
}
