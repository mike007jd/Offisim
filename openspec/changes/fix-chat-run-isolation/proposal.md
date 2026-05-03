## Why

`openspec/specs/chat-streaming-ux/spec.md:172-198` already defines a chat turn as `conversationKey + runId` and mandates a single converged finalize. The implementation never matched: chunk/node/finalize events carry no chat scope, the chat session store reads/writes off a single global `activeRun`, and `finalizeActiveRun(content)` has no `runId` check. Result on the user's 2026-05-02 release `.app` live verify (catalog #19): in `← Team / Jamie Reeves` direct chat the user sends "在忙吗" and a `Boss → Reasoning` chip appears before Jamie's reply — even though `routeFromStart` already routes direct chat to `employee_direct_setup` and never invokes Boss for that turn. The reasoning belongs to a different run/conversation that the global `activeRun` happily accepted. Same defence layer also covers `fix-doubled-boss-bubble` (status: not yet root-caused; folded in as verification scenario).

## What Changes

- **Add per-execution immutable run scope.** `ChatPanel` generates a `RunScope { conversationKey, runId }` for each user send and threads it through `sendMessage → orch.execute → graph config.configurable.runScope`. Run scope is **not** stored on `RuntimeContext` (long-lived; concurrent runs would collide).
- **Add optional `chatConversationKey` + `chatRunId` to chat-affecting event payloads only:** `llm.stream.chunk`, `graph.node.entered`, `tool.execution.telemetry`, `interaction.requested`, `execution.aborted`. Other runtime events stay unchanged.
- **`emit` sites read run scope from graph config**, not from `RuntimeContext`. `recordedLlmStream` / `forwardStreamChunks` / `bossNode` / `managerNode` / `employeeNode` / `withNodeHooks` / abort path all read `config.configurable.runScope` and put it into the payload (omit when absent — non-chat invocations like `background_sync` legitimately have no scope).
- **`useChatStreamingSync` validates scope before forwarding.** The 5 listeners drop events whose `chatRunId` does not match the store's `activeRun.runId` (or whose `chatConversationKey` does not match `activeRun.conversationKey`). Events without scope (legacy / non-chat) are also dropped — chat UI only consumes scoped events.
- **`chat-session-store` actions become run-scoped writes.** `appendStreamingChunkForActiveRun`, `commitSpeakerSegment`, `commitToolCallCheckpoint`, `terminateActiveRun`, `finalizeActiveRun`, `clearActiveRunStreamingContent` all take `(conversationKey, runId, …)`. Mismatch with current `activeRun` → no-op. `activeRun` is read-only state for "what UI is currently watching"; it is never the write authority.
- **`finalizeActiveRun` (not an event) must take the same scope.** `ChatPanel.handleSend` captures the scope at `startRun` time and passes it to `finalizeActiveRun(scope, response)`; old async resolves of stale runs become no-ops instead of writing into the wrong conversation.
- **Spec delta lands on existing `chat-streaming-ux`.** Add one new Requirement "Chat events and store actions enforce run-level isolation" with the three scenarios codex pinned (direct chat skips Boss; stream/node/finalize/abort isolate by `conversationKey + runId`; legitimate `background_sync` / Boss runs cannot pollute a visible direct chat). The existing turn-singleton Requirement (`chat-streaming-ux:172`) stays as-is — this change supplies the structural enforcement it always assumed.
- **`fix-doubled-boss-bubble` lives as an acceptance scenario.** Wording: "covers boss-bubble duplication / misplacement run-isolation; if live evidence shows a different root cause, split into a follow-up change." No same-root-cause claim is made up front.
- **Task 0 = release `.app` temporary log.** Inject a 15–20 minute window of console logs (`event.threadId / event.payload.nodeName / event.payload.chatConversationKey / event.payload.chatRunId / activeRun.conversationKey / activeRun.runId`) to capture pollution before/after. If we don't reproduce within the window, proceed on static root cause; outcome of `fix-doubled-boss-bubble` collapse vs. split is decided after this evidence.

## Capabilities

### New Capabilities

(none — this change is structural enforcement of an existing capability)

### Modified Capabilities

- `chat-streaming-ux`: add Requirement "Chat events and store actions enforce run-level isolation" + 3 scenarios. Existing requirements (incl. turn-singleton finalize) unchanged.

## Impact

- **shared-types**: extend `LlmStreamChunkPayload`, `GraphNodeEnteredPayload`, `ToolExecutionTelemetryPayload`, `InteractionRequestedPayload`, `ExecutionAbortedPayload` with optional `chatConversationKey` + `chatRunId`. Backwards-compatible at the type level (optional). Consumers that don't care for chat scope ignore the fields.
- **core/graph**: `OffisimGraphState.runScope?: RunScope` (per-execution, not persisted in checkpoint — set fresh on every `orch.execute`). `withNodeHooks` reads it and forwards into `graphNodeEntered`. `routeFromStart` unchanged.
- **core/services/orchestration-service**: `execute({ runScope?, ... })` accepts and threads it into `config.configurable.runScope`. Background paths (`background_sync`, `pm_heartbeat`, `meeting_*`) pass `undefined` — chat UI drops these unscoped events as expected.
- **core/llm/recorded-call**: `forwardStreamChunks` / `recordedLlmStream` read `config.configurable.runScope` (or take it as a param) and put it on each `llmStreamChunk` payload.
- **core/agents**: `bossNode`, `managerNode`, `employeeNode`, `bossSummaryNode`, `hrNode`, `pmPlannerNode` (all that emit `graph.node.entered` via `withNodeHooks` or stream chunks) inherit scope automatically through `withNodeHooks` + `forwardStreamChunks`.
- **core/services/interaction-service**: `interaction.requested` emit takes scope from config.
- **ui-office/runtime/use-chat-streaming-sync**: 5 listeners gain run-scope guard. Drop semantics: events without `chatRunId`, or with mismatched `chatRunId`, are dropped silently.
- **ui-office/components/chat/chat-session-store**: 6 actions change signature to take `{ conversationKey, runId }`; `activeRun` becomes read-only signal. Reducers no-op on mismatch.
- **ui-office/components/chat/ChatPanel**: `handleSend` captures scope, threads through `sendMessage` and `finalizeActiveRun`. `handleInteractionRespond` follows the same pattern.
- **apps/web/src/runtime/hooks/useRuntimeInit**: `sendMessage` signature gains `runScope?`; threads through to `orch.execute`.
- **harness**: existing deterministic harness scenarios may need scope fixtures if they assert on chat-bubble events; if assertions only target graph state / final messages, no change needed.
- **No DB / schema impact.** No persistence change. `runScope` lives in graph config only.
- **No migration**: per repo convention pre-launch (`db-local/schema.sql` single baseline only).
