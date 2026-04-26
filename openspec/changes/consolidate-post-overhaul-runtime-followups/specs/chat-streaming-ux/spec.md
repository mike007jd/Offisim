## ADDED Requirements

### Requirement: Streaming finalize commits exactly one assistant message per turn

For a single chat turn (one user message → one assistant reply, identified by `conversationKey + runId`), the chat session store SHALL hold exactly one `appendMessage(role: 'assistant')` row at finalize. Streaming-tail-commit, final-commit, reasoning-region commit, or any other commit path MUST NOT each write a separate assistant message — they SHALL converge into a single message with `content` (final body) + `reasoning` (collapsible region, optional).

This invariant SHALL hold across:
- team chat and direct chat
- runs that produced reasoning + content vs content-only
- runs that aborted vs completed normally
- runs that triggered tool_call interactions inline

If the codebase has multiple commit code paths, they SHALL share a single `finalizeAssistantMessage(conversationKey, runId, payload)` entry so the dedupe is enforced structurally, not by post-write cleanup.

#### Scenario: Boss reply with reasoning produces single message

- **WHEN** the user sends `hi` in team chat and the Boss replies with a reasoning-fold + content body
- **THEN** the chat session store contains exactly one assistant message for that turn, with the reasoning section + content body merged on the same row

#### Scenario: Aborted streaming still leaves one message

- **WHEN** the user aborts an in-progress streaming reply mid-content
- **THEN** the chat session store contains exactly one assistant message for that turn (the partial content captured at abort), not zero and not two

#### Scenario: Tool call mid-stream does not split into two messages

- **WHEN** an assistant turn invokes a tool call mid-stream and resumes content after the tool result
- **THEN** the resumed content appends to the same assistant message row, the row count for that turn remains exactly one
