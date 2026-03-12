/**
 * Types for OpenClaw SKILL.md parsing and integration.
 *
 * OpenClaw skills use YAML frontmatter + Markdown body.
 * Frontmatter fields: name, description, homepage, license,
 * user-invocable, allowed-tools, metadata (openclaw.emoji, openclaw.requires, openclaw.os).
 */

/** Parsed representation of an OpenClaw SKILL.md file. */
export interface ParsedSkill {
  /** Skill name (from frontmatter `name`). */
  readonly name: string;
  /** Short description (from frontmatter `description`). */
  readonly description: string;
  /** Full skill instructions (Markdown body, after frontmatter). */
  readonly instructions: string;
  /** System requirements extracted from metadata. */
  readonly requirements: SkillRequirements;
  /** Additional metadata. */
  readonly metadata: SkillMetadata;
}

export interface SkillRequirements {
  /** Required binaries (e.g. ["node", "git"]). */
  readonly bins?: readonly string[];
  /** Required environment variables (e.g. ["GITHUB_TOKEN"]). */
  readonly env?: readonly string[];
  /** Required config file paths. */
  readonly config?: readonly string[];
}

export interface SkillMetadata {
  /** Emoji identifier (from openclaw.emoji). */
  readonly emoji?: string;
  /** Homepage URL. */
  readonly homepage?: string;
  /** License string. */
  readonly license?: string;
  /** Supported OS list (e.g. ["linux", "macos"]). */
  readonly os?: readonly string[];
  /** Whether the skill is user-invocable (default: true). */
  readonly userInvocable?: boolean;
  /** Allowed tools list (from frontmatter). */
  readonly allowedTools?: readonly string[];
}

export interface SkillValidationIssue {
  readonly type: string;
  readonly detail: string;
  readonly severity: 'error' | 'warning';
}

/** Result of validating a skill's requirements. */
export interface SkillValidationResult {
  readonly valid: boolean;
  /** Hard errors that block installation */
  readonly errors: readonly SkillValidationIssue[];
  /** Soft warnings the user should review */
  readonly warnings: readonly SkillValidationIssue[];
}

/** @deprecated Use SkillValidationIssue instead */
export type SkillValidationWarning = SkillValidationIssue;
