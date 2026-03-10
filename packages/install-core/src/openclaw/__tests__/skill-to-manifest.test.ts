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
    expect(manifest.custom?.openclaw_emoji).toBe('\uD83D\uDD0D');
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
