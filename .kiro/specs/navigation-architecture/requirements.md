# 需求文档：导航架构重构 (Navigation Architecture)

## 简介

本 spec 是 fullscreen-pages-rebuild 拆分出的 5 个独立 spec 之一，也是其余 4 个页面 spec 的基础依赖。它覆盖三项导航层面的架构变更：

1. **FullPageWorkspaceShell 精简** — 删除重建，去除所有 chrome（header、面包屑、tab pills、圆角容器），仅保留浮动 "← Office" 返回按钮 + 全视口 children。该 shell 服务于 Market、Activity Log、Settings（不含 SOP）。
2. **SOP 路由降级** — SOP 从独立全屏页面降级为 Office 主界面内的视图模式（与 2D/3D 切换同级），保留 Team sidebar 和 Chat panel。
3. **Escape 键处理** — 在任何全屏页面（Market/Activity Log/Settings）按 Escape 返回 Office。

本 spec 不涉及任何页面的具体内容实现（SOP DAG 可视化、Market 卡片网格、Activity Log 事件流、Settings 表单），这些由各自独立的 spec 负责。

## 术语表

- **Office_View**: Offisim 主界面，包含左侧 Team sidebar、中间主区域和右侧 Chat panel
- **FullPageWorkspaceShell**: 全屏工作区外壳组件，为 Market/Activity_Log/Settings 提供全屏容器（文件路径：`apps/web/src/components/workspaces/FullPageWorkspaceShell.tsx`）
- **App_Router**: `apps/web/src/App.tsx` 中的顶层路由逻辑，根据 `AppView` 状态决定渲染哪个视图
- **App_View_Layout**: `apps/web/src/lib/app-view-layout.ts` 模块，定义 `AppView` 类型、`FULL_PAGE_WORKSPACE_VIEWS` 数组和相关判断函数
- **OfficeViewMode**: Office 主界面中间区域的显示模式类型，当前为 `'2D' | '3D'`，目标扩展为 `'2D' | '3D' | 'sop'`
- **FULL_PAGE_WORKSPACE_VIEWS**: `app-view-layout.ts` 中的常量数组，当前包含 `['sops', 'market', 'activity-log', 'settings']`，用于 `isFullPageWorkspaceView()` 判断
- **Back_Button**: 浮动的 "← Office" 返回按钮，absolute 定位于全屏 shell 左上角
- **OfficeWorkspaceShell**: Office 主界面的外壳组件（lazy loaded），包含 header、AgentPanel、centerContent、CollaborationSidebar
- **WorkspaceRouter**: 工作区路由组件，根据 `activeWorkspace` 渲染对应的工作区页面内容

## 需求

### 需求 1：SOP 从 FULL_PAGE_WORKSPACE_VIEWS 中移除

**用户故事:** 作为 Offisim 开发者，我希望 SOP 不再被识别为全屏工作区视图，以便后续将其作为 Office 内的视图模式渲染。

#### 验收标准

1. THE App_View_Layout SHALL 将 `'sops'` 从 `FULL_PAGE_WORKSPACE_VIEWS` 数组中移除，使该数组仅包含 `['market', 'activity-log', 'settings']`
2. WHEN `isFullPageWorkspaceView('sops')` 被调用, THE App_View_Layout SHALL 返回 `false`
3. THE App_View_Layout SHALL 保持 `'sops'` 在 `WORKSPACE_VIEWS` 数组中不变，确保 `isWorkspaceView('sops')` 仍返回 `true`
4. THE App_View_Layout SHALL 导出新类型 `OfficeViewMode = '2D' | '3D' | 'sop'`，供 Office_View 的视图模式切换使用

### 需求 2：App.tsx 中 SOP 路由从全屏分支移至 Office 分支

**用户故事:** 作为 Offisim 用户，我希望进入 SOP 时仍留在 Office 主界面内（保留 Team sidebar 和 Chat panel），而不是跳转到独立全屏页面。

#### 验收标准

1. WHEN 用户切换到 SOP 视图, THE App_Router SHALL 在 OfficeWorkspaceShell 的中间主区域渲染 SOP 内容，保留左侧 Team sidebar 和右侧 Chat panel
2. THE App_Router SHALL 将 `viewMode` 状态类型从 `'2D' | '3D'` 扩展为 `OfficeViewMode`（`'2D' | '3D' | 'sop'`）
3. WHEN `viewMode` 为 `'sop'`, THE OfficeWorkspaceShell SHALL 在 centerContent 区域渲染 SOP 视图占位（具体 SOP 内容由 sop-view-rebuild spec 实现）
4. WHEN 用户从 SOP 视图切换回 2D 或 3D, THE App_Router SHALL 恢复对应的 Office 场景渲染
5. THE App_Router SHALL 不再将 `view === 'sops'` 路由到 FullPageWorkspaceShell 分支

### 需求 3：FullPageWorkspaceShell 删除重建 — 去除所有 Chrome

**用户故事:** 作为 Offisim 用户，我希望全屏页面（Market/Activity Log/Settings）只有一个简洁的返回按钮和深色背景，没有多余的 header、面包屑和 tab pills，以获得沉浸式体验。

#### 验收标准

1. THE FullPageWorkspaceShell SHALL 删除现有文件并从零重建，不在现有 JSX 上修改 className
2. THE FullPageWorkspaceShell SHALL 移除 header 区域（包含 "← Office" 按钮、公司名称、"Workspace" 标签和面包屑路径）
3. THE FullPageWorkspaceShell SHALL 移除工作区切换 tab pills（SOPs/Market/Activity Log/Settings 圆角按钮组）及 `WORKSPACE_META` 映射
4. THE FullPageWorkspaceShell SHALL 移除圆角容器（`rounded-[28px] border` 外框、`max-w-[1700px]` 宽度限制和内边距）
5. THE FullPageWorkspaceShell SHALL 渲染一个浮动的 Back_Button，使用 absolute 定位于左上角（`top-4 left-4 z-50`），显示箭头图标和 "Office" 文字，使用半透明背景（`bg-white/10 backdrop-blur-sm`），hover 时增加不透明度（`bg-white/20`）
6. THE FullPageWorkspaceShell SHALL 让 children 占据 100% 视口宽度和高度，无额外 padding 或 margin
7. THE FullPageWorkspaceShell SHALL 使用深色渐变背景作为全屏容器底色

### 需求 4：FullPageWorkspaceShell Props 精简

**用户故事:** 作为 Offisim 开发者，我希望 FullPageWorkspaceShell 的接口尽可能简洁，只保留必要的 props，降低组件耦合度。

#### 验收标准

1. THE FullPageWorkspaceShell SHALL 仅接受 `onBackToOffice: () => void` 和 `children: ReactNode` 两个 props
2. THE FullPageWorkspaceShell SHALL 移除 `activeWorkspace`、`companyName`、`onOpenSettings`、`onWorkspaceSwitch` 四个 props
3. WHEN App_Router 渲染 FullPageWorkspaceShell, THE App_Router SHALL 仅传递 `onBackToOffice` 和 `children`，不再传递已移除的 props

### 需求 5：Escape 键从全屏页面返回 Office

**用户故事:** 作为 Offisim 用户，我希望在全屏页面（Market/Activity Log/Settings）按 Escape 键能快速返回 Office 主界面。

#### 验收标准

1. IF 用户按下 Escape 键且当前处于全屏页面（Market/Activity_Log/Settings）, THEN THE App_Router SHALL 导航回 Office_View
2. THE App_Router SHALL 在 Escape 键处理逻辑中将 `'sops'` 从全屏页面列表中移除，因为 SOP 不再是全屏页面
3. WHEN 用户在 SOP 视图模式下按 Escape, THE App_Router SHALL 将 `viewMode` 切换回之前的模式（2D 或 3D），而不是触发全屏页面返回逻辑

### 需求 6：FullPageWorkspaceShell 内置 Escape 键监听

**用户故事:** 作为 Offisim 开发者，我希望 FullPageWorkspaceShell 自身也监听 Escape 键并调用 `onBackToOffice`，作为防御性的双重保障。

#### 验收标准

1. THE FullPageWorkspaceShell SHALL 在组件挂载时注册 `keydown` 事件监听器
2. WHEN 用户按下 Escape 键, THE FullPageWorkspaceShell SHALL 调用 `onBackToOffice()` 回调
3. THE FullPageWorkspaceShell SHALL 在组件卸载时移除 `keydown` 事件监听器，避免内存泄漏
