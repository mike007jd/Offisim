/** Maximum number of employee-to-employee handoffs per thread. */
export const MAX_HANDOFF_COUNT = 3;

/** Maximum number of conversation messages sent to the LLM in a single call.
 *  Prevents unbounded token growth in long direct-chat sessions. */
export const MAX_CONTEXT_MESSAGES = 20;

/** Task type for handoff continuation tasks. */
export const TASK_TYPE_HANDOFF_CONTINUATION = 'handoff_continuation';

/** Maximum LLM tool-call rounds per employee turn before the loop is broken. */
export const MAX_TOOL_ROUNDS = 32;
