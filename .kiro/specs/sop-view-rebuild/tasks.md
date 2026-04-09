# 任务：SOP 视图重建 (SOP View Rebuild)

## 1. 删除现有组件与创建基础模块
- [x] 1.1 删除 `packages/ui-office/src/components/sop/workspace/` 目录下所有文件（SopWorkspacePage.tsx、SopWorkspaceCanvas.tsx、SopWorkspaceContextPane.tsx、SopWorkspaceEmptyState.tsx、SopWorkspaceSidebar.tsx）
- [x] 1.2 删除不再需要的旧组件：SopPanel.tsx、SopDrawer.tsx、SopStepCard.tsx、SopTimelineView.tsx、SopDepConnector.tsx
- [x] 1.3 创建 `sop-dag-layout.ts` 纯函数模块：导出 `DAG_LAYOUT` 常量（nodeWidth=280, nodeHeight=140, columnGap=120, rowGap=32, padding=40）、`DagNodeLayout`/`DagEdgeLayout`/`DagLayout` 类型、`getExecutionBatches()` 函数（从 SopTimelineView 提取）和 `computeDagLayout()` 函数
- [x] 1.4 创建 `sop-commands.ts` 纯函数模块：导出 `formatRunCommand(name)`、`formatModifyCommand(name, text)`、`formatStepClickPrefill(label, role)` 三个消息格式化函数

## 2. DAG 布局算法与命令格式化属性测试
- [x] 2.1 <PBT> Property 1: DAG 拓扑排序批次不变量 — 使用 fast-check 生成随机有效 DAG，验证 getExecutionBatches 返回的批次满足：所有步骤恰好出现一次、同批次内无内部依赖、所有依赖在更早批次中。Tag: `Feature: sop-view-rebuild, Property 1: DAG topological sort batch invariant`
- [x] 2.2 <PBT> Property 2: SOP 定义序列化往返 — 使用 fast-check 生成随机 SopDefinition，验证 JSON.stringify → parseSopDefinition 往返后 steps 数组长度相同、每个 step 的 step_id/label/role_slug/dependencies 一致。Tag: `Feature: sop-view-rebuild, Property 2: SOP definition serialization round-trip`
- [x] 2.3 <PBT> Property 3: SOP 命令消息格式化 — 使用 fast-check 生成随机字符串，验证 formatRunCommand/formatModifyCommand/formatStepClickPrefill 输出匹配预期模式。Tag: `Feature: sop-view-rebuild, Property 3: SOP command message formatting`
- [x] 2.4 <PBT> Property 4: DAG 布局节点完整性 — 使用 fast-check 生成随机 DAG，验证 computeDagLayout 返回的 nodes 数量等于 steps 数量且 stepId 一致。Tag: `Feature: sop-view-rebuild, Property 4: DAG layout node completeness`
- [x] 2.5 <PBT> Property 5: DAG 布局同批次列对齐 — 使用 fast-check 生成随机 DAG，验证同 batchIndex 的节点具有相同 x 坐标。Tag: `Feature: sop-view-rebuild, Property 5: DAG layout batch column alignment`
- [x] 2.6 <PBT> Property 6: DAG 布局边端点正确性 — 使用 fast-check 生成随机 DAG，验证每条边的 fromPoint 位于源节点右侧中点、toPoint 位于目标节点左侧中点。Tag: `Feature: sop-view-rebuild, Property 6: DAG layout edge endpoint correctness`
- [x] 2.7 编写 getExecutionBatches 循环依赖边界测试：输入含循环的 SopDefinition，验证函数提前终止并返回部分批次

## 3. SOP DAG 节点与连线组件
- [x] 3.1 创建 `SopDagNode.tsx`：280×140px 节点卡片，深色背景 + 左侧 4px 角色颜色条（ROLE_COLORS 映射）+ 步骤标签（16px bold）+ 角色 badge（12px）+ instruction 摘要（14px, 2 行截断）+ 状态指示圆点（pending=灰/active=蓝脉冲/completed=绿/failed=红）+ hover 边框发光 + selected accent 边框
- [x] 3.2 创建 `SopDagEdge.tsx`：SVG 贝塞尔曲线组件，接受 `DagEdgeLayout` + `SopStepStatus`，实现 buildBezierPath 曲线算法，按状态设置 stroke 颜色和粒子动画（active 时 `<animateMotion>` 流动粒子）

## 4. SOP DAG 画布组件
- [x] 4.1 创建 `SopDagCanvas.tsx`：接受 `DagLayout` + `runtimeState` + `selectedStepId` + `onStepClick`，使用 SVG `<g>` 容器 + `transform` 渲染所有 edges 和 nodes（nodes 通过 `<foreignObject>` 嵌入）
- [x] 4.2 实现画布缩放：`onWheel` 事件处理，以鼠标位置为缩放中心，scale 范围 clamp 到 [0.25, 2]
- [x] 4.3 实现画布平移：`onMouseDown`/`onMouseMove`/`onMouseUp` 拖拽处理，更新 translate 偏移
- [x] 4.4 实现 fitToView：根据 `layout.totalWidth`/`totalHeight` 和容器尺寸（通过 `useRef` + `ResizeObserver` 获取）计算初始 scale 和 translate，首次加载时自动调用
- [x] 4.5 将运行时状态映射到节点和边：通过 `runtimeState` 的 stepIndex 匹配 definition.steps 索引，为每个节点和边计算 SopStepStatus

## 5. SOP 操作栏与输入栏组件
- [x] 5.1 创建 `SopLibraryBar.tsx`：固定高度 h-14，包含 SOP 下拉选择器（240px 宽，显示名称 + stepCount）、搜索输入框（flex-1，过滤下拉选项）、操作按钮组（Run/Import/Create），Delete 和 Sync 按条件显示
- [x] 5.2 创建 `SopNlCommandBar.tsx`：固定高度 h-16，包含输入框（flex-1, bg-white/5）+ Send 按钮，Enter 键提交（不含 Shift），disabled 时半透明
- [x] 5.3 创建 `SopEmptyState.tsx`：无 SOP 选中时的全屏引导界面，居中图标 + 文案 + Create/Import 按钮

## 6. SOP 视图入口组件
- [x] 6.1 创建 `SopViewSurface.tsx`：接受 `SopSessionState` + `onSessionStateChange`，编排垂直三段式布局（SopLibraryBar + SopDagCanvas/SopEmptyState + SopNlCommandBar）
- [x] 6.2 集成数据流：调用 `useSops()` 获取列表、`parseSopDefinition()` 解析选中 SOP、`computeDagLayout()` 计算布局、`useSopRuntimeState()` 获取运行时状态
- [x] 6.3 实现 SOP 操作回调：Run（`sendMessage(formatRunCommand(name))`）、Modify（`sendMessage(formatModifyCommand(name, text))`）、步骤点击预填（`formatStepClickPrefill(label, role)`）、Delete（`deleteSop(id)`）、Sync（`SopSyncService.syncFromUrl(id)`）
- [x] 6.4 实现选中 SOP 被删除时的自动恢复：`useEffect` 检测 SOP 从列表消失，Toast 提示，清除 selectedSopId
- [x] 6.5 集成 SopEditorDialog 和 SopImportDialog：管理 `editorOpen`/`importOpen` 状态，创建/导入成功后调用 `refreshSops()`

## 7. 集成到 Office 路由与编译验证
- [x] 7.1 在 `OfficeWorkspaceShell` 的 centerContent 中，当 `viewMode === 'sop'` 时渲染 `SopViewSurface`（替换 navigation-architecture spec 中的占位 `<div>`），传递 SOP session state
- [x] 7.2 清理旧组件的导入引用：更新所有引用已删除组件的文件（如 App.tsx 中的 SopWorkspacePage 导入）
- [x] 7.3 运行 TypeScript 编译检查（`tsc --noEmit`），修复所有因组件删除和替换导致的类型错误
- [x] 7.4 运行 Biome lint 检查，确保所有新文件符合项目规范（2-space indent, single quotes, trailing commas）
