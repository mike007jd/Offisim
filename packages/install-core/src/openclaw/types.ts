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

export type SkillCapabilityKind = 'tool' | 'mcp' | 'binary' | 'env' | 'config';

export interface SkillCapabilityDescriptor {
  /** Capability bucket used to group the skill's loading requirements. */
  readonly kind: SkillCapabilityKind;
  /** Raw capability key, e.g. `git`, `GITHUB_TOKEN`, `Read`. */
  readonly key: string;
  /** Human-readable label shown in review UI. */
  readonly label: string;
}

export interface SkillCapabilityIndex {
  /** DeerFlow-style index-first loading mode. */
  readonly strategy: 'index-first';
  /** Full instruction body is deferred until activation. */
  readonly instructionMode: 'deferred';
  /** Short skill summary surfaced during review. */
  readonly summary: string;
  /** Truncated instruction preview for the install UI. */
  readonly instructionExcerpt: string;
  /** Full instruction length, useful for preview metadata. */
  readonly instructionLength: number;
  /** Declarative capabilities required by the skill. */
  readonly requiredCapabilities: readonly string[];
  /** Structured capability entries for UI and downstream runtime hooks. */
  readonly capabilities: readonly SkillCapabilityDescriptor[];
}

export interface RequiredMcp {
  readonly name: string;
  readonly description: string;
  readonly transport: 'stdio' | 'sse' | 'either';
  readonly registryUrl?: string;
}

export interface SkillRequirements {
  /** Required binaries (e.g. ["node", "git"]). */
  readonly bins?: readonly string[];
  /** Required environment variables (e.g. ["GITHUB_TOKEN"]). */
  readonly env?: readonly string[];
  /** Required config file paths. */
  readonly config?: readonly string[];
  /** Required MCP servers. */
  readonly mcps?: readonly RequiredMcp[];
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
  /** Index-first capability summary for progressive loading / review. */
  readonly capabilityIndex?: SkillCapabilityIndex;
}

/** @deprecated Use SkillValidationIssue instead */
export type SkillValidationWarning = SkillValidationIssue;
