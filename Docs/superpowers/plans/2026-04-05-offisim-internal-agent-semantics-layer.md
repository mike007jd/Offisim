# Offisim Internal Agent Context Pack Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve internal agent decision quality by giving each LLM call a bounded, structured runtime context pack derived from existing Offisim state instead of relying only on raw message history and node summaries.

**Architecture:** Offisim already has the primitives needed for a first proof-of-value: `InteractionService` tracks pending approvals/questions, `OrchestrationService` can serialize checkpoint-derived execution state, `NodeSummaryRepository` stores recent node outcomes, and runtime repositories already expose task runs, meetings, handoffs, and events. This plan does not introduce broad new registries or a second state machine. It extends the existing node-context path with a shared-budget context pack, adds one small normalization helper where current UI fallbacks drift from canonical runtime truth, and verifies the effect before widening scope.

**Tech Stack:** TypeScript, LangGraph, Vitest, React, existing EventBus/RuntimeRepositories/NodeContextMiddleware infrastructure.

---

## Why This Plan Is Narrow

This plan intentionally rejects three larger ideas from the earlier draft:

- No standalone `Action Registry`. There is no concrete consumer yet beyond context generation, and static capability metadata would drift from real runtime services.
- No broad `CollaborationSemanticsService` that fan-outs across many repositories on every LLM call. First prove value with a minimal snapshot built from a small set of sources.
- No large UI refactor through a new semantics abstraction layer. Only touch UI where there is already concrete drift.

## Concrete Current Failure Modes

These are real issues in the current codebase, not architectural preferences:

1. The fallback path in [useOffice3DViewState.ts](/Users/haoshengli/Seafile/WebWorkSpace/Offisim/packages/ui-office/src/components/scene/useOffice3DViewState.ts#L216) listens to `task.state.changed` and expects `payload.taskState === 'active'`, but the canonical `TaskStatePayload` uses `prev`/`next` and `TaskState` does not include `active`. If `sceneIntentBus` is absent, the fallback dispatch flow line can never trigger from valid task-state payloads.
2. Node context already consumes a bounded 1400-character budget in [node-context-middleware.ts](/Users/haoshengli/Seafile/WebWorkSpace/Offisim/packages/core/src/middleware/builtin/node-context-middleware.ts#L7). Adding a second middleware with another large system block would create avoidable prompt-budget collisions.
3. Meaning needed by agents is split across live interaction state, recent node summaries, and checkpoint-derived execution state. Those sources already exist, but they are not assembled into one structured pre-LLM view.

That is enough justification for a focused first implementation.

## File Structure Map

### Core implementation

- Create: `packages/shared-types/src/agent-context-pack.ts`
  Purpose: typed shape for the bounded structured context pack.
- Modify: `packages/shared-types/src/index.ts`
  Purpose: export the new context-pack types.
- Create: `packages/core/src/services/agent-context-pack-service.ts`
  Purpose: assemble the context pack from a minimal set of existing sources.
- Modify: `packages/core/src/middleware/builtin/node-context-middleware.ts`
  Purpose: extend the existing context block builder to include the new pack under one shared character budget.
- Modify: `packages/core/src/runtime/runtime-context.ts`
  Purpose: carry the pack service or the dependencies it needs in a stable way.
- Modify: `packages/core/src/browser.ts`
  Purpose: export the pack service for runtime bootstrappers.

### Runtime bootstrap

- Modify: `apps/web/src/lib/browser-runtime.ts`
  Purpose: register the pack service in the browser runtime path.
- Modify: `apps/web/src/lib/tauri-runtime.ts`
  Purpose: register the pack service in the Tauri runtime path.

### Minimal normalization and verification surfaces

- Create: `packages/core/src/semantics/runtime-context-normalizers.ts`
  Purpose: small pure helpers for mapping existing runtime rows/events into stable pack fields without introducing registry indirection.
- Modify: `packages/ui-office/src/components/scene/useOffice3DViewState.ts`
  Purpose: fix the concrete `task.state.changed` fallback drift against canonical task payloads.
- Modify: `packages/ui-office/src/runtime/OffisimRuntimeProvider.tsx`
  Purpose: optionally expose the latest generated context pack for debug verification only.

### Tests

- Create: `packages/core/src/__tests__/unit/agent-context-pack-service.test.ts`
- Create: `packages/core/src/__tests__/unit/node-context-middleware-context-pack.test.ts`
- Create: `packages/core/src/__tests__/unit/runtime-context-normalizers.test.ts`
- Modify: `packages/ui-office/src/__tests__/unit/scene-intent-dispatcher.test.ts` only if needed by the fallback fix
- Create: `packages/ui-office/src/__tests__/unit/useOffice3DViewState-fallback.test.tsx`

## Data Sources Allowed In V1

The context pack must stay cheap. Only these sources are allowed in the first implementation:

- `InteractionService.getPending()` or restored pending interaction state
- `NodeSummaryRepository.listByThread(threadId, { limit })`
- `OrchestrationService.serializeExecutionState(threadId)` or equivalent checkpoint-derived state
- `repos.taskRuns.findByThread(threadId)` with a tight limit or in-memory filtering for current/open work

Optional only if already available in-memory:

- active meeting from `repos.meetings.findById(meetingId)` when serialized execution state exposes a current meeting

Do not query:

- full runtime event history
- interaction history
- handoff history
- llm call history
- broad checkpoint scans

Those can come later if V1 proves value.

## Pack Shape

The V1 pack should stay small and stable:

- `thread`
  - `threadId`
  - `companyId`
  - `entryMode`
  - `checkpointId`
- `execution`
  - `currentStepIndex`
  - `completedStepIndices`
  - `pendingAssignmentsCount`
  - `meetingId`
  - `hasTaskPlan`
  - `taskPlanSummary`
- `interactions`
  - `pending.kind`
  - `pending.title`
  - `pending.employeeId`
  - `pending.taskRunId`
- `recentNodeSummaries`
  - latest N compact summaries
- `activeTaskRuns`
  - only open or newest thread task runs
- `recommendedFocus`
  - one short derived sentence, generated by deterministic code, not another model call

## Shared Budget Rule

There must be exactly one context budget inside `NodeContextMiddleware`.

Suggested default:

- total context block cap: `1800` chars
- up to `1000` chars for recent node summaries
- up to `700` chars for the structured context pack
- reserve the remainder for headings/newlines

If the pack is empty, node summaries can use the full budget. If node summaries are empty, the pack can use more of the same total cap. Do not create a second middleware with its own independent cap.

## Chunk 1: Contracts and Normalizers

### Task 1: Add the typed context-pack contract and normalization helpers

**Files:**
- Create: `packages/shared-types/src/agent-context-pack.ts`
- Modify: `packages/shared-types/src/index.ts`
- Create: `packages/core/src/semantics/runtime-context-normalizers.ts`
- Create: `packages/core/src/__tests__/unit/runtime-context-normalizers.test.ts`

- [ ] **Step 1: Write the failing normalizer tests**

Cover:

- pending interaction normalization
- serialized execution state normalization
- task-run normalization for active/open work
- recommended-focus derivation from the normalized inputs

Run:

```bash
pnpm --filter @offisim/core test -- --run packages/core/src/__tests__/unit/runtime-context-normalizers.test.ts
```

Expected: FAIL because the normalizers and pack types do not exist yet.

- [ ] **Step 2: Add the pack contract**

Create `packages/shared-types/src/agent-context-pack.ts` with:

- `AgentContextPack`
- `AgentContextPackThread`
- `AgentContextPackExecution`
- `AgentContextPackPendingInteraction`
- `AgentContextPackTaskRun`
- `AgentContextPackNodeSummary`

Keep the types narrow. Reuse existing runtime and interaction types where possible.

- [ ] **Step 3: Implement the pure normalizers**

Create `runtime-context-normalizers.ts` with pure helpers for:

- `normalizePendingInteraction()`
- `normalizeExecutionState()`
- `normalizeActiveTaskRuns()`
- `deriveRecommendedFocus()`

No repository access in this file.

- [ ] **Step 4: Verify shared-types and core compile**

Run:

```bash
pnpm --filter @offisim/shared-types typecheck
pnpm --filter @offisim/core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/agent-context-pack.ts packages/shared-types/src/index.ts packages/core/src/semantics/runtime-context-normalizers.ts packages/core/src/__tests__/unit/runtime-context-normalizers.test.ts
git commit -m "feat: define agent context pack contracts"
```

## Chunk 2: Agent Context Pack Service

### Task 2: Assemble a minimal structured context pack from existing runtime state

**Files:**
- Create: `packages/core/src/services/agent-context-pack-service.ts`
- Create: `packages/core/src/__tests__/unit/agent-context-pack-service.test.ts`
- Modify: `packages/core/src/runtime/runtime-context.ts`
- Modify: `packages/core/src/browser.ts`

- [ ] **Step 1: Write the failing service tests**

Cover:

- service builds a pack from pending interaction + serialized execution state + node summaries + task runs
- pack omits empty sections cleanly
- pack prefers open task runs over completed ones
- recommended focus changes deterministically when pending approval exists

Use repository and service doubles, not full graph bootstraps.

Run:

```bash
pnpm --filter @offisim/core test -- --run packages/core/src/__tests__/unit/agent-context-pack-service.test.ts
```

Expected: FAIL because the service does not exist yet.

- [ ] **Step 2: Implement the service**

The service should accept injected dependencies instead of reaching globally:

- `getPendingInteraction(): InteractionRequest | null`
- `getSerializedExecutionState(threadId): Promise<SerializedExecutionState | null>`
- `listNodeSummaries(threadId, limit): Promise<NodeSummaryRow[]>`
- `listTaskRuns(threadId): Promise<TaskRunRow[]>`

Build one `AgentContextPack` from those sources.

- [ ] **Step 3: Add runtime-context plumbing**

Update `runtime-context.ts` only enough to carry the new service cleanly for runtime bootstraps and middleware consumers.

- [ ] **Step 4: Export the service**

Expose the service through `packages/core/src/browser.ts`.

- [ ] **Step 5: Run verification**

Run:

```bash
pnpm --filter @offisim/core test -- --run packages/core/src/__tests__/unit/agent-context-pack-service.test.ts
pnpm --filter @offisim/core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/agent-context-pack-service.ts packages/core/src/__tests__/unit/agent-context-pack-service.test.ts packages/core/src/runtime/runtime-context.ts packages/core/src/browser.ts
git commit -m "feat: add minimal agent context pack service"
```

## Chunk 3: Integrate Into Existing Node Context Budget

### Task 3: Extend NodeContextMiddleware instead of adding a second middleware

**Files:**
- Modify: `packages/core/src/middleware/builtin/node-context-middleware.ts`
- Create: `packages/core/src/__tests__/unit/node-context-middleware-context-pack.test.ts`
- Modify: `apps/web/src/lib/browser-runtime.ts`
- Modify: `apps/web/src/lib/tauri-runtime.ts`

- [ ] **Step 1: Write the failing middleware tests**

Cover:

- one shared context block includes both recent node summaries and the structured pack
- total block respects one character cap
- node summaries shrink when the pack is large
- no pack section is emitted when all inputs are empty

Run:

```bash
pnpm --filter @offisim/core test -- --run packages/core/src/__tests__/unit/node-context-middleware-context-pack.test.ts
```

Expected: FAIL because the middleware does not know about the pack yet.

- [ ] **Step 2: Refactor NodeContextMiddleware for shared budgeting**

Change the current `buildContextBlock()` shape so it can assemble:

- `## Execution Context (previous nodes)`
- `## Runtime Context (current state)`

under one shared max char budget.

Do not add a second middleware.

- [ ] **Step 3: Register the service in both runtimes**

Update `browser-runtime.ts` and `tauri-runtime.ts` to instantiate and pass the pack service into the middleware composition.

- [ ] **Step 4: Run verification**

Run:

```bash
pnpm --filter @offisim/core test -- --run packages/core/src/__tests__/unit/node-context-middleware-context-pack.test.ts
pnpm --filter @offisim/core typecheck
pnpm --filter @offisim/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/middleware/builtin/node-context-middleware.ts packages/core/src/__tests__/unit/node-context-middleware-context-pack.test.ts apps/web/src/lib/browser-runtime.ts apps/web/src/lib/tauri-runtime.ts
git commit -m "feat: inject runtime context pack into node context budget"
```

## Chunk 4: Fix the Concrete UI Drift and Add Debug Visibility

### Task 4: Fix the known fallback inconsistency and expose the generated pack for verification

**Files:**
- Modify: `packages/ui-office/src/components/scene/useOffice3DViewState.ts`
- Create: `packages/ui-office/src/__tests__/unit/useOffice3DViewState-fallback.test.tsx`
- Modify: `apps/web/src/runtime/OffisimRuntimeProvider.tsx`

- [ ] **Step 1: Write the failing fallback test**

Cover the no-`sceneIntentBus` path in `useOffice3DViewState.ts` and assert that a valid `task.state.changed` payload can trigger dispatch flow behavior.

Run:

```bash
pnpm --filter @offisim/ui-office test -- --run packages/ui-office/src/__tests__/unit/useOffice3DViewState-fallback.test.tsx
```

Expected: FAIL because the fallback currently expects `payload.taskState === 'active'`.

- [ ] **Step 2: Fix the fallback against canonical payload shape**

Update `useOffice3DViewState.ts` so the fallback reads the real task-state payload shape instead of an ad hoc `{ taskState, assignedTo }` structure.

Keep this change small and local. This is a bug fix, not a semantics framework.

- [ ] **Step 3: Add optional debug access to the generated pack**

Update `OffisimRuntimeProvider.tsx` to expose the latest context pack in runtime state for verification and debugging only. Do not build new UI around it in this tranche.

- [ ] **Step 4: Run verification**

Run:

```bash
pnpm --filter @offisim/ui-office test -- --run packages/ui-office/src/__tests__/unit/useOffice3DViewState-fallback.test.tsx
pnpm --filter @offisim/ui-office typecheck
pnpm --filter @offisim/web test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-office/src/components/scene/useOffice3DViewState.ts packages/ui-office/src/__tests__/unit/useOffice3DViewState-fallback.test.tsx apps/web/src/runtime/OffisimRuntimeProvider.tsx
git commit -m "fix: align scene fallback with canonical task payloads"
```

## Chunk 5: Measure Proof of Value

### Task 5: Verify the pack improves reasoning before widening scope

**Files:**
- Modify as needed based on failures from previous chunks
- Optional docs note only after code proves useful

- [ ] **Step 1: Run the focused package suite**

Run:

```bash
pnpm --filter @offisim/shared-types typecheck
pnpm --filter @offisim/core test
pnpm --filter @offisim/core typecheck
pnpm --filter @offisim/ui-office test
pnpm --filter @offisim/ui-office typecheck
pnpm --filter @offisim/web test
pnpm --filter @offisim/web typecheck
```

Expected: PASS.

- [ ] **Step 2: Manual runtime checks**

Verify these flows:

1. normal task dispatch
2. permission request waiting for approval
3. paused or resumable execution path
4. meeting resume path if available in the runtime

For each flow, inspect the generated context pack and confirm it reflects:

- current execution status
- pending human interaction
- current/open task work
- recent node outcomes
- a sensible deterministic `recommendedFocus`

- [ ] **Step 3: Decide whether to widen**

Only widen into richer collaboration semantics or scene-level semantic contracts if the V1 pack reveals a real remaining gap, for example:

- agent still misses handoff ownership
- agent still cannot distinguish blocked vs approval-waiting cleanly
- scene and agent context still diverge in a measurable way

If no such gap appears, stop here. This tranche succeeds by proving value with minimal surface area.

## Risks and Guardrails

- Do not add a second middleware with a separate context budget.
- Do not query broad event or history tables on every LLM call.
- Do not invent static action catalogs that can drift from live runtime capabilities.
- Do not refactor broad UI surfaces until the context pack itself proves useful.
- Do not convert a concrete bug fix into a generic semantics framework unless another concrete failure appears.

## Definition of Done

This feature is complete when all of the following are true:

- each LLM call can receive one bounded structured runtime context block in the existing node-context path
- the block is derived from current execution state, pending interaction state, task-run state, and recent node summaries
- prompt budget is shared with existing node summaries instead of duplicated
- the known `task.state.changed` fallback drift is fixed
- targeted tests and typechecks pass
- the runtime team can inspect the generated pack and judge whether it improves internal agent reasoning enough to justify further semantics work

Plan complete and saved to `Docs/superpowers/plans/2026-04-05-offisim-internal-agent-semantics-layer.md`. Ready to execute?
