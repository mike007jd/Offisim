import type { SkillRow, SkillScope, SkillSourceKind } from '@offisim/shared-types';

// ---------------------------------------------------------------------------
// Model cost rates
// ---------------------------------------------------------------------------

export interface ModelCostRateRow {
  rate_id: string;
  provider: string;
  model_pattern: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
  effective_from: string;
  effective_until: string | null;
  created_at: string;
}

export type NewModelCostRate = Omit<ModelCostRateRow, 'rate_id' | 'created_at'>;

export interface ModelCostRateRepository {
  create(rate: NewModelCostRate): Promise<ModelCostRateRow>;
  findByProviderModel(provider: string, model: string): Promise<ModelCostRateRow | null>;
  findAll(): Promise<ModelCostRateRow[]>;
  upsert(rate: NewModelCostRate): Promise<ModelCostRateRow>;
}

// ---------------------------------------------------------------------------
// Settings (generic key-value for one-shot bootstrap markers)
// ---------------------------------------------------------------------------

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Skills (two-tier: company-global + employee-specific)
// ---------------------------------------------------------------------------

export type { SkillRow, SkillScope, SkillSourceKind };

export type NewSkill = SkillRow;

export type SkillUpdate = Partial<
  Pick<
    SkillRow,
    'name' | 'description' | 'version' | 'source_kind' | 'source_ref' | 'vault_path' | 'updated_at'
  >
>;

export interface SkillRepository {
  insert(row: NewSkill): Promise<void>;
  update(skillId: string, patch: SkillUpdate): Promise<void>;
  delete(skillId: string): Promise<void>;
  findById(skillId: string): Promise<SkillRow | null>;
  /** Every skill in the company, irrespective of scope — caller partitions by `row.scope` / `row.employee_id`. */
  listByCompany(companyId: string): Promise<SkillRow[]>;
  listByCompanyScope(companyId: string): Promise<SkillRow[]>;
  listByEmployee(companyId: string, employeeId: string): Promise<SkillRow[]>;
  findBySlug(companyId: string, employeeId: string | null, slug: string): Promise<SkillRow | null>;
}
