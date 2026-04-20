export type SkillScope = 'company' | 'employee';

export type SkillSourceKind = 'authored' | 'installed' | 'forked' | 'synthesized';

export interface SkillMetadata {
  id: string;
  slug: string;
  name: string;
  description: string;
  scope: SkillScope;
  version: string;
}

export interface SkillRow {
  skill_id: string;
  company_id: string;
  employee_id: string | null;
  scope: SkillScope;
  slug: string;
  name: string;
  description: string;
  version: string;
  source_kind: SkillSourceKind;
  source_ref: string | null;
  vault_path: string;
  created_at: string;
  updated_at: string;
}

export type SkillMdParseErrorKind =
  | 'missing-frontmatter'
  | 'invalid-frontmatter-yaml'
  | 'missing-required-field'
  | 'private-namespace-forbidden'
  | 'invalid-field-type';

export class SkillMdParseError extends Error {
  readonly kind: SkillMdParseErrorKind;
  readonly field: string | undefined;

  constructor(kind: SkillMdParseErrorKind, message: string, field?: string) {
    super(message);
    this.name = 'SkillMdParseError';
    this.kind = kind;
    this.field = field;
  }
}

export type SkillAssetErrorKind =
  | 'path-traversal'
  | 'absolute-path-forbidden'
  | 'subtree-forbidden'
  | 'not-found';

export class SkillAssetError extends Error {
  readonly kind: SkillAssetErrorKind;
  readonly relPath: string;

  constructor(kind: SkillAssetErrorKind, message: string, relPath: string) {
    super(message);
    this.name = 'SkillAssetError';
    this.kind = kind;
    this.relPath = relPath;
  }
}

export type SkillEditErrorKind = 'skill-not-found' | 'skill-md-invalid' | 'version-bump-failed';

export class SkillEditError extends Error {
  readonly kind: SkillEditErrorKind;
  readonly skillId: string | undefined;

  constructor(kind: SkillEditErrorKind, message: string, skillId?: string) {
    super(message);
    this.name = 'SkillEditError';
    this.kind = kind;
    this.skillId = skillId;
  }
}
