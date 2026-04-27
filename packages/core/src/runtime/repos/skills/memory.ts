import type { SkillRow } from '@offisim/shared-types';
import type {
  NewSkill,
  SettingsRepository,
  SkillRepository,
  SkillUpdate,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { assertSkillScopeConsistency } from './shared.js';

function cloneRow(row: SkillRow): SkillRow {
  return { ...row };
}

export class MemorySkillRepository implements SkillRepository {
  private readonly byId = new Map<string, SkillRow>();

  async insert(row: NewSkill): Promise<void> {
    assertSkillScopeConsistency(row);
    if (this.byId.has(row.skill_id)) return;
    this.byId.set(row.skill_id, cloneRow(row));
  }

  async update(skillId: string, patch: SkillUpdate): Promise<void> {
    const existing = this.byId.get(skillId);
    if (!existing) return;
    const next: SkillRow = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.version !== undefined ? { version: patch.version } : {}),
      ...(patch.source_kind !== undefined ? { source_kind: patch.source_kind } : {}),
      ...(patch.source_ref !== undefined ? { source_ref: patch.source_ref } : {}),
      ...(patch.vault_path !== undefined ? { vault_path: patch.vault_path } : {}),
      updated_at: patch.updated_at ?? String(Date.now()),
    };
    this.byId.set(skillId, next);
  }

  async delete(skillId: string): Promise<void> {
    this.byId.delete(skillId);
  }

  async findById(skillId: string): Promise<SkillRow | null> {
    const row = this.byId.get(skillId);
    return row ? cloneRow(row) : null;
  }

  async listByCompany(companyId: string): Promise<SkillRow[]> {
    return [...this.byId.values()].filter((r) => r.company_id === companyId).map(cloneRow);
  }

  async listByCompanyScope(companyId: string): Promise<SkillRow[]> {
    return [...this.byId.values()]
      .filter((r) => r.company_id === companyId && r.employee_id === null)
      .map(cloneRow);
  }

  async listByEmployee(companyId: string, employeeId: string): Promise<SkillRow[]> {
    return [...this.byId.values()]
      .filter((r) => r.company_id === companyId && r.employee_id === employeeId)
      .map(cloneRow);
  }

  async findBySlug(
    companyId: string,
    employeeId: string | null,
    slug: string,
  ): Promise<SkillRow | null> {
    const found = [...this.byId.values()].find(
      (r) => r.company_id === companyId && r.employee_id === employeeId && r.slug === slug,
    );
    return found ? cloneRow(found) : null;
  }

  snapshot(): SkillRow[] {
    return [...this.byId.values()].map(cloneRow);
  }

  seed(rows: Iterable<SkillRow>): void {
    this.byId.clear();
    for (const row of rows) this.byId.set(row.skill_id, cloneRow(row));
  }
}

export class MemorySettingsRepository implements SettingsRepository {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

export interface SkillsMemoryRepos {
  skills: MemorySkillRepository;
  settings: MemorySettingsRepository;
}

export function createSkillsMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): SkillsMemoryRepos {
  const skills = new MemorySkillRepository();
  if (snapshot?.skills) skills.seed(snapshot.skills);
  return { skills, settings: new MemorySettingsRepository() };
}
