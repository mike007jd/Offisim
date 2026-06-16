import type {
  InteractionRequest,
  SkillFrontmatterErrorPayload,
  SkillInstallConfirmBodyDiff,
  SkillInstallConfirmParent,
  SkillInstallSourceKind,
} from '@offisim/shared-types';
import { toErrorMessage } from '../errors.js';
import type { SkillRepository } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { InteractionService } from '../services/interaction-service.js';
import { byteLength } from '../utils/byte-length.js';
import type { SkillInstallSource, SkillLoader } from './skill-loader.js';
import { SkillFrontmatterError, parseSelfAuthoredSkillMd, parseSkillMd } from './skill-md.js';
import { skillSlug } from './skill-slug.js';
import { resolveClaudeCodeSync } from './skill-source-resolvers/claude-code.js';
import { resolveCodexSync } from './skill-source-resolvers/codex.js';
import { resolveGitSource } from './skill-source-resolvers/git.js';
import {
  type ScannedSkill,
  type VirtualTree,
  isResolverError,
} from './skill-source-resolvers/types.js';
import { resolveUploadSource } from './skill-source-resolvers/upload.js';
import type { SkillStagingManager } from './skill-staging.js';

import type { SkillInstallStructuredError } from './skill-install/errors.js';
import type { SkillInstallToolName } from './skill-install/tool-defs.js';
export {
  SKILL_INSTALL_TOOL_DEFS,
  SKILL_INSTALL_TOOL_NAMES,
  isSkillInstallTool,
} from './skill-install/tool-defs.js';
export type { SkillInstallToolName } from './skill-install/tool-defs.js';

interface CommonArgs {
  scope?: 'company' | 'employee';
  targetEmployeeId?: string;
}

type StagedSkillAction = 'install' | 'fork' | 'create';

function validateScope(
  args: CommonArgs,
):
  | { ok: true; scope: 'company' | 'employee'; identifier: string | null }
  | { ok: false; err: SkillInstallStructuredError } {
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

function syncFilterTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function filterSyncCandidates<
  T extends { slug: string; name: string; description: string; path: string },
>(candidates: readonly T[], filter: string | null): T[] {
  if (!filter) return [...candidates];
  const tokens = syncFilterTokens(filter);
  if (tokens.length === 0) return [...candidates];
  return candidates.filter((candidate) => {
    const haystack =
      `${candidate.slug} ${candidate.name} ${candidate.description} ${candidate.path}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, ' ');
    return tokens.every((token) => haystack.includes(token));
  });
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
        prompt: `Confirm fork of "${args.parent?.name ?? args.skillName}@${args.parent?.version ?? ''}" into ${args.targetLabel}.`,
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

type StagingServices =
  | { ok: true; stagingManager: SkillStagingManager; interactionService: InteractionService }
  | { ok: false; err: { kind: string; message: string } };

/**
 * Shared null-guard for the staging + interaction services that every
 * `stage*AndEmit` path requires before it can stage a preview.
 */
function validateStagingServices(ctx: RuntimeContext): StagingServices {
  const stagingManager = ctx.skillStagingManager;
  if (!stagingManager) {
    return {
      ok: false,
      err: {
        kind: 'skill-install-not-configured',
        message: 'Skill install staging is not available on this runtime.',
      },
    };
  }
  const interactionService = ctx.interactionService;
  if (!interactionService) {
    return {
      ok: false,
      err: {
        kind: 'skill-install-not-configured',
        message: 'Interaction service required for skill install preview.',
      },
    };
  }
  return { ok: true, stagingManager, interactionService };
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
  const services = validateStagingServices(ctx);
  if (!services.ok) return services.err;
  const { stagingManager, interactionService } = services;

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
      message: `SKILL.md could not be parsed: ${toErrorMessage(err)}`,
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
    interactionId: ctx.determinism.id('ix'),
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
      // Compute the preview slug the same way the committer does
      // (`skillSlug` over the parsed name) so the previewed slug matches the
      // slug eventually persisted. The id arg only feeds the non-ASCII
      // fallback, so passing the name keeps ASCII names byte-identical.
      ...(isCreateAction
        ? { skillMdText, slug: skillSlug(parsed.name, parsed.name), modelKey: args.modelKey }
        : {}),
      action: stagedAction,
      ...(args.parent !== undefined ? { parent: args.parent } : {}),
    },
    createdAt: ctx.determinism.nowMs(),
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
  const services = validateStagingServices(ctx);
  if (!services.ok) return services.err;
  const { stagingManager, interactionService } = services;

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
    interactionId: ctx.determinism.id('ix'),
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
      // `action: 'edit'` is the truthful discriminator consumers MUST branch on
      // for this path. `SkillInstallSourceKind` carries no `'edit'` member, so
      // `sourceKind` here is a non-provenance placeholder, NOT a claim that the
      // row was forked — the edited skill keeps its own DB `source_kind`.
      // `edit` ships no skillMdBody (body lives in staging) so the UI defers to
      // `bodyDiff`.
      sourceKind: 'fork' as SkillInstallSourceKind,
      sourceRef: args.sourceRefLabel,
      resolvedScope: 'employee',
      resolvedEmployeeId: args.employeeId,
      resolvedEmployeeName: args.employeeName,
      assetPaths: [],
      action: 'edit',
      bodyDiff: args.bodyDiff,
    },
    createdAt: ctx.determinism.nowMs(),
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
  // Uniform model-facing error shape. The UI already holds the emitted
  // interaction (it was just `request()`-ed), so the interaction id is not
  // surfaced in the JSON the LLM reasons over.
}): Promise<{ kind: string; reason: string; message: string }> {
  const interactionService = args.ctx.interactionService;
  if (!interactionService) {
    return {
      kind: 'skill-frontmatter-error',
      reason: args.error.reason,
      message: args.error.detail,
    };
  }

  const request: InteractionRequest = {
    interactionId: args.ctx.determinism.id('ix'),
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
      stagingRef: `invalid-${args.ctx.determinism.id('stg')}`,
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
    createdAt: args.ctx.determinism.nowMs(),
  };
  await interactionService.request(request);
  return {
    kind: 'skill-frontmatter-error',
    reason: args.error.reason,
    message: args.error.detail,
  };
}

function isWideScopePattern(pattern: string): boolean {
  // Flag the most-permissive forms whether or not a scope suffix follows:
  // bare `bash` / `Bash`, scoped `bash:*`, glob `bash*`, and Anthropic-style
  // `Bash(...)`. Case-folded so capitalized tool names are not missed.
  return /^(bash|network|fs|exec)(\b|[:*(])/iu.test(pattern.trim());
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
  projectId?: string | null,
): Promise<string> {
  try {
    return await handleSkillInstallToolInner(
      toolName,
      rawArgs,
      ctx,
      callerEmployeeId,
      callerModelKey,
      projectId,
    );
  } catch (err) {
    // Top-level catch so a T2.3 bug doesn't crash the tool-round promise. Stack
    // is dumped to DevTools for live-verify diagnosis; LLM receives a
    // structured error so it can retry or surface conversationally.
    logForkEditError(`handleSkillInstallTool/${toolName}`, err);
    return JSON.stringify({
      kind: 'skill-install-crashed',
      message: toErrorMessage(err),
    });
  }
}

async function handleSkillInstallToolInner(
  toolName: SkillInstallToolName,
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
  callerEmployeeId: string,
  callerModelKey: string,
  projectId?: string | null,
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

  const baseEnv = ctx.skillInstallEnvironment;
  const env = baseEnv?.forProject ? await baseEnv.forProject(projectId) : baseEnv;
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
          message: 'Uploads are unavailable in this runtime profile.',
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
      // Home and project-local `.claude/skills` roots can produce candidates
      // with identical slugs. `path` is the stable disambiguating selector:
      // `filterSyncCandidates` matches against it, so a caller can include a
      // path fragment (e.g. `.claude` for home vs the repo dir name for
      // project-local) in `filter` to narrow a slug collision down to a single
      // candidate before this stages it directly.
      const filter = typeof rawArgs.filter === 'string' ? rawArgs.filter.trim() || null : null;
      const result = await resolveClaudeCodeSync({
        runtime: env.runtime,
        ...(env.localDir !== undefined ? { localDir: env.localDir } : {}),
        ...(env.repoRoot !== undefined ? { repoRoot: env.repoRoot } : {}),
      });
      if (isResolverError(result)) return JSON.stringify(result);
      const selected = filterSyncCandidates(result.candidates, filter);
      const [onlyCandidate] = selected;
      if (selected.length === 1 && onlyCandidate) {
        return JSON.stringify(
          await stageAndEmit({
            ctx,
            tree: {
              files: [
                { path: 'SKILL.md', content: new TextEncoder().encode(onlyCandidate.skillMd) },
              ],
            },
            scan: {
              root: onlyCandidate.path,
              skillMdPath: 'SKILL.md',
              assetPaths: [],
            },
            source: { kind: 'claude-code', path: onlyCandidate.path },
            scope: 'company',
            employeeId: null,
            employeeName: null,
          }),
        );
      }
      return JSON.stringify({
        kind: 'sync-candidates',
        source: 'claude-code',
        candidates: selected.map((c) => ({
          slug: c.slug,
          name: c.name,
          description: c.description,
          path: c.path,
        })),
        totalCandidates: result.candidates.length,
        ...(filter ? { filter } : {}),
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
        : new SkillFrontmatterError('invalid-yaml', toErrorMessage(err));
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

type SkillMutationContext =
  | { ok: true; skillLoader: SkillLoader; skillsRepo: SkillRepository; skillId: string }
  | { ok: false; errorJson: string };

/**
 * Shared prelude for `fork_skill` / `edit_skill_body`: resolve the skill
 * runtime (loader + repo) and require a non-empty `skillId`. Both checks sit at
 * the top of each handler in the same order, so extracting them preserves the
 * original error precedence.
 */
function resolveSkillMutationContext(
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
): SkillMutationContext {
  const skillLoader = ctx.skillLoader;
  const skillsRepo = ctx.repos.skills;
  if (!skillLoader || !skillsRepo) {
    return {
      ok: false,
      errorJson: JSON.stringify({
        kind: 'skill-install-not-configured',
        message: 'Skill runtime not available.',
      }),
    };
  }
  const skillId = typeof rawArgs.skillId === 'string' ? rawArgs.skillId.trim() : '';
  if (!skillId) {
    return {
      ok: false,
      errorJson: JSON.stringify({ kind: 'missing-argument', message: 'skillId is required.' }),
    };
  }
  return { ok: true, skillLoader, skillsRepo, skillId };
}

type SkillRowLookup =
  | { ok: true; row: NonNullable<Awaited<ReturnType<SkillRepository['findById']>>> }
  | { ok: false; errorJson: string };

/**
 * Load a skill row for a fork/edit mutation and enforce existence + company
 * ownership — the contiguous lookup+guard block shared by both handlers. The
 * scope-specific checks (fork vs edit) stay inline in each caller.
 */
async function loadSkillForMutation(
  skillsRepo: SkillRepository,
  skillId: string,
  companyId: string,
  errScope: string,
): Promise<SkillRowLookup> {
  let row: Awaited<ReturnType<SkillRepository['findById']>>;
  try {
    row = await skillsRepo.findById(skillId);
  } catch (err) {
    logForkEditError(`${errScope}/skillsRepo.findById`, err);
    throw err;
  }
  if (!row) {
    return { ok: false, errorJson: JSON.stringify({ kind: 'skill-not-found', skillId }) };
  }
  if (row.company_id !== companyId) {
    return {
      ok: false,
      errorJson: JSON.stringify({
        kind: 'skill-not-found',
        skillId,
        message: 'Skill belongs to a different company.',
      }),
    };
  }
  return { ok: true, row };
}

async function handleForkSkill(
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
  callerEmployeeId: string,
): Promise<string> {
  const mutationCtx = resolveSkillMutationContext(rawArgs, ctx);
  if (!mutationCtx.ok) return mutationCtx.errorJson;
  const { skillLoader, skillsRepo, skillId } = mutationCtx;

  const targetEmployeeIdRaw =
    typeof rawArgs.targetEmployeeId === 'string' ? rawArgs.targetEmployeeId.trim() : '';
  if (targetEmployeeIdRaw && targetEmployeeIdRaw !== callerEmployeeId) {
    return JSON.stringify({
      kind: 'cross-employee-forbidden',
      message: 'fork_skill: cannot fork a skill to a different employee.',
    });
  }

  const parentLookup = await loadSkillForMutation(
    skillsRepo,
    skillId,
    ctx.companyId,
    'handleForkSkill',
  );
  if (!parentLookup.ok) return parentLookup.errorJson;
  const parentRow = parentLookup.row;
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
      message: `Failed to read parent skill: ${toErrorMessage(err)}`,
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
  const mutationCtx = resolveSkillMutationContext(rawArgs, ctx);
  if (!mutationCtx.ok) return mutationCtx.errorJson;
  const { skillLoader, skillsRepo, skillId } = mutationCtx;
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

  const rowLookup = await loadSkillForMutation(
    skillsRepo,
    skillId,
    ctx.companyId,
    'handleEditSkillBody',
  );
  if (!rowLookup.ok) return rowLookup.errorJson;
  const row = rowLookup.row;
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
      message: `Failed to read existing body: ${toErrorMessage(err)}`,
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
