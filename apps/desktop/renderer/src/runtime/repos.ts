import { createTauriDrizzleDb } from '@/lib/tauri-drizzle.js';
import { createTauriRepositories } from '@/lib/tauri-repos.js';
import {
  InMemoryEventBus,
  type RuntimeRepositories,
  seedDefaultCostRates,
} from '@offisim/core/browser';
import { repairPersistedPrefabLayouts } from './repair-prefab-layouts.js';

/**
 * Real backend access for the renderer: Drizzle (sqlite-proxy over
 * tauri-plugin-sql) → RuntimeRepositories. No preview-fixture data — this is the single
 * door to `<appDataDir>/offisim.db`. First-run company creation is owned by the
 * lifecycle surface so deleting every company leaves an honest empty state.
 */

export const runtimeEventBus = new InMemoryEventBus();

let reposPromise: Promise<RuntimeRepositories> | null = null;

export function getRepos(): Promise<RuntimeRepositories> {
  if (!reposPromise) {
    reposPromise = (async () => {
      const db = createTauriDrizzleDb();
      const repos = createTauriRepositories(db, runtimeEventBus);
      await repairPersistedPrefabLayouts(repos);
      // Seed default model cost rates once so the cost UI reports real spend
      // instead of $0 out of the box (the model_cost_rates table is otherwise
      // empty). Best-effort: a seeding failure must not block runtime access.
      if (repos.settings) {
        await seedDefaultCostRates({ costRates: repos.costRates, settings: repos.settings }).catch(
          () => undefined,
        );
      }
      return repos;
    })().catch((err) => {
      reposPromise = null;
      throw err;
    });
  }
  return reposPromise;
}
