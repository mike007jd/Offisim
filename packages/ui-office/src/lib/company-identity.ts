import type { RuntimeRepositories } from '@offisim/core/browser';

interface IdentityFields {
  name?: string;
  description?: string;
}

export function parseCompanyDescription(json: string | null | undefined): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return typeof parsed.description === 'string' ? parsed.description : '';
  } catch {
    return '';
  }
}

/**
 * Single SSOT for writing company identity (name + description) to the DB.
 *
 * Description is persisted inside `companies.default_model_policy_json` as
 * `JSON.stringify({ description })` — the column name is misleading but
 * intentionally not renamed (see `packages/core/CLAUDE.md`).
 *
 * Read-modify-write semantics: omitting a field preserves its current value.
 */
export async function updateCompanyIdentity(
  repos: RuntimeRepositories,
  companyId: string,
  fields: IdentityFields,
): Promise<void> {
  const current = await repos.companies.findById(companyId);
  if (!current) throw new Error(`Company ${companyId} not found`);

  const nextName = fields.name !== undefined ? fields.name : current.name;
  const currentDescription = parseCompanyDescription(current.default_model_policy_json);
  const nextDescription =
    fields.description !== undefined ? fields.description : currentDescription;

  await repos.companies.update(companyId, {
    name: nextName,
    default_model_policy_json: JSON.stringify({ description: nextDescription }),
  });
}
