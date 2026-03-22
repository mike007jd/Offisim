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
  /** Grouping label for multi-phase projects, e.g. "需求调研", "核心开发" */
  phase?: string;
  /** DAG: which steps must complete before this one starts. Reserved for future parallel dispatch. */
  dependsOnSteps?: number[];
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
  sopTemplateId?: string;  // explicit SOP selection — bypasses substring matching
}

/** A citation reference extracted from an employee response. */
export interface CitationRef {
  /** 1-based index matching [N] in the response text. */
  index: number;
  docTitle: string;
  docId: string;
  snippet: string;
}

export interface StepTaskOutput {
  employeeId: string;
  employeeName: string;
  content: string;
  taskRunId: string;
  /** Library document citations used in this response (empty array if none). */
  citations?: CitationRef[];
}

export interface StepResult {
  stepIndex: number;
  outputs: StepTaskOutput[];
}

export interface MeetingActionItem {
  taskRunId: string;
  description: string;
  assigneeEmployeeId: string;
  assigneeName: string;
  priority: 'high' | 'medium' | 'low';
  dependsOn: string[];
}

/** Boss can send an interrupt to a running meeting. */
export type MeetingInterruptType = 'pause' | 'end' | 'inject' | null;

/** When interrupt type is 'inject', this carries the boss comment. */
export interface MeetingInterrupt {
  type: MeetingInterruptType;
  /** Boss comment injected into the meeting (only used when type === 'inject'). */
  bossComment?: string;
}

export const AicsGraphAnnotation = Annotation.Root({
  // Thread tracking
  threadId: Annotation<string>,
  companyId: Annotation<string>,
  entryMode: Annotation<
    'boss_chat' | 'meeting' | 'install_flow' | 'background_sync' | 'direct_chat'
  >,

  // Project scoping — null when running outside a project context
  projectId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Direct chat target
  targetEmployeeId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

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

  // P2: Handoff guard rail counter (only employeeNode writes this)
  handoffCount: Annotation<number>({
    default: () => 0,
    reducer: (_, b) => b, // last-write-wins
  }),

  // P2: Meeting action items populated by meetingEndNode, read by bossSummaryNode
  meetingActionItems: Annotation<MeetingActionItem[]>({
    default: () => [],
    reducer: (_, b) => b,
  }),

  // P2.5: Boss meeting interrupt — pause, end, or inject comment
  meetingInterrupt: Annotation<MeetingInterrupt | null>({
    default: () => null,
    reducer: (_, v) => v,
  }),

  // HR assessment output — populated by hrNode, consumed by bossSummaryNode
  hrAssessment: Annotation<string | null>({
    default: () => null,
    reducer: (_, v) => v,
  }),
});

export type AicsGraphState = typeof AicsGraphAnnotation.State;
