import { describe, expect, it } from 'vitest';
import { skillToManifest } from '../skill-to-manifest.js';
import type { ParsedSkill } from '../types.js';

const SKILL: ParsedSkill = {
  name: 'code-reviewer',
  description: 'Reviews code for bugs and style issues',
  instructions: 'You are a code review expert.\n\n## Guidelines\n- Check for bugs',
  requirements: { bins: ['git'], env: ['GITHUB_TOKEN'] },
  metadata: {
    emoji: '\uD83D\uDD0D',
    homepage: 'https://example.com',
    license: 'MIT',
    os: ['linux', 'macos'],
    userInvocable: true,
    allowedTools: ['Read', 'Grep'],
  },
};

describe('skillToManifest', () => {
  it('produces a valid PackageManifest shape', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    expect(manifest.spec_version).toBe('1.0.0');
    expect(manifest.package.kind).toBe('employee');
    expect(manifest.package.title).toBe('code-reviewer');
    expect(manifest.package.id).toMatch(/^openclaw-skill-/);
    expect(manifest.package.version).toBe('0.0.0-local');
    expect(manifest.package.license).toBe('MIT');
  });

  it('creates one employee asset with the skill as entrypoint', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]?.kind).toBe('employee');
    expect(manifest.assets[0]?.asset_id).toContain('code-reviewer');
    expect(manifest.assets[0]?.default_enabled).toBe(true);
  });

  it('stores skill instructions in custom.openclaw_instructions', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    expect(manifest.custom?.openclaw_instructions).toBe(SKILL.instructions);
  });

  it('creates an index-first skill descriptor with structured capabilities', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    const index = manifest.custom?.openclaw_skill_index as
      | {
          strategy: string;
          instructionMode: string;
          requiredCapabilities: ReadonlyArray<string>;
          capabilities: ReadonlyArray<{ kind: string; key: string; label: string }>;
          instructionExcerpt: string;
        }
      | undefined;

    expect(index).toBeDefined();
    expect(index?.strategy).toBe('index-first');
    expect(index?.instructionMode).toBe('deferred');
    expect(index?.requiredCapabilities).toEqual([
      'tool:Read',
      'tool:Grep',
      'binary:git',
      'env:GITHUB_TOKEN',
    ]);
    expect(index?.capabilities.map((cap) => `${cap.kind}:${cap.key}`)).toEqual([
      'tool:Read',
      'tool:Grep',
      'binary:git',
      'env:GITHUB_TOKEN',
    ]);
    expect(index?.instructionExcerpt).toContain('code review expert');
  });

  it('stores skill metadata in custom.openclaw_metadata', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    expect(manifest.custom?.openclaw_emoji).toBe('\uD83D\uDD0D');
    expect(manifest.custom?.openclaw_homepage).toBe('https://example.com');
  });

  it('sets data_asset risk class and no permissions', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    expect(manifest.permissions.risk_class).toBe('data_asset');
    expect(manifest.permissions.network_scope).toBe('none');
    expect(manifest.permissions.filesystem_scope).toBe('none');
    expect(manifest.permissions.declares_secrets).toBe(false);
  });

  it('creates synthetic integrity hashes (all zeros)', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    expect(manifest.integrity.package_sha256).toMatch(/^0+$/);
  });

  it('defaults license to "UNLICENSED" when not specified', () => {
    const noLicense: ParsedSkill = {
      ...SKILL,
      metadata: { ...SKILL.metadata, license: undefined },
    };
    const manifest = skillToManifest(noLicense, '2026-03');
    expect(manifest.package.license).toBe('UNLICENSED');
  });

  it('sets summary from skill description', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    expect(manifest.package.summary).toBe('Reviews code for bugs and style issues');
  });

  it('generates unique package IDs for different skill names', () => {
    const m1 = skillToManifest(SKILL, '2026-03');
    const m2 = skillToManifest({ ...SKILL, name: 'other-skill' }, '2026-03');
    expect(m1.package.id).not.toBe(m2.package.id);
  });

  it('maps required mcps to manifest.requirements.required_mcps', () => {
    const withMcps: ParsedSkill = {
      ...SKILL,
      requirements: {
        ...SKILL.requirements,
        mcps: [
          { name: 'github', description: 'GitHub API', transport: 'stdio' as const },
          { name: 'slack', description: 'Slack API', transport: 'sse' as const },
        ],
      },
    };
    const manifest = skillToManifest(withMcps, '2026-03');
    expect(manifest.requirements.required_mcps).toEqual(['github', 'slack']);
  });

  it('maps all indexed capabilities into manifest.requirements.required_capabilities', () => {
    const withMcps: ParsedSkill = {
      ...SKILL,
      requirements: {
        ...SKILL.requirements,
        bins: ['git', 'node'],
        env: ['GITHUB_TOKEN', 'OPENAI_API_KEY'],
        config: ['~/.gitconfig'],
        mcps: [{ name: 'github', description: 'GitHub API', transport: 'stdio' as const }],
      },
    };
    const manifest = skillToManifest(withMcps, '2026-03');
    expect(manifest.requirements.required_capabilities).toEqual([
      'tool:Read',
      'tool:Grep',
      'mcp:github',
      'binary:git',
      'binary:node',
      'env:GITHUB_TOKEN',
      'env:OPENAI_API_KEY',
      'config:~/.gitconfig',
    ]);
  });

  it('defaults required_mcps to empty array when no mcps', () => {
    const manifest = skillToManifest(SKILL, '2026-03');
    expect(manifest.requirements.required_mcps).toEqual([]);
  });
});
