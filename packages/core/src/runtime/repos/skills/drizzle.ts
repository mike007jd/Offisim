import * as schema from '@offisim/db-local/dist/schema.js';
import { and, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SettingsRepository, SkillRepository, SkillUpdate } from '../../repositories.js';
import {
  assertSkillScopeConsistency,
  buildSkillUpdateValues,
  rowToSkill,
  skillToDbRow,
  type SkillDbRow,
} from './shared.js';

type Db = BetterSQLite3Database<typeof schema>;

export interface SkillsDrizzleRepos {
  skills: SkillRepository;
  settings: SettingsRepository;
}

export function createSkillsDrizzleRepos(db: Db): SkillsDrizzleRepos {
  const skills: SkillRepository = {
    async insert(row) {
      assertSkillScopeConsistency(row);
      db.insert(schema.skills)
        .values(skillToDbRow(row))
        .onConflictDoNothing({ target: schema.skills.skill_id })
        .run();
    },
    async update(skillId, patch: SkillUpdate) {
      const values = buildSkillUpdateValues(patch);
      if (Object.keys(values).length === 1) return;
      db.update(schema.skills).set(values).where(eq(schema.skills.skill_id, skillId)).run();
    },
    async delete(skillId) {
      db.delete(schema.skills).where(eq(schema.skills.skill_id, skillId)).run();
    },
    async findById(skillId) {
      const rows = db.select().from(schema.skills).where(eq(schema.skills.skill_id, skillId)).all();
      const first = rows[0] as SkillDbRow | undefined;
      return first ? rowToSkill(first) : null;
    },
    async listByCompany(companyId) {
      const rows = db.select().from(schema.skills).where(eq(schema.skills.company_id, companyId)).all();
      return rows.map((r) => rowToSkill(r as SkillDbRow));
    },
    async listByCompanyScope(companyId) {
      const rows = db
        .select()
        .from(schema.skills)
        .where(and(eq(schema.skills.company_id, companyId), isNull(schema.skills.employee_id)))
        .all();
      return rows.map((r) => rowToSkill(r as SkillDbRow));
    },
    async listByEmployee(companyId, employeeId) {
      const rows = db
        .select()
        .from(schema.skills)
        .where(
          and(eq(schema.skills.company_id, companyId), eq(schema.skills.employee_id, employeeId)),
        )
        .all();
      return rows.map((r) => rowToSkill(r as SkillDbRow));
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
      const rows = db.select().from(schema.skills).where(condition).all();
      const first = rows[0] as SkillDbRow | undefined;
      return first ? rowToSkill(first) : null;
    },
  };

  const settings: SettingsRepository = {
    async get(key) {
      const rows = db.select().from(schema.settings).where(eq(schema.settings.key, key)).all();
      const first = rows[0] as { value: string } | undefined;
      return first ? first.value : null;
    },
    async set(key, value) {
      db.insert(schema.settings)
        .values({ key, value, updated_at: Date.now() })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value, updated_at: Date.now() },
        })
        .run();
    },
  };

  return { skills, settings };
}
