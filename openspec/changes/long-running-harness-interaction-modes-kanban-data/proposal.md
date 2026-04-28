## Why

Offisim 现在跑长任务时有三块短板，串起来导致"开发型 agent 跑过 30 轮就崩、跑完不知道结果是真还是假、PM 看不见进度":

1. **运行时长程不稳**:`packages/core/src/services/conversation-budget-service.ts` 走的是"整段对话再生成 synopsis"型 full-compact,没有细粒度的 tool-result 截断,也没有滚动 anchor / journal。一个长任务跑到 50 轮时 (a) 几个 100KB 级 tool result 把上下文撑爆;(b) 早期 user objective 被 prune 掉,agent "忘了自己在干嘛"。`packages/core/src/a2a/` 现有的 employee-to-employee 消息会让父 context 一直涨,缺一个"开 fresh 子 context、只回吐摘要"的 fork 原语。`packages/core/src/agents/employee-completion.ts` 把 "task 完成" 完全交给 agent 自我声明,没有"必须有 verification 工具调用证据"的硬关卡。掉线后 `packages/core/src/testing/resume-runner.ts` 是 test-only 的,production happy-path 没有 ResumeCoordinator 接 SSE 重发。
2. **interaction mode 维度不够**:`packages/shared-types/src/interactions.ts` 现有 `InteractionMode = 'boss_proxy' | 'human_in_loop'`,只描述"是否人审批"。我们缺"决策链长度"这一维 — 用户实际场景里有"我直接找设计师小李改图,别走 boss/manager"(直派) 和"扔给 YOLO 大师让他自己干 8 小时"(完全 harness 化) 两种诉求。现在两种都得走完整 boss → manager → HR → planner → employee 链路,慢、贵、且不适合长程开发。
3. **看板有壳无肉**:`packages/ui-office/src/components/kanban/{KanbanBoard,KanbanColumn,KanbanCard,KanbanOverlay}.tsx` 已经存在,`apps/web/src/components/app-shell/AppOverlayHost.tsx` 已经在 `officeState.kanbanOpen` 时懒加载渲染 `KanbanOverlay`,⌘J 已经绑定。**但 overlay 打开是空的** — 没有 `kanban_cards` 表、pm-planner 出 plan 不写卡、employee 完成 task 不更卡、没有 platform/Tauri 路由暴露读写,所以用户在 live runtime 里看不到任何卡片,功能等于不存在。

CLAUDE.md "Product Closure Bar" 直接管这种情况:"功能完成的标准不是能跑,而是用户真能用。新功能必须在 live runtime 里完整走通主路径,不能停在 transport / event / placeholder 层。" 当前看板是典型的"placeholder 层"。

## What Changes

把上面三块一起补齐,分三个 capability 并行落地,**互不阻塞但共享一次 RC**。

- **`long-running-runtime`(NEW)**:在现有 `conversation-budget-service` 内补 micro-compact (按 tool-result 字节裁剪) 路径作为 full-compact 之前的廉价 pass;新增 `RollingJournal` 持有 anchor user objective + 每 N turn 滚动 journal record;`a2a-client` 加 `forkSubContext` 原语,只把 child summary 折回 parent;新增 `task.completion.verifying` hook event 接 `CompletionVerifier`,要求最近 N 个 tool result 内有 success 的 verification tool (`pnpm-test` / `pnpm-typecheck` / `pnpm-lint` 等仓库 evidence 命令) 才允许 employee-completion 走 `done`,否则降级到 `review`;把 `testing/resume-runner.ts` 升级为 production `ResumeCoordinator`,platform 加 `/sessions/:id/resume` SSE,desktop / web 重连时调用。
- **`interaction-modes`(MODIFY)**:把 `InteractionMode` 从 2 值 union 扩成 4 值 union — 加 `'direct_to_employee'` 和 `'yolo'`。`yolo` 模式引入新 role_slug `'yolo_master'`,对应一个内置的"YOLO 大师"员工,种入全部公司模板 (`packages/core/src/templates/{rd-company,content-studio,product-team,agency-lite,ai-startup}.ts`),在每个 company 启动时 idempotent ensure。`packages/core/src/graph/main-graph.ts` 入口加 mode-aware router:`boss_proxy`→ boss-node、`human_in_loop` → boss-node + 强 plan-review-gate、`direct_to_employee` → pm-planner-node (跳过 boss/manager/HR)、`yolo` → 直接进 yolo-master-node (跳过整个组织链)。`packages/core/src/agents/employee-tool-kit.ts` 给 employee/yolo-master 加 `todo_create` / `todo_update` / `todo_list` 三个工具,直派和 YOLO 模式下 agent 自管 TODO 卡片。UI 层 `apps/web/src/runtime/interaction-mode-storage.ts` 已有 default 持久化机制,扩 4 值 + 新增 `SessionModeSwitcher` 组件挂在 `AppMainShell` header。
- **`kanban-data-pipeline`(NEW)**:在 `packages/db-local/src/schema.ts` 新增 `kanban_cards` 表,FK `project_id → projects.project_id` (cascade delete),5 状态机 `'todo' | 'doing' | 'blocked' | 'review' | 'done'`,4 来源 `'pm-planner' | 'employee' | 'manager' | 'human'`,可选 `assigned_employee_id` / `parent_card_id` / `task_run_id` / `blocked_reason`。`packages/core/src/runtime/repos/` 新增 `KanbanRepo` (CRUD + state-transition + project / employee 查询 + 事件总线 publish)。`pm-planner-node` 出 plan 后落卡,`employee-completion` 完成后按 `task_run_id` 反向更新卡状态。`apps/platform/src/routes/kanban.ts` (web shell 用) 与 desktop Tauri command (Tauri 用) 各暴露一份 CRUD + SSE。`apps/web/src/runtime/` 新增 `useKanbanStream(projectId)`,`KanbanOverlay` 接进来。视觉**沿用现有海洋赛博风** — `.glass-panel` + `--color-sea-blue` / `--color-kelp-green` / `--color-coral-orange` / `--color-foam` 的 origin pill 配色 + `--sp-*` 间距 token。

## Capabilities

### New Capabilities

- **`long-running-runtime`** — micro-compact / rolling-journal / fork-sub-context / completion-verifier / resume-coordinator 五件套合在一起,确保 80-turn YOLO scenario 能跑完且 final non-system messages tokens 在阈值之下、micro-compact pass 触发 ≥3 次、completion 必须有 evidence。
- **`kanban-data-pipeline`** — `kanban_cards` 表 schema、`KanbanRepo` 不变量、pm-planner / employee 写卡口径、SSE 事件契约、KanbanOverlay 数据接入。

### Modified Capabilities

- **`interaction-modes`** — `InteractionMode` union 扩为 4 值;`main-graph` 入口 router 行为契约;YOLO Master 在公司模板的存在性不变量;`todo_*` 工具在 direct / yolo 模式下的可用性。

(注:`interaction-modes` 在 `openspec/specs/` 下当前没有同名 spec — 仓库 `InteractionMode` 类型存在,但没有显式 capability spec。本 change 视作"新增 capability spec",归类放在 Modified Capabilities 是因为它绑定的是**已有运行时概念**而非新引入概念。)

## Impact

- **代码** :
  - `packages/shared-types/src/interactions.ts` (扩 union)、`packages/shared-types/src/index.ts` (re-export 新增类型)
  - `packages/core/src/services/conversation-budget/` (新增 micro-compact + rolling-journal 模块,不动 budget-service barrel)
  - `packages/core/src/a2a/` (新增 fork-sub-context 模块 + a2a-client 加 fork 方法)
  - `packages/core/src/runtime/{hook-registry,completion-verifier,resume-coordinator}.ts` (新增 / 扩 hook event union)
  - `packages/core/src/agents/{yolo-master-node,yolo-master-persona,employee-completion,employee-tool-kit,pm-planner-node}.ts` (新建 / 修改)
  - `packages/core/src/graph/{main-graph,state}.ts` (router + state field)
  - `packages/core/src/templates/{rd-company,content-studio,product-team,agency-lite,ai-startup}.ts` (种 YOLO Master)
  - `packages/db-local/src/schema.ts` + `packages/db-local/src/migrations/0XX_kanban_cards.sql` (新表 + migration)
  - `packages/core/src/runtime/repos/kanban-repo.ts` + 注入到 RuntimeContext
  - `apps/platform/src/routes/{kanban,sessions,resume}.ts` (web 用)
  - `apps/desktop/src-tauri/src/` 加对应 Tauri command 路由 (desktop 用)
  - `apps/web/src/runtime/{interaction-mode-storage,useKanbanStream}.ts`、`apps/web/src/components/{session-mode/SessionModeSwitcher,session-mode/SessionModeBadge,app-shell/AppMainShell}.tsx`、`packages/ui-office/src/components/kanban/KanbanOverlay.tsx` 接数据
- **不影响** :
  - 不改 `App.tsx` shell composition (web-app-shell-boundaries spec 已锁住其行为不变量)
  - 不改 `unified-shell-routing` / `workspace-state-management` 的 keyboard / overlay 状态机
  - 不改 ui-office public API surface (KanbanOverlay 现有 props 保持向后兼容,只增不改)
  - 不改 `boss_proxy` / `human_in_loop` 现有路径 (这两条是 pre-change baseline,所有 invariant 必须 byte-identical)
- **构建/依赖** :无新外部依赖。新增 db-local migration 是 ALTER 风格 idempotent,不破坏既有 company。
- **回归面** :
  - 长程能力 5 件套涉及 `conversation-budget-service` 的内部组合 (existing capability spec `conversation-budget-service-boundaries` 锁住其 ≤180 NBNC barrel 不变量) — 必须保证 micro-compact / rolling-journal 落在 sibling module 而不是 inline 进 barrel。
  - YOLO Master 加进现有公司模板,需要 idempotent ensure 不重复种入。已有 company 在 platform / Tauri 启动时跑一次 `ensureYoloMasterForActiveCompanies`。
  - kanban_cards 表新增不破坏 projects 表;migration 用 `CREATE TABLE IF NOT EXISTS` 风格。
- **验证** :
  - **CLAUDE.md "Validation Policy" 强约束** — 不引 vitest / playwright / 旧 smoke。所有 invariant 走 deterministic harness scenario JSON (放 `packages/core/harness/scenarios/`)、`packages/core/src/testing/{soak-runner,scenario-runner,fake-gateway,replay-gateway,invariant-assertions}` 的现有基建,纯函数逻辑用 `node --test` (`*.test.mjs`)。
  - 产品验收走 **live agent 手测** — `pnpm dev` + 浏览器 / `pnpm --filter @offisim/desktop dev` + 真实 Tauri 桌面,手动跑 10 项产品 closure checklist。
  - harness `pnpm harness:contract` + `pnpm harness:replay` + `pnpm harness:soak` 在 RC tag 之前必须全绿。
