## Context

`chat-streaming-ux` already says a chat turn is identified by `conversationKey + runId` and that finalize commits exactly one assistant message per turn (`spec.md:172-198`). The implementation never actually carried that pair end-to-end:

- Chat-affecting events (`llm.stream.chunk`, `graph.node.entered`, `tool.execution.telemetry`, `interaction.requested`, `execution.aborted`) carry `threadId` on the envelope but no chat-side identity (`packages/shared-types/src/events/llm.ts:29`).
- `useChatStreamingSync` reads only `event.payload.nodeName` and `content`; it forwards every chunk into the global `activeRun` (`use-chat-streaming-sync.ts:53-66`).
- Six store actions (`appendStreamingChunkForActiveRun`, `commitSpeakerSegment`, `commitToolCallCheckpoint`, `terminateActiveRun`, `clearActiveRunStreamingContent`, `finalizeActiveRun`) all use the singleton `state.activeRun` as both read source AND write target (`chat-session-store.ts:283-470`).
- `finalizeActiveRun(content)` (not an event) takes only the final string — no `runId` parameter — so a stale async resolve commits into whatever conversation is currently active.

User evidence (2026-05-02 release `.app` live verify, catalog #19): direct chat with Jamie shows a `Boss → Reasoning` chip even though `routeFromStart` skips Boss for `entryMode === 'direct_chat'`. The Boss reasoning belonged to a different run/conversation that the global `activeRun` accepted unconditionally. `fix-doubled-boss-bubble` (status: not yet root-caused) likely sits on the same defence line.

Codex review (2026-05-03) added the load-bearing observation that the singleton problem covers more than chunks: `node.entered`, abort, and especially `finalizeActiveRun(response)` can each cross-write between runs. So the fix has to be run-level isolation, not chunk-level filtering.

## Goals / Non-Goals

**Goals:**
- Eliminate cross-run / cross-conversation pollution in the chat session store: a chat-affecting event or store action whose run scope does not match the current active run is dropped silently.
- Make the contract structural: every write path takes `(conversationKey, runId, …)` explicitly; `activeRun` is read-only state used only to identify "what UI is currently watching".
- Keep `chat-streaming-ux:172` (turn-singleton finalize) intact and supply the missing enforcement layer it always assumed.
- Cover the three pinned scenarios: direct chat skips Boss; stream/node/finalize/abort isolate by `conversationKey + runId`; legitimate `background_sync` / Boss runs cannot pollute a visible direct chat.
- Fold `fix-doubled-boss-bubble` in as an acceptance scenario without claiming same root cause.

**Non-Goals:**
- Routing-layer changes. `routeFromStart` already handles direct chat correctly; we don't touch it.
- Re-architecting `RuntimeContext`. It stays long-lived and stateless w.r.t. run scope.
- Persisting `runScope` into checkpoints / DB. It is per-execution only and dies with the run.
- Adding chat scope to non-chat events (`workspace-binding.unavailable`, `task.assignment.rerouted`, `cost.session.updated`, etc.). Only the five chat-affecting event types gain optional fields.
- Replacing `activeRun` entirely. It is still useful as the UI's "current view" signal — we just stop using it as the write authority.
- Turn-renumbering or making `runId` user-visible. Internal-only opaque identifier.
- Fixing #4(b) (Boss employee context emptiness). Different layer; tracked under `fix-workspace-binding-and-employee-context-mismatch`.

## Decisions

### Decision 1: Run scope is per-execution immutable, threaded through graph config

**Choice**: `RunScope = { conversationKey: string; runId: string }`. Created by `ChatPanel.handleSend` at the moment the user submits, threaded through `sendMessage(text, { runScope, ... })` → `orch.execute({ runScope, ... })` → `graph.stream(state, { configurable: { runScope, ... } })`. Nodes and emit sites read it from `config.configurable.runScope`.

**Alternative rejected**: storing "current run scope" on `RuntimeContext.currentRunScope`. Codex review explicitly flagged this. RuntimeContext is long-lived (one per company session, possibly serving multiple threads in the meeting subgraph). Holding a mutable "current run" on it re-introduces the same global-singleton class of bug we are killing in the chat store, just one layer up. A new run replaces the field while a prior async chunk is in flight; the chunk reads the new scope and lands in the wrong conversation.

**Alternative rejected**: stamping run scope into each `forwardStreamChunks(...)` call site by hand (passing as parameter). Works for chunks but each new emit site (`graphNodeEntered`, `interactionRequested`, `executionAborted`) has its own call path; threading scope through every parameter list is invasive. Going via `config.configurable` reuses LangGraph's existing mechanism for per-execution context.

**Why config**: LangGraph already isolates `config.configurable` per `graph.stream()` invocation. Two concurrent executions on different threads have different configs by construction. The graph nodes already accept `(state, config)` and we already extract `runtimeCtx` from there. Adding `runScope` is consistent with that pattern.

### Decision 2: Optional fields on five chat-affecting payloads, no widening of `RuntimeEvent` envelope

**Choice**: extend exactly five payload types with `chatConversationKey?: string; chatRunId?: string`:
- `LlmStreamChunkPayload`
- `GraphNodeEnteredPayload`
- `ToolExecutionTelemetryPayload`
- `InteractionRequestedPayload`
- `ExecutionAbortedPayload`

Other payloads stay untouched. The envelope's `threadId` field is unchanged.

**Alternative rejected**: putting `chatConversationKey + chatRunId` on the `RuntimeEvent` envelope itself. Polluting every event (deliverables, vault, employee state, MCP audit, billing) with chat-specific fields is wrong abstraction — most of those events have nothing to do with chat. Optional vs. required is a half-measure that tempts misuse.

**Alternative rejected**: a separate `chat.*` event family that wraps existing events. Doubles event volume on every chat run; consumers (Activity Rail, telemetry, harness recorders) would need to subscribe to both.

**Why optional**: non-chat invocations of these emit sites (e.g. `pm_heartbeat` triggering `graph.node.entered`, `background_sync` triggering Boss → `llm.stream.chunk`) legitimately have no run scope. They emit with the field absent. The UI listener treats absent-scope as "not a chat event" and drops it — which is the right behavior because the chat surface should never render `pm_heartbeat` activity anyway.

### Decision 3: Drop policy = strict equality on both fields

**Choice**: `useChatStreamingSync` listeners drop the event unless **both** `event.payload.chatRunId === activeRun.runId` **and** `event.payload.chatConversationKey === activeRun.conversationKey`. Events with absent scope are also dropped.

**Alternative rejected**: drop only on `chatRunId` mismatch. Tempting because runId is unique and conversationKey is derivable. Rejected because: (a) defence-in-depth against runId collision (UUID is unique but mistakes happen); (b) absent-conversationKey events should not render in any chat rail and bare runId match doesn't tell us where they belong.

**Alternative rejected**: queue mismatched events for a future activeRun match. Accumulates unbounded memory if the user navigates away mid-run. Drop is simpler and the symptom (a missing reasoning chunk for a backgrounded run that the user can't see anyway) is invisible.

### Decision 4: Store actions take explicit `(conversationKey, runId)` and no-op on mismatch

**Choice**: change six action signatures:
- `appendStreamingChunkForActiveRun(conversationKey, runId, nodeName, content, channel)`
- `commitSpeakerSegment(conversationKey, runId, options?)`
- `commitToolCallCheckpoint(conversationKey, runId)`
- `terminateActiveRun(conversationKey, runId, options)`
- `clearActiveRunStreamingContent(conversationKey, runId)`
- `finalizeActiveRun(conversationKey, runId, finalContent?)`

Reducers: if `state.activeRun` is null OR `state.activeRun.runId !== runId` OR `state.activeRun.conversationKey !== conversationKey`, return state unchanged.

**Alternative rejected**: keep existing signatures but read scope from a thunk-style closure captured at `startRun`. Hides the validation, harder to reason about; tests have to spy on closures rather than action arguments.

**Why explicit**: the structural-enforcement criterion in `chat-streaming-ux:182` says "share a single `finalizeAssistantMessage(conversationKey, runId, payload)` entry so the dedupe is enforced structurally, not by post-write cleanup." Making every action take the same pair makes that enforcement uniform, not just in finalize.

### Decision 5: ChatPanel owns run scope, captures at `startRun` and threads to finalize

**Choice**: `ChatPanel.handleSend` generates the scope before any side effects:
```ts
const runId = genRunId();
const conversationKey = runConversationKey;  // already computed
const runScope = { conversationKey, runId };
startRun(runScope);
const response = await sendMessage(text, { ..., runScope });
finalizeActiveRun(runScope.conversationKey, runScope.runId, response);
```

If the user navigates away or sends another message during `await`, a new `startRun` replaces `state.activeRun`. The `await` resolves with the old scope, and `finalizeActiveRun(oldScope, response)` finds the activeRun's runId no longer matches → no-op. The new run's own finalize will write its own message normally.

`handleInteractionRespond` follows the same pattern.

**Alternative rejected**: deriving runId inside `chat-session-store.startRun` and returning it. Adds a return-value coupling to a previously fire-and-forget action. Generating it in ChatPanel keeps actions return-typed-void.

### Decision 6: `fix-doubled-boss-bubble` collapses into acceptance scenarios, not predicate

**Choice**: spec scenarios cover boss-bubble duplication / misplacement; the proposal explicitly does **not** claim same root cause. If the live verify after Task 0 shows a different root cause (e.g. duplicate `commitSpeakerSegment` triggered without intervening node change), open a follow-up change. Otherwise close `fix-doubled-boss-bubble` against this change's evidence.

**Why**: Codex review specifically warned against pre-binding the two. Live evidence is cheap (15-20 min) and the spec wording stays accurate either way.

### Decision 7: Task 0 = bounded live-log verification, hard time-cap

**Choice**: 15-20 minute window in release `.app` with temporary console logs at `useChatStreamingSync` entry, dumping `event.threadId / event.payload.nodeName / event.payload.chatConversationKey?(if extended) / event.payload.chatRunId?(if extended) / activeRun.conversationKey / activeRun.runId`. If reproduction lands, capture transcript and merge into design as appendix. If not, proceed on static root cause — implementation of Decisions 1-5 is justified by code reading alone.

**Why**: Codex review accepted "even 15-20 minutes without repro is enough; the static root cause is sufficient." Avoids the open-ended-debugging trap. Live evidence quality of `fix-doubled-boss-bubble` collapse decision is the only thing the window is gating.

## Risks / Trade-offs

- **Risk**: payload schema is observed by harness scenarios that snapshot or assert on event sequences. → **Mitigation**: optional fields are backwards compatible at the type level; a harness scenario that ignored them keeps passing. If a scenario asserts on full payload deep equality, update its fixture in the same change. No new harness invariants required for this change.
- **Risk**: an emit site is missed during refactor — non-chat-scoped chunk gets dropped silently and nobody notices for a release cycle. → **Mitigation**: enable a dev-mode warning in `useChatStreamingSync` when an event in `VISIBLE_STREAMING_NODES` arrives without a `chatRunId` and `activeRun` is non-null. Dev-only; release builds stay silent.
- **Risk**: `meeting_*` subgraph runs and emits chat-affecting events under entryMode `meeting`; meeting UI may rely on these landing in the chat rail. → **Mitigation**: meeting flow uses its own conversationKey path through the meeting subgraph; if the meeting send goes through the same `sendMessage(...)` entry, it gets a runScope just like chat. If meeting bypasses `sendMessage` entirely (it does — see `OrchestrationService.resumeMeeting`), the meeting bubble already lives outside the chat session store, so absent scope is correct.
- **Trade-off**: store action signatures become wordier (six actions gain two parameters each). Code-reading cost vs. structural correctness — cost accepted because the alternative is invisible cross-pollution.
- **Trade-off**: `runScope` lives in graph `config.configurable` not state. It does **not** survive checkpoint resume — a `resumePlan` invocation will read state but not config. That's by design: a resumed run is a new run from the chat surface's perspective, with a fresh scope generated at resume time. Chat-rail messages from the original run are already committed; the resume's events should land on the resume's scope.
- **Trade-off**: harness FakeGateway scenarios that emit chunks must thread scope through if they assert on chat-rail commits. Most harness scenarios assert on graph state / final messages, not chat session store, so impact is bounded.

## Migration Plan

Single-baseline pre-launch repo: no DB migration. No persistence change. The change is type-additive at the event boundary and behaviour-replacing at the store reducer boundary.

Order of work (matches Decisions 1-5):
1. **Task 0**: live verification window in release `.app`. Output: `verify-record.md` in change dir with transcript or "no repro within 20 min, proceeding on static root cause".
2. Extend payload types (shared-types). No consumers touched yet — backwards compatible.
3. Add `runScope` to graph state config plumbing (orch service + main-graph + nodes' withNodeHooks). Emit sites start setting fields. Consumers ignore fields still.
4. Update `useChatStreamingSync` and `chat-session-store` actions in lockstep. Once ChatPanel passes scope to all entry points, the system is run-isolated.
5. Update harness fixtures if any assert on chat session store contents.
6. Run live verification scenarios from spec (3 scenarios + `fix-doubled-boss-bubble` candidate).

Rollback: revert the change (single change, single direction). No data shape changes to undo.

## Open Questions

- **Q1**: Should `useResumeOnReconnect` / `useUnfinishedThreadDetection` paths produce a `runScope` for their auto-resume `background_sync` invocation? **Tentative**: no — those runs are not user-initiated chat turns and the chat rail should not show them. If product later wants visibility, add scope at that point.
- **Q2**: Does `pm_heartbeat` ever need to surface to chat rail? **Tentative**: no, it never has and the change preserves that. Heartbeat events drop silently in the listener.
- **Q3**: Should `fix-doubled-boss-bubble` get its own scenario in this spec or inherit coverage from the three pinned scenarios? **Tentative**: add a fourth scenario "rapid double-send does not duplicate or misplace boss bubble" — distinct enough to fail-fast on regression even if root cause is shared.

## Appendix A: live verify transcript (2026-05-03, release `.app`)

Codex picked up the change after the static implementation landed and reproduced catalog #19 in the freshly built release `.app`. Two real bugs surfaced — neither matched the original "async run scope leaks into the wrong conversation" predicate. Both are fixed in this same change rather than spun out as follow-ups, because the spec's pinned scenarios (direct chat skips Boss reasoning chip; rapid double-send does not cross-pollinate) only pass once both are addressed.

### Finding 1 — Maya direct chat "在忙吗" still showed `Boss → REASONING`

**Root cause** (different from Decision 1's predicate): `routeFromStart` correctly routes direct chat to `employee_direct_setup` and skips Boss. After the employee turn finishes, the graph still flows into `bossSummaryNode` for closure. That node emits `graph.node.entered { nodeName: 'boss_summary' }`, and `boss_summary` is in `VISIBLE_STREAMING_NODES`, so the chat rail renders a Boss reasoning chip even though no Boss LLM call ever fired. The bubble never reads "Boss" content because no `llm.stream.chunk` carries it; only the speaker label flips for one frame.

**Fix**: `bossSummaryNode` skips the `graph.node.entered` emit when `state.entryMode === 'direct_chat' && state.targetEmployeeId`. Direct chat closure remains internal; the chat rail never learns about it. The streaming LLM path inside `boss_summary` is unreached on this branch (direct chat takes the early-return path before the multi-employee summary block), so chunk-level scoping is not affected.

**New harness invariant**: `direct-chat-hides-boss-summary-node` (asserts `graph.node.entered { nodeName: 'boss_summary' }` count = 0 on the direct-chat fixture, plus `firstGraphNodeIs employee_direct_setup` and `threadStatusIs completed`). Added to `packages/core/harness/scenarios/manifest.json` under category `chat-streaming-ux`.

### Finding 2 — Team chat "hi" picked up Maya's prior "在忙吗" as Boss context

**Root cause**: LangGraph keys checkpoint state by `config.configurable.thread_id`. Team chat and any individual direct chat under the same `activeProject` were sharing the project's `thread_id`. Each direct chat conversation had its own `conversationKey` in the chat-session-store, but the runtime's message history (assembled by Boss / employee from the LangGraph checkpoint) was thread-wide, so a fresh team-chat turn read the previous direct-chat user message as part of its "recent messages".

**Fix**: `ChatPanel.handleSend` now picks `runThreadId = selectedEmployeeId ? runConversationKey : (activeThreadId ?? undefined)`. In direct chat the LangGraph thread becomes the scoped conversation key (`<projectThread>::<employeeId>`); team chat keeps the project thread. `OrchestrationService._executeInner` calls `ensureExecutionThread(threadId, entryMode)` to create the `graph_threads` row on first use, avoiding FK failures when the scoped thread is new. `handleSwapPerson` follows the same pattern.

This is structurally consistent with `getConversationKey({ threadId, targetEmployeeId })` — the chat-session-store already keyed conversations this way; the runtime just was not honoring the same partitioning at the graph layer.

### Decision on `fix-doubled-boss-bubble` collapse

Codex did not reproduce the rapid-double-send pattern after the two fixes above. The scenario stays as an acceptance criterion in this spec rather than a separate change. If a future repro shows a third independent root cause, open a follow-up.

### Verification status snapshot

- ✅ Static gates: `pnpm --filter @offisim/core build`, `pnpm --filter @offisim/ui-office build`, `pnpm --filter @offisim/desktop build`, `node scripts/harness-contract.mjs` (47 scenarios incl. `direct-chat-hides-boss-summary-node`).
- ✅ Release `.app` repacked from this branch.
- ✅ Phase 8 release-app live verify completed for 8.3 / 8.4 / 8.5 / 8.6; screenshots and index are in `.live-verify/fix-chat-run-isolation/`.
- ✅ Phase 8.5 network-blip scenario passed after user-approved Wi-Fi toggling (`en0` off/on); Maya direct chat remained free of Boss/background_sync pollution.
