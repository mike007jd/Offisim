## Why

V3 设计稿把 Office shell 定为：titlebar(40px) + topbar(54px:scope-bar `Company>Project` | nav 4 pills 居中 | iconbar=Activity+Settings，office 加 Studio，**无铃铛**) + 三栏(左 296px File/Git/SOP widget、中 stage 等距场景 + mode toggle + **右下角 diegetic cost readout + 通知 dot**、右 448px chat 已属 Phase 1)。当前 shell 把 cost/run-state/git-branch 塞进**全局底部 StatusBar**、通知是**铃铛+count badge**、有 **Boss Dashboard 入口**、git 在右栏 tab、左栏只有员工列表。V3 DNA §2 明确要删除：底部状态栏、铃铛+count、Boss Dashboard 入口。用户截图确认 Board/Live stage 浮层不是 layout 参考，而是旧 chrome 回流，Phase 2 必须删除它。依赖 Phase 0 token + Phase 1 右栏。

## What Changes

- **删全局 StatusBar**：移除 `StatusBar.tsx` + `AppMainShell` 的 `<StatusBar>` 渲染与三槽（dashboardSlot/notificationSlot/gitBranchSlot）。run-state/cost/token/branch 不再进 app footer。
- **diegetic cost readout**：stage 右下角 `.scene-cost` pill（blur、`--line` border、`--r-pill`、26px），显示 cost·token（live 时 `--accent-ring` 边 + pulse dot）。读现有 `useDashboardMetrics`。
- **通知 dot（无铃铛、无 status-bar count chrome）**：`.sc-notif` 圆 26×26 button 紧邻 cost，unread 用 `.nb-dot` 角标（按 prototype skin 可带 compact count；states prototype 的纯 dot 是同一 marker 的等价皮肤），**无铃铛、不长成 StatusBar 那种 count 段**；保留通知列表为 popover。`NotificationCenter` 铃铛+count 重设计为该角标。
- **删除 stage 运行轴浮层（Board + Live）**：不再渲染 `.stage-runaxis`、Board tab、Live tab 或 Live popover。KanbanTray 数据/CAS/快捷键保留，但入口不属于 scene chrome；run 过程沉淀归 assistant-ui 右栏 run-record 承接。
- **删 Boss Dashboard 入口**（V3 DNA §2）：single-run cost 进运行流(diegetic readout)，跨项目账本 v1-deferred；移除 Dashboard tool entry + overlay 入口 + Dashboard/Kanban 互斥逻辑。
- **左栏 296px 多 tab（Files/SOPs/Git，按 prototype label + 顺序）**：把右栏 Git tab 的 `GitWorkbench`（branch/diff/commit/PR-ready，已是真实 repo 状态）搬到左栏 Git tab；Files(file tree) + SOPs(details) 并列（SOPs/Git 带 count badge）。右栏不再有 Git tab（Phase 1 已单轴）。
- **员工 roster 落 stage**：左栏被 Files/SOPs/Git 占用，`AgentPanel`（现挂 `agentPanel` slot）的员工列表移到 stage —— 场景内 avatar + stage 下方横向 Team dock 条（avatar + name + status dot + 末尾 Add slot）。destination 已拍板，不留 apply-time open，保跨表面可达性。
- **StatusBar residents 全迁移（无静默丢失）**：EnergyMeter(token+cost) → `.scene-cost` readout；run-state headline + Stop → stage `.stage-pipe`；latency/model name/run-record → assistant-ui 右栏；pending-interaction label（Approval/plan-review/clarification）→ `.stage-pipe` cue + 右栏 interaction bubble / HIL modal（Phase 1/lifecycle）。
- **topbar grammar V3**：scope-bar(Company>Project chip-grammar)、nav 4 pills 居中(active=accent-surface + inset ring)、iconbar=Activity+Settings(office 加 Studio，分隔线)，**无铃铛**。
- **layout 常数**：左 300→296、右 360→448。

**不在范围**：chat 右栏（Phase 1）；3D 场景美术（B1）；surface 配色（Phase 0）；scene canvas 渲染逻辑（仅留 stage insets 给浮层/readout）。

## Capabilities

### New Capabilities
- `office-shell-v3`: V3 shell 契约 —— titlebar/topbar/nav/iconbar grammar(无铃铛)、三栏 296/stage/448、左栏 Files/SOPs/Git tabs、员工 roster 落 stage(Team dock + 场景 avatar)、无全局 status bar、stage 右下 diegetic cost readout + 通知 `.nb-dot` 角标、`.stage-pipe` run-state + Stop、stage 不允许 Board/Live 浮动 tab 或 Live popover。

### Modified Capabilities
- `responsive-app-shell`: 改 base `App shell supports desktop tablet and narrow viewports`(Office 不再有全局 StatusBar footer，"Desktop workspace retains full shell" 不再列 StatusBar) + `Fixed bottom action areas reserve readable content space`(Office 排除 sticky footer)。run-state/cost/branch 改 diegetic；非 Office sticky footer 不变。
- `office-tool-discovery`: 改 base `Office tools are visible and distinct from peer workspaces`(header office tool 缩为 Studio，不再列 Dashboard/Kanban/Add-Employee)；Boss Dashboard 入口移除；Board/Live 不再作为 scene chrome；通知改 diegetic `.nb-dot` 角标(无铃铛)；Dashboard/Kanban 互斥要求 REMOVED。

## Impact

- 代码：删 `packages/ui-office/src/components/layout/StatusBar.tsx` + `AppMainShell` 相关块；改 `AppLayout.tsx`(常数 296/448、删 statusBar slot)；新增 `SceneCostReadout` + 改 `NotificationCenter`→dot；删除 `StageRunAxisFloats`/`LiveRunOverlay` 旧浮层；左栏多 tab 容器 + `GitWorkbench` 左移；`OfficeSceneSurface` 加 stage insets。
- blast radius：`AppMainShell` 是唯一 `<StatusBar>` 消费者；删 StatusBar 波及 dashboardSlot/notificationSlot/gitBranchSlot 提供方 + `useGitBranch`（branch 改进 GitWorkbench）；`useDashboardMetrics` 改由 cost readout 消费。CLAUDE.md StatusBar 三槽 / taskTray 锁定规则需同步更新。
- 文档：更新 root CLAUDE.md「Header/StatusBar/Tasks·Kanban·Git 职责锁定」章节为 V3 shell。
- 验收 gate：typecheck + 串行 build；release `.app` live 验：无底部状态栏 / cost readout diegetic / 通知 `.nb-dot` 角标无铃铛 / stage 无 Board/Live 浮动 tab / `.stage-pipe` Stop + pending-interaction cue 仍可见 / 左栏 Files-SOPs-Git / 员工 Team dock 可达 / topbar 无铃铛 / Dashboard 入口消失。
