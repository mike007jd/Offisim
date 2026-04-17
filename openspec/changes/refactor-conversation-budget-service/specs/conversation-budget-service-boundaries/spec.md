## ADDED Requirements

### Requirement: ConversationBudgetService delegates to single-responsibility modules

`packages/core/src/services/conversation-budget-service.ts` SHALL contain no more than 220 non-blank, non-comment lines. The `ConversationBudgetService` class SHALL retain its public API (`processBeforeCall`, `processAfterCall`, `getSynopsis`, constructor signature) but SHALL delegate implementation to modules in `packages/core/src/services/conversation-budget/`. Class method bodies SHALL NOT contain inline prune / compact algorithms, policy threshold evaluation, synopsis generation LLM calls, or synopsis store Map manipulation.

#### Scenario: File size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/services/conversation-budget-service.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 220

#### Scenario: Public API unchanged
- **WHEN** comparing `grep '^  \(public \)*async\? \(processBeforeCall\|processAfterCall\|getSynopsis\)' packages/core/src/services/conversation-budget-service.ts` pre-change vs post-change
- **THEN** every public method signature is byte-identical

### Requirement: Internal modules are one-responsibility-per-file

The 5 internal modules SHALL live in `packages/core/src/services/conversation-budget/`:

- `synopsis-store.ts` — per-thread `ThreadSynopsisRecord` Map container (get / upsert / clear), no external dependencies
- `prune-policy.ts` — pure function `pruneMessages(input): PruneResult` wrapping `pruneLlmMessages`
- `tool-result-compactor.ts` — pure function `compactToolResults(input): CompactResult` wrapping `compactToolResultMessages`
- `synopsis-generator.ts` — class `SynopsisGenerator` owning the LLM call that produces summary + emits `conversationSynopsisUpdated` event
- `policy.ts` — pure function `evaluatePolicy(input): PolicyDecision` returning `{ shouldPrune, shouldCompact, shouldRefreshSynopsis }`

No internal module SHALL import the service barrel or another internal module's implementation (utility imports like shared types are allowed).

#### Scenario: One file per internal module
- **WHEN** listing `packages/core/src/services/conversation-budget/*.ts`
- **THEN** exactly these 5 files exist

#### Scenario: Policy evaluation is isolated
- **WHEN** grepping `packages/core/src/services/**/*.ts` for threshold comparisons like `messageCount >= maxNonSystemMessages` or `synopsisTriggerMessages`
- **THEN** all matches are inside `conversation-budget/policy.ts`

#### Scenario: Synopsis store is single-owner
- **WHEN** grepping `packages/core/src/services/**/*.ts` for `Map<string, ThreadSynopsisRecord>` declarations
- **THEN** exactly one match exists, inside `conversation-budget/synopsis-store.ts`

### Requirement: Observable budget behavior is unchanged after refactor

For identical LlmRequest / LlmResponse input and identical config, the service SHALL produce byte-identical: pruned message sequence, compacted tool-result content, synopsis refresh trigger timing, emitted event payloads, and `getSynopsis` return values.

#### Scenario: Prune kicks in at same threshold
- **WHEN** `processBeforeCall` is called with a request whose message count exceeds `maxNonSystemMessages`
- **THEN** the returned request's messages reflect the same pruned subset and the same `prunedMessageCount` synopsis field as pre-refactor

#### Scenario: Auto-compact refresh triggers same event
- **WHEN** the auto-compact threshold is crossed during `processAfterCall`
- **THEN** a `conversationCompactCompleted` event is emitted with the same payload shape (thread id / version / summary / prunedMessageCount / totalMessageCount) as pre-refactor

#### Scenario: Synopsis returns identical record
- **WHEN** `getSynopsis(threadId)` is called after a synopsis has been stored
- **THEN** the returned `ThreadSynopsisRecord` fields (version / summary / prunedMessageCount / totalMessageCount / updatedAt) are byte-identical to pre-refactor

### Requirement: ConversationBudgetServiceOptions contract is unchanged

`ConversationBudgetServiceOptions` interface SHALL retain every pre-refactor field with the same type and default value. The interface SHALL continue to be exported from `conversation-budget-service.ts`.

#### Scenario: Options interface export parity
- **WHEN** comparing the exported `ConversationBudgetServiceOptions` fields pre-change vs post-change
- **THEN** every field name, type, and default is byte-identical
