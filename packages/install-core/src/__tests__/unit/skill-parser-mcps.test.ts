import { describe, expect, it } from 'vitest';
import { parseSkill } from '../../openclaw/skill-parser.js';

describe('parseSkill — required_mcps', () => {
  it('parses required-mcps from metadata', () => {
    const content = `---
name: GitHub Assistant
description: Works with GitHub
metadata: '{"openclaw.requires":{"mcps":[{"name":"github","description":"GitHub API","transport":"stdio","registry-url":"https://example.com"}]}}'
---
Instructions here
`;
    const result = parseSkill(content);
    expect(result.requirements.mcps).toHaveLength(1);
    expect(result.requirements.mcps?.[0]?.name).toBe('github');
    expect(result.requirements.mcps?.[0]?.transport).toBe('stdio');
    expect(result.requirements.mcps?.[0]?.registryUrl).toBe('https://example.com');
  });

  it('returns undefined mcps when not specified', () => {
    const content = `---
name: Simple Skill
description: No MCPs
---
Do stuff
`;
    const result = parseSkill(content);
    expect(result.requirements.mcps).toBeUndefined();
  });
}); // end describe
