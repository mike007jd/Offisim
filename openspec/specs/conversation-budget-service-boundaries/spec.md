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

The byte-identical-behavior invariant applies ONLY to the structural refactor that introduced this capability (no behavior change attributable to module reorganization). It SHALL NOT block the deliberate, audit-driven budget evolution defined in this change (G03): real model-context-window-derived triggering, reactive context-overflow recovery, and a tool-pair-safe compaction boundary. After this change, the behavioral baseline for any future refactor is the post-G03 behavior.

For identical `LlmRequest` input, identical `ctx.runtimePolicy.summarization`, identical thread state, AND identical resolved-model context window, the service SHALL produce byte-identical:

1. Returned `request.messages` sequence (pruned slice, synopsis/compact-baseline system message placement)
2. `ctx.repos.threads.updateSynopsis` / `updateCompactBaseline` call arguments and order
3. `ctx.repos.compactSummaries.create` row fields
4. `ctx.repos.events.insert` payload shape for `conversation.synopsis.updated` and `conversation.compact.completed`
5. `ctx.eventBus.emit` event object and emit order
6. Failure-streak increment/reset semantics per threadId

#### Scenario: Refactor-only change preserves payloads

- **WHEN** a pure structural refactor of the budget modules occurs with no G03 behavior change, against an identical resolved-model context window
- **THEN** synopsis/compact event payload shapes and repo call order remain byte-identical

#### Scenario: Deliberate G03 evolution is not blocked by this invariant

- **WHEN** the trigger threshold changes because it is now derived from the real model context window per G03
- **THEN** that behavior change is permitted as the new baseline
- **AND** it is not treated as an invariant violation of this requirement

### Requirement: ConversationBudgetServiceOptions contract is unchanged

`ConversationBudgetServiceOptions` interface SHALL retain every pre-refactor field with the same type and default value. The interface SHALL continue to be exported from `conversation-budget-service.ts` (the barrel), not from an internal module.

#### Scenario: Options interface export parity
- **WHEN** comparing the exported `ConversationBudgetServiceOptions` field names and types between pre-change and post-change `conversation-budget-service.ts`
- **THEN** every field name and type is byte-identical

#### Scenario: ThreadSynopsisRecord export path unchanged
- **WHEN** grepping `packages/core/src/services/execution-trace-service.ts` for `from './conversation-budget-service.js'`
- **THEN** the import resolves (barrel still exports `ThreadSynopsisRecord`)

### Requirement: Compaction triggering SHALL be derived from the real model context window (G03)

The conversation budget trigger SHALL be computed from the resolved model's real context window minus reserved output headroom, NOT from a fixed character-derived constant. The model registry SHALL expose a per-model `contextWindow`. Token estimation SHALL NOT assume `length/4`; it SHALL use an estimate that does not under-count CJK text by 3–4×.

#### Scenario: Trigger scales with the model window

- **WHEN** the same conversation is run against a small-context model and a large-context model
- **THEN** the compaction trigger fires proportionally to each model's real context window minus reserved output
- **AND** it does not fire on a fixed ~90k character estimate independent of the model

#### Scenario: CJK content is not under-counted into a late trigger

- **WHEN** the conversation is predominantly CJK text
- **THEN** the token estimate does not undercount it ~3–4× relative to a real tokenizer
- **AND** the trigger does not fire far later than the real budget

### Requirement: Provider context-overflow SHALL trigger reactive recovery (G03)

When a provider rejects a request for exceeding context length (context-overflow / 413 / prompt-too-long), the harness SHALL force a full compaction and retry the request once before surfacing a failure.

#### Scenario: Over-long request recovers once

- **WHEN** a request is rejected by the provider for exceeding context length
- **THEN** the harness forces a full compaction and retries the request once
- **AND** the run only fails if the retried, compacted request also fails

### Requirement: Compaction boundary SHALL be tool-pair-safe (G03)

The compaction cut SHALL never separate an assistant `tool_use` from its matching `tool_result`. The boundary SHALL be walked back so a `tool` result is not orphaned in the post-compaction message sequence.

#### Scenario: Boundary walks back off a tool pair

- **WHEN** a count-based compaction cut would fall between a `tool_use` and its `tool_result`
- **THEN** the boundary is moved so the pair stays together
- **AND** the compacted sequence contains no orphaned `tool` message that would 400 on the OpenAI-compatible adapter

