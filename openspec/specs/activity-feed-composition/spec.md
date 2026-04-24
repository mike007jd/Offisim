# activity-feed-composition Specification

## Purpose
Defines the thin-composition contract for runtime activity feed assembly so the top-level hook stays small and event-family mapping lives in dedicated modules.
## Requirements
### Requirement: useRuntimeActivityFeed is a thin composition hook

`packages/ui-office/src/runtime/use-runtime-activity-feed.ts` SHALL contain no more than 180 non-blank, non-comment lines and SHALL only: (a) accept `opts?: { capacity?: number }`, (b) call `useActivityRingBuffer(opts)`, (c) in a single `useEffect` assemble the 13 mapper subscribers and return an aggregated cleanup, (d) return `{ entries, clear }`. Inline `eventBus.on(...)` subscriptions or event-to-entry mapping logic SHALL NOT live in this file.

#### Scenario: File size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/runtime/use-runtime-activity-feed.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 180

#### Scenario: No inline event subscriptions
- **WHEN** grepping `use-runtime-activity-feed.ts` for `eventBus\.on\(`
- **THEN** zero matches exist — all `.on(` subscriptions live in `runtime/activity-feed/mappers/*`

### Requirement: Activity ring buffer is a standalone hook

`packages/ui-office/src/runtime/activity-feed/useActivityRingBuffer.ts` SHALL export a hook `useActivityRingBuffer(opts?: { capacity?: number })` returning `{ entries, push, clear }`. The hook SHALL enforce FIFO truncation to `capacity` (default 200). It SHALL NOT subscribe to the event bus.

#### Scenario: Single owner of ring buffer logic
- **WHEN** grepping `packages/ui-office/src` for `useState<RuntimeActivityEntry\[\]>` declarations
- **THEN** exactly one match exists, inside `useActivityRingBuffer.ts`

#### Scenario: FIFO capacity enforcement
- **WHEN** `push` is called more times than `capacity`
- **THEN** oldest entries are dropped; `entries.length` never exceeds `capacity`

### Requirement: Activity mappers are one-event-family-per-file

The event-to-entry mapping SHALL be split into one module per event family in `packages/ui-office/src/runtime/activity-feed/mappers/`:

- `task-mappers.ts` — `task.assignment.*` / `task.state.*` / `task.subtask.*`
- `graph-mappers.ts` — `graph.node.*`
- `llm-mappers.ts` — `llm.call.*` / `llm.stream.chunk` (filtered)
- `interaction-mappers.ts` — `interaction.*`
- `handoff-mappers.ts` — `handoff.*`
- `memory-mappers.ts` — `memory.*`
- `deliverable-mappers.ts` — `deliverable.created`
- `workspace-mappers.ts` — `workspace.staleness.detected` / `git.auto.committed` / `knowledge.index.completed`
- `conversation-budget-mappers.ts` — `conversation.synopsis.*` / `conversation.compact.*`
- `execution-mappers.ts` — `execution.resumed` / `error.occurred`
- `plan-mappers.ts` — `plan.created` / `plan.step.completed`
- `tool-mappers.ts` — `tool.execution.telemetry` / `mcp.tool.called`
- `cost-mappers.ts` — `session.cost.updated` / `hr.recommendation`

Each file SHALL export exactly one factory of signature `subscribeXMappers(eventBus, sink: { push: (entry) => void }): () => void` returning a single aggregated unsubscribe. No mapper file SHALL import another mapper file.

#### Scenario: One file per mapper family
- **WHEN** listing `packages/ui-office/src/runtime/activity-feed/mappers/*.ts`
- **THEN** exactly these 13 files exist

#### Scenario: No cross-mapper imports
- **WHEN** grepping `mappers/*.ts` for `from '\\./(task|graph|llm|interaction|handoff|memory|deliverable|workspace|conversation-budget|execution|plan|tool|cost)-mappers'`
- **THEN** zero matches exist

#### Scenario: Mapper returns aggregated unsubscribe
- **WHEN** the barrel calls `const unsub = subscribeTaskMappers(eventBus, buffer)`
- **THEN** `unsub` is a zero-argument function that invokes every underlying `.on(...)` unsubscribe when called

### Requirement: Activity feed consumer API is unchanged

`useRuntimeActivityFeed(opts?: { capacity?: number })` SHALL retain its current signature and return shape `{ entries: RuntimeActivityEntry[], clear: () => void }` (or equivalent pre-refactor contract). Consumer components (`ActivityLogPage`, `ActivityRail`, etc.) SHALL NOT need modification.

#### Scenario: Consumer imports unchanged
- **WHEN** comparing `grep -rn "useRuntimeActivityFeed\(" apps packages` pre-change vs post-change
- **THEN** every call site is byte-identical

### Requirement: Observable activity feed behavior is unchanged after refactor

For identical event streams, the resulting `entries` list (order, tone, title, detail, timestamps) SHALL be byte-identical before and after the refactor.

#### Scenario: Full task run entry sequence
- **WHEN** running a task that emits `graph.node.entered(manager)` → `plan.created` → `task.assignment.dispatched` → `tool.execution.telemetry(started/completed)` → `deliverable.created` → `graph.node.entered(boss_summary)` → `llm.call.completed`
- **THEN** `entries` contains entries for each event in the same order, with the same tone / title / detail as pre-refactor
