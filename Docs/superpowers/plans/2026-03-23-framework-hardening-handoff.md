# Framework Hardening + Project Model — Session Handoff

**Date:** 2026-03-23
**Spec:** `Docs/superpowers/specs/2026-03-23-framework-hardening-design.md`
**Status:** Design complete, implementation not started

---

## What was completed this session

28 minutes of architectural brainstorming + 5 spec revisions + 1 architectural audit with 5 blind spots identified and resolved.

### Design decisions made

1. **DB Transaction Safety** — mixed-layer approach (repo layer for simple 2-step, service layer for cross-repo). `withTransaction<T>` interface on both `RuntimeRepositories` and `InstallRepositories`.

2. **Project Model** — replaces the original "ThreadId redesign". Projects are first-class entities (like "Build Claude Code"), not conversations or directives. New `projects` table, `graph_threads.project_id` FK. Parallel execution across projects. Office scene switches view per project.

3. **Plan Framework Upgrade** — `PlanStep` extended with `phase`, `parallelGroup`, `dependsOnSteps[]` (DAG). Step dispatcher becomes DAG-aware. PM prompt upgraded for project-level complexity (10+ steps, multi-phase).

4. **Step-Level Checkpoint + Auto-Resume** — LangGraph checkpoints already persist to SQLite. Add: `graph_threads.status = 'running'` tracking, app startup detection of unfinished projects, resume from last checkpoint.

5. **Message Pruning** — at LLM call layer (gateway.ts), not in graph state. `MAX_CONTEXT_MESSAGES = 50`. Graph state retains full chain.

6. **AbortController** — manual stop button only (company switch does NOT abort). Per-project `AbortController` on long-lived `OrchestrationService`. Signal propagates via `config.configurable.signal`.

7. **OrchestrationService Lifecycle** — promoted from per-call to RuntimeBundle member (long-lived). `threadLocks` keyed by threadId. `currentAborts` map for per-project cancellation.

8. **Editor Deletion** — delete EditorMode entirely (9 files + 3 related files). StudioPage is sole editor.

### Key architectural insights from audit

- `graph_threads` already exists with company_id, status, entry_mode — don't duplicate with a conversations table
- `boss-summary-node` scans ALL messages (not just recent) — pruning must happen at LLM layer, not graph state
- OrchestrationService was created per-call in web — threadLocks were ineffective. Must be long-lived.
- `background_sync` entryMode already reserved but unused — use for auto-resume path
- `parent_task_run_id` exists in DB but unused — activate for sub-task tracking
- better-sqlite3 serializes writes at connection level — concurrent project DB writes are safe

---

## Current repo health

- **Build:** shared-types ✅ | core 472/472 ✅ | ui-office typecheck ✅
- **Branch:** main
- **Latest commits:**
  - `05696c4` docs: final spec — Project model, parallel exec, DAG plans, auto-resume
  - `bae7419` docs: rewrite spec — directive model, audit fixes, orch lifecycle
  - `442cc8e` docs: address spec review findings — 6 fixes
  - `95553a4` docs: framework hardening design spec

---

## What should happen next

Full implementation of the 5 spec items. Priority order:

1. **DB Transaction Safety** (lowest risk, pure infra)
2. **Editor Deletion** (pure cleanup, reduces noise for subsequent work)
3. **Project Model + Plan Upgrade** (biggest feature, most files)
4. **AbortController** (depends on OrchestrationService lifecycle change from #3)
5. **Auto-Resume** (depends on project model from #3)

---

## Starter prompt for next session

```
继续 Offisim 框架加固 + Project Model 实现。

设计文档: Docs/superpowers/specs/2026-03-23-framework-hardening-design.md
Handoff: Docs/superpowers/plans/2026-03-23-framework-hardening-handoff.md

上个 session 完成了完整的架构设计 + 审计，5 个架构项：

1. DB 事务安全 — withTransaction 接口，4 个目标操作
2. 删除 EditorMode — 12 个文件删除/清理
3. Project Model — projects 表、并行执行、办公室场景切换
4. Plan 框架升级 — phase/parallelGroup/dependsOnSteps DAG
5. AbortController — 手动停止按钮，per-project signal
6. Step-level checkpoint + auto-resume
7. LLM 层 message pruning
8. OrchestrationService 提升为长生命周期

构建状态: core 472/472 ✅ | shared-types ✅ | ui-office typecheck ✅

请先读 spec 文档，然后用 writing-plans skill 写实现计划，再用 subagent-driven-development 并行实施。

关键文件行号已在 spec 中标注。注意：
- drizzle-repositories.ts 的所有操作底层是同步的（better-sqlite3 .run()），虽然接口声明 async
- OrchestrationService 当前在 AicsRuntimeProvider.tsx:136 每次新建，需要改为 RuntimeBundle 成员
- step-dispatcher-node.ts 当前是严格顺序，需要改为 DAG-aware
- graph_threads 已有 status 枚举包含 paused/blocked/running 但从未设置
- parent_task_run_id 在 task_runs 表存在但从未使用
- background_sync entryMode 已预留但从未路由
```

---

## Files to read first (in order)

1. `Docs/superpowers/specs/2026-03-23-framework-hardening-design.md` — the spec
2. `packages/core/src/runtime/repositories.ts:500-526` — RuntimeRepositories interface
3. `packages/core/src/runtime/drizzle-repositories.ts:75,933,665,958` — key locations
4. `packages/core/src/services/orchestration-service.ts:27-38,86-132` — threadLocks + execute
5. `packages/core/src/agents/step-dispatcher-node.ts` — current step dispatch logic
6. `packages/core/src/agents/pm-planner-node.ts` — PM prompt and plan creation
7. `packages/core/src/graph/main-graph.ts` — graph routing, step_advance
8. `packages/shared-types/src/plan.ts` (or wherever PlanStep is defined) — plan types
9. `apps/web/src/runtime/AicsRuntimeProvider.tsx:106-150` — sendMessage + orch creation
10. `apps/web/src/App.tsx:43,59,210` — editor overlay references to delete
