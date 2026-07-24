import assert from 'node:assert/strict';
import type { ComposerSkillReference } from '../apps/desktop/renderer/src/assistant/composer/composer-skill-reference-store.ts';
import {
  buildSkillOfficeInvocationLines,
  buildSkillOfficeInvocationText,
} from '../apps/desktop/renderer/src/assistant/runtime/skill-office-invocation.ts';
import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness('Skill Office invocation');
const check = h.checkAsync;

function reference(
  input: Partial<ComposerSkillReference> &
    Pick<ComposerSkillReference, 'skillId' | 'name' | 'description' | 'source'>,
): ComposerSkillReference {
  return {
    id: `ref-${input.skillId}`,
    insertedAt: 1,
    ...input,
  };
}

await check('vault chip resolves the live SKILL.md frontmatter name', async () => {
  const lines = await buildSkillOfficeInvocationLines(
    {
      readVaultFile: async (path) => {
        assert.equal(path, 'companies/co/skills/research/SKILL.md');
        return `---
name: research-summary
description: Canonical vault skill
---

# Research Summary
`;
      },
    },
    [
      reference({
        skillId: 'vault-research',
        name: 'Research Summary',
        description: 'Summarize source material.',
        source: 'company',
        vault_path: 'companies/co/skills/research/SKILL.md',
      }),
    ],
  );
  assert.deepEqual(lines, [
    'Use the "research-summary" skill for this task: locate it among your available skills, read its SKILL.md, and follow it. (Summarize source material.)',
  ]);
});

await check(
  'project chip uses its already-discovered frontmatter name without vault I/O',
  async () => {
    let reads = 0;
    const text = await buildSkillOfficeInvocationText(
      {
        readVaultFile: async () => {
          reads += 1;
          throw new Error('project skills must not read the vault');
        },
      },
      [
        reference({
          skillId: 'project-review',
          name: 'project-code-review',
          description: 'Review the current repository.',
          source: 'project',
          relativePath: '.agents/skills/project-code-review/SKILL.md',
        }),
      ],
    );
    assert.equal(reads, 0);
    assert.equal(
      text,
      'Use the "project-code-review" skill for this task: locate it among your available skills, read its SKILL.md, and follow it. (Review the current repository.)',
    );
  },
);

await check(
  'malformed vault frontmatter falls back to the DB name without blocking Send',
  async () => {
    const text = await buildSkillOfficeInvocationText(
      {
        readVaultFile: async () => `---
name: [invalid
---
`,
      },
      [
        reference({
          skillId: 'broken',
          name: 'Research Summary',
          description: 'Fallback remains usable.',
          source: 'employee',
          vault_path: 'companies/co/employees/e1/skills/broken/SKILL.md',
        }),
      ],
    );
    assert.equal(
      text,
      'Use the "Research Summary" skill for this task: locate it among your available skills, read its SKILL.md, and follow it. (Fallback remains usable.)',
    );
  },
);

await check(
  'multiple chips keep insertion order even when vault reads resolve out of order',
  async () => {
    const delays = new Map([
      ['slow/SKILL.md', 20],
      ['fast/SKILL.md', 0],
    ]);
    const contents = new Map([
      ['slow/SKILL.md', '---\nname: first-skill\ndescription: first\n---\n'],
      ['fast/SKILL.md', '---\nname: third-skill\ndescription: third\n---\n'],
    ]);
    const lines = await buildSkillOfficeInvocationLines(
      {
        readVaultFile: async (path) => {
          await new Promise((resolve) => setTimeout(resolve, delays.get(path) ?? 0));
          return contents.get(path) ?? '';
        },
      },
      [
        reference({
          skillId: 'first',
          name: 'First DB Name',
          description: 'First.',
          source: 'company',
          vault_path: 'slow/SKILL.md',
        }),
        reference({
          skillId: 'second',
          name: 'second-project-skill',
          description: 'Second\nproject.',
          source: 'project',
          relativePath: '.claude/skills/second/SKILL.md',
        }),
        reference({
          skillId: 'third',
          name: 'Third DB Name',
          description: 'Third.',
          source: 'employee',
          vault_path: 'fast/SKILL.md',
        }),
      ],
    );
    assert.deepEqual(
      lines.map((line) => line.match(/^Use the "([^"]+)"/u)?.[1]),
      ['first-skill', 'second-project-skill', 'third-skill'],
    );
    assert.ok(lines[1]?.endsWith('(Second project.)'));
  },
);

h.report();
