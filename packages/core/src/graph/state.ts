import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

export interface PendingAssignment {
  taskType: string;
  employeeId: string;
  inputJson: Record<string, unknown>;
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
});

export type AicsGraphState = typeof AicsGraphAnnotation.State;
