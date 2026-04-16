## 1. 扩展 OfficeSessionState 类型 + 默认值

- [x] 1.1 在 `apps/web/src/components/workspaces/types.ts` 扩展 `OfficeSessionState`：新增 `dashboardOpen: boolean`, `kanbanOpen: boolean`, `marketplaceListingId: string | null`, `leftPanelWidth: number`, `rightPanelWidth: number`
- [x] 1.2 更新 `createDefaultOfficeState()` 返回完整的 8 字段默认值（dashboardOpen: false, kanbanOpen: false, marketplaceListingId: null, leftPanelWidth: 44, rightPanelWidth: 44）

## 2. Office Escape unwind 迁入 tryWorkspaceInternalBack

- [x] 2.1 在 `apps/web/src/components/workspaces/useWorkspaceSessionState.ts` 的 `tryWorkspaceInternalBack()` 增加 `case 'office'`：unwind 顺序 dashboard → kanban → marketplace → selectedEmployee
- [x] 2.2 同步更新 `hasInternalDrillIn()` 的 `case 'office'`：返回 `dashboardOpen || kanbanOpen || marketplaceListingId !== null || selectedEmployeeId !== null`

## 3. Office leave cleanup

- [x] 3.1 在 `useWorkspaceSessionState.ts` 的 `setActiveWorkspace()` 回调中，当离开 office 时重置 `dashboardOpen: false, kanbanOpen: false, marketplaceListingId: null`（扩展现有 `studioMode` cleanup 逻辑）

## 4. 引入 activeOverlay，拆分 view

- [x] 4.1 在 `apps/web/src/lib/app-view-layout.ts` 新增 `OverlayKey` 类型：`'employee-creator' | 'office-editor' | 'company-select' | 'studio'`
- [x] 4.2 在 App.tsx 新增 `const [activeOverlay, setActiveOverlay] = useState<OverlayKey | null>(null)`
- [x] 4.3 修改 `shouldShowAppShell()` 签名：接收 `activeWorkspace` + `activeOverlay`，当 `activeWorkspace === 'office' && (activeOverlay === null || activeOverlay === 'employee-creator')` 时返回 true
- [x] 4.4 修改 `isFullPageWorkspaceView()` 签名：接收 `activeWorkspace` + `activeOverlay`，当 `activeWorkspace !== 'office' && activeOverlay === null` 时返回 true
- [x] 4.5 将 App.tsx 中所有 `setView('employee-creator')` / `setView('office-editor')` / `setView('company-select')` / `setView('studio')` 替换为 `setActiveOverlay(...)` 调用
- [x] 4.6 将 overlay 关闭回调（`setView('office')`）替换为 `setActiveOverlay(null)`
- [x] 4.7 删除 `const [view, setView] = useState<AppView>(...)`，删除 view → activeWorkspace sync effect（L136-142），删除 activeCompanyId → view sync effect（L161-163，改为 activeCompanyId 变化时 `setActiveWorkspace('office')` + `setActiveOverlay(null)`）
- [x] 4.8 删除 `handleWorkspaceSwitch` 包装函数，直接使用 `setActiveWorkspace`

## 5. App.tsx 状态迁移

- [x] 5.1 删除 App.tsx 中的 8 个独立 `useState`（viewMode, dashboardOpen, kanbanOpen, marketplaceListingId, selectedEmployeeId, leftPanelWidth, rightPanelWidth, studioMode）
- [x] 5.2 将所有读取改为从 `workspaceSessionState.office.*` 读取
- [x] 5.3 将所有写入改为 `updateWorkspaceState('office', prev => ({ ...prev, fieldName: newValue }))`
- [x] 5.4 修改 keyboard shortcuts（Cmd+D, Cmd+J, Cmd+1）：guard `activeWorkspace === 'office'`，改用 `updateWorkspaceState('office', ...)`
- [x] 5.5 修改 Escape 键逻辑：删除 App.tsx 中 L235-265 的硬编码 unwind，替换为 `goBack()`（会走 `tryWorkspaceInternalBack` 的 office case）。保留 `shortcutHelpOpen` 和 `employeeEditor.isOpen` 的 guard（它们不是 workspace state）

## 6. OfficeWorkspaceShell props 精简

- [x] 6.1 修改 `OfficeWorkspaceShell` 的 props 接口：删除 8 个独立 state props + 3 个 onClose callbacks，新增 `officeState: OfficeSessionState` + `updateOfficeState: (updater: (prev: OfficeSessionState) => OfficeSessionState) => void`
- [x] 6.2 更新 Shell 内部所有读取：`props.dashboardOpen` → `props.officeState.dashboardOpen`
- [x] 6.3 更新 Shell 内部所有写入：`props.onCloseDashboard()` → `props.updateOfficeState(prev => ({ ...prev, dashboardOpen: false }))`
- [x] 6.4 更新 `sceneView` prop：从 App.tsx 传 `viewMode` → 改为传 `officeState.viewMode`；`onViewModeChange` → `updateOfficeState`
- [x] 6.5 更新 App.tsx 中 `<OfficeWorkspaceShellLazy>` 的 props 传递：传 `officeState={workspaceSessionState.office}` + `updateOfficeState` wrapper

## 7. 清理 + typecheck

- [x] 7.1 删除 `apps/web/src/lib/app-view-layout.ts` 中已不需要的 `AppView` 相关类型/函数（如果完全被 `activeWorkspace` + `activeOverlay` 取代）
- [x] 7.2 全量 typecheck：`pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck`
- [x] 7.3 修复所有 type error

## 8. Live 验证

- [ ] 8.1 浏览器 dev 启动：workspace 切换（Office ↔ SOPs ↔ Market ↔ Activity Log ↔ Settings），确认切换流畅、状态保留/清理正确
- [ ] 8.2 Escape unwind：Office 打开 dashboard → Escape 关闭 → 打开 kanban → Escape 关闭 → 选中员工 → Escape 取消选中
- [ ] 8.3 keyboard shortcuts：Cmd+D / Cmd+J / Cmd+1 在 Office 正常工作，在非 Office workspace 无响应
- [ ] 8.4 overlay 流程：employee-creator / office-editor / studio / company-select 打开关闭正常，关闭后回到 Office
- [ ] 8.5 browser back button：在 Office 内有 drill-in 时 back 先 unwind，无 drill-in 时 back 切换 workspace
