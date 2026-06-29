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
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { WORK_KINDS, agentRunLine } from './pi-agent-host-wire.mjs';
import { createDelegationExtensionFactory } from './pi-delegation-extension.mjs';

// Capability band → child tool allowlist. `write` returns undefined so Pi enables
// its full default tool set; the others are restrictive subsets.
const ACCESS_TOOLS = {
  read: ['read', 'grep', 'find', 'ls'],
  review: ['read', 'grep', 'find', 'ls', 'bash'],
  write: undefined,
};

// Model-visible output caps. Full transcript / tool timeline / usage stay in the
// telemetry events; only a bounded, structured summary reaches the root's model
// context. Per child: 4-8 KB target, 8 KB hard cap. Combined delegate tool
// result: 16-24 KB target, 24 KB hard cap. Truncation is byte-aware and always
// announced (never a silent cap).
const PER_CHILD_OUTPUT_CAP = 8 * 1024;
const COMBINED_OUTPUT_CAP = 24 * 1024;

// Deterministic host-policy defaults (Docs/DELEGATION_ARCHITECTURE.md §7). These
// are the only constraints code enforces; everything else is the agent's call.
export const DELEGATION_DEFAULTS = Object.freeze({
  maxDepth: 2, // 1 = root's direct children only; 2 = one level of recursion
  maxParallelPerDelegation: 4, // per parallel fan-out (not a global run-tree cap)
  maxTotalChildren: 16, // across the whole tree for one root run
  childTimeoutMs: 5 * 60 * 1000, // wall-clock per child
  // Token budget across the whole delegation tree for one root run — the
  // loop-until-budget backstop for goal-directed iteration. Cost is unreliable
  // (some providers report 0), so the budget is token-based (input + output).
  // Generous by default (a runaway guard, not a tight cap); override per turn.
  maxTotalTokens: 2_000_000,
});

/**
 * Shared, mutable limit state for one root run's whole delegation tree. The
 * total-children counter is global (every supervisor level shares it); concurrency
 * is enforced *locally* per parallel fan-out (no global blocking semaphore — a
 * parent waiting on its children must never hold a slot a child needs, which would
 * deadlock recursive delegation).
 */
export function createDelegationLimits(overrides = {}) {
  const cfg = { ...DELEGATION_DEFAULTS, ...overrides };
  let totalSpawned = 0;
  let spentTokens = 0;
  return {
    ...cfg,
    maxParallelPerDelegation: Math.max(1, cfg.maxParallelPerDelegation),
    /** Reserve one of the global total-children budget; false when exhausted. */
    reserveTotal() {
      if (totalSpawned >= cfg.maxTotalChildren) return false;
      totalSpawned += 1;
      return true;
    },
    /** Fold a finished child's token usage into the tree-global running total. */
    recordTokens(usage) {
      spentTokens += (usage?.input || 0) + (usage?.output || 0);
    },
    /** True once the tree's token spend has crossed the budget — gates the next
     *  delegation round so goal-directed loops terminate on budget. */
    budgetExceeded() {
      return spentTokens >= cfg.maxTotalTokens;
    },
    spentTokens() {
      return spentTokens;
    },
  };
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
 * @param {(plan: object) => Promise<boolean>} [ctx.confirmIntegration]
 * @param {object} ctx.settingsManager
 * @param {string} ctx.threadId
 * @param {string} ctx.rootRunId
 * @param {Array<{employeeId:string,name?:string,roleSlug?:string,persona?:string,model?:string}>} ctx.roster
 * @param {(modelId?: string) => object|undefined} ctx.resolveModel
 * @param {object|undefined} [ctx.rootModel] model explicitly selected for the parent run
 * @param {(mode: string) => ((pi: unknown) => void)|null} ctx.buildPermissionGate
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

  async function workspaceLeaseSnapshotPayload(lease, phase, extra = {}) {
    let changedPaths = [];
    if (lease?.access === 'write' && ctx.leaseManager?.collectDiff) {
      try {
        const diff = await ctx.leaseManager.collectDiff(lease);
        changedPaths = Array.isArray(diff?.changedPaths) ? diff.changedPaths : [];
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
      changedPaths,
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
   *  tool result) — caps are never silent. */
  function blocked(emit, reason) {
    emit('run.failed', { status: 'failed', summary: reason });
    return `Delegation blocked: ${reason}`;
  }

  async function runSingle(task, signal) {
    const runId = `run-${randomUUID()}`;
    const access = normalizeAccess(task.access);
    const objective = typeof task.objective === 'string' ? task.objective.trim() : '';
    const relation = resolveRelation(task, access);
    const workKind = normalizeWorkKind(task.workKind);
    const employee = rosterById.get(task.employeeId);
    const emit = makeEmit(runId, task.employeeId, relation, workKind);

    if (!employee) {
      const available = roster.map((entry) => entry.employeeId).join(', ') || 'none';
      return blocked(emit, `Unknown teammate "${task.employeeId}". Available: ${available}.`);
    }
    if (!objective) {
      return blocked(emit, 'Delegation needs a non-empty objective.');
    }
    // Start the run now (valid teammate + objective) so even a policy-cap block
    // below leaves a durable agent_runs row — caps are never silent, at the DB
    // layer too. (Invalid-input blocks above stay event-only: their employeeId may
    // not exist, which would fail the row's employee FK.)
    emit('run.started', { objective, access });
    // Depth cap — a child still carries a delegate tool, but spawning past maxDepth
    // is blocked with a reason (the plan's controlled-recursion contract).
    if (depth + 1 > limits.maxDepth) {
      return blocked(
        emit,
        `Max delegation depth (${limits.maxDepth}) reached — cannot delegate further.`,
      );
    }
    // Token budget across the whole tree — the loop-until-budget backstop. Checked
    // before spawning so a goal-directed loop stops cleanly once spend crosses it.
    if (limits.budgetExceeded()) {
      return blocked(
        emit,
        `Delegation token budget (${limits.maxTotalTokens}) exhausted for this run.`,
      );
    }
    // Global total-children cap across the whole tree for this root run.
    if (!limits.reserveTotal()) {
      return blocked(
        emit,
        `Max total delegated agents (${limits.maxTotalChildren}) reached for this run.`,
      );
    }

    return runChildSession(runId, emit, employee, objective, access, signal);
  }

  async function runChildSession(runId, emit, employee, objective, access, signal) {
    // The access band restricts WORK tools (read/write/bash). `delegate` is an
    // orchestration capability, not a work tool, so it must survive the allowlist
    // — otherwise a restricted-access child silently loses its delegate tool and
    // can never recurse. `write` (undefined = all tools) already includes it.
    const accessTools = ACCESS_TOOLS[access];
    const tools = accessTools ? [...accessTools, 'delegate'] : accessTools;
    const persona =
      typeof employee.persona === 'string' && employee.persona.trim()
        ? employee.persona.trim()
        : undefined;
    const requestedModel = asNonEmptyString(employee.model);
    const model = requestedModel
      ? (ctx.resolveModel(requestedModel) ?? ctx.rootModel)
      : ctx.rootModel;

    // Children always run under the Auto gate: a no-op for read access (no bash
    // tool) and a catastrophic-bash block for review/write — without needing a UI
    // binding the headless child can't satisfy.
    const gateFactory = ctx.buildPermissionGate ? ctx.buildPermissionGate('auto') : null;
    // Controlled recursion: the child receives its own delegate tool, one level
    // deeper, parented at this child's runId. The depth cap in runSingle stops it
    // going past maxDepth.
    const childSupervisor = createChildSupervisor({
      ...ctx,
      rosterById,
      depth: depth + 1,
      parentRunId: runId,
    });
    const childDelegationFactory = createDelegationExtensionFactory(childSupervisor);
    const extensionFactories = [gateFactory, childDelegationFactory].filter(Boolean);
    let lease = null;
    let childCwd = ctx.cwd;
    if (ctx.leaseManager && ctx.rootLease) {
      try {
        const leaseResult = await ctx.leaseManager.acquireChildLease({
          rootLease: ctx.rootLease,
          runId,
          access,
        });
        if (leaseResult?.outcome === 'blocked') {
          return blocked(emit, `${leaseResult.reason} (blocked by ${leaseResult.blockedByRunId})`);
        }
        lease = leaseResult?.lease ?? null;
        if (typeof lease?.cwd === 'string' && lease.cwd.trim()) {
          childCwd = lease.cwd;
        }
        if (lease) await emitWorkspaceLeaseSnapshot(emit, lease, 'acquired');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return blocked(emit, `Workspace lease failed: ${message}`);
      }
    }
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
      const resourceLoader = new DefaultResourceLoader({
        cwd: childCwd,
        agentDir: ctx.agentDir,
        settingsManager: ctx.settingsManager,
        extensionFactories,
        // Persona (if any) + the structured-result format the child should end on.
        appendSystemPrompt: persona ? [persona, CHILD_RESULT_GUIDANCE] : [CHILD_RESULT_GUIDANCE],
      });
      await resourceLoader.reload();
      ({ session } = await createAgentSession({
        cwd: childCwd,
        agentDir: ctx.agentDir,
        authStorage: ctx.authStorage,
        modelRegistry: ctx.modelRegistry,
        sessionManager: SessionManager.inMemory(childCwd),
        ...(model ? { model } : {}),
        ...(tools ? { tools } : {}),
        resourceLoader,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (lease) {
        const released = await ctx.leaseManager?.releaseLease?.(lease.leaseId).catch(() => null);
        if (released)
          await emitWorkspaceLeaseSnapshot(emit, released, 'released_after_start_failure');
      }
      emit('run.failed', {
        status: 'failed',
        summary: `Failed to start: ${message}`,
      });
      return `Delegation failed: ${message}`;
    }

    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
    let finalAssistant;
    const unsubscribe = session.subscribe((event) => {
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
        return;
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        finalAssistant = event.message;
        const u = event.message.usage;
        if (u) {
          usage.input += u.input || 0;
          usage.output += u.output || 0;
          usage.cacheRead += u.cacheRead || 0;
          usage.cacheWrite += u.cacheWrite || 0;
          usage.cost += u.cost?.total || 0;
          usage.turns += 1;
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

    try {
      await session.prompt(effectiveObjective);
      const assistantError = asNonEmptyString(finalAssistant?.errorMessage);
      if (finalAssistant?.stopReason === 'error' || assistantError) {
        const message =
          assistantError ?? 'Pi Agent model returned an error stop without a message.';
        emit('run.failed', { status: 'failed', summary: message, usage });
        return `Delegation failed: ${message}`;
      }
      // Lift the child's reply into a bounded, structured result — the only thing
      // the root model sees; the full transcript stays in telemetry.
      const assistantText = (session.getLastAssistantText() || '').trim();
      if (!assistantText) {
        const reason = 'Child completed without assistant output.';
        emit('run.failed', { status: 'failed', summary: reason, usage });
        return `Delegation failed: ${reason}`;
      }
      const summary = renderChildSummary(parseChildSummary(assistantText));
      if (timedOut) {
        const reason = `Timed out after ${Math.round(limits.childTimeoutMs / 1000)}s`;
        emit('run.failed', { status: 'failed', summary: reason, usage });
        return `Delegation failed: ${reason}`;
      }
      if (aborted) {
        emit('run.cancelled', { status: 'cancelled', summary, usage });
        return `Delegation cancelled: ${summary}`;
      }
      emit('run.completed', { status: 'completed', summary, usage });
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // timedOut wins over aborted (a timeout calls session.abort() internally, so
      // both flags can be set in the race) — consistent with the try-branch which
      // checks timedOut first. A bare abort is a cancel; anything else is a failure.
      const status = timedOut ? 'failed' : aborted ? 'cancelled' : 'failed';
      emit(status === 'cancelled' ? 'run.cancelled' : 'run.failed', {
        status,
        summary: message,
        usage,
      });
      return `Delegation ${status}: ${message}`;
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
      session.dispose();
      if (signal) signal.removeEventListener('abort', onAbort);
      if (lease && !(lease.isolated && access === 'write')) {
        const released = await ctx.leaseManager?.releaseLease?.(lease.leaseId).catch(() => null);
        if (released) await emitWorkspaceLeaseSnapshot(emit, released, 'released');
      }
      // Fold this child's token spend into the tree budget (whatever the outcome),
      // so the next delegation round sees it.
      limits.recordTokens(usage);
    }
  }

  /** Run multiple tasks concurrently, capped at maxParallelPerDelegation (excess
   *  queues). Returns a combined, per-teammate summary for the calling agent,
   *  bounded by the combined-result cap so a wide fan-out can't blow the root
   *  context even though each child is already individually capped. */
  async function runParallel(tasks, signal) {
    const summaries = await mapWithConcurrencyLimit(
      tasks,
      limits.maxParallelPerDelegation,
      (task) => runSingle(task, signal),
    );
    const integration = await maybeIntegrateParallelWrites(tasks);
    const combined = tasks
      .map((task, i) => `### ${task.employeeId}\n${summaries[i] ?? '(no output)'}`)
      .concat(integration ? [`### Integration\n${integration}`] : [])
      .join('\n\n---\n\n');
    return capBytes(combined, COMBINED_OUTPUT_CAP, 'combined');
  }

  async function maybeIntegrateParallelWrites(tasks) {
    if (!ctx.leaseManager || !ctx.rootLease || !tasks.some((task) => task.access === 'write')) {
      return '';
    }
    const writableLeases = ctx.leaseManager
      .listLeases()
      .filter((lease) => lease.access === 'write' && lease.status === 'active');
    if (writableLeases.length === 0) return '';
    const plan = await ctx.leaseManager.planIntegration(writableLeases);
    for (const lease of ctx.leaseManager.listLeases().filter((item) => item.access === 'write')) {
      await emitWorkspaceLeaseSnapshotLine(lease, 'planned', {
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
    const approved = ctx.confirmIntegration ? await ctx.confirmIntegration(plan) : false;
    if (!approved) {
      for (const lease of plan.mergeable) {
        await emitWorkspaceLeaseSnapshotLine(lease, 'retained_for_review', {
          status: 'retained',
          reason: 'merge review was not approved; worktree retained for inspection',
        });
      }
      return `Merge review was not approved; ${plan.mergeable.length} worktree(s) retained for inspection.`;
    }
    const result = await ctx.leaseManager.integrate(plan);
    for (const lease of ctx.leaseManager.listLeases().filter((item) => item.access === 'write')) {
      await emitWorkspaceLeaseSnapshotLine(lease, 'integrated');
    }
    for (const lease of result.merged) {
      const released = await ctx.leaseManager.releaseLease(lease.leaseId).catch(() => null);
      if (released) await emitWorkspaceLeaseSnapshotLine(released, 'released_after_merge');
    }
    if (result.conflicted) {
      return `Integration stopped on merge conflict in lease ${result.conflicted.lease.leaseId}: ${result.conflicted.conflicts.join(', ')}`;
    }
    const skipped =
      result.skipped.length > 0
        ? ` Skipped: ${result.skipped.map((item) => `${item.leaseId} (${item.reason})`).join('; ')}.`
        : '';
    return `Merged ${result.merged.length} write lease(s) into the root workspace.${skipped}`;
  }

  return { runSingle, runParallel, roster };
}
