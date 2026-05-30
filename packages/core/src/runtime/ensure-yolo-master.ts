import { YOLO_MASTER_EMPLOYEE } from '../agents/yolo-master-persona.js';
import type { RuntimeRepositories } from './repositories.js';

/**
 * Idempotency contract: this performs an unguarded check-then-create
 * (findByRole → create) per active company. There is no partial unique
 * index backing the singleton, so it MUST run single-threaded at boot,
 * before any concurrent runtime access. Invoking it concurrently with
 * another instance can race and produce duplicate masters for the same
 * company. (The YOLO Master node only reads — it throws if the master is
 * absent rather than creating one — so the boot path is the sole writer.)
 */
export async function ensureYoloMasterForActiveCompanies(
  repos: Pick<RuntimeRepositories, 'companies' | 'employees'>,
): Promise<void> {
  const companies = await repos.companies.findAll();
  for (const company of companies) {
    if (company.status !== 'active') continue;
    const existing = await repos.employees.findByRole(company.company_id, 'yolo_master');
    if (existing.length > 0) continue;
    await repos.employees.create({
      employee_id: crypto.randomUUID(),
      company_id: company.company_id,
      source_asset_id: null,
      source_package_id: null,
      name: YOLO_MASTER_EMPLOYEE.name,
      role_slug: YOLO_MASTER_EMPLOYEE.role_slug,
      persona_json: YOLO_MASTER_EMPLOYEE.persona_json,
      config_json: YOLO_MASTER_EMPLOYEE.config_json,
      is_external: false,
    });
  }
}
