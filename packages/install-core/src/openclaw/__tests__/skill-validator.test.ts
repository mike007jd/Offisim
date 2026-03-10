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
