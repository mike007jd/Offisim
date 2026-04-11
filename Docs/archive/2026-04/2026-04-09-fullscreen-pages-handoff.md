# Handoff: SOP / Market / Activity Log / Settings 全屏页面重写

## 任务概述

Offisim 有 4 个全屏页面需要**从零重写**——不是修改 CSS，不是调布局，是删掉现有组件重新设计和实现。

当前状态：所有页面都是为小面板设计后强行塞进全屏的，信息架构、布局结构、视觉设计全部不适配。

## 核心设计要求

1. **游戏风格 UI** — Offisim 是办公模拟游戏，UI 要像游戏界面（参考 Steam 商店、游戏设置菜单、游戏事件日志）
2. **全屏利用** — 不能有大面积空白，内容必须填满可用空间
3. **SOP 不是独立页面** — 应该和 Office 视图同级，像 2D/3D 视图切换那样（在主界面中间区域显示，保留左侧 Team sidebar + 右侧 Chat）
4. **Market/Activity/Settings 是独立全屏页面** — 只需要一个 "← Office" 返回按钮，不需要页面间导航 tab
5. **重写不是修补** — 删掉现有组件文件，用 Write 创建全新组件

## 导航架构变更

### 当前架构（需要改）
```
Office 主界面 → 点击导航按钮 → FullPageWorkspaceShell（header + 面包屑 + tab pills + 圆角容器）→ WorkspacePageShell（又一层 header）→ 3-pane 内容
```

### 目标架构
```
SOP: Office 主界面中间区域切换（同 2D/3D 切换），不离开 Office 布局
Market: 全屏页面，只有 "← Office" 按钮
Activity Log: 全屏页面，只有 "← Office" 按钮  
Settings: 全屏页面，只有 "← Office" 按钮
```

### 需要改的文件
- `apps/web/src/App.tsx` — SOP 的路由从 `isFullPageWorkspaceView()` 移到 Office 视图内部
- `apps/web/src/components/workspaces/FullPageWorkspaceShell.tsx` — 去掉 header/面包屑/tab pills/圆角容器，只留 "← Office" 按钮 + 全屏 children
- `apps/web/src/lib/app-view-layout.ts` — 修改 SOP 的分类

---

## 页面 1: SOP（标准操作流程）

### 业务逻辑

**入口**: `packages/ui-office/src/components/sop/workspace/SopWorkspacePage.tsx`

**数据源**:
- `useSops()` → `{ sops: SopTemplate[], loading, deleteSop, refreshSops }`
- `useSopRuntimeState(sopTemplateId)` → `SopRuntimeStepState[]` (每步: stepIndex, status)
- `parseSopDefinition(definitionJson)` → `SopDefinition` (DAG 结构)
- `sendMessage(text)` — 发消息给 AI runtime

**SopTemplate 结构**:
```ts
{
  sopTemplateId: string;
  name: string;
  description: string;
  stepCount: number;
  sourceUrl?: string;
  sourceThreadId?: string;
  definitionJson: string; // JSON string → SopDefinition
  version?: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
}
```

**SopDefinition (解析后)**:
```ts
{
  sop_id: string;
  name: string;
  steps: SopStep[]; // DAG: 每步有 dependencies[]
}
```

**SopStep**:
```ts
{
  step_id: string;
  label: string;
  role_slug: RoleSlug; // developer, designer, pm, qa, etc.
  instruction: string;
  dependencies: string[]; // 依赖的 step_id 列表
  output_key: string;
}
```

**用户操作**:
| 操作 | 实现 |
|------|------|
| 选择 SOP | `onSessionStateChange(prev => ({...prev, selectedSopId}))` |
| Run SOP | `sendMessage("Run the SOP: {name}")` |
| NL 编辑 SOP | `sendMessage("Modify the SOP \"{name}\": {text}")` |
| 点击步骤 | 预填 NL 输入: `For step "{label}" ({role}): ` |
| Create SOP | 打开 `SopEditorDialog` |
| Import SOP | 打开 `SopImportDialog` |
| Delete SOP | `deleteSop(sopTemplateId)` |
| Sync from URL | `SopSyncService.syncFromUrl(sopTemplateId)` |

**DAG 渲染**: `getExecutionBatches(definition)` 将步骤按拓扑排序分批。同批步骤可并行执行，跨批有依赖关系。当前用 `SopDepConnector` 画 SVG 贝塞尔曲线连线 + 动画粒子。

**Session State**:
```ts
{
  selectedSopId: string | null;
  leftPaneMode: 'library' | 'active-runs';
  centerMode: 'empty' | 'definition' | 'run-focus';
  rightPaneTab: 'context' | 'runs' | 'history';
  search: string;
}
```

### 设计方向

SOP 应该作为 Office 主界面的一个视图模式（类似 2D 地图视图），不是独立全屏页面。在 Office 布局中，中间主区域显示 SOP 内容，左侧 Team sidebar 和右侧 Chat panel 保留。

流程图应该是全宽的，节点可以参考 n8n/Retool 的可视化工作流设计。每个节点要大到能看清信息（角色、状态、依赖关系）。

---

## 页面 2: Market（市场/包管理）

### 业务逻辑

**入口**: `packages/ui-office/src/components/marketplace/workspace/MarketWorkspacePage.tsx`

**数据源**:
- `useMarketplace()` → `{ results, query, setQuery, filters, setKind, setSort, isLoading, isLoadingMore, error, hasMore, loadMore }`
- `useListingDetail(listingId)` → `{ detail: ListingDetail, loading, unavailable }`
- `useInstallService()` → install 功能（来自 props）

**ListingSummary (列表项)**:
```ts
{
  listing_id: string;
  title: string;
  summary: string;
  kind: AssetKind; // 'employee' | 'skill' | 'sop' | 'component' | ...
  creator: { handle: string };
  rating: number;
  install_count: number;
}
```

**ListingDetail (详情)**:
```ts
{
  ...ListingSummary;
  permissions: Permission[];
  tags: string[];
  latest_version: string;
}
```

**AssetKind**: `'employee' | 'skill' | 'sop' | 'component'` — 可按 kind 过滤
**MarketSortOption**: `'relevance' | 'newest' | 'rating' | 'installs'`

**两种模式**:
1. **Explore** — 搜索 + 过滤 + 卡片网格浏览
2. **Manage** — 已安装/更新/已发布 三个 tab

**用户操作**:
| 操作 | 实现 |
|------|------|
| 搜索 | `setQuery(search)` |
| 过滤 Kind | `setKind(kind)` |
| 排序 | `setSort(sort)` |
| 选择 listing | `onSessionStateChange(prev => ({...prev, selectedListingId}))` |
| 安装 | `onStartInstall(listingId, version)` |
| 发布 | 打开 `PublishDialog` |
| 加载更多 | `loadMore()` |
| 重置过滤 | search='', sort='relevance', kind='all' |

**子组件**:
- `MarketWorkspaceExplore` — 卡片网格（explore 模式）
- `MarketWorkspaceDetail` — listing 详情视图
- `MarketWorkspaceManage` — 已安装/更新/已发布
- `ListingCard` — 单个 listing 卡片
- `PublishDialog` — 发布对话框
- `PermissionsBlock` — 权限展示

**图标映射**: `KIND_ICON` 和 `KIND_FILTERS` 在 `marketplace-meta.ts`

**Session State**:
```ts
{
  mode: 'explore' | 'manage';
  selectedListingId: string | null;
  search: string;
  sort: MarketSortOption;
  kind: AssetKind | 'all';
  manageTab: 'installed' | 'updates' | 'published';
}
```

### 设计方向

像游戏商店（Steam/Epic Games Store/Fortnite Item Shop）。卡片按 kind 有不同的"稀有度"配色。全屏网格，过滤器紧凑排列在顶部。错误状态应该是游戏风格的 "Connection Lost" 界面。

---

## 页面 3: Activity Log（活动日志）

### 业务逻辑

**入口**: `packages/ui-office/src/components/events/workspace/ActivityLogPage.tsx`

**数据源**:
- `hydrateEventLogStore(eventBus, bootstrapState.eventHistory)` → 实时事件流
- 事件通过 `store.listeners` Set 同步到组件 state

**RuntimeEvent 结构**:
```ts
{
  type: string;       // e.g. "employee.created", "graph.node.entered"
  timestamp: number;  // Unix timestamp
  entityId?: string;
  entityType?: string;
  payload: Record<string, unknown>;
}
```

**事件分类**:
- `getEventLevel(event)` → `'Info' | 'Warning' | 'Error'`（基于 type 前缀）
- `getDisplayLabel(event)` → 从 payload 提取可读标签（employeeName/nodeName/name/message）
- `TYPE_PREFIX_MAP` — 事件类型到前缀的映射
- Domain icons: `hr.*`→UserCheck, `mcp.*`→Plug, `knowledge.*`→BookOpen, etc.

**过滤系统**:
- 日期: `getDateCutoff(datePreset)` — today/7d/30d/custom
- 事件类型: 按 `TYPE_PREFIX_MAP` 前缀匹配
- Actor: `matchesActorFilters(event, actorFilters)` — 从 payload 提取 actor
- 搜索: 全文匹配 type + label + entityType

**Event Focus（详情视图）**: 点击事件 → 显示 `ActivityLogEventFocus` 组件，包含事件类型、级别、时间戳、实体信息、原始 payload

**Session State**:
```ts
{
  selectedEventId: string | null;
  search: string;
  eventTypes: string[];
  actorFilters: string[];
  datePreset: 'today' | '7d' | '30d' | 'custom';
}
```

### 设计方向

像游戏事件日志/战斗记录。事件行要有清晰的视觉层级（图标、颜色编码、时间分组）。错误事件用红色、警告用黄色。事件详情页要像游戏成就/任务详情弹窗，不是纯文本 JSON dump。默认 datePreset 应改为 '30d'（当前 'today' 导致首次进入空白）。

---

## 页面 4: Settings（设置）

### 业务逻辑

**入口**: 
- `packages/ui-office/src/components/settings/SettingsPage.tsx` (全屏入口)
- `packages/ui-office/src/components/settings/SettingsDialog.tsx` (对话框入口, 共享组件)
- `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` (共享 Surface, 含 controller hook)

**Controller Hook**: `useSettingsWorkspaceController(options)` — 管理所有设置状态

**4 个 Tab**:

### Tab 1: Provider
- **Provider 预设选择**: `PROVIDER_PRESETS` → 自动填充 baseURL/model/headers
- **API Key**: 浏览器端明文，桌面端存 keychain
- **Model**: 模型标识符
- **Base URL**: API 端点（部分 preset 有默认值）
- **Default Headers**: JSON 格式

### Tab 2: Runtime
- **Execution Mode**: auto/sequential/parallel
- **Summarization**: enabled + triggerTokens + keepRecentMessages
- **Memory**: enabled + injectionEnabled + maxFacts + confidenceThreshold
- **Tool Search**: enabled
- **Git Auto-commit**: enabled（桌面端专用）
- **Tool Permissions**: ask/allow/deny
- **Display Density**: compact/normal/spacious

### Tab 3: MCP
- `McpConfigPanel` — 独立组件，MCP 服务器配置

### Tab 4: Gateway
- `OpenClawSettings` — 独立组件，OpenClaw 网关配置

**保存**: `saveProviderConfig(config)` → localStorage，然后 `onSave(config)` 回调
**未保存状态**: `hasUnsavedChanges` — 通过 snapshot 比较

**注意**: `SettingsDialog` 和 `SettingsPage` 共享同一个 `SettingsWorkspaceSurface` 组件。改 Surface 会同时影响对话框和全屏两种入口。

**Session State**:
```ts
{
  activeTab: 'provider' | 'runtime' | 'mcp' | 'openclaw';
}
```

### 设计方向

像游戏设置菜单（Cyberpunk 2077/Fortnite 设置）。侧边 tab 导航 + 右侧内容区填满。每个设置项目要紧凑，组、标签、控件对齐。Save 按钮要醒目。

---

## 通用 Shell 结构

### FullPageWorkspaceShell（Market/Activity/Settings 共用）
`apps/web/src/components/workspaces/FullPageWorkspaceShell.tsx`

**目标**: 去掉所有 chrome（header/面包屑/tab pills/圆角容器），只保留：
- 一个浮动的 "← Office" 返回按钮（absolute positioned, 左上角）
- children 占据 100% 视口

**Props**: `activeWorkspace`, `companyName`, `onBackToOffice`, `onOpenSettings`, `onWorkspaceSwitch`, `children`

### WorkspacePageShell（被各 Page 组件包裹）
`packages/ui-office/src/components/workspace/WorkspacePageShell.tsx`

提供 loading skeleton、error state、empty state、topSlot（toast）等功能壳。目前还有 header（eyebrow + title），重写时考虑是否还需要这个 header。

---

## 失败教训（给下一个 session 的警告）

1. **不要在现有 JSX 上改 className** — 必须删掉文件用 Write 重写
2. **不要保留 3-pane 布局** — sidebar + canvas + context 是小面板设计，全屏页面需要完全不同的结构
3. **不要居中窄内容** — `max-w-[960px] mx-auto` 或居中的小卡片在全屏下 = 大面积空白
4. **不要做竖屏设计** — 1440px+ 宽屏下，窄列内容是浪费
5. **UI 不能只看 build pass** — 必须浏览器验证视觉效果
6. **SOP 不是独立页面** — 它应该在 Office 主界面内切换，类似 2D/3D 视图

## 技术约束

- React 19 + TypeScript strict + Tailwind CSS + Vite
- Biome linter（2-space indent, single quotes, trailing commas）
- `@offisim/ui-core` 提供 Button, Input, Select, Tabs, Card 等原子组件
- `@offisim/shared-types` 提供类型定义
- 浏览器代码必须用 `@offisim/core/browser`
- 测试: vitest + @testing-library/react
- UI 全英文
