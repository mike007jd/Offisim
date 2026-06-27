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

import type { AgentRunRepository, AgentRunRow, RecoveryClassification } from '@offisim/core/browser';
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

/** The structured result of a startup run-reconciliation pass. */
export interface RunReconciliationResult {
  cards: InterruptedRunCard[];
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
  const processedRootIds = new Set(roots.map((r) => r.run_id));
  const cancelledChildIds = new Set<string>();
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
        dangling.map((id) => {
          cancelledChildIds.add(id);
          return repo.updateStatus(id, 'cancelled', { finishedAt });
        }),
      );
      cards.push(buildCard(root, dangling, usageJson));
    } catch (err) {
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
    await Promise.all(
      orphans.map((o) => repo.updateStatus(o.run_id, 'cancelled', { finishedAt })),
    );
  }

  return { cards, autoResumed: false };
}

function parseUsage(usageJson: string | null): AgentRunUsage | undefined {
  if (!usageJson) return undefined;
  try {
    return JSON.parse(usageJson) as AgentRunUsage;
  } catch {
    return undefined;
  }
}

function buildCard(
  root: AgentRunRow,
  cancelledChildRunIds: string[],
  partialUsageJson: string | null,
): InterruptedRunCard {
  const sessionFile = root.session_file;
  // Classification is derived, not stored (the roadmap defers a hard compat-hash
  // block): a session file → resumable; none → restart-from-scratch needs confirm.
  // `incompatible` is reserved for a future runtime compatibility check.
  const classification: RecoveryClassification = sessionFile ? 'resumable' : 'needs_user_confirm';
  const classificationReasons = sessionFile
    ? []
    : ['no Pi session file recorded — a resume would restart the run from its objective, so it needs confirmation'];
  const cancelledNote =
    cancelledChildRunIds.length > 0
      ? ` ${cancelledChildRunIds.length} child run(s) left running were cancelled and would be re-delegated as needed.`
      : '';
  const whatResumeWillDo = sessionFile
    ? `Resume the interrupted run from its Pi session context.${cancelledNote}`
    : `No durable session was recorded; resuming restarts this run from its objective. Confirm before resuming, or discard.${cancelledNote}`;
  return {
    runId: root.run_id,
    companyId: root.company_id,
    threadId: root.thread_id,
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
