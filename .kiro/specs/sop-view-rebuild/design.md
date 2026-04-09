# 设计文档：SOP 视图重建 (SOP View Rebuild)

## 概述

本设计覆盖 SOP 页面内容的完全重建——从现有 3-pane 小面板设计重建为 Office 中间区域的全宽 DAG 工作流可视化。核心变更：

1. **删除现有 workspace/ 组件** — SopWorkspacePage、SopWorkspaceCanvas、SopWorkspaceContextPane、SopWorkspaceEmptyState、SopWorkspaceSidebar
2. **新建垂直三段式布局** — SopLibraryBar（顶部操作栏）+ SopDagCanvas（可缩放 DAG 画布）+ SopNlCommandBar（底部 NL 输入栏）
3. **n8n/Retool 风格 DAG 节点** — 280×140px 大尺寸节点，SVG 贝塞尔曲线连线，实时状态动画
4. **纯函数 DAG 布局算法** — 可独立测试的拓扑排序 + 坐标计算

本 spec 不涉及导航架构变更（由 navigation-architecture spec 处理），仅实现 SOP 视图的内容渲染。

依赖：navigation-architecture spec 提供的 `OfficeViewMode` 类型和 `viewMode='sop'` 路由分支。

## 架构

### 组件层级

```
OfficeWorkspaceShell (view === 'office', viewMode === 'sop')
└── centerContent:
    └── SopViewSurface                    ← 入口组件（垂直三段布局）
        ├── SopLibraryBar                  ← 顶部 h-14：SOP 选择器 + 搜索 + 操作按钮
        ├── SopDagCanvas                   ← 中间 flex-1：可缩放/平移 SVG DAG 画布
        │   ├── <svg> 容器（transform: scale + translate）
        │   │   ├── SopDagEdge × N         ← SVG 贝塞尔曲线连线
        │   │   └── <foreignObject> × N
        │   │       └── SopDagNode × N     ← 280×140px 步骤节点卡片
        │   └── (wheel zoom + drag pan handlers)
        ├── SopEmptyState                  ← 无 SOP 选中时替代 DagCanvas
        └── SopNlCommandBar                ← 底部 h-16：NL 输入 + Send 按钮
```

### 数据流

```mermaid
graph LR
    useSops --> SopViewSurface
    SopViewSurface -->|selectedSopId| parseSopDefinition
    parseSopDefinition -->|SopDefinition| computeDagLayout
    computeDagLayout -->|DagLayout| SopDagCanvas
    useSopRuntimeState -->|SopRuntimeStepState[]| SopDagCanvas
    SopDagCanvas -->|onStepClick| SopNlCommandBar
    SopNlCommandBar -->|sendMessage| Runtime
    SopLibraryBar -->|Run/Edit/Import/Create/Delete/Sync| Actions
```

### 全屏布局设计

```
┌─────────────────────────────────────────────────────────────────┐
│ SopLibraryBar (h-14)                                            │
│ [SOP 下拉选择器 ▼] [🔍 Search...] [▶ Run] [✏ Edit] [↓ Import] [+ Create] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    SopDagCanvas (flex-1)                         │
│                                                                 │
│   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│   │ Step 1       │───────▶│ Step 2       │───────▶│ Step 4       │
│   │ 🟢 PM        │        │ ○ Developer  │        │ ○ QA         │
│   │ Define reqs  │        │ Implement... │        │ Run tests... │
│   │ ● completed  │        │ ○ pending    │        │ ○ pending    │
│   └──────────────┘        └──────────────┘        └──────────────┘
│                           ┌──────────────┐             │
│                           │ Step 3       │─────────────┘
│                           │ ○ Designer   │
│                           │ Create mock..│
│                           │ ○ pending    │
│                           └──────────────┘
│                                                                 │
│   (可平移/缩放 SVG 画布，wheel zoom 0.25x-2x，drag pan)         │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ SopNlCommandBar (h-16)                                          │
│ [💬 For step "Design UI" (designer): ___________________] [Send]│
└─────────────────────────────────────────────────────────────────┘
```

## 组件与接口

### 1. SopViewSurface — 入口组件

**文件**: `packages/ui-office/src/components/sop/SopViewSurface.tsx`

Office 中间区域的 SOP 视图入口。管理 SOP 选择、解析、布局计算和子组件编排。

```tsx
interface SopViewSurfaceProps {
  sessionState: SopSessionState;
  onSessionStateChange: (updater: (prev: SopSessionState) => SopSessionState) => void;
}

type SopSessionState = {
  selectedSopId: string | null;
  search: string;
};
```

**职责：**
- 调用 `useSops()` 获取 SOP 列表
- 调用 `parseSopDefinition(definitionJson)` 解析选中 SOP
- 调用 `computeDagLayout(definition)` 计算布局
- 调用 `useSopRuntimeState(sopTemplateId)` 获取运行时状态
- 管理 `editorOpen`、`importOpen` 对话框状态
- 管理 `nlInput` 预填文本（步骤点击时设置）
- 管理 `selectedStepId`（DAG 节点选中状态）
- 检测选中 SOP 被删除时自动清除选中状态

### 2. SopLibraryBar — 顶部操作栏

**文件**: `packages/ui-office/src/components/sop/SopLibraryBar.tsx`

```tsx
interface SopLibraryBarProps {
  sops: SopTemplate[];
  selectedSopId: string | null;
  search: string;
  loading: boolean;
  hasSourceUrl: boolean;
  onSelectSop: (sopId: string) => void;
  onSearchChange: (search: string) => void;
  onRun: () => void;
  onDelete: () => void;
  onSync: () => void;
  onCreateClick: () => void;
  onImportClick: () => void;
}
```

**布局：** 固定高度 56px（h-14），水平排列：
- SOP 下拉选择器（`<Select>`，宽度 240px，显示 SOP 名称 + stepCount）
- 搜索输入框（`<Input>`，flex-1，过滤下拉列表选项）
- 操作按钮组：Run（`<Button variant="default">`）、Import、Create
- 更多操作（Delete、Sync）通过下拉菜单或条件显示

### 3. SopDagCanvas — DAG 画布

**文件**: `packages/ui-office/src/components/sop/SopDagCanvas.tsx`

可缩放/平移的全宽 DAG 渲染器。

```tsx
interface SopDagCanvasProps {
  layout: DagLayout;
  runtimeState: SopRuntimeStepState[] | null;
  selectedStepId: string | null;
  onStepClick: (stepId: string) => void;
}
```

**交互实现：**
- 使用 `useState` 管理 `scale`（默认 1，范围 0.25-2）和 `translate`（{x, y}）
- `onWheel` 事件：`e.deltaY` 控制缩放，以鼠标位置为缩放中心
- `onMouseDown` + `onMouseMove` + `onMouseUp`：拖拽平移
- SVG 容器使用 `transform: translate(${tx}px, ${ty}px) scale(${scale})`
- `fitToView()` 函数：根据 `layout.totalWidth`/`totalHeight` 和容器尺寸计算初始 scale + translate

**渲染结构：**
```tsx
<div ref={containerRef} className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing"
     onWheel={handleWheel} onMouseDown={handleMouseDown}>
  <svg width="100%" height="100%">
    <g transform={`translate(${tx}, ${ty}) scale(${scale})`}>
      {/* Edges first (behind nodes) */}
      {layout.edges.map(edge => <SopDagEdge key={...} edge={edge} status={...} />)}
      {/* Nodes via foreignObject */}
      {layout.nodes.map(node => (
        <foreignObject key={node.stepId} x={node.x} y={node.y}
                       width={node.width} height={node.height}>
          <SopDagNode step={node.step} status={...} selected={...} onClick={...} />
        </foreignObject>
      ))}
    </g>
  </svg>
</div>
```

### 4. SopDagNode — 步骤节点

**文件**: `packages/ui-office/src/components/sop/SopDagNode.tsx`

280×140px 的 n8n/Retool 风格节点卡片。

```tsx
interface SopDagNodeProps {
  step: SopStep;
  status: SopStepStatus;
  selected: boolean;
  onClick: () => void;
}

type SopStepStatus = 'pending' | 'active' | 'completed' | 'failed';
```

**视觉设计：**
```
┌─┬──────────────────────────────────────────┐
│ │ ● Step Label (16px bold)      [role badge]│  ← 顶部行
│C│                                           │
│O│ Instruction text excerpt that can span    │  ← 中间内容
│L│ up to two lines before truncating...      │
│O│                                           │
│R│                                           │
│ │                                           │
│B│                                           │
│A│                                           │
│R│                                           │
└─┴──────────────────────────────────────────┘
```

- 深色卡片背景（`bg-slate-800/80 border border-white/10`）
- 左侧 4px 角色颜色条（基于 `role_slug` 映射颜色）
- 状态指示圆点：左上角，pending=`bg-slate-500`，active=`bg-blue-400 animate-pulse`，completed=`bg-emerald-400`，failed=`bg-red-400`
- Hover：`border-white/20 shadow-lg shadow-white/5`（边框发光 + 轻微上浮）
- Selected：`border-blue-400/60 shadow-blue-400/20`（accent 边框 + 发光）

**角色颜色映射：**
```tsx
const ROLE_COLORS: Record<string, string> = {
  developer: '#3b82f6',   // blue-500
  designer: '#a855f7',    // purple-500
  pm: '#f59e0b',          // amber-500
  qa: '#10b981',          // emerald-500
  devops: '#ef4444',      // red-500
  default: '#64748b',     // slate-500
};
```

### 5. SopDagEdge — 依赖连线

**文件**: `packages/ui-office/src/components/sop/SopDagEdge.tsx`

SVG 贝塞尔曲线连线，复用现有 `SopDepConnector` 的曲线算法。

```tsx
interface SopDagEdgeProps {
  edge: DagEdgeLayout;
  status: SopStepStatus;
}
```

**曲线算法：**
```tsx
function buildBezierPath(from: Point, to: Point): string {
  const dx = (to.x - from.x) * 0.4;
  return `M${from.x},${from.y} C${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`;
}
```

**状态样式：**
- pending: `stroke: rgba(255,255,255,0.08)`, strokeWidth 1.5
- active: `stroke: rgba(96,165,250,0.5)`, strokeWidth 2, + 流动粒子动画（`<animateMotion>`）
- completed: `stroke: rgba(52,211,153,0.4)`, strokeWidth 1.5
- failed: `stroke: rgba(248,113,113,0.4)`, strokeWidth 1.5

### 6. SopNlCommandBar — NL 输入栏

**文件**: `packages/ui-office/src/components/sop/SopNlCommandBar.tsx`

```tsx
interface SopNlCommandBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
}
```

**布局：** 固定高度 64px（h-16），水平排列：
- 输入框（`<input>`，flex-1，深色背景 `bg-white/5 border border-white/10`）
- Send 按钮（`<button>`，图标 `<Send />`，disabled 时半透明）
- Enter 提交，Shift+Enter 不提交（单行输入，无需换行）

### 7. SopEmptyState — 空状态

**文件**: `packages/ui-office/src/components/sop/SopEmptyState.tsx`

```tsx
interface SopEmptyStateProps {
  hasNoSops: boolean;
  onCreateClick: () => void;
  onImportClick: () => void;
}
```

无 SOP 选中时的全屏引导界面。居中显示图标 + 文案 + Create/Import 按钮。

### 8. sop-dag-layout.ts — DAG 布局算法

**文件**: `packages/ui-office/src/components/sop/sop-dag-layout.ts`

纯函数模块，无 React 依赖，可独立测试。

```tsx
// 布局常量
const DAG_LAYOUT = {
  nodeWidth: 280,
  nodeHeight: 140,
  columnGap: 120,
  rowGap: 32,
  padding: 40,
} as const;

// 输出类型
interface DagNodeLayout {
  stepId: string;
  step: SopStep;
  x: number;
  y: number;
  width: number;   // 280
  height: number;  // 140
  batchIndex: number;
}

interface DagEdgeLayout {
  fromStepId: string;
  toStepId: string;
  fromPoint: { x: number; y: number };  // 源节点右侧中点
  toPoint: { x: number; y: number };    // 目标节点左侧中点
}

interface DagLayout {
  nodes: DagNodeLayout[];
  edges: DagEdgeLayout[];
  totalWidth: number;
  totalHeight: number;
}

// 主函数
function computeDagLayout(definition: SopDefinition): DagLayout;
```

**算法步骤：**
1. 调用 `getExecutionBatches(definition)` 获取拓扑排序批次
2. 遍历批次，为每个步骤计算坐标：
   - `x = padding + batchIndex * (nodeWidth + columnGap)`
   - `y = padding + rowIndex * (nodeHeight + rowGap)`
3. 遍历所有步骤的 dependencies，计算边的端点：
   - `fromPoint = { x: sourceNode.x + nodeWidth, y: sourceNode.y + nodeHeight / 2 }`
   - `toPoint = { x: targetNode.x, y: targetNode.y + nodeHeight / 2 }`
4. 计算 `totalWidth` 和 `totalHeight`（最大 x + nodeWidth + padding，最大 y + nodeHeight + padding）

### 9. getExecutionBatches — 拓扑排序

复用现有 `SopTimelineView.tsx` 中的 `getExecutionBatches` 函数，提取到 `sop-dag-layout.ts` 中导出。

```tsx
function getExecutionBatches(def: SopDefinition): SopStep[][] {
  const steps = [...def.steps];
  const completed = new Set<string>();
  const batches: SopStep[][] = [];

  while (completed.size < steps.length) {
    const batch: SopStep[] = [];
    for (const step of steps) {
      if (completed.has(step.step_id)) continue;
      if (step.dependencies.every((d) => completed.has(d))) {
        batch.push(step);
      }
    }
    if (batch.length === 0) break; // 循环依赖检测
    for (const s of batch) completed.add(s.step_id);
    batches.push(batch);
  }
  return batches;
}
```

### 10. SOP 命令消息格式化

消息格式化逻辑提取为纯函数，便于测试：

```tsx
// sop-dag-layout.ts 或独立 sop-commands.ts
function formatRunCommand(sopName: string): string {
  return `Run the SOP: ${sopName}`;
}

function formatModifyCommand(sopName: string, text: string): string {
  return `Modify the SOP "${sopName}": ${text}`;
}

function formatStepClickPrefill(label: string, role: string): string {
  return `For step "${label}" (${role}): `;
}
```

## 数据模型

### 核心类型（来自 @offisim/shared-types，不修改）

```tsx
interface SopDefinition {
  sop_id: string;
  name: string;
  steps: SopStep[];
}

interface SopStep {
  step_id: string;
  label: string;
  role_slug: string;  // RoleSlug branded type
  instruction: string;
  dependencies: string[];
  output_key: string;
}
```

### 现有 Hook 接口（不修改）

```tsx
// useSops() → UseSopsResult
interface UseSopsResult {
  sops: SopTemplate[];
  loading: boolean;
  deleteSop: (sopTemplateId: string) => Promise<void>;
  refreshSops: () => Promise<void>;
}

// useSopRuntimeState(sopTemplateId) → SopRuntimeStepState[] | null
interface SopRuntimeStepState {
  stepIndex: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
}
```

### 新增类型

```tsx
// SopSessionState（简化版，去除 3-pane 字段）
type SopSessionState = {
  selectedSopId: string | null;
  search: string;
};

// DAG 布局类型（见 sop-dag-layout.ts 节）
interface DagNodeLayout { ... }
interface DagEdgeLayout { ... }
interface DagLayout { ... }

// 步骤状态类型（复用现有）
type SopStepStatus = 'pending' | 'active' | 'completed' | 'failed';
```

### 保留的组件

以下组件保留不动：
- `SopEditorDialog.tsx` — SOP 创建/编辑对话框
- `SopImportDialog.tsx` — SOP 导入对话框

### 删除的组件

以下组件将被删除：
- `workspace/SopWorkspacePage.tsx`
- `workspace/SopWorkspaceCanvas.tsx`
- `workspace/SopWorkspaceContextPane.tsx`
- `workspace/SopWorkspaceEmptyState.tsx`
- `workspace/SopWorkspaceSidebar.tsx`

以下组件在新实现中不再需要（功能被新组件替代）：
- `SopPanel.tsx` — 被 SopViewSurface 替代
- `SopDrawer.tsx` — 被 SopViewSurface 替代
- `SopStepCard.tsx` — 被 SopDagNode 替代
- `SopTimelineView.tsx` — 被 SopDagCanvas + sop-dag-layout 替代
- `SopDepConnector.tsx` — 被 SopDagEdge 替代

## 正确性属性

### Property 1: DAG 拓扑排序批次不变量

*对于任意*有效的 `SopDefinition`（步骤间依赖构成 DAG），`getExecutionBatches(definition)` 返回的批次应满足：
1. 所有步骤恰好出现一次（无遗漏、无重复）
2. 同一批次内没有步骤依赖于同批次的另一个步骤
3. 每个步骤的所有依赖都出现在更早的批次中

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 2: SOP 定义序列化往返

*对于任意*有效的 `SopDefinition` 对象，将其序列化为 JSON 字符串后调用 `parseSopDefinition()` 解析，应返回与原始对象等价的结构（steps 数组长度相同，每个 step 的 step_id、label、role_slug、dependencies 一致）。

**Validates: Requirements 5.3**

### Property 3: SOP 命令消息格式化

*对于任意* SOP 名称字符串 `name`、步骤标签 `label`、角色 `role` 和编辑文本 `text`：
- `formatRunCommand(name)` 应生成 `"Run the SOP: {name}"`
- `formatModifyCommand(name, text)` 应生成 `"Modify the SOP \"{name}\": {text}"`
- `formatStepClickPrefill(label, role)` 应生成 `"For step \"{label}\" ({role}): "`

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 4: DAG 布局节点完整性

*对于任意*有效的 `SopDefinition`，`computeDagLayout(definition)` 返回的 `nodes` 数量应等于 `definition.steps` 数量，且每个节点的 `stepId` 应与对应步骤的 `step_id` 一致。

**Validates: Requirements 8.2**

### Property 5: DAG 布局同批次列对齐

*对于任意*有效的 `SopDefinition`，`computeDagLayout(definition)` 返回的布局中，属于同一 `batchIndex` 的所有节点应具有相同的 `x` 坐标。

**Validates: Requirements 8.3**

### Property 6: DAG 布局边端点正确性

*对于任意*有效的 `SopDefinition`，`computeDagLayout(definition)` 返回的每条边的 `fromPoint` 应位于源节点的右侧中点（`x = node.x + node.width`, `y = node.y + node.height / 2`），`toPoint` 应位于目标节点的左侧中点（`x = node.x`, `y = node.y + node.height / 2`）。

**Validates: Requirements 8.4**

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| SOP 定义 JSON 解析失败 | `parseSopDefinition` 返回 `null`，SopViewSurface 显示空状态 |
| 选中的 SOP 被删除 | `useEffect` 检测 SOP 从列表消失，Toast 提示，自动清除 selectedSopId |
| sendMessage 失败 | NL 输入栏恢复可编辑状态，Toast 错误提示 |
| DAG 存在循环依赖 | `getExecutionBatches` 提前终止（`batch.length === 0`），渲染已解析的部分 |
| SOP 列表加载中 | SopLibraryBar 显示 loading 状态，下拉选择器 disabled |
| 缩放超出范围 | `handleWheel` 中 clamp scale 到 [0.25, 2] |

## 测试策略

### 属性测试（Property-Based Testing）

使用 `fast-check` 库，每个属性测试最少 100 次迭代。

1. **Property 1: DAG 拓扑排序** — 生成随机有效 DAG（无循环），验证三个不变量
2. **Property 2: SOP 定义往返** — 生成随机 `SopDefinition`，验证 JSON 序列化/反序列化往返
3. **Property 3: 命令格式化** — 生成随机字符串，验证消息格式匹配模式
4. **Property 4: 布局节点完整性** — 生成随机 DAG，验证节点数量和 ID 一致
5. **Property 5: 同批次列对齐** — 生成随机 DAG，验证同批次节点 x 坐标相同
6. **Property 6: 边端点正确性** — 生成随机 DAG，验证边端点位于节点正确位置

每个属性测试标注格式：`Feature: sop-view-rebuild, Property {N}: {描述}`

### 单元测试（Example-Based）

- SopViewSurface 渲染三段式布局
- SopLibraryBar 渲染选择器、搜索和按钮
- SopDagNode 渲染 label、role、status
- SopEmptyState 渲染 Create/Import 按钮
- SopNlCommandBar Enter 键提交
- 循环依赖 DAG 的 getExecutionBatches 提前终止

### 测试工具

- vitest + @testing-library/react
- fast-check（属性测试）
