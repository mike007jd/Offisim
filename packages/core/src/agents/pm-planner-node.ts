import type { RunnableConfig } from '@langchain/core/runnables';
import type { OffisimGraphState } from '../graph/state.js';
import { getConfigSignal } from '../utils/get-signal.js';
import type { LlmPlan } from './pm-planner-types.js';
import { buildLlmPlanFallback, parsePmPlan, taskTypeForRole } from './pm-planner/plan-parser.js';
import { persistLlmPlanAsTaskPlan } from './pm-planner/plan-persistence.js';
import { awaitPlanReview } from './pm-planner/plan-review-gate.js';
import { runPmPreflight } from './pm-planner/preflight.js';
import { PM_SYSTEM_PROMPT, generatePmLlmContent } from './pm-planner/prompt-assembly.js';
import { detectWholeTeamIntent } from './whole-team-intent.js';

export type { LlmPlanStep } from './pm-planner-types.js';
export { PM_SYSTEM_PROMPT, parsePmPlan };

function shouldRethrowPlannerError(error: unknown, config: RunnableConfig): boolean {
  const signal = getConfigSignal(config);
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(no-credential|No provider credential|API key|unauthorized|forbidden)\b/i.test(message);
}

function ensureRecommendedEmployeesCovered(
  plan: LlmPlan,
  prep: Awaited<ReturnType<typeof runPmPreflight>>,
): LlmPlan {
  if (prep.kind === 'short-circuit') return plan;
  const recommendedIds = prep.directive.recommendedEmployees;
  if (plan.summary.startsWith('Fallback phased artifact workflow for:')) {
    return plan;
  }
  if (!detectWholeTeamIntent(prep.directive.intent, recommendedIds.length)) {
    return plan;
  }

  const assignedIds = new Set(
    plan.steps.flatMap((step) => step.tasks.map((task) => task.employeeId)),
  );
  const recommendedSet = new Set(recommendedIds);
  const missingEmployees = prep.validEmployees.filter(
    (employee) =>
      recommendedSet.has(employee.employee_id) && !assignedIds.has(employee.employee_id),
  );
  if (missingEmployees.length === 0) return plan;

  const [firstStep, ...restSteps] = plan.steps;
  const targetStep = firstStep ?? {
    stepIndex: 0,
    description: prep.directive.intent,
    tasks: [],
  };
  return {
    ...plan,
    recommendedEmployees: plan.recommendedEmployees ?? recommendedIds,
    steps: [
      {
        ...targetStep,
        tasks: [
          ...targetStep.tasks,
          ...missingEmployees.map((employee) => ({
            taskType: taskTypeForRole(employee.role_slug),
            employeeId: employee.employee_id,
            description: `Join the full-team collaboration for: ${prep.directive.intent}`,
            dependsOnStepOutput: false,
          })),
        ],
      },
      ...restSteps,
    ],
  };
}

export async function pmPlannerNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const prep = await runPmPreflight(state, config);
  if (prep.kind === 'short-circuit') return prep.result;

  let plan: LlmPlan | null = prep.reviewedPlan;

  if (!plan) {
    let content = '';
    try {
      content = await generatePmLlmContent(prep, config);
    } catch (error) {
      if (shouldRethrowPlannerError(error, config)) throw error;
      content = '';
    }
    plan = parsePmPlan(content) ?? buildLlmPlanFallback(prep.validEmployees, prep.directive.intent);
  }
  plan = ensureRecommendedEmployeesCovered(plan, prep);

  await awaitPlanReview(plan, prep);

  return persistLlmPlanAsTaskPlan(plan, prep);
}
