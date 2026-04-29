import type { RunnableConfig } from '@langchain/core/runnables';
import { graphNodeEntered } from '../../events/event-factories.js';
import { type OffisimGraphState, createEmptyPlanScopedState } from '../../graph/state.js';
import { getRuntime } from '../../utils/get-runtime.js';
import type { PmPreflightOutcome } from '../pm-planner-types.js';
import { parseReviewedPlanPayload } from './plan-review-payload.js';

export async function runPmPreflight(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<PmPreflightOutcome> {
  const runtimeCtx = getRuntime(config, 'pm_planner');

  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'pm_planner'));

  const { repos, companyId, threadId } = runtimeCtx;
  const directive = state.managerDirective;
  const interactionService = runtimeCtx.interactionService;
  const interactionMode = interactionService?.getMode() ?? 'boss_proxy';
  const planReviewDecision = interactionService?.consumePlanReviewDecision(threadId) ?? null;
  const approvedToExecute = planReviewDecision?.selectedOptionId === 'start_execution';
  const cancelled = planReviewDecision?.selectedOptionId === 'cancel';
  const planRevisionNote =
    planReviewDecision?.selectedOptionId === 'revise_plan'
      ? planReviewDecision.freeformResponse?.trim() || 'Revise the plan before execution.'
      : null;
  const reviewedPlan =
    approvedToExecute && planReviewDecision?.reviewedPayload
      ? await parseReviewedPlanPayload(planReviewDecision.reviewedPayload)
      : null;

  const emptyPlan = (interruptReason: string | null): Partial<OffisimGraphState> => ({
    ...createEmptyPlanScopedState(),
    taskPlan: null,
    interruptReason,
  });

  if (cancelled) {
    await repos.threads.updateStatus(threadId, 'cancelled');
    return {
      kind: 'short-circuit',
      result: {
        ...emptyPlan('pm-preflight-cancelled'),
      },
    };
  }

  if (approvedToExecute && !reviewedPlan) {
    await repos.threads.updateStatus(threadId, 'cancelled');
    return {
      kind: 'short-circuit',
      result: {
        ...emptyPlan('pm-preflight-invalid-reviewed-plan'),
        interruptReason: 'Plan review approval payload was missing, invalid, or hash-mismatched.',
      },
    };
  }

  if (!directive || directive.recommendedEmployees.length === 0) {
    return { kind: 'short-circuit', result: emptyPlan('pm-preflight-no-directive') };
  }

  const employeeDetails = await Promise.all(
    directive.recommendedEmployees.map((id) => repos.employees.findById(id)),
  );
  const validEmployees = employeeDetails.filter(
    (e): e is NonNullable<typeof e> => e !== null && e.enabled === 1,
  );

  if (validEmployees.length === 0) {
    return { kind: 'short-circuit', result: emptyPlan('pm-preflight-no-employee') };
  }

  const allEmployees = await repos.employees.findByCompany(companyId);
  const allEnabled = allEmployees.filter((e) => e.enabled === 1);

  return {
    kind: 'ready',
    runtimeCtx,
    state,
    directive,
    interactionMode,
    approvedToExecute,
    planRevisionNote,
    reviewedPlan,
    validEmployees,
    allEnabled,
  };
}
