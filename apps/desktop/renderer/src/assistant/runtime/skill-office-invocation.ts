import { parseDocument } from '@offisim/core/browser';
import type { ComposerSkillReference } from '../composer/composer-skill-reference-store.js';

export interface SkillOfficeInvocationDeps {
  readVaultFile: (vaultPath: string) => Promise<string>;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function frontmatterName(content: string): string | null {
  const parsed = parseDocument(content).frontmatter;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>).name;
  return typeof value === 'string' && value.trim() ? oneLine(value) : null;
}

async function invocationName(
  deps: SkillOfficeInvocationDeps,
  reference: ComposerSkillReference,
): Promise<string> {
  const fallback = oneLine(reference.name);
  if (reference.source === 'project' || !reference.vault_path) return fallback;
  try {
    return frontmatterName(await deps.readVaultFile(reference.vault_path)) ?? fallback;
  } catch {
    // A stale/malformed vault index must not block Send. The DB projection is
    // intentionally the last-resort display name; live verification exposes any
    // resulting discovery miss instead of hiding the turn behind an I/O error.
    return fallback;
  }
}

function invocationLine(name: string, description: string): string {
  return `Use the ${JSON.stringify(name)} skill for this task: locate it among your available skills, read its SKILL.md, and follow it. (${oneLine(description)})`;
}

/**
 * Resolve every selected chip into an engine-visible Agent Skill invocation.
 *
 * Vault skills are re-read at Send because their DB names are only projections
 * and may drift from the SKILL.md frontmatter identity used by every engine lane.
 * Project chips already come from a sandboxed SKILL.md scan, so their stored name
 * is the discovered frontmatter name and no second project read is needed.
 *
 * Promise.all preserves chip order. All I/O is injected, and a failed read/parse
 * falls back per chip rather than blocking the whole turn.
 */
export async function buildSkillOfficeInvocationLines(
  deps: SkillOfficeInvocationDeps,
  references: readonly ComposerSkillReference[],
): Promise<string[]> {
  const names = await Promise.all(references.map((reference) => invocationName(deps, reference)));
  return references.map((reference, index) =>
    invocationLine(names[index] ?? oneLine(reference.name), reference.description),
  );
}

export async function buildSkillOfficeInvocationText(
  deps: SkillOfficeInvocationDeps,
  references: readonly ComposerSkillReference[],
): Promise<string> {
  return (await buildSkillOfficeInvocationLines(deps, references)).join('\n');
}
