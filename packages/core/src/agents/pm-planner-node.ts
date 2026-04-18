import type { RunnableConfig } from '@langchain/core/runnables';
import type { OffisimGraphState } from '../graph/state.js';
import { runPmPreflight } from './pm-planner/preflight.js';
import { buildLlmPlanFallback, parsePmPlan } from './pm-planner/plan-parser.js';
import { persistDepartmentPlan, persistLlmPlanAsTaskPlan } from './pm-planner/plan-persistence.js';
import { awaitPlanReview } from './pm-planner/plan-review-gate.js';
import { PM_SYSTEM_PROMPT, generatePmLlmContent } from './pm-planner/prompt-assembly.js';
import {
  findEmployeeForRole,
  matchSopTemplate,
  sopBatchesToLlmPlan,
  tryBuildExplicitSopPlan,
  tryBuildSopPlan,
} from './pm-planner/sop-matching.js';
import type { LlmPlan } from './pm-planner-types.js';

export type { LlmPlanStep } from './pm-planner-types.js';
export {
  PM_SYSTEM_PROMPT,
  parsePmPlan,
  matchSopTemplate,
  findEmployeeForRole,
  sopBatchesToLlmPlan,
  tryBuildSopPlan,
};

export async function pmPlannerNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const prep = await runPmPreflight(state, config);
  if (prep.kind === 'short-circuit') return prep.result;

  if (prep.validDepartments.length > 0) {
    return persistDepartmentPlan(prep);
  }

  let plan: LlmPlan | null = prep.reviewedPlan;
  let sopTemplateId: string | undefined;

  if (prep.directive.sopTemplateId && !prep.planRevisionNote) {
    const explicit = await tryBuildExplicitSopPlan(
      prep.runtimeCtx.repos,
      prep.runtimeCtx.eventBus,
      prep.directive.sopTemplateId,
      prep.allEnabled,
    );
    if (explicit) {
      plan = explicit.plan;
      sopTemplateId = explicit.sopTemplateId;
    }
  }

  if (!plan && !prep.planRevisionNote) {
    const sop = await tryBuildSopPlan(
      prep.runtimeCtx.repos,
      prep.runtimeCtx.eventBus,
      prep.runtimeCtx.companyId,
      prep.directive.intent,
      prep.allEnabled,
    );
    if (sop) {
      plan = sop.plan;
      sopTemplateId = sop.sopTemplateId;
    }
  }

  if (!plan) {
    const content = await generatePmLlmContent(prep, config);
    plan = parsePmPlan(content) ?? buildLlmPlanFallback(prep.validEmployees, prep.directive.intent);
  }

  await awaitPlanReview(plan, prep);

  return persistLlmPlanAsTaskPlan(plan, prep, sopTemplateId);
}
