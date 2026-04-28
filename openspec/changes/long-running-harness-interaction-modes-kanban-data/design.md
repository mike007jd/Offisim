## Context

三个 capability 同 RC 落地,共享一份长程稳定性底子,但物理隔离 — `long-running-runtime` 落 `packages/core/src/services/conversation-budget/` + `packages/core/src/a2a/` + `packages/core/src/runtime/`,不破坏 `conversation-budget-service-boundaries` 已锁的 ≤180 NBNC barrel 不变量;`interaction-modes` 落 `packages/shared-types/src/interactions.ts` + `packages/core/src/graph/main-graph.ts` + `packages/core/src/templates/`;`kanban-data-pipeline` 落 `packages/db-local/src/schema.ts` + `packages/core/src/runtime/repos/` + `apps/platform/src/routes/` + `apps/desktop/src-tauri/` + `packages/ui-office/src/components/kanban/`。

参考行为 (read-only,不复制代码):`/Users/haoshengli/Seafile/WebWorkSpace/ClaudeSource/claude-code-haha copy/src/services/compact/microCompact.ts` (微压缩窗口选择)、`.../snipCompact.ts` (字节裁剪 marker)、`.../sessionMemory/sessionMemory.ts` (anchor + journal 滚动)。Offisim 的 implementation 必须用 Offisim 自有 type / repo / event-bus,**不允许从该 fork 直接拷贝**。

## Goals / Non-Goals

**Goals:**

- 80-turn YOLO scenario 能完成 (final non-system tokens ≤ 120k、micro-compact pass ≥ 3 次、anchor user objective 在最后一轮 prompt 中可见、completion-verifier 在最后一次 done 之前要求过 evidence)
- `InteractionMode` 4 值 union 在 shared-types / db-local schema (如选择持久化默认到 settings 表) / API 层 zod / UI dropdown 全部对齐,4 处任何一处与 shared-types 不一致即视为 bug
- 看板 overlay 在 `pnpm dev` live runtime 里:用户提需求 → boss_proxy 路径 pm-planner 出 plan → 卡片实时出现在 board → employee 完成 → 卡片转 done,**全程不刷新页面**
- YOLO Master 在 5 个公司模板里都有,且现有 company 启动时 idempotent 补齐 (无重复)
- 断线后浏览器/桌面重连,最后一条 agent 消息 + 当前 task 状态可恢复 (从 checkpoint-saver 拉 latest + replay 未持久化的 streaming chunk)
- harness contract / replay / soak 全绿,product live runtime closure 全绿

**Non-Goals:**

- 不重写 `conversation-budget-service.ts` barrel (已 spec-locked ≤180 NBNC,本 change 在 sibling module 落 micro-compact / rolling-journal 而不是 inline 进 barrel)
- 不重新设计 LangGraph kernel — `main-graph.ts` 只在入口加 conditional router,内部节点连接图保持现状
- 不引 vitest / playwright / 旧 smoke / AI test (CLAUDE.md "Validation Policy" 硬约束)
- 不动 `App.tsx` (web-app-shell-boundaries spec 锁住)
- 不引 React Context / 全局 store (复用现有 `useOffisimRuntime` / `useCompany` / `useWorkspaceSessionState` 三 hook)
- 不改 ui-office public API breaking 部分 (KanbanOverlay props 只增不改)
- 不做"全局看板 / 跨 project 聚合"(scope 限单 project)
- 不做卡片拖拽 / 卡片评论 / 看板权限 (RC.1 只交付状态机切换 + agent 写卡 + overlay 显示)
- 不做 i18n 化 SessionMode 标签 (英文 'SOP' / 'Direct' / 'YOLO',i18n 留给后续)

## Decisions

### Decision 1: micro-compact 是 sibling module,不是 budget-service barrel 的内部 method

**Why:** `conversation-budget-service-boundaries` spec 锁住 barrel ≤ 180 NBNC,且要求"无 inline LLM 调用 / repo 写 / event emit"。如果把 micro-compact 写进 barrel 内部 method,会 (a) 把 barrel 撑过 180 行,(b) 让"按 tool-result 字节裁剪"这种纯函数逻辑混进 budget orchestrator,违反单一职责。

**做法:** 新建 `packages/core/src/services/conversation-budget/micro-compact.ts` (导出 `microCompactMessages(messages, opts)` 纯函数) + `packages/core/src/services/conversation-budget/rolling-journal.ts` (导出 `RollingJournal` 类,持有 anchor + 周期 summarize)。`conversation-budget-service.ts` barrel 在 `prepareRequest` 流程中调用这两个 sibling,但 barrel 自己不实现压缩 / journal 逻辑。

**Trade-off:** 多 2 个文件,但 barrel 不变 barrel,符合现有 spec。

### Decision 2: `forkSubContext` 是 a2a 之外的独立原语

**Why:** A2A v1.0 协议是 inter-agent message exchange,parent context 持续累积。"开 fresh child context、只回吐 summary"是和 A2A 不同的 mental model — 它更接近 claude-code Agent tool 的 fork。强行塞进 a2a-client 会污染协议层。

**做法:** 新增 `packages/core/src/a2a/fork-sub-context.ts`,导出 `forkSubContext(input)` 函数,签名 `{ subTask: string; runChild: (msgs) => Promise<{ summary, transcript }> } → Promise<{ summary, childTokensUsed? }>`。`A2AClient` 加便利 `fork()` 方法做 wrapper,调用 `forkSubContext` 内部完成 child A2A 调用。

**Trade-off:** A2AClient 多了一个不严格属于 A2A 协议的方法,但产品上 fork 概念和 inter-agent messaging 同居于"agent 协作"语义,放一起减少认知跳转。

### Decision 3: `task.completion.verifying` hook 而不是 hard validator

**Why:** 不同 company / 不同 project 的 verification 命令不同 (前端项目用 `pnpm test` + `pnpm typecheck`,后端可能用 `pytest`,数据项目可能用 `dbt test`)。如果 hard-code allow-list 在 employee-completion 里,只支持有限场景。但完全不约束又会让 agent 谎报。

**做法:**`HookRegistry` 加 event variant `'task.completion.verifying'`,payload 含 `recentToolResults` + `allow()` / `block(reason)` 同步回调。employee-completion-node 在转 `done` 之前 emit 此 event,默认 hook (`completion-verifier.ts`) 走仓库默认 evidence allow-list (`['pnpm-test', 'pnpm-typecheck', 'pnpm-lint', 'harness-contract']`),用户可注册自己的 hook 替换。无 evidence 则降级到 `review` 状态。

**Trade-off:** 灵活但稍复杂;通过默认 hook 保证开箱即用。

### Decision 4:`InteractionMode` 扩 4 值 union,不拆两个独立维度

**Why:**"决策链长度"和"是否人审批"在产品认知里是一根 dropdown,拆两个开关用户要算一个矩阵 (2×2 = 4 种,但 `yolo + human_in_loop` 在直觉上自相矛盾)。一个 union 让 UI 一个 dropdown,product 心智清晰。

**做法:**`InteractionMode = 'boss_proxy' | 'human_in_loop' | 'direct_to_employee' | 'yolo'`。`human_in_loop` 含义保持不变 (走 boss_proxy 链路 + 强 plan-review-gate);新加的两个值对应"决策链短路"。如果未来产品发现需要"yolo + 强 review",再拆 dimension。

**Trade-off:** 4 值 union 在 spec / db / API / UI 4 处需要保持一致 — `tasks.md` 列了类型一致性 checklist。

### Decision 5: YOLO Master 是公司模板内置员工 + idempotent ensure,不是"无角色 special agent"

**Why:** 两条路:(A) YOLO Master 是 company-scoped 员工,role_slug `yolo_master`,有 persona、avatar、appears in employee panel;(B) YOLO Master 是 graph-level 特殊节点,不在 company / employee 表里。

走 (A) 的好处:用户在 office 视图直接能看到 YOLO 大师头像,直派模式可以"点 YOLO 大师" = 等价于 yolo 模式 — 直派和 yolo 共享同一个 entry,心智更统一。

走 (B) 的好处:不污染 company / employee 数据模型。

**选 (A)。** YOLO Master 加进 5 个公司模板的 employees array,新建 company 时随模板种入。已有 company 在 platform / Tauri 启动时跑 `ensureYoloMasterForActiveCompanies()` idempotent 补齐 (`employees.findByRoleSlug('yolo_master', companyId)` 缺失则插入)。

**Trade-off:** YOLO 大师占一个员工 slot;但产品上"找一个特殊员工"和"找其他员工"用同一交互,直觉一致。

### Decision 6: 看板表落 `db-local` (SQLite),不落 `db-platform` (PostgreSQL)

**Why:** projects / employees / companies / meeting_sessions 全在 db-local。看板和 project 强 FK 绑定,跨库会引入分布式 join。db-platform 是 marketplace / auth / 跨用户共享数据,看板属于"我的桌面里的此 project"语义 — 走 db-local 零摩擦。

**Trade-off:** 看板暂不支持"云端同步 / 多设备共享"。如果未来要,新建 `db-platform.kanban_cards_replica` 同步表,db-local 作为 source of truth。本 RC 不做。

### Decision 7: KanbanOverlay 的数据来自 `useKanbanStream(projectId)`,不内嵌 fetch

**Why:** ui-office 是 product UI 包,跨 web / desktop 复用。如果 KanbanOverlay 内嵌 `fetch('/api/...')` 会和 web 强耦合,desktop 不能用。

**做法:** ui-office 的 KanbanOverlay 接受 `cards: KanbanCard[]` + `onMove(id, next)` props。`apps/web/src/runtime/useKanbanStream.ts` 负责 web 侧 fetch + EventSource SSE,desktop 侧用 `apps/desktop/src-tauri-binding` 同名 hook 走 Tauri command + invoke。两个 hook 共享同一份 `KanbanCard` type (从 shared-types 导出)。

**Trade-off:** 多写一份 desktop hook,但 web/desktop 完整一致。

### Decision 8: 看板抽屉视觉 = 复用现有 .glass-panel + 海洋色板,不引入工业 / 木纹 / 黑板纹理

**Why:**`apps/web/src/index.css` 已经有完整海洋赛博色板 (`abyss / ocean-deep / kelp-green / coral-orange / sea-blue / shell / foam / pearl`) + `.glass-panel` (blur 24px + 圆角 1.5rem) + `.cyber-button`。Kanban "黑板从天花板拉下"的隐喻是**布局**,不是**纹理** — 用木纹/金属/粉笔会撕碎现有视觉一致性。

**做法:** KanbanOverlay 容器用 `.glass-panel`、顶部 2px 接缝 = sea-blue → kelp-green → sea-blue 渐变 + 蓝绿光晕(生物荧光)、origin pill 用海洋色 (pm-planner=sea-blue / employee=kelp-green / manager=coral-orange / human=foam)、关闭按钮用 `.cyber-button`、间距用 `--sp-*` token。具体 CSS 见 `tasks.md` Task 6.x。

### Decision 9: live runtime 验证 = 唯一产品 closure bar,harness scenario = 不变量证明

**Why:** CLAUDE.md "Validation Policy" 明确:"绿 typecheck / build / harness contract 只代表代码能编 + graph 不变量没破,不代表功能完成"。

**做法:**
- **harness scenario JSON** (放 `packages/core/harness/scenarios/`):新增 `long-running-microcompact-triggers.json`、`yolo-mode-skips-boss-chain.json`、`completion-verifier-blocks-without-evidence.json`、`kanban-card-state-transitions.json`。 `pnpm harness:contract` + `pnpm harness:replay` 跑这些。
- **soak scenario** (`packages/core/src/testing/soak-runner.ts` 现成):新增 `yolo-80-turn-multi-file-refactor.json`,跑 `pnpm harness:soak`。
- **product live runtime 验收**:`tasks.md` 最后一节列 12 项 manual checklist,每项要在 `pnpm dev` + 真实浏览器 / `pnpm --filter @offisim/desktop dev` + Tauri release `.app` 跑过且观察到预期行为。**没有任何 vitest / playwright 测试**。

## Risks / Trade-offs

1. **80-turn soak 可能 flaky** — 跑真实 LLM API,受 rate limit 影响。soak-runner 现有重试机制要确认能 cover;如果不能,scenario 加 `tolerances.retry: 3`。
2. **YOLO Master idempotent ensure 时机** — platform / desktop 启动时跑会拖慢冷启动 (5 个 company × 1 query each)。可接受 (单次启动 < 200ms);若超就改成"打开 company 时按需检查"。
3. **micro-compact 误删 critical state** — 如果某个超大 tool result 是 user 重要数据 (e.g. paste 进来的 5000 行 csv),被 micro-compact marker 替换会丢上下文。**对策:**`microCompactOptions.preserveLastN: number` 默认 1,保护最近 1 个 tool result 不被裁;additional 加 user-pinned mechanism (本 RC 不做,留 follow-up)。
4. **资源恢复时机** —`ResumeCoordinator` 拉 latest checkpoint 后,若有未持久化的 streaming chunk 在 LLM 调用中,无法重发。**对策:**checkpoint-saver 加 `chunk-buffer` 字段,每 N 字 token 落盘一次;若仍丢,user 看到 partial assistant message + ResumeBar 提示重发最后一条 user message (现有 `apps/web/src/runtime/last-failed-message.ts` 机制)。
5. **InteractionMode 4 值跨 4 处一致性** — 类型 / db schema / zod / UI 任一处忘改即 bug。**对策:**`tasks.md` 显式列 4 处声明位置,每改一处必须 grep 其他三处确认。
6. **ui-office KanbanOverlay 现有 props 假设** — 当前 props 含 `requestText?` 等,若改 props 形状会 break dist。**对策:**只增不改 — 加 optional `cards` / `onMove` / `onCreate` props,旧 caller (传 `requestText`) 不变。
7. **Tauri release `.app` 验收依赖** — AGENTS.md 强约束:"用 Computer Use 测 Tauri 桌面端时,默认测 release `.app`,不要把 dev webview 结果当作最终桌面验收。"`tasks.md` 最后一节 closure checklist 区分 web (浏览器) 和 desktop (release `.app`),分别跑。
8. **OpenSpec spec scenario 可能漏 invariant** — 三个 capability 各有 5–10 个 requirement,scenario 写少了会让未来回归时检测不到。**对策:**`tasks.md` Task 1 (Pre-flight) 要求把 baseline 行为采样存到临时文件,Task 7 (Validation) 要求逐项对回 scenario,缺即补。

## Migration Plan

按 capability 物理隔离 + RC 一次发布:

1. **Phase A (long-running-runtime,不依赖其他)** — micro-compact + rolling-journal + fork-sub-context + completion-verifier + resume-coordinator。打 tag `phase-a-long-running-runtime`。
2. **Phase B (interaction-modes,依赖 A 的 completion-verifier)** — InteractionMode union 扩、main-graph router、yolo-master-node + persona、5 模板种入、idempotent ensure、SessionModeSwitcher UI。打 tag `phase-b-interaction-modes`。
3. **Phase C (kanban-data-pipeline,可与 B 并行,但实际顺序后做)** — kanban_cards 表、KanbanRepo、pm-planner 写卡、employee 转卡、platform / Tauri route、useKanbanStream、KanbanOverlay 接数据、视觉对齐。打 tag `phase-c-kanban-data-pipeline`。
4. **Phase D (整合与 RC)** — harness scenario 跑全绿 (`pnpm harness:contract` + `replay` + `soak`)、product live runtime 12 项 closure checklist 跑全绿 (web 浏览器 + Tauri release `.app`)、CHANGELOG 更新、`v1.1.0-rc.1` tag。

每个 Phase 末尾打 git tag 是天然 checkpoint,可作为 codex 自然中断点。

依赖错位:`interaction-modes` 的 `todo_*` 工具调用 `KanbanRepo`,但 KanbanRepo 在 Phase C。**解法:**Phase B 的 Task 4.6 (todo_* 工具) 在 Phase C 的 Task 5.2 (KanbanRepo) 完成之后做。`tasks.md` 显式标了执行顺序而非按 capability 严格串行。
