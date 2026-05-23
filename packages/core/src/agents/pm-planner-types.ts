import type { InteractionMode, RunScope } from '@offisim/shared-types';
import type { ManagerDirective, OffisimGraphState } from '../graph/state.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

export interface LlmPlanStep {
  stepIndex: number;
  description: string;
  phase?: string;
  dependsOnSteps?: number[];
  tasks: Array<{
    taskType: string;
    employeeId: string;
    description: string;
    dependsOnStepOutput: boolean;
    requiredSkills?: string[];
  }>;
}

export interface LlmPlan {
  summary: string;
  steps: LlmPlanStep[];
  /**
   * Optional planner-recommended employee ordering. When present, sanitize-rebind
   * uses this order to pick a fallback employee instead of iteration order from
   * the company roster. The PM-planner falls back to `ManagerDirective.recommendedEmployees`
   * when the LLM plan does not include this field.
   */
  recommendedEmployees?: string[];
}

export interface PmPreflightReady {
  kind: 'ready';
  runtimeCtx: RuntimeContext;
  state: OffisimGraphState;
  directive: ManagerDirective;
  interactionMode: InteractionMode;
  approvedToExecute: boolean;
  planRevisionNote: string | null;
  reviewedPlan: LlmPlan | null;
  validEmployees: EmployeeRow[];
  allEnabled: EmployeeRow[];
  runScope: RunScope | null;
  /**
   * Full company roster (enabled + disabled). Sanitize-rebind needs the
   * disabled rows so it can distinguish `employee-disabled` from
   * `employee-not-found` when classifying a rebind reason.
   */
  allEmployees: EmployeeRow[];
}

export type PmPreflightOutcome =
  | { kind: 'short-circuit'; result: Partial<OffisimGraphState> }
  | PmPreflightReady;
