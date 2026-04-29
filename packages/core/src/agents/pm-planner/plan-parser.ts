import type { EmployeeRow } from '../../runtime/repositories.js';
import { extractJsonFromLlm } from '../../utils/extract-json.js';
import type { LlmPlan, LlmPlanStep } from '../pm-planner-types.js';

export type { LlmPlanStep };

/** Single-step fallback plan when the LLM response cannot be parsed. */
export function buildLlmPlanFallback(employees: EmployeeRow[], intent: string): LlmPlan {
  return {
    summary: `Execute task: ${intent}`,
    steps: [
      {
        stepIndex: 0,
        description: intent,
        tasks: employees.map((e) => ({
          taskType: 'general',
          employeeId: e.employee_id,
          description: intent,
          dependsOnStepOutput: false,
        })),
      },
    ],
  };
}

export function parsePmPlan(content: string): LlmPlan | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;
  if (typeof parsed.summary !== 'string') return null;
  if (!Array.isArray(parsed.steps)) return null;

  const steps: LlmPlanStep[] = [];
  for (const s of parsed.steps) {
    if (typeof s !== 'object' || s === null) continue;
    const step = s as Record<string, unknown>;
    if (typeof step.stepIndex !== 'number') continue;
    if (typeof step.description !== 'string') continue;
    if (!Array.isArray(step.tasks)) continue;

    const tasks: LlmPlanStep['tasks'] = [];
    for (const t of step.tasks) {
      if (typeof t !== 'object' || t === null) continue;
      const task = t as Record<string, unknown>;
      if (
        typeof task.taskType === 'string' &&
        typeof task.employeeId === 'string' &&
        typeof task.description === 'string'
      ) {
        tasks.push({
          taskType: task.taskType,
          employeeId: task.employeeId,
          description: task.description,
          dependsOnStepOutput:
            typeof task.dependsOnStepOutput === 'boolean' ? task.dependsOnStepOutput : false,
          requiredSkills: Array.isArray(task.requiredSkills)
            ? task.requiredSkills.filter((skill): skill is string => typeof skill === 'string')
            : undefined,
        });
      }
    }

    if (tasks.length > 0) {
      steps.push({
        stepIndex: step.stepIndex,
        description: step.description,
        tasks,
        phase: typeof step.phase === 'string' ? step.phase : undefined,
        dependsOnSteps: Array.isArray(step.dependsOnSteps)
          ? step.dependsOnSteps.filter((n): n is number => typeof n === 'number')
          : undefined,
      });
    }
  }

  if (steps.length === 0) return null;
  const recommendedEmployees = Array.isArray(parsed.recommendedEmployees)
    ? parsed.recommendedEmployees.filter((id): id is string => typeof id === 'string')
    : undefined;
  return {
    summary: parsed.summary,
    steps,
    ...(recommendedEmployees && recommendedEmployees.length > 0 ? { recommendedEmployees } : {}),
  };
}
