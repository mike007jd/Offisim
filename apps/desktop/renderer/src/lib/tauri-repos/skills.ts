import type { SettingsRepository, SkillRepository, SkillUpdate } from '@offisim/core/browser';
import {
  type SkillDbRow,
  assertSkillScopeConsistency,
  buildSkillUpdateValues,
  rowToSkill,
  skillToDbRow,
} from '@offisim/core/runtime';
import * as schema from '@offisim/db-local';
import { and, eq, isNull } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

export interface SkillsTauriRepos {
  skills: SkillRepository;
  settings: SettingsRepository;
}

export function createSkillsTauriRepos(db: TauriDrizzleDb): SkillsTauriRepos {
  const skills: SkillRepository = {
    async insert(row) {
      assertSkillScopeConsistency(row);
      await db
        .insert(schema.skills)
        .values(skillToDbRow(row))
        .onConflictDoNothing({ target: schema.skills.skill_id });
    },
    async update(skillId, patch: SkillUpdate) {
      const values = buildSkillUpdateValues(patch);
      if (Object.keys(values).length === 1) return;
      await db.update(schema.skills).set(values).where(eq(schema.skills.skill_id, skillId));
    },
    async delete(skillId) {
      await db.delete(schema.skills).where(eq(schema.skills.skill_id, skillId));
    },
    async findById(skillId) {
      const rows = (await db
        .select()
        .from(schema.skills)
        .where(eq(schema.skills.skill_id, skillId))) as SkillDbRow[];
      const first = rows[0];
      return first ? rowToSkill(first) : null;
    },
    async listByCompany(companyId) {
      const rows = (await db
        .select()
        .from(schema.skills)
        .where(eq(schema.skills.company_id, companyId))) as SkillDbRow[];
      return rows.map(rowToSkill);
    },
    async listByCompanyScope(companyId) {
      const rows = (await db
        .select()
        .from(schema.skills)
        .where(
          and(eq(schema.skills.company_id, companyId), isNull(schema.skills.employee_id)),
        )) as SkillDbRow[];
      return rows.map(rowToSkill);
    },
    async listByEmployee(companyId, employeeId) {
      const rows = (await db
        .select()
        .from(schema.skills)
        .where(
          and(eq(schema.skills.company_id, companyId), eq(schema.skills.employee_id, employeeId)),
        )) as SkillDbRow[];
      return rows.map(rowToSkill);
    },
    async findBySlug(companyId, employeeId, slug) {
      const condition =
        employeeId === null
          ? and(
              eq(schema.skills.company_id, companyId),
              eq(schema.skills.slug, slug),
              isNull(schema.skills.employee_id),
            )
          : and(
              eq(schema.skills.company_id, companyId),
              eq(schema.skills.slug, slug),
              eq(schema.skills.employee_id, employeeId),
            );
      const rows = (await db.select().from(schema.skills).where(condition)) as SkillDbRow[];
      const first = rows[0];
      return first ? rowToSkill(first) : null;
    },
  };

  const settings: SettingsRepository = {
    async get(key) {
      const rows = (await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, key))) as Array<{ value: string }>;
      const first = rows[0];
      return first ? first.value : null;
    },
    async set(key, value) {
      await db
        .insert(schema.settings)
        .values({ key, value, updated_at: Date.now() })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value, updated_at: Date.now() },
        });
    },
  };

  return { skills, settings };
}
