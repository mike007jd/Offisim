import { createTauriDrizzleDb } from '@/lib/tauri-drizzle.js';
import { createTauriRepositories } from '@/lib/tauri-repos.js';
import {
  CompanyTemplateService,
  InMemoryEventBus,
  type RuntimeRepositories,
  listTemplates,
} from '@offisim/core/browser';

/**
 * Real backend access for the renderer: Drizzle (sqlite-proxy over
 * tauri-plugin-sql) → RuntimeRepositories. No preview-fixture data — this is the single
 * door to `<appDataDir>/offisim.db`. On first run, seeds one company from the
 * first built-in template (employees + workspace layout + prefab instances) so the
 * office has real data to render.
 */

export const runtimeEventBus = new InMemoryEventBus();

let reposPromise: Promise<RuntimeRepositories> | null = null;

export function getRepos(): Promise<RuntimeRepositories> {
  if (!reposPromise) {
    reposPromise = (async () => {
      const db = createTauriDrizzleDb();
      const repos = createTauriRepositories(db, runtimeEventBus);
      await ensureSeededCompany(repos);
      return repos;
    })().catch((err) => {
      reposPromise = null;
      throw err;
    });
  }
  return reposPromise;
}

async function ensureSeededCompany(repos: RuntimeRepositories): Promise<void> {
  const existing = await repos.companies.findAll();
  if (existing.some((c) => c.status !== 'archived')) return;

  const template = listTemplates()[0];
  if (!template) return;

  const companyId = crypto.randomUUID();
  const now = new Date().toISOString();
  await repos.companies.create({
    company_id: companyId,
    name: template.name,
    status: 'active',
    template_id: template.id,
    template_label: template.name,
    workspace_root: null,
    default_model_policy_json: null,
    created_at: now,
    updated_at: now,
  });

  const service = new CompanyTemplateService(
    repos.employees,
    repos.officeLayouts,
    runtimeEventBus,
    repos.prefabInstances,
    undefined,
    repos.zones,
  );
  await service.materializeTemplate(template.id, companyId);
}
