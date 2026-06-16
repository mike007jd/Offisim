import type { ToolDef } from '../../llm/gateway.js';

export const SKILL_INSTALL_TOOL_NAMES = [
  'install_skill_from_git',
  'install_skill_from_upload',
  'sync_from_claude_code',
  'sync_from_codex',
  'fork_skill',
  'edit_skill_body',
  'create_skill_from_scratch',
] as const;
export type SkillInstallToolName = (typeof SKILL_INSTALL_TOOL_NAMES)[number];

const SCOPE_PARAM = {
  type: 'string',
  enum: ['company', 'employee'],
  description:
    'Install scope. Default "company" = shared across the whole company. ' +
    '"employee" = only the specified employee. Infer from the user\'s request.',
} as const;

const TARGET_EMPLOYEE_PARAM = {
  type: 'string',
  description:
    'Employee identifier to scope the install to (REQUIRED when scope="employee"; FORBIDDEN when scope="company"). Prefer the exact employee_id from the "Available coworkers" list. If you do not have the id, you may pass the exact employee name as a fallback; the tool will do a case-insensitive match. If the name matches multiple employees the tool returns `{ kind: "target-employee-ambiguous", candidates: [...] }` — retry with the specific employee_id.',
} as const;

export const SKILL_INSTALL_TOOL_DEFS: readonly ToolDef[] = Object.freeze([
  {
    name: 'install_skill_from_git',
    description: [
      'Install a SKILL.md skill from a git repository. Always routes through a user confirmation preview — the tool itself never writes to disk.',
      'COMMON CASE — user says "install <NAME> from github.com/<owner>/<repo>":',
      '  • Pass `url = https://github.com/<owner>/<repo>` and `subpath = <NAME>`.',
      '  • Do NOT put <NAME> into `ref`. `ref` is only for a git branch / tag / commit SHA (e.g. "main", "v1.2", "abc123").',
      '  • Example: user says "装 do-research from github.com/anthropics/skills"',
      '    → call `{ url: "https://github.com/anthropics/skills", subpath: "do-research" }`. NOT `{ url, ref: "do-research" }`.',
      'If you call without `subpath` and the repo has multiple SKILL.md files, the tool returns',
      '`{ kind: "skill-scanner-ambiguous", candidates: [{path: "<dir>/"}, …] }`. On that error you MUST retry the same tool',
      'with `subpath` set to one of the candidate directory names (strip the trailing "/") — do NOT put the candidate name into `ref`.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'Git URL (HTTPS or SSH on desktop; github.com HTTPS only on web). Example: https://github.com/anthropics/skills',
        },
        subpath: {
          type: 'string',
          description:
            'Directory inside the repository that contains SKILL.md. Use this for multi-skill monorepos. Example: if the skill lives at github.com/anthropics/skills/tree/main/do-research, set subpath to "do-research". MUST be a directory name relative to the repo root — never a git branch / tag / commit. Do not include leading or trailing slashes.',
        },
        ref: {
          type: 'string',
          description:
            'ONLY a git branch, tag, or commit SHA (examples: "main", "v1.2.0", "abc1234def"). NEVER a directory name or skill name. If you are trying to pick a specific skill inside a monorepo, use `subpath` instead. Defaults to the repo default branch when omitted.',
        },
        scope: SCOPE_PARAM,
        targetEmployeeId: TARGET_EMPLOYEE_PARAM,
      },
      required: ['url'],
    },
  },
  {
    name: 'install_skill_from_upload',
    description: [
      'Install a SKILL.md skill from a user-uploaded archive (zip / tar.gz) or a standalone SKILL.md. Always routes through a user confirmation preview.',
      'If the archive contains multiple SKILL.md files under different directories, call without `subpath` first; the tool returns',
      '`{ kind: "upload-multiple-skills", candidates: [{path: "<dir>/"}, …] }` and you MUST retry with `subpath` set to one of those directory names.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        fileRef: {
          type: 'string',
          description: 'Opaque handle to the user-attached file (surfaced by the chat UI).',
        },
        subpath: {
          type: 'string',
          description:
            'Directory inside the archive that contains SKILL.md. Use this when the archive holds multiple skills. Example: if the archive has "canva/SKILL.md" and "do-research/SKILL.md", pass subpath="do-research" to pick that one.',
        },
        scope: SCOPE_PARAM,
        targetEmployeeId: TARGET_EMPLOYEE_PARAM,
      },
      required: ['fileRef'],
    },
  },
  {
    name: 'sync_from_claude_code',
    description:
      'List skills available under the local Claude Code config (~/.claude/skills/ and per-project .claude/skills/). Desktop only.',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description:
            'Optional natural-language hint used to narrow candidate selection after the scan returns.',
        },
      },
    },
  },
  {
    name: 'sync_from_codex',
    description:
      'List skills available under the local Codex config (~/.codex/skills/). Desktop only.',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description:
            'Optional natural-language hint used to narrow candidate selection after the scan returns.',
        },
      },
    },
  },
  {
    name: 'fork_skill',
    description: [
      "Copy a COMPANY-scope skill into the calling employee's own employee-scope bucket.",
      'Use when the user says "fork <skill> for me" / "make my own version of <skill>". After fork the employee can call `edit_skill_body` to customize the body.',
      '`skillId` MUST reference an existing company-scope skill (look it up via the skills catalog in the system prompt).',
      '`targetEmployeeId` is optional — when omitted the fork targets the calling employee. A non-empty value MUST equal the calling employee id; cross-employee forks are rejected with `cross-employee-forbidden`.',
      'Always routes through a user confirmation preview — the tool itself never writes to disk.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description:
            'Skill id (sk_*) of the company-scope parent skill to fork. Use the id shown in the "Available skills" block in the system prompt.',
        },
        targetEmployeeId: {
          type: 'string',
          description:
            'OPTIONAL. Leave blank to fork to yourself (the normal case). If provided, MUST be your own employee id — forks to other employees are refused.',
        },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'edit_skill_body',
    description: [
      'Rewrite the BODY of one of YOUR OWN employee-scope skills. Frontmatter (name / description / allowedTools / license / version) is preserved automatically — do not put `---` frontmatter blocks in `newBody`.',
      'Use when the user says "simplify my <skill>", "tighten <skill>", "add a rule to my <skill>", etc.',
      "`skillId` MUST reference an EMPLOYEE-scope skill you own; editing company-scope or other employees' skills is rejected (`company-scope-forbidden` / `not-skill-owner`).",
      '`newBody` MUST be the full replacement body (≥ 10 bytes, ≤ 64 KiB, no frontmatter prefix). Always routes through a user confirmation preview with a side-by-side diff.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description:
            'Skill id (sk_*) of your own employee-scope skill to rewrite. Use the id from the system-prompt "Available skills" block.',
        },
        newBody: {
          type: 'string',
          description:
            'Full replacement SKILL.md body (markdown). Do NOT include a `---` frontmatter block — frontmatter is preserved byte-identically from the existing file.',
        },
      },
      required: ['skillId', 'newBody'],
    },
  },
  {
    name: 'create_skill_from_scratch',
    description: [
      'Create a new employee-scope skill from a full LLM-authored SKILL.md document. Always routes through a user confirmation preview — the tool itself never writes to disk.',
      '`skillBody` MUST include the YAML frontmatter block and markdown body. Required frontmatter: name, description. Optional: allowedTools, license, version. Unknown fields and offisim.* private fields are rejected.',
      '`targetEmployeeId` is optional. If provided, it MUST equal your own employee id; creating skills for a different employee is rejected.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        skillBody: {
          type: 'string',
          description: 'Full SKILL.md text including frontmatter and markdown body.',
        },
        targetEmployeeId: {
          type: 'string',
          description:
            'OPTIONAL. Leave blank to create for yourself. If provided, MUST equal your own employee id.',
        },
      },
      required: ['skillBody'],
    },
  },
]);

export function isSkillInstallTool(name: string): name is SkillInstallToolName {
  return (SKILL_INSTALL_TOOL_NAMES as readonly string[]).includes(name);
}
