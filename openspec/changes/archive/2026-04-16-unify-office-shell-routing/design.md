## Context

Phase A（`538bee0`）统一了 Office workspace 的状态管理。当前 App.tsx 仍有两条独立的渲染路径：

1. **Office 路径**: `shouldShowAppShell()` → `OfficeWorkspaceShellLazy` → `AppLayout`（Header + AgentPanel + sceneCanvas + chatDrawer + eventLog + statusBar，6 slot 全挂）
2. **非 Office 路径**: `isNonOfficeWorkspace()` → `FullPageWorkspaceShell` → `WorkspacePageHeader` + `WorkspaceRouter`（轻量壳 + 单列内容）

`AppLayout` 已有 `centerContent?: ReactNode` slot（注释写着 "Used by WorkspaceRouter to render non-office workspace pages"），但从未被实际使用。`WorkspaceRouter` 也已有 `office` 分支（mount policy + children slot）。双路径的存在纯粹是历史遗留。

## Goals / Non-Goals

**Goals:**
- App.tsx 只有一条 shell 渲染路径（始终渲染 AppLayout）
- Header 按 `activeWorkspace` 自适应：Office 显示完整 chrome，非 Office 显示简化导航
- 删除 `FullPageWorkspaceShell`、`WorkspacePageHeader`
- `app-view-layout.ts` 中的 `shouldShowAppShell` / `isNonOfficeWorkspace` 不再需要

**Non-Goals:**
- 不动 AppLayout 的三栏布局引擎或响应式断点
- 不在非 Office workspace 启用 AgentPanel / chatDrawer / eventLog（它们在非 Office 时传 null 即可）
- 不做 workspace 切换动画（transitionState 保持 'idle'）
- 不改 WorkspaceRouter 内各 workspace page 的 session state 管理

## Decisions

### D1: AppLayout 始终渲染，非 Office slot 传 null

**选择**: App.tsx 始终渲染 `<AppLayout>`。当 `activeWorkspace !== 'office'` 时，`agentPanel`、`chatDrawer`、`eventLog`、`sceneCanvas` 传 `null`，`centerContent` 传 `<WorkspaceRouter />`。

**备选**: 在 AppLayout 内部根据 workspace 切换 slot 可见性。否决理由：AppLayout 不应知道 workspace 概念，保持纯 slot 组件。

**备选**: 为非 Office 做一个 MinimalLayout 替代 AppLayout。否决理由：增加一个新组件违反统一路径目标。

### D2: Header 接收 `activeWorkspace`，条件渲染 Office-specific 区域

**选择**: Header 已有 `activeWorkspace` prop（默认 'office'）。扩展其行为：当非 Office 时，隐藏 2D/3D toggle、company chip/editor、project selector，改为显示 workspace title + back-to-office 按钮。workspace nav buttons 始终显示。

**备选**: 创建独立的 UnifiedHeader wrapper 组合 Header + WorkspacePageHeader。否决理由：不如直接让 Header 自适应，减少组件层级。

### D3: WorkspaceRouter 从 FullPageWorkspaceShell 内提到 AppLayout.centerContent

**选择**: WorkspaceRouter 直接作为 `centerContent` prop 传入 AppLayout。Office 时 centerContent 为 null（走 sceneCanvas slot）。非 Office 时 sceneCanvas 为 null，centerContent 为 WorkspaceRouter 输出。

**备选**: 把 Office scene 也塞进 WorkspaceRouter 的 centerContent。否决理由：Office scene 需要走 sceneCanvas slot（AppLayout 对 sceneCanvas 有 absolute positioning + z-0 处理），不能和普通 centerContent 混用。

### D4: OfficeWorkspaceShell 拆解为 Office 专属内容，不再持有 AppLayout

**选择**: OfficeWorkspaceShell 当前整体包裹 AppLayout + 所有 slot。重构后 AppLayout 提到 App.tsx 层级，OfficeWorkspaceShell 只负责提供 Office-specific 的 slot 内容（scene surface、overlays、employee inspector、onboarding）。或者更直接：把 OfficeWorkspaceShell 的逻辑直接并入 App.tsx 的 AppLayout 各 slot 传递中，完全删除 OfficeWorkspaceShell。

采用后者——OfficeWorkspaceShell 已经是纯 prop 透传 + slot 组装，没有独立业务逻辑。直接删除减少一层抽象。

### D5: app-view-layout.ts 简化

**选择**: 删除 `shouldShowAppShell`、`isNonOfficeWorkspace` 函数（不再有双路径需要判断）。保留 `OverlayKey` 类型和 `OfficeViewMode` 类型（仍被使用）。

## Risks / Trade-offs

- **[风险] AppLayout 接收 null slot 时的行为** → 检查 AppLayout 对 null agentPanel/eventLog/chatDrawer 的处理。若有问题，用空 fragment 代替 null。
- **[风险] 非 Office 时 StatusBar 是否显示** → 决定：非 Office 时也传 StatusBar（显示 model name），保持底部一致性。如果不合适后续可调。
- **[风险] OfficeWorkspaceShell 删除后 App.tsx 膨胀** → 接受：当前 OfficeWorkspaceShell 的 slot 组装逻辑约 80 行，并入 App.tsx 增加有限。且这些逻辑本来就是 App 级别的 wiring，放在 Shell 里反而增加间接层。
- **[风险] Header back-to-office 按钮与 goBack() 语义重叠** → goBack() 先 unwind 内部状态再切 workspace。Header 的 back 按钮直接切 office。保持两者独立：Header back = 直达 office shortcut，keyboard back = 层级式 unwind。
