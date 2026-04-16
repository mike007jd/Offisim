## Context

App.tsx 同时管理两套 workspace 状态：

**Legacy 路径（Office）**：8 个独立 `useState` + `view: AppView` 变量，通过 30+ 个 props drill 到 `OfficeWorkspaceShellLazy`。`AppView` 类型混合了 workspace key 和 overlay key（`'employee-creator' | 'office-editor' | 'company-select' | 'studio'`）。Escape 键逻辑在 App.tsx L235-265 硬编码，按优先级依次关闭 dashboard → kanban → marketplace → employeeEditor → selectedEmployee → workspace back。

**新路径（其他 4 个 workspace）**：`useWorkspaceSessionState()` 返回 `activeWorkspace` / `sessionState` / `updateWorkspaceState()`。`tryWorkspaceInternalBack()` 处理 per-workspace unwind。`useWorkspaceBackNavigation()` 桥接 browser history。

两套通过 `handleWorkspaceSwitch()` + sync effect（L127-142）粗略对齐。`OfficeSessionState` 类型已声明（`types.ts:16-20`）但从未被使用——它只有 3 个字段，App.tsx 实际管理 8 个。

## Goals / Non-Goals

**Goals:**

- 将 Office 的 8 个 `useState` 统一到 `OfficeSessionState` + `updateWorkspaceState('office', updater)`
- 消除 `view` + `activeWorkspace` 双状态源：`activeWorkspace` 为唯一 workspace identity；overlay 用独立的 `activeOverlay` 状态
- Office 的 Escape unwind 迁入 `tryWorkspaceInternalBack()` 的 `case 'office'`
- OfficeWorkspaceShell 从接 30+ 个原始 props 缩减为接 `officeState` + `updateOfficeState` + 少量非状态 props

**Non-Goals:**

- 不改 shell 层级：Office 仍走 `shouldShowAppShell()` → `OfficeWorkspaceShellLazy`，不进 WorkspaceRouter（那是 Phase C）
- 不创建 `WorkspaceSessionContext` provider（那是 Phase B/C，需要先统一 shell）
- 不迁移全局状态（providerConfig, installFlow, companyEditor, employeeEditor, toasts）——这些不是 workspace-scoped
- 不迁移命令 token（focusOutputsToken, chatOpenToken）——这些是 imperative signal，不是持久状态
- 不改 `useWorkspaceBackNavigation` 的 browser history 逻辑

## Decisions

### D1: OfficeSessionState 扩展为 8 字段

```typescript
export type OfficeSessionState = {
  viewMode: '2D' | '3D';
  selectedEmployeeId: string | null;
  studioMode: 'create' | 'edit' | null;
  // ↓ 新增 5 字段，从 App.tsx useState 迁入
  dashboardOpen: boolean;
  kanbanOpen: boolean;
  marketplaceListingId: string | null;
  leftPanelWidth: number;
  rightPanelWidth: number;
};
```

**为什么这 8 个**：它们是 Office workspace 的 session 状态——离开 Office 时应保留（回来时恢复），且只在 Office 活跃时有意义。

**不迁入的**：
- `lastUserRequest` — 仅用于 onboarding 判断，transient
- `companyWizardMode` — overlay 生命周期，不是 workspace state
- `shortcutHelpOpen` — global dialog
- `providerConfig` — 跨 workspace 全局
- `portalPreviewCompanyId` / `activeTemplateId` — company-select 视图专用

**替代方案**：只迁移 3 个已有字段 → 拒绝，因为 dashboardOpen / kanbanOpen / marketplaceListingId 是 Office 最核心的 UI 状态，不迁就白做。

### D2: `view` 拆为 `activeWorkspace` + `activeOverlay`

当前 `AppView = WorkspaceKey | 'employee-creator' | 'office-editor' | 'company-select' | 'studio'`，混合了两个正交概念。

拆分方案：
```typescript
// activeWorkspace: WorkspaceKey — 已有，useWorkspaceSessionState() 管理
// activeOverlay: 新增
type OverlayKey = 'employee-creator' | 'office-editor' | 'company-select' | 'studio' | null;
```

- `activeWorkspace` 始终是 5 个 workspace 之一，不再被 overlay 覆盖
- `activeOverlay !== null` 时，overlay 全屏覆盖在当前 workspace 之上
- overlay 关闭时 `setActiveOverlay(null)`，下方 workspace 自动可见
- `shouldShowAppShell(view)` → `activeWorkspace === 'office' && activeOverlay === null`（或 `activeOverlay === 'employee-creator'`，后者在 Office 之上显示）
- `isFullPageWorkspaceView(view)` → `activeWorkspace !== 'office' && activeOverlay === null`

**替代方案**：保留 `view` 但让它派生自 `activeWorkspace` + overlay → 增加一层间接，不如直接拆干净。

### D3: Office Escape unwind 迁入 `tryWorkspaceInternalBack()`

在 `useWorkspaceSessionState.ts` 的 `tryWorkspaceInternalBack()` 增加 `case 'office'`：

```typescript
case 'office': {
  const o = sessionState.office;
  if (o.dashboardOpen) return [true, { ...sessionState, office: { ...o, dashboardOpen: false } }];
  if (o.kanbanOpen) return [true, { ...sessionState, office: { ...o, kanbanOpen: false } }];
  if (o.marketplaceListingId) return [true, { ...sessionState, office: { ...o, marketplaceListingId: null } }];
  if (o.selectedEmployeeId) return [true, { ...sessionState, office: { ...o, selectedEmployeeId: null } }];
  return [false, sessionState];
}
```

**保留在 App.tsx 的**：`shortcutHelpOpen`（global dialog）、`employeeEditor.isOpen`（editor hook 自管）。这两个不属于 workspace session state。

**unwind 优先级顺序**：dashboard → kanban → marketplace → selectedEmployee（与现有 L235-265 一致）。

### D4: OfficeWorkspaceShell props 精简

Before（30+ individual props）→ After:

```typescript
interface OfficeWorkspaceShellProps {
  // 状态 slice（替代 8 个独立 props）
  officeState: OfficeSessionState;
  updateOfficeState: (updater: (prev: OfficeSessionState) => OfficeSessionState) => void;

  // 非状态 props（保留，因为它们不是 office session state）
  activeCompanyId: string | null;
  anyOverlayOpen: boolean;
  providerConfig: ProviderConfig | null;
  chatOnboardingWelcome?: string;
  chatOnboardingStarterPrompts: string[];
  chatOpenToken: number;
  focusOutputsToken: number;
  lastUserRequest: string | null;

  // 事件回调（保留，因为它们触发全局副作用）
  onFileImport: (file: File) => void;
  onInstallListing: (listingId: string, version: string) => void;
  onUserMessage: (text: string) => void;

  // 导航（保留）
  navigation: NavigationCallbacks;
  employee: EmployeeActions;
  sceneView: SceneViewProps;
}
```

Shell 内部从 `officeState.dashboardOpen` 读取，不再从 `props.dashboardOpen` 读取。关闭 overlay 通过 `updateOfficeState(prev => ({ ...prev, dashboardOpen: false }))` 完成。

### D5: `hasInternalDrillIn()` 同步更新

`hasInternalDrillIn()` 增加 office case，与 `tryWorkspaceInternalBack()` 保持对称：

```typescript
case 'office': {
  const o = sessionState.office;
  return o.dashboardOpen || o.kanbanOpen || o.marketplaceListingId !== null || o.selectedEmployeeId !== null;
}
```

这使得 `canGoBack` 在 Office workspace 中也能正确反映。

### D6: keyboard shortcuts 中 Cmd+D / Cmd+J / Cmd+1 改为走 updateWorkspaceState

当前 App.tsx L208-222 直接调用 `setDashboardOpen` / `setKanbanOpen` / `setViewMode`。迁移后改为：

```typescript
updateWorkspaceState('office', prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen }));
```

只在 `activeWorkspace === 'office'` 时响应这些快捷键。

## Risks / Trade-offs

**[状态读取延迟]** → updateWorkspaceState 走 functional updater，setState 是 async batch；现有直接 `setDashboardOpen(false)` 也是 async batch，无额外延迟。无需 mitigation。

**[离开 Office 再回来的状态保留]** → OfficeSessionState 持久在 useWorkspaceSessionState 的 InternalState 里，切换 workspace 不会清除 office slice。Dashboard / kanban 打开状态会保留。这可能是 feature 也可能是 bug——如果用户切走再切回来发现 dashboard 还开着会觉得奇怪。→ Mitigation: `setActiveWorkspace()` 里增加 office leave cleanup（关闭 dashboard / kanban / marketplace），与 `studioMode` 已有的 cleanup 模式一致。

**[overlay 与 workspace 分离的边界 case]** → `company-select` 当前是独立 view，不叠在 office 上。拆分后它变成 overlay，可能影响 `shouldShowAppShell` 判断。→ Mitigation: `company-select` 在 `activeOverlay` 时 office 不显示（与现状行为一致），即 `shouldShowAppShell` 当 overlay 为 `company-select` / `studio` / `office-editor` 时返回 false。

**[无自动测试保护]** → 仓库无 vitest / playwright。→ Mitigation: live browser 手测，覆盖：workspace 切换 / Escape dismiss / keyboard shortcuts / overlay open-close / back button。
