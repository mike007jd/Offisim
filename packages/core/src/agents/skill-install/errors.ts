export const SKILL_INSTALL_ERROR_KINDS = [
  'missing-target-employee',
  'scope-target-conflict',
  'target-employee-not-found',
  'target-employee-ambiguous',
  'skill-install-not-configured',
  'skill-md-invalid',
  'skill-frontmatter-error',
  'skill-install-crashed',
  'missing-argument',
  'upload-not-available',
  'upload-ref-unknown',
  'skill-body-too-large',
  'target-employee-mismatch',
  'cross-employee-forbidden',
  'skill-not-found',
  'fork-parent-not-company',
  'invalid-new-body',
  'company-scope-forbidden',
  'not-skill-owner',
] as const;

export type SkillInstallErrorKind = (typeof SKILL_INSTALL_ERROR_KINDS)[number];

export interface SkillInstallStructuredError {
  readonly kind: SkillInstallErrorKind | string;
  readonly message: string;
  readonly [key: string]: unknown;
}
