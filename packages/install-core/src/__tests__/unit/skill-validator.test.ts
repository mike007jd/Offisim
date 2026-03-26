import { describe, expect, it } from 'vitest';
import { validateSkill } from '../../openclaw/skill-validator.js';
import type { ParsedSkill } from '../../openclaw/types.js';

function requireDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

const baseSkill: ParsedSkill = {
  name: 'Test Skill',
  description: 'A test skill',
  instructions: 'Do the thing',
  requirements: { bins: [], env: [], config: [] },
  metadata: { os: [] },
};

describe('validateSkill', () => {
  // --- Existing logic: soft warnings ---

  it('returns valid:true with no warnings when skill has no requirements', () => {
    const result = validateSkill(baseSkill, 'desktop');
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('returns a missing_bin warning for each required binary', () => {
    const skill: ParsedSkill = {
      ...baseSkill,
      requirements: { bins: ['node', 'git'], env: [], config: [] },
    };
    const result = validateSkill(skill, 'desktop');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]?.type).toBe('missing_bin');
    expect(result.warnings[0]?.severity).toBe('warning');
    expect(result.warnings[1]?.type).toBe('missing_bin');
  });

  it('returns a missing_env warning for each required env var', () => {
    const skill: ParsedSkill = {
      ...baseSkill,
      requirements: { bins: [], env: ['GITHUB_TOKEN', 'API_KEY'], config: [] },
    };
    const result = validateSkill(skill, 'web_limited');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]?.type).toBe('missing_env');
    expect(result.warnings[0]?.severity).toBe('warning');
  });

  it('returns a missing_config warning for each required config path', () => {
    const skill: ParsedSkill = {
      ...baseSkill,
      requirements: { bins: [], env: [], config: ['~/.config/tool.json'] },
    };
    const result = validateSkill(skill, 'web_limited');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]?.type).toBe('missing_config');
  });

  it('returns unsupported_os warning when OS specified and environment is not desktop', () => {
    const skill: ParsedSkill = { ...baseSkill, metadata: { os: ['linux'] } };
    const result = validateSkill(skill, 'web_limited');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.type).toBe('unsupported_os');
    expect(result.warnings[0]?.severity).toBe('warning');
  });

  it('does not warn about OS when environment is desktop', () => {
    const skill: ParsedSkill = { ...baseSkill, metadata: { os: ['linux'] } };
    const result = validateSkill(skill, 'desktop');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(0);
  });

  // --- New tests: hard errors ---

  it('returns valid:false when name is empty', () => {
    const skill: ParsedSkill = {
      name: '',
      description: 'test',
      instructions: 'do stuff',
      requirements: { bins: [], env: [], config: [] },
      metadata: { os: [] },
    };
    const result = validateSkill(skill, 'desktop');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns valid:false when instructions are empty', () => {
    const skill: ParsedSkill = {
      name: 'Test',
      description: 'test',
      instructions: '',
      requirements: { bins: [], env: [], config: [] },
      metadata: { os: [] },
    };
    const result = validateSkill(skill, 'desktop');
    expect(result.valid).toBe(false);
  });

  it('returns valid:true with soft warnings only', () => {
    const skill: ParsedSkill = {
      name: 'Test Skill',
      description: 'A test skill',
      instructions: 'Do the thing',
      requirements: { bins: ['node'], env: [], config: [] },
      metadata: { os: [] },
    };
    const result = validateSkill(skill, 'desktop');
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns empty name error with correct type and severity', () => {
    const skill: ParsedSkill = { ...baseSkill, name: '' };
    const result = validateSkill(skill, 'desktop');
    const firstError = requireDefined(result.errors[0], 'Expected empty_name error');
    expect(firstError).toEqual({
      type: 'empty_name',
      detail: 'Skill name is required',
      severity: 'error',
    });
  });

  it('returns empty instructions error with correct type and severity', () => {
    const skill: ParsedSkill = { ...baseSkill, instructions: '   ' };
    const result = validateSkill(skill, 'desktop');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.type).toBe('empty_instructions');
    expect(result.errors[0]?.severity).toBe('error');
  });

  it('returns name_too_long error when name exceeds 128 characters', () => {
    const skill: ParsedSkill = { ...baseSkill, name: 'A'.repeat(129) };
    const result = validateSkill(skill, 'desktop');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.type).toBe('name_too_long');
  });

  it('accumulates multiple errors', () => {
    const skill: ParsedSkill = { ...baseSkill, name: '', instructions: '' };
    const result = validateSkill(skill, 'desktop');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
  });

  it('returns missing_mcp warning for unconnected MCP server', () => {
    const skill: ParsedSkill = {
      ...baseSkill,
      requirements: {
        mcps: [{ name: 'github', description: 'GitHub API', transport: 'stdio' }],
      },
    };
    const result = validateSkill(skill, 'desktop', new Set());
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.type).toBe('missing_mcp');
    expect(result.warnings[0]?.severity).toBe('warning');
  });

  it('does not warn for connected MCP server', () => {
    const skill: ParsedSkill = {
      ...baseSkill,
      requirements: {
        mcps: [{ name: 'github', description: 'GitHub API', transport: 'stdio' }],
      },
    };
    const result = validateSkill(skill, 'desktop', new Set(['github']));
    expect(result.warnings).toHaveLength(0);
  });

  it('skips MCP check when connectedMcpServers not provided', () => {
    const skill: ParsedSkill = {
      ...baseSkill,
      requirements: {
        mcps: [{ name: 'github', description: 'GitHub API', transport: 'stdio' }],
      },
    };
    const result = validateSkill(skill, 'desktop');
    expect(result.warnings).toHaveLength(0);
  });
});
