# Phase 7C: OpenClaw Local Skill Import — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Let users drag-and-drop an OpenClaw `SKILL.md` file into AICS — parse it, validate requirements, review in the install dialog, and materialize a new employee whose persona is the skill's instructions.

**Architecture:** New `openclaw/` sub-module inside `packages/install-core` handles parsing + validation + manifest synthesis. A new `importSkill()` method on `InstallService` orchestrates the flow, reusing the existing state machine, compatibility checks, and materializer. The web layer extends `FileImportTrigger` to accept `.md` files and `useInstallFlow` to route skill imports through a skill-specific review step.

**Tech Stack:** gray-matter (YAML frontmatter parser), existing install-core state machine + materializer, React

---

## Dependency Graph

```
Task 1: gray-matter dep + ParsedSkill type
  └─► Task 2: skill-parser.ts (parse SKILL.md → ParsedSkill)
        └─► Task 3: skill-validator.ts (check requirements)
              └─► Task 4: skill-to-manifest.ts (ParsedSkill → synthetic PackageManifest)
                    └─► Task 5: importSkill() on InstallService
                          └─► Task 6: Web UI — FileImportTrigger + useInstallFlow + SkillReview
                                └─► Task 7: Integration test (full flow)
                                      └─► Task 8: Verification + polish
```

Tasks are sequential because each builds on the previous. No parallelism.

---

## Task 1: Bootstrap — gray-matter + ParsedSkill Type

**Files:**
- Modify: `packages/install-core/package.json`
- Create: `packages/install-core/src/openclaw/types.ts`
- Create: `packages/install-core/src/openclaw/index.ts`

**Step 1: Install gray-matter**

```bash
pnpm --filter @aics/install-core add gray-matter
```

**Step 2: Create the ParsedSkill type**

Create `packages/install-core/src/openclaw/types.ts`:

```typescript
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

/** Result of validating a skill's requirements. */
export interface SkillValidationResult {
  readonly valid: boolean;
  readonly warnings: readonly SkillValidationWarning[];
}

export interface SkillValidationWarning {
  readonly type: 'missing_bin' | 'missing_env' | 'missing_config' | 'unsupported_os';
  readonly detail: string;
}
```

**Step 3: Create barrel export**

Create `packages/install-core/src/openclaw/index.ts`:

```typescript
export type {
  ParsedSkill,
  SkillRequirements,
  SkillMetadata,
  SkillValidationResult,
  SkillValidationWarning,
} from './types.js';
```

**Step 4: Verify**

```bash
pnpm --filter @aics/install-core typecheck
```

**Step 5: Commit**

```bash
git add packages/install-core/package.json packages/install-core/src/openclaw/ pnpm-lock.yaml
git commit -m "feat(install-core): bootstrap OpenClaw skill types + gray-matter dep"
```

---

## Task 2: Skill Parser — Parse SKILL.md to ParsedSkill

**Files:**
- Create: `packages/install-core/src/openclaw/skill-parser.ts`
- Create: `packages/install-core/src/openclaw/__tests__/skill-parser.test.ts`

**Context:**
OpenClaw SKILL.md format uses YAML frontmatter (--- delimited) followed by Markdown body. Example:

```markdown
---
name: code-reviewer
description: Reviews code for bugs and style issues
metadata:
  openclaw.emoji: 🔍
  openclaw.requires:
    bins:
      - git
    env:
      - GITHUB_TOKEN
  openclaw.os:
    - linux
    - macos
---

You are a code review expert. Review the following code...
```

gray-matter handles the frontmatter extraction. We need to normalize the metadata structure (OpenClaw uses dot-separated keys or nested YAML).

**Step 1: Write the failing test**

Create `packages/install-core/src/openclaw/__tests__/skill-parser.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseSkill, SkillParseError } from '../skill-parser.js';

const MINIMAL_SKILL = `---
name: test-skill
description: A test skill
---

You are a test assistant.`;

const FULL_SKILL = `---
name: code-reviewer
description: Reviews code for bugs and style issues
homepage: https://example.com/code-reviewer
license: MIT
user-invocable: true
allowed-tools:
  - Read
  - Grep
  - Bash
metadata:
  openclaw.emoji: "🔍"
  openclaw.requires:
    bins:
      - git
      - node
    env:
      - GITHUB_TOKEN
    config:
      - ~/.gitconfig
  openclaw.os:
    - linux
    - macos
---

You are a code review expert.

## Guidelines
- Check for bugs
- Check for style issues
`;

describe('parseSkill', () => {
  it('parses minimal SKILL.md with name + description + body', () => {
    const skill = parseSkill(MINIMAL_SKILL);
    expect(skill.name).toBe('test-skill');
    expect(skill.description).toBe('A test skill');
    expect(skill.instructions).toContain('You are a test assistant.');
    expect(skill.requirements.bins).toBeUndefined();
    expect(skill.metadata.emoji).toBeUndefined();
  });

  it('parses full SKILL.md with all metadata fields', () => {
    const skill = parseSkill(FULL_SKILL);
    expect(skill.name).toBe('code-reviewer');
    expect(skill.description).toBe('Reviews code for bugs and style issues');
    expect(skill.instructions).toContain('code review expert');
    expect(skill.instructions).toContain('## Guidelines');
    expect(skill.requirements.bins).toEqual(['git', 'node']);
    expect(skill.requirements.env).toEqual(['GITHUB_TOKEN']);
    expect(skill.requirements.config).toEqual(['~/.gitconfig']);
    expect(skill.metadata.emoji).toBe('🔍');
    expect(skill.metadata.homepage).toBe('https://example.com/code-reviewer');
    expect(skill.metadata.license).toBe('MIT');
    expect(skill.metadata.os).toEqual(['linux', 'macos']);
    expect(skill.metadata.userInvocable).toBe(true);
    expect(skill.metadata.allowedTools).toEqual(['Read', 'Grep', 'Bash']);
  });

  it('handles metadata as single-line JSON (openclaw alternate format)', () => {
    const md = `---
name: json-meta
description: test
metadata: '{"openclaw.emoji":"🦞","openclaw.requires":{"bins":["curl"]}}'
---
body`;
    const skill = parseSkill(md);
    expect(skill.metadata.emoji).toBe('🦞');
    expect(skill.requirements.bins).toEqual(['curl']);
  });

  it('throws SkillParseError when no frontmatter', () => {
    expect(() => parseSkill('Just some markdown')).toThrow(SkillParseError);
  });

  it('throws SkillParseError when name is missing', () => {
    const md = `---
description: no name
---
body`;
    expect(() => parseSkill(md)).toThrow(SkillParseError);
  });

  it('throws SkillParseError when description is missing', () => {
    const md = `---
name: no-desc
---
body`;
    expect(() => parseSkill(md)).toThrow(SkillParseError);
  });

  it('trims whitespace from instructions body', () => {
    const md = `---
name: trim-test
description: test
---


  Body with leading/trailing whitespace.

`;
    const skill = parseSkill(md);
    expect(skill.instructions).toBe('Body with leading/trailing whitespace.');
  });

  it('handles empty body gracefully', () => {
    const md = `---
name: empty-body
description: test
---
`;
    const skill = parseSkill(md);
    expect(skill.instructions).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @aics/install-core test -- src/openclaw/__tests__/skill-parser.test.ts
```

Expected: FAIL — `skill-parser.js` not found.

**Step 3: Write the implementation**

Create `packages/install-core/src/openclaw/skill-parser.ts`:

```typescript
/**
 * Skill parser — parse OpenClaw SKILL.md format.
 *
 * Uses gray-matter for YAML frontmatter extraction.
 * Normalizes OpenClaw's dot-separated metadata keys into structured types.
 */

import matter from 'gray-matter';
import type { ParsedSkill, SkillMetadata, SkillRequirements } from './types.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SkillParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SkillParseError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * OpenClaw metadata can be:
 * 1. Nested YAML object: { "openclaw.emoji": "🦞", "openclaw.requires": {...} }
 * 2. Single-line JSON string: '{"openclaw.emoji":"🦞",...}'
 *
 * Normalize to a plain object either way.
 */
function parseMetadataField(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    } catch {
      // Not JSON — ignore
    }
    return {};
  }

  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function extractRequirements(meta: Record<string, unknown>): SkillRequirements {
  const requires = meta['openclaw.requires'] as Record<string, unknown> | undefined;
  if (!requires || typeof requires !== 'object') return {};

  return {
    bins: Array.isArray(requires.bins)
      ? requires.bins.filter((b): b is string => typeof b === 'string')
      : undefined,
    env: Array.isArray(requires.env)
      ? requires.env.filter((e): e is string => typeof e === 'string')
      : undefined,
    config: Array.isArray(requires.config)
      ? requires.config.filter((c): c is string => typeof c === 'string')
      : undefined,
  };
}

function extractMetadata(
  frontmatter: Record<string, unknown>,
  meta: Record<string, unknown>,
): SkillMetadata {
  const os = meta['openclaw.os'];

  return {
    emoji: typeof meta['openclaw.emoji'] === 'string' ? meta['openclaw.emoji'] : undefined,
    homepage: typeof frontmatter.homepage === 'string' ? frontmatter.homepage : undefined,
    license: typeof frontmatter.license === 'string' ? frontmatter.license : undefined,
    os: Array.isArray(os) ? os.filter((o): o is string => typeof o === 'string') : undefined,
    userInvocable:
      typeof frontmatter['user-invocable'] === 'boolean'
        ? frontmatter['user-invocable']
        : undefined,
    allowedTools: Array.isArray(frontmatter['allowed-tools'])
      ? frontmatter['allowed-tools'].filter((t): t is string => typeof t === 'string')
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an OpenClaw SKILL.md string into a structured ParsedSkill.
 *
 * @param content - Full content of a SKILL.md file (YAML frontmatter + Markdown body).
 * @returns ParsedSkill with name, description, instructions, requirements, metadata.
 * @throws {SkillParseError} If frontmatter is missing or required fields absent.
 */
export function parseSkill(content: string): ParsedSkill {
  // 1. Extract frontmatter
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch (err) {
    throw new SkillParseError(
      'parse_failed',
      `Failed to parse SKILL.md frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = parsed.data as Record<string, unknown>;

  // Check if there actually was frontmatter (gray-matter returns empty data for plain markdown)
  if (!data || Object.keys(data).length === 0) {
    throw new SkillParseError('no_frontmatter', 'SKILL.md must contain YAML frontmatter (--- delimited)');
  }

  // 2. Validate required fields
  if (typeof data.name !== 'string' || !data.name.trim()) {
    throw new SkillParseError('missing_name', 'SKILL.md frontmatter must include a "name" field');
  }

  if (typeof data.description !== 'string' || !data.description.trim()) {
    throw new SkillParseError(
      'missing_description',
      'SKILL.md frontmatter must include a "description" field',
    );
  }

  // 3. Parse metadata
  const meta = parseMetadataField(data.metadata);

  // 4. Build result
  return {
    name: data.name.trim(),
    description: data.description.trim(),
    instructions: parsed.content.trim(),
    requirements: extractRequirements(meta),
    metadata: extractMetadata(data, meta),
  };
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @aics/install-core test -- src/openclaw/__tests__/skill-parser.test.ts
```

Expected: all tests PASS.

**Step 5: Export from openclaw/index.ts and install-core/index.ts**

Update `packages/install-core/src/openclaw/index.ts` to add:
```typescript
export { parseSkill, SkillParseError } from './skill-parser.js';
```

Update `packages/install-core/src/index.ts` to add:
```typescript
// OpenClaw skill integration
export { parseSkill, SkillParseError } from './openclaw/index.js';
export type {
  ParsedSkill,
  SkillRequirements,
  SkillMetadata,
  SkillValidationResult,
  SkillValidationWarning,
} from './openclaw/index.js';
```

**Step 6: Typecheck + commit**

```bash
pnpm --filter @aics/install-core typecheck && pnpm --filter @aics/install-core build
git add packages/install-core/src/openclaw/ packages/install-core/src/index.ts
git commit -m "feat(install-core): skill-parser — parse OpenClaw SKILL.md frontmatter + body"
```

---

## Task 3: Skill Validator — Check Requirements Against Environment

**Files:**
- Create: `packages/install-core/src/openclaw/skill-validator.ts`
- Create: `packages/install-core/src/openclaw/__tests__/skill-validator.test.ts`

**Context:**
This is a soft validator — it warns about missing requirements but doesn't hard-fail the install. The user can choose to proceed. MVP: check OS compatibility only (browser environment can't detect bins/env). Requirements info is displayed in the review step.

**Step 1: Write the failing test**

Create `packages/install-core/src/openclaw/__tests__/skill-validator.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { validateSkill } from '../skill-validator.js';
import type { ParsedSkill } from '../types.js';

function makeSkill(overrides: Partial<ParsedSkill> = {}): ParsedSkill {
  return {
    name: 'test-skill',
    description: 'test',
    instructions: 'do things',
    requirements: {},
    metadata: {},
    ...overrides,
  };
}

describe('validateSkill', () => {
  it('returns valid with no warnings for a skill with no requirements', () => {
    const result = validateSkill(makeSkill(), 'web_limited');
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns about required binaries (browser cannot check)', () => {
    const result = validateSkill(
      makeSkill({ requirements: { bins: ['git', 'node'] } }),
      'web_limited',
    );
    expect(result.valid).toBe(true); // warnings, not failures
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]!.type).toBe('missing_bin');
    expect(result.warnings[0]!.detail).toContain('git');
  });

  it('warns about required env vars (browser cannot check)', () => {
    const result = validateSkill(
      makeSkill({ requirements: { env: ['GITHUB_TOKEN'] } }),
      'web_limited',
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.type).toBe('missing_env');
  });

  it('warns about unsupported OS when environment does not match', () => {
    const result = validateSkill(
      makeSkill({ metadata: { os: ['linux'] } }),
      'web_limited',
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.type).toBe('unsupported_os');
  });

  it('no OS warning when os list is empty', () => {
    const result = validateSkill(
      makeSkill({ metadata: { os: [] } }),
      'web_limited',
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('no OS warning in desktop environment (assumes correct OS)', () => {
    const result = validateSkill(
      makeSkill({ metadata: { os: ['linux', 'macos'] } }),
      'desktop',
    );
    // Desktop assumes OS matches — no warning
    expect(result.warnings.filter(w => w.type === 'unsupported_os')).toHaveLength(0);
  });

  it('accumulates all warnings from multiple requirement types', () => {
    const result = validateSkill(
      makeSkill({
        requirements: { bins: ['git'], env: ['TOKEN'], config: ['~/.rc'] },
        metadata: { os: ['linux'] },
      }),
      'web_limited',
    );
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @aics/install-core test -- src/openclaw/__tests__/skill-validator.test.ts
```

**Step 3: Write the implementation**

Create `packages/install-core/src/openclaw/skill-validator.ts`:

```typescript
/**
 * Skill validator — check OpenClaw skill requirements against the runtime environment.
 *
 * MVP scope: Soft validation only (warnings, not hard failures).
 * Browser environment can't actually check for installed binaries or env vars,
 * so we emit warnings. Desktop mode assumes OS matches.
 */

import type { SupportedEnvironment } from '@aics/asset-schema';
import type { ParsedSkill, SkillValidationResult, SkillValidationWarning } from './types.js';

/**
 * Validate a parsed skill's requirements against the current environment.
 *
 * Returns warnings (not errors) — the user decides whether to proceed.
 * In browser mode, bin/env/config checks always warn (can't verify).
 * In desktop mode, OS check passes (assumes correct OS), bin/env/config still warn.
 *
 * @param skill - The parsed skill to validate.
 * @param environment - Current runtime environment type.
 * @returns SkillValidationResult with warnings.
 */
export function validateSkill(
  skill: ParsedSkill,
  environment: SupportedEnvironment,
): SkillValidationResult {
  const warnings: SkillValidationWarning[] = [];

  // Check required binaries
  if (skill.requirements.bins) {
    for (const bin of skill.requirements.bins) {
      warnings.push({
        type: 'missing_bin',
        detail: `Skill requires binary "${bin}" — cannot verify in ${environment} environment`,
      });
    }
  }

  // Check required env vars
  if (skill.requirements.env) {
    for (const envVar of skill.requirements.env) {
      warnings.push({
        type: 'missing_env',
        detail: `Skill requires environment variable "${envVar}" — cannot verify in ${environment} environment`,
      });
    }
  }

  // Check required config files
  if (skill.requirements.config) {
    for (const configPath of skill.requirements.config) {
      warnings.push({
        type: 'missing_config',
        detail: `Skill requires config file "${configPath}" — cannot verify in ${environment} environment`,
      });
    }
  }

  // Check OS compatibility (only in non-desktop environments)
  if (skill.metadata.os && skill.metadata.os.length > 0 && environment !== 'desktop') {
    warnings.push({
      type: 'unsupported_os',
      detail: `Skill targets OS: ${skill.metadata.os.join(', ')}. Running in ${environment} — OS compatibility unverified.`,
    });
  }

  return { valid: true, warnings };
}
```

**Step 4: Run test, update exports, typecheck, commit**

```bash
pnpm --filter @aics/install-core test -- src/openclaw/__tests__/skill-validator.test.ts
```

Update `openclaw/index.ts`:
```typescript
export { validateSkill } from './skill-validator.js';
```

Update `install-core/src/index.ts`:
```typescript
export { validateSkill } from './openclaw/index.js';
```

```bash
pnpm --filter @aics/install-core typecheck && pnpm --filter @aics/install-core build
git add packages/install-core/src/openclaw/
git commit -m "feat(install-core): skill-validator — soft requirement checking for OpenClaw skills"
```

---

## Task 4: Skill-to-Manifest — Synthesize PackageManifest from ParsedSkill

**Files:**
- Create: `packages/install-core/src/openclaw/skill-to-manifest.ts`
- Create: `packages/install-core/src/openclaw/__tests__/skill-to-manifest.test.ts`

**Context:**
The existing materializer expects a `PackageManifest` (from `@aics/asset-schema`). We need to convert a `ParsedSkill` into a synthetic `PackageManifest` so the materializer can create an employee. Key decisions:
- `package.kind`: `'employee'` (skill imported as employee)
- `package.id`: derive from skill name (slugified)
- `assets`: one employee asset per skill
- `permissions`: data_asset / none / none (local skill, no special perms)
- `integrity`: zeros (no archive, synthetic package)

**Step 1: Write the failing test**

Create `packages/install-core/src/openclaw/__tests__/skill-to-manifest.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { skillToManifest } from '../skill-to-manifest.js';
import type { ParsedSkill } from '../types.js';

const SKILL: ParsedSkill = {
  name: 'code-reviewer',
  description: 'Reviews code for bugs and style issues',
  instructions: 'You are a code review expert.\n\n## Guidelines\n- Check for bugs',
  requirements: { bins: ['git'], env: ['GITHUB_TOKEN'] },
  metadata: {
    emoji: '🔍',
    homepage: 'https://example.com',
    license: 'MIT',
    os: ['linux', 'macos'],
    userInvocable: true,
    allowedTools: ['Read', 'Grep'],
  },
};

describe('skillToManifest', () => {
  it('produces a valid PackageManifest shape', () => {
    const manifest = skillToManifest(SKILL);
    expect(manifest.spec_version).toBe('1.0.0');
    expect(manifest.package.kind).toBe('employee');
    expect(manifest.package.title).toBe('code-reviewer');
    expect(manifest.package.id).toMatch(/^openclaw-skill-/);
    expect(manifest.package.version).toBe('0.0.0-local');
    expect(manifest.package.license).toBe('MIT');
  });

  it('creates one employee asset with the skill as entrypoint', () => {
    const manifest = skillToManifest(SKILL);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]!.kind).toBe('employee');
    expect(manifest.assets[0]!.asset_id).toContain('code-reviewer');
    expect(manifest.assets[0]!.default_enabled).toBe(true);
  });

  it('stores skill instructions in custom.openclaw_instructions', () => {
    const manifest = skillToManifest(SKILL);
    expect(manifest.custom?.openclaw_instructions).toBe(SKILL.instructions);
  });

  it('stores skill metadata in custom.openclaw_metadata', () => {
    const manifest = skillToManifest(SKILL);
    expect(manifest.custom?.openclaw_emoji).toBe('🔍');
    expect(manifest.custom?.openclaw_homepage).toBe('https://example.com');
  });

  it('sets data_asset risk class and no permissions', () => {
    const manifest = skillToManifest(SKILL);
    expect(manifest.permissions.risk_class).toBe('data_asset');
    expect(manifest.permissions.network_scope).toBe('none');
    expect(manifest.permissions.filesystem_scope).toBe('none');
    expect(manifest.permissions.declares_secrets).toBe(false);
  });

  it('creates synthetic integrity hashes (all zeros)', () => {
    const manifest = skillToManifest(SKILL);
    expect(manifest.integrity.package_sha256).toMatch(/^0+$/);
  });

  it('defaults license to "UNLICENSED" when not specified', () => {
    const noLicense: ParsedSkill = { ...SKILL, metadata: { ...SKILL.metadata, license: undefined } };
    const manifest = skillToManifest(noLicense);
    expect(manifest.package.license).toBe('UNLICENSED');
  });

  it('sets summary from skill description', () => {
    const manifest = skillToManifest(SKILL);
    expect(manifest.package.summary).toBe('Reviews code for bugs and style issues');
  });

  it('generates unique package IDs for different skill names', () => {
    const m1 = skillToManifest(SKILL);
    const m2 = skillToManifest({ ...SKILL, name: 'other-skill' });
    expect(m1.package.id).not.toBe(m2.package.id);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Write the implementation**

Create `packages/install-core/src/openclaw/skill-to-manifest.ts`:

```typescript
/**
 * Skill-to-manifest — convert a ParsedSkill to a synthetic PackageManifest.
 *
 * The materializer operates on PackageManifest, so we need to wrap
 * the skill's data into that shape. The resulting manifest is synthetic
 * (never existed as a ZIP archive, has zero integrity hashes).
 */

import type { PackageManifest } from '@aics/asset-schema';
import type { ParsedSkill } from './types.js';

/**
 * Slugify a skill name into a safe package/asset ID component.
 * E.g. "Code Reviewer!" → "code-reviewer"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** All-zeros SHA-256 placeholder for synthetic packages. */
const ZERO_HASH = '0'.repeat(64);

/**
 * Convert a ParsedSkill into a synthetic PackageManifest suitable for
 * the install-core materializer.
 *
 * Key decisions:
 * - package.kind = 'employee' (skill becomes an employee)
 * - package.id = 'openclaw-skill-{slug}' (prefixed to avoid collisions)
 * - permissions = data_asset / none / none (local skill, minimal perms)
 * - instructions stored in manifest.custom.openclaw_instructions
 * - integrity = zero hashes (synthetic, no archive)
 *
 * @param skill - Parsed OpenClaw skill.
 * @returns Synthetic PackageManifest.
 */
export function skillToManifest(skill: ParsedSkill): PackageManifest {
  const slug = slugify(skill.name);
  const packageId = `openclaw-skill-${slug}`;
  const assetId = `skill-${slug}`;

  return {
    spec_version: '1.0.0',
    package: {
      id: packageId,
      kind: 'employee',
      version: '0.0.0-local',
      title: skill.name,
      summary: skill.description,
      license: skill.metadata.license ?? 'UNLICENSED',
      tags: ['openclaw', 'skill', 'local-import'],
    },
    compatibility: {
      runtime_range: '>=0.1.0 <2.0.0',
      schema_version: '2026-03',
      supported_environments: ['desktop', 'web_limited'],
    },
    requirements: {
      required_capabilities: [],
      required_mcps: [],
    },
    permissions: {
      risk_class: 'data_asset',
      declares_secrets: false,
      filesystem_scope: 'none',
      network_scope: 'none',
    },
    assets: [
      {
        asset_id: assetId,
        kind: 'employee',
        path: 'SKILL.md',
        default_enabled: true,
      },
    ],
    integrity: {
      package_sha256: ZERO_HASH,
    },
    custom: {
      openclaw_source: 'local_import',
      openclaw_instructions: skill.instructions,
      openclaw_emoji: skill.metadata.emoji,
      openclaw_homepage: skill.metadata.homepage,
      openclaw_requirements: skill.requirements,
      openclaw_allowed_tools: skill.metadata.allowedTools,
    },
  };
}
```

**Step 4: Run test, update exports, typecheck, commit**

Update `openclaw/index.ts`:
```typescript
export { skillToManifest } from './skill-to-manifest.js';
```

Update `install-core/src/index.ts`:
```typescript
export { skillToManifest } from './openclaw/index.js';
```

```bash
pnpm --filter @aics/install-core test -- src/openclaw/__tests__/skill-to-manifest.test.ts
pnpm --filter @aics/install-core typecheck && pnpm --filter @aics/install-core build
git add packages/install-core/src/
git commit -m "feat(install-core): skill-to-manifest — synthesize PackageManifest from OpenClaw skill"
```

---

## Task 5: InstallService.importSkill() — New Entry Point

**Files:**
- Modify: `packages/install-core/src/install-service.ts`
- Create: `packages/install-core/src/openclaw/__tests__/import-skill.test.ts`

**Context:**
`importSkill()` is a parallel entry point to `importFile()`. Instead of extracting a ZIP, it:
1. Parses SKILL.md content → ParsedSkill
2. Validates requirements → SkillValidationResult
3. Converts to synthetic PackageManifest via skillToManifest()
4. Runs compatibility check (reuse existing)
5. Resolves bindings (reuse existing — will return empty for most skills)
6. Creates an InstallPlan (manually, bypassing extractPackage/integrity)
7. Follows the same state machine path as importFile from there

The result goes into the same planCache and confirmBindings() works unchanged.

**Step 1: Write the failing test**

Create `packages/install-core/src/openclaw/__tests__/import-skill.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { InstallService } from '../../install-service.js';
import type { InstallServiceDeps } from '../../install-service.js';
import type { InstallRepositories, InstallEventEmitter } from '../../types.js';
import type { SkillValidationResult } from '../types.js';

// --- Mock repos (same pattern as install-service.test.ts) ---
function createMockRepos(): InstallRepositories {
  const txns = new Map<string, any>();
  const pkgs: any[] = [];
  const assets: any[] = [];
  const bindings: any[] = [];
  const employees: any[] = [];

  return {
    installTransactions: {
      async create(txn) { txns.set(txn.install_txn_id, { ...txn, finished_at: null }); return txns.get(txn.install_txn_id)!; },
      async findById(id) { return txns.get(id) ?? null; },
      async updateState(id, state, errorCode?, errorDetail?) {
        const t = txns.get(id); if (t) { t.state = state; t.error_code = errorCode ?? null; t.error_detail = errorDetail ?? null; }
      },
      async finish(id, state) { const t = txns.get(id); if (t) { t.state = state; t.finished_at = new Date().toISOString(); } },
    },
    installedPackages: {
      async create(pkg) { pkgs.push(pkg); return pkg; },
      async findByPackageId(_cid, pid) { return pkgs.filter(p => p.package_id === pid); },
    },
    installedAssets: { async create(a) { assets.push(a); return a; } },
    assetBindings: {
      async create(b) { bindings.push(b); return b; },
      async findByTransaction(txnId) { return bindings.filter(b => b.install_txn_id === txnId); },
      async updateStatus(id, status, valueJson?) { const b = bindings.find(x => x.binding_id === id); if (b) { (b as any).status = status; } },
    },
    employees: {
      async create(emp) { const id = `emp-${Date.now()}`; employees.push({ ...emp, employee_id: id }); return { employee_id: id }; },
    },
  };
}

function createMockEvents(): InstallEventEmitter & { events: any[] } {
  const events: any[] = [];
  return {
    events,
    emitInstallState(companyId, txnId, prev, next, packageId?, errorCode?) {
      events.push({ type: 'install', companyId, txnId, prev, next, packageId, errorCode });
    },
    emitBindingState(companyId, bindingId, txnId, type, key, prev, next) {
      events.push({ type: 'binding', companyId, bindingId, txnId, btype: type, key, prev, next });
    },
  };
}

const SKILL_MD = `---
name: test-coder
description: A test coding assistant
license: MIT
---

You are a coding assistant. Write clean code.
`;

const SKILL_MD_NO_FRONTMATTER = `Just plain markdown without frontmatter`;

describe('InstallService.importSkill', () => {
  let service: InstallService;
  let repos: InstallRepositories;
  let events: ReturnType<typeof createMockEvents>;

  beforeEach(() => {
    InstallService._clearPlanCache();
    repos = createMockRepos();
    events = createMockEvents();
    service = new InstallService({
      repos,
      events,
      companyId: 'company-001',
      environment: { runtimeVersion: '0.1.0', environment: 'desktop', schemaVersion: '2026-03' },
    });
  });

  it('imports a valid SKILL.md and produces a plan', async () => {
    const result = await service.importSkill(SKILL_MD);
    expect(result.error).toBeUndefined();
    expect(result.plan).toBeDefined();
    expect(result.plan!.manifest.package.title).toBe('test-coder');
    expect(result.plan!.manifest.package.kind).toBe('employee');
    expect(result.installTxnId).toBeTruthy();
  });

  it('stores skill validation warnings on the result', async () => {
    const result = await service.importSkill(SKILL_MD);
    expect(result.skillValidation).toBeDefined();
    expect(result.skillValidation!.valid).toBe(true);
  });

  it('full flow: importSkill → confirmBindings → employee created', async () => {
    const importResult = await service.importSkill(SKILL_MD);
    expect(importResult.plan).toBeDefined();

    const materializeResult = await service.confirmBindings(importResult.installTxnId, []);
    expect(materializeResult.employeeIds).toHaveLength(1);
    expect(materializeResult.installedPackageId).toBeTruthy();
  });

  it('returns error for invalid SKILL.md (no frontmatter)', async () => {
    const result = await service.importSkill(SKILL_MD_NO_FRONTMATTER);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('frontmatter');
    expect(result.plan).toBeUndefined();
  });

  it('stores instructions in custom.openclaw_instructions on the manifest', async () => {
    const result = await service.importSkill(SKILL_MD);
    expect(result.plan!.manifest.custom?.openclaw_instructions).toContain('coding assistant');
  });

  it('creates employee with persona_json containing skill instructions', async () => {
    const importResult = await service.importSkill(SKILL_MD);
    const materializeResult = await service.confirmBindings(importResult.installTxnId, []);
    // Verify the employee was created (materializer uses manifest.package.title as name)
    expect(materializeResult.employeeIds.length).toBe(1);
  });

  it('emits state change events through the full flow', async () => {
    const importResult = await service.importSkill(SKILL_MD);
    await service.confirmBindings(importResult.installTxnId, []);

    const installEvents = events.events.filter(e => e.type === 'install');
    const states = installEvents.map(e => `${e.prev}->${e.next}`);
    expect(states).toContain('created->manifest_loaded');
    expect(states).toContain('materializing->installed');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @aics/install-core test -- src/openclaw/__tests__/import-skill.test.ts
```

Expected: FAIL — `service.importSkill` is not a function.

**Step 3: Write the implementation**

Modify `packages/install-core/src/install-service.ts`:

Add imports at top:
```typescript
import { parseSkill, SkillParseError } from './openclaw/skill-parser.js';
import { validateSkill } from './openclaw/skill-validator.js';
import { skillToManifest } from './openclaw/skill-to-manifest.js';
import type { SkillValidationResult } from './openclaw/types.js';
import { checkCompatibility } from './compatibility-checker.js';
import { resolveBindings } from './binding-resolver.js';
```

Add new result type:
```typescript
export interface SkillImportResult {
  readonly installTxnId: string;
  readonly plan?: InstallPlan;
  readonly skillValidation?: SkillValidationResult;
  readonly error?: string;
}
```

Add `importSkill()` method to the `InstallService` class:

```typescript
/**
 * Import an OpenClaw SKILL.md and run the pre-install pipeline.
 *
 * Unlike importFile (which extracts a ZIP archive), importSkill:
 * 1. Parses SKILL.md YAML frontmatter + body
 * 2. Validates requirements against environment (soft check)
 * 3. Synthesizes a PackageManifest from the skill
 * 4. Runs compatibility check + binding resolution
 * 5. Follows the same state machine path as importFile
 *
 * @param content - Raw content of a SKILL.md file.
 * @returns SkillImportResult with txnId, plan, validation, or error.
 */
async importSkill(content: string): Promise<SkillImportResult> {
  // 1. Create transaction row
  const installTxnId = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();

  const txnRow: Omit<InstallTransactionRow, 'finished_at'> = {
    install_txn_id: installTxnId,
    company_id: this.companyId,
    source_type: 'file',
    source_ref: 'openclaw-skill',
    target_package_id: null,
    target_version: null,
    state: 'created',
    error_code: null,
    error_detail: null,
    descriptor_json: null,
    actor_type: 'user',
    started_at: now,
  };

  await this.repos.installTransactions.create(txnRow);

  // 2. Parse SKILL.md
  let skill;
  try {
    skill = parseSkill(content);
  } catch (err) {
    const msg = err instanceof SkillParseError ? err.message : String(err);
    await this.transitionToFailed(installTxnId, 'created', 'skill_parse_failed', msg);
    await this.repos.installTransactions.finish(installTxnId, 'failed');
    return { installTxnId, error: msg };
  }

  // 3. Validate requirements (soft check — warnings only)
  const skillValidation = validateSkill(skill, this.environment.environment);

  // 4. Synthesize PackageManifest
  const manifest = skillToManifest(skill);

  // 5. Transition: created -> manifest_loaded (skill parse = manifest load)
  await this.transition(installTxnId, 'created', 'manifest_loaded');

  // 6. Skip integrity check (synthetic package — no archive)
  //    Transition: manifest_loaded -> integrity_checked
  await this.transition(installTxnId, 'manifest_loaded', 'integrity_checked');

  // 7. Compatibility check
  const compatibility = checkCompatibility(manifest, this.environment);
  if (!compatibility.compatible) {
    const messages = compatibility.errors.map((e) => e.message).join('; ');
    await this.transitionToFailed(
      installTxnId,
      'integrity_checked',
      'compatibility_unsupported',
      `Compatibility check failed: ${messages}`,
    );
    await this.repos.installTransactions.finish(installTxnId, 'failed');
    return { installTxnId, skillValidation, error: `Compatibility check failed: ${messages}` };
  }

  // integrity_checked -> compatibility_checked
  await this.transition(installTxnId, 'integrity_checked', 'compatibility_checked');

  // 8. Resolve bindings
  const bindings = resolveBindings(manifest);

  // compatibility_checked -> dependency_planned
  await this.transition(installTxnId, 'compatibility_checked', 'dependency_planned');

  // 9. Build plan
  const plan: InstallPlan = {
    manifest,
    compatibility,
    bindings,
    needsConfirmation: false, // skills are data_asset, no confirmation needed
    confirmationReasons: [],
    packageHash: '0'.repeat(64),
    manifestHash: '0'.repeat(64),
  };

  // 10. Route to next state (same logic as importFile)
  if (plan.bindings.length > 0) {
    await this.transition(
      installTxnId,
      'dependency_planned',
      'awaiting_bindings',
      manifest.package.id,
    );
  } else {
    await this.transition(
      installTxnId,
      'dependency_planned',
      'ready_to_install',
      manifest.package.id,
    );
  }

  // Cache plan for confirmBindings
  planCache.set(installTxnId, plan);

  return { installTxnId, plan, skillValidation };
}
```

**Step 4: Export SkillImportResult from index.ts**

Update `packages/install-core/src/index.ts`:
```typescript
export type { InstallServiceDeps, ImportResult, SkillImportResult } from './install-service.js';
```

**Step 5: Run tests, typecheck, commit**

```bash
pnpm --filter @aics/install-core test
pnpm --filter @aics/install-core typecheck && pnpm --filter @aics/install-core build
git add packages/install-core/src/
git commit -m "feat(install-core): InstallService.importSkill() — OpenClaw SKILL.md import entry point"
```

---

## Task 6: Web UI — File Trigger + Hook + SkillReview Component

**Files:**
- Modify: `apps/web/src/components/install/FileImportTrigger.tsx`
- Modify: `apps/web/src/hooks/useInstallFlow.ts`
- Create: `apps/web/src/components/install/SkillReview.tsx`
- Modify: `apps/web/src/components/install/InstallDialog.tsx`

**Context:**
The web layer needs 4 changes:
1. **FileImportTrigger**: Accept `.md` files in addition to `.aicspkg`/`.zip`
2. **useInstallFlow**: Detect file type → call `installService.importSkill()` for `.md` files
3. **SkillReview**: New component showing skill name, description, instructions preview, and requirement warnings
4. **InstallDialog**: Route to SkillReview when the import source is a skill

**Step 1: Modify FileImportTrigger**

Update `ACCEPTED_EXTENSIONS`:
```typescript
const ACCEPTED_EXTENSIONS = '.aicspkg,.zip,.md';
```

Update drop zone text:
```
Drop .aicspkg, .zip, or SKILL.md file here
```

**Step 2: Modify useInstallFlow**

Add new imports:
```typescript
import type { SkillImportResult, SkillValidationResult } from '@aics/install-core';
```

Add to `InstallFlowState`:
```typescript
export interface InstallFlowState {
  isOpen: boolean;
  step: InstallStep;
  plan: InstallPlan | null;
  error: string | null;
  bindingValues: Map<string, string>;
  /** True when importing a SKILL.md (vs .aicspkg) — affects review UI */
  isSkillImport: boolean;
  /** Soft validation warnings from skill validator */
  skillValidation: SkillValidationResult | null;
}
```

In `startFileImport`:
- Check file extension — if `.md`, read as text and call `installService.importSkill(text)`
- Otherwise keep existing `.aicspkg`/`.zip` path
- On success, set `isSkillImport = true` and `skillValidation` from result

```typescript
// Detect skill import (inside startFileImport callback)
const isMd = ext.endsWith('.md');

if (isMd) {
  // Validate: .md files don't go through the .aicspkg/.zip extension check
  // (already accepted by file input)

  if (!installService) {
    // Mock fallback for .md
    timerRef.current = setTimeout(() => {
      setPlan(MOCK_INSTALL_PLAN);
      setStep('review');
      setIsSkillImport(true);
      timerRef.current = null;
    }, 500);
    return;
  }

  // Real path: read file as text and call importSkill
  (async () => {
    try {
      const text = await file.text();
      const result = await installService.importSkill(text);

      if (result.error || !result.plan) {
        setStep('error');
        setError(result.error ?? 'Skill import failed: no plan returned');
        return;
      }

      txnIdRef.current = result.installTxnId;
      setPlan(result.plan);
      setSkillValidation(result.skillValidation ?? null);
      setIsSkillImport(true);
      setStep('review');
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  })();
  return;
}

// Existing .aicspkg/.zip path continues below...
```

Also update the file extension validation to allow .md:
```typescript
if (!ext.endsWith('.aicspkg') && !ext.endsWith('.zip') && !ext.endsWith('.md')) {
  setIsOpen(true);
  setStep('error');
  setError('Invalid file type. Expected .aicspkg, .zip, or .md (SKILL.md)');
  return;
}
```

**Step 3: Create SkillReview component**

Create `apps/web/src/components/install/SkillReview.tsx`:

```typescript
/**
 * SkillReview — shows OpenClaw skill info for user review before install.
 * Displays skill name, description, instructions preview, and requirement warnings.
 */

import type { InstallPlan, SkillValidationResult } from '@aics/install-core';
import { AlertTriangle, FileText, Info, Terminal } from 'lucide-react';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface SkillReviewProps {
  plan: InstallPlan;
  skillValidation: SkillValidationResult | null;
  onApprove: () => void;
  onCancel: () => void;
}

export function SkillReview({ plan, skillValidation, onApprove, onCancel }: SkillReviewProps) {
  const { manifest } = plan;
  const pkg = manifest.package;
  const custom = manifest.custom ?? {};
  const instructions = (custom.openclaw_instructions as string) ?? '';
  const emoji = (custom.openclaw_emoji as string) ?? '🦞';
  const homepage = custom.openclaw_homepage as string | undefined;
  const requirements = custom.openclaw_requirements as {
    bins?: string[];
    env?: string[];
    config?: string[];
  } | undefined;

  const warnings = skillValidation?.warnings ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Skill header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-2xl" role="img" aria-label="skill emoji">{emoji}</span>
          <div>
            <h3 className="text-base font-semibold text-sand truncate">{pkg.title}</h3>
            <p className="text-sm text-shell mt-0.5">{pkg.summary}</p>
          </div>
        </div>
        <Badge variant="info">OpenClaw Skill</Badge>
      </div>

      {/* Homepage link */}
      {homepage && (
        <p className="text-xs text-ocean-light truncate">
          🔗 {homepage}
        </p>
      )}

      {/* Instructions preview */}
      <div className="border-2 border-ocean-light p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <FileText className="h-3.5 w-3.5 text-shell" />
          <h4 className="text-xs font-medium text-ocean-light uppercase tracking-wide font-pixel-body">
            Skill Instructions
          </h4>
        </div>
        <div className="text-sm text-shell max-h-32 overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {instructions.length > 500
            ? `${instructions.slice(0, 500)}…`
            : instructions || '(no instructions)'}
        </div>
      </div>

      {/* Requirements */}
      {requirements && (requirements.bins?.length || requirements.env?.length || requirements.config?.length) && (
        <div className="border-2 border-ocean-light p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Terminal className="h-3.5 w-3.5 text-shell" />
            <h4 className="text-xs font-medium text-ocean-light uppercase tracking-wide font-pixel-body">
              Requirements
            </h4>
          </div>
          <div className="space-y-1 text-xs text-shell">
            {requirements.bins?.length ? (
              <p>Binaries: <span className="text-sand">{requirements.bins.join(', ')}</span></p>
            ) : null}
            {requirements.env?.length ? (
              <p>Env vars: <span className="text-sand">{requirements.env.join(', ')}</span></p>
            ) : null}
            {requirements.config?.length ? (
              <p>Config: <span className="text-sand">{requirements.config.join(', ')}</span></p>
            ) : null}
          </div>
        </div>
      )}

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              {warnings.map((w, i) => (
                <li key={i}>{w.detail}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Info note */}
      <div className="flex items-start gap-2 text-xs text-ocean-light">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <p>
          This skill will be imported as a new employee.
          The skill&apos;s instructions become the employee&apos;s persona.
          Your configured LLM will execute the work.
        </p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-ocean-light">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onApprove}>Import Skill</Button>
      </div>
    </div>
  );
}
```

**Step 4: Modify InstallDialog**

In `InstallDialog.tsx`, update the review step to conditionally render SkillReview:

```typescript
import { SkillReview } from './SkillReview.js';

// Pass isSkillImport and skillValidation through props (from useInstallFlow)

case 'review':
  if (!plan) return <LoadingContent />;
  if (isSkillImport) {
    return (
      <SkillReview
        plan={plan}
        skillValidation={skillValidation}
        onApprove={confirmInstall}
        onCancel={cancel}
      />
    );
  }
  return <ManifestReview plan={plan} onApprove={confirmInstall} onCancel={cancel} />;
```

Update `getDialogTitle`:
```typescript
case 'review':
  return isSkillImport ? 'Import OpenClaw Skill' : 'Review Package';
```

Update `DialogDescription` for review step:
```typescript
{step === 'review' && plan && !isSkillImport && (
  <DialogDescription>Review the package details before installing.</DialogDescription>
)}
{step === 'review' && plan && isSkillImport && (
  <DialogDescription>Review the skill before importing as an employee.</DialogDescription>
)}
```

**Step 5: Typecheck + build**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
```

**Step 6: Commit**

```bash
git add apps/web/src/components/install/ apps/web/src/hooks/useInstallFlow.ts
git commit -m "feat(web): OpenClaw SKILL.md import UI — SkillReview + hook routing + .md file support"
```

---

## Task 7: Integration Test — Full Skill Import Flow

**Files:**
- Create: `packages/install-core/src/openclaw/__tests__/integration.test.ts`

**Context:**
End-to-end test using the same mock repos pattern from Task 5, but exercises the complete flow: parse → validate → synthesize → importSkill → confirmBindings → verify employee was created with correct persona data.

**Step 1: Write integration test**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { InstallService } from '../../install-service.js';
import type { InstallRepositories, InstallEventEmitter, NewEmployee } from '../../types.js';

function createTestRepos() {
  const txns = new Map<string, any>();
  const pkgs: any[] = [];
  const assets: any[] = [];
  const bindings: any[] = [];
  const employees: NewEmployee[] = [];

  const repos: InstallRepositories = {
    installTransactions: {
      async create(txn) { txns.set(txn.install_txn_id, { ...txn, finished_at: null }); return txns.get(txn.install_txn_id)!; },
      async findById(id) { return txns.get(id) ?? null; },
      async updateState(id, state, errorCode?, errorDetail?) {
        const t = txns.get(id); if (t) { t.state = state; t.error_code = errorCode ?? null; t.error_detail = errorDetail ?? null; }
      },
      async finish(id, state) { const t = txns.get(id); if (t) { t.state = state; t.finished_at = new Date().toISOString(); } },
    },
    installedPackages: {
      async create(pkg) { pkgs.push(pkg); return pkg; },
      async findByPackageId(_cid, pid) { return pkgs.filter(p => p.package_id === pid); },
    },
    installedAssets: { async create(a) { assets.push(a); return a; } },
    assetBindings: {
      async create(b) { bindings.push(b); return b; },
      async findByTransaction(txnId) { return bindings.filter(b => b.install_txn_id === txnId); },
      async updateStatus() {},
    },
    employees: {
      async create(emp) {
        const id = `emp-${crypto.randomUUID().slice(0, 8)}`;
        employees.push(emp);
        return { employee_id: id };
      },
    },
  };

  return { repos, txns, pkgs, assets, bindings, employees };
}

function createTestEvents(): InstallEventEmitter {
  return {
    emitInstallState() {},
    emitBindingState() {},
  };
}

const CODER_SKILL = `---
name: Full-Stack Coder
description: Expert full-stack developer specializing in React and Node.js
homepage: https://example.com/coder
license: MIT
metadata:
  openclaw.emoji: "💻"
  openclaw.requires:
    bins:
      - node
      - git
    env:
      - GITHUB_TOKEN
  openclaw.os:
    - linux
    - macos
    - windows
---

You are an expert full-stack developer.

## Core Competencies
- React 19 with TypeScript
- Node.js with Express
- PostgreSQL and Redis

## Work Style
- Write tests first (TDD)
- Keep functions small and focused
- Document public APIs
`;

describe('OpenClaw Skill Import — Integration', () => {
  let service: InstallService;
  let testData: ReturnType<typeof createTestRepos>;

  beforeEach(() => {
    InstallService._clearPlanCache();
    testData = createTestRepos();
    service = new InstallService({
      repos: testData.repos,
      events: createTestEvents(),
      companyId: 'company-001',
      environment: { runtimeVersion: '0.1.0', environment: 'desktop', schemaVersion: '2026-03' },
    });
  });

  it('full import flow: SKILL.md → employee with persona', async () => {
    // Step 1: Import skill
    const importResult = await service.importSkill(CODER_SKILL);
    expect(importResult.error).toBeUndefined();
    expect(importResult.plan).toBeDefined();
    expect(importResult.plan!.manifest.package.title).toBe('Full-Stack Coder');

    // Step 2: Verify validation
    expect(importResult.skillValidation).toBeDefined();
    expect(importResult.skillValidation!.valid).toBe(true);
    // Desktop environment — bins/env warnings present, no OS warning
    const warnings = importResult.skillValidation!.warnings;
    expect(warnings.some(w => w.type === 'missing_bin')).toBe(true);
    expect(warnings.some(w => w.type === 'unsupported_os')).toBe(false);

    // Step 3: Confirm and materialize
    const materializeResult = await service.confirmBindings(importResult.installTxnId, []);
    expect(materializeResult.employeeIds).toHaveLength(1);
    expect(materializeResult.installedPackageId).toBeTruthy();

    // Step 4: Verify employee was created
    expect(testData.employees).toHaveLength(1);
    expect(testData.employees[0]!.name).toBe('Full-Stack Coder');
    expect(testData.employees[0]!.source_package_id).toContain('openclaw-skill-');

    // Step 5: Verify installed package
    expect(testData.pkgs).toHaveLength(1);
    expect(testData.pkgs[0].package_id).toContain('openclaw-skill-full-stack-coder');
    expect(testData.pkgs[0].package_kind).toBe('employee');

    // Step 6: Verify installed asset
    expect(testData.assets).toHaveLength(1);
    expect(testData.assets[0].asset_kind).toBe('employee');

    // Step 7: Verify transaction finished
    const txn = await testData.repos.installTransactions.findById(importResult.installTxnId);
    expect(txn!.state).toBe('installed');
    expect(txn!.finished_at).toBeTruthy();
  });

  it('rejects skill with incompatible runtime version', async () => {
    const incompatibleService = new InstallService({
      repos: testData.repos,
      events: createTestEvents(),
      companyId: 'company-001',
      // Version too high — skill manifest says >=0.1.0 <2.0.0
      environment: { runtimeVersion: '3.0.0', environment: 'desktop', schemaVersion: '2026-03' },
    });

    const result = await incompatibleService.importSkill(CODER_SKILL);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Compatibility');
  });

  it('handles cancel after import', async () => {
    const importResult = await service.importSkill(CODER_SKILL);
    expect(importResult.plan).toBeDefined();

    // Cancel should not throw
    await service.cancel(importResult.installTxnId);

    // Confirm should now fail (cancelled)
    await expect(
      service.confirmBindings(importResult.installTxnId, []),
    ).rejects.toThrow();
  });
});
```

**Step 2: Run all tests**

```bash
pnpm --filter @aics/install-core test
```

**Step 3: Commit**

```bash
git add packages/install-core/src/openclaw/__tests__/integration.test.ts
git commit -m "test(install-core): OpenClaw skill import integration tests — full flow + edge cases"
```

---

## Task 8: Full Verification + Polish

**Step 1: Run all package tests**

```bash
pnpm --filter @aics/install-core test
pnpm --filter @aics/core test
pnpm --filter @aics/renderer test
```

**Step 2: Typecheck everything**

```bash
pnpm turbo run typecheck
```

**Step 3: Build web app**

```bash
pnpm --filter @aics/web build
```

**Step 4: Grep for any leftover issues**

```bash
# Check all new files import correctly
grep -r "from './openclaw" packages/install-core/src/ --include="*.ts" | head -20
# Check no circular imports
grep -r "from '@aics/core'" packages/install-core/src/ --include="*.ts"
# Should return NO results (install-core must not import from core)
```

**Step 5: Commit any polish fixes**

```bash
git add -A
git commit -m "chore: Phase 7C verification and polish"
```

---

## File Summary

### New files (9):
| File | Purpose |
|------|---------|
| `packages/install-core/src/openclaw/types.ts` | ParsedSkill, SkillRequirements, SkillMetadata, SkillValidationResult types |
| `packages/install-core/src/openclaw/index.ts` | Barrel export |
| `packages/install-core/src/openclaw/skill-parser.ts` | Parse SKILL.md YAML frontmatter + body |
| `packages/install-core/src/openclaw/skill-validator.ts` | Validate requirements against environment |
| `packages/install-core/src/openclaw/skill-to-manifest.ts` | Convert ParsedSkill → synthetic PackageManifest |
| `packages/install-core/src/openclaw/__tests__/skill-parser.test.ts` | Parser unit tests |
| `packages/install-core/src/openclaw/__tests__/skill-validator.test.ts` | Validator unit tests |
| `packages/install-core/src/openclaw/__tests__/skill-to-manifest.test.ts` | Manifest synthesis unit tests |
| `packages/install-core/src/openclaw/__tests__/import-skill.test.ts` | InstallService.importSkill unit tests |
| `packages/install-core/src/openclaw/__tests__/integration.test.ts` | Full flow integration tests |
| `apps/web/src/components/install/SkillReview.tsx` | Skill review UI component |

### Modified files (5):
| File | Change |
|------|--------|
| `packages/install-core/package.json` | Add gray-matter dependency |
| `packages/install-core/src/index.ts` | Export openclaw types + functions |
| `packages/install-core/src/install-service.ts` | Add `importSkill()` method + SkillImportResult type |
| `apps/web/src/hooks/useInstallFlow.ts` | Add isSkillImport state, .md file routing, importSkill() call |
| `apps/web/src/components/install/FileImportTrigger.tsx` | Accept .md files |
| `apps/web/src/components/install/InstallDialog.tsx` | Route to SkillReview for skill imports |

### Zero files overlap with Phase 6 or Phase 7A — clean scope.
