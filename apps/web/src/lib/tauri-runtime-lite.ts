/**
 * Lightweight Tauri runtime: SQLite repos + EventBus only, no LLM/graph.
 *
 * Used when no provider is configured — allows company creation, browsing,
 * and editing without requiring an API key. Data persists to SQLite so it
 * survives reinitRuntime() calls.
 */
import { DEFAULT_COST_RATES } from '@aics/core/browser';
import type { InMemoryEventBus } from '@aics/core/browser';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { createTauriRepositories } from './tauri-repos';
import { seedTauriDb } from './tauri-seed';
import type { RuntimeBundle } from './browser-runtime';

export async function createTauriRuntimeReposOnly(
  eventBus: InMemoryEventBus,
): Promise<RuntimeBundle> {
  await seedTauriDb();
  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db);

  // Seed default cost rates (idempotent)
  const existing = await repos.costRates.findAll();
  if (existing.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    for (const rate of DEFAULT_COST_RATES) {
      await repos.costRates.create({
        provider: rate.provider,
        model_pattern: rate.model_pattern,
        input_cost_per_mtok: rate.input_cost_per_mtok,
        output_cost_per_mtok: rate.output_cost_per_mtok,
        effective_from: today,
        effective_until: null,
      });
    }
  }

  return {
    eventBus,
    graph: null as unknown as RuntimeBundle['graph'],
    runtimeCtx: null as unknown as RuntimeBundle['runtimeCtx'],
    orch: null,
    installService: null,
    mcpToolExecutor: null,
    repos,
  };
}
