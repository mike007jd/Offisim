import type { SkillScope } from '@offisim/shared-types';

export interface ResolveSkillPathArgs {
  companyId: string;
  scope: SkillScope;
  employeeSlug?: string | undefined;
  skillSlug: string;
}

export interface ResolvedSkillPath {
  /** Vault-relative directory holding SKILL.md and optional scripts/references/assets. */
  dir: string;
  /** Vault-relative path to the SKILL.md file. */
  skillMdPath: string;
  /**
   * Resolve a vault-relative path for a sibling file under the skill directory.
   * The caller is expected to have already validated relPath containment
   * (see `SkillLoader.loadSkillAsset`).
   */
  assetPathFor: (relPath: string) => string;
}

/**
 * Compute vault-relative paths for a skill directory. The vault filesystem
 * abstraction (desktop fs / web IndexedDB) keys entries by the same relative
 * path on both runtimes, so this helper returns a single shape rather than
 * branching per runtime.
 */
export function resolveSkillPath(args: ResolveSkillPathArgs): ResolvedSkillPath {
  if (args.scope === 'company') {
    const dir = `companies/${args.companyId}/skills/${args.skillSlug}`;
    return {
      dir,
      skillMdPath: `${dir}/SKILL.md`,
      assetPathFor: (relPath) => `${dir}/${relPath}`,
    };
  }
  if (!args.employeeSlug) {
    throw new Error('resolveSkillPath: scope="employee" requires employeeSlug');
  }
  const dir = `companies/${args.companyId}/employees/${args.employeeSlug}/skills/${args.skillSlug}`;
  return {
    dir,
    skillMdPath: `${dir}/SKILL.md`,
    assetPathFor: (relPath) => `${dir}/${relPath}`,
  };
}
