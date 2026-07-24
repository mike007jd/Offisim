import { parseDocument } from '@offisim/core/browser';
import {
  type ComposerSkillReference,
  skillTokenIds,
  stripSkillTokens,
} from '../composer/composer-skill-reference-store.js';

export interface SkillOfficeInvocationDeps {
  readVaultFile: (vaultPath: string) => Promise<string>;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function frontmatterField(content: string, key: 'name' | 'description'): string | null {
  const parsed = parseDocument(content).frontmatter;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? oneLine(value) : null;
}

interface SkillInvocationIdentity {
  name: string;
  description: string;
}

/**
 * Name and description share one source priority: the live SKILL.md frontmatter
 * wins for vault skills, and the DB projection is the fallback for each field
 * independently. Both come from a single vault read so the two can never drift
 * across separate I/O attempts.
 */
async function invocationIdentity(
  deps: SkillOfficeInvocationDeps,
  reference: ComposerSkillReference,
): Promise<SkillInvocationIdentity> {
  const fallback: SkillInvocationIdentity = {
    name: oneLine(reference.name),
    description: oneLine(reference.description),
  };
  if (reference.source === 'project' || !reference.vault_path) return fallback;
  try {
    const content = await deps.readVaultFile(reference.vault_path);
    return {
      name: frontmatterField(content, 'name') ?? fallback.name,
      description: frontmatterField(content, 'description') ?? fallback.description,
    };
  } catch {
    // A stale/malformed vault index must not block Send. The DB projection is
    // intentionally the last-resort display identity; live verification exposes any
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
  const identities = await Promise.all(
    references.map((reference) => invocationIdentity(deps, reference)),
  );
  return identities.map((identity) => invocationLine(identity.name, identity.description));
}

export async function buildSkillOfficeInvocationText(
  deps: SkillOfficeInvocationDeps,
  references: readonly ComposerSkillReference[],
): Promise<string> {
  return (await buildSkillOfficeInvocationLines(deps, references)).join('\n');
}

export interface RestoreSkillInvocationDeps extends SkillOfficeInvocationDeps {
  /** Best-effort identity lookup for a persisted chip token; null degrades to a plain strip. */
  resolveReference: (skillId: string) => Promise<ComposerSkillReference | null>;
}

/**
 * Rebuild the engine-bound projection of a restored persisted text.
 *
 * Durable bodies keep only the protected `[[skill:id]]` tokens; the engine must
 * never see those raw tokens, so they are stripped and — when the skill identity
 * still resolves from skills data — replaced with the same explicit invocation
 * directives a fresh Send would have produced. Texts without tokens pass through
 * untouched (their whitespace is significant), and unresolvable ids degrade to a
 * plain strip rather than blocking the restored turn.
 */
export async function restoreSkillInvocationText(
  deps: RestoreSkillInvocationDeps,
  text: string,
): Promise<string> {
  const skillIds = skillTokenIds(text);
  if (skillIds.length === 0) return text;
  const stripped = stripSkillTokens(text);
  const references = (
    await Promise.all(skillIds.map((skillId) => deps.resolveReference(skillId).catch(() => null)))
  ).filter((reference): reference is ComposerSkillReference => reference !== null);
  if (references.length === 0) return stripped;
  const lines = await buildSkillOfficeInvocationLines(deps, references);
  return [stripped, ...lines].filter(Boolean).join('\n\n');
}
