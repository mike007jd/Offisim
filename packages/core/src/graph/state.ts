import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';

export interface PendingAssignment {
  taskType: string;
  employeeId: string;
  inputJson: Record<string, unknown>;
}

export interface PlanTask {
  taskType: string;
  employeeId: string;
  description: string;
  dependsOnStepOutput: boolean;
  taskRunId?: string;
}

export interface PlanStep {
  stepIndex: number;
  description: string;
  tasks: PlanTask[];
}

export interface TaskPlan {
  planId: string;
  threadId: string;
  companyId: string;
  steps: PlanStep[];
  summary: string;
}

export interface ManagerDirective {
  intent: string;
  recommendedEmployees: string[];
  constraints?: string;
}

export interface StepTaskOutput {
  employeeId: string;
  employeeName: string;
  content: string;
  taskRunId: string;
}

export interface StepResult {
  stepIndex: number;
  outputs: StepTaskOutput[];
}

export const AicsGraphAnnotation = Annotation.Root({
  // Thread tracking
  threadId: Annotation<string>,
  companyId: Annotation<string>,
  entryMode: Annotation<'boss_chat' | 'meeting' | 'install_flow' | 'background_sync'>,

  // LangGraph message list (with built-in reducer)
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // Routing
  routeDecision: Annotation<'direct_reply' | 'delegate_manager' | 'start_meeting' | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Current execution
  currentTaskRunId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  currentEmployeeId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Manager's queue
  pendingAssignments: Annotation<PendingAssignment[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // Completion
  completed: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  // Interrupt
  interruptReason: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Meeting-specific
  meetingId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Manager → PM directive
  managerDirective: Annotation<ManagerDirective | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // PM plan
  taskPlan: Annotation<TaskPlan | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  currentStepIndex: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  stepResults: Annotation<StepResult[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentStepOutputs: Annotation<StepTaskOutput[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
});

export type AicsGraphState = typeof AicsGraphAnnotation.State;
