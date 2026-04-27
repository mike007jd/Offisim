import type { SkillRow, SkillScope, SkillSourceKind } from '@offisim/shared-types';
import type { NewSkill, SkillUpdate } from '../../repositories.js';

/** Shape of a raw `skills` DB row as returned by drizzle / sqlite-proxy. */
export interface SkillDbRow {
  skill_id: string;
  company_id: string;
  employee_id: string | null;
  scope: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  source_kind: string;
  source_ref: string | null;
  vault_path: string;
  created_at: number;
  updated_at: number;
}

export function coerceSkillScope(value: string): SkillScope {
  return value === 'employee' ? 'employee' : 'company';
}

export function coerceSkillSourceKind(value: string): SkillSourceKind {
  if (
    value === 'installed' ||
    value === 'forked' ||
    value === 'synthesized' ||
    value === 'self-authored'
  ) {
    return value;
  }
  return 'authored';
}

export function rowToSkill(row: SkillDbRow): SkillRow {
  return {
    skill_id: row.skill_id,
    company_id: row.company_id,
    employee_id: row.employee_id,
    scope: coerceSkillScope(row.scope),
    slug: row.slug,
    name: row.name,
    description: row.description,
    version: row.version,
    source_kind: coerceSkillSourceKind(row.source_kind),
    source_ref: row.source_ref,
    vault_path: row.vault_path,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function assertSkillScopeConsistency(row: NewSkill): void {
  if (row.scope === 'company' && row.employee_id !== null) {
    throw new Error('skills: scope="company" requires employee_id=null');
  }
  if (row.scope === 'employee' && row.employee_id === null) {
    throw new Error('skills: scope="employee" requires a non-null employee_id');
  }
}

export function skillToDbRow(row: NewSkill): SkillDbRow {
  return {
    skill_id: row.skill_id,
    company_id: row.company_id,
    employee_id: row.employee_id,
    scope: row.scope,
    slug: row.slug,
    name: row.name,
    description: row.description,
    version: row.version,
    source_kind: row.source_kind,
    source_ref: row.source_ref,
    vault_path: row.vault_path,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

export function buildSkillUpdateValues(patch: SkillUpdate): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.version !== undefined) values.version = patch.version;
  if (patch.source_kind !== undefined) values.source_kind = patch.source_kind;
  if (patch.source_ref !== undefined) values.source_ref = patch.source_ref;
  if (patch.vault_path !== undefined) values.vault_path = patch.vault_path;
  values.updated_at = Number(patch.updated_at ?? Date.now());
  return values;
}
