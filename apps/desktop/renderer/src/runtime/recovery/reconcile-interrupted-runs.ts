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
 * This runs over `agent_runs` (the live source of truth) + the run's Pi session
 * JSONL pointer (`session_file`), NOT the orphan mission tables — wiring the
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

import type {
  AgentRunRepository,
  AgentRunRow,
  RecoveryClassification,
} from '@offisim/core/browser';
import type { AgentRunUsage } from '@offisim/shared-types';
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
  workspaceRoot: string | null;
  /** The run's objective (the resume target's intent), if recorded. */
  objective: string | null;
  startedAt: string;
  /** Pi session JSONL path: present → resumable; null → resume needs confirmation. */
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
  workspaceRoot?: unknown;
  runtime?: unknown;
  piSdkVersion?: unknown;
  wireProtocolVersion?: unknown;
  model?: unknown;
  permissionMode?: unknown;
  thinkingLevel?: unknown;
  projectId?: unknown;
}

interface InterruptedRunCardOptions {
  workspaceExists?: boolean | null;
  resolvedWorkspaceRoot?: string | null;
  currentWireProtocolVersion?: number;
}

export const PI_HOST_PROTOCOL_VERSION = 7;

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

function resolveAgentRunWorkspaceRoot(root: AgentRunRow): string | null {
  const context = parseRuntimeContext(root.runtime_context_json);
  return stringOrNull(context?.workspaceRoot);
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
  const running = await repo.findByStatus(companyId, ['running']);

  // Roots reconcile to `interrupted` (resumable); their running children cancel.
  const roots = running.filter((r) => r.run_id === r.root_run_id);
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
        parseUsage(root.usage_json),
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
      !processedRootIds.has(r.root_run_id) &&
      !cancelledChildIds.has(r.run_id),
  );
  if (orphans.length > 0) {
    const finishedAt = now();
    await Promise.all(orphans.map((o) => repo.updateStatus(o.run_id, 'cancelled', { finishedAt })));
  }

  return { cards, failedRootRunIds, autoResumed: false };
}

function parseUsage(usageJson: string | null): AgentRunUsage | undefined {
  if (!usageJson) return undefined;
  try {
    return JSON.parse(usageJson) as AgentRunUsage;
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
  const workspaceRoot = resolveAgentRunWorkspaceRoot(root) ?? options.resolvedWorkspaceRoot ?? null;
  const wireProtocolVersion =
    typeof context?.wireProtocolVersion === 'number' ? context.wireProtocolVersion : null;
  const currentWireProtocolVersion = options.currentWireProtocolVersion ?? PI_HOST_PROTOCOL_VERSION;
  const classificationReasons: string[] = [];
  if (!projectId) {
    classificationReasons.push('original project context is missing');
  }
  if (!workspaceRoot) {
    classificationReasons.push('original workspace folder was not recorded');
  }
  if (options.workspaceExists === false) {
    classificationReasons.push('original workspace folder is no longer accessible');
  }
  if (!sessionFile) {
    classificationReasons.push(
      'no Pi session file recorded; this run cannot continue from durable session context',
    );
  }
  const protocolMismatch =
    wireProtocolVersion !== null && wireProtocolVersion !== currentWireProtocolVersion;
  if (protocolMismatch) {
    classificationReasons.push(
      `saved host protocol ${wireProtocolVersion} does not match current protocol ${currentWireProtocolVersion}`,
    );
  }
  const workspaceBlocked = !projectId || !workspaceRoot || options.workspaceExists === false;
  const classification: RecoveryClassification = protocolMismatch
    ? 'incompatible'
    : workspaceBlocked
      ? 'incompatible'
      : sessionFile
        ? 'resumable'
        : 'needs_user_confirm';
  const cancelledNote =
    cancelledChildRunIds.length > 0
      ? ` ${cancelledChildRunIds.length} child run(s) left running were cancelled and would be re-delegated as needed.`
      : '';
  const workspaceNote = workspaceRoot ? ` in ${workspaceRoot}` : '';
  const whatResumeWillDo =
    classification === 'resumable'
      ? `Resume the interrupted run from its Pi session context${workspaceNote}.${cancelledNote}`
      : classification === 'needs_user_confirm'
        ? `No durable session was recorded; resuming restarts this run from its objective${workspaceNote}. Confirm before resuming.${cancelledNote}`
        : classification === 'incompatible'
          ? `Resume is blocked for this run. Start a fresh run or discard it.${cancelledNote}`
          : `Start a fresh run or discard this interrupted run.${cancelledNote}`;
  return {
    runId: root.run_id,
    companyId: root.company_id,
    threadId: root.thread_id,
    projectId,
    workspaceRoot,
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
