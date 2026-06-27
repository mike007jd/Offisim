/**
 * MissionLoopController — the bounded, deterministic Mission loop (PRD §19, slice
 * MS-004).
 *
 * This is the §19.1 loop tying MS-002 ({@link MissionService} state machine) to
 * MS-003 (EvaluatorRegistry):
 *
 *   startAttempt → run the attempt (DELEGATED) → beginVerifying → run each
 *   required criterion's evaluator over the EvaluationContext the attempt
 *   produced → recordEvaluation for each → all required PASS → completeMission;
 *   any product FAIL + budget remains → FailurePacket → toRepairing → loop;
 *   stop guard → toFailed / toBlocked with evidence.
 *
 * §4 (Mission Control is NOT a second Agent loop): the controller NEVER calls a
 * model to decide flow. Every transition is a pure function of evaluator verdicts
 * + the bounded §19.2 stop rules. It owns ONLY status transitions, attempt
 * counting, budget, evaluator scheduling, failure signature, and stop conditions
 * — it has no task-decomposition intelligence, no prompt, no model selection, no
 * tool loop. Running the runtime attempt is delegated to an injected `runAttempt`
 * (production wraps the AgentRuntimeDriver + Pi bridge tools — MS-005; the harness
 * scripts it).
 *
 * §5 (Evaluator is not a second Agent) + §20.3: a deterministic FAIL is FINAL
 * within an attempt — an advisory (`deterministic: false`, e.g. `llm_rubric_review`)
 * result must never override / upgrade a deterministic FAIL. Infra (a
 * `runtimeError`, an evaluator ERROR, or a BLOCKED verdict) is separated from a
 * product FAIL: infra → blocked, and does NOT consume a per-criterion repair.
 *
 * Determinism: `now()` / `newId()` are injected (no `Date.now()` / `Math.random()`),
 * so a scripted `runAttempt` makes the whole loop byte-reproducible — mirrors
 * {@link MissionService}.
 *
 * Additive at MS-004 — nothing consumes the controller yet (live wiring is MS-005).
 */

import type { EvaluationContext, EvaluatorRegistry } from './evaluators/index.js';
import { MissionStateError } from './mission-service.js';
import type { MissionService } from './mission-service.js';

// ---------------------------------------------------------------------------
// §19.3 FailurePacket. Controller-owned vocabulary (mirrors how MissionService
// owns its own MissionEventType set). The packet is the structured feedback the
// loop sends back into the SAME runtime session to repair against (§19.3) — the
// controller builds it from the failed evaluations; it does NOT do the agent's
// task decomposition.
// ---------------------------------------------------------------------------

/** Remaining budget snapshot carried in a {@link FailurePacket} (§19.3). */
export interface MissionBudgetRemaining {
  /** Full attempts left before the §19.2 6-attempt global cap. */
  attemptsRemaining: number;
  /**
   * Per-criterion repairs left before the §19.2 3-repair cap, keyed by
   * criterion id. Only criteria that have failed at least once appear.
   */
  repairsRemainingByCriterion: Record<string, number>;
  /** Token budget left, when a `tokenBudget` was configured (else omitted). */
  tokenBudgetRemaining?: number;
}

/** A single failed criterion's structured feedback (§19.3). */
export interface FailedCriterion {
  criterionId: string;
  description: string;
  /** Only non-PASS, non-SKIP product verdicts land here. */
  verdict: 'FAIL' | 'BLOCKED' | 'ERROR';
  summary: string;
  evidenceRefs: string[];
  /** Optional reproduction hint (e.g. the command that failed). */
  reproduction?: string;
}

/** The §19.3 Failure Packet sent back to the runtime session to repair against. */
export interface FailurePacket {
  missionId: string;
  attemptId: string;
  failedCriteria: FailedCriterion[];
  remainingBudget: MissionBudgetRemaining;
  /**
   * The failure signature of the IMMEDIATELY PRECEDING attempt, when there was
   * one. Two consecutive attempts with the SAME signature → STUCK (§19.2).
   */
  previousFailureSignature?: string;
}

// ---------------------------------------------------------------------------
// Injected attempt execution (the delegated runtime run).
// ---------------------------------------------------------------------------

/**
 * The result of running one runtime attempt. The controller asks it for a
 * per-criterion {@link EvaluationContext} (the same shape the evaluators read),
 * then runs the evaluators itself. A `runtimeError` is INFRA — runtime
 * incompatible / transport failure — and is treated as BLOCKED, NOT a product
 * FAIL (§19.2 + §5): it does not consume a repair.
 */
export interface AttemptExecution {
  /**
   * Resolve the {@link EvaluationContext} for a required criterion (sync or
   * async). Production gathers per-criterion evidence from the runtime + bridge
   * tools; the harness returns a scripted context.
   */
  evaluationContextFor(
    criterion: ControllerCriterion,
  ): EvaluationContext | Promise<EvaluationContext>;
  /** Set when the runtime itself failed to run (infra, not a product FAIL). */
  runtimeError?: { code: string; message: string };
  /**
   * Token spend this attempt reports back to the controller (§19.2 token
   * budget). In production the driver reports its run usage here; the harness
   * scripts it. The controller debits `tokenBudget` by `usage.tokens` after
   * each attempt and stops with `token_budget` once the budget goes non-positive
   * — that is the ONLY channel by which a driver's usage reaches the budget
   * guard (the controller runs no model itself).
   */
  usage?: { tokens?: number };
}

/** Input handed to the injected `runAttempt` for one attempt. */
export interface RunAttemptInput {
  missionId: string;
  attemptId: string;
  attemptNumber: number;
  /** The packet from the previous failed attempt, on a repair attempt. */
  failurePacket?: FailurePacket;
}

/** The minimal criterion view the controller passes to `runAttempt` / evaluators. */
export interface ControllerCriterion {
  id: string;
  description: string;
  evaluatorId: string;
  configJson: string;
  required: boolean;
}

// ---------------------------------------------------------------------------
// Budget / stop config (§19.2 defaults).
// ---------------------------------------------------------------------------

export interface MissionLoopBudget {
  /** Per-criterion repair cap. A 4th product FAIL on one criterion → stop. */
  maxRepairsPerCriterion: number;
  /** Global full-attempt cap. */
  maxAttempts: number;
  /** Optional token budget; exhausted → stop. */
  tokenBudget?: number;
}

/** §19.2 defaults. Market Playbooks may not raise these without bound. */
export const DEFAULT_MISSION_LOOP_BUDGET: MissionLoopBudget = {
  maxRepairsPerCriterion: 3,
  maxAttempts: 6,
};

// ---------------------------------------------------------------------------
// Outcome.
// ---------------------------------------------------------------------------

export type MissionLoopStatus = 'completed' | 'failed' | 'blocked' | 'stuck' | 'cancelled';

/** Stop reason vocabulary — why the loop stopped short of completion. */
export type MissionLoopStopReason =
  | 'completed'
  | 'repair_cap' // a criterion exceeded maxRepairsPerCriterion
  | 'attempt_cap' // hit maxAttempts
  | 'stuck' // two identical consecutive failure signatures
  | 'token_budget' // token budget exhausted
  | 'cancelled' // human cancel
  | 'runtime_incompatible'; // runtimeError → blocked (infra)

export interface MissionLoopResult {
  status: MissionLoopStatus;
  /** Number of full attempts run. */
  attempts: number;
  /** The mission's final persisted status (authoritative, from MissionService). */
  finalMissionStatus: string;
  stopReason: MissionLoopStopReason;
  /** The last FailurePacket, when the loop stopped on a product failure. */
  failurePacket?: FailurePacket;
  /** Structured evidence for the stop decision (machine-readable). */
  evidence: MissionLoopEvidence;
}

export interface MissionLoopEvidence {
  /** Per-attempt summary, in order. */
  attempts: AttemptEvidence[];
  /** Final per-criterion repair counts. */
  repairCountsByCriterion: Record<string, number>;
  /** Human-readable note on why the loop stopped. */
  note: string;
}

export interface AttemptEvidence {
  attemptId: string;
  attemptNumber: number;
  failureSignature?: string;
  runtimeError?: { code: string; message: string };
  /** Verdict per evaluated criterion (after the deterministic-FAIL-final rule). */
  verdicts: Array<{ criterionId: string; verdict: EvalVerdict }>;
}

type EvalVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | 'SKIP';

// ---------------------------------------------------------------------------
// Deps.
// ---------------------------------------------------------------------------

export interface MissionLoopControllerDeps {
  missionService: MissionService;
  evaluatorRegistry: EvaluatorRegistry;
  /** Delegated runtime execution (production = driver + bridge; harness = scripted). */
  runAttempt: (input: RunAttemptInput) => Promise<AttemptExecution>;
  /** §19.2 budget / stop config. Defaults to {@link DEFAULT_MISSION_LOOP_BUDGET}. */
  budget?: Partial<MissionLoopBudget>;
  now: () => string;
  newId: () => string;
}

export interface MissionLoopController {
  run(missionId: string): Promise<MissionLoopResult>;
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * The combined per-criterion verdict after the deterministic-FAIL-is-final rule
 * (§5, §20.3). Within ONE criterion the controller may consult multiple
 * evaluators (the gate criterion has exactly one evaluator id in MS-004, but the
 * rule is enforced structurally): an advisory (`deterministic: false`) result
 * can never override a deterministic FAIL/ERROR.
 */
interface CriterionOutcome {
  criterionId: string;
  description: string;
  /** The final, deterministic-FAIL-final verdict. */
  verdict: EvalVerdict;
  summary: string;
  evidenceRefs: string[];
  /** A reproduction hint, when one is in evidence (e.g. `command:...`). */
  reproduction?: string;
  evaluatorId: string;
}

/** A product FAIL — the only verdict that consumes a per-criterion repair (§19.2). */
function isProductFail(verdict: EvalVerdict): boolean {
  return verdict === 'FAIL';
}

/** Infra — separated from a product FAIL; does NOT consume a repair (§5, §19.2). */
function isInfra(verdict: EvalVerdict): boolean {
  return verdict === 'BLOCKED' || verdict === 'ERROR';
}

/** Verdicts that count as a failed criterion in the FailurePacket (§19.3). */
function isFailedCriterion(verdict: EvalVerdict): verdict is 'FAIL' | 'BLOCKED' | 'ERROR' {
  return verdict === 'FAIL' || verdict === 'BLOCKED' || verdict === 'ERROR';
}

/** A reproduction hint pulled from evidence refs (the first `command:` ref). */
function reproductionFrom(evidenceRefs: string[]): string | undefined {
  return evidenceRefs.find((ref) => ref.startsWith('command:'));
}

/**
 * The STABLE failure signature for an attempt (§19.2): sorted failed-criterion
 * ids each paired with its verdict + summary. Two consecutive attempts with the
 * IDENTICAL signature → STUCK. JSON of a sorted, normalized array is stable
 * across runs (no Map/object key-order dependence).
 */
function computeFailureSignature(outcomes: CriterionOutcome[]): string {
  const failed = outcomes
    .filter((o) => isFailedCriterion(o.verdict))
    .map((o) => ({ id: o.criterionId, v: o.verdict, s: o.summary }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(failed);
}

// ---------------------------------------------------------------------------
// Controller.
// ---------------------------------------------------------------------------

class MissionLoopControllerImpl implements MissionLoopController {
  private readonly budget: MissionLoopBudget;

  constructor(private readonly deps: MissionLoopControllerDeps) {
    this.budget = {
      ...DEFAULT_MISSION_LOOP_BUDGET,
      ...(deps.budget ?? {}),
    };
  }

  async run(missionId: string): Promise<MissionLoopResult> {
    const svc = this.deps.missionService;

    // Per-criterion repair counter (a product FAIL after the first attempt on
    // that criterion consumes one repair). Token budget tracked locally and
    // debited per attempt from the usage each `runAttempt` reports (§19.2).
    const repairCounts = new Map<string, number>();
    let tokenRemaining = this.budget.tokenBudget;
    const attemptEvidence: AttemptEvidence[] = [];

    let attemptNumber = 0;
    let previousFailureSignature: string | undefined;
    let pendingFailurePacket: FailurePacket | undefined; // fed into the NEXT attempt

    // The criteria are fixed for the mission lifetime (created via MissionService
    // before run). We only gate on `required` criteria (§18.1 / §19.1 step 7).
    const allCriteria = await this.loadControllerCriteria(missionId);
    const requiredCriteria = allCriteria.filter((c) => c.required);

    // §18.1 A1: a mission with zero REQUIRED criteria must NEVER run to a vacuous
    // completion. With no required criteria, `outcomes.every(PASS)` over an empty
    // set is `true`, so the first attempt would "complete" having verified
    // nothing. Refuse to enter the loop and block the mission with an explicit
    // reason instead of relying on `[].every()`. (MissionService.createMission
    // already rejects this up front; this is the loop's defense-in-depth so a
    // mission that somehow reached `ready` un-gateable is parked, not falsely
    // completed.)
    if (requiredCriteria.length === 0) {
      const missionRow = await svc.getMission(missionId);
      // Only block from a state where `→ blocked` is a legal edge; a mission in
      // draft/ready cannot transition straight to blocked, so we surface a hard
      // error there. In the controller's actual entry contract the mission is in
      // `ready`, so we report the un-gateable mission as a thrown invariant.
      throw new MissionStateError(
        'invariant_violation',
        `Mission ${missionId} has zero required criteria — refusing to run a loop that would complete vacuously (§18.1). Status: ${missionRow.status}`,
        { missionId },
      );
    }

    for (;;) {
      // §19.2 human cancel: a mission already cancelled aborts the loop. Cancel
      // is legal from any non-terminal state, and this short-circuits WITHOUT a
      // transition, so it is safe to check at the top regardless of phase.
      const missionRow = await svc.getMission(missionId);
      if (missionRow.status === 'cancelled') {
        return this.stop('cancelled', 'cancelled', {
          attemptEvidence,
          repairCounts,
          attempts: attemptNumber,
          note: 'mission was cancelled (human cancel) — loop aborted',
        });
      }

      // The global attempt cap, token budget, STUCK, and per-criterion repair cap
      // are all enforced AFTER verifying (in the `verifying` state) where the
      // `verifying → failed` transition is legal — NOT here, because after a
      // repair the mission is in `repairing` (only `repairing → running` is
      // legal). See the post-verify decision block below.

      // The iteration body performs mission transitions that race against a
      // concurrent human cancel: a cancel that lands mid-attempt (e.g. after
      // startAttempt → running but before beginVerifying) makes the next
      // transition throw illegal_transition, since `cancelled` has no legal exit.
      // We catch exactly that, re-read the mission, and if it is cancelled return
      // a clean `cancelled` result; any OTHER illegal_transition is a genuine bug
      // and is re-thrown (never swallowed).
      try {
        const result = await this.runOneAttempt({
          missionId,
          attemptNumber,
          previousFailureSignature,
          pendingFailurePacket,
          tokenRemaining,
          repairCounts,
          attemptEvidence,
          requiredCriteria,
        });
        if (result.kind === 'stop') return result.value;
        // Continue the loop with the updated carry-over state.
        attemptNumber = result.attemptNumber;
        previousFailureSignature = result.previousFailureSignature;
        pendingFailurePacket = result.pendingFailurePacket;
        tokenRemaining = result.tokenRemaining;
      } catch (error) {
        if (error instanceof MissionStateError && error.code === 'illegal_transition') {
          const after = await svc.getMission(missionId);
          if (after.status === 'cancelled') {
            return this.stop('cancelled', 'cancelled', {
              attemptEvidence,
              repairCounts,
              attempts: attemptNumber,
              note: 'mission was cancelled mid-attempt (human cancel) — loop aborted cleanly',
            });
          }
        }
        throw error;
      }
    }
  }

  /**
   * Run exactly one attempt: startAttempt → runAttempt (delegated) →
   * beginVerifying → evaluate → record → decide (complete / repair / stop). All
   * mission transitions live here so {@link run}'s try/catch can convert a
   * concurrent-cancel illegal_transition into a clean stop. Returns either a
   * terminal stop (`kind: 'stop'`) or the carry-over state for the next loop.
   */
  private async runOneAttempt(state: {
    missionId: string;
    attemptNumber: number;
    previousFailureSignature: string | undefined;
    pendingFailurePacket: FailurePacket | undefined;
    tokenRemaining: number | undefined;
    repairCounts: Map<string, number>;
    attemptEvidence: AttemptEvidence[];
    requiredCriteria: ControllerCriterion[];
  }): Promise<
    | { kind: 'stop'; value: MissionLoopResult }
    | {
        kind: 'continue';
        attemptNumber: number;
        previousFailureSignature: string | undefined;
        pendingFailurePacket: FailurePacket | undefined;
        tokenRemaining: number | undefined;
      }
  > {
    const svc = this.deps.missionService;
    const { missionId, repairCounts, attemptEvidence, requiredCriteria } = state;
    let { attemptNumber, previousFailureSignature, pendingFailurePacket, tokenRemaining } = state;

    {
      // --- 1. startAttempt (MissionService) ------------------------------
      const trigger = attemptNumber === 0 ? 'initial' : 'repair';
      const beforeRunning = await svc.startAttempt(missionId, trigger, {
        prevAttemptId: pendingFailurePacket?.attemptId,
        failureSignature: previousFailureSignature,
      });
      attemptNumber += 1;
      const attemptId = beforeRunning.current_attempt_id;
      if (!attemptId) {
        // MissionService always binds an attempt id on → running; defensive only.
        throw new Error(`startAttempt did not bind an attempt id for mission ${missionId}`);
      }

      // --- 2. run the runtime attempt (DELEGATED) ------------------------
      const execution = await this.deps.runAttempt({
        missionId,
        attemptId,
        attemptNumber,
        failurePacket: pendingFailurePacket,
      });

      // §19.2 token budget: debit this attempt's reported usage. This is the
      // ONLY channel by which a driver's token spend reaches the budget guard
      // (the controller runs no model). The guard itself fires in the verifying
      // decision block below, so a budget pushed non-positive by this attempt
      // stops the loop AFTER the attempt instead of starting another.
      if (tokenRemaining !== undefined && execution.usage?.tokens) {
        tokenRemaining -= execution.usage.tokens;
      }

      // --- 3. beginVerifying (MissionService) ----------------------------
      await svc.beginVerifying(missionId);

      // §19.2 runtimeError → BLOCKED (infra). Does NOT consume a repair: we go
      // straight to blocked without touching the repair counter or evaluating.
      if (execution.runtimeError) {
        attemptEvidence.push({
          attemptId,
          attemptNumber,
          runtimeError: execution.runtimeError,
          verdicts: [],
        });
        const packet = this.buildFailurePacket(
          missionId,
          attemptId,
          [
            {
              criterionId: '*runtime*',
              description: 'runtime session',
              verdict: 'BLOCKED',
              summary: `runtime error: ${execution.runtimeError.code} — ${execution.runtimeError.message}`,
              evidenceRefs: [`runtime:${execution.runtimeError.code}`],
            },
          ],
          repairCounts,
          attemptNumber,
          tokenRemaining,
          previousFailureSignature,
        );
        await svc.toBlocked(
          missionId,
          `runtime error: ${execution.runtimeError.code} — ${execution.runtimeError.message}`,
        );
        return {
          kind: 'stop',
          value: this.stop('blocked', 'runtime_incompatible', {
            attemptEvidence,
            repairCounts,
            attempts: attemptNumber,
            failurePacket: packet,
            note: 'runtime error (infra) → blocked; no repair consumed (§19.2, §5)',
          }),
        };
      }

      // --- 4 + 5. evaluate each required criterion -----------------------
      const outcomes = await this.evaluateCriteria(requiredCriteria, execution);

      // --- 6. recordEvaluation for each (MissionService) -----------------
      for (const outcome of outcomes) {
        await svc.recordEvaluation({
          missionId,
          criterionId: outcome.criterionId,
          attemptId,
          evaluatorId: outcome.evaluatorId,
          verdict: outcome.verdict,
          summary: outcome.summary,
          evidenceRefsJson: JSON.stringify(outcome.evidenceRefs),
        });
      }

      const failureSignature = computeFailureSignature(outcomes);
      attemptEvidence.push({
        attemptId,
        attemptNumber,
        failureSignature: outcomes.some((o) => isFailedCriterion(o.verdict))
          ? failureSignature
          : undefined,
        verdicts: outcomes.map((o) => ({ criterionId: o.criterionId, verdict: o.verdict })),
      });

      // --- 7. all required PASS → completeMission ------------------------
      const allPass = outcomes.every((o) => o.verdict === 'PASS');
      if (allPass) {
        const completed = await svc.completeMission(missionId);
        return {
          kind: 'stop',
          value: {
            status: 'completed',
            attempts: attemptNumber,
            finalMissionStatus: completed.status,
            stopReason: 'completed',
            evidence: {
              attempts: attemptEvidence,
              repairCountsByCriterion: Object.fromEntries(repairCounts),
              note: `all ${requiredCriteria.length} required criteria PASS in ${attemptNumber} attempt(s)`,
            },
          },
        };
      }

      // Partition the non-PASS criteria: product FAILs (consume a repair) vs
      // infra (BLOCKED/ERROR — separated, do NOT consume a repair §19.2/§5).
      const productFails = outcomes.filter((o) => isProductFail(o.verdict));
      const infraFails = outcomes.filter((o) => isInfra(o.verdict));

      // Infra-only failure (no product FAIL) → BLOCKED. No repair consumed.
      if (productFails.length === 0 && infraFails.length > 0) {
        const packet = this.buildFailurePacket(
          missionId,
          attemptId,
          outcomes.filter((o) => isFailedCriterion(o.verdict)),
          repairCounts,
          attemptNumber,
          tokenRemaining,
          previousFailureSignature,
        );
        await svc.toBlocked(
          missionId,
          `blocked on infra (${infraFails.map((o) => `${o.criterionId}=${o.verdict}`).join(', ')})`,
        );
        return {
          kind: 'stop',
          value: this.stop('blocked', 'runtime_incompatible', {
            attemptEvidence,
            repairCounts,
            attempts: attemptNumber,
            failurePacket: packet,
            note: 'evaluator infra failure (BLOCKED/ERROR) → blocked; no repair consumed (§19.2, §5)',
          }),
        };
      }

      // There is at least one product FAIL → it's a repair candidate.
      // Build the packet BEFORE consuming repairs so its remainingBudget reflects
      // the budget the repair attempt will actually have.
      const failedForPacket = outcomes.filter((o) => isFailedCriterion(o.verdict));

      // §19.2 STUCK: two consecutive attempts with the identical failed set AND
      // identical signature → stop as STUCK (before consuming a repair / a new
      // attempt). Checked against the PREVIOUS attempt's signature.
      if (previousFailureSignature !== undefined && failureSignature === previousFailureSignature) {
        const packet = this.buildFailurePacket(
          missionId,
          attemptId,
          failedForPacket,
          repairCounts,
          attemptNumber,
          tokenRemaining,
          previousFailureSignature,
        );
        await svc.toFailed(missionId, 'STUCK: identical failure signature two attempts running');
        return {
          kind: 'stop',
          value: this.stop('stuck', 'stuck', {
            attemptEvidence,
            repairCounts,
            attempts: attemptNumber,
            failurePacket: packet,
            note: 'two consecutive attempts with identical failure signature → STUCK (§19.2)',
          }),
        };
      }

      // §19.2 global attempt cap: this attempt failed and we've now run
      // maxAttempts full attempts — there is no budget for another → stop as
      // failed from `verifying` (a legal transition; a top-of-loop check would
      // be in `repairing` where `→ failed` is illegal).
      if (attemptNumber >= this.budget.maxAttempts) {
        const packet = this.buildFailurePacket(
          missionId,
          attemptId,
          failedForPacket,
          repairCounts,
          attemptNumber,
          tokenRemaining,
          previousFailureSignature,
        );
        await svc.toFailed(missionId, `attempt cap reached (${this.budget.maxAttempts})`);
        return {
          kind: 'stop',
          value: this.stop('failed', 'attempt_cap', {
            attemptEvidence,
            repairCounts,
            attempts: attemptNumber,
            failurePacket: packet,
            note: `hit the ${this.budget.maxAttempts}-attempt cap (§19.2)`,
          }),
        };
      }

      // §19.2 token budget: exhausted → no budget for a repair attempt → stop.
      if (tokenRemaining !== undefined && tokenRemaining <= 0) {
        const packet = this.buildFailurePacket(
          missionId,
          attemptId,
          failedForPacket,
          repairCounts,
          attemptNumber,
          tokenRemaining,
          previousFailureSignature,
        );
        await svc.toFailed(missionId, 'token budget exhausted');
        return {
          kind: 'stop',
          value: this.stop('failed', 'token_budget', {
            attemptEvidence,
            repairCounts,
            attempts: attemptNumber,
            failurePacket: packet,
            note: 'token budget exhausted (§19.2)',
          }),
        };
      }

      // §19.2 per-criterion repair cap: consume one repair per product-failing
      // criterion. If any has already been repaired maxRepairsPerCriterion times
      // (i.e. this is the cap-th+1 product FAIL on it), stop as failed.
      const capExceeded: CriterionOutcome[] = [];
      for (const fail of productFails) {
        const used = repairCounts.get(fail.criterionId) ?? 0;
        if (used >= this.budget.maxRepairsPerCriterion) {
          capExceeded.push(fail);
        }
      }
      if (capExceeded.length > 0) {
        const packet = this.buildFailurePacket(
          missionId,
          attemptId,
          failedForPacket,
          repairCounts,
          attemptNumber,
          tokenRemaining,
          previousFailureSignature,
        );
        await svc.toFailed(
          missionId,
          `repair cap reached for ${capExceeded.map((c) => c.criterionId).join(', ')} (${this.budget.maxRepairsPerCriterion})`,
        );
        return {
          kind: 'stop',
          value: this.stop('failed', 'repair_cap', {
            attemptEvidence,
            repairCounts,
            attempts: attemptNumber,
            failurePacket: packet,
            note: `per-criterion repair cap (${this.budget.maxRepairsPerCriterion}) reached (§19.2)`,
          }),
        };
      }

      // Consume one repair per product-failing criterion.
      for (const fail of productFails) {
        repairCounts.set(fail.criterionId, (repairCounts.get(fail.criterionId) ?? 0) + 1);
      }

      // --- 8. FailurePacket → toRepairing → loop (same-session repair) ----
      const packet = this.buildFailurePacket(
        missionId,
        attemptId,
        failedForPacket,
        repairCounts,
        attemptNumber,
        tokenRemaining,
        previousFailureSignature,
      );
      pendingFailurePacket = packet;
      previousFailureSignature = failureSignature;
      // (Token budget for this attempt was already debited from
      // `execution.usage` right after runAttempt resolved; the budget guard in
      // this verifying block stopped the loop if it went non-positive.)

      await svc.toRepairing(missionId, attemptId, failureSignature);
      // The loop continues: hand the carry-over state back to run().
      return {
        kind: 'continue',
        attemptNumber,
        previousFailureSignature,
        pendingFailurePacket,
        tokenRemaining,
      };
    }
  }

  // -- internals ----------------------------------------------------------

  /**
   * Evaluate each required criterion via the registry over the per-criterion
   * EvaluationContext the attempt produced. Applies the deterministic-FAIL-final
   * rule (§5, §20.3): MS-004 gates on ONE evaluator per criterion, so the rule is
   * trivially satisfied per-criterion, but we structurally guarantee an advisory
   * (`deterministic: false`) verdict can never UPGRADE a deterministic FAIL by
   * folding its result through {@link applyDeterministicFinal}.
   */
  private async evaluateCriteria(
    criteria: ControllerCriterion[],
    execution: AttemptExecution,
  ): Promise<CriterionOutcome[]> {
    const outcomes: CriterionOutcome[] = [];
    for (const criterion of criteria) {
      const evaluator = this.deps.evaluatorRegistry.get(criterion.evaluatorId);
      const ctx = await execution.evaluationContextFor(criterion);
      const result = await evaluator.evaluate(ctx);
      const verdict = applyDeterministicFinal(result.verdict, evaluator.deterministic);
      outcomes.push({
        criterionId: criterion.id,
        description: criterion.description,
        verdict,
        summary: result.summary,
        evidenceRefs: result.evidenceRefs,
        reproduction: reproductionFrom(result.evidenceRefs),
        evaluatorId: criterion.evaluatorId,
      });
    }
    return outcomes;
  }

  /** Build a §19.3 FailurePacket from the failed criterion outcomes. */
  private buildFailurePacket(
    missionId: string,
    attemptId: string,
    failed: Array<
      Pick<
        CriterionOutcome,
        'criterionId' | 'description' | 'summary' | 'evidenceRefs' | 'reproduction'
      > & {
        verdict: EvalVerdict;
      }
    >,
    repairCounts: Map<string, number>,
    attemptNumber: number,
    tokenRemaining: number | undefined,
    previousFailureSignature: string | undefined,
  ): FailurePacket {
    const failedCriteria: FailedCriterion[] = failed
      .filter((f) => isFailedCriterion(f.verdict))
      .map((f) => ({
        criterionId: f.criterionId,
        description: f.description,
        verdict: f.verdict as 'FAIL' | 'BLOCKED' | 'ERROR',
        summary: f.summary,
        evidenceRefs: f.evidenceRefs,
        ...(f.reproduction ? { reproduction: f.reproduction } : {}),
      }));

    const repairsRemainingByCriterion: Record<string, number> = {};
    for (const [criterionId, used] of repairCounts) {
      repairsRemainingByCriterion[criterionId] = Math.max(
        0,
        this.budget.maxRepairsPerCriterion - used,
      );
    }

    const remainingBudget: MissionBudgetRemaining = {
      attemptsRemaining: Math.max(0, this.budget.maxAttempts - attemptNumber),
      repairsRemainingByCriterion,
      ...(tokenRemaining !== undefined ? { tokenBudgetRemaining: tokenRemaining } : {}),
    };

    return {
      missionId,
      attemptId,
      failedCriteria,
      remainingBudget,
      ...(previousFailureSignature !== undefined ? { previousFailureSignature } : {}),
    };
  }

  /** Build the final result for a stop (non-completion) path. */
  private stop(
    status: Exclude<MissionLoopStatus, 'completed'>,
    stopReason: MissionLoopStopReason,
    detail: {
      attemptEvidence: AttemptEvidence[];
      repairCounts: Map<string, number>;
      attempts: number;
      failurePacket?: FailurePacket;
      note: string;
    },
  ): MissionLoopResult {
    return {
      status,
      attempts: detail.attempts,
      finalMissionStatus: status === 'stuck' ? 'failed' : status,
      stopReason,
      ...(detail.failurePacket ? { failurePacket: detail.failurePacket } : {}),
      evidence: {
        attempts: detail.attemptEvidence,
        repairCountsByCriterion: Object.fromEntries(detail.repairCounts),
        note: detail.note,
      },
    };
  }

  /** Load the criteria as the controller's minimal view. */
  private async loadControllerCriteria(missionId: string): Promise<ControllerCriterion[]> {
    const rows = await this.deps.missionService.listCriteria(missionId);
    return rows.map((c) => ({
      id: c.criterion_id,
      description: c.description,
      evaluatorId: c.evaluator_id,
      configJson: c.evaluator_config_json,
      required: c.required === 1,
    }));
  }
}

/**
 * The deterministic-FAIL-is-final rule (§5, §20.3): an advisory
 * (`deterministic: false`) evaluator's verdict may never become a hard gate. For
 * MS-004 the gate is one evaluator per criterion; when that evaluator is
 * advisory (e.g. `llm_rubric_review`), a non-PASS advisory verdict is downgraded
 * to SKIP so it can never FAIL a required criterion on its own, and a PASS
 * advisory verdict is likewise SKIP (it cannot satisfy a gate by itself). Only a
 * deterministic evaluator can produce a gating PASS/FAIL/BLOCKED/ERROR.
 */
function applyDeterministicFinal(verdict: EvalVerdict, deterministic: boolean): EvalVerdict {
  if (deterministic) return verdict;
  // Advisory: never gates. Collapse to SKIP regardless of the advisory verdict.
  return 'SKIP';
}

/**
 * Factory mirroring the core service style (createMissionService /
 * createEvaluatorRegistry). Pass the MissionService (MS-002), the
 * EvaluatorRegistry (MS-003), the delegated `runAttempt`, the §19.2 budget, and
 * injected `now()` / `newId()`.
 */
export function createMissionLoopController(
  deps: MissionLoopControllerDeps,
): MissionLoopController {
  return new MissionLoopControllerImpl(deps);
}
