/**
 * Skill parser — parse OpenClaw SKILL.md format.
 *
 * Uses gray-matter for YAML frontmatter extraction.
 * Normalizes OpenClaw's dot-separated metadata keys into structured types.
 */

import matter from 'gray-matter';
import type { ParsedSkill, RequiredMcp, SkillMetadata, SkillRequirements } from './types.js';

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
 * 1. Nested YAML object: { "openclaw.emoji": "...", "openclaw.requires": {...} }
 * 2. Single-line JSON string: '{"openclaw.emoji":"...","openclaw.requires":{...}}'
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
    mcps: Array.isArray(requires.mcps)
      ? requires.mcps
          .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
          .map((m): RequiredMcp => ({
            name: String(m.name ?? ''),
            description: String(m.description ?? ''),
            transport: (['stdio', 'sse', 'either'].includes(String(m.transport))
              ? String(m.transport) as 'stdio' | 'sse' | 'either'
              : 'either'),
            registryUrl: typeof m['registry-url'] === 'string' ? m['registry-url'] : undefined,
          }))
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
/** Maximum allowed SKILL.md size (512 KB). Prevents OOM on malicious input. */
const MAX_SKILL_SIZE = 512 * 1024;

export function parseSkill(content: string): ParsedSkill {
  // 0. Guard against excessively large input
  if (content.length > MAX_SKILL_SIZE) {
    throw new SkillParseError(
      'input_too_large',
      `SKILL.md exceeds maximum size (${MAX_SKILL_SIZE} bytes). Got ${content.length} bytes.`,
    );
  }

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
