import { YOLO_MASTER_EMPLOYEE } from '../agents/yolo-master-persona.js';
import type { RuntimeRepositories } from './repositories.js';

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
