# Framework Hardening + Project Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the core runtime (transactions, abort, pruning), introduce the Project entity, enable cross-project parallel execution, and add auto-resume + project UI.

**Architecture:** 11 tasks in 4 waves. Wave 1 (6 tasks) is fully parallel — no shared files. Wave 2 (3 tasks) depends on Wave 1 completions. Wave 3-4 are serial. Each task is a single commit.

**Tech Stack:** TypeScript, Drizzle ORM + better-sqlite3, LangGraph, React 19, Zustand, Tailwind

**Spec:** `Docs/superpowers/specs/2026-03-23-framework-hardening-design.md`

**Key audit findings that deviate from spec:**
- Spec §1 signature `withTransaction<T>(fn: () => T): T` is wrong — repo methods are async wrappers around sync calls. We fix repo-level ops internally (no generic interface). Service-level ops use `db.transaction()` directly via a `transact` adapter. This is an intentional deviation: better-sqlite3's sync transactions can't wrap async repo methods generically, so we fix at each call site.
- Spec §2 proposes intra-project DAG parallel dispatch — deferred (graph topology has single `employee` node, no Send/fan-out). We do cross-project parallelism only. PlanStep gains `phase`/`dependsOnSteps` fields in the data model for forward compat, but step_dispatcher stays sequential.
- Spec §4 incorrectly says to delete `OfficeEditorOverlay.tsx` and `useCompanyEditor.ts` — audit confirms these are independent of EditorMode, keep them.
- `LlmRequest.signal` already exists (gateway.ts:34). AbortController work is threading signal from Orch → config → node call sites, not adding new signal support to the gateway.
- Employee-node already prunes to 20 messages (employee-node.ts:510-515). Gateway-level 50-message pruning is an additive safety net.
- `direct_chat` entry_mode exists in state.ts but migration 003 CHECK constraint rejects it. Fix in migration 010 via SQLite table recreation pattern.
- Migration 007 already has `UNIQUE INDEX idx_cost_rates_provider_model ON (provider, model_pattern, effective_from)` — so `onConflictDoUpdate` is safe for the upsert fix.

---

## Dependency Graph

```
Wave 1 — all independent, run 6 agents in parallel
  Task 1: DB Transaction (repo level)       → drizzle-repositories.ts
  Task 2: Delete EditorMode                 → ui-office scene/editor/, Office3DView.tsx
  Task 3: Message Pruning (gateway level)   → core/llm/
  Task 4: OrchestrationService Lifecycle    → core/services/, web/runtime/
  Task 5: Project Data Layer                → db-local, core/runtime/repos, shared-types
  Task 6: PlanStep Extensions + PM Prompt   → core/graph/state.ts, core/agents/pm-planner

Wave 2 — depends on Wave 1
  Task 7: AbortController                   → depends on Task 4 (Orch lifecycle)
  Task 8: DB Transaction (service level)    → depends on Task 1 pattern
  Task 9: Project-Scoped Execution          → depends on Task 4 + 5

Wave 3 — depends on Wave 2
  Task 10: Auto-Resume                      → depends on Task 4 + 5 + 9

Wave 4 — depends on all above
  Task 11: Project UI                       → depends on Task 5 + 9 + 10
```

---

## Task 1: DB Transaction — Repo Level

**Files:**
- Modify: `packages/core/src/runtime/drizzle-repositories.ts:933-944` (setActive)
- Modify: `packages/core/src/runtime/drizzle-repositories.ts:665-690` (upsert)
- Create: `packages/core/src/__tests__/unit/drizzle-transaction-safety.test.ts`

- [ ] **Step 1: Write test for setActive atomicity**

```typescript
// packages/core/src/__tests__/unit/drizzle-transaction-safety.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
// Use the existing test setup pattern from the codebase
// Create drizzle repos with test DB, seed two layouts, verify setActive is atomic

describe('DrizzleRepositories transaction safety', () => {
  describe('officeLayouts.setActive', () => {
    it('should atomically switch active layout', async () => {
      // Seed: layout-a (active), layout-b (inactive)
      // Act: setActive(companyId, 'layout-b')
      // Assert: layout-a.is_active === 0, layout-b.is_active === 1
      // This test passes even without transaction — it tests the happy path
    });

    it('should leave exactly one active layout even if layoutId is invalid', async () => {
      // Seed: layout-a (active)
      // Act: setActive(companyId, 'nonexistent-layout')
      // Assert: layout-a should STILL be active (transaction rolled back)
      // This test FAILS without transaction wrapping
    });
  });
});
```

- [ ] **Step 2: Run test, verify the invalid-layoutId test fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/unit/drizzle-transaction-safety.test.ts`

- [ ] **Step 3: Fix setActive — wrap in db.transaction()**

```typescript
// drizzle-repositories.ts line 933-944, replace with:
async setActive(companyId, layoutId) {
  db.transaction(() => {
    db.update(schema.officeLayouts)
      .set({ is_active: 0, updated_at: now() })
      .where(eq(schema.officeLayouts.company_id, companyId))
      .run();
    db.update(schema.officeLayouts)
      .set({ is_active: 1, updated_at: now() })
      .where(eq(schema.officeLayouts.layout_id, layoutId))
      .run();
  })();
},
```

Note: `db.transaction(() => { ... })()` — better-sqlite3 returns a function, the trailing `()` executes it. All `.run()` calls inside share the same transaction. If the layoutId doesn't match any row, the second UPDATE is a no-op but doesn't throw — we need to add a check:

```typescript
async setActive(companyId, layoutId) {
  db.transaction(() => {
    db.update(schema.officeLayouts)
      .set({ is_active: 0, updated_at: now() })
      .where(eq(schema.officeLayouts.company_id, companyId))
      .run();
    const result = db.update(schema.officeLayouts)
      .set({ is_active: 1, updated_at: now() })
      .where(
        and(
          eq(schema.officeLayouts.layout_id, layoutId),
          eq(schema.officeLayouts.company_id, companyId),
        ),
      )
      .run();
    if (result.changes === 0) {
      throw new Error(`Layout ${layoutId} not found for company ${companyId}`);
    }
  })();
},
```

- [ ] **Step 4: Run test, verify both tests pass**

- [ ] **Step 5: Write test for upsert idempotency**

```typescript
describe('costRates.upsert', () => {
  it('should insert new rate', async () => { /* ... */ });
  it('should update existing rate on conflict', async () => {
    // Insert rate-a, then upsert with same (provider, model_pattern, effective_from) but different costs
    // Assert: only 1 row, costs updated
  });
});
```

- [ ] **Step 6: Fix upsert — use onConflictDoUpdate**

```typescript
// drizzle-repositories.ts line 665-690, replace with:
async upsert(rate: NewModelCostRate) {
  const ts = now();
  const row: ModelCostRateRow = {
    rate_id: rate.rate_id ?? generateId('mcr'),
    ...rate,
    created_at: ts,
  };
  const result = db
    .insert(schema.modelCostRates)
    .values(row)
    .onConflictDoUpdate({
      target: [
        schema.modelCostRates.provider,
        schema.modelCostRates.model_pattern,
        schema.modelCostRates.effective_from,
      ],
      set: {
        input_cost_per_mtok: rate.input_cost_per_mtok,
        output_cost_per_mtok: rate.output_cost_per_mtok,
        effective_until: rate.effective_until,
      },
    })
    .returning()
    .get();
  return result as ModelCostRateRow;
},
```

**Important:** Check if the `model_cost_rates` table has a UNIQUE constraint on `(provider, model_pattern, effective_from)`. If not, add it in migration 010 (Task 5 handles this). If the constraint already exists from migration 007, proceed. Look at `packages/db-local/src/migrations/007_model_cost_rates.sql` to verify.

- [ ] **Step 7: Run all tests, verify pass**

Run: `cd packages/core && pnpm vitest run`

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/runtime/drizzle-repositories.ts packages/core/src/__tests__/unit/drizzle-transaction-safety.test.ts
git commit -m "fix: wrap setActive in transaction, upsert with onConflictDoUpdate"
```

---

## Task 2: Delete EditorMode

**Files:**
- Delete: `packages/ui-office/src/components/scene/editor/` (9 files, 1418 lines)
- Modify: `packages/ui-office/src/components/scene/Office3DView.tsx` (remove ~30 lines of editor imports/renders)
- Modify: `apps/web/src/App.tsx` (redirect office-editor → studio)
- **DO NOT DELETE:** `OfficeEditorOverlay.tsx`, `useCompanyEditor.ts` (independent, still needed)

- [ ] **Step 1: Delete the editor directory**

```bash
rm -rf packages/ui-office/src/components/scene/editor/
```

- [ ] **Step 2: Clean Office3DView.tsx**

Remove these imports (around line 29-37):
```
EditorProvider, useEditorMaybe, EditorToolbar, PrefabPalette,
PropertiesPanel, GhostPrefab, EditorGrid, EditorPlacedPrefabs
```

Remove `EditorProvider` wrapper (around line 1221 and closing tag ~1245).

Remove editor component renders: `<EditorGrid />`, `<EditorPlacedPrefabs />`, `<GhostPrefab />`, `<EditorToolbar />`, `{isEditMode && <PrefabPalette />}`, `{isEditMode && <PropertiesPanel />}`.

Remove `useEditorMaybe()` hook call (~line 1296).

Remove `saveToRepo` callback (~line 1172) and `editorInitialPrefabs` state if it only serves EditorMode.

**Keep** all non-editor 3D rendering code intact.

- [ ] **Step 3: Update App.tsx — redirect office-editor to studio**

In App.tsx, find `view === 'office-editor'` routing. Two options:
- If OfficeEditorOverlay is still useful as-is: keep it
- If it should be replaced by studio: change the `onOpenOfficeEditor` callback to `setView('studio')`

Based on audit: OfficeEditorOverlay is a zone-layout editor (different from the in-scene editor). **Keep the view route** — only the `scene/editor/` code is deleted.

- [ ] **Step 4: Verify typecheck**

```bash
cd packages/ui-office && pnpm tsc --noEmit
```

- [ ] **Step 5: Build and verify**

```bash
pnpm --filter @aics/ui-office build
```

- [ ] **Step 6: Commit**

```bash
git add -A packages/ui-office/src/components/scene/editor/ packages/ui-office/src/components/scene/Office3DView.tsx
git commit -m "refactor: delete EditorMode (9 files, 1418 lines) — StudioPage is sole editor"
```

---

## Task 3: Message Pruning — Gateway Level

**Files:**
- Create: `packages/core/src/llm/prune-messages.ts`
- Modify: `packages/core/src/llm/recorded-call.ts` (apply pruning before LLM call)
- Create: `packages/core/src/__tests__/unit/prune-messages.test.ts`

**Context:** Employee-node already prunes to 20 messages at the conversation level. This adds a safety net at the LLM call layer (50 messages) to protect against any call site that builds large message arrays.

- [ ] **Step 1: Write pruning utility + tests**

```typescript
// packages/core/src/llm/prune-messages.ts
import type { LlmMessage } from './gateway.js';

const MAX_LLM_CONTEXT_MESSAGES = 50;

/**
 * Prune message array for LLM calls. Keeps:
 * - All system messages (always first)
 * - Last N non-system messages
 *
 * Applied at LLM call layer, not graph state — graph retains full history.
 */
export function pruneLlmMessages(
  messages: readonly LlmMessage[],
  max = MAX_LLM_CONTEXT_MESSAGES,
): readonly LlmMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  if (nonSystem.length <= max) return messages;
  return [...system, ...nonSystem.slice(-max)];
}
```

- [ ] **Step 2: Write tests**

```typescript
// packages/core/src/__tests__/unit/prune-messages.test.ts
import { describe, it, expect } from 'vitest';
import { pruneLlmMessages } from '../../llm/prune-messages.js';

describe('pruneLlmMessages', () => {
  it('should pass through short arrays unchanged', () => { /* 10 messages → 10 */ });
  it('should keep all system messages + last N non-system', () => {
    // 2 system + 60 user/assistant → 2 system + 50 non-system = 52
  });
  it('should preserve message order', () => { /* verify ordering */ });
});
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Apply pruning in recordedLlmCall**

In `packages/core/src/llm/recorded-call.ts`, before calling `ctx.llmGateway.chat(request)`:

```typescript
import { pruneLlmMessages } from './prune-messages.js';

// Inside recordedLlmCall, before the gateway call:
const prunedRequest = {
  ...request,
  messages: pruneLlmMessages(request.messages),
};
const response = await ctx.llmGateway.chat(prunedRequest);
```

Do the same for `recordedLlmStreamCall` if it exists.

- [ ] **Step 5: Run full core tests**

```bash
cd packages/core && pnpm vitest run
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/llm/prune-messages.ts packages/core/src/__tests__/unit/prune-messages.test.ts packages/core/src/llm/recorded-call.ts
git commit -m "feat: add gateway-level message pruning (MAX=50, safety net above employee-node's 20)"
```

---

## Task 4: OrchestrationService Lifecycle

**Files:**
- Modify: `packages/core/src/services/orchestration-service.ts` (add threadId param to execute, add currentAborts map)
- Modify: `apps/web/src/lib/browser-runtime.ts` (add orch to RuntimeBundle)
- Modify: `apps/web/src/lib/tauri-runtime.ts` (same)
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx` (use stored orch, not new per-call)
- Modify: `apps/web/src/runtime/initialize-runtime.ts` (pass through)
- Create: `packages/core/src/__tests__/unit/orchestration-lifecycle.test.ts`

**Key change:** OrchestrationService moves from "created per sendMessage call" to "stored in RuntimeBundle, reused across calls." This makes threadLocks effective and enables cross-project parallelism.

- [ ] **Step 1: Write lifecycle test**

```typescript
// packages/core/src/__tests__/unit/orchestration-lifecycle.test.ts
describe('OrchestrationService lifecycle', () => {
  it('should serialize concurrent calls on the same threadId', async () => {
    // Create ONE orch instance
    // Call execute() twice with same threadId concurrently
    // Verify they execute sequentially (second waits for first)
  });

  it('should allow concurrent calls on different threadIds', async () => {
    // Create ONE orch instance
    // Call execute() with threadId-A and threadId-B concurrently
    // Verify they can overlap
  });
});
```

- [ ] **Step 2: Modify OrchestrationService — accept threadId per-call**

```typescript
// orchestration-service.ts — change execute() signature:
async execute(input: {
  entryMode: AicsGraphState['entryMode'];
  messages: BaseMessage[];
  targetEmployeeId?: string | null;
  meetingId?: string | null;
  meetingInterrupt?: MeetingInterrupt | null;
  threadId?: string;  // NEW: optional override, defaults to runtimeCtx.threadId
}): Promise<AicsGraphState> {
  const threadId = input.threadId ?? this.runtimeCtx.threadId;
  // ... rest uses this threadId instead of this.runtimeCtx.threadId
```

And in `_executeInner`, pass the threadId explicitly:

```typescript
private async _executeInner(input: {
  /* ... existing fields ... */
  threadId?: string;
}): Promise<AicsGraphState> {
  const threadId = input.threadId ?? this.runtimeCtx.threadId;
  const fullInput = {
    threadId,
    companyId: this.runtimeCtx.companyId,
    // ...
  };
  const config = {
    configurable: {
      thread_id: threadId,
      runtimeCtx: this.runtimeCtx,
    },
  };
  // ... rest unchanged
```

- [ ] **Step 3: Add currentAborts map (prep for Task 7)**

```typescript
// orchestration-service.ts — add after threadQueueDepth:
private readonly currentAborts = new Map<string, AbortController>();

// In execute(), before the try block:
// (Will be wired in Task 7 — just the map for now)
```

- [ ] **Step 4: Update RuntimeBundle type**

```typescript
// browser-runtime.ts — add orch to RuntimeBundle:
export type RuntimeBundle = {
  eventBus: InMemoryEventBus;
  graph: ReturnType<typeof buildAicsGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
  orch: import('@aics/core/dist/services/orchestration-service.js').OrchestrationService;
  installService: InstallService | null;
  mcpToolExecutor: McpToolExecutor | null;
  repos: RuntimeRepositories;
};
```

**Important:** OrchestrationService is currently dynamically imported to save bundle. We need to keep the dynamic import for creation, but store the instance. The type reference above uses the import type syntax to avoid bundle impact.

Keep the dynamic import pattern but store the instance. `createBrowserRuntime` is already dynamically imported by AicsRuntimeProvider, so adding OrchestrationService here doesn't bloat the initial bundle.

```typescript
// browser-runtime.ts — at the end of createBrowserRuntime(), BEFORE the return statement:
// (insert after line 184, where installService is created)
const { OrchestrationService } = await import(
  '@aics/core/dist/services/orchestration-service.js'
);
const orch = new OrchestrationService(graph, runtimeCtx);

// Update the return to include orch:
return { eventBus, graph, runtimeCtx, orch, installService, mcpToolExecutor, repos };
```

For the RuntimeBundle type (browser-runtime.ts line 100-107), use `import()` type to avoid static import:
```typescript
export type RuntimeBundle = {
  eventBus: InMemoryEventBus;
  graph: ReturnType<typeof buildAicsGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
  orch: InstanceType<
    typeof import('@aics/core/dist/services/orchestration-service.js').OrchestrationService
  > | null;
  installService: InstallService | null;
  mcpToolExecutor: McpToolExecutor | null;
  repos: RuntimeRepositories;
};
```

If the `import()` type doesn't resolve, use a simpler approach:
```typescript
orch: { execute: (...args: unknown[]) => Promise<unknown>; abortExecution: (threadId: string) => void } | null;
```

- [ ] **Step 5: Do the same for tauri-runtime.ts**

Same pattern — create OrchestrationService in createTauriRuntime and add to bundle.

- [ ] **Step 6: Update AicsRuntimeProvider — use stored orch**

```typescript
// AicsRuntimeProvider.tsx lines 128-141, change from:
const [{ OrchestrationService }, { HumanMessage }] = await Promise.all([...]);
const orch = new OrchestrationService(runtime.graph, runtime.runtimeCtx);
const result = await orch.execute({...});

// To:
const { HumanMessage } = await import('@langchain/core/messages');
const result = await runtime.orch.execute({
  entryMode,
  messages: [new HumanMessage(text)],
  targetEmployeeId: options?.targetEmployeeId ?? null,
});
```

This means OrchestrationService is created once in createBrowserRuntime/createTauriRuntime, and reused for every sendMessage call. ThreadLocks now actually work.

- [ ] **Step 7: Handle repos-only mode**

In `createBrowserRuntimeReposOnly` and `createTauriRuntimeReposOnly`, set `orch: null` since there's no graph. Update the RuntimeBundle type to `orch: OrchestrationService | null`.

In AicsRuntimeProvider, add null check before calling `runtime.orch.execute()`.

- [ ] **Step 8: Run tests**

```bash
cd packages/core && pnpm vitest run
cd apps/web && pnpm tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git commit -m "refactor: make OrchestrationService long-lived in RuntimeBundle — threadLocks now effective"
```

---

## Task 5: Project Data Layer

**Files:**
- Create: `packages/db-local/src/migrations/010_projects.sql`
- Modify: `packages/db-local/src/schema.ts` (projects table, graph_threads.project_id)
- Modify: `packages/core/src/runtime/repositories.ts` (ProjectRepository interface)
- Modify: `packages/core/src/runtime/drizzle-repositories.ts` (ProjectRepository impl)
- Modify: `packages/core/src/runtime/memory-repositories.ts` (ProjectRepository impl)
- Create: `packages/shared-types/src/project.ts` (exported Project types)
- Modify: `packages/shared-types/src/index.ts` (re-export)
- Create: `packages/core/src/__tests__/unit/project-repository.test.ts`

- [ ] **Step 1: Write migration 010**

```sql
-- packages/db-local/src/migrations/010_projects.sql

-- ────────────────────────────────────────────────────────
-- Fix: direct_chat entry_mode missing from 003 CHECK constraint.
-- SQLite cannot ALTER CHECK constraints, so recreate the table.
-- ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS graph_threads_new (
  thread_id    TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  entry_mode   TEXT NOT NULL CHECK (entry_mode IN (
    'boss_chat', 'meeting', 'install_flow', 'background_sync', 'direct_chat'
  )),
  root_task_id TEXT,
  status       TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'blocked', 'paused', 'completed', 'failed', 'cancelled'
  )),
  project_id   TEXT,  -- FK added below after projects table exists
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
INSERT INTO graph_threads_new (thread_id, company_id, entry_mode, root_task_id, status, created_at, updated_at)
  SELECT thread_id, company_id, entry_mode, root_task_id, status, created_at, updated_at
  FROM graph_threads;
DROP TABLE graph_threads;
ALTER TABLE graph_threads_new RENAME TO graph_threads;
CREATE INDEX IF NOT EXISTS idx_graph_threads_company ON graph_threads(company_id, created_at);

-- ────────────────────────────────────────────────────────
-- Projects table
-- ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id TEXT UNIQUE REFERENCES graph_threads(thread_id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK(status IN ('planning', 'active', 'paused', 'completed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_company
  ON projects(company_id, status, updated_at DESC);

-- project_id FK was already added in the graph_threads recreation above.
-- Now add the FK constraint reference (SQLite doesn't enforce deferred FKs
-- but documenting intent):
-- graph_threads.project_id → projects.project_id ON DELETE SET NULL

-- Clean up legacy single-thread-per-company data
-- These used the old 'thread-{companyId}' format
DELETE FROM checkpoints WHERE thread_id LIKE 'thread-%';
DELETE FROM writes WHERE thread_id LIKE 'thread-%';
```

**Note:** The `checkpoints` and `writes` tables are LangGraph internal (managed by SqliteSaver). Verify table names match the actual SqliteSaver schema before running.

- [ ] **Step 2: Add projects to schema.ts**

```typescript
// packages/db-local/src/schema.ts — after graphThreads definition (~line 229):
export const projects = sqliteTable(
  'projects',
  {
    project_id: text('project_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    thread_id: text('thread_id').references(() => graphThreads.thread_id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('planning'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_projects_company').on(table.company_id, table.status, table.updated_at),
  ],
);
```

Add `project_id` column to graphThreads if Drizzle schema needs it (for type generation):
```typescript
// In graphThreads definition, add:
project_id: text('project_id'),
// Note: can't add .references() here because projects table is defined after graphThreads.
// The FK is enforced at the SQL level via migration.
```

- [ ] **Step 3: Create project types in shared-types**

```typescript
// packages/shared-types/src/project.ts
export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';

export interface ProjectRow {
  project_id: string;
  company_id: string;
  thread_id: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export type NewProject = Omit<ProjectRow, 'created_at' | 'updated_at'>;
```

Export from `packages/shared-types/src/index.ts`.

- [ ] **Step 4: Add ProjectRepository interface**

```typescript
// packages/core/src/runtime/repositories.ts — add:
export interface ProjectRepository {
  create(project: NewProject): Promise<ProjectRow>;
  findById(projectId: string): Promise<ProjectRow | null>;
  findByCompany(companyId: string): Promise<ProjectRow[]>;
  findActiveByCompany(companyId: string): Promise<ProjectRow[]>;
  updateStatus(projectId: string, status: ProjectStatus): Promise<void>;
  update(projectId: string, patch: Partial<Pick<ProjectRow, 'name' | 'description' | 'status'>>): Promise<void>;
  delete(projectId: string): Promise<void>;
}

// Add to RuntimeRepositories interface:
export interface RuntimeRepositories {
  // ... existing ...
  projects: ProjectRepository;
}
```

- [ ] **Step 5: Implement Drizzle ProjectRepository**

```typescript
// drizzle-repositories.ts — add projects repo implementation
// Follow the exact same pattern as other repos (officeLayouts, sopTemplates, etc.)
const projects: RuntimeRepositories['projects'] = {
  async create(project: NewProject) {
    const ts = now();
    const row: ProjectRow = { ...project, created_at: ts, updated_at: ts };
    db.insert(schema.projects).values(row).run();
    return row;
  },
  async findById(projectId) {
    const rows = db.select().from(schema.projects)
      .where(eq(schema.projects.project_id, projectId)).all();
    return (rows[0] as ProjectRow | undefined) ?? null;
  },
  async findByCompany(companyId) {
    return db.select().from(schema.projects)
      .where(eq(schema.projects.company_id, companyId))
      .orderBy(desc(schema.projects.updated_at))
      .all() as ProjectRow[];
  },
  async findActiveByCompany(companyId) {
    return db.select().from(schema.projects)
      .where(
        and(
          eq(schema.projects.company_id, companyId),
          inArray(schema.projects.status, ['planning', 'active', 'paused']),
        ),
      )
      .orderBy(desc(schema.projects.updated_at))
      .all() as ProjectRow[];
  },
  async updateStatus(projectId, status) {
    db.update(schema.projects)
      .set({ status, updated_at: now() })
      .where(eq(schema.projects.project_id, projectId))
      .run();
  },
  async update(projectId, patch) {
    db.update(schema.projects)
      .set({ ...patch, updated_at: now() })
      .where(eq(schema.projects.project_id, projectId))
      .run();
  },
  async delete(projectId) {
    db.delete(schema.projects)
      .where(eq(schema.projects.project_id, projectId))
      .run();
  },
};
```

- [ ] **Step 6: Implement Memory ProjectRepository**

Follow memory-repositories.ts pattern — in-memory Map store.

- [ ] **Step 7: Write repository tests**

```typescript
// packages/core/src/__tests__/unit/project-repository.test.ts
describe('ProjectRepository', () => {
  it('should create and find project', async () => {});
  it('should find active projects by company', async () => {});
  it('should update status', async () => {});
  it('should cascade delete with company', async () => {});
});
```

- [ ] **Step 8: Add findByStatus to ThreadRepository**

Task 10 (Auto-Resume) needs to query threads by status. Add it now since we're already modifying repositories:

```typescript
// repositories.ts — add to ThreadRepository interface:
findByCompanyAndStatus(companyId: string, status: string): Promise<ThreadRow[]>;

// drizzle-repositories.ts — implement:
async findByCompanyAndStatus(companyId, status) {
  return db.select().from(schema.graphThreads)
    .where(
      and(
        eq(schema.graphThreads.company_id, companyId),
        eq(schema.graphThreads.status, status),
      ),
    )
    .all() as ThreadRow[];
},

// memory-repositories.ts — implement:
async findByCompanyAndStatus(companyId, status) {
  return [...this.store.values()].filter(
    (t) => t.company_id === companyId && t.status === status,
  );
},
```

- [ ] **Step 9: Register migration**

Update the migration runner/index to include 010. Check how existing migrations are registered (likely a glob or explicit list in `packages/db-local/src/`).

- [ ] **Step 9: Build shared-types + core, run tests**

```bash
pnpm --filter @aics/shared-types build
cd packages/core && pnpm vitest run
```

- [ ] **Step 10: Commit**

```bash
git commit -m "feat: Project entity — migration 010, ProjectRepository, shared types"
```

---

## Task 6: PlanStep Extensions + PM Prompt

**Files:**
- Modify: `packages/core/src/graph/state.ts` (PlanStep interface)
- Modify: `packages/core/src/agents/pm-planner-node.ts` (PM prompt + LlmPlanStep)
- Create: `packages/core/src/__tests__/unit/plan-extensions.test.ts`

**Scope:** Add `phase` and `dependsOnSteps` to PlanStep type. Update PM prompt to generate richer plans. Step dispatcher remains sequential (no DAG dispatch).

- [ ] **Step 1: Extend PlanStep interface**

```typescript
// packages/core/src/graph/state.ts line 18-22, replace with:
export interface PlanStep {
  stepIndex: number;
  description: string;
  tasks: PlanTask[];
  /** Grouping label for multi-phase projects, e.g. "需求调研", "核心开发" */
  phase?: string;
  /** DAG: which steps must complete before this one starts. Reserved for future parallel dispatch. */
  dependsOnSteps?: number[];
}
```

- [ ] **Step 2: Update PM system prompt**

```typescript
// pm-planner-node.ts — replace PM_SYSTEM_PROMPT:
const PM_SYSTEM_PROMPT = `You are the PM AI — responsible for breaking down work into structured execution plans.

Given the user's intent and available employees with their capabilities, create a step-by-step plan.

Respond with JSON only:
{
  "summary": "one sentence describing the overall plan",
  "steps": [
    {
      "stepIndex": 0,
      "phase": "phase name (optional, for grouping related steps)",
      "description": "what this step accomplishes",
      "dependsOnSteps": [],
      "tasks": [
        {
          "taskType": "research" | "writing" | "analysis" | "review" | "code" | "general",
          "employeeId": "<employee_id>",
          "description": "specific instruction for the employee",
          "dependsOnStepOutput": false
        }
      ]
    }
  ]
}

Rules:
- Steps execute sequentially by stepIndex order
- Tasks within a step execute in parallel
- Set dependsOnStepOutput: true when a task needs results from the previous step
- Assign tasks to the most appropriate employee
- For simple requests: 1-4 steps
- For complex projects: use phases to group related steps (e.g. "研究", "设计", "开发", "测试")
- dependsOnSteps is reserved for future parallel step execution — set it accurately but steps still run in order`;
```

- [ ] **Step 3: Update LlmPlanStep interface to match**

```typescript
// pm-planner-node.ts — update the internal LlmPlanStep:
interface LlmPlanStep {
  stepIndex: number;
  description: string;
  phase?: string;
  dependsOnSteps?: number[];
  tasks: Array<{
    taskType: string;
    employeeId: string;
    description: string;
    dependsOnStepOutput: boolean;
  }>;
}
```

- [ ] **Step 4: Update plan parsing to preserve new fields**

In `pm-planner-node.ts`, the `parsePmPlan` function (lines 59-102) builds PlanStep objects at lines 92-98. Currently:
```typescript
// line 93-97 (current):
steps.push({
  stepIndex: step.stepIndex,
  description: step.description,
  tasks,
});
```

Change to:
```typescript
// line 93-97 (new):
steps.push({
  stepIndex: step.stepIndex,
  description: step.description,
  tasks,
  phase: typeof step.phase === 'string' ? step.phase : undefined,
  dependsOnSteps: Array.isArray(step.dependsOnSteps) ? step.dependsOnSteps.filter((n): n is number => typeof n === 'number') : undefined,
});
```

Also update `LlmPlanStep` interface (lines 43-52) to include the new fields:
```typescript
interface LlmPlanStep {
  stepIndex: number;
  description: string;
  phase?: string;
  dependsOnSteps?: number[];
  tasks: Array<{
    taskType: string;
    employeeId: string;
    description: string;
    dependsOnStepOutput: boolean;
  }>;
}
```

- [ ] **Step 5: Write test**

```typescript
describe('PlanStep extensions', () => {
  it('should preserve phase and dependsOnSteps in plan output', async () => {
    // Mock LLM response with phase/depends fields
    // Verify they survive through pmPlannerNode
  });
});
```

- [ ] **Step 6: Run tests, commit**

```bash
cd packages/core && pnpm vitest run
git commit -m "feat: extend PlanStep with phase + dependsOnSteps (data model, dispatch stays sequential)"
```

---

## Task 7: AbortController (depends on Task 4)

**Files:**
- Modify: `packages/core/src/services/orchestration-service.ts` (wire abort)
- Modify: `packages/core/src/llm/retry.ts` (check signal.aborted)
- Modify: `packages/core/src/llm/recorded-call.ts` (pass signal from config)
- Create: `packages/core/src/__tests__/unit/abort-integration.test.ts`
- Modify: `packages/ui-office/src/components/chat/ChatPanel.tsx` (stop button)

- [ ] **Step 1: Wire AbortController in OrchestrationService**

```typescript
// orchestration-service.ts — in execute(), after queue depth check:
const abort = new AbortController();
this.currentAborts.set(threadId, abort);

// Pass signal through config in _executeInner:
const config = {
  configurable: {
    thread_id: threadId,
    runtimeCtx: this.runtimeCtx,
    signal: abort.signal,  // NEW
  },
};

// In the stream loop, check abort:
for await (const update of stream) {
  if (abort.signal.aborted) break;
  // ... existing merge logic
}

// In finally block:
this.currentAborts.delete(threadId);

// Add public abort method:
abortExecution(threadId: string): void {
  this.currentAborts.get(threadId)?.abort();
}
```

- [ ] **Step 2: Thread signal through node call sites to LlmRequest**

`LlmRequest` already has `signal?: AbortSignal` (gateway.ts:34). `recordedLlmCall` already passes request directly to `ctx.llmGateway.chat(request)` (recorded-call.ts:38). So **recorded-call.ts does NOT need changes**.

The fix is in each **node's call site** — add signal to the LlmRequest they construct. There are 6 call sites:

```typescript
// Helper to extract signal from config (add to a shared util or inline):
function getSignal(config: RunnableConfig): AbortSignal | undefined {
  return (config.configurable as { signal?: AbortSignal } | undefined)?.signal;
}

// boss-node.ts:88 — add signal to request:
const llmResponse = await recordedLlmCall(runtimeCtx, {
  messages: [...],
  model: resolved.model,
  signal: getSignal(config),  // ADD THIS
  // ... rest
}, meta);

// Same pattern for:
// manager-node.ts:123
// hr-node.ts:105
// pm-planner-node.ts:295
// employee-node.ts:299 (first call)
// employee-node.ts:518 (tool loop subsequent calls)
```

Each node already has `config: RunnableConfig` as a parameter. Signal flows: `OrchestrationService.execute() → config.configurable.signal → node reads it → LlmRequest.signal → gateway.chat() → SDK abort`.

- [ ] **Step 3: Add abort check in withRetry**

```typescript
// retry.ts — in the loop, before sleep:
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  isRetryable: (error: unknown) => boolean,
  signal?: AbortSignal,  // NEW optional param
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === config.maxRetries) {
        throw error;
      }
      await sleep(computeDelay(attempt, config));
    }
  }
  throw lastError;
}
```

Update all withRetry call sites (anthropic-adapter, openai-adapter) to pass `request.signal`.

- [ ] **Step 4: Handle AbortError in OrchestrationService**

```typescript
// In _executeInner catch block, treat AbortError as non-error:
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    // Aborted by user — not an error, return current state
    return finalState as AicsGraphState;
  }
  // ... existing error wrapping
}
```

- [ ] **Step 5: Expose abortExecution on AicsRuntimeProvider**

```typescript
// AicsRuntimeProvider.tsx — add to context value:
const abortExecution = useCallback((threadId?: string) => {
  const runtime = runtimeRef.current;
  if (!runtime?.orch) return;
  const tid = threadId ?? runtime.runtimeCtx.threadId;
  runtime.orch.abortExecution(tid);
}, []);

// Add to provider value alongside sendMessage, retryLastMessage
```

- [ ] **Step 6: Add stop button in ChatPanel**

When `isRunning` is true, show a stop button that calls `abortExecution()`. Replace or augment the send button.

- [ ] **Step 7: Write integration test**

```typescript
describe('AbortController integration', () => {
  it('should abort a running LLM call', async () => {
    // Start an execute() with a mock gateway that delays
    // Call abortExecution() after short delay
    // Verify execute returns without error
  });
});
```

- [ ] **Step 8: Run all tests, commit**

```bash
cd packages/core && pnpm vitest run
git commit -m "feat: AbortController — stop button, signal threading, retry abort check"
```

---

## Task 8: DB Transaction — Service Level (depends on Task 1)

**Files:**
- Modify: `packages/install-core/src/materializer.ts` (wrap in transaction)
- Modify: `packages/core/src/services/employee-version-service.ts` (wrap in transaction)
- Modify: `packages/core/src/services/company-template-service.ts` (wrap in transaction)
- Create: `packages/install-core/src/__tests__/materializer-transaction.test.ts`

**Pattern:** Since better-sqlite3 transactions are connection-level, calling `db.transaction(() => { ... })()` wraps ALL `.run()` calls on the same connection. The repo methods are async wrappers around sync `.run()` calls that resolve immediately — no event loop yield, so the transaction scope holds.

For install-core, we need access to the underlying db. The cleanest way: add an optional `transact` method to the repos adapter.

- [ ] **Step 1: Add transact to Drizzle repos adapter**

```typescript
// In the install-core repos adapter (created via createInstallReposAdapter):
// Add: transact<T>(fn: () => T): T
// Implementation: db.transaction(() => fn())()
```

- [ ] **Step 2: Wrap materialize() in transaction**

```typescript
// materializer.ts — wrap the entire body:
export async function materialize(...): Promise<MaterializeResult> {
  const transact = (repos as { transact?: <T>(fn: () => T) => T }).transact;
  const doMaterialize = () => {
    // ... all existing create calls (they resolve synchronously under the hood)
    // Move all the code into this function
  };
  if (transact) {
    return transact(doMaterialize);
  }
  return doMaterialize(); // memory repos: no transaction needed
}
```

- [ ] **Step 3: Wrap createVersion in transaction**

Similar pattern for employee-version-service.ts.

- [ ] **Step 4: Wrap materializeTemplate in transaction**

Similar pattern for company-template-service.ts.

- [ ] **Step 5: Write test for materializer transaction rollback**

```typescript
describe('materialize transaction safety', () => {
  it('should rollback all writes if asset creation fails mid-loop', async () => {
    // Seed valid package, but make the 3rd asset creation throw
    // Verify: no installed_packages row, no installed_assets rows
  });
});
```

- [ ] **Step 6: Run tests, commit**

```bash
cd packages/core && pnpm vitest run
cd packages/install-core && pnpm vitest run
git commit -m "fix: wrap materialize/createVersion/materializeTemplate in DB transactions"
```

---

## Task 9: Project-Scoped Execution (depends on Task 4 + 5)

**Files:**
- Modify: `packages/core/src/services/orchestration-service.ts` (project-aware execute)
- Modify: `packages/core/src/runtime/runtime-context.ts` (optional projectId)
- Modify: `packages/core/src/agents/boss-node.ts` (project creation intent detection)
- Modify: `packages/core/src/graph/state.ts` (add projectId to state)
- Modify: `packages/core/src/graph/main-graph.ts` (background_sync routing)
- Modify: `apps/web/src/lib/browser-runtime.ts` (threadId generation per-project)
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx` (project context)
- Create: `packages/core/src/__tests__/unit/project-execution.test.ts`

- [ ] **Step 1: Add projectId to graph state**

```typescript
// state.ts — add to AicsGraphAnnotation:
projectId: Annotation<string | null>({
  reducer: (_prev, next) => next,
  default: () => null,
}),
```

- [ ] **Step 2: Thread generation per-project**

**ThreadId strategy (definitive):**
- Default company chat: `thread-${companyId}` (unchanged, backward compatible)
- Per-project threads: `project-${projectId}` (deterministic, derived from project_id)
- This means: `projects.thread_id` = `project-${projects.project_id}`

```typescript
// packages/core/src/utils/generate-id.ts — add:
export function projectThreadId(projectId: string): string {
  return `project-${projectId}`;
}
```

In browser-runtime.ts and tauri-runtime.ts, the initial threadId stays as `thread-${companyId}`. When a project is created (in boss-node or a new project-creation service), the thread is generated:

```typescript
// Project creation flow (wherever it lives):
const projectId = generateId('proj');
const threadId = projectThreadId(projectId);
await repos.projects.create({
  project_id: projectId,
  company_id: companyId,
  thread_id: threadId,  // assigned at creation, not deferred
  name: projectName,
  status: 'planning',
});
await repos.threads.create({
  thread_id: threadId,
  company_id: companyId,
  entry_mode: 'boss_chat',
  status: 'queued',
});
```

- [ ] **Step 3: Update OrchestrationService for project awareness**

```typescript
// orchestration-service.ts — execute() already takes optional threadId (from Task 4)
// No additional changes needed — callers pass project's threadId
```

- [ ] **Step 4: Boss node — project creation detection**

Add to boss node system prompt:
```
If the user describes a substantial project (not a simple question), add to your response:
  "action": "delegate",
  "isNewProject": true,
  "projectName": "<short name>"
```

In `routeFromBoss`, if `isNewProject`, create a Project row before routing to manager. This uses repos from runtimeCtx.

- [ ] **Step 5: Project creation flow in manager/PM path**

When boss routes `delegate_manager` with project context:
1. Create project in DB (status: 'planning')
2. Create new graph_thread for the project
3. Pass project's threadId to OrchestrationService.execute()
4. PM creates plan within project context

- [ ] **Step 6: Add background_sync routing to main-graph**

```typescript
// main-graph.ts routeFromStart — add:
if (state.entryMode === 'background_sync') {
  return 'boss'; // Resume via boss node with context
}
```

- [ ] **Step 7: Write tests**

```typescript
describe('Project-scoped execution', () => {
  it('should create project and thread on project intent', async () => {});
  it('should execute on project-specific threadId', async () => {});
  it('should allow concurrent execution on different project threads', async () => {});
});
```

- [ ] **Step 8: Run tests, commit**

```bash
cd packages/core && pnpm vitest run
git commit -m "feat: project-scoped execution — per-project threads, boss intent detection"
```

---

## Task 10: Auto-Resume (depends on Task 4 + 5 + 9)

**Files:**
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx` (startup detection)
- Create: `packages/ui-office/src/components/project/ResumeBar.tsx`
- Modify: `packages/core/src/graph/main-graph.ts` (step_advance sets thread status)

- [ ] **Step 1: Track execution status in graph_threads**

In `step_advance` node and `boss_summary` node, update `graph_threads.status`:
- `step_advance`: set `status = 'running'` with progress info
- `boss_summary`: set `status = 'completed'`
- On error: set `status = 'failed'`

```typescript
// main-graph.ts stepAdvanceNode — add:
if (runtimeCtx) {
  await runtimeCtx.repos.threads.updateStatus(state.threadId, 'running');
}
```

- [ ] **Step 2: Startup detection in AicsRuntimeProvider**

```typescript
// AicsRuntimeProvider.tsx — add after initRuntime:
useEffect(() => {
  if (!runtimeRef.current) return;
  const repos = runtimeRef.current.repos;
  // Query for threads with status = 'running' for current company
  // (findByCompanyAndStatus was added in Task 5, Step 8)
  repos.threads.findByCompanyAndStatus(companyId, 'running').then((threads) => {
    if (threads.length > 0) {
      setUnfinishedProjects(threads);
    }
  });
}, [companyId, version]);
```

**Note:** Need to add `findByStatus` to ThreadRepository if it doesn't exist.

- [ ] **Step 3: Create ResumeBar component**

```typescript
// packages/ui-office/src/components/project/ResumeBar.tsx
export function ResumeBar({ projects, onResume, onDismiss }: {
  projects: Array<{ threadId: string; projectName: string }>;
  onResume: (threadId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="...">
      <span>有 {projects.length} 个未完成的项目</span>
      {projects.map(p => (
        <button key={p.threadId} onClick={() => onResume(p.threadId)}>
          恢复 {p.projectName}
        </button>
      ))}
      <button onClick={onDismiss}>忽略</button>
    </div>
  );
}
```

- [ ] **Step 4: Resume flow**

When user clicks resume:
1. Get the project's threadId
2. Call `orch.execute({ entryMode: 'background_sync', threadId, messages: [] })`
3. LangGraph resumes from last checkpoint on that thread

- [ ] **Step 5: Run tests, commit**

```bash
cd packages/core && pnpm vitest run
cd apps/web && pnpm tsc --noEmit
git commit -m "feat: auto-resume — detect unfinished projects on startup, resume from checkpoint"
```

---

## Task 11: Project UI (depends on Task 5 + 9 + 10)

**Files:**
- Create: `packages/ui-office/src/components/project/ProjectSelector.tsx`
- Create: `packages/ui-office/src/components/project/ProjectListPanel.tsx`
- Modify: `packages/ui-office/src/components/chat/ChatPanel.tsx` (scope to project)
- Modify: `apps/web/src/App.tsx` (project selector in header)
- Create: `packages/ui-office/src/hooks/useProjects.ts`

- [ ] **Step 1: Create useProjects hook**

```typescript
// packages/ui-office/src/hooks/useProjects.ts
import { useState, useEffect, useCallback } from 'react';

export function useProjects(repos, companyId: string) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  useEffect(() => {
    repos.projects.findByCompany(companyId).then(setProjects);
  }, [repos, companyId]);

  const switchProject = useCallback((projectId: string | null) => {
    setActiveProjectId(projectId);
    // null = company-wide view (all employees)
  }, []);

  return { projects, activeProjectId, switchProject, refresh };
}
```

- [ ] **Step 2: Create ProjectSelector dropdown**

Top bar dropdown showing active projects. "All" option shows company-wide view.

- [ ] **Step 3: Create ProjectListPanel**

Side panel or overlay listing all projects with status badges, create/archive actions.

- [ ] **Step 4: Scope ChatBox to active project**

When a project is selected, ChatBox:
- Uses the project's threadId for sendMessage
- Shows only that project's messages
- Header shows project name

When "All" is selected, falls back to company threadId.

- [ ] **Step 5: Scene switching per project**

Office scene shows employee positions/states for the active project. This requires:
- Filtering employees by project assignment
- Different position/animation states per project context

This is the most complex UI piece — may need a project-employee assignment table in future. For now, show all employees but highlight those assigned to the active project's tasks.

- [ ] **Step 6: Build, verify, commit**

```bash
pnpm --filter @aics/ui-office build
cd apps/web && pnpm tsc --noEmit
git commit -m "feat: Project UI — selector, list panel, project-scoped chat + scene"
```

---

## Validation Checklist

After all tasks complete:

- [ ] `cd packages/core && pnpm vitest run` — all 472+ tests pass
- [ ] `cd packages/renderer && pnpm vitest run` — all 341 tests pass (untouched but verify)
- [ ] `cd packages/install-core && pnpm vitest run` — all 213+ tests pass
- [ ] `pnpm --filter @aics/shared-types build` — builds clean
- [ ] `pnpm --filter @aics/ui-office build` — builds clean
- [ ] `cd apps/web && pnpm tsc --noEmit` — typecheck passes
- [ ] `cd apps/market && pnpm tsc --noEmit` — typecheck passes (untouched but verify)
- [ ] Manual: Start desktop app, create company, create project, send message, verify scene
