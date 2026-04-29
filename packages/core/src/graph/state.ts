import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { InteractionMode, RoleSlug } from '@offisim/shared-types';
import type { RecentToolResult } from '../runtime/completion-verifier.js';

export type AssignmentTargetKind = 'employee';

export interface PendingAssignment {
  taskType: string;
  employeeId: string;
  assigneeKind?: AssignmentTargetKind;
  assigneeName?: string;
  inputJson: Record<string, unknown>;
  taskRunId?: string;
  stepIndex?: number;
}

export interface PlanTask {
  taskType: string;
  employeeId: string;
  assigneeKind?: AssignmentTargetKind;
  assigneeName?: string;
  description: string;
  dependsOnStepOutput: boolean;
  requiredSkills?: string[];
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

export interface PmHeartbeatSnapshot {
  dispatchedCount: number;
  completedCount: number;
  blockedCount: number;
  planSignature: string;
}

export interface ManagerDirective {
  intent: string;
  recommendedEmployees: string[];
  constraints?: string;
  sopTemplateId?: string; // explicit SOP selection — bypasses substring matching
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
  sourceKind?: AssignmentTargetKind;
  roleSlug: RoleSlug;
  content: string;
  taskRunId: string;
  stepIndex: number;
  artifact?:
    | {
        kind: 'file';
        fileName: string | null;
        mimeType: string | null;
        content: string;
      }
    | undefined;
  /** Library document citations used in this response (empty array if none). */
  citations?: CitationRef[];
}

export interface StepResult {
  stepIndex: number;
  outputs: StepTaskOutput[];
}

export interface CompactBaselineState {
  compactId: string;
  compactVersion: number;
  compactedAt: string;
  summaryText: string;
  compactedNonSystemMessageCount: number;
  keptTailNonSystemMessageCount: number;
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

export const OffisimGraphAnnotation = Annotation.Root({
  // Thread tracking
  threadId: Annotation<string>,
  companyId: Annotation<string>,
  entryMode: Annotation<
    'boss_chat' | 'meeting' | 'install_flow' | 'background_sync' | 'direct_chat' | 'heartbeat'
  >,

  interactionMode: Annotation<InteractionMode>({
    reducer: (_prev, next) => next,
    default: () => 'boss_proxy',
  }),

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

  /** SOP template ID selected by boss — PM planner uses it to build the plan from SOP. */
  selectedSopTemplateId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // LangGraph message list (with built-in reducer)
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  compactBaseline: Annotation<CompactBaselineState | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Routing
  routeDecision: Annotation<
    'direct_reply' | 'delegate_manager' | 'start_meeting' | 'direct_delegate' | null
  >({
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

  recentToolResults: Annotation<RecentToolResult[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // DAG dispatch tracking
  /** Indices of steps whose tasks have been queued (may still be running). */
  dispatchedStepIndices: Annotation<number[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Indices of steps that have fully completed (all tasks done). */
  completedStepIndices: Annotation<number[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Indices of steps that reached a verifier/user-intervention block. */
  blockedStepIndices: Annotation<number[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  pmHeartbeatLastSnapshot: Annotation<PmHeartbeatSnapshot | null>({
    reducer: (_prev, next) => next,
    default: () => null,
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

  // Dynamic re-planning counter — max 3 replans per execution
  replanCount: Annotation<number>({
    default: () => 0,
    reducer: (_, v) => v,
  }),
});

export type OffisimGraphState = typeof OffisimGraphAnnotation.State;

export function createEmptyPlanScopedState(): Partial<OffisimGraphState> {
  return {
    // plan-scoped: stale tool evidence must never carry into a newly planned turn.
    recentToolResults: [],
    pendingAssignments: [],
    dispatchedStepIndices: [],
    completedStepIndices: [],
    blockedStepIndices: [],
    pmHeartbeatLastSnapshot: null,
    stepResults: [],
    currentStepOutputs: [],
    currentStepIndex: 0,
    currentTaskRunId: null,
    currentEmployeeId: null,
    interruptReason: null,
    completed: false,
    // plan-scoped: these are derived by manager/meeting/HR for the current work item.
    meetingActionItems: [],
    hrAssessment: null,
    managerDirective: null,
  };
}

export function parseCompactBaseline(raw: string | null): CompactBaselineState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CompactBaselineState>;
    if (
      typeof parsed.compactId !== 'string' ||
      typeof parsed.compactVersion !== 'number' ||
      typeof parsed.compactedAt !== 'string' ||
      typeof parsed.summaryText !== 'string' ||
      typeof parsed.compactedNonSystemMessageCount !== 'number' ||
      typeof parsed.keptTailNonSystemMessageCount !== 'number'
    ) {
      return null;
    }
    return {
      compactId: parsed.compactId,
      compactVersion: parsed.compactVersion,
      compactedAt: parsed.compactedAt,
      summaryText: parsed.summaryText,
      compactedNonSystemMessageCount: parsed.compactedNonSystemMessageCount,
      keptTailNonSystemMessageCount: parsed.keptTailNonSystemMessageCount,
    };
  } catch {
    return null;
  }
}
