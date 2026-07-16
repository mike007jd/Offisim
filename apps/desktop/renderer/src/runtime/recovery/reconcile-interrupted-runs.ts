/**
 * DR-003 (Epic A) — Startup interrupted-run reconciliation over `agent_runs`.
 *
 * The live Pi host is a per-run child process that dies with the app (or a
 * crash). When that happens mid-run the root `agent_runs` row is stuck `running`
 * forever and the user has no way to recover or even see the partial. On startup
 * the app calls {@link reconcileInterruptedRuns} ONCE per company: it parks each
 * dangling root `running → interrupted` (distinct from a clean cancel), cancels
 * the still-running children whose host died with it, rolls the subtree's partial
 * usage onto the root, and returns a {@link InterruptedRunCard} per parked root.
 *
 * This runs over `agent_runs` (the live source of truth) + the native agent's
 * saved engine-specific native session reference, NOT the orphan mission tables — wiring the
 * mission store into the live path is exactly the "parallel recovery store"
 * anti-pattern the roadmap avoids. The M4 mission recovery library stays a pure
 * logic lib; this is its agent_runs-shaped sibling, reusing only the generic
 * {@link RecoveryClassification} taxonomy + the never-auto-resume invariant.
 *
 * CONTRACT (mirrors M4 §22.3.6): it NEVER auto-resumes. The result is presented;
 * nothing is re-run here. POST-INVARIANT: after a pass, no agent_run for the
 * company is left `running` — roots become `interrupted`, children `cancelled`.
 *
 * Determinism: `now` is injected (no `Date.now()`).
 */

import {
  type TaskWorkspaceBindingProjection,
  type TaskWorkspaceResumeCompatibility,
  type TaskWorkspaceResumeCompatibilityArgs,
  parseTaskWorkspaceBindingProjection,
} from '@/lib/tauri-commands.js';
import type {
  AgentRunRepository,
  AgentRunRow,
  RecoveryClassification,
} from '@offisim/core/browser';
import type { AgentRunUsage, WorkspaceUnavailableProvenance } from '@offisim/shared-types';
import { parseWorkspaceProvenance } from '../workspace-provenance.js';
import { aggregateSubtreeUsage } from './usage-aggregation.js';

/**
 * §24.5-style recovery card for ONE interrupted agent run (root). Built by the
 * reconciler; never auto-acted upon — the UI shows it so a human can choose
 * Resume / Discard / View-partial.
 */
export interface InterruptedRunCard {
  runId: string;
  companyId: string;
  threadId: string;
  projectId: string | null;
  workspaceBinding: TaskWorkspaceBindingProjection | null;
  /** The run's objective (the resume target's intent), if recorded. */
  objective: string | null;
  startedAt: string;
  /** Saved work-session path: present may be resumable; null is incompatible. */
  sessionFile: string | null;
  /** Partial usage aggregated from the subtree at interruption (JSON), or null. */
  partialUsageJson: string | null;
  /** Children that were left running and got cancelled by this reconcile. */
  cancelledChildRunIds: string[];
  classification: RecoveryClassification;
  classificationReasons: string[];
  /** Plain-language description of what a resume will do. */
  whatResumeWillDo: string;
}

interface RunContextSnapshot {
  workspaceBinding?: unknown;
  workspaceRequirement?: unknown;
  workspaceAvailability?: unknown;
  workspaceProvenance?: unknown;
  runtime?: unknown;
  piSdkVersion?: unknown;
  wireProtocolVersion?: unknown;
  nativeProtocolVersion?: unknown;
  nativeSessionId?: unknown;
  executionTarget?: unknown;
  model?: unknown;
  permissionMode?: unknown;
  thinkingLevel?: unknown;
  projectId?: unknown;
}

interface InterruptedRunCardOptions {
  resumeCompatibility?: TaskWorkspaceResumeCompatibility;
  currentWireProtocolVersion?: number;
}

export const PI_HOST_PROTOCOL_VERSION = 11;
export const CODEX_APP_SERVER_PROTOCOL_VERSION = 2;
export const CLAUDE_AGENT_HOST_PROTOCOL_VERSION = 1;

const RESUME_COMPATIBILITY_COPY: Readonly<Record<string, string>> = {
  workspace_history_missing: 'The saved workspace record is unavailable.',
  workspace_scope_changed: 'This run no longer matches its original project and conversation.',
  project_workspace_missing: 'The original Project folder is unavailable.',
  project_workspace_changed: 'The Project folder has changed since this run started.',
  workspace_history_identity_invalid: 'The saved workspace record can no longer be verified.',
  workspace_identity_changed: 'The Project folder was replaced or changed since this run started.',
  workspace_history_not_recoverable: 'This interrupted run is no longer recoverable.',
  workspace_history_incompatible: 'The saved workspace no longer matches this interrupted run.',
  session_missing: "Offisim can't find where this task stopped.",
  session_invalid: "Offisim can't safely reopen where this task stopped.",
  runtime_incompatible: 'This task was created by an older Offisim version.',
  resume_context_invalid: "Offisim can't safely reconstruct where this task stopped.",
  resume_conflict: 'This task changed while Offisim was preparing to continue it.',
  resume_persistence_unavailable: 'Offisim could not safely prepare this task to continue.',
  workspace_compatibility_unavailable:
    'The Project folder could not be verified, so resume remains blocked.',
};

const UNAVAILABLE_WORKSPACE_COPY: Readonly<
  Record<WorkspaceUnavailableProvenance['reasonCode'], string>
> = {
  none: 'no matching Project folder was found',
  ambiguous: 'the Project folder could not be uniquely confirmed',
};

/** Convert backend-only compatibility codes into stable product copy. */
export function describeWorkspaceResumeCompatibility(
  compatibility: TaskWorkspaceResumeCompatibility,
): string | null {
  if (compatibility.status === 'same') return null;
  return (
    RESUME_COMPATIBILITY_COPY[compatibility.reason] ??
    (compatibility.status === 'missing'
      ? 'The saved workspace record is unavailable.'
      : 'The original Project folder no longer matches this run.')
  );
}

function parseRuntimeContext(raw: string | null): RunContextSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RunContextSnapshot;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveAgentRunProjectId(root: AgentRunRow): string | null {
  const context = parseRuntimeContext(root.runtime_context_json);
  return root.project_id ?? stringOrNull(context?.projectId);
}

function resolveAgentRunWorkspaceBinding(root: AgentRunRow): TaskWorkspaceBindingProjection | null {
  const context = parseRuntimeContext(root.runtime_context_json);
  return parseTaskWorkspaceBindingProjection(context?.workspaceBinding);
}

export function resolveAgentRunResumeCompatibilityArgs(
  root: AgentRunRow,
): TaskWorkspaceResumeCompatibilityArgs | null {
  const projectId = resolveAgentRunProjectId(root);
  const workspaceBinding = resolveAgentRunWorkspaceBinding(root);
  const context = parseRuntimeContext(root.runtime_context_json);
  const permissionMode = stringOrNull(context?.permissionMode);
  if (
    !projectId ||
    !workspaceBinding ||
    !workspaceBinding.historyId.trim() ||
    workspaceBinding.companyId !== root.company_id ||
    workspaceBinding.projectId !== projectId ||
    workspaceBinding.threadId !== root.thread_id ||
    workspaceBinding.turnId !== root.root_run_id ||
    (root.access !== 'read' && root.access !== 'write') ||
    workspaceBinding.access !== root.access ||
    (permissionMode !== null && (permissionMode === 'plan' ? 'read' : 'write') !== root.access) ||
    root.run_id !== root.root_run_id
  ) {
    return null;
  }
  return {
    historyId: workspaceBinding.historyId,
    companyId: root.company_id,
    projectId,
    threadId: root.thread_id,
    rootRunId: root.root_run_id,
    access: root.access,
  };
}

/** The structured result of a startup run-reconciliation pass. */
export interface RunReconciliationResult {
  cards: InterruptedRunCard[];
  /** Roots whose aggregate could not be fully parked. A non-empty result is
   * retryable and must not mark the company recovery scope hydrated. */
  failedRootRunIds: string[];
  /**
   * INVARIANT (mirrors M4 §22.3.6): reconciliation NEVER auto-resumes. Always
   * false — part of the contract that the result is presented, not acted on.
   */
  autoResumed: false;
}

export interface ReconcileInterruptedRunsInput {
  repo: AgentRunRepository;
  companyId: string;
  /** Native-host rows already reattached or still uncertain; never park these. */
  preserveRootRunIds?: ReadonlySet<string>;
  /** Exact root ids observed by the startup bootstrap as stale. */
  candidateRootRunIds?: ReadonlySet<string>;
  /** Injected clock for the `finished_at` stamp on cancelled children (determinism). */
  now: () => string;
}

/**
 * Reconcile every dangling `running` run for one company. Returns a card per
 * parked root. Never auto-resumes.
 */
export async function reconcileInterruptedRuns(
  input: ReconcileInterruptedRunsInput,
): Promise<RunReconciliationResult> {
  const { repo, companyId, now } = input;
  const preserveRootRunIds = input.preserveRootRunIds ?? new Set<string>();
  const candidateRootRunIds = input.candidateRootRunIds;
  const running = await repo.findByStatus(companyId, ['running']);

  // Roots reconcile to `interrupted` (resumable); their running children cancel.
  const roots = running
    .filter((r) => r.run_id === r.root_run_id && !preserveRootRunIds.has(r.root_run_id))
    .filter((r) => candidateRootRunIds === undefined || candidateRootRunIds.has(r.root_run_id));
  const processedRootIds = new Set<string>();
  const cancelledChildIds = new Set<string>();
  const failedRootRunIds: string[] = [];
  const cards: InterruptedRunCard[] = [];

  for (const root of roots) {
    // Per-root isolation: a startup DB error (SQLite lock contention, driver
    // error) on one root must not abort the whole pass and strand the remaining
    // roots in `running` — mirrors the live reconcileRoot's try/catch.
    try {
      const subtree = await repo.findByRoot(root.run_id);
      const { usageJson, dangling } = aggregateSubtreeUsage(
        subtree,
        root.run_id,
        parseUsage(root.usage_json, root.run_id),
      );
      const finishedAt = now();
      // Park the root `interrupted` (NOT cancelled — it can be resumed). Do NOT set
      // finished_at: an interrupted run is paused, not finished; a later resume that
      // completes will stamp it then. Roll the partial subtree usage onto the root.
      await repo.updateStatus(root.run_id, 'interrupted', { usageJson });
      // Cancel its still-running children — their host died with the root.
      await Promise.all(
        dangling.map(async (id) => {
          await repo.updateStatus(id, 'cancelled', { finishedAt });
          cancelledChildIds.add(id);
        }),
      );
      processedRootIds.add(root.run_id);
      cards.push(buildInterruptedRunCard(root, dangling, usageJson));
    } catch (err) {
      failedRootRunIds.push(root.run_id);
      console.warn('[reconcile-interrupted-runs] failed to park interrupted root', {
        rootRunId: root.run_id,
        err,
      });
    }
  }

  // Orphan running children: a child stuck `running` whose root is NOT itself a
  // dangling running root (its root already reached a terminal state) cannot be
  // independently resumed, so cancel it to honor the post-invariant (no run left
  // `running`). Skip any child already cancelled as part of a processed subtree.
  const orphans = running.filter(
    (r) =>
      r.run_id !== r.root_run_id &&
      !preserveRootRunIds.has(r.root_run_id) &&
      (candidateRootRunIds === undefined || candidateRootRunIds.has(r.root_run_id)) &&
      !processedRootIds.has(r.root_run_id) &&
      !cancelledChildIds.has(r.run_id),
  );
  if (orphans.length > 0) {
    const finishedAt = now();
    await Promise.all(orphans.map((o) => repo.updateStatus(o.run_id, 'cancelled', { finishedAt })));
  }

  return { cards, failedRootRunIds, autoResumed: false };
}

function parseUsage(usageJson: string | null, rootRunId: string): AgentRunUsage | undefined {
  if (!usageJson) return undefined;
  try {
    const parsed = JSON.parse(usageJson) as
      | AgentRunUsage
      | {
          scope?: { kind?: unknown };
          contributions?: Array<{ runId?: unknown; usage?: AgentRunUsage }>;
        };
    if (parsed.scope?.kind !== 'task-aggregate') return parsed as AgentRunUsage;
    const aggregate = parsed as {
      contributions?: Array<{ runId?: unknown; usage?: AgentRunUsage }>;
    };
    return aggregate.contributions?.find((entry) => entry.runId === rootRunId)?.usage;
  } catch {
    return undefined;
  }
}

export function buildInterruptedRunCard(
  root: AgentRunRow,
  cancelledChildRunIds: string[],
  partialUsageJson: string | null,
  options: InterruptedRunCardOptions = {},
): InterruptedRunCard {
  const sessionFile = root.session_file;
  const context = parseRuntimeContext(root.runtime_context_json);
  const projectId = resolveAgentRunProjectId(root);
  const workspaceBinding = resolveAgentRunWorkspaceBinding(root);
  const workspaceAvailability = stringOrNull(context?.workspaceAvailability);
  const workspaceProvenance = parseWorkspaceProvenance(context?.workspaceProvenance);
  const workspaceBindingMatchesRun = resolveAgentRunResumeCompatibilityArgs(root) !== null;
  const executionTarget =
    context?.executionTarget && typeof context.executionTarget === 'object'
      ? (context.executionTarget as Record<string, unknown>)
      : null;
  const engineId = stringOrNull(executionTarget?.engineId);
  const supportedEngine = engineId === 'api' || engineId === 'codex' || engineId === 'claude';
  const nativeSessionId = stringOrNull(context?.nativeSessionId);
  const wireProtocolVersion =
    typeof context?.wireProtocolVersion === 'number' ? context.wireProtocolVersion : null;
  const nativeProtocolVersion =
    typeof context?.nativeProtocolVersion === 'number' ? context.nativeProtocolVersion : null;
  const currentWireProtocolVersion = options.currentWireProtocolVersion ?? PI_HOST_PROTOCOL_VERSION;
  const classificationReasons: string[] = [];
  if (!projectId) {
    classificationReasons.push('The original Project is no longer available.');
  }
  if (!workspaceBindingMatchesRun) {
    classificationReasons.push('The original Project folder cannot be verified for this task.');
  }
  if (workspaceAvailability === 'unavailable') {
    const reason =
      workspaceProvenance?.availability === 'unavailable'
        ? UNAVAILABLE_WORKSPACE_COPY[workspaceProvenance.reasonCode]
        : 'the Project folder availability could not be verified';
    classificationReasons.push(
      `This Conversation continued without Project file access because ${reason}.`,
    );
  }
  if (options.resumeCompatibility && options.resumeCompatibility.status !== 'same') {
    const reason = describeWorkspaceResumeCompatibility(options.resumeCompatibility);
    if (reason) classificationReasons.push(reason);
  }
  if (!engineId) {
    classificationReasons.push('This task has no saved AI engine binding.');
  } else if (!supportedEngine) {
    classificationReasons.push('The saved AI engine is not available in this Offisim build.');
  }
  const hasNativeSession =
    engineId === 'codex' || engineId === 'claude'
      ? nativeSessionId !== null
      : engineId === 'api' && sessionFile !== null;
  if (!hasNativeSession) {
    classificationReasons.push('This task stopped before it could save its place.');
  }
  const protocolMismatch =
    engineId === 'codex' || engineId === 'claude'
      ? nativeProtocolVersion !==
        (engineId === 'codex'
          ? CODEX_APP_SERVER_PROTOCOL_VERSION
          : CLAUDE_AGENT_HOST_PROTOCOL_VERSION)
      : engineId === 'api' &&
        wireProtocolVersion !== null &&
        wireProtocolVersion !== currentWireProtocolVersion;
  if (protocolMismatch) {
    classificationReasons.push(
      "This task was created by an older Offisim version and can't safely continue.",
    );
  }
  const workspaceBlocked =
    !projectId ||
    !workspaceBindingMatchesRun ||
    (options.resumeCompatibility !== undefined && options.resumeCompatibility.status !== 'same');
  const classification: RecoveryClassification =
    !supportedEngine || protocolMismatch || workspaceBlocked || !hasNativeSession
      ? 'incompatible'
      : 'resumable';
  const workspaceName = workspaceBinding?.displayPath || 'the original Project folder';
  const whatResumeWillDo =
    classification === 'resumable'
      ? `Continue this task in ${workspaceName} from where it stopped.`
      : "This task can't safely resume. Discard it to start again in this Conversation.";
  return {
    runId: root.run_id,
    companyId: root.company_id,
    threadId: root.thread_id,
    projectId,
    workspaceBinding,
    objective: root.objective,
    startedAt: root.started_at,
    sessionFile,
    partialUsageJson,
    cancelledChildRunIds,
    classification,
    classificationReasons,
    whatResumeWillDo,
  };
}
