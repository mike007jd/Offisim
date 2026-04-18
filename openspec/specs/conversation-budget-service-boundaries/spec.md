# conversation-budget-service-boundaries

## Purpose

`packages/core/src/services/conversation-budget-service.ts` is the runtime budget gate between a client `LlmRequest` and the downstream LLM call — it prunes the message tail by `compactBaseline`, decides when to refresh a thread synopsis, orchestrates initial-full-compact + refresh-full-compact with circuit breakers, persists synopsis / compact baselines, and emits `conversation.synopsis.updated` / `conversation.compact.completed` events. Pre-refactor (Round 2, 2026-04-18) it was a single 660-NBNC class that inlined resolve-options + load-thread + compact-tool-results + slice + synopsis-generation (LLM + heuristic fallback + DB write + event) + initial-full-compact (LLM + DB write + event + circuit breaker) + refresh-full-compact (LLM + DB write + event + circuit breaker) + final assemble + prune. This spec nails down the post-refactor decomposition so future budget-policy edits touch one sibling module, not the 660-line monolith.

## Requirements

### Requirement: ConversationBudgetService barrel is thin

`packages/core/src/services/conversation-budget-service.ts` SHALL contain no more than 180 non-blank, non-comment lines. The `ConversationBudgetService` class SHALL retain its public API (`prepareRequest(ctx, request)` as the only public async method, constructor signature `(defaults?: ConversationBudgetServiceOptions)`) and SHALL continue to export `ConversationBudgetServiceOptions` and `ThreadSynopsisRecord` from the same path. The barrel SHALL NOT contain inline LLM call invocations, inline `ctx.repos.*` writes, inline `ctx.eventBus.emit` calls, inline `SYNOPSIS_SYSTEM_PROMPT` / `FULL_COMPACT_SYSTEM_PROMPT` string literals, inline heuristic summary construction, or inline full-compact skip-row construction.

#### Scenario: Barrel file size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/services/conversation-budget-service.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 180

#### Scenario: Public API surface unchanged
- **WHEN** inspecting `ConversationBudgetService` class declarations in the barrel
- **THEN** the only public async method is `prepareRequest` and its signature is `async prepareRequest(ctx: RuntimeContext, request: LlmRequest): Promise<LlmRequest>`, and the constructor signature is `constructor(defaults?: ConversationBudgetServiceOptions)` (with default `= {}`)

#### Scenario: External exports preserved
- **WHEN** grepping for `export (interface|class|type) (ConversationBudgetService|ConversationBudgetServiceOptions|ThreadSynopsisRecord)` in `conversation-budget-service.ts`
- **THEN** all three exports are present

#### Scenario: No inline LLM / repo / event side effects in barrel
- **WHEN** grepping the barrel for `ctx\.llmGateway\.|ctx\.systemCaller\.chat|ctx\.repos\.(events|compactSummaries)\.(insert|create)|ctx\.eventBus\.emit|SYNOPSIS_SYSTEM_PROMPT|FULL_COMPACT_SYSTEM_PROMPT`
- **THEN** there are no matches

### Requirement: Internal modules are one-responsibility-per-file

The 4 internal modules SHALL live in `packages/core/src/services/conversation-budget/`:

- `options-resolver.ts` — pure function `resolveOptions(ctx, defaults) → ResolvedConversationBudgetOptions` plus all `DEFAULT_*` constants and the `ResolvedConversationBudgetOptions` interface
- `message-utils.ts` — pure functions `buildRequestMessages(...)` and `estimateTokens(messages)`
- `synopsis-generator.ts` — class `SynopsisGenerator` owning synopsis failure streak Map, `SYNOPSIS_SYSTEM_PROMPT`, synopsis LLM call, heuristic fallback, circuit breaker, synopsis DB writes, `conversation.synopsis.updated` EventBus emit, post-synopsis cleanup (`ctx.repos.nodeSummaries.trimByThread` + stale interaction clearing), and a public `parseExisting(raw)` helper
- `full-compact-orchestrator.ts` — class `FullCompactOrchestrator` owning full-compact failure streak Maps (streak + lastFailureMessageCount), `FULL_COMPACT_SYSTEM_PROMPT`, `tryInitialCompact`, `tryRefreshCompact`, baseline persistence, `conversation.compact.completed` EventBus emit, full-compact skip-row DB writes

#### Scenario: Exactly 4 internal module files exist
- **WHEN** listing `packages/core/src/services/conversation-budget/*.ts`
- **THEN** exactly these 4 files exist: `options-resolver.ts`, `message-utils.ts`, `synopsis-generator.ts`, `full-compact-orchestrator.ts`

#### Scenario: Options resolution is isolated
- **WHEN** grepping `packages/core/src/services/**/*.ts` for `DEFAULT_TAIL_NON_SYSTEM_MESSAGES`, `DEFAULT_SYNOPSIS_TRIGGER_MESSAGES`, `DEFAULT_FULL_COMPACT_TRIGGER_TOKENS`, or the `ResolvedConversationBudgetOptions` interface declaration
- **THEN** all declarations are inside `conversation-budget/options-resolver.ts`

#### Scenario: Synopsis side effects are single-owner
- **WHEN** grepping `packages/core/src/services/**/*.ts` for `SYNOPSIS_SYSTEM_PROMPT`, `conversationSynopsisUpdated(`, or the string literal `'conversation.synopsis.updated'`
- **THEN** every match is inside `conversation-budget/synopsis-generator.ts`

#### Scenario: Full-compact side effects are single-owner
- **WHEN** grepping `packages/core/src/services/**/*.ts` for `FULL_COMPACT_SYSTEM_PROMPT`, `conversationCompactCompleted(`, the string literal `'conversation.compact.completed'`, or `compact_kind: 'full_thread'` / `compact_kind: 'full_thread_skip'`
- **THEN** every match is inside `conversation-budget/full-compact-orchestrator.ts`

#### Scenario: Failure-streak state is owned by correct module
- **WHEN** grepping `packages/core/src/services/**/*.ts` for the identifier `synopsisFailureStreaks`
- **THEN** matches exist only in `conversation-budget/synopsis-generator.ts`
- **WHEN** grepping for the identifiers `fullCompactFailureStreaks` and `fullCompactFailureMessageCounts`
- **THEN** matches exist only in `conversation-budget/full-compact-orchestrator.ts`

### Requirement: Observable budget behavior is unchanged after refactor

For identical `LlmRequest` input, identical `ctx.runtimePolicy.summarization`, and identical thread state (synopsis_json / compact_baseline_json), the service SHALL produce byte-identical:

1. Returned `request.messages` sequence (including pruned slice, synopsis system message placement, compact baseline system message placement)
2. `ctx.repos.threads.updateSynopsis` / `updateCompactBaseline` call arguments and order
3. `ctx.repos.compactSummaries.create` row fields (compact_id prefix, compact_kind, summary_source, messages_compacted, failure_streak)
4. `ctx.repos.events.insert` payload shape for `conversation.synopsis.updated` and `conversation.compact.completed`
5. `ctx.eventBus.emit` event object and emit order
6. Failure-streak increment / reset semantics (per threadId) across synopsis and full-compact paths

#### Scenario: Synopsis path emits same event payload
- **WHEN** the synopsis threshold is crossed during `prepareRequest` with a mock LLM that returns a deterministic summary
- **THEN** a `conversation.synopsis.updated` event is emitted with the same `{ summary, version, prunedMessageCount, totalMessageCount }` payload shape as pre-refactor and the `events.insert` row has `event_type: 'conversation.synopsis.updated'` with matching payload_json

#### Scenario: Full-compact path emits same event payload
- **WHEN** the full-compact threshold is crossed during `prepareRequest` with a mock LLM that returns a deterministic summary
- **THEN** a `conversation.compact.completed` event is emitted with the same `{ compactId, compactVersion, compactedNonSystemMessageCount, keptTailNonSystemMessageCount, preCompactMessageCount, preCompactTokenCount }` payload shape as pre-refactor and the `events.insert` row has `event_type: 'conversation.compact.completed'`

#### Scenario: Failure-streak recovery is byte-identical
- **WHEN** the synopsis LLM call fails N < `synopsisFailureThreshold` times in a row then succeeds
- **THEN** the failure streak Map entry for that threadId is cleared after the successful call, and the next call with same threshold conditions behaves as if no failures had occurred

### Requirement: ConversationBudgetServiceOptions contract is unchanged

`ConversationBudgetServiceOptions` interface SHALL retain every pre-refactor field with the same type and default value. The interface SHALL continue to be exported from `conversation-budget-service.ts` (the barrel), not from an internal module.

#### Scenario: Options interface export parity
- **WHEN** comparing the exported `ConversationBudgetServiceOptions` field names and types between pre-change and post-change `conversation-budget-service.ts`
- **THEN** every field name and type is byte-identical

#### Scenario: ThreadSynopsisRecord export path unchanged
- **WHEN** grepping `packages/core/src/services/execution-trace-service.ts` for `from './conversation-budget-service.js'`
- **THEN** the import resolves (barrel still exports `ThreadSynopsisRecord`)
