## 1. AppLayout null-slot 兼容

- [x] 1.1 审查 `AppLayout.tsx`，确认 agentPanel / chatDrawer / eventLog / sceneCanvas 为 null 时不渲染 panel 容器和 collapse handle。如有问题则修复。
- [x] 1.2 确认 `centerContent` 为非 null 时正确替代 sceneCanvas 区域，占满中心面积

## 2. Header 自适应

- [x] 2.1 在 `Header.tsx` 中，当 `activeWorkspace !== 'office'` 时隐藏 2D/3D toggle、company chip/editor、project selector slot
- [x] 2.2 在 `Header.tsx` 中，当 `activeWorkspace !== 'office'` 时显示 back-to-office 按钮 + 当前 workspace title
- [x] 2.3 新增 Header props：`onBackToOffice?: () => void`、`workspaceTitle?: string`（非 Office 时使用）
- [x] 2.4 workspace nav buttons（Office / SOPs / Market）和 settings / notification / studio 按钮在所有 workspace 始终显示

## 3. App.tsx 单路径重构

- [x] 3.1 删除 `showNonOfficeWorkspace` 变量和 `FullPageWorkspaceShell` 渲染分支
- [x] 3.2 删除 `shouldShowAppShell()` 条件包裹的 `OfficeWorkspaceShellLazy` 渲染分支
- [x] 3.3 新增始终渲染的 `<AppLayout>` 块，header slot 传 Header（带 activeWorkspace）
- [x] 3.4 AppLayout slot 条件传递：Office 时传 agentPanel / sceneCanvas / chatDrawer / eventLog，非 Office 时传 null
- [x] 3.5 AppLayout `centerContent` 条件传递：非 Office 时传 `<WorkspaceRouter />`，Office 时传 null
- [x] 3.6 StatusBar 始终传递给 AppLayout（所有 workspace 可见）

## 4. OfficeWorkspaceShell 拆解

- [x] 4.1 将 OfficeWorkspaceShell 中的 Office slot 内容（AgentPanel、ChatDock、CollaborationSidebar、OfficeSceneSurface）提取为 App.tsx 的 inline slot 或独立 helper
- [x] 4.2 将 OfficeWorkspaceShell 中的 overlay 渲染（DashboardOverlay、KanbanOverlay、MarketplaceOverlay）移到 App.tsx
- [x] 4.3 将 EmployeeInspector 和 OnboardingController 移到 App.tsx
- [x] 4.4 删除 `OfficeWorkspaceShell.tsx` 和 `OfficeWorkspaceShellLazy`

## 5. 清理

- [x] 5.1 删除 `FullPageWorkspaceShell.tsx`
- [x] 5.2 删除 `WorkspacePageHeader.tsx`
- [x] 5.3 删除 `app-view-layout.ts` 中的 `shouldShowAppShell` 和 `isNonOfficeWorkspace` 函数
- [x] 5.4 删除 App.tsx 中对 `shouldShowAppShell` / `isNonOfficeWorkspace` 的 import
- [x] 5.5 清理 `WORKSPACE_TITLES` 映射如果不再需要（或迁移到 Header 内部）

## 6. 验证

- [x] 6.1 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 全绿
- [x] 6.2 浏览器 dev 验证：Office workspace 正常渲染（3D scene + AgentPanel + chat + event log）
- [x] 6.3 浏览器 dev 验证：非 Office workspace（SOPs / Market / Activity Log / Settings）正常渲染，无空白 panel 残影
- [x] 6.4 Header 验证：Office 显示完整 chrome，非 Office 显示 workspace title + back 按钮
- [x] 6.5 StatusBar 在所有 workspace 底部可见
- [x] 6.6 Escape / keyboard shortcuts 在两种模式下正常工作
