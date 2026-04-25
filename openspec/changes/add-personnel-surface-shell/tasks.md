## 1. Types & workspace state plumbing

- [x] 1.1 在 `apps/web/src/components/workspaces/types.ts` 把 `WorkspaceKey` 扩成 6 个：`'office' | 'sops' | 'market' | 'personnel' | 'activity-log' | 'settings'`
- [x] 1.2 新增 `PersonnelTabId = 'profile' | 'appearance' | 'runtime' | 'skills' | 'memory' | 'history'` 和 `PersonnelSessionState = { selectedEmployeeId: string | null; activeEmployeeTab: PersonnelTabId }`
- [x] 1.3 把 `PersonnelSessionState` 加进 `WorkspaceSessionState`（key=`personnel`），同步 `SessionStateKeyMap` + `SESSION_KEY`
- [x] 1.4 加 `createDefaultPersonnelState()`，在 `createDefaultSessionState()` 输出里挂上 `personnel` slice（默认 `selectedEmployeeId: null, activeEmployeeTab: 'profile'`）
- [x] 1.5 在 `useWorkspaceSessionState.ts` 的 `tryWorkspaceInternalBack` 加 `case 'personnel'`：先 unwind tab → profile，再 unwind selection → null，否则 `[false, sessionState]`

## 2. Header / nav / router 6 peer 接入

- [x] 2.1 `apps/web/src/lib/workspace-navigation.ts` 在 `PEER_WORKSPACE_ITEMS` 数组里 Market 之后 Activity 之前插入 `{ key: 'personnel', label: 'Personnel', icon: Users }`（lucide-react `Users` icon）
- [x] 2.2 `WorkspaceRouter.tsx` 加 `handlePersonnelChange` callback + `activeWorkspace === 'personnel'` 分支，渲染 lazy `PersonnelPage`
- [x] 2.3 创建 `apps/web/src/components/workspaces/lazy-wrappers/PersonnelPage.tsx`，default export thin wrapper，lazy import `@offisim/ui-office` 的 `PersonnelPage`，prop 与其他 wrapper 模式对齐（接 `sessionState` + `onSessionStateChange` + 必要的 routing helper）
- [x] 2.4 检查 Header / `AppMainShell` 的 peer nav 渲染分支若有 hardcode 5 数量的逻辑（比如响应式溢出阈值）一并改为 6 — Header.tsx 内部 `WorkspaceKey` union 同步到 6 项；AppMainShell `WORKSPACE_TITLES` 加 personnel；无 hardcode count gate
- [x] 2.5 验 `setActiveWorkspace('personnel')` 切换不触发 Office leave cleanup 残留（看 `useWorkspaceSessionState` 现 office leave 逻辑——personnel 不需要 cleanup）— Office leave cleanup 仅在 `prev.activeWorkspace === 'office'` 分支触发，进入 personnel 与 进入 sops/market/settings 走同一逻辑，无副作用

## 3. Personnel page surface (ui-office)

- [x] 3.1 新建 `packages/ui-office/src/components/employees/PersonnelPage.tsx`：三栏 grid 布局 — 左 list / 中 detail+preview / 右 6 tab inspector
- [x] 3.2 左侧 list rail：直接调 `repos.employees.findByCompany(activeCompanyId)`（无 `useEmployees` hook，沿用 SettingsExternalTab 现成 pattern + `eventBus.on('employee', refresh)`），渲染 search 输入框 + role 过滤 + 每行显示 avatar / name / role / external brand chip（沿用 `EmployeeAvatar` primitive）
- [x] 3.3 中间 detail：员工 2D avatar 大图（`EmployeeAvatar size=120`）+ identity（name / role / status / external brand 标识）；若 `selectedEmployeeId` null 则显示空态 "Select an employee on the left"
- [x] 3.4 右侧 tabs root：6 个 `Tabs.Trigger`，`value` 与 `activeEmployeeTab` 双绑（`onValueChange` → `onSessionStateChange(prev => ({ ...prev, activeEmployeeTab: v }))`）
- [x] 3.5 创建 `personnel-tabs/ProfileTab.tsx`：内部 mount `useEmployeeEditor()`（hook 在 PersonnelPage 顶层 mount + 通过 prop 注入 ProfileTab），把现 `EmployeeEditorDialog` 内 Profile / Persona / Config 三段 JSX 全量搬过来扁平化为单一 vertical scroll 序列，保留 system prompt preview / workstation / provider / tool permissions / external read-only banner 的全部条件分支
- [x] 3.6 ProfileTab 内嵌 sticky save bar（Save / Delete / Cancel），inline confirm-delete 行（不走 dialog 层）；`isDirty` / `isSaving` / `isConfirmingDelete` / `deleteError` 走 hook return
- [x] 3.7 创建 `personnel-tabs/AppearanceTab.tsx` / `RuntimeTab.tsx` / `SkillsTab.tsx`：placeholder shell，标题 + 一行说明 + status note "available in a follow-up change"；不允许放任何 form 或控件 — Skills tab 例外按 spec 允许只读 SkillBindingList 作 context
- [x] 3.8 创建 `personnel-tabs/MemoryTab.tsx` / `HistoryTab.tsx`：搬现 `EmployeeEditorDialog` 同名 TabsContent 的 JSX 与依赖（直接复用 `MemoryPanel` / `VersionHistoryTab` primitives）
- [x] 3.9 `packages/ui-office/src/index.ts` + `web.ts` export `PersonnelPage`；移除 `EmployeeEditorDialog` export
- [x] 3.10 ProfileTab 在 `is_external === 1` 分支沿用现 dialog 的只读 banner（避免 C0 内引入回归）— `data-testid="external-avatar-disabled"` testid 一并保留

## 4. Cross-surface edit routing helper

- [x] 4.1 在 `apps/web/src/lib/personnel-routing.ts` 新建 `createRouteToPersonnel({ setActiveWorkspace, updateWorkspaceState })` 工厂，返回 `(employeeId: string, tab?: PersonnelTabId) => void`
- [x] 4.2 `App.tsx` 删除 `useEmployeeEditor()` 顶层 mount + 相关 `employeeEditor` 变量；用 `useMemo` 实例化 `routeToPersonnel`
- [x] 4.3 `AppMainShell` 加 `onEditExternalEmployee` prop（透到 SettingsPage `settingsPageProps.onEditExternalEmployee`）；删 `employeeEditor` prop chain（已在 5.4 一并完成）
- [x] 4.4 `useAppKeyboardShortcuts.ts` 把 `employeeEditor.openForEdit(officeState.selectedEmployeeId)` 改为 `routeToPersonnel(officeState.selectedEmployeeId, 'profile')`；签名改成接 `routeToPersonnel`
- [x] 4.5 `EmployeeInspector` 的 `onOpenEditor?: (id: string) => void` 保留，App.tsx 改成传 `(id) => routeToPersonnel(id, 'profile')`
- [x] 4.6 ChatPanel `/editor` 命令实际指向 **Office Layout Editor (Studio overlay)** 而非员工编辑器 — proposal 该项基于误读，不动 ChatPanel.onOpenEditor 保留 office editor 行为；员工编辑入口仅 EmployeeInspector + Office 快捷键 + Settings → External row + Office Roster 通过 EmployeeInspector
- [x] 4.7 Settings External Employees row 增加 Edit action 调 `routeToPersonnel(employeeId, 'profile')` — 加 `onEditEmployee` 可选 prop 串过 SettingsPage → SettingsContentArea → SettingsExternalTab；row action 组里在 Refresh 之前插 Edit 按钮

## 5. EmployeeEditorDialog deletion + cleanup

- [x] 5.1 删除文件 `packages/ui-office/src/components/employees/EmployeeEditorDialog.tsx`
- [x] 5.2 `packages/ui-office/src/index.ts` / `web.ts` 移除 `EmployeeEditorDialog` export 行
- [x] 5.3 `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` 删除 `<EmployeeEditorDialog />` 分支 + 入参 prop（含 `useEmployeeEditor` import）
- [x] 5.4 `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` 的 props 接口删 `employeeEditor` 字段；调用点（App.tsx）同步删传参
- [x] 5.5 `useRegisterModal('employee-editor', 'dialog')` 调用点删除（在原 dialog 文件内，随 5.1 一并删）；grep 确认无其他文件 register
- [x] 5.6 `apps/web/src/lib/app-view-layout.ts` — 全文 grep 无 EmployeeEditorDialog 引用；`OverlayKey` union 不动
- [x] 5.7 `useEmployeeEditor` hook 收敛 — 保留全签名（`isOpen` / `close` 字段未删）以最小 diff；ProfileTab 用 `formData` / `updateField` / `save` / `requestDelete` / `cancelDelete` / `confirmDelete` / `isDirty` / `isSaving` / `isConfirmingDelete` / `deleteError`；PersonnelPage 用 `openForEdit` / `close` / `employeeId`
- [x] 5.8 grep 检查：`grep -rn "EmployeeEditorDialog" apps/ packages/ --include='*.ts' --include='*.tsx'` 应零命中（除 dist/ 与 archive/）— 验证：零命中
- [x] 5.9 grep 检查：`grep -rn "useRegisterModal('employee-editor'" apps/ packages/` 应零命中 — 验证：零命中

## 6. CLAUDE.md / 子包 CLAUDE.md 同步

- [x] 6.1 root `CLAUDE.md` Workspace IA 节："5 个 peer-level workspace" 改 6；表格加 Personnel 行（`personnel` key / "员工列表 + 详情 + 6 tab inspector" 描述）
- [x] 6.2 root `CLAUDE.md` `WorkspaceKey` union 字符串更新到 6 项；OverlayKey 注释补"员工 edit 不再走 overlay，统一路由 Personnel"
- [x] 6.3 `packages/ui-office/CLAUDE.md` Workspace IA & Navigation 节如有 5-peer 字样同步改 6；提及 EmployeeEditorDialog 处全部更新 — grep 验证子包 CLAUDE.md 未提及 5-peer 字样亦未提 EmployeeEditorDialog，无需修
- [x] 6.4 root `CLAUDE.md` Key Files 表格加 Personnel page entry：PersonnelPage.tsx + personnel-routing.ts

## 7. Build / typecheck 串行验证

- [x] 7.1 串行 build：shared-types → ui-core → core → ui-office → web 全 pass（`pnpm build` turbo 全绿）
- [x] 7.2 `pnpm typecheck`：apps/web + packages/ui-office 全 pass
- [x] 7.3 `pnpm lint` 触碰文件全 pass（`useless case 'settings'` + 1 个 non-null assertion warning 是 useWorkspaceSessionState.ts 历史遗留，非本 change 引入）

## 8. Live verify (web)

- [ ] 8.1 启动 `cd apps/web && pnpm dev`，1440x900 桌面：Header peer 顺序检查 = `Office | SOPs | Market | Personnel | Activity | Settings`；Personnel 选中时 chip 风格与其他 peer 一致
- [ ] 8.2 切到 Personnel：list 渲染当前 active company 全员工 + brand avatar；点选员工 → 中间详情 + 右侧 Profile tab 默认展开
- [ ] 8.3 Profile tab 编辑某员工 role / instructions / model preference → Save → list rail / Office Roster / EmployeeInspector 都能看到新值
- [ ] 8.4 切 Appearance / Runtime / Skills 三 tab → 看到 placeholder shell，无 control，无 form
- [ ] 8.5 切 Memory / History 两 tab → 渲染与原 dialog 等价的 snapshot / list
- [ ] 8.6 Personnel back navigation：从 Skills tab 回退 → Profile tab；再回退 → 清 selection；再回退 → 上一个 workspace（Office）
- [ ] 8.7 Office Roster 点员工 → EmployeeInspector → "Open Editor" → 跳 Personnel + 自动选中 + Profile tab；无任何 dialog 弹出
- [ ] 8.8 EmployeeInspector "Open Editor" → 同上
- [ ] 8.9 ChatPanel `/editor` 命令仍打开 Office Layout Editor (Studio overlay)，与本 change scope 无关 — 不验
- [ ] 8.10 Settings → External Employees → row Edit → 跳 Personnel；外部员工的 Profile tab 显示只读 banner（`data-testid="external-avatar-disabled"`）
- [ ] 8.11 Office 选中员工 + 按 ⌘E 快捷键 → 跳 Personnel
- [ ] 8.12 Studio overlay 内员工 edit 入口（如有）→ 走 routing；overlay 仍可正常关闭返回 Office
- [ ] 8.13 1280x800 tablet：list ↔ detail+tabs 切换可用，无横向 overflow
- [ ] 8.14 390x844 narrow：grid 自动堆叠为 1 列（`grid-cols-1 lg:grid-cols-[...]`），`document.documentElement.scrollWidth` ≤ window.innerWidth

## 9. Live verify (desktop release)

- [ ] 9.1 `pnpm --filter @offisim/desktop build && open apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`，重复 8.1 / 8.7 / 8.10 / 8.11 / 8.13 关键路径在 Tauri 壳内不退化
- [ ] 9.2 检查无任何 `EmployeeEditorDialog` modal 在 Tauri 壳内能被打开（代码层已删，runtime 无 fallback）

## 10. Spec & queue 同步（archive 阶段做）

- [ ] 10.1 archive 时把 6 个 modified spec delta 同步进 canonical `openspec/specs/{unified-shell-routing,office-tool-discovery,workspace-state-management,web-app-shell-boundaries,panel-and-dialog-sizing,responsive-app-shell}/spec.md`
- [ ] 10.2 archive 时把新 capability 落 canonical `openspec/specs/personnel-workspace-surface/spec.md`
- [ ] 10.3 更新 `memory/project_ux_overhaul_queue.md` C0 行 status `[x] archived` + apply / archive commit SHA
- [ ] 10.4 更新 `memory/MEMORY.md` Current State 节 + Next Change Queue 节
- [ ] 10.5 archive 前过 OpenSpec Archive Gate 三查（spec / tasks / docs 一致），协议台账 `openspec/protocols-ledger.md` 本 change 不触协议层无需更新
