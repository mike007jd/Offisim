import type {
  AttemptExecution,
  ControllerCriterion,
  EvaluationContext,
  EvaluatorRegistry,
  EventBus,
  FailurePacket,
  MissionLoopResult,
  RunAttemptInput,
  RuntimeRepositories,
} from '@offisim/core/browser';
import {
  createMissionLoopController,
  createMissionService,
  parseMissionBudgetJson,
} from '@offisim/core/browser';
import type { RuntimeEvent } from '@offisim/shared-types';
import type { DesktopAgentRunInput, DesktopAgentRuntime } from '../desktop-agent-runtime.js';
import {
  type TauriEvaluationContextInput,
  createTauriEvaluationContext,
} from './evaluation-context.js';
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  type MissionEvaluationSubmittedPayload,
} from './mission-events.js';

/**
 * MissionRunController — the renderer orchestration seam that wires the
 * deterministic MissionLoopController (core) to the live Pi runtime (MS-005 +
 * MS-006, PRD §16.2 / §16.3 / §19 / §21.1).
 *
 * The deterministic controller drives the loop and decides flow (§4). This module
 * provides its injected `runAttempt`: it runs a REAL Pi agent attempt, correlates
 * the agent's `submit_for_evaluation` signals to the attempt by rootRunId, and
 * hands the controller a per-criterion {@link createTauriEvaluationContext} so the
 * evaluators run over REAL workspace state (NOT the agent's self-report — the
 * agent's submission is only a SIGNAL, the deterministic evaluator is the truth,
 * §5).
 *
 * MS-006 (same-session repair): on a repair attempt the controller hands back a
 * {@link FailurePacket}; `runAttempt` folds its structured brief into the next
 * prompt and runs it in the SAME thread (same `threadId` → the host's
 * `SessionManager.continueRecent` continues the same Pi session). Session-continuity
 * baseline: a same-thread continuation carrying the repair brief. True Pi `resume`
 * is not separately exposed (the host has no resume mode — same thread is the
 * continuation), so the repair re-enters the same conversation with the failure
 * feedback, which is the MS-005/006 baseline.
 */

export interface MissionRunControllerDeps {
  agentRuntime: DesktopAgentRuntime;
  repos: RuntimeRepositories;
  evaluatorRegistry: EvaluatorRegistry;
  /** The renderer's runtimeEventBus — the `submit_for_evaluation` signal channel. */
  eventBus: EventBus;
  /**
   * The per-criterion EvaluationContext factory. Defaults to the production
   * {@link createTauriEvaluationContext} (sandboxed Tauri capabilities). The
   * harness overrides it with an in-memory fake so the deterministic loop is
   * testable without a real workspace — the controller is otherwise identical.
   */
  createEvaluationContext?: (input: TauriEvaluationContextInput) => EvaluationContext;
  /** Deterministic-id / clock factories. Default to crypto.randomUUID + Date. */
  newId?: () => string;
  now?: () => string;
  /** Timer seams used by the wall-clock hard cap and its deferred harness. */
  scheduleDeadline?: (callback: () => void, delayMs: number) => unknown;
  cancelDeadline?: (handle: unknown) => void;
}

export interface MissionRunController {
  /** Run a created+ready mission to a terminal {@link MissionLoopResult}. */
  runMission(missionId: string): Promise<MissionLoopResult>;
}

/** The minimal mission context packet injected into the host (§16.3). Canonical
 *  mission JSON stays in the Offisim DB; only this summary is sent. */
interface MissionContextPacket {
  missionId: string;
  goal: string;
  criteria: Array<{
    criterionId: string;
    description: string;
    evaluatorId: string;
    required: boolean;
  }>;
}

function delegationLimitsFromMissionBudget(
  budget: ReturnType<typeof parseMissionBudgetJson>,
): NonNullable<DesktopAgentRunInput['delegationLimits']> | undefined {
  const limits: NonNullable<DesktopAgentRunInput['delegationLimits']> = {
    ...(budget.maxRecursionDepth === undefined ? {} : { maxDepth: budget.maxRecursionDepth }),
    ...(budget.maxConcurrentAgents === undefined
      ? {}
      : { maxParallelPerDelegation: budget.maxConcurrentAgents }),
    ...(budget.maxTotalAgents === undefined ? {} : { maxTotalChildren: budget.maxTotalAgents }),
    ...(budget.tokenBudget === undefined ? {} : { maxTotalTokens: budget.tokenBudget }),
  };
  return Object.keys(limits).length > 0 ? limits : undefined;
}

export function createMissionRunController(deps: MissionRunControllerDeps): MissionRunController {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());
  const makeEvaluationContext = deps.createEvaluationContext ?? createTauriEvaluationContext;
  const scheduleDeadline =
    deps.scheduleDeadline ??
    ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs));
  const cancelDeadline =
    deps.cancelDeadline ??
    ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  const missionService = createMissionService(
    {
      missions: deps.repos.missions,
      missionCriteria: deps.repos.missionCriteria,
      missionAttempts: deps.repos.missionAttempts,
      missionEvaluations: deps.repos.missionEvaluations,
      missionEvents: deps.repos.missionEvents,
    },
    { now, newId },
  );

  async function runMission(missionId: string): Promise<MissionLoopResult> {
    const mission = await missionService.getMission(missionId);
    const criterionRows = await missionService.listCriteria(missionId);
    const controllerCriteria: ControllerCriterion[] = criterionRows.map((c) => ({
      id: c.criterion_id,
      description: c.description,
      evaluatorId: c.evaluator_id,
      configJson: c.evaluator_config_json,
      required: c.required === 1,
    }));
    const criterionById = new Map(controllerCriteria.map((c) => [c.id, c]));

    // Resolve the project's workspace_root once for the whole mission — every
    // attempt's EvaluationContext runs the bash builtin against it.
    const projectId = mission.project_id;
    const workspaceRoot = projectId
      ? ((await deps.repos.projects?.findById(projectId))?.workspace_root ?? null)
      : null;

    const missionContext: MissionContextPacket = {
      missionId,
      goal: mission.goal,
      criteria: controllerCriteria.map((c) => ({
        criterionId: c.id,
        description: c.description,
        evaluatorId: c.evaluatorId,
        required: c.required,
      })),
    };
    const missionContextJson = JSON.stringify(missionContext);

    // §19.2: feed the authored token / attempt budget into the loop. The loop
    // owns the defaults; we only override the caps the user set on the mission.
    const budget = parseMissionBudgetJson(mission.budget_json);
    // These three authored fields are explicitly Pi delegation-supervisor caps.
    // The supervisor counts only delegated children (the root never calls
    // reserveTotal), so maxTotalAgents maps directly to maxTotalChildren — no
    // root subtraction. This also preserves the valid `maxTotalAgents: 1` case.
    const delegationLimits = delegationLimitsFromMissionBudget(budget);

    const controller = createMissionLoopController({
      missionService,
      evaluatorRegistry: deps.evaluatorRegistry,
      runAttempt: (input) =>
        runAttempt(input, {
          mission,
          missionContextJson,
          controllerCriteria,
          criterionById,
          projectId,
          workspaceRoot,
          delegationLimits,
        }),
      now,
      newId,
      budget,
    });

    return controller.run(missionId);
  }

  /**
   * Run one Pi agent attempt and return the {@link AttemptExecution} the
   * controller verifies. Subscribes to the `submit_for_evaluation` signal channel
   * for the duration of the agent run (correlated by the attempt's run id), then
   * hands back a per-criterion {@link createTauriEvaluationContext}.
   */
  async function runAttempt(
    input: RunAttemptInput,
    ctx: {
      mission: Awaited<ReturnType<typeof missionService.getMission>>;
      missionContextJson: string;
      controllerCriteria: ControllerCriterion[];
      criterionById: Map<string, ControllerCriterion>;
      projectId: string | null;
      workspaceRoot: string | null;
      delegationLimits: DesktopAgentRunInput['delegationLimits'];
    },
  ): Promise<AttemptExecution> {
    const {
      mission,
      missionContextJson,
      controllerCriteria,
      criterionById,
      projectId,
      workspaceRoot,
      delegationLimits,
    } = ctx;
    // `runId === attemptId` so the host stamps rootRunId = attemptId; the bridge's
    // submit_for_evaluation events then carry runId === attemptId, which is how we
    // correlate the agent's signals to THIS attempt.
    const attemptRunId = input.attemptId;

    // Collect the agent's submit_for_evaluation signals for this attempt. They are
    // SIGNALS only (which criteria the agent considers ready) — the deterministic
    // evaluator still decides PASS over the real workspace (§5). We currently
    // evaluate ALL required criteria every attempt (the gate), so the collected
    // submissions are advisory context; we keep them keyed for evidence/diagnostics
    // and future selective re-evaluation.
    const submissions = new Map<string, MissionEvaluationSubmittedPayload>();
    const unsubscribe = deps.eventBus.on(
      MISSION_EVALUATION_SUBMITTED_EVENT,
      (event: RuntimeEvent<MissionEvaluationSubmittedPayload>) => {
        const payload = event.payload;
        if (payload.runId !== attemptRunId) return;
        submissions.set(payload.criterionId, payload);
      },
    );

    const prompt = buildAttemptPrompt(mission.goal, controllerCriteria, input.failurePacket);
    const runInput: DesktopAgentRunInput = {
      text: prompt,
      threadId: mission.thread_id,
      employeeId: null,
      projectId,
      runId: attemptRunId,
      missionId: input.missionId,
      attemptId: input.attemptId,
      missionContextJson,
      ...(delegationLimits === undefined ? {} : { delegationLimits }),
    };

    let runtimeError: AttemptExecution['runtimeError'];
    let usageTokens: number | undefined;
    let deadlineTimer: unknown;
    let wallClockTimedOut = false;
    let resolveDeadline!: () => void;
    const deadlineReached = new Promise<void>((resolve) => {
      resolveDeadline = resolve;
    });
    const deadlineMs = input.wallClockDeadlineAt
      ? Date.parse(input.wallClockDeadlineAt)
      : undefined;
    const remainingMs = deadlineMs === undefined ? undefined : deadlineMs - Date.parse(now());
    const abortForDeadline = () => {
      wallClockTimedOut = true;
      resolveDeadline();
      // The hard return is driven by `deadlineReached`, not by abort success.
      // Abort stays best-effort cleanup: a missing preflight request or failed
      // IPC must not keep the Mission state machine waiting past its deadline.
      queueMicrotask(() => {
        try {
          deps.agentRuntime.abort(mission.thread_id);
        } catch (err) {
          console.error('[mission-run-controller] wall-clock abort failed', {
            missionId: input.missionId,
            attemptId: input.attemptId,
            err,
          });
        }
      });
    };

    if (remainingMs !== undefined) {
      if (!Number.isFinite(remainingMs)) {
        throw new Error(`Invalid Mission wall-clock deadline: ${input.wallClockDeadlineAt}`);
      }
      if (remainingMs <= 0) {
        abortForDeadline();
      } else {
        deadlineTimer = scheduleDeadline(abortForDeadline, remainingMs);
      }
    }

    try {
      const runtimeOutcome = wallClockTimedOut
        ? ({ kind: 'deadline' } as const)
        : await Promise.race([
            deps.agentRuntime.execute(runInput).then(
              (result) => ({ kind: 'result', result }) as const,
              (error: unknown) => ({ kind: 'error', error }) as const,
            ),
            deadlineReached.then(() => ({ kind: 'deadline' }) as const),
          ]);
      const result = runtimeOutcome.kind === 'result' ? runtimeOutcome.result : null;
      if (runtimeOutcome.kind === 'error') throw runtimeOutcome.error;
      // The host reports the run's own token usage on the return (deterministic —
      // no persist-queue race). `budgetUsage` is a separate root+delegated-tree
      // wire used only by Mission debit; `usage` remains root-only so
      // reconcileRoot can add child rows once without double-counting them.
      const budgetUsage = result?.budgetUsage ?? result?.usage;
      if (budgetUsage) {
        const u = budgetUsage;
        usageTokens = (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
      }
      if (wallClockTimedOut) {
        runtimeError = {
          code: 'wall_clock_budget',
          message: 'Mission wall-clock budget exhausted; the active Pi run was aborted.',
        };
      }
    } catch (err) {
      // A thrown agent run is INFRA (transport / runtime) — the controller maps
      // runtimeError → BLOCKED without consuming a repair (§19.2 / §5). A product
      // failure is NEVER signaled by a throw; it is decided by the evaluators.
      runtimeError = wallClockTimedOut
        ? {
            code: 'wall_clock_budget',
            message: 'Mission wall-clock budget exhausted; the active Pi run was aborted.',
          }
        : {
            code: 'runtime_error',
            message: err instanceof Error ? err.message : String(err),
          };
    } finally {
      if (deadlineTimer !== undefined) cancelDeadline(deadlineTimer);
      unsubscribe();
    }

    // Stamp the attempt's root agent run id (runId === attemptId by design) so the
    // attempt row joins to its `agent_runs` row for usage/cost and future durable
    // recovery — regardless of outcome (a failed/blocked attempt still produced a
    // run). Best-effort: a write failure here must not fail the attempt.
    try {
      await deps.repos.missionAttempts.setRootRunId(input.attemptId, attemptRunId);
    } catch (err) {
      console.warn('[mission-run-controller] setRootRunId failed', {
        attemptId: input.attemptId,
        err,
      });
    }

    // Diagnostic only: the agent's submissions are advisory signals, not the
    // verdict. Surface how many criteria it claimed ready vs how many exist, so a
    // run where the agent never signaled is observable — the evaluators still run
    // regardless (§5).
    console.info('[mission-run-controller] attempt finished', {
      missionId: input.missionId,
      attemptId: input.attemptId,
      attemptNumber: input.attemptNumber,
      signaledCriteria: [...submissions.keys()],
      totalCriteria: controllerCriteria.length,
      runtimeError: runtimeError?.message,
    });

    return {
      ...(runtimeError ? { runtimeError } : {}),
      ...(usageTokens !== undefined ? { usage: { tokens: usageTokens } } : {}),
      evaluationContextFor: (criterion) =>
        makeEvaluationContext({
          projectId,
          workspaceRoot,
          criterion: {
            id: criterion.id,
            description: criterion.description,
            configJson: criterionById.get(criterion.id)?.configJson ?? criterion.configJson,
          },
          attemptRunId,
          repos: deps.repos,
        }),
    };
  }

  return { runMission };
}

/**
 * Build the agent prompt for an attempt: the goal + criteria, plus (MS-006) the
 * structured repair brief when this is a repair attempt. The brief tells the agent
 * exactly which criteria failed, with the deterministic summaries + evidence, so
 * it can fix them in the SAME session.
 */
function buildAttemptPrompt(
  goal: string,
  criteria: ControllerCriterion[],
  failurePacket: FailurePacket | undefined,
): string {
  const lines: string[] = [];
  if (failurePacket) {
    lines.push(
      '# Mission repair',
      '',
      'A previous attempt did not pass verification. Fix the failed acceptance criteria',
      'below in THIS session, then call `submit_for_evaluation` for each as you finish.',
      '',
      '## Failed criteria',
    );
    for (const fc of failurePacket.failedCriteria) {
      lines.push(
        `- [${fc.criterionId}] ${fc.description}`,
        `  - verdict: ${fc.verdict}`,
        `  - what was wrong: ${fc.summary}`,
      );
      if (fc.evidenceRefs.length > 0) {
        lines.push(`  - evidence: ${fc.evidenceRefs.join(', ')}`);
      }
      if (fc.reproduction) {
        lines.push(`  - reproduce with: ${fc.reproduction}`);
      }
    }
    lines.push('');
  } else {
    lines.push('# Mission', '');
  }

  lines.push('## Goal', goal, '', '## Acceptance criteria (you must satisfy every required one)');
  for (const c of criteria) {
    lines.push(
      `- [${c.id}]${c.required ? ' (required)' : ' (optional)'} ${c.description} — checked by \`${c.evaluatorId}\``,
    );
  }
  lines.push(
    '',
    'Do the work in the workspace. When a criterion is ready, call `submit_for_evaluation`',
    'with its criterionId. Offisim then verifies it deterministically against the real',
    'workspace — your own assessment does not decide pass/fail. Use `query_mission_state`',
    'anytime to re-read the goal and criteria. Publish any deliverables with',
    '`publish_artifact` so the artifact criteria can see them.',
  );
  return lines.join('\n');
}
