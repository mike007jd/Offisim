/**
 * Lightweight Tauri runtime: SQLite repos + EventBus only, no LLM/graph.
 *
 * Used when no provider is configured — allows company creation, browsing,
 * and editing without requiring an API key. Data persists to SQLite so it
 * survives reinitRuntime() calls.
 */
import type { InMemoryEventBus } from '@offisim/core/browser';
import type { RuntimeBundle } from './browser-runtime';
import { seedDefaultCostRatesIfEmpty } from './seed-default-cost-rates';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { createTauriRepositories } from './tauri-repos';
import { seedTauriDb } from './tauri-seed';
import { tryActivateTauriVault } from './vault-tauri-activation';

export async function createTauriRuntimeReposOnly(
  eventBus: InMemoryEventBus,
  companyId?: string,
): Promise<RuntimeBundle> {
  await seedTauriDb();
  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db);

  await seedDefaultCostRatesIfEmpty(repos);

  // Vault is LLM-independent; activate it so employee markdown lands on disk
  // even without a provider key. Skipped in the pre-company Bootstrap stage.
  const vaultActivation = companyId
    ? await tryActivateTauriVault({ eventBus, repos, companyId })
    : null;

  return {
    eventBus,
    graph: null as unknown as RuntimeBundle['graph'],
    runtimeCtx: null as unknown as RuntimeBundle['runtimeCtx'],
    orch: null,
    installService: null,
    mcpToolExecutor: null,
    repos,
    vaultActivation: vaultActivation ?? undefined,
    desktopVaultRoot: vaultActivation?.root ?? null,
    dispose: vaultActivation ? () => vaultActivation.dispose() : undefined,
  };
}
