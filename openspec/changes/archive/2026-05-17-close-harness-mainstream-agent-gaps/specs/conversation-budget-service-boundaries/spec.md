## MODIFIED Requirements

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

## ADDED Requirements

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
