import { describe, expect, it } from 'vitest';
import { SkillParseError, parseSkill } from '../skill-parser.js';

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
  openclaw.emoji: "\uD83D\uDD0D"
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
    expect(skill.metadata.emoji).toBe('\uD83D\uDD0D');
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
metadata: '{"openclaw.emoji":"\uD83E\uDDDE","openclaw.requires":{"bins":["curl"]}}'
---
body`;
    const skill = parseSkill(md);
    expect(skill.metadata.emoji).toBe('\uD83E\uDDDE');
    expect(skill.requirements.bins).toEqual(['curl']);
  });

  it('parses frontmatter when the file starts with a UTF-8 BOM', () => {
    const skill = parseSkill(`\uFEFF${MINIMAL_SKILL}`);
    expect(skill.name).toBe('test-skill');
    expect(skill.description).toBe('A test skill');
    expect(skill.instructions).toContain('You are a test assistant.');
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
