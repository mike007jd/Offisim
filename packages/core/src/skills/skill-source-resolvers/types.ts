/**
 * Shared shapes for the four skill-install source resolvers. Each resolver
 * turns an external source (git URL, uploaded archive, local sync dir) into
 * a `VirtualTree` the scanner can walk, plus the source descriptor that will
 * eventually land in `skills.source_ref`.
 */

export interface VirtualFile {
  /** Path relative to the virtual root, using forward slashes. */
  path: string;
  content: Uint8Array;
}

export interface VirtualTree {
  files: VirtualFile[];
}

export interface ScannedSkill {
  /** Root-relative directory holding SKILL.md (empty string = tree root). */
  root: string;
  skillMdPath: string;
  assetPaths: string[];
}

export type SkillResolverErrorKind =
  | 'git-web-non-github'
  | 'git-fetch-failed'
  | 'git-ref-not-found'
  | 'github-rate-limited'
  | 'git-subpath-not-found'
  | 'upload-multiple-skills'
  | 'upload-no-skill-md'
  | 'upload-subpath-not-found'
  | 'upload-unsupported-format'
  | 'not-supported-in-web'
  | 'sync-too-many-candidates'
  | 'sync-empty'
  | 'skill-md-invalid'
  | 'skill-scanner-ambiguous'
  | 'skill-scanner-missing';

export interface SkillResolverError {
  kind: SkillResolverErrorKind;
  message: string;
  /** Original URL / filename / path that produced the error, when meaningful. */
  sourceRef?: string;
  /** For ambiguous / sync-overflow cases: the candidate list the LLM should pick from. */
  candidates?: ReadonlyArray<{ path: string; name?: string; description?: string }>;
  /** For github-rate-limited: epoch-ms when the limit resets. */
  resetAt?: number;
}

export function isResolverError(value: unknown): value is SkillResolverError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}
