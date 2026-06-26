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
import { createMissionLoopController, createMissionService } from '@offisim/core/browser';
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

export function createMissionRunController(deps: MissionRunControllerDeps): MissionRunController {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());
  const makeEvaluationContext = deps.createEvaluationContext ?? createTauriEvaluationContext;

  const missionService = createMissionService(
    {
      missions: requireRepo(deps.repos, 'missions'),
      missionCriteria: requireRepo(deps.repos, 'missionCriteria'),
      missionAttempts: requireRepo(deps.repos, 'missionAttempts'),
      missionEvaluations: requireRepo(deps.repos, 'missionEvaluations'),
      missionEvents: requireRepo(deps.repos, 'missionEvents'),
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
        }),
      now,
      newId,
      ...(budget ? { budget } : {}),
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
    },
  ): Promise<AttemptExecution> {
    const {
      mission,
      missionContextJson,
      controllerCriteria,
      criterionById,
      projectId,
      workspaceRoot,
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
    };

    let runtimeError: AttemptExecution['runtimeError'];
    let usageTokens: number | undefined;
    try {
      const result = await deps.agentRuntime.execute(runInput);
      // The host reports the run's own token usage on the return (deterministic —
      // no persist-queue race). Surface it to the controller's §19.2 token budget;
      // the loop debits `tokenBudget` by `usage.tokens` after the attempt. Sum ALL
      // token fields (input + output + cache read/write) so the budget cap tracks
      // the SAME total `reconcileRoot` rolls into agent_runs for cost — a budget
      // that ignored cache tokens would silently overshoot on cache-heavy runs.
      if (result.usage) {
        const u = result.usage;
        usageTokens = (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
      }
    } catch (err) {
      // A thrown agent run is INFRA (transport / runtime) — the controller maps
      // runtimeError → BLOCKED without consuming a repair (§19.2 / §5). A product
      // failure is NEVER signaled by a throw; it is decided by the evaluators.
      runtimeError = {
        code: 'runtime_error',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      unsubscribe();
    }

    // Stamp the attempt's root agent run id (runId === attemptId by design) so the
    // attempt row joins to its `agent_runs` row for usage/cost and future durable
    // recovery — regardless of outcome (a failed/blocked attempt still produced a
    // run). Best-effort: a write failure here must not fail the attempt.
    try {
      await deps.repos.missionAttempts?.setRootRunId(input.attemptId, attemptRunId);
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

/**
 * Parse the authored mission budget caps from `mission.budget_json` into the
 * loop's {@link MissionLoopBudget} overrides. Only finite numbers are honored;
 * anything else leaves the loop on its §19.2 defaults. Kept inline so the
 * runtime layer does not depend on the UI surface that authors the budget.
 */
function parseMissionBudgetJson(
  budgetJson: string | null | undefined,
): { tokenBudget?: number; maxAttempts?: number } | null {
  if (!budgetJson) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(budgetJson);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { tokenBudget?: unknown; maxAttempts?: unknown };
  const out: { tokenBudget?: number; maxAttempts?: number } = {};
  if (typeof obj.tokenBudget === 'number' && Number.isFinite(obj.tokenBudget)) {
    out.tokenBudget = obj.tokenBudget;
  }
  if (typeof obj.maxAttempts === 'number' && Number.isFinite(obj.maxAttempts)) {
    out.maxAttempts = obj.maxAttempts;
  }
  return out.tokenBudget !== undefined || out.maxAttempts !== undefined ? out : null;
}

function requireRepo<K extends keyof RuntimeRepositories>(
  repos: RuntimeRepositories,
  key: K,
): NonNullable<RuntimeRepositories[K]> {
  const repo = repos[key];
  if (!repo) {
    throw new Error(`MissionRunController requires repos.${String(key)}, which is unavailable.`);
  }
  return repo as NonNullable<RuntimeRepositories[K]>;
}
