/**
 * Sanitize-rebind — replaces invalid `task.employeeId` entries in an LlmPlan
 * with a planner-recommended fallback (or, as a last resort, the first valid
 * employee), and emits a `task.assignment.rerouted` event for every swap so
 * the rebind is observable in the activity feed and headless logs.
 */

import type { TaskAssignmentRerouteReason } from '@offisim/shared-types';
import type { EventBus } from '../../events/event-bus.js';
import type { EmployeeRow } from '../../runtime/repositories.js';
import { emitAssignmentRerouted } from '../emit-assignment-rerouted.js';
import type { LlmPlan } from '../pm-planner-types.js';

export interface SanitizeRebindContext {
  readonly companyId: string;
  readonly threadId: string;
  readonly eventBus: EventBus;
  /**
   * Planner-recommended employee ordering. Comes from the LLM plan
   * (`plan.recommendedEmployees`) when present, otherwise from
   * `ManagerDirective.recommendedEmployees`. Empty array means "no
   * recommendation — must fall back to iteration order".
   */
  readonly recommendedEmployees: readonly string[];
  /**
   * All known employees for the company (enabled and disabled), used to
   * distinguish `employee-not-found` from `employee-disabled` reasons.
   */
  readonly allEmployees: readonly EmployeeRow[];
}

function pickResolvedEmployee(
  validEmployees: readonly EmployeeRow[],
  recommendedEmployees: readonly string[],
): { id: string; usedRecommendation: boolean } | null {
  const validIds = new Set(validEmployees.map((e) => e.employee_id));
  for (const recId of recommendedEmployees) {
    if (validIds.has(recId)) {
      return { id: recId, usedRecommendation: true };
    }
  }
  const fallback = validEmployees[0];
  if (!fallback) return null;
  return { id: fallback.employee_id, usedRecommendation: false };
}

function classifyDropReason(
  requestedEmployeeId: string,
  allEmployees: readonly EmployeeRow[],
  usedRecommendation: boolean,
): TaskAssignmentRerouteReason {
  const found = allEmployees.find((e) => e.employee_id === requestedEmployeeId);
  if (!found) return 'employee-not-found';
  if (found.enabled !== 1) return 'employee-disabled';
  return usedRecommendation ? 'employee-not-found' : 'no-recommendation-fallback';
}

/**
 * Walk the plan steps; for any task whose `employeeId` isn't in `validEmployees`,
 * substitute the first valid recommended employee (or `validEmployees[0]` as
 * last resort) and emit a `task.assignment.rerouted` event for the swap.
 *
 * Returns the rebound plan. Does NOT mutate the input plan.
 *
 * If `validEmployees` is empty, returns the plan unchanged (caller handles
 * the no-employee short-circuit upstream).
 */
export function sanitizePlanEmployees(
  plan: LlmPlan,
  validEmployees: readonly EmployeeRow[],
  ctx: SanitizeRebindContext,
): LlmPlan {
  if (validEmployees.length === 0) return plan;
  const validIds = new Set(validEmployees.map((e) => e.employee_id));

  return {
    ...plan,
    steps: plan.steps.map((step) => ({
      ...step,
      tasks: step.tasks.map((task) => {
        if (validIds.has(task.employeeId)) return task;
        const resolved = pickResolvedEmployee(validEmployees, ctx.recommendedEmployees);
        if (!resolved) return task;
        const reason = classifyDropReason(
          task.employeeId,
          ctx.allEmployees,
          resolved.usedRecommendation,
        );
        // The LLM plan tasks have no taskRunId yet; persistence assigns one after rebind.
        // Synthetic ID makes the rerouted event identifiable in the activity feed.
        emitAssignmentRerouted({
          companyId: ctx.companyId,
          threadId: ctx.threadId,
          taskRunId: `pm:${ctx.threadId}:${step.stepIndex}`,
          requestedEmployeeId: task.employeeId,
          resolvedEmployeeId: resolved.id,
          reason,
          source: 'pm-planner',
          eventBus: ctx.eventBus,
        });
        return { ...task, employeeId: resolved.id };
      }),
    })),
  };
}
