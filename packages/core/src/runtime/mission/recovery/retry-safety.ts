/**
 * DR-005 — Retry-safety metadata (PRD §22.4, slice M4).
 *
 * After a crash, a recovery may only RE-RUN operations that are safe to re-run.
 * §22.4 declares the contract: a tool or evaluator carries a {@link RetrySafety}
 * tag, and only `safe` (no side effect) or `idempotent_with_key` (a stable
 * idempotency key makes a re-run a no-op) may be auto-retried. `unsafe` (an
 * effectful, non-idempotent op — a deploy, a payment, a destructive command) and
 * `unknown` (we cannot prove either) are NEVER auto-retried; they require user
 * confirmation. {@link canAutoRetry} is the gate the resume planner (DR-006)
 * applies before re-running anything.
 *
 * The MS-003 evaluators are tagged here ({@link EVALUATOR_RETRY_SAFETY}). The
 * read-only deterministic acceptance checks re-evaluate cleanly: re-running a
 * `file_exists` / `file_hash` / `text_contains` / `json_schema` /
 * `artifact_published` / `git_diff_policy` / `manual_approval` check only READS
 * environment facts, so re-evaluation has no side effect and is `safe`.
 * `command_exit_zero` is the exception — it runs an arbitrary command whose side
 * effects we cannot prove, so it is `unknown` (the verification command itself
 * could mutate state) and is never auto-replayed.
 *
 * Additive at M4 — pure metadata + a pure predicate; no behavior change.
 */

/** PRD §22.4 retry-safety classes for a tool or evaluator. */
export type RetrySafety = 'safe' | 'idempotent_with_key' | 'unsafe' | 'unknown';

/**
 * A declaration that an operation (a tool or an evaluator) carries a retry-safety
 * class. Tools/evaluators declare it; the recovery layer reads it.
 */
export interface RetrySafetyMeta {
  /** The operation's id (evaluator id or tool name). */
  id: string;
  retrySafety: RetrySafety;
}

/**
 * PRD §22.4: only `safe` or `idempotent_with_key` may be auto-retried during a
 * recovery. `unsafe` and `unknown` always require explicit user confirmation —
 * never auto-replayed. This is the single gate the resume planner consults.
 */
export function canAutoRetry(meta: { retrySafety: RetrySafety }): boolean {
  return meta.retrySafety === 'safe' || meta.retrySafety === 'idempotent_with_key';
}

/**
 * Retry-safety tags for the MS-003 P0 evaluators (PRD §20.2).
 *
 * - `file_exists` / `file_hash` / `text_contains` / `json_schema` /
 *   `artifact_published` / `git_diff_policy` / `manual_approval` — pure READS of
 *   environment facts. Re-evaluating them on resume mutates nothing, so `safe`.
 *   (`manual_approval` reads a recorded approval row; re-reading is side-effect
 *   free — the human decision is durable, not re-solicited by the evaluator.)
 * - `command_exit_zero` — runs an arbitrary command. Even a "verification" command
 *   can have side effects we cannot prove (it could write, build, deploy), so it
 *   is `unknown` and must not be auto-replayed; a recovery surfaces it for the
 *   user to re-run deliberately.
 * - `llm_rubric_review` — advisory only and model-backed; re-running spends and
 *   is non-deterministic, so `unknown` (never an auto-replay candidate).
 */
export const EVALUATOR_RETRY_SAFETY: Readonly<Record<string, RetrySafety>> = {
  file_exists: 'safe',
  file_hash: 'safe',
  text_contains: 'safe',
  json_schema: 'safe',
  artifact_published: 'safe',
  git_diff_policy: 'safe',
  manual_approval: 'safe',
  command_exit_zero: 'unknown',
  llm_rubric_review: 'unknown',
};

/**
 * The retry-safety class of a known evaluator id, or `unknown` for an id with no
 * declared tag (the conservative default — an undeclared op is never auto-retried).
 */
export function evaluatorRetrySafety(evaluatorId: string): RetrySafety {
  return EVALUATOR_RETRY_SAFETY[evaluatorId] ?? 'unknown';
}
