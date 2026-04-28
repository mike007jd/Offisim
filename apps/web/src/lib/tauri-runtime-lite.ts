/**
 * Lightweight Tauri runtime: SQLite repos + EventBus only, no LLM/graph.
 *
 * Used when no provider is configured — allows company creation, browsing,
 * and editing without requiring an API key. Data persists to SQLite so it
 * survives reinitRuntime() calls.
 */
import { DeliverablePersistenceService, SkillLoader } from '@offisim/core/browser';
import type { InMemoryEventBus } from '@offisim/core/browser';
import { ensureYoloMasterForActiveCompanies } from '@offisim/core/dist/runtime/ensure-yolo-master.js';
import type { RuntimeBundle } from './browser-runtime';
import { seedDefaultCostRatesIfEmpty } from './seed-default-cost-rates';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { createTauriRepositories } from './tauri-repos';
import { tryActivateTauriVault } from './vault-tauri-activation';

export async function createTauriRuntimeReposOnly(
  eventBus: InMemoryEventBus,
  companyId?: string,
): Promise<RuntimeBundle> {
  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db, eventBus);
  await ensureYoloMasterForActiveCompanies(repos);
  const deliverablePersistence = new DeliverablePersistenceService({
    eventBus,
    repo: repos.deliverables,
  });

  await seedDefaultCostRatesIfEmpty(repos);

  // Vault is LLM-independent; activate it so employee markdown lands on disk
  // even without a provider key. Skipped in the pre-company Bootstrap stage.
  const vaultActivation = companyId
    ? await tryActivateTauriVault({ eventBus, repos, companyId })
    : null;
  const skillLoader = SkillLoader.forRepos(repos);
  if (vaultActivation && skillLoader) {
    skillLoader.setFs(vaultActivation.fs);
  }

  return {
    eventBus,
    graph: null as unknown as RuntimeBundle['graph'],
    runtimeCtx: null as unknown as RuntimeBundle['runtimeCtx'],
    orch: null,
    installService: null,
    mcpToolExecutor: null,
    repos,
    skillLoader,
    vaultActivation: vaultActivation ?? undefined,
    desktopVaultRoot: vaultActivation?.root ?? null,
    dispose: () => {
      deliverablePersistence.dispose();
      vaultActivation?.dispose();
    },
  };
}
