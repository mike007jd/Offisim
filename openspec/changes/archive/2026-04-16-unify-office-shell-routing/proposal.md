## Why

Office workspace 走 `OfficeWorkspaceShell` → `AppLayout`，其余 4 个 workspace 走 `FullPageWorkspaceShell` → `WorkspaceRouter`。两条完全独立的渲染路径意味着 Header、StatusBar、键盘快捷键、overlay 管理等逻辑在两侧各维护一份，改一处漏另一处。Phase A 统一了状态，现在需要统一 shell 路径。

## What Changes

- 提取 **UnifiedHeader** 组件，按 `activeWorkspace` 自适应：Office 模式展示完整 chrome（2D/3D toggle、company chip、project selector、notification center），非 Office 模式退化为轻量导航栏（workspace nav + back + title）
- **AppLayout 成为所有 workspace 的唯一外壳**：非 Office workspace 通过 `centerContent` slot 渲染（该 prop 已存在），同时隐藏 AgentPanel / chatDrawer / eventLog / sceneCanvas
- 删除 `FullPageWorkspaceShell` 和 `WorkspacePageHeader`，**BREAKING** 对这两个组件的依赖
- `WorkspaceRouter` 成为 AppLayout 的 `centerContent` / `sceneCanvas` 内容提供者，不再被 `FullPageWorkspaceShell` 包裹
- App.tsx 的双分支渲染（`shouldShowAppShell` / `isNonOfficeWorkspace`）合并为单一渲染路径

## Capabilities

### New Capabilities
- `unified-shell-routing`: 所有 workspace 共用 AppLayout + UnifiedHeader 的单路径 shell 架构

### Modified Capabilities
(无——这是纯内部重构，不改变任何用户可见行为或 spec-level requirement)

## Impact

- `apps/web/src/App.tsx` — 双分支合一，props 传递简化
- `apps/web/src/components/office-shell/OfficeWorkspaceShell.tsx` — 可能拆分或重命名
- `apps/web/src/components/workspaces/FullPageWorkspaceShell.tsx` — 删除
- `apps/web/src/components/workspaces/WorkspacePageHeader.tsx` — 删除
- `apps/web/src/components/workspaces/WorkspaceRouter.tsx` — 角色变化，从 FullPageWorkspaceShell 子组件变为 AppLayout 的内容提供者
- `apps/web/src/lib/app-view-layout.ts` — `shouldShowAppShell` / `isNonOfficeWorkspace` 可能简化或删除
- `packages/ui-office/src/components/layout/AppLayout.tsx` — 可能需要调整 slot 可见性逻辑
- `packages/ui-office/src/components/layout/Header.tsx` — 需要支持非 Office 模式
