# Offisim Full Compact Phase Design

## Goal

Add a durable full-compaction layer for long-running Offisim executions so that:

- request-time context stays small enough for repeated LLM calls
- resume/recovery uses a compacted baseline rather than replaying the full historical message tail
- compaction remains compatible with LangGraph checkpoints, task-run audit trails, and node summaries

This phase explicitly follows the core lesson from Claude Code:

- full compaction must become a durable session boundary
- resume/query behavior must understand that boundary

It does **not** copy Claude Code's transcript-chain relinking model. Offisim already has LangGraph checkpoints and structured repositories, so we can use a simpler durable-boundary design.

## Why This Phase Exists

Offisim already has:

- request-time micro-compaction for old tool results
- thread synopsis generation in `ConversationBudgetService`
- node summary ledger outside LangGraph state
- checkpoint-based resume

That is enough for moderate runs, but not for very long ones.

Current gaps:

- full history still exists as one logical conversation without an explicit compact baseline
- resume continues from the latest checkpoint, but that checkpoint still conceptually owns the whole prior conversation tail
- synopsis is durable text, but not a durable execution boundary

Claude Code treats full compaction as a first-class transcript mutation:

- it writes a compact boundary
- writes a compact summary
- later query/resume paths only consider content after that boundary

That design is directionally correct. For Offisim, the equivalent should be a durable compact artifact plus a compact-aware checkpoint baseline.

## Design Choice

### Chosen Approach

Implement **logical durable compaction**:

- persist a `full compact artifact`
- persist an active compact baseline in thread business storage, then mirror it into execution state
- make request assembly, checkpoint resume, and context injection compact-aware
- keep old raw history in storage for audit/debug, but stop treating it as live conversational context

### Rejected Approach

Do **not** physically rewrite or relink LangGraph message history the way Claude Code relinks JSONL transcript chains.

Reasons:

- Offisim uses checkpointed graph state, not append-only transcript chaining as its runtime truth
- task runs, MCP audit, node summaries, and LLM calls already provide durable structure outside `messages`
- physical mutation of historical graph messages would add large correctness risk around reducer semantics and resume

## Architecture

The phase adds four concrete pieces.

### 1. Full Compact Artifact

Persist a durable summary artifact for a thread.

Prefer extending the existing `compact_summaries` storage rather than creating a parallel table unless the current schema proves too restrictive.

Suggested durable fields:

```ts
export interface FullCompactArtifactRow {
  compact_id: string;
  thread_id: string;
  company_id: string;
  compact_version: number;
  summary_text: string;
  node_summary_count: number;
  source_non_system_message_count: number;
  source_token_count: number;
  compacted_non_system_message_count: number;
  kept_tail_non_system_message_count: number;
  failure_streak: number;
  created_at: string;
}
```

This artifact becomes the durable "baseline memory" for the thread.

### 2. Active Compact Baseline

Persist compact-awareness in thread business storage first, then mirror it into graph/checkpoint state.

Suggested state addition:

```ts
interface CompactBaselineState {
  compactId: string;
  compactVersion: number;
  compactedAt: string;
  summaryText: string;
  compactedNonSystemMessageCount: number;
  keptTailNonSystemMessageCount: number;
}
```

Add to `OffisimGraphState`:

```ts
compactBaseline: CompactBaselineState | null
```

Important:

- `prepareRequest()` can write thread storage, but it cannot directly mutate the latest LangGraph checkpoint
- therefore the source of truth for activation should be thread storage, not middleware-local state
- `resumePlan()` should load the active baseline from thread storage and merge it into restored graph state

This baseline is not the whole artifact. It is the active compact cut that live execution should honor.

### 3. Compact-Aware Request Assembly

`ConversationBudgetService.prepareRequest()` should become compact-aware.

Assembly order:

1. current system messages
2. compact baseline system message, if present
3. recent node summaries
4. recent live tail messages after the compact cut
5. existing request-time micro-compaction and synopsis logic

Effectively, once a full compact baseline exists, old messages prior to the compact cut are no longer considered part of the live request tail.

### 4. Compact-Aware Resume

`resumePlan()` should restore from the latest checkpoint as it does today, but:

- if the restored state has `compactBaseline`, the resumed execution continues from that baseline
- resume should not attempt to reconstruct pre-boundary conversational context from legacy messages
- if a rewind targets a step earlier than the active compact boundary, rewind must fail safely or require a higher-level reset path

## Triggering

Full compact should remain request-driven, not event-driven.

Trigger point:

- inside `ConversationBudgetService.prepareRequest()`

But compaction activation must run through a guarded coordinator, not a raw inline write path.

Need:

- per-thread reentry guard
- per-thread in-flight compact guard
- "already compacted recently" short-circuit

Trigger conditions:

- request exceeds a high token threshold even after tool-result micro-compaction
- synopsis already exists or node summaries alone are insufficient
- no recent full compact has already reduced the thread sufficiently

Suggested rule:

- `approximateTokens >= fullCompactTriggerTokens`
- and `nonSystemMessages.length >= fullCompactTriggerMessages`
- and either no active compact baseline exists, or tail growth since last full compact exceeds `fullCompactRefreshMinMessages`

## Summary Generation

Unlike node summaries, full compact should use an LLM.

Recommended input:

- current thread synopsis, if any
- recent node summaries
- overflow conversation messages that would otherwise exceed the target budget

Recommended output sections:

- user objective
- confirmed decisions
- files/components touched
- plan/progress state
- unresolved questions
- current constraints and warnings

This keeps the compact artifact execution-oriented rather than chat-oriented.

## Data Flow

### Full Compact Write Path

1. `prepareRequest()` computes approximate overflow
2. if threshold hit, build full compact source payload
3. call compact summarizer model through `systemCaller`
4. persist `FullCompactArtifactRow`
5. update thread synopsis if needed
6. persist active compact baseline onto the thread row
7. use that compact baseline immediately for the current request assembly
8. let future resume hydrate it back into graph state
9. emit `conversation.compact.completed`
10. run post-compact cleanup

### Post-Compact Read Path

For all future LLM calls:

- old pre-boundary live messages are omitted from request assembly
- baseline summary plus recent tail replaces them

For resume:

- latest checkpoint may or may not already contain `compactBaseline`
- `resumePlan()` must load thread-level active compact baseline and merge it into restored state
- resumed execution then uses compact-aware request assembly automatically

## Post-Compact Cleanup

Claude Code clears state after compaction for a reason. Offisim should add a smaller equivalent cleanup pass.

Post-compact cleanup should:

- trim node summaries beyond a configured keep count
- clear stale per-thread synopsis failure streak state
- clear transient interaction requests if they predate the new compact boundary
- optionally clear volatile file-history caches that are only relevant to the discarded live tail

Offisim does not need Claude's transcript-tail metadata re-append behavior because metadata is not discovered from a JSONL tail window. That is a Claude-specific transcript-storage concern, not an Offisim requirement.

It should **not**:

- delete MCP audit rows
- delete task runs
- delete LLM call records
- mutate persisted file snapshots

## Circuit Breaker

Full compact must have a failure circuit breaker.

Behavior:

- track consecutive full-compact failures per thread
- after N failures, stop retrying LLM full compact for that thread until meaningful new growth occurs
- fall back to existing synopsis + aggressive tail pruning

Suggested default:

- threshold: `3`

## Safety Invariants

1. Full compact must not mutate historical MCP audit, task-run, or LLM-call rows.
2. Full compact must not physically rewrite older LangGraph message chains.
3. Request assembly after compact must use `compactBaseline + recent tail`, never `full old tail + summary`.
4. Resume must treat `compactBaseline` as authoritative live context.
5. Rewind before the compact cut must not silently continue with incomplete context.
6. If a pre-compact checkpoint still exists, rewind may restore from that earlier checkpoint instead of failing.

## Repository and Schema Changes

Update:

- existing compact-summary persistence to support `full_thread` artifacts
- `graph_threads` with `compact_baseline_json` or equivalent active-baseline pointer
- `OffisimGraphState` with `compactBaseline`
- checkpoint serialization expectations
- event schema with:

```ts
type ConversationCompactCompletedPayload = {
  compactId: string;
  compactVersion: number;
  sourceMessageCount: number;
  sourceTokenCount: number;
  keptTailMessageCount: number;
}
```

## Testing

Add unit/integration coverage for:

- full compact artifact creation when thresholds are exceeded
- request assembly after compact uses baseline plus recent tail
- repeated requests do not recompact immediately without new growth
- circuit breaker stops repeated failed compactions
- resume honors compact baseline
- rewind earlier than compact boundary fails safely

## Implementation Order

1. Add thread-level active compact baseline storage
2. Add `compactBaseline` to graph state and resume merge flow
3. Teach `ConversationBudgetService` to generate/persist full compact artifacts
4. Make request assembly compact-aware
5. Add compact coordinator guards + circuit breaker
6. Make `resumePlan()` compact-boundary aware

## Recommendation

Build this as a dedicated durable-compaction phase, not as an extension of thread synopsis.

Thread synopsis is a lightweight request aid.
Full compact baseline is a session boundary.

Those are related, but they are not the same thing.
