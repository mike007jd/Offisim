## 1. Layout 常数 + 删 StatusBar

- [x] 1.1 `AppLayout.tsx`：LEFT 288、RIGHT 448；删 statusBar slot + 相关 footer reserve
  - **已做**：`LEFT_PANEL_WIDTH=288` / `RIGHT_PANEL_WIDTH=448` 是 AppLayout 的单一 rail 宽度来源，渲染用 `w-72` / `w-112`，同一常量通过 `onLayoutMetricsChange` 传给 scene insets。旧 `.w-office-left-expanded` / `.w-office-right-expanded` utility 已移除，避免 CSS 死 truth source。
- [x] 1.2 删 `packages/ui-office/src/components/layout/StatusBar.tsx`；删 `AppMainShell` 的 `<StatusBar>` 渲染块 + 三槽注入 + 相关 import
  - **已做**：删 `StatusBar.tsx` + 仅它消费的 `EnergyMeter.tsx`；index.ts/web.ts 去掉 StatusBar export；AppMainShell 删 `statusBar` slot + dashboardSlot/notificationSlot/gitBranchSlot + `StatusBar`/`Button`/`useGitBranch` import。`use-active-employee-count`/`usePipelineStage`/`useDashboardMetrics` 只在注释提到 StatusBar，无类型/helper 耦合，删除干净；`OfficeEditorOverlay` 用的是另一文件 `office/editor/StatusBar.tsx`（Studio editor，保留）。`pendingInteractionLabel` helper 不再需要（已 diegetic 化进 `StagePipe` 的 `Needs input` cue）。

## 2. Diegetic cost readout + 通知 dot + StatusBar residents 迁移

- [x] 2.1 `SceneCostReadout`（stage 内 absolute right/bottom，消费 `useDashboardMetrics`；`.live` accent-ring + pulse dot）——这是 StatusBar EnergyMeter(token+cost) 的落点；**latency 不进这里**（归 assistant-ui 右栏/run-record）
  - **已做**：`apps/desktop/renderer/src/components/office-shell/SceneCostReadout.tsx`，`bottom-sp-6 right-sp-7` absolute pill，`useDashboardMetrics` token+cost，`useOffisimRuntimeStatus().isRunning` → accent-ring border + pulse beat dot。无 latency。
- [x] 2.2 `NotificationCenter` 改 `.sc-notif`（26×26，unread = `.nb-dot` 角标…；无铃铛、无 status-bar count chrome）+ popover 列表（复用 NotificationCard）；紧邻 cost readout
  - **已做**：重写 `NotificationCenter` 为 26×26 圆 button（内含 Bell glyph，per prototype）+ `.nb-dot` 角标（compact count）+ popover（复用 `NotificationCard`），V3 token skin。作为 `SceneCostReadout` 的 `notificationSlot` 紧邻渲染。Header 不再 mount notification slot（bell+count header chrome 删）。
- [x] 2.3 `OfficeSceneSurface` 加 stage insets（右下 readout + worker zone 上方 `.stage-pipe` 预留），不改 canvas 渲染逻辑
  - **已做**：scene 容器改 `relative`，新增 `pointer-events-none absolute inset-0` overlay 层挂 `StagePipe`/`SceneCostReadout`（各自 `pointer-events-auto`），canvas props/渲染逻辑零改动。Team dock 走单独 bottom-pinned `teamDockSlot`（inset 居中）。**2026-05-24 修正**：删除 stage 顶部 `StageRunAxisFloats`，避免截图中的 Board/Live floating-tab chrome 回流进 scene。
- [x] 2.4 `.stage-pipe` diegetic 运行态 pill：run-state headline（step + assignee + progress）+ Stop（`isRunning && onAbort` → `abortExecution()`）；abort 后 collapse 成 muted "Stopped at #N" + Resume/Discard。**Stop 不进右栏 composer**
  - **已做**：`StagePipe.tsx` 消费 `usePlanStepStore`（step+assignee+progress bar+`stats`）+ `usePipelineStage`(fallback headline) + `useOffisimRuntimeExecution.abortExecution/resumeThread`。Stop 仅 `isRunning` 时渲染，点击捕获 `{stepLabel, threadId}` 后 `abortExecution()`；run 停后 collapse muted `Stopped at #N` + Resume(`resumeThread(activeThreadId)`)/Discard。pendingInteraction 时显 `Needs input` cue。**决定**：Resume 目标用从 stage 传入的 `activeThreadId`（`officeState.selectedThreadId`）。
- [x] 2.5 pending-interaction 不丢：结构化进 `.stage-pipe` cue；actionable prompt 走右栏 interaction bubble / HIL modal；model name 去 composer model-chip（Phase 1）
  - **已做**：`StagePipe` 显 `Needs input` cue（`useOffisimRuntimeInteraction().pendingInteraction`）；删除 `LiveRunOverlay`，避免 pending/run 状态再通过旧 scene popover 承载；actionable prompt + model-chip 归 Phase 1 chat-rail（本 change 不在 shell chrome 放 model name）。

## 3. 删除旧 Board + Live 浮层

- [x] 3.1 删除 `StageRunAxisFloats`（stage 上方旧浮动 tabs）：KanbanTray 数据/CAS 不变；Live 不再有 scene entry
  - **已废止 2026-05-24**：用户截图确认 stage 顶部 Board/Live 是旧 floating-tab 观感，不属于新 layout framework。删除 `StageRunAxisFloats.tsx` + stage-axis primitives/CSS；KanbanTray 数据/CAS/`officeState.kanbanOpen`/⌘J 保留，但不再通过 scene 内浮动 tab 暴露。Live 广播后续并入 chat/run-record 或 topbar framework，不再作为 scene chrome。
- [x] 3.2 Live entry **shell** + active state：active 时开 run-broadcast overlay（Plan + Activity，latency 在 header）；taskTray chip 入口收进运行轴。**sediment 数据契约归 Phase 1**——只对接 Live entry 壳
  - **已废止 2026-05-24**：删除 Live scene entry 与 auto-open popover，防止 run UI 继续以绝对定位浮层压在 scene 上。run-record/outputs 归 assistant-ui chat rail 承接。

## 4. 删 Boss Dashboard 入口（打真实站点，Dashboard 不是 OverlayKey）

- [x] 4.1 `workspace-navigation.ts`：从 `OfficeToolId` 移除 `'dashboard'`，删 dashboard 项 + `buildOfficeToolItems` dashboard 分支（officeTools 只剩 studio）
  - **已做**：`OfficeToolId = 'studio'`；删 `LayoutDashboard` import + ICON/LABEL/SHORTCUT dashboard 项 + `BuildOfficeToolsOptions.dashboardOpen/onToggleDashboard`；`buildOfficeToolItems` 只产 studio。
- [x] 4.2 `useOfficeStateBindings.ts`：删 `handleToggleDashboard` + `officeState.dashboardOpen` 字段；删 `handleToggleKanban` 互斥行
  - **已做**：删 `handleToggleDashboard` + API 字段；`handleToggleKanban` 改纯 `kanbanOpen` toggle（无 dashboard 互斥）。
- [x] 4.3 `useAppKeyboardShortcuts.ts`：删 ⌘D 两段 + `officeState.dashboardOpen` 依赖；保留 ⌘J Kanban
  - **已做**：删两段 ⌘D 分支 + `getTopmostModalId` import + `handleToggleDashboard` dep/prop + `officeState.dashboardOpen` dep。⌘J 保留。
- [x] 4.4 `AppMainShell.tsx`：删 `dashboardSlot`（随 StatusBar 删）
  - **已做**：随 StatusBar 整块删除。
- [x] 4.5 `DashboardOverlay` 组件保留无入口 / 随删
  - **已做（倾向保留组件、删入口）**：`AppOverlayHost` 删 `DashboardOverlay` lazy import + render block + `activeThreadId` prop；`types.ts`/`useWorkspaceSessionState`(drill-back + 切换 reset)/`url-routing`(parser/serializer/types + `urlRequiresCompany`) 删 `dashboardOpen`；App.tsx 删 `anyOverlayOpen` 的 dashboardOpen + AppMainShell `onToggleDashboard` + AppOverlayHost `activeThreadId`。`DashboardOverlay` 组件 + `@offisim/ui-office/dashboard` subpath 保留。**遗留（Phase 1 chat-rail owned，未在本 change 删）**：`chat-commands.ts` 的 `/dashboard` slash + `ChatPanel.onToggleDashboard` 可选 prop——shell 不再 wire `onToggleDashboard`，slash 退化成 no-op，留 Phase 1 清理（不越界改 chat-commands/ChatPanel）。

## 5. 左栏 Files/SOPs/Git + 员工 roster 落 stage + topbar grammar

- [x] 5.1 左栏 296px 改 `.ws-tabs`（Files / SOPs / Git，SOPs/Git 带 count badge）；`GitWorkbench` 搬左栏 Git tab，适配 296px；`useGitBranch` branch 并入 GitWorkbench head
  - **已做**：`OfficeLeftRail.tsx`（Files=`ProjectWorkspaceFiles`+workspace-root strip / SOPs=模板列表 card，点击 → SOPs peer workspace / Git=`GitWorkbench`）。GitWorkbench 从右栏 gitSlot 搬来（其 head 已显 `snapshot.branch`，无需独立 `useGitBranch`）。**决定**：SOPs badge=`useSops().sops.length`（已加载，零额外成本）；**Git tab 不带 count badge**——避免为 tab 角标多跑一次 `git_exec` poll（GitWorkbench 自己懒加载 snapshot），不放假数字。**清理**：`useGitBranch.ts` 已无 caller，删除（branch 已折进 GitWorkbench head）。
- [x] 5.2 员工 roster（`AgentPanel`）落 stage——场景内 avatar + stage 下方横向 Team dock 条（avatar + name + status dot + 末尾 `Add` slot）；选中/inspector 锚 Personnel routing
  - **已做**：`StageTeamDock.tsx`（avatar=`DicebearAvatar` + name + `STATUS_DOTS[agent.state]` dot + 末尾 dashed `Add` slot 开 `onOpenEmployeeCreator`）。作为 OfficeSceneSurface `teamDockSlot` bottom-pinned 居中渲染。选中走 `onSelectEmployee` → 现有 `EmployeeInspector` + Personnel routing 不变。`AgentPanel` 不再挂左栏（仍 export，未删）。场景内 avatar 由既有 SceneCanvas 渲染。
- [x] 5.3 topbar：scope-bar(Company>Project)、nav 4 pills 居中(active accent-surface + inset ring)、iconbar=Activity+Settings(+office Studio 分隔线)，无铃铛
  - **已做**：`Header` DesktopHeader 改：左 cluster = company switcher + compact project selector(scope-bar grammar)；居中 absolute 4 peer nav pills(office/sops/market/personnel，`NAV_PILL_KEYS` 过滤，active=`accent-surface` + `ring-1 ring-inset ring-accent-ring`)；右 `WorkspaceIconBar`(Activity+Settings icon-button，`ICONBAR_KEYS`，office 加 1px divider + Studio via `OfficeToolButton`)。删 `notificationSlot` prop/`notification` slot（无铃铛）。**决定**：narrow header 保留原 6-peer 抽屉逻辑（窄屏拓扑不在本 change scope）；view-mode toggle 仍留 Header 左 cluster（非 StatusBar resident，不在 5.3 迁移清单，prototype 的 stage-mode float 留作后续）。

## 6. 文档 + 验收

- [x] 6.1 更新 root `CLAUDE.md`「Header/StatusBar/Tasks·Kanban·Git 职责锁定」为 V3 shell
  - **已做**：替换为 6 条 V3 shell 锁定规则（删状态栏 + diegetic 迁移、topbar grammar、删除 Board/Live scene 浮层、左栏 Files/SOPs/Git、Team dock、删 Dashboard 入口含遗留说明）；Key Files 表 `useGitBranch` 行改为 `GitWorkbench`（左栏 Git tab）。
- [x] 6.2 串行 build + `pnpm typecheck`（含删 StatusBar 后无悬空 import/slot 提供方）
  - **已做（6 gate 全 exit 0）**：① `rm -rf ui-office/dist + tsbuildinfo && pnpm --filter @offisim/ui-office build` ✓；② `pnpm --filter @offisim/ui-office typecheck` ✓；③ renderer `npx tsc --noEmit` ✓；④ `pnpm --filter @offisim/desktop-renderer build`(vite) ✓；⑤ `pnpm tokens:check` + `pnpm tokens:lint-hex` ✓（z-[]→named z-token、shadow-[]→ring/elev、`#000`→`black`）；⑥ `pnpm typecheck`(25/25) ✓。
- [ ] 6.3 release `.app` live（用户/Codex）：无底部状态栏 / cost readout diegetic + live 高亮 / 通知 `.nb-dot` 角标无铃铛 / stage 无 Board/Live 浮动 tab / `.stage-pipe` run-state + Stop / pending-interaction 仍可见 / 左栏 Files-SOPs-Git / 员工 Team dock + 场景 avatar + Add slot / topbar 无铃铛 / Dashboard 入口消失
  - **BLOCKED 2026-05-24**：release `.app` 已用当前 worktree 精确路径构建并启动，但本机处于 macOS 锁屏界面；CGWindow 可见 Offisim 窗口存在，Computer Use 附着返回 `cgWindowNotFound`，无法完成 release live 视觉/交互验收。解锁后必须用同一 `.app` 路径补跑，不得用 dev server 或浏览器替代。
- [ ] 6.4 archive gate 三查 + 协议台账（Tauri git_exec 路径无变化则不动台账）
  - **未勾（归档时做）**：本 change 未碰 Tauri/A2A/MCP 等协议口径，git_exec 路径不变，台账无需动。
