import type { InteractionMode } from '@offisim/shared-types';
import type { ExternalDepartmentDefinition } from '../a2a/external-departments.js';
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
  validDepartments: ExternalDepartmentDefinition[];
  allEnabled: EmployeeRow[];
}

export type PmPreflightOutcome =
  | { kind: 'short-circuit'; result: Partial<OffisimGraphState> }
  | PmPreflightReady;
