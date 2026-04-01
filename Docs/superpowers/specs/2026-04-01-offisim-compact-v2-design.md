# Offisim Compact v2 Design

## Goal

Improve long-running execution viability by reducing low-value LLM context without breaking LangGraph state semantics or tool-call invariants.

This first tranche implements only zero-cost micro-compaction for old tool-result messages. It does not yet modify checkpoint state, node summaries, or full-thread compaction artifacts.

## Current State

Offisim currently compacts only at request time through `ConversationBudgetService.prepareRequest()`. The service can:

- trim non-system message tails
- generate and inject a thread synopsis
- persist synopsis text on the thread row

This helps request size, but it still sends verbatim old tool outputs until tail pruning or synopsis generation kicks in.

## Problem

Old `tool` messages are often the largest blocks in the conversation. They are usually low-value after the tool result has already informed a later assistant turn, but they still count toward token estimation and synopsis input.

We need a safe first step that:

- reduces context size before LLM calls
- preserves `toolCallId` pairing
- does not mutate LangGraph checkpoint state
- does not require new database tables

## Tranche 1 Scope

Add request-time micro-compaction for old tool-result messages.

Behavior:

- keep the most recent N tool-result messages verbatim
- for older tool-result messages whose content exceeds a configured size, replace the content with a compact placeholder
- preserve message role and `toolCallId`
- run before synopsis generation and before tail pruning

Out of scope:

- node history summaries
- full-thread compact artifacts
- checkpoint mutation
- resume-time rehydration changes

## Design

### Compaction Primitive

Introduce a reusable helper in the LLM pruning layer that accepts an ordered message list and compacts old `tool` messages according to two knobs:

- `toolResultKeepRecent`
- `toolResultMaxContentChars`

Placeholder format should be deterministic and lightweight. It should carry enough metadata for debugging, for example original content length.

### Budget Service Integration

`ConversationBudgetService.prepareRequest()` should:

1. split system and non-system messages as it does today
2. micro-compact the full request message list
3. re-derive non-system messages from the compacted list
4. estimate tokens and decide whether synopsis generation is needed
5. run existing synopsis logic unchanged
6. run existing tail pruning unchanged

This keeps the feature inside the current middleware boundary and avoids any LangGraph reducer work.

### Safety Properties

- No message deletion at the micro-compaction stage.
- No reordering.
- No mutation of system messages.
- No mutation of recent tool messages.
- `toolCallId` always preserved on compacted tool messages.

## Test Plan

Add unit tests for:

- compacting only old tool messages while preserving recent ones
- preserving same-reference fast path when no compaction is needed
- ensuring tool placeholders survive the `ConversationBudgetService` path
- ensuring synopsis injection still works after tool micro-compaction

## Follow-up Tranches

1. Node summary ledger persisted outside checkpoint state
2. Full-thread compact artifacts with explicit metadata
3. Resume-aware compact/stale-check integration
