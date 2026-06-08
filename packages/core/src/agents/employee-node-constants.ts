/** Maximum number of employee-to-employee handoffs per thread. */
export const MAX_HANDOFF_COUNT = 3;

/** Maximum number of conversation messages sent to the LLM in a single call.
 *  Prevents unbounded token growth in long direct-chat sessions. */
export const MAX_CONTEXT_MESSAGES = 20;

/** Task type for handoff continuation tasks. */
export const TASK_TYPE_HANDOFF_CONTINUATION = 'handoff_continuation';

/**
 * Runaway safety ceiling on LLM tool-call rounds per employee turn.
 *
 * This is NOT the normal exit — the loop's real stop condition is "the model
 * stopped emitting tool calls" (employee-node.ts), matching Codex / Claude Code
 * which bound only by token budget + a high iteration guard, never a small fixed
 * round count. A low cap (the old value was 32) truncated genuinely long
 * agentic tasks mid-flight with a `[MAX_TOOL_ROUNDS_PARTIAL]` stub. We keep a
 * high guard so a misbehaving model can't loop forever (the DUPLICATE_TOOL_CALL
 * guard in employee-tool-round.ts already breaks exact-repeat spirals, and the
 * graph recursion limit of 400 bounds the whole run), but real long-horizon work
 * now runs to its natural completion. Tunable per model/role via
 * `RuntimeToolLoopPolicy` (tool-loop-policy.ts).
 */
export const MAX_TOOL_ROUNDS = 200;
