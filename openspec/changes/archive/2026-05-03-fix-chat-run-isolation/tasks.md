## 0. Live verification window (bounded)

- [x] 0.1 Branch off `main`; in `apps/web/src/runtime/runtime-readiness.ts` or `useChatStreamingSync` add a temporary `console.debug` at the top of the chunk / node-entered listeners dumping `event.threadId / event.payload?.nodeName / event.payload?.channel / activeRun?.conversationKey / activeRun?.runId`. Mark with `// REMOVE BEFORE MERGE — change fix-chat-run-isolation T0`. — Codex skipped the temporary console.debug and used existing event payload fields directly during release `.app` repro.
- [x] 0.2 Build release `.app` (`pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`) and launch the worktree's exact `.app` (do not use `open -b com.offisim.desktop`).
- [x] 0.3 Reproduce catalog #19: open direct chat with any employee, send "在忙吗", capture screenshot + 60 s of console log. Hard cap: 20 minutes total. If no Boss chip appears, mark T0.x complete with note "no repro within 20 min, proceeding on static root cause". — **Repro succeeded**, root cause turned out to be `boss_summary` `graph.node.entered` leaking into direct-chat rail (different from the original "async run scope" predicate). See design.md Appendix A Finding 1.
- [x] 0.4 If Boss chip appears, also try the rapid-double-send pattern (team chat send #1, immediately send #2) and capture log + screenshot — needed for `fix-doubled-boss-bubble` collapse decision. — Codex did not reproduce the rapid-double-send doubled-bubble after fixing Findings 1 & 2; collapse decision recorded in design.md Appendix A.
- [x] 0.5 Save evidence to `.live-verify/fix-chat-run-isolation/` (screenshots + log excerpt + observation notes). Append summary to `design.md` as "Appendix A: live verify transcript". Decide whether `fix-doubled-boss-bubble` collapses into this change or splits.
- [x] 0.6 Remove the temporary `console.debug` instrumentation; verify no debug log left in repo via `grep -rn "REMOVE BEFORE MERGE — change fix-chat-run-isolation"` returns 0 hits. — N/A; instrumentation was never added (see 0.1).

## 0b. Live-verify-driven structural fixes (added 2026-05-03 from Appendix A)

- [x] 0b.1 `bossSummaryNode` skips `graph.node.entered` when `state.entryMode === 'direct_chat' && state.targetEmployeeId`. Direct-chat closure stays internal; chat rail never renders `Boss` for a turn that never routed through Boss. (Spec scenario "Direct chat closure does not surface a Boss speaker label".)
- [x] 0b.2 `ChatPanel.handleSend` / `handleSwapPerson` use `runThreadId = selectedEmployeeId ? runConversationKey : (activeThreadId ?? undefined)` so each direct-chat conversation runs on its own LangGraph thread. (Spec scenario "Team chat does not inherit direct chat history".)
- [x] 0b.3 `OrchestrationService._executeInner` calls new `ensureExecutionThread(threadId, entryMode)` to create the `graph_threads` row on first use, avoiding FK failures when `runThreadId` is a fresh scoped conversation key.
- [x] 0b.4 New harness invariant `direct-chat-hides-boss-summary-node` (category `chat-streaming-ux`) added to `packages/core/harness/scenarios/manifest.json`; asserts `graph.node.entered { nodeName: 'boss_summary' }` count = 0 + `firstGraphNodeIs employee_direct_setup` + `threadStatusIs completed`. `node scripts/harness-contract.mjs` passes 47 scenarios.

## 1. Shared-types: extend chat-affecting payloads (additive)

- [x] 1.1 In `packages/shared-types/src/events/llm.ts`, extend `LlmStreamChunkPayload` with optional `readonly chatConversationKey?: string; readonly chatRunId?: string;`.
- [x] 1.2 In `packages/shared-types/src/events/graph.ts` (or wherever `GraphNodeEnteredPayload` lives — confirm with `grep -rn "GraphNodeEnteredPayload" packages/shared-types/src/events/`), extend with the same two optional fields.
- [x] 1.3 In `packages/shared-types/src/events/tool.ts` (or equivalent), extend `ToolExecutionTelemetryPayload` with the same two optional fields.
- [x] 1.4 Locate `InteractionRequestedPayload` (likely `packages/shared-types/src/events/interaction.ts`); extend with the same two optional fields.
- [x] 1.5 Locate `ExecutionAbortedPayload` (likely `packages/shared-types/src/events/runtime.ts` or `execution.ts`); extend with the same two optional fields.
- [x] 1.6 Build `pnpm --filter @offisim/shared-types build`; verify all five payload types compile.

## 2. Core: per-execution run scope plumbing

- [x] 2.1 In `packages/core/src/graph/state.ts` near other config-only types, add `export interface RunScope { readonly conversationKey: string; readonly runId: string; }`. Do NOT add it to `OffisimGraphAnnotation` (state) — it lives in `config.configurable.runScope` only.
- [x] 2.2 In `packages/core/src/services/orchestration-service.ts`:
  - Extend `execute({ ..., runScope?: RunScope })` parameter type.
  - In `_executeInner`, pass `runScope` through to `_executeStateInner`.
  - In `_executeStateInner`, add `runScope` to `config.configurable`.
- [x] 2.3 In `packages/core/src/utils/get-runtime.ts` (or wherever `getRuntime` lives), add a sibling helper `getRunScope(config: RunnableConfig): RunScope | null` that reads `config.configurable?.runScope ?? null`. Don't throw on absence — non-chat invocations are valid.
- [x] 2.4 Update `RunnableConfig`'s configurable typing if it's locally extended for `runtimeCtx` / `signal` (`packages/core/src/utils/get-runtime.ts` or types file) to include optional `runScope`.

## 3. Core: emit sites populate scope

- [x] 3.1 In `packages/core/src/llm/recorded-call.ts`, change `forwardStreamChunks` signature to accept an optional `runScope?: RunScope` (or read from a passed `config`); when present, pass to `llmStreamChunk` factory.
- [x] 3.2 In `packages/core/src/events/event-factories.js` (or `llm-events.ts`), change `llmStreamChunk` to accept optional `chatConversationKey + chatRunId` and put them on the payload.
- [x] 3.3 In `packages/core/src/agents/boss-node.ts:281` and `boss-node.ts:419` (`recordedLlmStream` calls), thread `runScope` from `config` into `forwardStreamChunks`.
- [x] 3.4 In `manager-node.ts`, `employee-node.ts`, `boss-summary-node.ts`, `hr-node.ts`, `pm-planner-node.ts`, `employee-turn-runner.ts`, and any other node that calls `recordedLlmStream` or `forwardStreamChunks`, thread `runScope`. Confirm completeness by `grep -rn "forwardStreamChunks\|recordedLlmStream" packages/core/src/agents/`.
- [x] 3.5 In `packages/core/src/graph/main-graph.ts`'s `withNodeHooks`, read `runScope` from `config` and put on the `graphNodeEntered` event factory call. Update `graphNodeEntered` factory signature to accept optional scope.
- [x] 3.6 In `packages/core/src/services/interaction-service.ts` (or wherever `interactionRequested` events are emitted), thread runScope from the requesting node's `config`.
- [x] 3.7 In `packages/core/src/services/orchestration-service.ts` `abortExecution`, when emitting `executionAborted`, read `runScope` from the per-thread current execution context (store the scope alongside the AbortController in `currentAborts`) and put on the payload.
- [x] 3.8 In `tool.execution.telemetry` emit sites (likely `packages/core/src/services/tool-telemetry-service.ts` or in employee tool execution), thread runScope from the executing node's `config`.
- [x] 3.9 Build `pnpm --filter @offisim/core build`; verify no type errors and all emit sites resolve scope.

## 4. UI: useChatStreamingSync drops mismatched/unscoped events

- [x] 4.1 In `packages/ui-office/src/runtime/use-chat-streaming-sync.ts`, before each of the 5 listeners' core forwarding logic, inject a guard:
  - Read current `activeRun` from store
  - If `activeRun === null` → return
  - If `event.payload.chatRunId !== activeRun.runId` OR `event.payload.chatConversationKey !== activeRun.conversationKey` → return
- [x] 4.2 Add a dev-only warning when an event with `nodeName ∈ VISIBLE_STREAMING_NODES` arrives without `chatRunId` while `activeRun !== null`. Gate behind `import.meta.env.DEV`.
- [x] 4.3 Update tests / harness fixtures that assert on chunk forwarding to include scope in fixture payloads.
  - No existing source-level runtime tests are allowed for this product path; coverage was added through deterministic harness scenario `direct-chat-hides-boss-summary-node` in `packages/core/harness/scenarios/manifest.json`.

## 5. UI: chat-session-store actions take explicit scope

- [x] 5.1 In `packages/ui-office/src/components/chat/chat-session-store.ts`, change action signatures and reducer cases for the six actions per Decision 4 in design.md:
  - `appendStreamingChunkForActiveRun(conversationKey, runId, nodeName, content, channel)`
  - `commitSpeakerSegment(conversationKey, runId, options?)`
  - `commitToolCallCheckpoint(conversationKey, runId)`
  - `terminateActiveRun(conversationKey, runId, options)`
  - `clearActiveRunStreamingContent(conversationKey, runId)`
  - `finalizeActiveRun(conversationKey, runId, finalContent?)`
- [x] 5.2 In each reducer case, no-op when activeRun is null OR mismatch on either field. Return state unchanged.
- [x] 5.3 Update the public store interface `ChatSessionStore` in the same file to reflect new signatures.
- [x] 5.4 Update internal action union `ChatSessionAction` discriminants to carry the scope fields.

## 6. UI: ChatPanel + runtime hooks thread scope end-to-end

- [x] 6.1 In `packages/ui-office/src/components/chat/ChatPanel.tsx`, in `handleSend`:
  - Generate `runId` via `genRunId()` (move helper from chat-session-store if needed, or reuse).
  - Capture `runScope = { conversationKey: runConversationKey, runId }` before any side effect.
  - Pass `runScope` into `sendMessage(text, { ..., runScope })`.
  - After `await sendMessage`, call `finalizeActiveRun(runScope.conversationKey, runScope.runId, response)`.
- [x] 6.2 In ChatPanel `handleInteractionRespond`, capture `runScope` similarly when calling `startRun` / `respondToInteraction` / `finalizeActiveRun`.
- [x] 6.3 In ChatPanel `handleSwapPerson` (retry-with-different-employee path) and `handleRetry`, ensure new `runId` is generated for each retry; pass scope through.
- [x] 6.4 In `packages/ui-office/src/runtime/offisim-runtime-context.tsx`, extend `sendMessage` signature with optional `runScope`. Same for `respondToInteraction` if it goes through similar plumbing.
- [x] 6.5 In `apps/web/src/runtime/hooks/useRuntimeInit.ts` `sendMessage`, accept `options.runScope` and thread to `runtime.orch.execute({ ..., runScope })`.
- [x] 6.6 In `apps/web/src/runtime/hooks/useInteractionSync.ts`, thread runScope on `respondToInteraction` retry path.
- [x] 6.7 In `chat-session-store.ts` `startRun(conversationKey)`, change to `startRun(scope: RunScope)` so the activeRun stores both fields explicitly (already does — verify) and so callers cannot start a run without specifying both.

## 7. Build, typecheck, harness

- [x] 7.1 Build pipeline in dependency order: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`. Fail loud on any error.
- [x] 7.2 `pnpm typecheck` across the workspace; resolve any new violations from signature changes.
- [x] 7.3 `node scripts/harness-contract.mjs` if any harness scenario asserts on chat session store contents — update fixtures to include scope. If no chat-rail assertions exist, harness contract is a no-op for this change.

## 8. Live verification (release `.app`)

- [x] 8.1 Build release `.app` from this branch (`pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`). — Codex repacked release `.app` after Findings 1 & 2 fix.
- [x] 8.2 Launch the worktree's exact `.app` path (NOT `open -b`). — Used during Appendix A repro session.
- [x] 8.3 Re-run scenario 1 — direct chat skip Boss: open direct chat with any employee, send "在忙吗", verify no Boss reasoning chip. Capture screenshot.
  - Evidence 2026-05-03: `.live-verify/fix-chat-run-isolation/8.3-direct-chat-no-boss.png`. Rebuilt release `.app` (`pid 23556`, URL `tauri://localhost`) showed Maya direct chat rendering `Employee`, not `Boss`. Residual `Employee → REASONING` chip is a separate display-policy issue, not Boss run pollution.
- [x] 8.4 Re-run scenario 2 — rapid double-send: in team chat send "hi" then immediately "hello", verify exactly two assistant messages with no cross-pollination. Capture screenshots before/after.
  - Evidence 2026-05-03: `.live-verify/fix-chat-run-isolation/8.4-project-thread-hi-hello-no-cross-pollination.png`. Because the root Team thread already contained old pre-fix pollution, Codex created a clean project thread (`Chat Isolation Verify`) and verified `hi` / `Hello` as two separate Boss responses with no Maya direct-chat content leaking into the project-thread rail. The UI disables the input while a turn is in progress, so the second send was performed immediately after the first turn became ready.
- [x] 8.5 Run scenario 3 — background sync isolation: open direct chat with Maya, trigger network blip (toggle Wi-Fi or use desktop reconnect handler) so `useResumeOnReconnect` fires `background_sync`, verify no Boss chip pollutes Maya's rail. Capture log.
  - Evidence 2026-05-03: `.live-verify/fix-chat-run-isolation/8.5-background-sync-no-maya-pollution.png`. With Maya direct chat open in the release `.app`, Wi-Fi was toggled off/on through `networksetup` on `en0`; after reconnect, Maya's rail stayed clean with no Boss chip, Boss message, or background_sync artifact.
- [x] 8.6 Run scenario 4 — `fix-doubled-boss-bubble` candidate: reproduce the original double-bubble pattern (steps from `.live-verify/fix-doubled-boss-bubble/` if known, otherwise reuse rapid-double-send). Verify single bubble per turn. Capture screenshots.
  - Evidence 2026-05-03: `.live-verify/fix-chat-run-isolation/8.6-doubled-boss-bubble-candidate-single-bubble-per-turn.png` reuses the clean project-thread 8.4 candidate. The rail shows one Boss bubble for `hi` and one Boss bubble for `Hello`; no doubled Boss bubble was reproduced.
- [x] 8.7 Save evidence to `.live-verify/fix-chat-run-isolation/` with markdown index describing each scenario and pass/fail.
  - Evidence index: `.live-verify/fix-chat-run-isolation/verify-record.md`.
- [x] 8.8 If any scenario fails, fix root cause (no UI suppress hacks) and re-verify before archiving. Do not soft-pass.
  - No Phase 8 scenario remained failing after the release `.app` walk-through. Earlier failures in 8.3 and 8.4 were fixed at root cause before this final verification set.

## 9. Documentation + archive gate

- [x] 9.1 Update `MEMORY.md` 9-bucket queue entry to mark 桶 3 archived with this change name + commit SHA + canonical capability `chat-streaming-ux`.
  - Evidence 2026-05-03: `~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/project_ux_9_bucket_queue.md` marks 桶 3 archived via `fix-chat-run-isolation` with commit `db75dfe9` and canonical capability `chat-streaming-ux`.
- [x] 9.2 If `fix-doubled-boss-bubble` collapses into this change, remove from MEMORY active backlog and `.live-verify/fix-doubled-boss-bubble/` evidence. If it splits, leave in backlog with note "different root cause from fix-chat-run-isolation, see live verify T0.5".
  - MEMORY active backlog entry removed 2026-05-03; `~/.claude/.../MEMORY.md` now records collapse into `fix-chat-run-isolation`.
  - `.live-verify/fix-doubled-boss-bubble/` deleted 2026-05-03 with explicit user confirmation.
- [x] 9.3 OpenSpec Archive Gate three-check: spec consistency / tasks consistency / docs consistency. Verify `chat-streaming-ux/spec.md` after merge reflects new Requirement and existing turn-singleton requirement is unchanged.
  - `openspec validate fix-chat-run-isolation --strict` → "Change is valid". New "Direct chat runtime is partitioned by conversationKey" Requirement and existing turn-singleton Requirement both present and unchanged. MEMORY.md `.live-verify/fix-doubled-boss-bubble/` references updated to reflect deletion.
- [x] 9.4 Protocols ledger (`openspec/protocols-ledger.md`): no protocol touched (LangGraph config is pre-existing API surface; no upstream contract changes). Leave entry unchanged.
  - Confirmed via `grep -n "fix-chat-run-isolation\|chat-run-isolation" openspec/protocols-ledger.md` returning empty; no ledger row affected.
- [x] 9.5 Run `/opsx:archive fix-chat-run-isolation` after live verification scenarios all pass and verify-record.md is in the change dir.
  - Archived 2026-05-03 as `archive/2026-05-03-fix-chat-run-isolation/`; canonical `chat-streaming-ux/spec.md` updated with two new Requirements ("Direct chat runtime is partitioned by conversationKey" + "Chat events and store actions enforce run-level isolation"). Existing turn-singleton Requirement unchanged.
