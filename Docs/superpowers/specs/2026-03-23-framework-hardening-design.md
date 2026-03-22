# Framework Hardening + Project Model — Design Spec

**Date:** 2026-03-23
**Scope:** 5 architectural items, full implementation

---

## 1. DB Transaction Safety

### Problem

Zero `db.transaction()` calls. Multi-step writes have no atomicity.

### Decision

Mixed-layer: repo layer wraps simple 2-step ops, service layer wraps cross-repo ops.

### Interface

```typescript
// repositories.ts — add to RuntimeRepositories
withTransaction<T>(fn: () => T): T;

// install-core/src/types.ts — add to InstallRepositories
withTransaction<T>(fn: () => T): T;

// drizzle impl
withTransaction<T>(fn: () => T): T {
  return this.db.transaction(() => fn())();
}

// memory impl
withTransaction<T>(fn: () => T): T {
  return fn();
}
```

### Targets

**Repo layer:**
- `officeLayouts.setActive()` (drizzle-repositories.ts:933) — 2 UPDATEs
- `modelCostRates.upsert()` (drizzle-repositories.ts:665) — check-then-act

**Service layer:**
- `materialize()` (install-core/materializer.ts:62) — pkg + assets + employees + bindings
- `createVersion()` (core/employee-version-service.ts:23) — employee update + version insert

---

## 2. Project Model

### Problem

`threadId = 'thread-${companyId}'` — one thread per company, messages accumulate infinitely, no project concept, no parallel execution.

### Decision

Introduce **Project** as a first-class entity. Each project gets its own LangGraph thread. Multiple projects execute in parallel. Company state (employees, office) is shared in DB across all projects.

### Concept

A Project is a real project — "Build Claude Code", "Design marketing campaign". Not a task or directive. Projects have phases, milestones, teams, and long lifecycles. The boss issues projects via natural language; the PM breaks them down and assigns employees.

Office scene switches view per project — clicking a different project shows which employees are working on it and their states/positions/animations.

### Data Model

New `projects` table (migration 010):

```sql
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id TEXT UNIQUE,  -- FK to graph_threads, set when execution starts
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK(status IN ('planning','active','paused','completed','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_company ON projects(company_id, status, updated_at DESC);

-- Link graph_threads to projects
ALTER TABLE graph_threads ADD COLUMN project_id TEXT REFERENCES projects(project_id);
```

### Project Lifecycle

1. Boss says "我要做一个 AI 代码编辑器" → system detects project creation intent
2. If description is vague, PM asks follow-up questions (spec, scope, goals)
3. Project created (`status = 'planning'`), PM generates plan with phases
4. Execution starts (`status = 'active'`), employees assigned, tasks dispatched
5. Boss can check in anytime, give guidance, adjust direction
6. All phases complete → `status = 'completed'`
7. Boss can archive old projects

### Parallel Execution

- Each project has its own OrchestrationService execution on its own thread
- `threadLocks` keyed by `threadId` (not companyId) — projects run independently
- OrchestrationService is a long-lived RuntimeBundle member
- Multiple `graph.stream()` calls can run concurrently for different threads
- Company DB state (employees, tasks) is shared — concurrent writes are safe because better-sqlite3 serializes at the connection level

### Plan Framework Upgrade

Extend `PlanStep` to support phases and DAG dependencies:

```typescript
interface PlanStep {
  stepIndex: number;
  phase?: string;              // "需求调研", "核心开发" — grouping label
  parallelGroup?: number;      // steps with same group can run in parallel
  description: string;
  tasks: PlanTask[];
  dependsOnSteps?: number[];   // DAG: which steps must complete before this one starts
}
```

Step dispatcher changes from "strict sequential" to "check dependencies → dispatch all ready steps in parallel":

```typescript
// step_dispatcher logic (pseudocode)
const completedSteps = new Set(stepResults.map(r => r.stepIndex));
const readySteps = plan.steps.filter(s =>
  !completedSteps.has(s.stepIndex) &&
  (s.dependsOnSteps ?? []).every(dep => completedSteps.has(dep))
);
// dispatch ALL ready steps at once
```

PM prompt updated: remove "1-4 steps" constraint, add phase/dependency awareness.

### State Separation

```
Company (persistent, shared)         Project (isolated, per-thread)
─────────────────────────            ────────────────────────────────
employees, skills, memory  ←── DB    messages, plan, currentStep ←── checkpoint
tasks, taskRuns            ←── DB    execution progress          ←── checkpoint
office layout, prefabs     ←── DB
```

### Step-Level Checkpoint + Auto-Resume

LangGraph checkpoints are already persisted to SQLite between nodes. Add:

1. `step_advance` node sets `graph_threads.status = 'running'` with current progress
2. On completion: `graph_threads.status = 'completed'`
3. On app startup: query `graph_threads WHERE status = 'running'` → detect unfinished projects
4. Show resume banner → user clicks → resume from last checkpoint
5. `background_sync` entryMode (already reserved in state.ts) used for auto-resume path

### Message Pruning

At the LLM call layer, not in graph state:

```typescript
const MAX_CONTEXT_MESSAGES = 50;
const contextMessages = messages.length > MAX_CONTEXT_MESSAGES
  ? messages.slice(-MAX_CONTEXT_MESSAGES)
  : messages;
```

Graph state retains full message chain for nodes that scan all messages.

### Legacy Cleanup (migration 010)

```sql
DELETE FROM checkpoints WHERE thread_id LIKE 'thread-%';
DELETE FROM writes WHERE thread_id LIKE 'thread-%';
```

### UI

- Top bar: project selector dropdown → switches office scene view
- Project list panel: active projects with progress, completed/archived
- ChatBox: scoped to current project
- Office scene: employees show project assignment (badge/indicator), positions/states/animations change per project view
- "All" view: see all employees across all projects

### Files Changed

| Change | File |
|--------|------|
| New migration | `packages/db-local/src/migrations/010_projects.sql` |
| Schema | `packages/db-local/src/schema.ts` — projects table + graph_threads.project_id |
| Repository | `packages/core/src/runtime/repositories.ts` — ProjectRepository |
| Drizzle impl | `packages/core/src/runtime/drizzle-repositories.ts` |
| Memory impl | `packages/core/src/runtime/memory-repositories.ts` |
| Plan types | `packages/shared-types/` — PlanStep extensions |
| PM prompt | `packages/core/src/agents/pm-planner-node.ts` — phase/DAG awareness |
| Step dispatcher | `packages/core/src/agents/step-dispatcher-node.ts` — DAG-based dispatch |
| Step advance | `packages/core/src/graph/main-graph.ts` — parallel step handling |
| Orch lifecycle | `packages/core/src/services/orchestration-service.ts` — long-lived, parallel |
| ThreadId | `apps/web/src/lib/tauri-runtime.ts` + `browser-runtime.ts` |
| Runtime provider | `apps/web/src/runtime/AicsRuntimeProvider.tsx` — orch as RuntimeBundle member |
| Pruning | `packages/core/src/llm/gateway.ts` |
| Auto-resume | `apps/web/src/runtime/AicsRuntimeProvider.tsx` — startup check |
| UI | `packages/ui-office/` — project selector, project list, scene switching |

---

## 3. AbortController (Manual Stop)

### Problem

No way to cancel a running LLM call.

### Decision

Manual stop button per-project. Stored on long-lived OrchestrationService.

```typescript
// OrchestrationService
private currentAborts = new Map<string, AbortController>();  // threadId → controller

async execute(input, threadId): Promise<AicsGraphState> {
  const abort = new AbortController();
  this.currentAborts.set(threadId, abort);
  try {
    const stream = await this.graph.stream(fullInput, {
      streamMode: 'updates',
      configurable: { ...config, signal: abort.signal },
    });
    for await (const update of stream) {
      if (abort.signal.aborted) break;
      // merge logic
    }
    return lastState;
  } finally {
    this.currentAborts.delete(threadId);
  }
}

abortProject(threadId: string): void {
  this.currentAborts.get(threadId)?.abort();
}
```

Signal propagation: config.configurable.signal → node reads → gateway.chat({ signal }) → SDK aborts HTTP.

withRetry: check signal.aborted before each retry attempt.

Error handling: AbortError caught silently, logged as info.

UI: Stop button in ChatBox replaces send button during execution.

---

## 4. Delete EditorMode

### Problem

Two parallel editing systems (18 components). EditorMode (Context+localStorage) vs StudioState (Zustand+DB).

### Decision

Delete EditorMode entirely. StudioPage is the sole editor.

### Deletion

- Remove `packages/ui-office/src/components/scene/editor/` (9 files)
- Remove `OfficeEditorOverlay.tsx`, `useCompanyEditor.ts`
- Update `CompanyEditor.tsx` — `onOpenOfficeEditor` → `onOpenStudio`
- Update `App.tsx` — remove 'office-editor' view, lazy import, redirect to 'studio'
- Remove `office-editor` export from `packages/ui-office/package.json`
- Remove EditorProvider from Office3DView

---

## 5. Plan Framework Upgrade (part of Project Model, listed separately for clarity)

### Current Limitations

- Flat: Plan → Steps (sequential) → Tasks (parallel within step)
- PM constrained to "1-4 steps"
- No phases, no parallel steps, no DAG dependencies, no re-planning

### Upgrade

1. PlanStep gets `phase`, `parallelGroup`, `dependsOnSteps` fields
2. Step dispatcher becomes DAG-aware (dispatch all ready steps)
3. PM prompt updated for project-level complexity (phases, 10+ steps)
4. `parent_task_run_id` activated for sub-task tracking
5. Main graph routing: after employee completion, check if more ready steps exist (not just next sequential step)
