# Offisim Compact v2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tranche 1 of Compact v2 by micro-compacting old tool-result messages before synopsis generation and tail pruning.

**Architecture:** Keep the feature inside the current request-time compaction path. Add one reusable helper in the LLM pruning layer, thread it through `ConversationBudgetService`, and verify behavior with targeted unit tests. Do not modify LangGraph checkpoint state in this tranche.

**Tech Stack:** TypeScript, Vitest, LangGraph request middleware, in-memory repositories.

---

## File Map

- Modify: `packages/core/src/llm/prune-messages.ts`
- Modify: `packages/core/src/services/conversation-budget-service.ts`
- Modify: `packages/core/src/__tests__/unit/prune-messages.test.ts`
- Modify: `packages/core/src/__tests__/unit/conversation-budget-service.test.ts`

## Chunk 1: Micro-Compaction Primitive

### Task 1: Add failing helper tests

**Files:**
- Modify: `packages/core/src/__tests__/unit/prune-messages.test.ts`
- Modify: `packages/core/src/llm/prune-messages.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for:

- compacting old `tool` messages while keeping the most recent tool message verbatim
- preserving `toolCallId`
- returning the original reference when no tool compaction is required

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/unit/prune-messages.test.ts`

Expected: FAIL because the helper/options do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add a helper and options in `prune-messages.ts` that replace old oversized tool contents with a deterministic placeholder.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/unit/prune-messages.test.ts`

Expected: PASS

## Chunk 2: Budget Service Wiring

### Task 2: Add failing service-level test

**Files:**
- Modify: `packages/core/src/__tests__/unit/conversation-budget-service.test.ts`
- Modify: `packages/core/src/services/conversation-budget-service.ts`

- [ ] **Step 1: Write the failing test**

Add a test showing that `ConversationBudgetService.prepareRequest()` micro-compacts old tool messages before synopsis/tail pruning.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/unit/conversation-budget-service.test.ts`

Expected: FAIL because the service does not compact tool results yet.

- [ ] **Step 3: Write minimal implementation**

Thread micro-compaction options through `ConversationBudgetService` and apply them before token estimation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/unit/conversation-budget-service.test.ts`

Expected: PASS

## Chunk 3: Verification

### Task 3: Run focused regression coverage

**Files:**
- Test: `packages/core/src/__tests__/unit/prune-messages.test.ts`
- Test: `packages/core/src/__tests__/unit/conversation-budget-service.test.ts`
- Test: `packages/core/src/__tests__/unit/summarization-middleware.test.ts`

- [ ] **Step 1: Run the focused suite**

Run: `pnpm vitest run packages/core/src/__tests__/unit/prune-messages.test.ts packages/core/src/__tests__/unit/conversation-budget-service.test.ts packages/core/src/__tests__/unit/summarization-middleware.test.ts`

Expected: PASS

- [ ] **Step 2: Check for accidental behavior drift**

Review whether synopsis persistence, event emission, and same-reference fast paths remain intact where expected.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/llm/prune-messages.ts \
  packages/core/src/services/conversation-budget-service.ts \
  packages/core/src/__tests__/unit/prune-messages.test.ts \
  packages/core/src/__tests__/unit/conversation-budget-service.test.ts \
  docs/superpowers/specs/2026-04-01-offisim-compact-v2-design.md \
  docs/superpowers/plans/2026-04-01-offisim-compact-v2.md
git commit -m "feat: add compact v2 tool-result micro compaction"
```

Plan complete and saved to `docs/superpowers/plans/2026-04-01-offisim-compact-v2.md`. Ready to execute?
