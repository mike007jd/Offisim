# Framework Hardening — Design Spec

**Date:** 2026-03-23
**Priority order:** DB Transactions → Directive Model → AbortController → Editor Deletion
**Scope:** 4 architectural items, all design + all implementation in one session

---

## 1. DB Transaction Safety

### Problem

Zero `db.transaction()` calls across the entire codebase. 8 multi-step write operations have no atomicity guarantee — a failure midway leaves orphaned rows.

### Decision

**Mixed-layer approach:**
- **Repo layer** wraps simple 2-step operations within a single repository
- **Service layer** wraps complex cross-repository operations

### Interface

Add `withTransaction` to `RuntimeRepositories`.

Note: better-sqlite3 is synchronous, but repo methods are declared async. The Drizzle implementation uses `db.transaction()` which is synchronous — all repo calls inside the callback execute synchronously under the hood (better-sqlite3 `.run()` is sync). The async interface is preserved for memory-repo compatibility.

Also add to `InstallRepositories` (used by `materializer.ts`), since it's a separate interface from `RuntimeRepositories`.

```typescript
// repositories.ts
export interface RuntimeRepositories {
  // ... existing repos
  withTransaction<T>(fn: () => T): T;
}

// install-core/src/types.ts
export interface InstallRepositories {
  // ... existing repos
  withTransaction<T>(fn: () => T): T;
}

// drizzle-repositories.ts
withTransaction<T>(fn: () => T): T {
  return this.db.transaction(() => fn())();
}

// memory-repositories.ts
withTransaction<T>(fn: () => T): T {
  return fn(); // no-op, single-threaded
}
```

### Repo-Layer Targets

| Operation | File | Fix |
|-----------|------|-----|
| `officeLayouts.setActive()` | `drizzle-repositories.ts:933` | Wrap 2 UPDATEs in `db.transaction()` |
| `modelCostRates.upsert()` | `drizzle-repositories.ts:665` | Wrap check-then-act in `db.transaction()` |

### Service-Layer Targets

| Operation | File | Fix |
|-----------|------|-----|
| Install materialize | `install-core/materializer.ts` | `repos.withTransaction(() => { create pkg + assets + employees + bindings })` |
| Employee version create | `core/employee-version-service.ts` | `repos.withTransaction(() => { update employee + insert version })` |

### Not Doing

- No nested transactions / savepoints (better-sqlite3 `db.transaction()` API does not expose savepoints)
- No EventBus + DB distributed transactions (EventBus is fire-and-forget)
- No transaction wrapping for single-UPDATE operations (e.g., taskRun status)

---

## 2. Directive Model (replaces ThreadId + Conversation)

### Problem

`threadId = 'thread-${companyId}'` — one thread per company. All messages accumulate in a single checkpoint chain, growing without bound. LLM input cost scales linearly with history length.

### Decision

**Per-directive threads.** Each boss directive gets its own thread for message isolation. Company state (employees, tasks, memory) remains in DB and is shared across all directives.

Product concept: the boss issues "directives" (指令), not "conversations". The PM dispatches tasks from the directive to employees. The office scene shows employees actively working on their assigned tasks. Users see an active company, not a list of chat sessions.

### State Separation

```
Company (persistent, shared)         Directive (isolated, per-thread)
─────────────────────────            ────────────────────────────────
employees, skills, memory  ←── DB    messages, plan, currentStep ←── LangGraph checkpoint
tasks, taskRuns            ←── DB    execution progress          ←── LangGraph checkpoint
office layout, prefabs     ←── DB
```

Graph nodes read company state from `repos.*` (DB), not from checkpoint. Graph nodes write results to both DB (persistent effects) and checkpoint (message continuity). This means: viewing an old directive shows its historical message log, but employee states always reflect the current company reality.

### Data Model

No new table. Extend `graph_threads` with a `title` column:

```sql
-- Migration 010_directive_model.sql
ALTER TABLE graph_threads ADD COLUMN title TEXT;
```

A "directive" is a `graph_threads` row with `entry_mode = 'boss_chat'` (or a new `'boss_directive'` value). Thread ID generation changes from `thread-${companyId}` to `thread-${crypto.randomUUID()}`.

### Directive Lifecycle

1. User sends message → if no active directive exists for this company, auto-create one (new graph_threads row + new LangGraph thread)
2. User clicks "+ New Directive" → current directive marked `status = 'completed'`, new one created
3. Title = first 30 chars of user's first message
4. Switching to active directive reloads its thread's latest checkpoint
5. Switching to completed directive shows read-only message history

### Message Pruning

Pruning happens at the **LLM call layer**, not in graph state. Graph state retains full message chain so nodes like `boss-summary-node` can scan all messages.

```typescript
// In LLM gateway layer, before sending to provider
const contextMessages = messages.length > MAX_CONTEXT_MESSAGES
  ? messages.slice(-MAX_CONTEXT_MESSAGES)
  : messages;
```

`MAX_CONTEXT_MESSAGES = 50`. This only affects what the LLM sees — graph state and checkpoint are unaffected.

### Legacy Cleanup

Execute **during migration** (in `010_directive_model.sql`), before any new-format threads exist:

```sql
DELETE FROM checkpoints WHERE thread_id LIKE 'thread-%';
DELETE FROM writes WHERE thread_id LIKE 'thread-%';
```

### OrchestrationService Lifecycle Change

OrchestrationService is promoted from per-call to **RuntimeBundle member** (long-lived). This makes `threadLocks` actually effective and provides a natural place to store the current execution's AbortController.

```typescript
// RuntimeBundle
interface RuntimeBundle {
  graph: CompiledStateGraph;
  runtimeCtx: RuntimeContext;
  orchestration: OrchestrationService;  // NEW: long-lived
}
```

`threadLocks` key changes from `threadId` to `companyId` — 1.0 serializes all executions per company (no concurrent directives).

### UI Changes (Minimal)

- Directive list in ChatBox header or sidebar (company-scoped, ordered by updated_at DESC)
- Active directive: shows messages + accepts input
- Completed directive: shows messages read-only
- "+ New Directive" button
- No search, no grouping, no deletion for 1.0

### Files Changed

| Change | File |
|--------|------|
| New migration | `packages/db-local/src/migrations/010_directive_model.sql` |
| Schema | `packages/db-local/src/schema.ts` — add title column to graphThreads |
| ThreadId generation (Tauri) | `apps/web/src/lib/tauri-runtime.ts` |
| ThreadId generation (Browser) | `apps/web/src/lib/browser-runtime.ts` |
| Orch lifecycle | `apps/web/src/runtime/AicsRuntimeProvider.tsx` — orch as RuntimeBundle member |
| Pruning | `packages/core/src/llm/gateway.ts` — truncate before LLM call |
| UI | `packages/ui-office/` — directive list, new directive button |

### Not Doing

- No concurrent directives per company (1.0 is serial; parallel PM dispatch + employee cloning is 1.1)
- No cross-directive memory system (memory_entries exists but stays dormant)
- No LLM-generated titles
- No auto-cleanup of completed directives
- No new `conversations` table (graph_threads is sufficient)

### 1.1 Vision (not implemented now)

Multiple active directives per company → PM dispatches tasks across directives → employees visually "split" working on different tasks → office scene shows a busy, multi-tasking company. threadLocks changes from companyId to threadId to allow concurrency.

---

## 3. AbortController (Manual Stop)

### Problem

No way to cancel a running LLM call. `LlmRequest.signal` is defined and SDK adapters pass it through, but nobody creates or propagates the signal.

### Decision

**Manual stop button only.** Company switching does NOT abort — multiple companies run concurrently by design.

### Signal Flow

```
User clicks "Stop" button
  → AbortController.abort()
  → signal passed to OrchestrationService.execute(input, signal)
  → for-await loop checks signal.aborted after each node
  → signal passed to LlmRequest in each node
  → SDK adapter aborts HTTP request
```

### Implementation

**Per-message AbortController** stored on the long-lived OrchestrationService:

```typescript
// OrchestrationService (long-lived, on RuntimeBundle)
private currentAbort: AbortController | null = null;

async execute(input): Promise<AicsGraphState> {
  this.currentAbort = new AbortController();
  const signal = this.currentAbort.signal;
  try {
    // ... execute with signal
  } finally {
    this.currentAbort = null;
  }
}

abort(): void {
  this.currentAbort?.abort();
}
```

**OrchestrationService stream loop:**

```typescript
async execute(input): Promise<AicsGraphState> {
  const stream = await this.graph.stream(fullInput, {
    streamMode: 'updates',
    configurable: { ...existingConfig, signal: this.currentAbort!.signal },
  });
  for await (const update of stream) {
    if (this.currentAbort?.signal.aborted) break;
    // ... existing merge logic
  }
  return lastState;
}
```

**Node-level signal passthrough:**

Signal is passed via LangGraph's `config.configurable` (per-execution), NOT on RuntimeContext (per-company lifecycle).

```typescript
// Node reads signal from config
const signal = config.configurable?.signal as AbortSignal | undefined;
const response = await gateway.chat({ messages, model, signal });
```

**withRetry fix:**

```typescript
async function withRetry<T>(fn, signal?): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try { return await fn(); }
    catch (e) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // ... existing retry logic
    }
  }
}
```

**Error handling:**

```typescript
try {
  await orch.execute(input);
} catch (e) {
  if (e instanceof DOMException && e.name === 'AbortError') {
    logger.info('Execution cancelled');
    return lastState;
  }
  throw e;
}
```

### UI

ChatBox send area: while executing, replace send button with a "Stop" button (square icon). Click calls `orch.abort()`.

### Not Doing

- No abort on company switch (multi-company concurrency is by design)
- No abort on directive switch (background execution continues, result saved to thread)
- No graceful node shutdown (break from for-await is sufficient)
- No AbortSignal.reason differentiation

---

## 4. Delete EditorMode, StudioPage Becomes Sole Editor

### Problem

Two parallel editing systems: EditorMode (React Context + localStorage, 8 files) and StudioState (Zustand + DB, 10 files). Both manage prefab placement with different architectures, interfaces, and persistence strategies. They never run simultaneously but duplicate logic.

### Decision

**Delete EditorMode entirely.** StudioPage is the only editor.

### Deletion List

Remove `packages/ui-office/src/components/scene/editor/` (entire directory):

- `EditorMode.tsx`
- `EditorToolbar.tsx`
- `PrefabPalette.tsx`
- `GhostPrefab.tsx`
- `PropertiesPanel.tsx`
- `EditorGrid.tsx`
- `EditorPlacedPrefabs.tsx`
- `SelectionOutline.tsx`
- `index.ts`

### Additional Files to Clean Up

- `OfficeEditorOverlay.tsx` — wrapper component outside the editor/ directory, also delete
- `useCompanyEditor.ts` — hook referencing office-editor, delete or refactor
- `CompanyEditor.tsx` — has `onOpenOfficeEditor` prop, change to navigate to Studio
- `index.ts` re-exports — remove office-editor re-exports from ui-office barrel

### App.tsx

- Remove `view === 'office-editor'` branch and lazy import of `OfficeEditorOverlay`
- Remove `'office-editor'` from view type union
- Change `onOpenOfficeEditor` callback to `onOpenStudio` (or equivalent), pointing to `view = 'studio'`
- All "edit office" entry points redirect to `view = 'studio'`

### Office3DView

Remove EditorProvider integration. 3D scene becomes a pure viewer — shows employees, zones, placed prefabs, but no in-place editing.

### Package Exports

Remove `office-editor` subpath export from `packages/ui-office/package.json`.

### Not Doing

- No compact/embedded mode for Studio (future need)
- No localStorage data migration (DB prefabInstances is the source of truth)
- No renaming of StudioState/StudioPage
