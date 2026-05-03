# chat-streaming-ux Specification

## Purpose

Chat rail 的 streaming UX 契约：让 LLM 响应在 `llm.stream.chunk` 事件陆续到来时真正逐段填充进同一个气泡，placeholder 只占住 `node entered` 到 `first chunk` 之间的空窗，partial / completed / interrupted / failed 四态视觉清晰，team chat 与 direct chat 行为一致，不与 scene / footer 矛盾。
## Requirements
### Requirement: Real content streams into the visible bubble
Whenever `llm.stream.chunk` events carry non-empty `content` for a node in `VISIBLE_STREAMING_NODES`, the chat `StreamingBubble` SHALL render the accumulated content within 200 ms of each chunk arrival. A placeholder string SHALL NOT remain visible once any real content has accumulated.

#### Scenario: Chunks progressively fill the bubble
- **WHEN** the user sends a task that the runtime dispatches to an employee, and `llm.stream.chunk` events arrive every 50–200 ms with non-empty `content`
- **THEN** the `StreamingBubble` text grows over time (not static); the placeholder string (e.g. `"Working through the request..."`) is no longer visible once the first chunk is rendered

### Requirement: Placeholder shows only in the pre-chunk gap
A node-scoped placeholder SHALL appear only when all of the following are true:
1. The active run has an assigned `nodeName` that is in `VISIBLE_STREAMING_NODES`
2. `content` is the empty string
3. `reasoning` is the empty string

In any other state (node unknown, content non-empty, reasoning non-empty, run terminated) the placeholder SHALL NOT render.

#### Scenario: Node known, no chunk yet
- **WHEN** `graph.node.entered` fires for `employee` and no `llm.stream.chunk` has yet arrived
- **THEN** the StreamingBubble shows the employee placeholder

#### Scenario: Content arrives, placeholder exits
- **WHEN** the first chunk with non-empty content arrives after entry
- **THEN** the placeholder text is removed in the next render tick; the bubble shows only the accumulated content plus the streaming cursor

### Requirement: Speaker identity is visible throughout streaming
The `StreamingBubble` SHALL display a speaker label (`Boss` / `Manager` / `Employee` / the employee's name in direct chat) for the entire lifetime of the active streaming run, regardless of whether `content` is empty or non-empty.

#### Scenario: Label visible at placeholder stage
- **WHEN** `activeRun.node = 'employee'` and no chunk has arrived
- **THEN** the bubble header displays the `Employee` label (or the resolved employee name in direct chat)

#### Scenario: Label visible through final commit
- **WHEN** the stream completes and the bubble commits into the normal message timeline
- **THEN** the label identity of the committed message matches the streaming bubble's label (no identity flicker)

### Requirement: Partial vs completed states are visually distinct
While streaming, the bubble SHALL display an active indicator (cursor pulse / micro animation). When the stream completes, the indicator SHALL be removed and the bubble SHALL visually match a normal completed message bubble.

#### Scenario: Active cursor during streaming
- **WHEN** chunks are actively arriving (within the last 500 ms)
- **THEN** a blinking cursor / pulse element is visible at the tail of the content

#### Scenario: Clean transition on completion
- **WHEN** the stream terminates with `status='completed'`
- **THEN** within 200 ms the cursor is removed and the bubble's visual weight matches `MessageBubble`'s completed state

### Requirement: Finalization preserves bubble continuity
When a streaming run completes, the committed final message SHALL be perceived as the same bubble that was streaming — not a placeholder disappearance followed by a new bubble popping in.

#### Scenario: No flicker on commit
- **WHEN** the final message is committed to the chat-session-store's message timeline
- **THEN** no layout flicker (visible gap / disappear-reappear) occurs within the render cycle; an observer measuring bubble DOM continuity sees the committed bubble appear at the position the streaming bubble occupied

### Requirement: Partial content is preserved on error or interruption
If a stream fails or is aborted mid-response, the already-streamed partial content SHALL remain visible; the bubble SHALL additionally surface a clear failure/interrupted indicator.

#### Scenario: Stream error mid-flight
- **WHEN** a provider error aborts the run after some chunks have streamed
- **THEN** the already-rendered partial content stays on screen; a failure marker appears alongside (not replacing) the partial text

#### Scenario: User aborts during streaming
- **WHEN** `execution.aborted` fires while content is accumulating
- **THEN** the bubble retains its current text and marks the run as interrupted; the cursor pulse stops

### Requirement: Team and direct chat behave consistently
Streaming behavior (placeholder discipline, label visibility, partial/completed distinction) SHALL be identical between team chat and direct-employee chat modes. Additionally, the direct-chat entry path SHALL reach the LLM transport layer without mutating any frozen or readonly runtime object — the conversation snapshot, agent state, store state, and any provider-config SSOT SHALL only be updated through their declared mutation channels (store actions, reducers, clone-and-replace). This invariant SHALL hold under the stricter JavaScriptCore semantics used by Tauri's macOS webview, where `Object.freeze`-ed targets throw `TypeError` on assignment instead of silently no-op-ing as they do under Chromium dev. For web direct chat specifically, the employee identity resolved at send time SHALL remain stable across the entire run lifecycle: user message append, streaming bubble label, pending interaction preview, follow-up routing, and retry SHALL all refer to the same target employee. When a web chat run fails with a retryable error, the visible retry affordance SHALL remain available across runtime reinit within the same page session until the user dismisses it, sends a replacement message, or successfully retries the failed run. Retrying such a failed direct-chat run SHALL keep the visible streaming bubble and the committed assistant output on the original failed run's conversation rail, even if the user changes the currently selected employee before invoking retry.

#### Scenario: Same streaming discipline in direct chat
- **WHEN** the user enters direct chat with a specific employee and sends a message
- **THEN** the streaming bubble obeys the same rules as team chat: placeholder only in the pre-chunk gap, real content streams in, speaker label is the employee's name throughout

#### Scenario: Direct chat reaches transport on Tauri release bundle
- **WHEN** the user opens a Tauri release bundle (macOS webview / JavaScriptCore), opens direct chat with any employee, and sends a message
- **THEN** no `TypeError: Attempted to assign to readonly property.` is thrown in the pre-transport path; the request reaches `llm_fetch` and the streaming bubble begins accumulating content as in team chat

#### Scenario: Direct-chat preview target matches the employee selected at send time
- **WHEN** the user sends a web direct-chat message while Maya is selected and that run emits a `skill_install_confirm` interaction
- **THEN** the preview bubble SHALL identify Maya as the target employee
- **AND** it SHALL NOT switch to Alex or any previously selected employee unless the user starts a brand-new run targeting that employee

#### Scenario: Retry reuses the failed run target
- **WHEN** a web direct-chat run targeting Maya fails, the user switches the UI selection to Alex, and then invokes retry
- **THEN** the retried run SHALL still target Maya
- **AND** the streaming bubble label, preview bubble, and follow-up message SHALL stay on Maya's conversation rail

#### Scenario: Retry affordance survives runtime reinit
- **WHEN** a web chat run fails with a retryable error, the user changes provider settings in a way that causes `reinitRuntime()`, and the page session remains open
- **THEN** the chat rail SHALL continue to show a visible retry affordance for that failed run after the reinit completes
- **AND** invoking retry SHALL use the same failed-run metadata that existed before the reinit

#### Scenario: Retry affordance clears only when explicitly superseded
- **WHEN** a retryable failed run exists and the user either dismisses the error, sends a brand-new message, or completes a successful retry
- **THEN** the old retry affordance SHALL be removed
- **AND** runtime reinit by itself SHALL NOT count as dismissal or supersession

#### Scenario: Retry result does not jump to the currently selected employee rail
- **WHEN** a direct-chat run for Maya fails, the user switches the visible chat rail to Alex, and then retries the failed Maya run
- **THEN** Alex's rail SHALL NOT receive Maya's streaming bubble or committed assistant result from that retry
- **AND** Maya's rail SHALL receive the retry output instead

### Requirement: Chat streaming UX aligns with scene/footer runtime state
Semantic consistency (not frame-lockstep) SHALL hold between streaming bubble state, 3D/2D scene executing state, and footer cost/latency counters during a run.

#### Scenario: No contradictory surfaces
- **WHEN** the streaming bubble is visibly accumulating content
- **THEN** the footer runtime status SHALL NOT display `idle` and the scene SHALL NOT show the 0-employees-active default; the executing employee(s) SHALL be visible in the scene as `executing`

### Requirement: Reasoning channel streams progressively into the bubble

When `llm.stream.chunk` events arrive with `channel:'reasoning'` for a node in `VISIBLE_STREAMING_NODES`, the `StreamingBubble` SHALL render the accumulated reasoning text within 200 ms of each chunk arrival, growing visibly over time in a dedicated reasoning region within the same bubble. The reasoning region SHALL be visually distinct from the content region (e.g. muted color / smaller type / collapsible) but SHALL be perceived as part of the same speaker's bubble (single speaker label).

#### Scenario: Reasoning chunks fill the reasoning region progressively
- **WHEN** `llm.stream.chunk` events arrive every 200-700 ms with non-empty `reasoning` for an employee turn (no `content` yet)
- **THEN** the reasoning region text grows over time — at frame N+1 the rendered reasoning text is strictly longer than at frame N; it is NOT rendered as one atomic block after all chunks complete

#### Scenario: Reasoning does not clobber content
- **WHEN** after some reasoning chunks, content chunks begin arriving
- **THEN** the content region renders alongside (or replaces the emphasis of) the reasoning region; the reasoning region remains accessible (either visible or collapsed) but NEVER destroys already-accumulated content

### Requirement: Boss delegate routing surfaces reasoning chunks

When the Boss node enters a routing decision that is NOT `direct_reply` (i.e., `delegate_manager`, `start_meeting`, or `direct_delegate`), the Boss LLM call SHALL still emit `llm.stream.chunk` events with `channel:'reasoning'` populated from the provider's reasoning tokens. Content chunks SHALL NOT be emitted on this path (to protect JSON routing-decision parse). The StreamingBubble SHALL display these reasoning chunks under the Boss speaker label.

#### Scenario: Boss delegates after reasoning is visible
- **WHEN** the user asks for a complex task that will be delegated (e.g., a 500-word essay)
- **THEN** during the Boss's JSON routing call, the chat displays a Boss bubble whose reasoning region progressively fills with Boss's internal deliberation (non-empty before the delegate decision completes)
- **AND** the Boss JSON routing decision (delegate target, action) SHALL still parse correctly after stream completion (parity with the pre-fix `.generate()` path)

#### Scenario: Boss direct_reply unchanged
- **WHEN** Boss decides `direct_reply`
- **THEN** the existing behavior from `fix-chat-streaming-ux` is preserved — both `content` and `reasoning` chunks stream, content fills the main region

### Requirement: Manager routing surfaces reasoning chunks

When the Manager node processes a routing/planning LLM call, it SHALL emit `llm.stream.chunk` events with `channel:'reasoning'` during the call. Content chunks SHALL NOT be emitted (same JSON-safety rationale as Boss delegate). `manager` SHALL be included in `VISIBLE_STREAMING_NODES`.

#### Scenario: Manager reasoning visible during routing
- **WHEN** the Manager receives a delegated task and starts its LLM call
- **THEN** the chat displays a Manager bubble whose reasoning region progressively fills; the static `"Analyzing request..."` placeholder is replaced by reasoning text within 500 ms of the first reasoning chunk

### Requirement: Pre-chunk placeholder is dynamic, not static

During the window where `llm.call.started` has fired for a node in `VISIBLE_STREAMING_NODES` but no `llm.stream.chunk` has yet arrived (or only reasoning chunks with empty `reasoning` string have arrived), the placeholder region SHALL:

1. Include a visible motion indicator (e.g. cursor pulse, shimmer background, or animated ellipsis) — NOT a fully static string
2. Include a lightweight elapsed-time indicator at whole-second granularity (e.g. `"Drafting... 12s"`)
3. Continue to display the speaker label

The motion indicator SHALL persist until the first non-empty chunk (reasoning OR content) arrives, at which point it SHALL be replaced by the streaming text + tail cursor.

#### Scenario: Static placeholder is prohibited during active LLM call
- **WHEN** `llm.call.started` has fired for `boss` (delegate path) and 5 seconds have elapsed with no chunks
- **THEN** the bubble displays a dynamic placeholder (e.g. `"Drafting... 5s"` with shimmer / cursor); it is NOT the pre-fix static `"Drafting the response..."` text with no motion

#### Scenario: Placeholder exits cleanly once chunks start
- **WHEN** the first reasoning chunk arrives after a dynamic placeholder window
- **THEN** the placeholder element is removed within 200 ms; the reasoning region begins its progressive reveal per the Reasoning-channel requirement

### Requirement: VISIBLE_STREAMING_NODES includes Boss delegate and Manager

The set of node names that drive the streaming-bubble lifecycle SHALL include at minimum: `boss`, `manager`, `boss_summary`, `employee`, `hr`. Any node that emits `llm.stream.chunk` events (`reasoning` OR `content`) SHALL be a member of this set.

#### Scenario: Chat displays Boss/Manager bubbles during their LLM calls
- **WHEN** a run enters the Boss node and then the Manager node (delegate path)
- **THEN** a `StreamingBubble` with speaker label `Boss` is visible during the Boss LLM call, followed by a bubble with speaker label `Manager` during the Manager LLM call — neither is omitted nor collapsed into a single placeholder

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

### Requirement: Direct chat runtime is partitioned by conversationKey

Direct chat with a specific employee SHALL execute on a LangGraph thread keyed by the chat session store's `conversationKey` (`<projectThread>::<employeeId>`), not the project's team-chat thread. Team chat SHALL keep using the project thread. `ChatPanel.handleSend` and `handleSwapPerson` SHALL set `threadId` to the scoped conversation key whenever `selectedEmployeeId` is set.

`OrchestrationService` SHALL ensure the `graph_threads` row exists for the resolved `threadId` before invoking the graph (creating it on first use with the requested `entry_mode`), so partitioning the runtime per direct-chat conversation does not require user-visible thread bookkeeping.

`bossSummaryNode` SHALL NOT emit `graph.node.entered` when `state.entryMode === 'direct_chat'` and `state.targetEmployeeId` is set. Direct chat closure stays internal; the chat rail must not see the `boss_summary` speaker label for a turn that was never routed through Boss.

#### Scenario: Team chat does not inherit direct chat history

- **WHEN** the user sends "在忙吗" in a direct chat with employee Maya, the run completes, and the user then opens team chat under the same project and sends "hi"
- **THEN** the Boss / Manager / employee LLM calls for the team-chat turn SHALL be assembled from the team-chat conversation's history, not the direct-chat conversation's history
- **AND** no message originating from the direct-chat conversation SHALL appear in any LLM prompt or rendered reasoning chip for the team-chat turn

#### Scenario: Direct chat closure does not surface a Boss speaker label

- **WHEN** the user opens direct chat with any employee and sends a message that the employee answers
- **THEN** at no point during the turn (start, streaming, finalize) SHALL the chat rail render `Boss` as the streaming bubble's speaker label
- **AND** `boss_summary` SHALL NOT emit `graph.node.entered` for that turn

### Requirement: Chat events and store actions enforce run-level isolation

A chat turn is identified by `RunScope = { conversationKey: string; runId: string }` generated by `ChatPanel.handleSend` at user submit time and threaded through `sendMessage → orch.execute → graph config.configurable.runScope`. Run scope SHALL be per-execution and immutable; it SHALL NOT be stored on `RuntimeContext` or any other long-lived object.

The five chat-affecting event payload types — `LlmStreamChunkPayload`, `GraphNodeEnteredPayload`, `ToolExecutionTelemetryPayload`, `InteractionRequestedPayload`, `ExecutionAbortedPayload` — SHALL include optional `chatConversationKey` and `chatRunId` fields. Emit sites in chat-driven graph executions SHALL populate both fields by reading `config.configurable.runScope`; non-chat invocations (e.g. `background_sync`, `pm_heartbeat`) SHALL emit with the fields absent.

`useChatStreamingSync` listeners (chunk, node-entered, tool-execution-telemetry, interaction-requested, execution-aborted) SHALL forward the event to the store ONLY when both `event.payload.chatRunId === store.activeRun.runId` AND `event.payload.chatConversationKey === store.activeRun.conversationKey`. Events with absent run scope, mismatched scope, or arriving while `store.activeRun === null` SHALL be dropped silently in release builds (a dev-mode warning MAY surface unscoped chat-node events).

`chat-session-store` actions `appendStreamingChunkForActiveRun`, `commitSpeakerSegment`, `commitToolCallCheckpoint`, `terminateActiveRun`, `clearActiveRunStreamingContent`, and `finalizeActiveRun` SHALL each take `(conversationKey, runId, …)` parameters explicitly. Their reducers SHALL no-op when `state.activeRun` is null OR `state.activeRun.runId !== runId` OR `state.activeRun.conversationKey !== conversationKey`. The `state.activeRun` field SHALL remain a read-only signal indicating "the run currently observable in the UI"; it SHALL NOT be the write authority for any commit path.

`finalizeActiveRun(conversationKey, runId, finalContent?)` is invoked by the chat surface (not the runtime), and SHALL receive the run scope captured at `startRun` time so that an async `await sendMessage(...)` resolution arriving after a newer run has started becomes a no-op rather than committing into the wrong conversation.

This Requirement is the structural enforcement layer that the existing Requirement *"Streaming finalize commits exactly one assistant message per turn"* (this same spec) always presupposed.

#### Scenario: Direct chat does not show Boss reasoning chip

- **WHEN** the user is in direct chat with employee Jamie (`selectedEmployeeId` non-null) and sends "在忙吗"
- **THEN** the graph routes via `routeFromStart → employee_direct_setup` (no Boss LLM call)
- **AND** the StreamingBubble for that turn never displays a `Boss` speaker label or Boss reasoning region
- **AND** if a concurrent legitimate Boss invocation (e.g. `background_sync` on the same thread) is emitting `llm.stream.chunk` events, those events SHALL be dropped by the chat session store because their run scope (absent or mismatched) does not equal the current direct-chat scope

#### Scenario: Stream/node/finalize/abort isolate by conversationKey + runId

- **WHEN** a chat run is in flight under scope `S1 = { conversationKey: K1, runId: R1 }` and the user sends a second message that starts a new run under scope `S2 = { conversationKey: K1, runId: R2 }` before `S1`'s `await` resolves
- **THEN** `appendStreamingChunkForActiveRun(K1, R1, …)` invocations from `S1`'s in-flight chunks SHALL no-op (mismatch on `runId`)
- **AND** `finalizeActiveRun(K1, R1, response)` resolving from `S1`'s `await` SHALL no-op (mismatch on `runId`)
- **AND** `S2`'s chunks and finalize SHALL write normally into the chat session store under `K1`
- **AND** the chat rail under `K1` SHALL contain exactly one assistant message for `S2` and zero for `S1`

#### Scenario: Background sync Boss run does not pollute visible direct chat

- **WHEN** the user has direct chat with Maya open (active scope `K_direct + R_user`) and `useResumeOnReconnect` triggers a `background_sync` invocation that fires `boss` node entry and Boss reasoning chunks (no run scope on those events)
- **THEN** `useChatStreamingSync` SHALL drop the unscoped `graph.node.entered` and `llm.stream.chunk` events
- **AND** Maya's chat rail SHALL NOT render a Boss reasoning chip or Boss speaker label
- **AND** the `background_sync` invocation completes its work in graph state without surfacing any UI artifact in the chat rail

#### Scenario: Rapid double-send does not duplicate or misplace boss bubble

- **WHEN** the user sends a team-chat message that triggers Boss LLM streaming, and within 500 ms (before Boss finalize) sends a second team-chat message that also triggers Boss
- **THEN** the chat session store's chat rail under that conversationKey SHALL contain exactly two assistant messages (one per turn) at the end of both runs
- **AND** neither message SHALL contain content that originated from the other turn's Boss LLM call (no cross-pollination of reasoning or content text)
- **AND** the streaming bubble for the second turn SHALL replace the first turn's streaming bubble cleanly, without ever showing two Boss bubbles simultaneously

#### Scenario: Run scope does not survive checkpoint resume

- **WHEN** a chat run is interrupted, persisted to checkpoint, and later resumed via `resumePlan(threadId)` or auto-resume
- **THEN** the resumed execution SHALL receive a freshly generated `runScope`, NOT inherit the original run's scope
- **AND** chat-affecting events emitted during resume SHALL carry the new scope
- **AND** chat session store reducers SHALL treat the resume as a new run for finalize-commit purposes

#### Scenario: Non-chat events stay unaffected

- **WHEN** non-chat events such as `cost.session.updated`, `task.assignment.rerouted`, `vault.sync.failed`, `employee.state.changed`, `deliverable.persisted` fire during any run
- **THEN** their payloads SHALL NOT carry `chatConversationKey` / `chatRunId` fields
- **AND** the chat session store SHALL NOT receive them
- **AND** their consumers (Activity Rail, telemetry, scene orchestrator, etc.) SHALL continue to function exactly as before this change

