import type { RunnableConfig } from '@langchain/core/runnables';
import type { OffisimGraphState } from '../graph/state.js';
import { getConfigSignal } from '../utils/get-signal.js';
import type { LlmPlan } from './pm-planner-types.js';
import { buildLlmPlanFallback, parsePmPlan } from './pm-planner/plan-parser.js';
import { persistLlmPlanAsTaskPlan } from './pm-planner/plan-persistence.js';
import { awaitPlanReview } from './pm-planner/plan-review-gate.js';
import { runPmPreflight } from './pm-planner/preflight.js';
import { PM_SYSTEM_PROMPT, generatePmLlmContent } from './pm-planner/prompt-assembly.js';

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

function shouldRequireRecommendedEmployeeCoverage(
  intent: string,
  recommendedCount: number,
): boolean {
  if (recommendedCount <= 1) return false;
  return (
    /\b(all|everyone|whole team|entire team|all employees|team-wide)\b/i.test(intent) ||
    /全员|所有员工|整个团队|全团队|共同合作|一起合作|分成\s*[一二三四五六七八九十0-9]+\s*组/u.test(
      intent,
    ) ||
    /完整办公室团队|办公室团队/u.test(intent) ||
    new RegExp(`\\b${recommendedCount}\\s*(employees|people|members)\\b`, 'i').test(intent) ||
    new RegExp(`${recommendedCount}\\s*(个|位)?\\s*(员工|成员|人)`, 'u').test(intent)
  );
}

function taskTypeForRole(roleSlug: string): string {
  if (roleSlug.includes('design')) return 'design';
  if (roleSlug.includes('review') || roleSlug.includes('qa')) return 'review';
  if (roleSlug.includes('manager')) return 'analysis';
  if (roleSlug.includes('engineer') || roleSlug.includes('developer')) return 'code';
  return 'general';
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
  if (!shouldRequireRecommendedEmployeeCoverage(prep.directive.intent, recommendedIds.length)) {
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
