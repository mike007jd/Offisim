## Why

App.tsx 维护着两套并行的 workspace 状态系统：Office 用 8 个顶级 `useState`（viewMode, dashboardOpen, kanbanOpen, selectedEmployeeId, leftPanelWidth, rightPanelWidth, studioMode, marketplaceListingId）+ legacy `view` 变量，其他 4 个 workspace 用 `useWorkspaceSessionState()` + `updateWorkspaceState()`。两套系统通过 effect 和 `handleWorkspaceSwitch()` 粗略同步，`OfficeSessionState` 类型已声明但从未使用。这导致 App.tsx 膨胀（30+ props drill）、导航逻辑分叉（Escape 键硬编码 vs `useWorkspaceBackNavigation`）、新功能接入必须同时维护两条路径。

## What Changes

- 将 Office 的 8 个 `useState` 迁入 `OfficeSessionState`，通过 `updateWorkspaceState('office', updater)` 读写
- 统一 `view` + `activeWorkspace` 为单一状态源 `activeWorkspace`；`view` 降级为 `activeWorkspace` 的派生值（仅用于 legacy overlay 判断），不再独立 `setView`
- Escape 键 overlay dismiss 逻辑从 App.tsx 硬编码迁入 `useWorkspaceBackNavigation` 的 unwind 栈
- `OfficeWorkspaceShellLazy` 改为从 `useWorkspaceSessionState()` 读取 office state，不再接收 30+ 个原始 props
- **不动 shell 层级**：Office 仍走 `shouldShowAppShell()` → `OfficeWorkspaceShellLazy`，其他 workspace 仍走 `FullPageWorkspaceShell` + `WorkspaceRouter`（布局统一是后续 Phase B/C）

## Capabilities

### New Capabilities

- `workspace-state-management`: workspace session state 的统一管理契约——`WorkspaceSessionState` 类型定义、`updateWorkspaceState()` API、`OfficeSessionState` 字段规范、back navigation unwind 协议

### Modified Capabilities

(openspec/specs/ 当前为空，无已有 spec 需要修改)

## Impact

- **apps/web/src/App.tsx** — 最大改动：删除 8 个 `useState` + sync effect + Escape 硬编码，改为消费 `useWorkspaceSessionState()` 返回值
- **apps/web/src/components/workspaces/types.ts** — `OfficeSessionState` 从幽灵类型变为真实使用
- **apps/web/src/components/workspaces/useWorkspaceSessionState.ts** — Office 初始值 + updater 逻辑
- **apps/web/src/components/workspaces/useWorkspaceBackNavigation.ts** — 增加 Office overlay unwind 规则
- **apps/web/src/components/office-shell/OfficeWorkspaceShell.tsx** — props 大幅缩减，改读 workspace session state
- **apps/web/src/lib/app-view-layout.ts** — `shouldShowAppShell()` 可能需要适配 `activeWorkspace` 替代 `view`
- 不影响 packages/core、packages/ui-office 业务逻辑、3D/2D scene 渲染
