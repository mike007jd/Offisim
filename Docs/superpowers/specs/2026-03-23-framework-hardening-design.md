# Framework Hardening — Design Spec

**Date:** 2026-03-23
**Priority order:** DB Transactions → ThreadId → AbortController → Editor Deletion
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

Add `withTransaction<T>(fn: () => T): T` to `RuntimeRepositories`:

```typescript
// repositories.ts
export interface RuntimeRepositories {
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

- No nested transactions / savepoints (SQLite support is limited)
- No EventBus + DB distributed transactions (EventBus is fire-and-forget)
- No transaction wrapping for single-UPDATE operations (e.g., taskRun status)

---

## 2. ThreadId Redesign + Conversation Model

### Problem

`threadId = 'thread-${companyId}'` — one thread per company. All conversation messages accumulate in a single checkpoint chain, growing without bound. LLM input cost scales linearly with history length.

### Decision

**Per-conversation threads** (like Claude/ChatGPT session model). Each conversation gets its own thread. Users can create new conversations and switch between them.

### Data Model

New migration `010_conversations.sql`:

```sql
CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id),
  thread_id TEXT NOT NULL UNIQUE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conversations_company
  ON conversations(company_id, updated_at DESC);
```

Thread ID generation changes from `thread-${companyId}` to `thread-${nanoid()}`.

### Conversation Lifecycle

1. User sends message → if no active conversation exists, auto-create one
2. User clicks "+ New Conversation" → archive current, create new
3. Title = first 30 chars of user's first message (no LLM summarization)
4. Switching conversations loads that thread's latest checkpoint

### Message Pruning

Simple window limit as a safety net:

```typescript
const MAX_CONTEXT_MESSAGES = 50;

// In OrchestrationService.execute() entry
if (state.messages.length > MAX_CONTEXT_MESSAGES) {
  state.messages = state.messages.slice(-MAX_CONTEXT_MESSAGES);
}
```

No summarize-then-truncate. Direct truncation is sufficient for 1.0.

### Legacy Cleanup

On first launch after migration, delete old-format checkpoints:

```sql
DELETE FROM checkpoints WHERE thread_id LIKE 'thread-%'
  AND thread_id NOT IN (SELECT thread_id FROM conversations);
```

### UI Changes (Minimal)

- Conversation list in sidebar or ChatBox header (company-scoped, ordered by updated_at DESC)
- "+ New Conversation" button
- Active conversation highlighted
- No search, no grouping, no deletion for 1.0

### Files Changed

| Change | File |
|--------|------|
| New migration | `packages/db-local/src/migrations/010_conversations.sql` |
| Schema | `packages/db-local/src/schema.ts` |
| Repository interface | `packages/core/src/runtime/repositories.ts` |
| Drizzle impl | `packages/core/src/runtime/drizzle-repositories.ts` |
| Memory impl | `packages/core/src/runtime/memory-repositories.ts` |
| ThreadId generation | `apps/web/src/lib/tauri-runtime.ts` |
| Pruning | `packages/core/src/services/orchestration-service.ts` |
| UI | `packages/ui-office/` — conversation list, new conversation button |

### Not Doing

- No cross-conversation memory system (memory_entries exists but stays dormant)
- No LLM-generated titles
- No auto-cleanup of archived conversations
- No changes to `graph_checkpoints` custom table (confirmed unused)

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

**Per-message AbortController:**

```typescript
// sendMessage handler
const messageAbort = new AbortController();
setCurrentAbort(messageAbort);
await orch.execute(input, messageAbort.signal);
```

**OrchestrationService:**

```typescript
async execute(input, signal?: AbortSignal): Promise<AicsGraphState> {
  const stream = await this.graph.stream(fullInput, { streamMode: 'updates' });
  for await (const update of stream) {
    if (signal?.aborted) break;
    // ... existing merge logic
  }
  return lastState;
}
```

**Node-level signal passthrough:**

Nodes read signal from `runtimeCtx` (set per-execution, not globally):

```typescript
const response = await gateway.chat({
  messages, model,
  signal,  // from execute parameter, threaded through
});
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
  await orch.execute(input, signal);
} catch (e) {
  if (e instanceof DOMException && e.name === 'AbortError') {
    logger.info('Execution cancelled');
    return lastState;
  }
  throw e;
}
```

### UI

ChatBox send area: while executing, replace send button with a "Stop" button (square icon). Click aborts the current execution.

### Not Doing

- No abort on company switch (multi-company concurrency is by design)
- No abort on conversation switch (background execution continues, result saved to thread)
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

### App.tsx

- Remove `view === 'office-editor'` branch and lazy import of `OfficeEditorOverlay`
- Remove `'office-editor'` from view type union
- All "edit office" entry points redirect to `view = 'studio'`

### Office3DView

Remove EditorProvider integration. 3D scene becomes a pure viewer — shows employees, zones, placed prefabs, but no in-place editing.

### Package Exports

Remove `office-editor` subpath export from `packages/ui-office/package.json`.

### Not Doing

- No compact/embedded mode for Studio (future need)
- No localStorage data migration (DB prefabInstances is the source of truth)
- No renaming of StudioState/StudioPage
