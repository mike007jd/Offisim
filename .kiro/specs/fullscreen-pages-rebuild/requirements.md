# 需求文档：全屏页面重写 (Fullscreen Pages Rebuild)

## 简介

Offisim 是一款办公模拟游戏，当前有 4 个全屏页面（SOP、Market、Activity Log、Settings）需要从零重写。这些页面原本为小面板设计，强行塞入全屏后信息架构、布局结构和视觉设计均不适配。本次重写将彻底删除现有组件，按照游戏风格 UI 重新设计和实现，同时修正 SOP 的导航架构（从独立全屏页面改为 Office 主界面内的视图模式）。

这是第二次尝试——上一次 spec（workspace-ia-rebuild）采用了不同的方法但效果不佳。本次吸取的核心教训：不在现有 JSX 上改 className，不保留 3-pane 布局，不居中窄内容，不做竖屏设计，SOP 不是独立页面。

## 术语表

- **Office_View**: Offisim 的主界面，包含左侧 Team sidebar、中间主区域和右侧 Chat panel
- **FullPageWorkspaceShell**: 全屏工作区外壳组件，为 Market/Activity_Log/Settings 提供全屏容器
- **SOP**: Standard Operating Procedures，标准操作流程，基于 DAG 的工作流定义
- **SOP_Definition**: SOP 的解析后结构，包含 steps 数组，每个 step 有 dependencies 形成 DAG
- **Execution_Batch**: 通过拓扑排序将 SOP steps 分批，同批可并行执行，跨批有依赖
- **Market**: 包市场，提供 Explore（浏览）和 Manage（管理）两种模式
- **Activity_Log**: 活动日志，实时事件流，支持多维过滤
- **Settings_Surface**: Settings 的共享渲染面，同时被 SettingsDialog 和 SettingsPage 使用
- **AssetKind**: 市场资产类型枚举：employee、skill、sop、component
- **RuntimeEvent**: 运行时事件结构，包含 type、timestamp、entityId、payload 等字段
- **DAG**: Directed Acyclic Graph，有向无环图，SOP 步骤间的依赖关系结构
- **Back_Button**: 浮动的 "← Office" 返回按钮，用于从全屏页面返回 Office 主界面
- **View_Mode**: Office 主界面中间区域的显示模式（2D / 3D / SOP）

## 需求

### 需求 1：导航架构重构 — SOP 从全屏页面降级为 Office 视图模式

**用户故事:** 作为 Offisim 用户，我希望 SOP 作为 Office 主界面的一个视图模式（类似 2D/3D 切换），以便在查看工作流时仍能访问 Team sidebar 和 Chat panel。

#### 验收标准

1. WHEN 用户在 Office_View 中切换到 SOP 视图模式, THE App_Router SHALL 在 Office_View 的中间主区域渲染 SOP 内容，保留左侧 Team sidebar 和右侧 Chat panel
2. THE App_View_Layout SHALL 将 'sops' 从 FULL_PAGE_WORKSPACE_VIEWS 数组中移除，使 SOP 不再被 isFullPageWorkspaceView() 识别为全屏工作区
3. WHEN 用户切换到 SOP View_Mode, THE Office_View SHALL 将 SOP 视图模式与现有的 2D/3D View_Mode 同级处理，支持在三种模式间自由切换
4. THE FullPageWorkspaceShell SHALL 不再为 SOP 提供外壳容器，仅服务于 Market、Activity_Log 和 Settings 三个全屏页面

### 需求 2：FullPageWorkspaceShell 精简 — 去除多余 Chrome

**用户故事:** 作为 Offisim 用户，我希望全屏页面（Market/Activity_Log/Settings）只有一个简洁的返回按钮，没有多余的 header、面包屑和 tab pills，以获得沉浸式的游戏风格体验。

#### 验收标准

1. THE FullPageWorkspaceShell SHALL 移除 header 区域（包含公司名称、"Workspace" 标签和面包屑路径）
2. THE FullPageWorkspaceShell SHALL 移除工作区切换 tab pills（SOPs/Market/Activity Log/Settings 圆角按钮组）
3. THE FullPageWorkspaceShell SHALL 移除圆角容器（rounded-[28px] border 外框）和内边距限制
4. THE FullPageWorkspaceShell SHALL 保留一个浮动的 Back_Button，使用 absolute 定位于左上角，显示 "← Office" 文字
5. THE FullPageWorkspaceShell SHALL 让 children 占据 100% 视口宽度和高度

### 需求 3：SOP 页面重写 — DAG 工作流可视化

**用户故事:** 作为 Offisim 用户，我希望在 Office 主界面中查看和操作 SOP 工作流，以全宽流程图的形式展示 DAG 结构，方便理解步骤间的依赖关系。

#### 验收标准

1. THE SOP_View SHALL 删除现有 SOP 组件文件，使用全新组件从零实现
2. WHEN SOP_View 加载一个 SOP_Definition, THE SOP_View SHALL 调用 getExecutionBatches() 将步骤按拓扑排序分批，并以全宽流程图形式渲染 DAG 结构
3. THE SOP_View SHALL 为每个步骤节点显示步骤标签（label）、角色（role_slug）、执行状态（status）和依赖关系连线
4. WHEN 用户从 SOP 列表中选择一个 SOP, THE SOP_View SHALL 调用 parseSopDefinition(definitionJson) 解析定义并渲染对应的流程图
5. WHEN 用户点击 "Run SOP" 按钮, THE SOP_View SHALL 调用 sendMessage("Run the SOP: {name}") 触发 SOP 执行
6. WHEN 用户在自然语言输入框中提交编辑指令, THE SOP_View SHALL 调用 sendMessage("Modify the SOP \"{name}\": {text}") 发送修改请求
7. WHEN 用户点击流程图中的某个步骤节点, THE SOP_View SHALL 在自然语言输入框中预填 "For step \"{label}\" ({role}): " 文本
8. WHEN 用户点击 "Create SOP" 按钮, THE SOP_View SHALL 打开 SopEditorDialog 对话框
9. WHEN 用户点击 "Import SOP" 按钮, THE SOP_View SHALL 打开 SopImportDialog 对话框
10. WHEN 用户确认删除一个 SOP, THE SOP_View SHALL 调用 deleteSop(sopTemplateId) 删除该 SOP 并刷新列表
11. WHEN 用户触发同步操作, THE SOP_View SHALL 调用 SopSyncService.syncFromUrl(sopTemplateId) 从源 URL 同步 SOP 定义
12. THE SOP_View SHALL 使用 useSopRuntimeState(sopTemplateId) 实时显示每个步骤的执行状态（pending/running/completed/failed）
13. THE SOP_View SHALL 针对 1440px 及以上宽屏优化布局，流程图填满 Office_View 中间区域的可用空间，不使用 max-width 限制或居中窄内容

### 需求 4：Market 页面重写 — 游戏商店风格

**用户故事:** 作为 Offisim 用户，我希望 Market 页面像游戏商店（Steam/Epic Games Store）一样，以全屏卡片网格展示可用包，方便浏览和安装。

#### 验收标准

1. THE Market_Page SHALL 删除现有 Market 组件文件，使用全新组件从零实现
2. THE Market_Page SHALL 提供两种模式切换：Explore 模式（搜索 + 过滤 + 卡片网格）和 Manage 模式（已安装/更新/已发布）
3. WHEN 用户在 Explore 模式下输入搜索词, THE Market_Page SHALL 调用 setQuery(search) 实时过滤结果
4. WHEN 用户选择 AssetKind 过滤器, THE Market_Page SHALL 调用 setKind(kind) 按资产类型过滤列表
5. WHEN 用户选择排序方式, THE Market_Page SHALL 调用 setSort(sort) 按 relevance/newest/rating/installs 排序
6. THE Market_Page SHALL 以全屏卡片网格展示搜索结果，每张卡片根据 AssetKind 使用不同的"稀有度"配色方案
7. WHEN 用户点击一张 listing 卡片, THE Market_Page SHALL 调用 useListingDetail(listingId) 加载详情并展示详情视图，包含权限列表、标签和版本信息
8. WHEN 用户点击 "Install" 按钮, THE Market_Page SHALL 调用 onStartInstall(listingId, version) 触发安装流程
9. WHEN 用户在 Manage 模式下切换 tab, THE Market_Page SHALL 在 installed/updates/published 三个子视图间切换
10. WHEN 列表存在更多结果且用户滚动到底部, THE Market_Page SHALL 调用 loadMore() 加载更多结果
11. IF Market_Page 加载数据时发生网络错误, THEN THE Market_Page SHALL 显示游戏风格的 "Connection Lost" 错误界面，提供重试按钮
12. THE Market_Page SHALL 将过滤器紧凑排列在页面顶部，卡片网格填满剩余视口空间，不使用 max-width 限制或居中窄内容
13. WHEN 用户点击 "Publish" 按钮, THE Market_Page SHALL 打开 PublishDialog 对话框

### 需求 5：Activity Log 页面重写 — 游戏事件日志风格

**用户故事:** 作为 Offisim 用户，我希望 Activity Log 页面像游戏事件日志/战斗记录一样，以清晰的视觉层级展示实时事件流，方便追踪系统活动。

#### 验收标准

1. THE Activity_Log_Page SHALL 删除现有 Activity Log 组件文件，使用全新组件从零实现
2. THE Activity_Log_Page SHALL 通过 hydrateEventLogStore(eventBus, bootstrapState.eventHistory) 订阅实时事件流并渲染事件列表
3. THE Activity_Log_Page SHALL 为每个事件行显示域图标（基于 TYPE_PREFIX_MAP 映射）、事件标签（通过 getDisplayLabel 提取）、时间戳和事件级别颜色编码（Info 默认色、Warning 黄色、Error 红色）
4. THE Activity_Log_Page SHALL 将事件按时间分组显示（例如 "Today"、"Yesterday"、"This Week"）
5. WHEN 用户设置日期过滤器, THE Activity_Log_Page SHALL 调用 getDateCutoff(datePreset) 按 today/7d/30d/custom 过滤事件
6. WHEN 用户选择事件类型过滤器, THE Activity_Log_Page SHALL 按 TYPE_PREFIX_MAP 前缀匹配过滤事件
7. WHEN 用户选择 Actor 过滤器, THE Activity_Log_Page SHALL 调用 matchesActorFilters(event, actorFilters) 过滤事件
8. WHEN 用户输入搜索词, THE Activity_Log_Page SHALL 对事件的 type、label 和 entityType 进行全文匹配过滤
9. WHEN 用户点击一个事件行, THE Activity_Log_Page SHALL 显示事件详情视图，包含事件类型、级别、时间戳、实体信息和格式化的 payload 内容（非原始 JSON dump）
10. THE Activity_Log_Page SHALL 将默认 datePreset 设为 '30d'（替代当前的 'today'，避免首次进入时显示空白）
11. THE Activity_Log_Page SHALL 针对 1440px 及以上宽屏优化布局，事件列表填满视口空间，不使用 max-width 限制或居中窄内容
12. THE Activity_Log_Page SHALL 支持四种过滤器（日期、事件类型、Actor、搜索）同时生效，过滤器紧凑排列在页面顶部

### 需求 6：Settings 页面重写 — 游戏设置菜单风格

**用户故事:** 作为 Offisim 用户，我希望 Settings 页面像游戏设置菜单（Cyberpunk 2077/Fortnite 风格）一样，以侧边 tab 导航 + 右侧内容区的形式展示所有配置项。

#### 验收标准

1. THE Settings_Page SHALL 删除现有 Settings 页面组件文件，使用全新组件从零实现
2. THE Settings_Page SHALL 提供侧边 tab 导航，包含 Provider、Runtime、MCP、Gateway 四个 tab，右侧内容区填满剩余空间
3. WHEN 用户切换到 Provider tab, THE Settings_Page SHALL 显示 Provider 预设选择（PROVIDER_PRESETS 自动填充 baseURL/model/headers）、API Key 输入、Model 标识符输入、Base URL 输入和 Default Headers（JSON 格式）输入
4. WHEN 用户切换到 Runtime tab, THE Settings_Page SHALL 显示 Execution Mode（auto/sequential/parallel）、Summarization 配置（enabled + triggerTokens + keepRecentMessages）、Memory 配置（enabled + injectionEnabled + maxFacts + confidenceThreshold）、Tool Search 开关、Git Auto-commit 开关、Tool Permissions（ask/allow/deny）和 Display Density（compact/normal/spacious）
5. WHEN 用户切换到 MCP tab, THE Settings_Page SHALL 渲染 McpConfigPanel 组件
6. WHEN 用户切换到 Gateway tab, THE Settings_Page SHALL 渲染 OpenClawSettings 组件
7. WHEN 用户修改任何设置项, THE Settings_Page SHALL 通过 useSettingsWorkspaceController 的 snapshot 比较机制追踪 hasUnsavedChanges 状态
8. WHEN 用户点击 Save 按钮, THE Settings_Page SHALL 调用 saveProviderConfig(config) 保存到 localStorage 并触发 onSave(config) 回调
9. THE Settings_Page SHALL 确保 Settings_Surface 的修改同时适用于 SettingsDialog 和 SettingsPage 两种入口，保持行为一致
10. THE Settings_Page SHALL 提供醒目的 Save 按钮，每个设置项紧凑排列，组、标签和控件对齐
11. THE Settings_Page SHALL 针对 1440px 及以上宽屏优化布局，内容填满视口空间，不使用 max-width 限制或居中窄内容

### 需求 7：全局设计约束 — 游戏风格 UI 与技术规范

**用户故事:** 作为 Offisim 开发者，我希望所有重写的页面遵循统一的游戏风格设计语言和技术规范，确保视觉一致性和代码质量。

#### 验收标准

1. THE System SHALL 对所有 4 个页面采用游戏风格 UI 设计语言，参考 Steam 商店、游戏设置菜单和游戏事件日志的视觉风格
2. THE System SHALL 确保所有页面在 1440px 及以上宽屏下内容填满可用空间，不出现大面积空白
3. THE System SHALL 使用 React 19 + TypeScript strict + Tailwind CSS 技术栈，遵循 Biome linter 规范（2-space indent、single quotes、trailing commas）
4. THE System SHALL 使用 @offisim/ui-core 提供的原子组件（Button、Input、Select、Tabs、Card 等）
5. THE System SHALL 使用 @offisim/shared-types 提供的类型定义
6. THE System SHALL 确保所有 UI 文本使用英文
7. THE System SHALL 对所有重写的页面采用"删除重建"策略——删除现有组件文件，用全新文件替代，不在现有 JSX 上修改 className
8. IF 用户按下 Escape 键且当前处于全屏页面（Market/Activity_Log/Settings）, THEN THE System SHALL 导航回 Office_View
