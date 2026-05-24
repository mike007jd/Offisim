## Context

当前 shell：`App.tsx`→`AppMainShell.tsx`（唯一渲染 `<StatusBar>`，注入 dashboardSlot/notificationSlot/gitBranchSlot；taskTray=KanbanTray；右栏 gitSlot=GitWorkbench）→ `AppLayout.tsx`（LEFT 300/RIGHT 360，taskTray 顶部浮层，statusBar footer）。`StatusBar.tsx`（RunStateSegment/WorkSegment/ResourcesSegment + 3 slot）。`NotificationCenter`（铃铛+count+dropdown）。`useGitBranch`（git_exec rev-parse）。`GitWorkbench`（右栏 Git tab：snapshot/diff/commit/PR-ready，真实 repo）。`OfficeSceneSurface`（中心 stage，无浮层）。Dashboard = Header officeTools entry + overlay。

V3 prototype `:289` `grid-template-columns: 296px minmax(620px,1fr) 448px`；`.scene-cost`/`.sc-notif`(:124-133)；`.gw-*` git widget(:540-597)；左栏 `.ws-tabs` File/Git/SOP。用户截图已判定 `.stage-runaxis`/`.stage-entry` 不是可照搬对象，Office stage 不允许再承载 Board/Live 浮动 tab。

## Goals / Non-Goals

**Goals:** shell = V3（删状态栏/铃铛count/Dashboard 入口；加 diegetic cost readout + 通知 dot；删除 Board/Live stage 浮层；左栏 File/Git/SOP；topbar grammar；296/448）。

**Non-Goals:** chat 右栏（Phase 1）；scene canvas 渲染/3D 美术（B1）；surface 配色（Phase 0）；git 业务逻辑（GitWorkbench 已真实，仅搬位置 + 适配 296px）。

## Decisions

### D1 — 删 StatusBar，cost/run-state 改 diegetic
移除 `StatusBar.tsx` + `AppMainShell` 渲染块 + AppLayout statusBar slot。新增 `SceneCostReadout`（stage 内 absolute right/bottom，消费 `useDashboardMetrics`，`.live` 时 accent-ring + pulse dot）。run-state 和 pending interaction 进 `.stage-pipe`，不通过 Board/Live 浮动 tab 承载。
**理由**：V3 DNA §1「diegetic over chrome」+ §2 删状态栏。

### D2 — 通知 dot（无 count），保留列表 popover
`NotificationCenter` 铃铛+count → `.sc-notif`（26×26 圆 button，unread=dot marker，无数字）+ popover 列表（复用 NotificationCard）。位置紧邻 cost readout。
**理由**：V3 DNA §2 禁铃铛+count badge。

### D3 — 删除运行轴 Board/Live stage 浮层
不新增也不保留 `StageRunAxisFloats`。stage 顶部不承载 Board tab、Live tab、Live popover 或类似浏览器页签的浮动 chrome。KanbanTray 数据/CAS/⌘J 快捷键保留；可视入口后续只能属于 topbar framework 或 assistant-ui 右栏，不属于 scene chrome。run-record 沉淀归 Phase 1 右栏承接。

### D4 — 删 Boss Dashboard 入口
Dashboard **不是** OverlayKey（`OverlayKey = 'employee-creator' | 'office-editor' | 'company-select' | 'studio'`，见 `apps/desktop/renderer/src/lib/app-view-layout.ts`）。它是 `officeState.dashboardOpen` 字段 + modal id `'dashboard-overlay'`。删除要打到真实站点：
- `workspace-navigation.ts`：从 `OfficeToolId`（现 `'studio' | 'dashboard'`）移除 `'dashboard'`，删 `OFFICE_TOOL_*` 的 dashboard 项 + `buildOfficeToolItems` 的 dashboard 分支（officeTools 缩为只剩 studio）。
- `useOfficeStateBindings.ts`：删 `handleToggleDashboard` + `dashboardOpen` 字段；删 `handleToggleKanban` 里 `dashboardOpen: next ? false : …` 的互斥行（kanban 不再与 dashboard 互斥）。
- `useAppKeyboardShortcuts.ts`：删 ⌘D 分支（`e.key.toLowerCase() === 'd'` 的两段：`getTopmostModalId() === 'dashboard-overlay'` 的关闭分支 + toggle 分支）+ 相关 `officeState.dashboardOpen` 依赖。⌘J Kanban 快捷键保留。
- `AppMainShell.tsx`：删 `dashboardSlot`（随 StatusBar 一起删）。
single-run cost 进 diegetic `.scene-cost` readout；跨项目账本 v1-deferred（无替代、不给假家）。`DashboardOverlay` 组件保留无入口（v2 跨项目账本）还是随删——apply 时定，倾向保留组件、删入口。
**理由**：V3 DNA §2 明确删 Dashboard 入口。

### D5 — 左栏 296px Files/SOPs/Git tabs（注意 label + 顺序）
左栏从单一 AgentPanel 改 `.ws-tabs`，tab label + 顺序按 prototype = **`Files` / `SOPs` / `Git`**（不是 File/Git/SOP；SOPs/Git 带 count badge）。Files = file tree，SOPs = SOP details，Git = `GitWorkbench`。`GitWorkbench` 从右栏 gitSlot 搬左栏 Git tab，样式适配 296px（branch/metrics/files+diff/commit/PR-ready 逻辑不变）。`useGitBranch` 的 branch 显示并入 GitWorkbench head。

### D5b — 员工 roster 落 stage（已拍板，非 open）
左栏被 Files/SOPs/Git 占用后 `AgentPanel`（员工列表，现挂 `AppMainShell` 的 `agentPanel` slot = AppLayout LEFT 鸟）被挤掉。**destination 已定**（不留 apply-time open）：员工 = 场景内 avatar + stage 下方横向 **Team dock 条**（`.team-row` / `.dock-strip`：每人 avatar + name + status dot，末尾 `Add` slot 开员工创建）。员工选中 / inspector 继续锚到 Personnel routing，跨表面可达性不丢。**不允许**把"保员工可达性"降级成 apply 时验证；Team dock + 场景 avatar 是承诺的落点。
**理由**：prototype 左栏无员工列表，员工在 stage（in-scene avatars）+ Team dock；roster 是核心可达性，必须有明确归属。

### D6 — topbar grammar + 常数
scope-bar(Company>Project，container-grammar)、nav 4 pills 居中(active=accent-surface + inset ring)、iconbar=Activity+Settings(+office Studio，1px 分隔)，无铃铛。AppLayout LEFT 300→296、RIGHT 360→448。

## Phase 边界归属（frozen cross-phase decision）

- Office rail seam（vs Phase 1 `rebuild-chat-rail`）：**Phase 2 OWNS** rail 宽度/位置（296/448）+ 左栏 Files/SOPs/Git + StatusBar 删除 + `.stage-pipe` run-state/Stop + 删除 scene Board/Live 浮层。**Phase 1 OWNS** 右栏内列（thread / composer / run-record + composer model-chip）。「run 结束沉淀进 thread run-record」的 **DATA CONTRACT 归 Phase 1**，本 change 不在 scene 里另建 Live entry shell。

## Risks / Trade-offs

- **删 StatusBar 波及 slot 提供方 + hooks**（useDashboardMetrics/useGitBranch/RunState/Work/Resources segments）→ 逐个迁移：EnergyMeter(token+cost) → `.scene-cost` readout；run-state headline + Stop → stage `.stage-pipe`；latency/model name/run-record → 右栏 Phase 1；pending-interaction label → `.stage-pipe` cue + 右栏 interaction bubble / HIL modal(Phase 1/lifecycle)。run-state headline + Stop + pending-interaction 都不能丢。
- **Live 广播 vs run-record 边界**（跨 Phase 1）→ Phase 2 不做 Board/Live entry 壳；sediment 数据契约归 Phase 1，本 change 不断言 sediment 行为。
- **员工 roster 位置已拍板**（见 D5b）→ stage in-scene avatars + Team dock 条 + Add slot，不留 apply-time open，不降级成"保可达性验证"。
- **Dashboard 删除打真实站点**（非 overlay key）→ `workspace-navigation.ts` 删 `'dashboard'` OfficeToolId；`useOfficeStateBindings.ts` 删 `handleToggleDashboard` + `dashboardOpen` + 互斥行；`useAppKeyboardShortcuts.ts` 删 ⌘D 分支（含 `'dashboard-overlay'` modal id 关闭分支）；`AppMainShell.tsx` 删 dashboardSlot。⌘J Kanban 保留。
- CLAUDE.md 三槽锁定规则与 git tab 归属过时 → 同 change 内更新 root CLAUDE.md。

## Migration Plan

1. AppLayout 常数 296/448 + 删 statusBar slot。
2. 删 StatusBar + AppMainShell 块；run-state/cost 迁 SceneCostReadout；branch 迁 GitWorkbench。
3. NotificationCenter → dot + popover。
4. 删除 StageRunAxisFloats / LiveRunOverlay 旧浮层，保留 KanbanTray 数据/CAS/⌘J。
5. 左栏 Files/SOPs/Git tabs（label/顺序按 prototype）+ GitWorkbench 左移；员工 roster 落 stage（in-scene avatars + Team dock + Add slot）。
6. 删 Dashboard 入口：`workspace-navigation.ts` 去 `'dashboard'` OfficeToolId + `useOfficeStateBindings` 删 `handleToggleDashboard`/`dashboardOpen`/互斥行 + `useAppKeyboardShortcuts` 删 ⌘D（含 `'dashboard-overlay'` 分支）+ `AppMainShell` 删 dashboardSlot。⌘J Kanban 保留。
7. topbar grammar。
8. 更新 CLAUDE.md。串行 build + live 验。
9. 回滚：shell 层改动集中，单 commit 可 revert（不动数据/runtime/kanban CAS）。

## Open Questions

- DashboardOverlay 组件保留（v2 跨项目账本）还是随删（apply 决定，倾向保留无入口）。
- Phase 1 run-record sediment 数据契约的对接细节（Phase 1 owns 契约；Phase 2 不在 scene 新建 Live entry）。
