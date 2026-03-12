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
 * E.g. "Code Reviewer!" -> "code-reviewer"
 *
 * Falls back to a hash-based slug for pure non-ASCII names (e.g. Chinese, Japanese)
 * that would produce an empty string after stripping non-alphanumeric chars.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug) return slug;

  // Non-ASCII fallback: simple hash from char codes to produce a stable slug
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return `skill-${Math.abs(hash).toString(36)}`;
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
      required_mcps: (skill.requirements.mcps ?? []).map((m) => m.name),
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
        path: 'assets/SKILL.md',
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
