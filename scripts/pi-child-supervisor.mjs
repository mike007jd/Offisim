// ChildAgentSupervisor — builds, runs, and re-stamps delegated child agents.
//
// Per Docs/DELEGATION_ARCHITECTURE.md, children run IN-PROCESS: the supervisor
// calls createAgentSession again inside the same Node host (live-proven by
// scripts/pi-delegation-smoke.mjs), reusing the host's auth/model registries and
// permission machinery. Rust owns only the root host process; aborting the root
// tears down the host and every descendant with it.
//
// Phase 2 adds parallel fan-out, deterministic limits (depth / concurrency /
// total / wall-clock timeout / output cap), and controlled recursion — a child
// itself receives a delegate tool (one level deeper), gated by the shared limits.
//
// The supervisor's only outward surface is the neutral `agentRun` wire line
// (scope fields + runType + opaque payload) — no Pi-specific vocabulary leaks to
// the renderer. The delegate tool (pi-delegation-extension.mjs) is its caller.

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { createLspDiagnosticsExtensionFactory } from '../apps/desktop/src-tauri/src/pi_agent_host/lsp_diagnostics_extension.mjs';
import {
  OneShotBudgetNudge,
  decideBoundedLoop,
  stableFailureSignature,
} from '../packages/core/dist/runtime/bounded-loop.js';
import { resolveApiRunUsage } from './agent-run-usage.mjs';
import {
  WORK_KINDS,
  agentRunLine,
  assertRunFailureKind,
  classifyRunFailure,
} from './pi-agent-host-wire.mjs';
import {
  WORK_TOOL_ALLOWLIST,
  normalizePermissionMode,
  toolAllowlistForMode,
} from './pi-agent-permission-modes.mts';
import { createDelegationExtensionFactory } from './pi-delegation-extension.mjs';
import { executionTargetDigest, runtimeModelRefFor } from './pi-execution-provenance.mjs';

// Capability band → exact child work-tool allowlist. No band may leave `tools`
// undefined because Pi would then auto-activate disk-loaded extension tools.
const ACCESS_TOOLS = {
  read: ['read', 'grep', 'find', 'ls'],
  review: ['read', 'grep', 'find', 'ls', 'bash'],
  write: [...WORK_TOOL_ALLOWLIST],
};

/** Intersect the delegated access band with the root conversation's permission
 * mode, then retain only the one controlled recursion capability. */
export function childToolsForPermissionMode(access, permissionMode) {
  const accessTools = ACCESS_TOOLS[access];
  const permissionTools = toolAllowlistForMode(normalizePermissionMode(permissionMode));
  const workTools = permissionTools.filter((tool) => accessTools.includes(tool));
  return [...new Set([...workTools, 'delegate'])];
}

// Model-visible output caps. Full transcript / tool timeline / usage stay in the
// telemetry events; only a bounded, structured summary reaches the root's model
// context. Per child: 4-8 KB target, 8 KB hard cap. Combined delegate tool
// result: 16-24 KB target, 24 KB hard cap. Truncation is byte-aware and always
// announced (never a silent cap).
const PER_CHILD_OUTPUT_CAP = 8 * 1024;
const COMBINED_OUTPUT_CAP = 24 * 1024;
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const VERIFY_SUMMARY_CAP = 4 * 1024;

// Deterministic host-policy defaults (Docs/DELEGATION_ARCHITECTURE.md §7). These
// are the only constraints code enforces; everything else is the agent's call.
export const DELEGATION_DEFAULTS = Object.freeze({
  maxDepth: 2, // 1 = root's direct children only; 2 = one level of recursion
  maxParallelPerDelegation: 4, // global active delegated-agent cap for one root run
  maxTotalChildren: 16, // across the whole tree for one root run
  childTimeoutMs: 5 * 60 * 1000, // wall-clock per child
  // Token budget across the whole delegation tree for one root run — the
  // loop-until-budget backstop for goal-directed iteration. Cost is unreliable
  // (some providers report 0), so the budget is token-based (input + output).
  // Generous by default (a runaway guard, not a tight cap); override per turn.
  maxTotalTokens: 2_000_000,
});

/**
 * Shared, mutable limit state for one root run's whole delegation tree. Total
 * children, active delegated agents, and token usage are global across every
 * recursive supervisor. A parent temporarily suspends its concurrency lease while
 * its delegate tool waits for descendants, preventing both global oversubscription
 * and recursive semaphore deadlock.
 */
export function createDelegationLimits(overrides = {}) {
  const cfg = { ...DELEGATION_DEFAULTS, ...overrides };
  const maxConcurrentAgents = Math.max(1, cfg.maxParallelPerDelegation);
  let totalSpawned = 0;
  const activeRuns = new Set();
  const waiters = [];
  const spentUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };

  const releaseWaiterSignal = (waiter) => {
    if (waiter.signal && waiter.abortHandler) {
      waiter.signal.removeEventListener('abort', waiter.abortHandler);
    }
  };
  const drainConcurrencyQueue = () => {
    while (activeRuns.size < maxConcurrentAgents && waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter.signal?.aborted) {
        releaseWaiterSignal(waiter);
        waiter.resolve(false);
        continue;
      }
      activeRuns.add(waiter.runId);
      releaseWaiterSignal(waiter);
      waiter.resolve(true);
    }
  };
  const releaseConcurrency = (runId) => {
    if (!activeRuns.delete(runId)) return false;
    drainConcurrencyQueue();
    return true;
  };

  return {
    ...cfg,
    maxParallelPerDelegation: maxConcurrentAgents,
    /** Reserve one of the global total-children budget; false when exhausted. */
    reserveTotal() {
      if (totalSpawned >= cfg.maxTotalChildren) return false;
      totalSpawned += 1;
      return true;
    },
    /** Acquire one global active-agent lease, FIFO and abort-aware. */
    acquireConcurrency(runId, signal) {
      if (activeRuns.has(runId)) return Promise.resolve(true);
      if (signal?.aborted) return Promise.resolve(false);
      if (activeRuns.size < maxConcurrentAgents) {
        activeRuns.add(runId);
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const waiter = { runId, signal, resolve, abortHandler: undefined };
        if (signal) {
          waiter.abortHandler = () => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            releaseWaiterSignal(waiter);
            resolve(false);
          };
          signal.addEventListener('abort', waiter.abortHandler, { once: true });
        }
        waiters.push(waiter);
      });
    },
    releaseConcurrency,
    /** A delegating parent is paused inside its tool call; release its active
     *  lease so descendants can run, then reacquire before returning to Pi. */
    suspendConcurrency(runId) {
      return releaseConcurrency(runId);
    },
    resumeConcurrency(runId, signal) {
      return this.acquireConcurrency(runId, signal);
    },
    concurrencyInUse() {
      return activeRuns.size;
    },
    /** Fold root or child usage into the tree-global budget total. */
    recordTokens(usage) {
      spentUsage.input += usage?.input || 0;
      spentUsage.output += usage?.output || 0;
      spentUsage.cacheRead += usage?.cacheRead || 0;
      spentUsage.cacheWrite += usage?.cacheWrite || 0;
      spentUsage.cost += typeof usage?.cost === 'number' ? usage.cost : usage?.cost?.total || 0;
      spentUsage.turns += usage?.turns || 0;
    },
    /** True once the tree's token spend has crossed the budget — gates the next
     *  delegation round so goal-directed loops terminate on budget. */
    budgetExceeded() {
      return this.spentTokens() >= cfg.maxTotalTokens;
    },
    spentTokens() {
      return spentUsage.input + spentUsage.output + spentUsage.cacheRead + spentUsage.cacheWrite;
    },
    usage() {
      return { ...spentUsage };
    },
  };
}

/** Integrate the isolated write leases produced by one completed delegate call.
 * Both single and parallel execution route through this function so a write
 * task can never finish with its committed work stranded in a child worktree. */
export async function integrateCompletedDelegation({
  tasks,
  runIds,
  leaseManager,
  rootLease,
  confirmIntegration,
  emitSnapshot,
}) {
  if (!leaseManager || !rootLease || !tasks.some((task) => task.access === 'write')) return '';
  const completedRunIds = new Set(runIds);
  const writableLeases = leaseManager
    .listLeases()
    .filter(
      (lease) =>
        completedRunIds.has(lease.runId) && lease.access === 'write' && lease.status === 'active',
    );
  if (writableLeases.length === 0) return '';
  const plan = await leaseManager.planIntegration(writableLeases);
  for (const lease of writableLeases) {
    await emitSnapshot(lease, 'planned', {
      conflicts: plan.conflicts
        .filter((conflict) => conflict.leaseIds.includes(lease.leaseId))
        .map((conflict) => conflict.path),
    });
  }
  if (plan.conflicts.length > 0) {
    const leaseById = new Map(writableLeases.map((lease) => [lease.leaseId, lease]));
    return [
      'Parallel write integration found conflicts and did not merge automatically.',
      ...plan.conflicts.flatMap((conflict) => {
        const rows = [`- ${conflict.path}:`];
        for (const leaseId of conflict.leaseIds) {
          const lease = leaseById.get(leaseId);
          rows.push(
            lease
              ? `  - ${leaseId}: ${lease.runId} ${lease.branch ?? '(no branch)'} at ${lease.cwd}`
              : `  - ${leaseId}: (lease details unavailable)`,
          );
        }
        return rows;
      }),
    ].join('\n');
  }
  if (plan.mergeable.length === 0) return 'No mergeable write leases were produced.';
  const merged = [];
  const skippedItems = [];
  let conflicted = null;
  for (const lease of plan.mergeable) {
    const approved = confirmIntegration
      ? await confirmIntegration({ ...plan, mergeable: [lease] })
      : false;
    if (!approved) {
      await emitSnapshot(lease, 'pending_review', {
        status: 'pending_review',
        reason: 'worktree is waiting for diff review',
      });
      continue;
    }
    const result = await leaseManager.integrate({ ...plan, mergeable: [lease] });
    merged.push(...result.merged);
    skippedItems.push(...result.skipped);
    conflicted = result.conflicted;
    for (const integrated of result.merged) await emitSnapshot(integrated, 'integrated');
    for (const integrated of result.merged) {
      const released = await leaseManager.releaseLease(integrated.leaseId).catch(() => null);
      if (released) await emitSnapshot(released, 'released_after_merge');
    }
    if (conflicted) break;
  }
  if (conflicted) {
    return `Integration stopped on merge conflict in lease ${conflicted.lease.leaseId}: ${conflicted.conflicts.join(', ')}`;
  }
  const skippedSummary =
    skippedItems.length > 0
      ? ` Skipped: ${skippedItems.map((item) => `${item.leaseId} (${item.reason})`).join('; ')}.`
      : '';
  const pending = plan.mergeable.length - merged.length;
  return `Merged ${merged.length} write lease(s); ${pending} awaiting review.${skippedSummary}`;
}

function normalizeAccess(access) {
  return access === 'write' || access === 'review' ? access : 'read';
}

const WORK_KIND_SET = new Set(WORK_KINDS);

/** Keep only a known WorkKind; an unknown value flows as undefined (never faked). */
function normalizeWorkKind(workKind) {
  return WORK_KIND_SET.has(workKind) ? workKind : undefined;
}

/**
 * Resolve a run's parent-child relation. An explicit relation wins; otherwise a
 * review-like task (review workKind or review access) defaults to `review`, and
 * everything else to `delegate`. `parallel` is never a relation — it is the
 * delegate tool's execution mode.
 */
function resolveRelation(task, access) {
  if (task.relation === 'delegate' || task.relation === 'review') {
    return task.relation;
  }
  if (normalizeWorkKind(task.workKind) === 'review' || access === 'review') return 'review';
  return 'delegate';
}

/** Byte-aware truncation to `cap`, always announced (never a silent cap). Cuts at
 *  a UTF-8 codepoint boundary (backs off any partial trailing codepoint) so the
 *  kept text never ends in a broken char. */
function capBytes(text, cap, label) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= cap) return text;
  let keep = cap;
  // Continuation bytes are 0b10xxxxxx — back off so we don't split a codepoint.
  while (keep > 0 && (buf[keep] & 0xc0) === 0x80) keep -= 1;
  const truncated = buf.subarray(0, keep).toString('utf8');
  return `${truncated}\n\n[Output truncated: ${buf.length - keep} bytes omitted (${label} ${cap / 1024} KB cap).]`;
}

// Structured child result. The child returns free-form text; this lifts a small
// set of labeled sections into a scannable shape so the root sees a compact
// result, not a raw transcript. Sections are optional — an unlabeled reply is
// summary-only. Full transcript / tool timeline / usage stay in telemetry events.
const RESULT_SECTION_KEYS = ['summary', 'artifacts', 'decisions', 'risks', 'verification'];

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve one delegated employee's exact execution binding before a session is
 * created. An employee with no model override inherits the already-frozen root
 * target. An explicit override must carry its own catalog-derived target and
 * runtime ref; the host never guesses account ownership or model provenance.
 */
export function resolveChildExecutionBinding({
  employee,
  rootModel,
  rootThinkingLevel,
  rootExpectedTarget,
  rootRuntimeModelRef,
  resolveModel,
}) {
  const requestedModel = asNonEmptyString(employee?.model);
  const requestedRuntimeModelRef = asNonEmptyString(employee?.runtimeModelRef);
  const requestedTarget = employee?.executionTarget;
  const hasExplicitBinding =
    requestedModel !== undefined ||
    requestedRuntimeModelRef !== undefined ||
    requestedTarget !== undefined;

  let model;
  let expectedTarget;
  let runtimeModelRef;
  if (!hasExplicitBinding) {
    expectedTarget = rootExpectedTarget;
    runtimeModelRef = asNonEmptyString(rootRuntimeModelRef);
    executionTargetDigest(expectedTarget, runtimeModelRef);
    model = rootModel;
    if (!model || runtimeModelRefFor(model) !== runtimeModelRef) {
      throw new Error('The inherited root model no longer matches its frozen execution target.');
    }
  } else {
    if (!isRecord(requestedTarget) || !requestedRuntimeModelRef) {
      throw new Error(
        'An employee model override requires an exact executionTarget and runtimeModelRef.',
      );
    }
    executionTargetDigest(requestedTarget, requestedRuntimeModelRef);
    for (const key of ['engineId', 'accountId', 'billingMode']) {
      if (requestedTarget[key] !== rootExpectedTarget?.[key]) {
        throw new Error(`A delegated model cannot switch ${key} from the root execution account.`);
      }
    }
    if (
      requestedModel &&
      requestedModel !== requestedRuntimeModelRef &&
      requestedModel !== requestedTarget.modelId
    ) {
      throw new Error('The employee model selector differs from its exact execution target.');
    }
    model = resolveModel?.(requestedRuntimeModelRef);
    if (!model || runtimeModelRefFor(model) !== requestedRuntimeModelRef) {
      throw new Error(`Employee runtime model was not found: ${requestedRuntimeModelRef}`);
    }
    expectedTarget = requestedTarget;
    runtimeModelRef = requestedRuntimeModelRef;
  }

  const requestedThinking = asNonEmptyString(employee?.thinkingLevel);
  if (requestedThinking && !THINKING_LEVELS.has(requestedThinking)) {
    throw new Error(`Employee thinking level is invalid: ${requestedThinking}`);
  }
  return {
    model,
    expectedTarget,
    runtimeModelRef,
    thinkingLevel: requestedThinking ?? rootThinkingLevel,
    inheritedModel: !hasExplicitBinding,
  };
}

function verificationSummary(result, cwd) {
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : -1;
  const combined = [result?.stdout, result?.stderr]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
    .replaceAll(cwd, '<workspace>')
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
    .trim();
  return capBytes(
    `Exit ${exitCode}${combined ? `\n${combined}` : '\n(no output)'}`,
    VERIFY_SUMMARY_CAP,
    'verification summary',
  );
}

export function buildVerificationRepairPrompt({
  attemptNumber,
  maxAttempts,
  command,
  verifySummary,
  budgetNudge,
}) {
  return [
    `Project verification failed on attempt ${attemptNumber}/${maxAttempts}.`,
    `Command: ${command}`,
    verifySummary,
    ...(budgetNudge ? ['', '# Budget convergence', budgetNudge.instruction] : []),
    '',
    'Continue in the same workspace. Fix the verified failure, then report the updated result.',
  ].join('\n');
}

const CHILD_RESULT_GUIDANCE = [
  'When you finish, end your reply with a concise structured result the lead can',
  'act on without reading your full transcript. Use these markdown headings, and',
  'omit any section that is empty:',
  '## Summary — 2-4 sentences on what you found or did.',
  '## Artifacts — files or paths you created or changed.',
  '## Decisions — choices you made and why.',
  '## Risks — caveats or follow-ups the lead should know.',
  '## Verification — how you checked the work.',
].join('\n');

/** Parse a child's reply into { summary, artifacts, decisions, risks, verification }.
 *  Leading prose (and anything under a `Summary` heading) is the summary; bullets
 *  under the other headings become list items. Heading-free replies stay
 *  summary-only — never a fabricated section. */
export function parseChildSummary(text) {
  const buckets = { summary: [], artifacts: [], decisions: [], risks: [], verification: [] };
  let current = 'summary';
  for (const line of text.split('\n')) {
    // A section header is a markdown heading (#…) or bold (**…**) that BEGINS with
    // a known section keyword — requiring the marker avoids treating a plain
    // content line like "Risks were mitigated" as a header. Any trailing text on
    // the same line (the child may write "## Artifacts — src/foo.ts") is captured
    // as that section's first item.
    const header = line
      .trim()
      .match(
        /^(?:#{1,6}\s*|\*\*)\s*(summary|artifacts|decisions|risks|verification)\b[*:：—–\- ]*(.*?)\**\s*$/i,
      );
    if (header) {
      current = header[1].toLowerCase();
      const rest = header[2].trim();
      if (rest) {
        if (current === 'summary') buckets.summary.push(rest);
        else buckets[current].push(rest.replace(/^[-*]\s*/, '').trim());
      }
      continue;
    }
    if (current === 'summary') {
      buckets.summary.push(line);
    } else {
      const item = line.replace(/^\s*[-*]\s*/, '').trim();
      if (item) buckets[current].push(item);
    }
  }
  return {
    summary: buckets.summary.join('\n').trim() || text.trim(),
    artifacts: buckets.artifacts,
    decisions: buckets.decisions,
    risks: buckets.risks,
    verification: buckets.verification,
  };
}

/** Render a structured summary back to compact text, capped per child. */
export function renderChildSummary(structured) {
  const parts = [structured.summary];
  for (const key of RESULT_SECTION_KEYS) {
    if (key === 'summary') continue;
    const items = structured[key];
    if (items.length > 0) {
      const heading = key[0].toUpperCase() + key.slice(1);
      parts.push(`${heading}:\n${items.map((i) => `- ${i}`).join('\n')}`);
    }
  }
  return capBytes(parts.filter(Boolean).join('\n\n'), PER_CHILD_OUTPUT_CAP, 'per-child');
}

/** Run items through fn with at most `limit` in flight (mirrors the official
 *  example). Excess tasks queue and start as slots free — this is the visible
 *  "exceeded maxParallelPerDelegation → queue" behavior. */
async function mapWithConcurrencyLimit(items, limit, fn) {
  if (items.length === 0) return [];
  const bound = Math.max(1, Math.min(limit, items.length));
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: bound }, async () => {
    while (true) {
      const current = next++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * @param {object} ctx
 * @param {(line: unknown) => void} ctx.emit
 * @param {string|undefined} ctx.agentDir
 * @param {object} ctx.authStorage
 * @param {object} ctx.modelRegistry
 * @param {string} ctx.cwd
 * @param {object} [ctx.leaseManager]
 * @param {object} [ctx.rootLease]
 * @param {(claim: object) => Promise<{cwd:string}>} [ctx.validateLeaseCwd]
 * @param {(plan: object) => Promise<boolean>} [ctx.confirmIntegration]
 * @param {object} ctx.settingsManager
 * @param {string} ctx.threadId
 * @param {string} ctx.rootRunId
 * @param {Array<{employeeId:string,name?:string,roleSlug?:string,persona?:string,model?:string,executionTarget?:object,runtimeModelRef?:string,thinkingLevel?:string}>} ctx.roster
 * @param {(modelId?: string) => object|undefined} ctx.resolveModel
 * @param {object|undefined} [ctx.rootModel] model explicitly selected for the parent run
 * @param {string|undefined} [ctx.rootThinkingLevel] thinking level selected for the parent run
 * @param {string|undefined} [ctx.permissionMode] root conversation permission mode inherited by every child
 * @param {(mode: string) => ((pi: unknown) => void)|null} ctx.buildPermissionGate
 * @param {(session: object) => Promise<void>} [ctx.bindChildUi] binds the existing renderer approval channel for Ask children
 * @param {(runId: string, session: object) => void} [ctx.onControlSessionReady] exposes a direct child as the outer run's steer target
 * @param {(runId: string, session: object) => void} [ctx.onControlSessionClosed] clears a previously exposed steer target
 * @param {(message: object) => void} [ctx.onControlMessage] observes durable control custom messages consumed by a child
 * @param {typeof createAgentSession} [ctx.createAgentSession] deterministic harness seam
 * @param {(options: object) => {reload: () => Promise<void>}} [ctx.createResourceLoader]
 * @param {(cwd: string) => object} [ctx.createSessionManager]
 * @param {object} ctx.limits           shared DelegationLimits (createDelegationLimits)
 * @param {number} [ctx.depth]          this supervisor's level (0 = root). Default 0.
 * @param {string|null} [ctx.projectId] project owning the workspace, when known
 * @param {string} [ctx.parentRunId]    run that owns this supervisor (default rootRunId)
 */
export function createChildSupervisor(ctx) {
  const roster = Array.isArray(ctx.roster) ? ctx.roster : [];
  // Built once at the root and threaded down through ctx — the roster is immutable
  // for the whole run, so recursive supervisors reuse the same lookup Map.
  const rosterById = ctx.rosterById ?? new Map(roster.map((entry) => [entry.employeeId, entry]));
  const depth = ctx.depth ?? 0;
  const parentRunId = ctx.parentRunId ?? ctx.rootRunId;
  const limits = ctx.limits;
  const childControllers = ctx.childControllers ?? new Map();

  function resolveEmployeeBinding(employee) {
    return resolveChildExecutionBinding({
      employee,
      rootModel: ctx.rootModel,
      rootThinkingLevel: ctx.rootThinkingLevel,
      rootExpectedTarget: ctx.expectedTarget,
      rootRuntimeModelRef: ctx.runtimeModelRef,
      resolveModel: ctx.resolveModel,
    });
  }

  async function workspaceLeaseSnapshotPayload(lease, phase, extra = {}) {
    let changedPaths = [];
    let files = [];
    if (lease?.access === 'write' && ctx.leaseManager?.collectDiff) {
      try {
        const diff = await ctx.leaseManager.collectDiff(lease);
        changedPaths = Array.isArray(diff?.changedPaths) ? diff.changedPaths : [];
        files = Array.isArray(diff?.files) ? diff.files : [];
      } catch {
        changedPaths = [];
      }
    }
    return {
      phase,
      projectId: typeof ctx.projectId === 'string' ? ctx.projectId : null,
      leaseId: lease.leaseId,
      runId: lease.runId,
      workspaceRoot: lease.workspaceRoot,
      access: lease.access,
      cwd: lease.cwd,
      branch: lease.branch ?? null,
      isolated: lease.isolated === true,
      status: lease.status,
      reason: lease.reason ?? null,
      createdAt: lease.createdAt,
      changedPaths,
      files,
      capturedAt: new Date().toISOString(),
      ...extra,
    };
  }

  async function emitWorkspaceLeaseSnapshot(emit, lease, phase, extra = {}) {
    emit('workspace.lease.snapshot', await workspaceLeaseSnapshotPayload(lease, phase, extra));
  }

  async function emitWorkspaceLeaseSnapshotLine(lease, phase, extra = {}) {
    ctx.emit(
      agentRunLine({
        threadId: ctx.threadId,
        rootRunId: ctx.rootRunId,
        runId: lease.runId,
        parentRunId: lease.runId === ctx.rootRunId ? undefined : ctx.rootRunId,
        runType: 'workspace.lease.snapshot',
        payload: await workspaceLeaseSnapshotPayload(lease, phase, extra),
      }),
    );
  }

  function emitWorkspaceCheckpoint(emit, lease, checkpoint) {
    emit('workspace.checkpoint', {
      ...checkpoint,
      projectId: typeof ctx.projectId === 'string' ? ctx.projectId : null,
      runId: lease.runId,
      workspaceRoot: lease.workspaceRoot,
      cwd: lease.cwd,
      branch: lease.branch,
    });
  }

  /** Build a per-run emitter that stamps this run's scope + relation + workKind
   *  onto every neutral agentRun line. relation/workKind are constant for a run,
   *  so they ride the closure rather than every call site. */
  function makeEmit(runId, employeeId, relation, workKind) {
    return (runType, payload) =>
      ctx.emit(
        agentRunLine({
          threadId: ctx.threadId,
          rootRunId: ctx.rootRunId,
          runId,
          parentRunId,
          employeeId,
          relation,
          workKind,
          runType,
          payload,
        }),
      );
  }

  /** Emit a never-started block as a terminal failure so it's visible (GUI +
   *  tool result) — caps are never silent. `failureKind` is the typed cause
   *  (RunFailureKind) from the structurally-known block site, never keyword-
   *  derived downstream. */
  function blocked(emit, reason, failureKind) {
    assertRunFailureKind(failureKind);
    emit('run.failed', { status: 'failed', failureKind, summary: reason });
    return `Delegation blocked: ${reason}`;
  }

  /** Emit an in-flight terminal failure. Every `run.failed` must route through
   *  here (or `blocked`) so the typed `failureKind` is validated at the emit
   *  boundary — no failure path can forget it, and nothing downstream
   *  keyword-parses the summary. */
  function failed(emit, failureKind, summary, usage) {
    assertRunFailureKind(failureKind);
    emit('run.failed', { status: 'failed', failureKind, summary, ...(usage ? { usage } : {}) });
  }

  async function runTask(task, signal) {
    const runId = `run-${randomUUID()}`;
    const access = normalizeAccess(task.access);
    const objective = typeof task.objective === 'string' ? task.objective.trim() : '';
    const relation = resolveRelation(task, access);
    const workKind = normalizeWorkKind(task.workKind);
    const employee = rosterById.get(task.employeeId);
    const emit = makeEmit(runId, task.employeeId, relation, workKind);

    if (!employee) {
      const available = roster.map((entry) => entry.employeeId).join(', ') || 'none';
      return {
        summary: blocked(
          emit,
          `Unknown teammate "${task.employeeId}". Available: ${available}.`,
          'runtime',
        ),
        runId,
        completed: false,
      };
    }
    if (!objective) {
      return {
        summary: blocked(emit, 'Delegation needs a non-empty objective.', 'runtime'),
        runId,
        completed: false,
      };
    }
    // Start the run now (valid teammate + objective) so even a policy-cap block
    // below leaves a durable agent_runs row — caps are never silent, at the DB
    // layer too. (Invalid-input blocks above stay event-only: their employeeId may
    // not exist, which would fail the row's employee FK.)
    let binding;
    try {
      binding = resolveEmployeeBinding(employee);
    } catch (error) {
      emit('run.started', {
        objective,
        access,
        projectId: ctx.projectId ?? null,
        ...(asNonEmptyString(task.originRunId) ? { originRunId: task.originRunId } : {}),
      });
      const message = error instanceof Error ? error.message : String(error);
      failed(emit, 'runtime', `Failed to start: ${message}`);
      return { summary: `Delegation failed: ${message}`, runId, completed: false };
    }
    emit('run.started', {
      objective,
      access,
      projectId: ctx.projectId ?? null,
      ...(asNonEmptyString(task.originRunId) ? { originRunId: task.originRunId } : {}),
      runtimeContextJson: JSON.stringify({
        runtime: 'api',
        model: binding.expectedTarget.modelId,
        runtimeModelRef: binding.runtimeModelRef,
        executionTarget: binding.expectedTarget,
        thinkingLevel: binding.thinkingLevel ?? null,
        inheritedModel: binding.inheritedModel,
      }),
    });
    // Depth cap — a child still carries a delegate tool, but spawning past maxDepth
    // is blocked with a reason (the plan's controlled-recursion contract).
    if (depth + 1 > limits.maxDepth) {
      return {
        summary: blocked(
          emit,
          `Max delegation depth (${limits.maxDepth}) reached — cannot delegate further.`,
          'runtime',
        ),
        runId,
        completed: false,
      };
    }
    // Token budget across the whole tree — the loop-until-budget backstop. Checked
    // before spawning so a goal-directed loop stops cleanly once spend crosses it.
    if (limits.budgetExceeded()) {
      return {
        summary: blocked(
          emit,
          `Delegation token budget (${limits.maxTotalTokens}) exhausted for this run.`,
          'budget',
        ),
        runId,
        completed: false,
      };
    }
    // Global total-children cap across the whole tree for this root run.
    if (!limits.reserveTotal()) {
      return {
        summary: blocked(
          emit,
          `Max total delegated agents (${limits.maxTotalChildren}) reached for this run.`,
          'runtime',
        ),
        runId,
        completed: false,
      };
    }

    const concurrencyAcquired = await limits.acquireConcurrency(runId, signal);
    if (!concurrencyAcquired) {
      const summary = 'Cancelled before a delegation concurrency slot became available.';
      emit('run.cancelled', { status: 'cancelled', summary });
      return { summary: `Delegation cancelled: ${summary}`, runId, completed: false };
    }

    const controller = new AbortController();
    childControllers.set(runId, controller);
    const abortFromParent = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromParent, { once: true });
    try {
      const childResult = await runChildSession(
        runId,
        emit,
        employee,
        binding,
        objective,
        access,
        controller.signal,
        task.resumeLease,
      );
      return {
        summary: childResult.summary,
        runId,
        completed: childResult.completed,
        model: binding.actualModel ?? binding.model,
        provenance: binding.actualProvenance,
      };
    } finally {
      signal?.removeEventListener('abort', abortFromParent);
      childControllers.delete(runId);
      limits.releaseConcurrency(runId);
    }
  }

  async function withParentConcurrencySuspended(signal, operation) {
    const suspended = limits.suspendConcurrency(parentRunId);
    try {
      return await operation();
    } finally {
      if (suspended && !signal?.aborted) {
        await limits.resumeConcurrency(parentRunId, signal);
      }
    }
  }

  async function runSingleWithMetadata(task, signal, options = {}) {
    return withParentConcurrencySuspended(signal, async () => {
      const result = await runTask(task, signal);
      const integration =
        result.completed && options.deferIntegration !== true
          ? await maybeIntegrateWrites([task], [result.runId])
          : '';
      return {
        text: capBytes(
          [result.summary, integration ? `Integration:\n${integration}` : '']
            .filter(Boolean)
            .join('\n\n---\n\n'),
          COMBINED_OUTPUT_CAP,
          'combined',
        ),
        completed: result.completed,
        model: result.model,
        provenance: result.provenance,
      };
    });
  }

  async function runSingle(task, signal) {
    return (await runSingleWithMetadata(task, signal)).text;
  }

  /** Start every requested task into the shared tree-wide lease queue. The
   *  global limiter, not a per-fan-out worker count, owns concurrency. */
  async function runParallel(tasks, signal) {
    return withParentConcurrencySuspended(signal, async () => {
      const summaries = await mapWithConcurrencyLimit(tasks, tasks.length || 1, (task) =>
        runTask(task, signal),
      );
      const integration = await maybeIntegrateWrites(
        tasks,
        summaries.filter((result) => result.completed).map((result) => result.runId),
      );
      const combined = tasks
        .map((task, i) => `### ${task.employeeId}\n${summaries[i]?.summary ?? '(no output)'}`)
        .concat(integration ? [`### Integration\n${integration}`] : [])
        .join('\n\n---\n\n');
      return capBytes(combined, COMBINED_OUTPUT_CAP, 'combined');
    });
  }

  async function runChildSession(
    runId,
    emit,
    employee,
    binding,
    objective,
    access,
    signal,
    resumeLease,
  ) {
    // The access band restricts WORK tools (read/write/bash). `delegate` is an
    // orchestration capability, not a work tool, so it must survive the allowlist
    // — otherwise a restricted-access child silently loses its delegate tool and
    // can never recurse. Every band stays explicit so Pi cannot auto-load tools.
    const permissionMode = normalizePermissionMode(ctx.permissionMode);
    const tools = childToolsForPermissionMode(access, permissionMode);
    const persona =
      typeof employee.persona === 'string' && employee.persona.trim()
        ? employee.persona.trim()
        : undefined;
    const { model, thinkingLevel } = binding;
    const skillPaths = Array.isArray(employee.skillPaths)
      ? employee.skillPaths.filter((path) => typeof path === 'string' && path.trim())
      : [];

    const gateFactory = ctx.buildPermissionGate ? ctx.buildPermissionGate(permissionMode) : null;
    // Controlled recursion: the child receives its own delegate tool, one level
    // deeper, parented at this child's runId. The depth cap in runSingle stops it
    // going past maxDepth.
    const childSupervisor = createChildSupervisor({
      ...ctx,
      rosterById,
      depth: depth + 1,
      parentRunId: runId,
      childControllers,
    });
    const childDelegationFactory = createDelegationExtensionFactory(childSupervisor);
    const extensionFactories = [gateFactory, childDelegationFactory].filter(Boolean);
    let lspDiagnosticsFactory = null;
    let lease = null;
    let taskWorkspaceLease = null;
    let childCwd = ctx.cwd;
    if (ctx.leaseManager && ctx.rootLease) {
      try {
        // A rework packet crosses the renderer wire; refuse one that points at a
        // different workspace than this run's root lease (adoptLease only checks
        // the packet's internal consistency, not which project it belongs to).
        if (resumeLease && resumeLease.workspaceRoot !== ctx.rootLease.workspaceRoot) {
          throw new Error('Rework lease belongs to a different workspace than this run.');
        }
        const leaseResult = resumeLease
          ? {
              outcome: 'granted',
              lease: ctx.leaseManager.adoptLease({
                ...resumeLease,
                runId,
                access: 'write',
                isolated: true,
                status: 'active',
              }),
            }
          : await ctx.leaseManager.acquireChildLease({
              rootLease: ctx.rootLease,
              runId,
              access,
            });
        if (leaseResult?.outcome === 'blocked') {
          return {
            summary: blocked(
              emit,
              `${leaseResult.reason} (blocked by ${leaseResult.blockedByRunId})`,
              'runtime',
            ),
            completed: false,
          };
        }
        lease = leaseResult?.lease ?? null;
        if (lease?.isolated) {
          if (!ctx.validateLeaseCwd) {
            throw new Error('Isolated workspace lease validation channel is unavailable.');
          }
          taskWorkspaceLease = {
            leaseId: lease.leaseId,
            // A rework run adopts the original registered lease under a fresh
            // agent run. Rust must compare the durable registration owner, not
            // the new UI run id.
            registeredRunId: asNonEmptyString(resumeLease?.runId) ?? lease.runId,
            workspaceRoot: lease.workspaceRoot,
            cwd: lease.cwd,
            branch: lease.branch,
          };
          const validated = await ctx.validateLeaseCwd(taskWorkspaceLease);
          if (!validated || validated.cwd !== lease.cwd) {
            throw new Error('Isolated workspace lease identity changed before child startup.');
          }
        }
        if (typeof lease?.cwd === 'string' && lease.cwd.trim()) {
          // Shared root leases inherit the sidecar's descriptor-bound `.` cwd.
          // Only isolated worktrees need their distinct registered lease path.
          childCwd = lease.isolated ? lease.cwd : ctx.cwd;
        }
        if (lease) {
          await emitWorkspaceLeaseSnapshot(emit, lease, 'acquired', {
            ...(asNonEmptyString(resumeLease?.runId) ? { originRunId: resumeLease.runId } : {}),
          });
        }
        if (lease?.isolated && access === 'write' && ctx.checkpointManager) {
          const existing = await ctx.checkpointManager.list(lease);
          const checkpoints =
            existing.length > 0 ? existing : await ctx.checkpointManager.open(lease);
          if (existing.length === 0 && checkpoints[0]) {
            emitWorkspaceCheckpoint(emit, lease, checkpoints[0]);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (lease) {
          if (resumeLease) {
            const retained = ctx.leaseManager?.adoptLease?.({
              ...lease,
              status: 'pending_review',
            });
            if (retained) {
              await emitWorkspaceLeaseSnapshot(emit, retained, 'rework_start_failed', {
                startError: message,
              });
            }
          } else {
            const released = await ctx.leaseManager
              ?.releaseLease?.(lease.leaseId)
              .catch(() => null);
            if (released) {
              await emitWorkspaceLeaseSnapshot(emit, released, 'released_after_authority_failure');
            }
          }
        }
        return {
          summary: blocked(emit, `Workspace lease failed: ${message}`, 'runtime'),
          completed: false,
        };
      }
    }
    const projectSkillPaths = Array.isArray(employee.projectSkillPaths)
      ? employee.projectSkillPaths
          .filter(
            (path) =>
              typeof path === 'string' &&
              path.endsWith('/SKILL.md') &&
              ['.claude/skills/', '.agents/skills/', '.opencode/skills/'].some((prefix) =>
                path.startsWith(prefix),
              ) &&
              !path.split('/').some((segment) => segment === '..' || segment === ''),
          )
          .map((path) => resolve(childCwd, path))
      : [];
    skillPaths.push(...projectSkillPaths);
    lspDiagnosticsFactory = createLspDiagnosticsExtensionFactory({
      cwd: childCwd,
      emitDiagnostics: (diagnostics) => emit('workspace.diagnostics.updated', diagnostics),
    });
    extensionFactories.push(lspDiagnosticsFactory);
    const effectiveObjective =
      lease?.isolated && access === 'write'
        ? [
            objective,
            '',
            'Workspace note: you are running in an isolated git worktree for this delegated write task. After making file changes, run git status, stage the changed files, and create a local commit on this worktree branch so the lead can review and merge it.',
          ].join('\n')
        : objective;

    // Session build can throw (loader reload / model resolution). run.started has
    // already fired, so a build failure MUST still emit a terminal event — and
    // runChildSession must never throw, so runParallel's Promise.all can't be
    // aborted by one child losing its siblings' terminals.
    let session;
    try {
      const resourceLoader = ctx.createResourceLoader
        ? ctx.createResourceLoader({
            cwd: childCwd,
            agentDir: ctx.agentDir,
            settingsManager: ctx.settingsManager,
            extensionFactories,
            appendSystemPrompt: persona
              ? [persona, CHILD_RESULT_GUIDANCE]
              : [CHILD_RESULT_GUIDANCE],
            ...(skillPaths.length > 0 ? { additionalSkillPaths: skillPaths } : {}),
          })
        : new DefaultResourceLoader({
            cwd: childCwd,
            agentDir: ctx.agentDir,
            settingsManager: ctx.settingsManager,
            extensionFactories,
            // Persona (if any) + the structured-result format the child should end on.
            appendSystemPrompt: persona
              ? [persona, CHILD_RESULT_GUIDANCE]
              : [CHILD_RESULT_GUIDANCE],
            ...(skillPaths.length > 0 ? { additionalSkillPaths: skillPaths } : {}),
          });
      await resourceLoader.reload();
      const createSession = ctx.createAgentSession ?? createAgentSession;
      let modelFallbackMessage;
      ({ session, modelFallbackMessage } = await createSession({
        cwd: childCwd,
        agentDir: ctx.agentDir,
        authStorage: ctx.authStorage,
        modelRegistry: ctx.modelRegistry,
        settingsManager: ctx.settingsManager,
        sessionManager: ctx.createSessionManager
          ? ctx.createSessionManager(childCwd)
          : SessionManager.inMemory(childCwd),
        ...(model ? { model } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
        tools,
        ...(taskWorkspaceLease ? { taskWorkspaceLease } : {}),
        resourceLoader,
      }));
      binding.actualModel = session.model ?? model;
      if (!ctx.executionTargetGate) {
        throw new Error('Child execution target gate is unavailable.');
      }
      binding.preparedExecution = await ctx.executionTargetGate.prepare({
        authStorage: ctx.authStorage,
        modelRegistry: ctx.modelRegistry,
        session,
        modelFallbackMessage,
        expectedTarget: binding.expectedTarget,
        runtimeModelRef: binding.runtimeModelRef,
        runId,
      });
      binding.actualProvenance = binding.preparedExecution.identity;
      if (permissionMode === 'ask' && ctx.bindChildUi) {
        await ctx.bindChildUi(session);
      }
    } catch (error) {
      session?.dispose?.();
      const message = error instanceof Error ? error.message : String(error);
      if (lease) {
        if (resumeLease) {
          const retained = ctx.leaseManager?.adoptLease?.({ ...lease, status: 'pending_review' });
          if (retained) {
            await emitWorkspaceLeaseSnapshot(emit, retained, 'rework_start_failed', {
              startError: message,
            });
          }
        } else {
          const released = await ctx.leaseManager?.releaseLease?.(lease.leaseId).catch(() => null);
          if (released)
            await emitWorkspaceLeaseSnapshot(emit, released, 'released_after_start_failure');
        }
      }
      failed(emit, 'runtime', `Failed to start: ${message}`);
      return { summary: `Delegation failed: ${message}`, completed: false };
    }

    const budgetUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    const runAssistantMessages = [];
    const usageSnapshot = () =>
      resolveApiRunUsage({
        messages: runAssistantMessages,
        provenance: binding.preparedExecution.identity,
        model: binding.actualModel ?? model,
        modelRegistry: ctx.modelRegistry,
      }).catch(() => undefined);
    let finalAssistant;
    let checkpointTail = Promise.resolve();
    let checkpointError = null;
    const queueCheckpoint = (toolName, toolCallId) => {
      if (!lease?.isolated || access !== 'write' || !ctx.checkpointManager) return;
      checkpointTail = checkpointTail
        .then(async () => {
          const checkpoint = await ctx.checkpointManager.captureAfterTool(lease, {
            toolName,
            toolCallId,
          });
          if (checkpoint) emitWorkspaceCheckpoint(emit, lease, checkpoint);
        })
        .catch((error) => {
          checkpointError = error;
        });
    };
    const flushCheckpoints = async () => {
      await checkpointTail;
      if (checkpointError) {
        const error = checkpointError;
        checkpointError = null;
        throw error;
      }
    };
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_end' && event.message?.role === 'custom') {
        ctx.onControlMessage?.(event.message);
        return;
      }
      if (event.type === 'tool_execution_start') {
        emit('tool.started', {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: 'started',
        });
        return;
      }
      if (event.type === 'tool_execution_end') {
        emit('tool.completed', {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.isError ? 'failed' : 'completed',
        });
        if (!event.isError) queueCheckpoint(event.toolName, event.toolCallId);
        return;
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        finalAssistant = event.message;
        runAssistantMessages.push(event.message);
        const u = event.message.usage;
        if (u) {
          budgetUsage.input += u.input || 0;
          budgetUsage.output += u.output || 0;
          budgetUsage.cacheRead += u.cacheRead || 0;
          budgetUsage.cacheWrite += u.cacheWrite || 0;
          budgetUsage.turns += 1;
        }
      }
    });

    let aborted = false;
    let timedOut = false;
    const onAbort = () => {
      aborted = true;
      void session.abort();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer =
      limits.childTimeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            void session.abort();
          }, limits.childTimeoutMs)
        : null;
    timer?.unref?.();
    let controlSessionExposed = false;

    try {
      const verifyConfig = access === 'write' ? ctx.verifyConfig : undefined;
      const loopConfigured = Boolean(verifyConfig?.command);
      const loopEnabled = Boolean(loopConfigured && ctx.requestVerifyResult && ctx.projectId);
      if (loopConfigured && !loopEnabled) {
        const reason = 'Project verification is configured but its sandbox channel is unavailable.';
        if (lease) {
          await emitWorkspaceLeaseSnapshot(emit, lease, 'verification_terminated', {
            loopAttempt: 0,
            loopMaxAttempts: verifyConfig.maxAttempts ?? 3,
            verificationSummary: reason,
            terminationReason: 'verification_infrastructure',
          });
        }
        failed(emit, 'runtime', reason, await usageSnapshot());
        return { summary: `Delegation failed: ${reason}`, completed: false };
      }
      const maxAttempts = Math.max(1, Math.min(20, verifyConfig?.maxAttempts ?? 3));
      const treeTokenBudget = Math.max(0, limits.maxTotalTokens - limits.spentTokens());
      const effectiveTokenBudget =
        verifyConfig?.tokenBudget === undefined
          ? treeTokenBudget
          : Math.min(verifyConfig.tokenBudget, treeTokenBudget);
      const budgetNudgeTracker = new OneShotBudgetNudge();
      let attemptNumber = 0;
      let previousFailureSignature;
      let prompt = effectiveObjective;

      for (;;) {
        attemptNumber += 1;
        finalAssistant = undefined;
        ctx.executionTargetGate.assertPrepared(binding.preparedExecution, session);
        const promptRun = session.prompt(prompt);
        if (!controlSessionExposed) {
          // A queued steer may trigger a turn as soon as the outer control
          // ledger sees a session. Start the child's objective first so the
          // queued review instruction joins that live turn instead of racing it
          // and causing Pi to reject a second concurrent prompt.
          ctx.onControlSessionReady?.(runId, session);
          controlSessionExposed = true;
        }
        await promptRun;
        await flushCheckpoints();
        const assistantError = asNonEmptyString(finalAssistant?.errorMessage);
        if (finalAssistant?.stopReason === 'error' || assistantError) {
          const message =
            assistantError ?? 'Pi Agent model returned an error stop without a message.';
          failed(emit, classifyRunFailure(message), message, await usageSnapshot());
          return { summary: `Delegation failed: ${message}`, completed: false };
        }
        if (timedOut) {
          const reason = `Timed out after ${Math.round(limits.childTimeoutMs / 1000)}s`;
          failed(emit, 'runtime', reason, await usageSnapshot());
          return { summary: `Delegation failed: ${reason}`, completed: false };
        }
        const assistantText = (session.getLastAssistantText() || '').trim();
        if (aborted) {
          const summary = assistantText
            ? renderChildSummary(parseChildSummary(assistantText))
            : 'Cancelled before the child produced output.';
          const usage = await usageSnapshot();
          emit('run.cancelled', { status: 'cancelled', summary, ...(usage ? { usage } : {}) });
          return { summary: `Delegation cancelled: ${summary}`, completed: false };
        }
        if (!assistantText) {
          const reason = 'Child completed without assistant output.';
          failed(emit, 'tool', reason, await usageSnapshot());
          return { summary: `Delegation failed: ${reason}`, completed: false };
        }
        const summary = renderChildSummary(parseChildSummary(assistantText));
        if (!loopEnabled) {
          const usage = await usageSnapshot();
          emit('run.completed', { status: 'completed', summary, ...(usage ? { usage } : {}) });
          return { summary, completed: true };
        }

        if (lease) {
          await emitWorkspaceLeaseSnapshot(emit, lease, 'verifying', {
            loopAttempt: attemptNumber,
            loopMaxAttempts: maxAttempts,
            verifyCommand: verifyConfig.command,
          });
        }
        const response = await ctx.requestVerifyResult({
          command: verifyConfig.command,
          cwd: childCwd,
          projectId: ctx.projectId,
        });
        if (!response || response.ok !== true || !response.result) {
          const reason = `Verification could not run: ${response?.error ?? 'unknown sandbox error'}`;
          if (lease) {
            await emitWorkspaceLeaseSnapshot(emit, lease, 'verification_terminated', {
              loopAttempt: attemptNumber,
              loopMaxAttempts: maxAttempts,
              verificationSummary: reason,
              terminationReason: 'verification_infrastructure',
            });
          }
          failed(emit, 'runtime', reason, await usageSnapshot());
          return { summary: `Delegation failed: ${reason}`, completed: false };
        }
        const verifyResult = response.result;
        const verifySummary = verificationSummary(verifyResult, childCwd);
        if (verifyResult.exitCode === 0) {
          if (lease) {
            await emitWorkspaceLeaseSnapshot(emit, lease, 'verified', {
              loopAttempt: attemptNumber,
              loopMaxAttempts: maxAttempts,
              verificationSummary: verifySummary,
              verificationPassed: true,
            });
          }
          const verifiedSummary = `${summary}\n\nVerification:\n- Attempt ${attemptNumber}/${maxAttempts}: passed\n- ${verifyConfig.command}`;
          const usage = await usageSnapshot();
          emit('run.completed', {
            status: 'completed',
            summary: verifiedSummary,
            ...(usage ? { usage } : {}),
          });
          return { summary: verifiedSummary, completed: true };
        }

        const failureSignature = stableFailureSignature([
          { id: 'project.verify', verdict: 'FAIL', summary: verifySummary },
        ]);
        const spentTokens = (budgetUsage.input || 0) + (budgetUsage.output || 0);
        const projectRemaining =
          verifyConfig.tokenBudget === undefined
            ? undefined
            : verifyConfig.tokenBudget - spentTokens;
        const treeRemaining = limits.maxTotalTokens - limits.spentTokens() - spentTokens;
        const tokenRemaining =
          projectRemaining === undefined
            ? treeRemaining
            : Math.min(projectRemaining, treeRemaining);
        const decision = decideBoundedLoop({
          attemptNumber,
          maxAttempts,
          failureSignature,
          previousFailureSignature,
          tokenRemaining,
        });
        if (decision.action === 'stop') {
          const terminationReason = decision.reason;
          const reason =
            terminationReason === 'stuck'
              ? 'Verification stopped because the same failure repeated.'
              : terminationReason === 'attempt_cap'
                ? `Verification stopped after ${maxAttempts} attempts.`
                : 'Verification stopped because the token budget was exhausted.';
          if (lease) {
            await emitWorkspaceLeaseSnapshot(emit, lease, 'verification_terminated', {
              loopAttempt: attemptNumber,
              loopMaxAttempts: maxAttempts,
              verificationSummary: verifySummary,
              verificationPassed: false,
              terminationReason,
            });
          }
          failed(
            emit,
            terminationReason === 'token_budget' ? 'budget' : 'tool',
            reason,
            await usageSnapshot(),
          );
          return {
            summary: `Delegation failed: ${reason}\n\n${verifySummary}`,
            completed: false,
          };
        }

        if (lease) {
          await emitWorkspaceLeaseSnapshot(emit, lease, 'repairing', {
            loopAttempt: attemptNumber,
            loopMaxAttempts: maxAttempts,
            verificationSummary: verifySummary,
            verificationPassed: false,
          });
        }
        previousFailureSignature = failureSignature;
        const budgetNudge = budgetNudgeTracker.next({
          tokenBudget: effectiveTokenBudget,
          tokenRemaining,
        });
        prompt = buildVerificationRepairPrompt({
          attemptNumber,
          maxAttempts,
          command: verifyConfig.command,
          verifySummary,
          budgetNudge,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // timedOut wins over aborted (a timeout calls session.abort() internally, so
      // both flags can be set in the race) — consistent with the try-branch which
      // checks timedOut first. A bare abort is a cancel (never a failureKind).
      // Anything else thrown from the session is host/provider machinery, not a
      // tool — classify from the message, defaulting 'runtime'.
      if (!timedOut && aborted) {
        const usage = await usageSnapshot();
        emit('run.cancelled', {
          status: 'cancelled',
          summary: message,
          ...(usage ? { usage } : {}),
        });
        return { summary: `Delegation cancelled: ${message}`, completed: false };
      }
      failed(
        emit,
        timedOut ? 'runtime' : classifyRunFailure(message),
        message,
        await usageSnapshot(),
      );
      return { summary: `Delegation failed: ${message}`, completed: false };
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
      if (controlSessionExposed) ctx.onControlSessionClosed?.(runId, session);
      await lspDiagnosticsFactory?.dispose?.();
      session.dispose();
      if (signal) signal.removeEventListener('abort', onAbort);
      await ctx.checkpointManager?.waitForIdle?.(lease?.leaseId).catch(() => undefined);
      if (lease && !(lease.isolated && access === 'write')) {
        const released = await ctx.leaseManager?.releaseLease?.(lease.leaseId).catch(() => null);
        if (released) await emitWorkspaceLeaseSnapshot(emit, released, 'released');
      }
      // Fold this child's token spend into the tree budget (whatever the outcome),
      // so the next delegation round sees it.
      limits.recordTokens(budgetUsage);
    }
  }

  async function maybeIntegrateWrites(tasks, runIds) {
    return integrateCompletedDelegation({
      tasks,
      runIds,
      leaseManager: ctx.leaseManager,
      rootLease: ctx.rootLease,
      confirmIntegration: ctx.confirmIntegration,
      emitSnapshot: emitWorkspaceLeaseSnapshotLine,
    });
  }

  return { runSingle, runSingleWithMetadata, runParallel, roster };
}
