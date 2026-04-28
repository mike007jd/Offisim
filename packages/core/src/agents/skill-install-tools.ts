import type {
  InteractionRequest,
  SkillFrontmatterErrorPayload,
  SkillInstallConfirmBodyDiff,
  SkillInstallConfirmParent,
  SkillInstallSourceKind,
} from '@offisim/shared-types';
import type { ToolDef } from '../llm/gateway.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { SkillInstallSource } from '../skills/skill-loader.js';
import {
  SkillFrontmatterError,
  parseSelfAuthoredSkillMd,
  parseSkillMd,
} from '../skills/skill-md.js';
import { resolveClaudeCodeSync } from '../skills/skill-source-resolvers/claude-code.js';
import { resolveCodexSync } from '../skills/skill-source-resolvers/codex.js';
import { resolveGitSource } from '../skills/skill-source-resolvers/git.js';
import {
  type ScannedSkill,
  type VirtualTree,
  isResolverError,
} from '../skills/skill-source-resolvers/types.js';
import { resolveUploadSource } from '../skills/skill-source-resolvers/upload.js';
import { byteLength } from '../utils/byte-length.js';
import { generateId } from '../utils/generate-id.js';

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

export function buildSkillInstallTools(): ToolDef[] {
  return SKILL_INSTALL_TOOL_DEFS as ToolDef[];
}

export function isSkillInstallTool(name: string): name is SkillInstallToolName {
  return (SKILL_INSTALL_TOOL_NAMES as readonly string[]).includes(name);
}

interface CommonArgs {
  scope?: 'company' | 'employee';
  targetEmployeeId?: string;
}

type StagedSkillAction = 'install' | 'fork' | 'create';

function validateScope(
  args: CommonArgs,
):
  | { ok: true; scope: 'company' | 'employee'; identifier: string | null }
  | { ok: false; err: { kind: string; message: string } } {
  const scope = args.scope ?? 'company';
  if (scope === 'employee') {
    if (!args.targetEmployeeId) {
      return {
        ok: false,
        err: {
          kind: 'missing-target-employee',
          message: 'scope="employee" requires a targetEmployeeId.',
        },
      };
    }
    return { ok: true, scope: 'employee', identifier: args.targetEmployeeId };
  }
  if (args.targetEmployeeId) {
    return {
      ok: false,
      err: {
        kind: 'scope-target-conflict',
        message: 'scope="company" must not carry a targetEmployeeId.',
      },
    };
  }
  return { ok: true, scope: 'company', identifier: null };
}

async function resolveTargetEmployee(
  ctx: RuntimeContext,
  identifier: string | null,
): Promise<
  | { ok: true; id: string | null; name: string | null }
  | {
      ok: false;
      err:
        | { kind: 'target-employee-not-found'; message: string }
        | {
            kind: 'target-employee-ambiguous';
            message: string;
            candidates: Array<{ employeeId: string; name: string; role: string }>;
          };
    }
> {
  if (!identifier) return { ok: true, id: null, name: null };

  const byId = await ctx.repos.employees.findById(identifier);
  if (byId) {
    if (byId.company_id !== ctx.companyId) {
      return {
        ok: false,
        err: {
          kind: 'target-employee-not-found',
          message: `Employee ${identifier} does not belong to company ${ctx.companyId}.`,
        },
      };
    }
    return { ok: true, id: byId.employee_id, name: byId.name };
  }

  const normalized = identifier.trim().toLowerCase();
  if (normalized.length === 0) {
    return {
      ok: false,
      err: {
        kind: 'target-employee-not-found',
        message: `Employee identifier "${identifier}" is empty.`,
      },
    };
  }
  const all = await ctx.repos.employees.findByCompany(ctx.companyId);
  const matches = all.filter((row) => row.name.trim().toLowerCase() === normalized);
  if (matches.length === 1) {
    const [only] = matches;
    if (only) return { ok: true, id: only.employee_id, name: only.name };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      err: {
        kind: 'target-employee-ambiguous',
        message: `"${identifier}" matches ${matches.length} employees; retry with the specific employee_id.`,
        candidates: matches.map((row) => ({
          employeeId: row.employee_id,
          name: row.name,
          role: row.role_slug,
        })),
      },
    };
  }
  return {
    ok: false,
    err: {
      kind: 'target-employee-not-found',
      message: `No employee in company ${ctx.companyId} matches "${identifier}" (tried id lookup then case-insensitive name match).`,
    },
  };
}

function logForkEditError(scope: string, err: unknown): void {
  // Structured stack dump for T2.3 live-verify. Logs are best-effort — if
  // `console.error` itself errors (should never happen in webview), swallow.
  try {
    const stack =
      err instanceof Error
        ? `${err.name}: ${err.message}\n${err.stack ?? '(no stack)'}`
        : String(err);
    console.error(`[skill-${scope}] ${stack}`);
  } catch {
    /* noop */
  }
}

function buildSkillInstallConfirmCopy(args: {
  action: StagedSkillAction;
  skillName: string;
  scope: 'company' | 'employee';
  targetLabel: string;
  parent?: SkillInstallConfirmParent | undefined;
}): { title: string; prompt: string; confirmLabel: string } {
  switch (args.action) {
    case 'create':
      return {
        title: `Create skill "${args.skillName}"?`,
        prompt: `Confirm creation of "${args.skillName}" for ${args.targetLabel}.`,
        confirmLabel: 'Create skill',
      };
    case 'fork':
      return {
        title: `Fork skill "${args.skillName}"?`,
        prompt: `Confirm fork of "${args.parent?.name ?? args.skillName}@${args.parent?.version ?? ''} into ${args.targetLabel}.`,
        confirmLabel: 'Fork',
      };
    case 'install':
      return {
        title: `Install skill "${args.skillName}"?`,
        prompt: `Confirm installation of "${args.skillName}" into ${
          args.scope === 'company' ? 'the whole company.' : `${args.targetLabel}.`
        }`,
        confirmLabel: 'Install',
      };
  }
}

async function stageAndEmit(args: {
  ctx: RuntimeContext;
  tree: VirtualTree;
  scan: ScannedSkill;
  source: SkillInstallSource;
  scope: 'company' | 'employee';
  employeeId: string | null;
  employeeName: string | null;
  tmpPath?: string | undefined;
  cleanup?: (() => Promise<void>) | undefined;
  /** `'fork'` / `'create'` employee-scope mutations; defaults to `'install'`. */
  action?: StagedSkillAction;
  parent?: SkillInstallConfirmParent;
  modelKey?: string | undefined;
}): Promise<
  | { status: 'pending-confirm'; interactionId: string; stagingRef: string }
  | { kind: string; message: string }
> {
  const { ctx, tree, scan } = args;
  const stagingManager = ctx.skillStagingManager;
  if (!stagingManager) {
    return {
      kind: 'skill-install-not-configured',
      message: 'Skill install staging is not available on this runtime.',
    };
  }
  const interactionService = ctx.interactionService;
  if (!interactionService) {
    return {
      kind: 'skill-install-not-configured',
      message: 'Interaction service required for skill install preview.',
    };
  }

  const skillMdFile = tree.files.find((f) => f.path === scan.skillMdPath);
  if (!skillMdFile) {
    return {
      kind: 'skill-md-invalid',
      message: 'Scanner reported SKILL.md path but it is missing from the tree.',
    };
  }
  let skillMdText: string;
  try {
    skillMdText = new TextDecoder('utf-8').decode(skillMdFile.content);
  } catch (err) {
    logForkEditError('stageAndEmit/decode-skillmd', err);
    throw err;
  }
  let parsed: ReturnType<typeof parseSkillMd>;
  try {
    parsed = parseSkillMd(skillMdText);
  } catch (err) {
    logForkEditError('stageAndEmit/parseSkillMd', err);
    return {
      kind: 'skill-md-invalid',
      message: `SKILL.md could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const stagedAction: StagedSkillAction =
    args.action ?? (args.source.kind === 'fork' ? 'fork' : 'install');
  let staged: { stagingRef: string };
  try {
    staged = stagingManager.put({
      action: stagedAction,
      tree,
      scan,
      name: parsed.name,
      description: parsed.description,
      allowedTools: parsed.allowedTools ?? [],
      skillMdText,
      source: args.source,
      companyId: ctx.companyId,
      scope: args.scope,
      employeeId: args.employeeId,
      ...(args.tmpPath !== undefined ? { tmpPath: args.tmpPath } : {}),
      ...(args.cleanup !== undefined ? { cleanup: args.cleanup } : {}),
    });
  } catch (err) {
    logForkEditError('stageAndEmit/stagingManager.put', err);
    throw err;
  }

  const sourceRefLabel = describeSource(args.source);
  const isCreateAction = stagedAction === 'create';
  const targetLabel = args.employeeName ?? 'the selected employee';
  const copy = buildSkillInstallConfirmCopy({
    action: stagedAction,
    skillName: parsed.name,
    scope: args.scope,
    targetLabel,
    parent: args.parent,
  });
  const request: InteractionRequest = {
    interactionId: generateId('ix'),
    threadId: ctx.threadId,
    companyId: ctx.companyId,
    kind: 'skill_install_confirm',
    severity: parsed.allowedTools?.some(isWideScopePattern) ? 'high' : 'normal',
    title: copy.title,
    prompt: copy.prompt,
    options: [
      { id: 'confirm', label: copy.confirmLabel },
      { id: 'cancel', label: 'Cancel' },
    ],
    allowFreeformResponse: false,
    requestedByNode: 'employee-node',
    context: {
      type: 'skill_install_confirm',
      stagingRef: staged.stagingRef,
      skillName: parsed.name,
      skillDescription: parsed.description,
      allowedTools: parsed.allowedTools ?? [],
      sourceKind: args.source.kind as SkillInstallSourceKind,
      sourceRef: sourceRefLabel,
      resolvedScope: args.scope,
      resolvedEmployeeId: args.employeeId,
      resolvedEmployeeName: args.employeeName,
      assetPaths: scan.assetPaths,
      skillMdBody: parsed.body,
      ...(isCreateAction ? { skillMdText, slug: parsed.name, modelKey: args.modelKey } : {}),
      action: stagedAction,
      ...(args.parent !== undefined ? { parent: args.parent } : {}),
    },
    createdAt: Date.now(),
  };
  try {
    await interactionService.request(request);
  } catch (err) {
    logForkEditError('stageAndEmit/interactionService.request', err);
    throw err;
  }
  return {
    status: 'pending-confirm',
    interactionId: request.interactionId,
    stagingRef: staged.stagingRef,
  };
}

/**
 * Stage an edit mutation and emit a `skill_install_confirm` interaction with
 * `action='edit'`. Unlike install/fork, edit has no tree + no scan; staging
 * holds just the newBody string. The UI renders a truncated-preview diff
 * sourced from the caller-supplied `bodyDiff`.
 */
async function stageEditAndEmit(args: {
  ctx: RuntimeContext;
  skillId: string;
  employeeId: string;
  newBody: string;
  skillName: string;
  skillDescription: string;
  allowedTools: readonly string[];
  bodyDiff: SkillInstallConfirmBodyDiff;
  /** source_ref of the row — used for UI display only. */
  sourceRefLabel: string;
  employeeName: string | null;
}): Promise<
  | { status: 'pending-confirm'; interactionId: string; stagingRef: string }
  | { kind: string; message: string }
> {
  const { ctx } = args;
  const stagingManager = ctx.skillStagingManager;
  if (!stagingManager) {
    return {
      kind: 'skill-install-not-configured',
      message: 'Skill install staging is not available on this runtime.',
    };
  }
  const interactionService = ctx.interactionService;
  if (!interactionService) {
    return {
      kind: 'skill-install-not-configured',
      message: 'Interaction service required for skill install preview.',
    };
  }

  let staged: { stagingRef: string };
  try {
    staged = stagingManager.put({
      action: 'edit',
      skillId: args.skillId,
      newBody: args.newBody,
      employeeId: args.employeeId,
      companyId: ctx.companyId,
    });
  } catch (err) {
    logForkEditError('stageEditAndEmit/stagingManager.put', err);
    throw err;
  }

  const targetLabel = args.employeeName ?? 'you';
  const request: InteractionRequest = {
    interactionId: generateId('ix'),
    threadId: ctx.threadId,
    companyId: ctx.companyId,
    kind: 'skill_install_confirm',
    severity: 'normal',
    title: `Edit skill "${args.skillName}"?`,
    prompt: `Confirm body rewrite for ${targetLabel}'s "${args.skillName}".`,
    options: [
      { id: 'confirm', label: 'Save' },
      { id: 'cancel', label: 'Cancel' },
    ],
    allowFreeformResponse: false,
    requestedByNode: 'employee-node',
    context: {
      type: 'skill_install_confirm',
      stagingRef: staged.stagingRef,
      skillName: args.skillName,
      skillDescription: args.skillDescription,
      allowedTools: args.allowedTools,
      // Existing skill — the row has its own source; fork/install rail keeps
      // the union coherent. `edit` doesn't ship a skillMdBody (body lives in
      // staging) so the UI defers to `bodyDiff`.
      sourceKind: 'fork' as SkillInstallSourceKind,
      sourceRef: args.sourceRefLabel,
      resolvedScope: 'employee',
      resolvedEmployeeId: args.employeeId,
      resolvedEmployeeName: args.employeeName,
      assetPaths: [],
      action: 'edit',
      bodyDiff: args.bodyDiff,
    },
    createdAt: Date.now(),
  };
  try {
    await interactionService.request(request);
  } catch (err) {
    logForkEditError('stageEditAndEmit/interactionService.request', err);
    throw err;
  }
  return {
    status: 'pending-confirm',
    interactionId: request.interactionId,
    stagingRef: staged.stagingRef,
  };
}

function toFrontmatterPayload(err: SkillFrontmatterError): SkillFrontmatterErrorPayload {
  return {
    reason: err.reason,
    detail: err.detail,
    ...(err.field !== undefined ? { field: err.field } : {}),
  };
}

async function emitSelfAuthoringFrontmatterError(args: {
  ctx: RuntimeContext;
  skillBody: string;
  employeeId: string;
  employeeName: string | null;
  modelKey: string;
  error: SkillFrontmatterError;
}): Promise<{ kind: string; message: string; reason: string; interactionId?: string }> {
  const interactionService = args.ctx.interactionService;
  if (!interactionService) {
    return {
      kind: 'skill-frontmatter-error',
      reason: args.error.reason,
      message: args.error.detail,
    };
  }

  const request: InteractionRequest = {
    interactionId: generateId('ix'),
    threadId: args.ctx.threadId,
    companyId: args.ctx.companyId,
    kind: 'skill_install_confirm',
    severity: 'normal',
    title: 'Skill frontmatter needs revision',
    prompt: args.error.detail,
    options: [
      { id: 'retry', label: 'Retry' },
      { id: 'cancel', label: 'Cancel' },
    ],
    allowFreeformResponse: false,
    requestedByNode: 'employee-node',
    context: {
      type: 'skill_install_confirm',
      stagingRef: `invalid-${generateId('stg')}`,
      skillName: 'Invalid SKILL.md',
      skillDescription: 'The generated SKILL.md did not pass the self-authoring whitelist.',
      allowedTools: [],
      sourceKind: 'self-authored',
      sourceRef: `llm-author:${args.modelKey}`,
      resolvedScope: 'employee',
      resolvedEmployeeId: args.employeeId,
      resolvedEmployeeName: args.employeeName,
      assetPaths: [],
      skillMdBody: '',
      skillMdText: args.skillBody,
      modelKey: args.modelKey,
      frontmatterError: toFrontmatterPayload(args.error),
      action: 'create',
    },
    createdAt: Date.now(),
  };
  await interactionService.request(request);
  return {
    kind: 'skill-frontmatter-error',
    reason: args.error.reason,
    message: args.error.detail,
    interactionId: request.interactionId,
  };
}

function isWideScopePattern(pattern: string): boolean {
  return /^(bash|network|fs|exec)(:|\*)/iu.test(pattern);
}

function describeSource(source: SkillInstallSource): string {
  switch (source.kind) {
    case 'marketplace':
      return `marketplace:${source.listingId}`;
    case 'git': {
      const base = source.ref ? `${source.url}@${source.ref}` : source.url;
      return source.subpath ? `${base} · ${source.subpath}` : base;
    }
    case 'upload':
      return source.subpath ? `${source.filename} · ${source.subpath}` : source.filename;
    case 'claude-code':
      return source.path;
    case 'codex':
      return source.path;
    case 'fork':
      return `company-skill:${source.parentSkillId}@${source.parentVersion}`;
    case 'self-authored':
      return `llm-author:${source.modelKey}`;
  }
}

export interface SkillInstallToolResult {
  /** JSON-ish serializable result. Pending-confirm is the happy path; otherwise structured errors. */
  value: unknown;
}

/**
 * Entry point for all skill-mutation tool calls (install-family + T2.3 fork +
 * edit). Always returns a string (the tool executor contract) — callers unwrap
 * via JSON.parse if they need structured access. Every error path is a
 * structured JSON so the LLM can reason about it instead of crashing.
 *
 * `callerEmployeeId` identifies the employee whose turn issued the tool call;
 * fork / edit handlers use it for self-ownership and cross-employee guards.
 * Install-family tools ignore it and continue to rely on `targetEmployeeId` /
 * `scope` arguments.
 */
export async function handleSkillInstallTool(
  toolName: SkillInstallToolName,
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
  callerEmployeeId: string,
  callerModelKey = 'unknown/unknown',
): Promise<string> {
  try {
    return await handleSkillInstallToolInner(
      toolName,
      rawArgs,
      ctx,
      callerEmployeeId,
      callerModelKey,
    );
  } catch (err) {
    // Top-level catch so a T2.3 bug doesn't crash the tool-round promise. Stack
    // is dumped to DevTools for live-verify diagnosis; LLM receives a
    // structured error so it can retry or surface conversationally.
    logForkEditError(`handleSkillInstallTool/${toolName}`, err);
    return JSON.stringify({
      kind: 'skill-install-crashed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleSkillInstallToolInner(
  toolName: SkillInstallToolName,
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
  callerEmployeeId: string,
  callerModelKey: string,
): Promise<string> {
  // Fork / edit have their own dispatch — no install environment required.
  if (toolName === 'fork_skill') {
    return handleForkSkill(rawArgs, ctx, callerEmployeeId);
  }
  if (toolName === 'edit_skill_body') {
    return handleEditSkillBody(rawArgs, ctx, callerEmployeeId);
  }
  if (toolName === 'create_skill_from_scratch') {
    return handleCreateSkillFromScratch(rawArgs, ctx, callerEmployeeId, callerModelKey);
  }

  const env = ctx.skillInstallEnvironment;
  if (!env) {
    return JSON.stringify({
      kind: 'skill-install-not-configured',
      message: 'Skill install environment is not available on this runtime.',
    });
  }

  const commonCheck = validateScope(rawArgs as CommonArgs);
  if (!commonCheck.ok) return JSON.stringify(commonCheck.err);

  const target = await resolveTargetEmployee(ctx, commonCheck.identifier);
  if (!target.ok) return JSON.stringify(target.err);
  const resolvedEmployeeId = target.id;

  switch (toolName) {
    case 'install_skill_from_git': {
      const url = String(rawArgs.url ?? '');
      if (!url) return JSON.stringify({ kind: 'missing-argument', message: 'url is required.' });
      const ref = typeof rawArgs.ref === 'string' ? rawArgs.ref : undefined;
      const subpath =
        typeof rawArgs.subpath === 'string' && rawArgs.subpath.length > 0
          ? rawArgs.subpath
          : undefined;
      const result = await resolveGitSource(
        { url, ref, subpath },
        {
          runtime: env.runtime,
          httpFetch: env.httpFetch,
          ...(env.clone !== undefined ? { clone: env.clone } : {}),
          ...(env.gitFs !== undefined ? { localFs: env.gitFs } : {}),
        },
      );
      if (isResolverError(result)) return JSON.stringify(result);
      const tmpPath = result.tmpPath;
      const gitFs = env.gitFs;
      const staged = await stageAndEmit({
        ctx,
        tree: result.tree,
        scan: result.scan,
        source: {
          kind: 'git',
          url,
          ...(ref !== undefined ? { ref } : {}),
          ...(subpath !== undefined ? { subpath } : {}),
        },
        scope: commonCheck.scope,
        employeeId: resolvedEmployeeId,
        employeeName: target.name,
        ...(tmpPath !== undefined ? { tmpPath } : {}),
        ...(tmpPath !== undefined && gitFs ? { cleanup: () => gitFs.cleanup(tmpPath) } : {}),
      });
      return JSON.stringify(staged);
    }

    case 'install_skill_from_upload': {
      const fileRef = String(rawArgs.fileRef ?? '');
      if (!fileRef)
        return JSON.stringify({ kind: 'missing-argument', message: 'fileRef is required.' });
      if (!env.uploadResolver) {
        return JSON.stringify({
          kind: 'upload-not-available',
          message: 'Uploads are not wired on this runtime.',
        });
      }
      const payload = await env.uploadResolver.resolve(fileRef);
      if (!payload) {
        return JSON.stringify({
          kind: 'upload-ref-unknown',
          message: `Upload ref "${fileRef}" not found.`,
        });
      }
      const subpath =
        typeof rawArgs.subpath === 'string' && rawArgs.subpath.length > 0
          ? rawArgs.subpath
          : undefined;
      const result = resolveUploadSource({
        filename: payload.filename,
        bytes: payload.bytes,
        ...(subpath !== undefined ? { subpath } : {}),
      });
      if (isResolverError(result)) return JSON.stringify(result);
      const staged = await stageAndEmit({
        ctx,
        tree: result.tree,
        scan: result.scan,
        source: {
          kind: 'upload',
          filename: payload.filename,
          ...(subpath !== undefined ? { subpath } : {}),
        },
        scope: commonCheck.scope,
        employeeId: resolvedEmployeeId,
        employeeName: target.name,
      });
      return JSON.stringify(staged);
    }

    case 'sync_from_claude_code': {
      const result = await resolveClaudeCodeSync({
        runtime: env.runtime,
        ...(env.localDir !== undefined ? { localDir: env.localDir } : {}),
        ...(env.repoRoot !== undefined ? { repoRoot: env.repoRoot } : {}),
      });
      if (isResolverError(result)) return JSON.stringify(result);
      return JSON.stringify({
        kind: 'sync-candidates',
        source: 'claude-code',
        candidates: result.candidates.map((c) => ({
          slug: c.slug,
          name: c.name,
          description: c.description,
          path: c.path,
        })),
      });
    }

    case 'sync_from_codex': {
      const result = await resolveCodexSync({
        runtime: env.runtime,
        ...(env.localDir !== undefined ? { localDir: env.localDir } : {}),
      });
      if (isResolverError(result)) return JSON.stringify(result);
      return JSON.stringify({
        kind: 'sync-candidates',
        source: 'codex',
        candidates: result.candidates.map((c) => ({
          slug: c.slug,
          name: c.name,
          description: c.description,
          path: c.path,
        })),
      });
    }
  }
}

const MAX_EDIT_BODY_BYTES = 64 * 1024;
const MIN_EDIT_BODY_BYTES = 10;
const BODY_PREVIEW_LIMIT = 160;
const MAX_CREATE_SKILL_BYTES = 96 * 1024;

/**
 * Truncate to at most `limit` UTF-16 code units with a trailing ellipsis when
 * clamped. Matches the preview contract the UI expects (160 code units).
 */
function trimPreview(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

async function handleCreateSkillFromScratch(
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
  callerEmployeeId: string,
  modelKey: string,
): Promise<string> {
  const skillBody = typeof rawArgs.skillBody === 'string' ? rawArgs.skillBody : '';
  if (!skillBody.trim()) {
    return JSON.stringify({ kind: 'missing-argument', message: 'skillBody is required.' });
  }
  if (byteLength(skillBody) > MAX_CREATE_SKILL_BYTES) {
    return JSON.stringify({
      kind: 'skill-body-too-large',
      message: `skillBody must be ≤ ${MAX_CREATE_SKILL_BYTES} bytes.`,
    });
  }

  const targetEmployeeIdRaw =
    typeof rawArgs.targetEmployeeId === 'string' ? rawArgs.targetEmployeeId.trim() : '';
  if (targetEmployeeIdRaw && targetEmployeeIdRaw !== callerEmployeeId) {
    return JSON.stringify({
      kind: 'target-employee-mismatch',
      message: 'Skill author must match the active chat employee',
    });
  }

  const employeeRow = await ctx.repos.employees.findById(callerEmployeeId).catch(() => null);
  if (!employeeRow || employeeRow.company_id !== ctx.companyId) {
    return JSON.stringify({
      kind: 'target-employee-not-found',
      message: `Employee ${callerEmployeeId} not found in company ${ctx.companyId}.`,
    });
  }

  try {
    parseSelfAuthoredSkillMd(skillBody);
  } catch (err) {
    const frontmatterError =
      err instanceof SkillFrontmatterError
        ? err
        : new SkillFrontmatterError(
            'invalid-yaml',
            err instanceof Error ? err.message : String(err),
          );
    const emitted = await emitSelfAuthoringFrontmatterError({
      ctx,
      skillBody,
      employeeId: employeeRow.employee_id,
      employeeName: employeeRow.name,
      modelKey,
      error: frontmatterError,
    });
    return JSON.stringify(emitted);
  }

  const tree: VirtualTree = {
    files: [{ path: 'SKILL.md', content: new TextEncoder().encode(skillBody) }],
  };
  const scan: ScannedSkill = {
    root: '',
    skillMdPath: 'SKILL.md',
    assetPaths: [],
  };

  return JSON.stringify(
    await stageAndEmit({
      ctx,
      tree,
      scan,
      source: { kind: 'self-authored', modelKey },
      scope: 'employee',
      employeeId: employeeRow.employee_id,
      employeeName: employeeRow.name,
      action: 'create',
      modelKey,
    }),
  );
}

async function handleForkSkill(
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
  callerEmployeeId: string,
): Promise<string> {
  const skillLoader = ctx.skillLoader;
  const skillsRepo = ctx.repos.skills;
  if (!skillLoader || !skillsRepo) {
    return JSON.stringify({
      kind: 'skill-install-not-configured',
      message: 'Skill runtime not available.',
    });
  }

  const skillId = typeof rawArgs.skillId === 'string' ? rawArgs.skillId.trim() : '';
  if (!skillId) {
    return JSON.stringify({ kind: 'missing-argument', message: 'skillId is required.' });
  }

  const targetEmployeeIdRaw =
    typeof rawArgs.targetEmployeeId === 'string' ? rawArgs.targetEmployeeId.trim() : '';
  if (targetEmployeeIdRaw && targetEmployeeIdRaw !== callerEmployeeId) {
    return JSON.stringify({
      kind: 'cross-employee-forbidden',
      message: 'fork_skill: cannot fork a skill to a different employee.',
    });
  }

  let parentRow: Awaited<ReturnType<typeof skillsRepo.findById>>;
  try {
    parentRow = await skillsRepo.findById(skillId);
  } catch (err) {
    logForkEditError('handleForkSkill/skillsRepo.findById', err);
    throw err;
  }
  if (!parentRow) {
    return JSON.stringify({ kind: 'skill-not-found', skillId });
  }
  if (parentRow.company_id !== ctx.companyId) {
    return JSON.stringify({
      kind: 'skill-not-found',
      skillId,
      message: 'Skill belongs to a different company.',
    });
  }
  if (parentRow.scope !== 'company') {
    return JSON.stringify({
      kind: 'fork-parent-not-company',
      message: 'Only company-scope skills can be forked.',
      skillId,
    });
  }

  let bundle: Awaited<ReturnType<typeof skillLoader.readSkillDirectory>>;
  try {
    bundle = await skillLoader.readSkillDirectory(skillId);
  } catch (err) {
    logForkEditError('handleForkSkill/readSkillDirectory', err);
    return JSON.stringify({
      kind: 'skill-md-invalid',
      message: `Failed to read parent skill: ${err instanceof Error ? err.message : String(err)}`,
      skillId,
    });
  }

  let tree: VirtualTree;
  let scan: ScannedSkill;
  try {
    const skillMdBytes = new TextEncoder().encode(bundle.skillMd);
    tree = {
      files: [
        { path: 'SKILL.md', content: skillMdBytes },
        ...bundle.assets.map((asset) => ({
          path: asset.relPath,
          content: new TextEncoder().encode(asset.content),
        })),
      ],
    };
    scan = {
      root: '',
      skillMdPath: 'SKILL.md',
      assetPaths: bundle.assets.map((a) => a.relPath),
    };
  } catch (err) {
    logForkEditError('handleForkSkill/tree-construct', err);
    throw err;
  }

  let targetEmployeeRow: Awaited<ReturnType<typeof ctx.repos.employees.findById>>;
  try {
    targetEmployeeRow = await ctx.repos.employees.findById(callerEmployeeId);
  } catch (err) {
    logForkEditError('handleForkSkill/employees.findById', err);
    throw err;
  }

  const staged = await stageAndEmit({
    ctx,
    tree,
    scan,
    source: {
      kind: 'fork',
      parentSkillId: parentRow.skill_id,
      parentVersion: parentRow.version,
    },
    scope: 'employee',
    employeeId: callerEmployeeId,
    employeeName: targetEmployeeRow?.name ?? null,
    action: 'fork',
    parent: {
      skillId: parentRow.skill_id,
      slug: parentRow.slug,
      name: parentRow.name,
      version: parentRow.version,
    },
  });
  return JSON.stringify(staged);
}

async function handleEditSkillBody(
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
  callerEmployeeId: string,
): Promise<string> {
  const skillLoader = ctx.skillLoader;
  const skillsRepo = ctx.repos.skills;
  if (!skillLoader || !skillsRepo) {
    return JSON.stringify({
      kind: 'skill-install-not-configured',
      message: 'Skill runtime not available.',
    });
  }

  const skillId = typeof rawArgs.skillId === 'string' ? rawArgs.skillId.trim() : '';
  if (!skillId) {
    return JSON.stringify({ kind: 'missing-argument', message: 'skillId is required.' });
  }
  const newBody = typeof rawArgs.newBody === 'string' ? rawArgs.newBody : '';

  const byteLen = byteLength(newBody);
  if (byteLen < MIN_EDIT_BODY_BYTES) {
    return JSON.stringify({
      kind: 'invalid-new-body',
      reason: 'empty',
      message: `newBody must be at least ${MIN_EDIT_BODY_BYTES} bytes.`,
    });
  }
  if (byteLen > MAX_EDIT_BODY_BYTES) {
    return JSON.stringify({
      kind: 'invalid-new-body',
      reason: 'too-large',
      message: `newBody must be ≤ ${MAX_EDIT_BODY_BYTES} bytes.`,
    });
  }
  if (newBody.startsWith('---\n') || newBody.startsWith('---\r\n')) {
    return JSON.stringify({
      kind: 'invalid-new-body',
      reason: 'frontmatter-in-body',
      message:
        'newBody must not begin with a `---` frontmatter block; frontmatter is preserved automatically.',
    });
  }

  let row: Awaited<ReturnType<typeof skillsRepo.findById>>;
  try {
    row = await skillsRepo.findById(skillId);
  } catch (err) {
    logForkEditError('handleEditSkillBody/skillsRepo.findById', err);
    throw err;
  }
  if (!row) {
    return JSON.stringify({ kind: 'skill-not-found', skillId });
  }
  if (row.company_id !== ctx.companyId) {
    return JSON.stringify({
      kind: 'skill-not-found',
      skillId,
      message: 'Skill belongs to a different company.',
    });
  }
  if (row.scope === 'company') {
    return JSON.stringify({
      kind: 'company-scope-forbidden',
      message: 'edit_skill_body: cannot edit company-scope skills.',
      skillId,
    });
  }
  if (row.employee_id !== callerEmployeeId) {
    return JSON.stringify({
      kind: 'not-skill-owner',
      message: 'edit_skill_body: only the owning employee can edit this skill.',
      skillId,
    });
  }

  let oldBody = '';
  try {
    oldBody = await skillLoader.loadSkillBody(skillId);
  } catch (err) {
    logForkEditError('handleEditSkillBody/loadSkillBody', err);
    return JSON.stringify({
      kind: 'skill-md-invalid',
      message: `Failed to read existing body: ${err instanceof Error ? err.message : String(err)}`,
      skillId,
    });
  }

  let employeeRow: Awaited<ReturnType<typeof ctx.repos.employees.findById>>;
  try {
    employeeRow = await ctx.repos.employees.findById(callerEmployeeId);
  } catch (err) {
    logForkEditError('handleEditSkillBody/employees.findById', err);
    throw err;
  }

  return JSON.stringify(
    await stageEditAndEmit({
      ctx,
      skillId,
      employeeId: callerEmployeeId,
      newBody,
      skillName: row.name,
      skillDescription: row.description,
      allowedTools: [],
      bodyDiff: {
        oldPreview: trimPreview(oldBody, BODY_PREVIEW_LIMIT),
        newPreview: trimPreview(newBody, BODY_PREVIEW_LIMIT),
      },
      sourceRefLabel: row.source_ref ?? '',
      employeeName: employeeRow?.name ?? null,
    }),
  );
}
