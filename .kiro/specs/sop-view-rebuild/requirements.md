# 需求文档：SOP 视图重建 (SOP View Rebuild)

## 简介

Offisim 的 SOP（标准操作流程）页面需要从零重建为 Office 主界面内的视图模式。当 `viewMode='sop'` 时，Office 中间区域显示 SOP 的 DAG 工作流可视化，同时保留左侧 Team sidebar 和右侧 Chat panel。本次重建将删除现有 `workspace/` 子目录下的 3-pane 组件，替换为全新的垂直三段式布局（顶部操作栏 + 中间 DAG 画布 + 底部 NL 命令栏），采用 n8n/Retool 风格的大尺寸节点和 SVG 贝塞尔曲线连线。

本 spec 仅覆盖 SOP 页面内容实现，不涉及导航架构变更（由 navigation-architecture spec 处理）。

## 术语表

- **Office_View**: Offisim 的主界面，包含左侧 Team sidebar、中间主区域和右侧 Chat panel
- **SOP_View**: SOP 视图模式，作为 Office_View 中间区域的一种显示模式（与 2D/3D 同级）
- **SOP_Definition**: SOP 的解析后结构，包含 `sop_id`、`name` 和 `steps` 数组
- **SOP_Step**: SOP 中的单个步骤，包含 `step_id`、`label`、`role_slug`、`instruction`、`dependencies` 和 `output_key`
- **Execution_Batch**: 通过拓扑排序将 SOP steps 分批的结果，同批步骤可并行执行，跨批有依赖关系
- **DAG**: Directed Acyclic Graph，有向无环图，SOP 步骤间的依赖关系结构
- **DAG_Canvas**: 可平移/缩放的 SVG 画布，用于渲染 DAG 节点和连线
- **DAG_Node**: DAG 画布中的单个步骤节点（280×140px），显示标签、角色、状态和指令摘要
- **DAG_Edge**: DAG 画布中的依赖连线，使用 SVG 贝塞尔曲线从源节点右侧中点到目标节点左侧中点
- **NL_Command_Bar**: 底部自然语言输入栏，用于向 AI runtime 发送 SOP 操作指令
- **SOP_Library_Bar**: 顶部操作栏，包含 SOP 选择器、搜索和操作按钮
- **SOP_Session_State**: SOP 视图的会话状态，包含 `selectedSopId` 和 `search` 两个字段
- **Runtime_Step_State**: 每个步骤的运行时状态（pending/active/completed/failed）
- **SopSyncService**: SOP 同步服务，从源 URL 拉取最新 SOP 定义

## 需求

### 需求 1：SOP 视图入口与布局结构

**用户故事:** 作为 Offisim 用户，我希望在 Office 主界面中间区域看到 SOP 视图的垂直三段式布局，以便在保留 Team sidebar 和 Chat panel 的同时高效操作 SOP 工作流。

#### 验收标准

1. WHEN viewMode 切换为 'sop', THE SOP_View SHALL 在 Office_View 中间区域渲染垂直三段式布局：顶部 SOP_Library_Bar（固定高度 56px）、中间 DAG_Canvas（占据所有剩余空间）、底部 NL_Command_Bar（固定高度 64px）
2. THE SOP_View SHALL 删除现有 `workspace/` 子目录下的所有组件文件（SopWorkspacePage、SopWorkspaceCanvas、SopWorkspaceContextPane、SopWorkspaceEmptyState、SopWorkspaceSidebar），使用全新组件从零实现
3. THE SOP_View SHALL 针对 1440px 及以上宽屏优化布局，内容填满 Office_View 中间区域的可用空间，不使用 max-width 限制或居中窄内容
4. WHEN 没有 SOP 被选中, THE SOP_View SHALL 在中间区域显示全屏空状态引导界面，包含 Create 和 Import 两个操作按钮

### 需求 2：SOP 选择与库管理

**用户故事:** 作为 Offisim 用户，我希望通过顶部操作栏快速选择、搜索和管理 SOP，以便高效切换和操作不同的工作流。

#### 验收标准

1. THE SOP_Library_Bar SHALL 包含 SOP 下拉选择器、搜索输入框和操作按钮（Run、Edit、Import、Create）
2. WHEN 用户从 SOP 下拉选择器中选择一个 SOP, THE SOP_View SHALL 更新 SOP_Session_State 的 selectedSopId，调用 parseSopDefinition(definitionJson) 解析定义并渲染对应的 DAG 流程图
3. WHEN 用户在搜索框中输入文本, THE SOP_Library_Bar SHALL 按名称过滤 SOP 下拉列表中的选项
4. WHEN 用户点击 "Create" 按钮, THE SOP_View SHALL 打开 SopEditorDialog 对话框
5. WHEN 用户点击 "Import" 按钮, THE SOP_View SHALL 打开 SopImportDialog 对话框
6. WHEN 用户确认删除一个 SOP, THE SOP_View SHALL 调用 deleteSop(sopTemplateId) 删除该 SOP 并刷新列表
7. WHEN 用户触发同步操作, THE SOP_View SHALL 调用 SopSyncService.syncFromUrl(sopTemplateId) 从源 URL 同步 SOP 定义

### 需求 3：DAG 工作流可视化渲染

**用户故事:** 作为 Offisim 用户，我希望以全宽流程图的形式查看 SOP 的 DAG 结构，以便直观理解步骤间的依赖关系和执行顺序。

#### 验收标准

1. WHEN SOP_View 加载一个 SOP_Definition, THE DAG_Canvas SHALL 调用 getExecutionBatches() 将步骤按拓扑排序分批，每个 Execution_Batch 占一列，列内步骤垂直排列
2. THE DAG_Canvas SHALL 使用以下布局常量：节点尺寸 280×140px，列间距 120px，行间距 32px，画布内边距 40px
3. THE DAG_Node SHALL 显示以下信息：步骤标签（16px 粗体）、角色 badge（12px，带左侧 4px 角色颜色条）、instruction 摘要（14px，最多 2 行截断）、执行状态指示圆点（pending=灰色、active=蓝色脉冲、completed=绿色、failed=红色）
4. THE DAG_Edge SHALL 使用 SVG 贝塞尔曲线从源节点右侧中点连接到目标节点左侧中点，默认灰色半透明，active 时蓝色并带流动粒子动画，completed 时绿色实线
5. THE DAG_Canvas SHALL 支持鼠标滚轮缩放（范围 0.25x 至 2x）和拖拽平移
6. WHEN DAG_Canvas 首次加载一个 SOP_Definition, THE DAG_Canvas SHALL 自动执行 fit-to-view 将所有节点居中显示在可视区域内

### 需求 4：DAG 拓扑排序正确性

**用户故事:** 作为 Offisim 开发者，我希望 DAG 拓扑排序算法保证正确性，以确保步骤的执行顺序和依赖关系始终一致。

#### 验收标准

1. FOR ALL 有效的 SOP_Definition（步骤间依赖构成 DAG），getExecutionBatches() 返回的批次 SHALL 包含所有步骤恰好一次（无遗漏、无重复）
2. FOR ALL 有效的 SOP_Definition，同一 Execution_Batch 内 SHALL 不存在步骤依赖于同批次的另一个步骤
3. FOR ALL 有效的 SOP_Definition，每个步骤的所有依赖 SHALL 出现在该步骤所在批次之前的批次中
4. IF SOP_Definition 中存在循环依赖, THEN THE getExecutionBatches() SHALL 提前终止并返回已解析的部分批次（通过 batch.length === 0 检测）

### 需求 5：SOP 定义解析与序列化

**用户故事:** 作为 Offisim 开发者，我希望 SOP 定义的解析和序列化保持往返一致性，以确保数据在存储和传输过程中不丢失。

#### 验收标准

1. THE parseSopDefinition() SHALL 将有效的 JSON 字符串解析为 SOP_Definition 对象，包含 sop_id、name 和 steps 数组
2. IF parseSopDefinition() 接收到无效或空的 JSON 字符串, THEN THE parseSopDefinition() SHALL 返回 null
3. FOR ALL 有效的 SOP_Definition 对象，将其序列化为 JSON 字符串后再调用 parseSopDefinition() 解析，SHALL 返回与原始对象等价的结构（steps 数组长度相同，每个 step 的 step_id、label、role_slug、dependencies 一致）

### 需求 6：SOP 运行与自然语言交互

**用户故事:** 作为 Offisim 用户，我希望通过自然语言命令运行和编辑 SOP，以便用直觉化的方式操作工作流。

#### 验收标准

1. WHEN 用户点击 "Run" 按钮, THE SOP_View SHALL 调用 sendMessage("Run the SOP: {name}") 触发 SOP 执行，其中 {name} 为当前选中 SOP 的名称
2. WHEN 用户在 NL_Command_Bar 中提交编辑指令, THE SOP_View SHALL 调用 sendMessage("Modify the SOP \"{name}\": {text}") 发送修改请求，其中 {name} 为当前选中 SOP 的名称，{text} 为用户输入的文本
3. WHEN 用户点击 DAG 流程图中的某个步骤节点, THE SOP_View SHALL 在 NL_Command_Bar 中预填 "For step \"{label}\" ({role}): " 文本，其中 {label} 为步骤标签，{role} 为步骤角色
4. THE NL_Command_Bar SHALL 支持 Enter 键提交（不含 Shift）和 Shift+Enter 换行

### 需求 7：SOP 运行时状态显示

**用户故事:** 作为 Offisim 用户，我希望在 DAG 流程图中实时看到每个步骤的执行状态，以便追踪 SOP 的运行进度。

#### 验收标准

1. THE SOP_View SHALL 使用 useSopRuntimeState(sopTemplateId) 订阅当前选中 SOP 的运行时状态
2. WHEN Runtime_Step_State 更新, THE DAG_Node SHALL 实时更新对应步骤的状态指示：pending 显示灰色圆点、active 显示蓝色脉冲圆点、completed 显示绿色圆点、failed 显示红色圆点
3. WHEN Runtime_Step_State 更新, THE DAG_Edge SHALL 根据源节点状态更新连线样式：active 时蓝色并带流动粒子动画、completed 时绿色实线

### 需求 8：DAG 布局算法纯函数

**用户故事:** 作为 Offisim 开发者，我希望 DAG 布局算法是一个可测试的纯函数，以便独立验证布局计算的正确性。

#### 验收标准

1. THE sop-dag-layout 模块 SHALL 导出一个纯函数，输入 SOP_Definition，输出包含 nodes（DagNodeLayout 数组）、edges（DagEdgeLayout 数组）、totalWidth 和 totalHeight 的布局结果
2. FOR ALL 有效的 SOP_Definition，布局结果中的 nodes 数量 SHALL 等于 SOP_Definition 中的 steps 数量
3. FOR ALL 有效的 SOP_Definition，布局结果中同一 Execution_Batch 的节点 SHALL 具有相同的 x 坐标（同列对齐）
4. FOR ALL 有效的 SOP_Definition，布局结果中每条 edge 的 fromPoint SHALL 位于源节点右侧中点，toPoint SHALL 位于目标节点左侧中点
