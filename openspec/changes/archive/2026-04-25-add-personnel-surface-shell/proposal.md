## Why

Employee 当前是"右下角弹窗 + Office 内 Roster + 各种 list 散点 Edit 按钮"的 CRUD 形态，无法承载「角色系统」该有的列表/详情/外观/runtime/skills/记忆/历史。`EmployeeEditorDialog` 既是 truth 又是 IA，导致 Office / Studio / Settings / Wizard 任何要"打开员工"的入口都得各自 mount overlay，权重不对、跳出 Office 上下文、还和窗口 sizing 反复打架（A4 才刚收口）。

UX overhaul 总计划 §3 把员工提升为一等系统；2026-04-25 用户拍板方案 A——**Personnel 做第 6 peer workspace**，并要求所有显示员工列表的表面都通过统一 edit 路由跳进 Personnel。这一条 change 立 IA 壳与跳转契约，给 C1 (appearance live preview) / C2 (runtime engine binding) 提供落地容器。

## What Changes

- **BREAKING**: `WorkspaceKey` union 从 5 个 peer 扩到 6 个，新增 `'personnel'`；顶部导航顺序固定为 `Office | SOPs | Market | Personnel | Activity | Settings`
- 新增 `PersonnelSessionState` slice（`selectedEmployeeId` + `activeEmployeeTab`）+ 对应 default state factory + `SESSION_KEY` / `SessionStateKeyMap` 同步扩
- 新增 `PersonnelPage` 三栏 surface：左侧员工列表（search / status / role / engine 标识 / avatar），中间详情 + 大图预览，右侧 6 tab 骨架（**Profile / Appearance / Runtime / Skills / Memory / History**）
- **Profile tab**：承载现 `EmployeeEditorDialog` 的 Profile + Persona + Config + Memory + History 五段表单内容，扁平化为单一 Profile（C1+ 再做拆分），保证 edit 能力不退化
- **Appearance / Runtime / Skills tabs**：placeholder shell，标注 "available in C1 / C2"；**Memory / History tabs**：把现 dialog 里的同名两段内容直接搬过来（已是只读 / 简单内容），不做交互升级
- **BREAKING**: 删除 `EmployeeEditorDialog` overlay + `AppGlobalDialogs` 的 dialog 分支 + `useEmployeeEditor` 在 `App.tsx` 顶层的 mount；hook 本身保留作 Profile tab 内部用，签名收敛去掉 `isOpen` / `close` / `requestDelete` 走 dialog confirm 的部分（确认删除收到 Profile tab 内 inline confirm）
- **跨表面 edit 路由统一契约**：所有员工列表（Office Roster、Company Creation Wizard 员工行、Settings External Employees row、`EmployeeInspector`、ChatPanel "Open Editor"）的 Edit action 都转成 `routeToPersonnel(employeeId, tab='profile')` helper —— 内部做 `setActiveWorkspace('personnel')` + `updateWorkspaceState('personnel', ...)`，不再直接 `employeeEditor.openForEdit(id)`
- 删除 `useAppKeyboardShortcuts` 里 `employeeEditor.openForEdit(officeState.selectedEmployeeId)` 这条快捷键路径，改为路由到 Personnel
- `useWorkspaceBackNavigation` 加 personnel 内部 drill-in unwind：`activeEmployeeTab !== 'profile'` → 'profile'，再 `selectedEmployeeId !== null` → null，最后才走 workspace-level back
- CLAUDE.md（root + `packages/ui-office/`）"5 个 peer workspace" 全部改 6；workspace IA 表加一行
- `office-tool-discovery` / `unified-shell-routing` / `workspace-state-management` / `web-app-shell-boundaries` / `panel-and-dialog-sizing` 同步 spec 修订

## Capabilities

### New Capabilities
- `personnel-workspace-surface`: Personnel peer workspace 的 IA 契约 —— 三栏布局（list / detail+preview / 6-tab inspector）、6 tab 的 scope 边界、cross-surface edit 路由 helper、Personnel 内部 back navigation 顺序、与 `EmployeeEditorDialog` 删除后旧调用点的迁移闭环

### Modified Capabilities
- `unified-shell-routing`: peer workspace 数从 5 改 6（新增 Personnel）；header IA 各 scenario 的 enumerate 同步；`AppLayout` 在 personnel mode 下 sidePanel/agentPanel/sceneCanvas/chatDrawer/eventLog 全部传 null，centerContent 走 PersonnelPage
- `office-tool-discovery`: peer workspace 列表新增 Personnel；Header selected chip 行为对 6 个 peer 一致
- `workspace-state-management`: `WorkspaceKey` union / `WorkspaceSessionState` shape / `SESSION_KEY` map / `tryWorkspaceInternalBack` 的 personnel 分支；`updateWorkspaceState('personnel', ...)` 是 Personnel state 唯一写入路径
- `responsive-app-shell`: narrow / tablet / desktop 三 tier 在 Personnel workspace 的列表-详情-tabs 折叠规则
- `web-app-shell-boundaries`: `AppGlobalDialogs.tsx` 删 `EmployeeEditorDialog` 渲染分支；`App.tsx` 不再 mount `useEmployeeEditor()` 顶层 hook
- `panel-and-dialog-sizing`: 删除 `EmployeeEditorDialog` 的 sizing scenario（dialog 不再存在），其余 dialog 契约不变

## Impact

**代码**
- `apps/web/src/components/workspaces/types.ts` — `WorkspaceKey` union / `WorkspaceSessionState` / `SESSION_KEY` / default factory / `WorkspaceRouterProps`
- `apps/web/src/components/workspaces/useWorkspaceSessionState.ts` — `tryWorkspaceInternalBack` 加 personnel 分支
- `apps/web/src/components/workspaces/WorkspaceRouter.tsx` — 加 `activeWorkspace === 'personnel'` 分支 + `handlePersonnelChange` callback + lazy import
- `apps/web/src/components/workspaces/lazy-wrappers/PersonnelPage.tsx` — 新建
- `apps/web/src/lib/workspace-navigation.ts` — `PEER_WORKSPACE_ITEMS` 加 Personnel 行（位置 Market 之后 Activity 之前），icon 用 `Users` / `UserCog`
- `apps/web/src/App.tsx` — 删 `useEmployeeEditor()` 顶层 mount + `employeeEditor` prop 传递；改用 `routeToPersonnel` helper
- `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` — 删 `<EmployeeEditorDialog />` 分支
- `apps/web/src/hooks/useAppKeyboardShortcuts.ts` — `openForEdit` 改路由
- `packages/ui-office/src/components/employees/PersonnelPage.tsx` — 新建（list + detail + 6-tab inspector）
- `packages/ui-office/src/components/employees/personnel-tabs/{ProfileTab,AppearanceTab,RuntimeTab,SkillsTab,MemoryTab,HistoryTab}.tsx` — 新建
- `packages/ui-office/src/components/employees/EmployeeEditorDialog.tsx` — 删除文件
- `packages/ui-office/src/index.ts` / `web.ts` — 移除 `EmployeeEditorDialog` export，新增 `PersonnelPage` export
- `packages/ui-office/src/hooks/useEmployeeEditor.ts` — 保留，签名收敛（删 `isOpen` / `close` / `openForCreate` 的 overlay 触发部分；`save` / `updateField` 等仍由 Profile tab 用）
- `packages/ui-office/src/components/agents/EmployeeInspector.tsx` / `chat/ChatPanel.tsx` —`onOpenEditor` callback 改成"路由到 Personnel"
- `apps/web/src/components/workspaces/lazy-wrappers/SettingsPage.tsx` 与 External tab 行 — Edit 按钮接 personnel 路由

**Doc / Spec**
- root `CLAUDE.md`：Workspace IA 表 5→6 行；"5 个 peer-level workspace" 字样全替换
- `packages/ui-office/CLAUDE.md`：Workspace IA & Navigation 节同步
- `openspec/specs/{unified-shell-routing,office-tool-discovery,workspace-state-management,responsive-app-shell,web-app-shell-boundaries,panel-and-dialog-sizing}/spec.md`：archive 时 sync canonical
- 新增 `openspec/specs/personnel-workspace-surface/spec.md` (archive 阶段)

**风险与权衡**
- Profile tab 在 C0 内承载现 dialog 全部 form 内容（5 段并 1 段），UX 不会比现 dialog 更紧凑——这是有意识的妥协，C1 / C2 / 后续 followup 拆分；不留半残 placeholder 让用户失去 edit 能力
- 移除 dialog 的 modal stack 行为后，`useRegisterModal('employee-editor', 'dialog')` 调用点删除；现役 `useAppKeyboardShortcuts.anyModalOpen` 的拦截逻辑路径减少一类
- `OverlayKey` union 不变（`'employee-creator' | 'office-editor' | 'company-select' | 'studio'`），仅 `EmployeeEditorDialog` 不属于 overlay，删它不动 overlay 协议
- 桌面端 Tauri 路径无独立改动（共享 `apps/web` 渲染树），不需要 Tauri-side capability 改动
- A2A external employee 在 Personnel 列表也按 brand avatar 渲染（`is_external + brand_key`），`AppearanceTab` 在 C1 中要继承现 dialog 对 external 的只读 banner —— C0 仅占位
