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

Thread ID generation changes from `thread-${companyId}` to `thread-${crypto.randomUUID()}` (consistent with existing `generateId()` pattern, no new dependency).

### Conversation Lifecycle

1. User sends message → if no active conversation exists, auto-create one
2. User clicks "+ New Conversation" → archive current, create new
3. Title = first 30 chars of user's first message (no LLM summarization)
4. Switching conversations loads that thread's latest checkpoint

### Message Pruning

Simple window limit as a safety net. Pruning happens **inside the graph** (e.g., as a pre-processing step in `stepDispatcherNode` or a dedicated pruning node), where the full `state.messages` array from the checkpoint is accessible — NOT in `OrchestrationService.execute()` which only receives the new user message.

```typescript
const MAX_CONTEXT_MESSAGES = 50;

// Inside graph node (has access to full state.messages from checkpoint)
if (state.messages.length > MAX_CONTEXT_MESSAGES) {
  return { messages: state.messages.slice(-MAX_CONTEXT_MESSAGES) };
}
```

No summarize-then-truncate. Direct truncation is sufficient for 1.0.

### Legacy Cleanup

Execute **during migration** (in `010_conversations.sql` itself), before any new-format threads exist. This ensures the `LIKE 'thread-%'` pattern only matches old-format IDs:

```sql
-- Part of 010_conversations.sql, runs before app creates new conversations
DELETE FROM checkpoints WHERE thread_id LIKE 'thread-%';
DELETE FROM writes WHERE thread_id LIKE 'thread-%';
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
| ThreadId generation (Tauri) | `apps/web/src/lib/tauri-runtime.ts` |
| ThreadId generation (Browser) | `apps/web/src/lib/browser-runtime.ts` |
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

Signal is passed via LangGraph's `config.configurable` (per-execution), NOT on RuntimeContext (per-company lifecycle). This avoids conflicts when multiple executions queue on the same company.

```typescript
// OrchestrationService passes signal through config
const stream = await this.graph.stream(fullInput, {
  streamMode: 'updates',
  configurable: { ...existingConfig, signal },
});

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
