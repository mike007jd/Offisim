# 任务：导航架构重构 (Navigation Architecture)

## 1. app-view-layout.ts 类型变更
- [x] 1.1 从 `FULL_PAGE_WORKSPACE_VIEWS` 数组中移除 `'sops'`，使其仅包含 `['market', 'activity-log', 'settings']`
- [x] 1.2 新增导出类型 `OfficeViewMode = '2D' | '3D' | 'sop'`
- [x] 1.3 验证 `isFullPageWorkspaceView('sops')` 返回 `false`，`isWorkspaceView('sops')` 仍返回 `true`（运行 diagnostics 确认无类型错误）

## 2. FullPageWorkspaceShell 删除重建
- [x] 2.1 删除 `apps/web/src/components/workspaces/FullPageWorkspaceShell.tsx` 现有内容
- [x] 2.2 重建 FullPageWorkspaceShell：仅接受 `onBackToOffice: () => void` + `children: ReactNode` 两个 props
- [x] 2.3 实现浮动返回按钮：`absolute top-4 left-4 z-50`，`bg-white/10 backdrop-blur-sm rounded-lg`，含 ArrowLeft 图标 + "Office" 文字，hover 时 `bg-white/20`
- [x] 2.4 实现全视口容器：深色径向渐变背景，children 占据 100% 视口无额外 padding
- [x] 2.5 实现 Escape 键监听：`useEffect` 注册 keydown 监听器，Escape 触发 `onBackToOffice()`，卸载时清理

## 3. App.tsx 路由变更
- [x] 3.1 将 `viewMode` 状态类型从 `'2D' | '3D'` 扩展为 `OfficeViewMode`（导入新类型）
- [x] 3.2 精简 FullPageWorkspaceShell 调用：仅传递 `onBackToOffice` + `children`，移除 `activeWorkspace`/`companyName`/`onOpenSettings`/`onWorkspaceSwitch`
- [x] 3.3 在 Escape 键处理逻辑中新增 SOP viewMode 退出：`view === 'office' && viewMode === 'sop'` 时将 viewMode 切回 `'3D'`
- [x] 3.4 将扩展后的 `viewMode`/`setViewMode` 通过 `sceneView` prop 传递给 OfficeWorkspaceShell（SOP 占位渲染由 sop-view-rebuild spec 实现）

## 4. 编译验证与清理
- [x] 4.1 运行 TypeScript 编译检查，修复所有因 `FullPageWorkspaceAppView` 类型变更导致的类型错误
- [x] 4.2 运行 Biome lint 检查，确保代码风格符合项目规范（2-space indent, single quotes, trailing commas）
