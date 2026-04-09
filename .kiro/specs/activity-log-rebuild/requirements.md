# 需求文档：Activity Log 页面重建 (Activity Log Rebuild)

## 简介

Offisim 的 Activity Log（活动日志）页面需要从零重建为全屏游戏事件日志/战斗记录风格界面。Activity Log 作为独立全屏页面渲染在 FullPageWorkspaceShell 内（由 navigation-architecture spec 提供精简后的浮动 "← Office" 返回按钮 + 全视口 children）。本次重建将删除现有 `workspace/` 子目录下的 3-pane 组件，替换为游戏事件日志风格的全屏时间线浏览体验。

本 spec 仅覆盖 Activity Log 页面内容实现，不涉及导航架构变更（由 navigation-architecture spec 处理）。

## 术语表

- **Activity_Log_Page**: Activity Log 全屏页面入口组件，编排过滤栏 + 时间线 + 详情面板
- **FullPageWorkspaceShell**: 全屏工作区外壳组件（由 navigation-architecture spec 提供），仅含浮动返回按钮 + 全视口 children
- **Activity_Filter_Bar**: 顶部过滤栏组件，包含日期预设、事件类型下拉、Actor 下拉和搜索框
- **Activity_Timeline**: 事件时间线组件，按时间分组显示事件行，支持全宽和 60% 宽度两种模式
- **Activity_Time_Group**: 时间分组组件，包含分组标题（如 "Today"、"Yesterday"）和该组内的事件列表
- **Activity_Event_Row**: 单行事件组件，48px 高，显示域图标、事件标签、时间戳和级别色条
- **Activity_Event_Detail**: 右侧 40% 事件详情面板，游戏成就/任务详情风格
- **Activity_Payload_View**: 格式化 payload 展示组件，key-value 格式，嵌套对象可折叠
- **Activity_Empty_State**: 空状态组件，覆盖无事件和过滤无结果两种场景
- **RuntimeEvent**: 运行时事件结构，包含 type、timestamp、entityId、entityType、payload 字段
- **EventDisplayLevel**: 事件显示级别：Info、Warning、Error
- **DatePreset**: 日期过滤预设：today、7d、30d、custom
- **TYPE_PREFIX_MAP**: 事件类型到前缀的映射表，用于按类型过滤事件
- **Time_Group**: 时间分组桶，将事件按 Today/Yesterday/This Week/This Month/Older 分组
- **Activity_Log_Session_State**: Activity Log 页面的会话状态，包含 selectedEventId、search、eventTypes、actorFilters、datePreset

## 需求

### 需求 1：Activity Log 页面入口与布局

**用户故事:** 作为 Offisim 用户，我希望 Activity Log 页面以全屏游戏事件日志风格展示，顶部有紧凑的过滤栏，主体是按时间分组的事件时间线，选中事件时右侧展开详情面板。

#### 验收标准

1. THE Activity_Log_Page SHALL 删除现有 `workspace/` 子目录下所有组件文件（ActivityLogPage.tsx、ActivityLogEventFocus.tsx、ActivityLogFiltersPane.tsx），使用全新组件从零实现
2. THE Activity_Log_Page SHALL 保留现有的 activity-log-utils.ts（getDateCutoff、matchesActorFilters、getEventId、getAvailableActorFilters、getActivityActorLabel）、EventLog.tsx（hydrateEventLogStore、getEventLevel、TYPE_PREFIX_MAP、LEVEL_ROW_STYLES）和 EventItem.tsx（getDisplayLabel、domainIcon）
3. THE Activity_Log_Page SHALL 编排垂直布局：Activity_Filter_Bar（固定高度 h-16）+ 内容区（flex-1），内容区包含 Activity_Timeline 和可选的 Activity_Event_Detail
4. WHEN Activity_Log_Session_State 的 selectedEventId 为 null, THE Activity_Log_Page SHALL 让 Activity_Timeline 占据内容区全宽
5. WHEN Activity_Log_Session_State 的 selectedEventId 不为 null, THE Activity_Log_Page SHALL 让 Activity_Timeline 缩为 60% 宽度，右侧 40% 展开 Activity_Event_Detail 面板

### 需求 2：事件数据订阅与过滤管道

**用户故事:** 作为 Offisim 用户，我希望 Activity Log 实时接收事件流，并通过日期、事件类型、Actor 和搜索四种过滤器同时过滤事件。

#### 验收标准

1. THE Activity_Log_Page SHALL 通过 hydrateEventLogStore(eventBus, bootstrapState.eventHistory) 订阅实时事件流，并通过 store.listeners 同步事件到组件状态
2. THE Activity_Log_Page SHALL 将默认 datePreset 设为 '30d'，避免首次进入时因 'today' 导致显示空白
3. WHEN 用户设置日期过滤器, THE Activity_Log_Page SHALL 调用 getDateCutoff(datePreset) 获取截止时间戳，过滤掉早于该时间戳的事件
4. WHEN 用户选择事件类型过滤器, THE Activity_Log_Page SHALL 按 TYPE_PREFIX_MAP 中对应的前缀列表匹配事件的 type 字段
5. WHEN 用户选择 Actor 过滤器, THE Activity_Log_Page SHALL 调用 matchesActorFilters(event, actorFilters) 过滤事件
6. WHEN 用户输入搜索词, THE Activity_Log_Page SHALL 对事件的 type、getDisplayLabel(event) 返回值和 entityType 进行大小写不敏感的全文匹配过滤
7. THE Activity_Log_Page SHALL 支持四种过滤器同时生效，事件必须通过所有活跃过滤器才出现在结果中

### 需求 3：Activity Filter Bar — 顶部过滤栏

**用户故事:** 作为 Offisim 用户，我希望过滤栏紧凑排列在页面顶部，提供日期预设、事件类型、Actor 和搜索四种过滤器，方便快速筛选事件。

#### 验收标准

1. THE Activity_Filter_Bar SHALL 固定高度 64px（h-16），水平排列，包含日期预设下拉、事件类型下拉、Actor 下拉和搜索输入框（flex-1）
2. WHEN 用户选择日期预设, THE Activity_Filter_Bar SHALL 通过回调更新 Activity_Log_Session_State 的 datePreset 字段
3. WHEN 用户选择事件类型, THE Activity_Filter_Bar SHALL 通过回调更新 Activity_Log_Session_State 的 eventTypes 字段
4. WHEN 用户选择 Actor 过滤器, THE Activity_Filter_Bar SHALL 通过回调更新 Activity_Log_Session_State 的 actorFilters 字段
5. WHEN 用户在搜索框中输入文本, THE Activity_Filter_Bar SHALL 通过回调更新 Activity_Log_Session_State 的 search 字段

### 需求 4：Activity Timeline — 事件时间线

**用户故事:** 作为 Offisim 用户，我希望事件按时间分组显示（Today/Yesterday/This Week 等），每个事件行有清晰的视觉层级，包含域图标、事件标签、时间戳和级别颜色编码。

#### 验收标准

1. THE Activity_Timeline SHALL 将过滤后的事件按时间分组为 Time_Group 桶：Today、Yesterday、This Week、This Month、Older
2. THE Activity_Timeline SHALL 按从新到旧的顺序排列 Time_Group，每个 Time_Group 内的事件也按时间戳从新到旧排列
3. THE Activity_Time_Group SHALL 显示分组标题（半透明背景条 + 粗体标签 + 该组事件计数）
4. THE Activity_Event_Row SHALL 固定高度 48px，水平排列：域图标(24px) → 事件标签(flex-1) → 时间戳(固定宽度) → 级别色条(4px 宽)
5. THE Activity_Event_Row SHALL 使用 domainIcon(event.type) 获取域图标和颜色（hr.*→UserCheck/rose、mcp.*→Plug/blue、knowledge.*→BookOpen/emerald 等）
6. THE Activity_Event_Row SHALL 使用 getDisplayLabel(event) 获取事件标签文本
7. THE Activity_Event_Row SHALL 使用 getEventLevel(event) 获取事件级别，Error 行显示 4px 红色左边条，Warning 行显示 4px 琥珀色左边条
8. WHEN 用户点击一个 Activity_Event_Row, THE Activity_Log_Page SHALL 更新 Activity_Log_Session_State 的 selectedEventId 为该事件的 ID

### 需求 5：Activity Event Detail — 事件详情面板

**用户故事:** 作为 Offisim 用户，我希望点击事件后在右侧看到游戏成就/任务详情风格的事件详情，包含格式化的 payload 内容而非原始 JSON dump。

#### 验收标准

1. THE Activity_Event_Detail SHALL 显示事件类型（格式化为可读路径）、事件级别（带颜色 badge）、完整时间戳、实体信息（entityType + entityId + 显示标签）
2. THE Activity_Event_Detail SHALL 通过 Activity_Payload_View 组件以格式化的 key-value 表格形式展示 payload 内容，不使用原始 JSON dump
3. THE Activity_Payload_View SHALL 将 payload 中的嵌套对象渲染为可折叠的子区域
4. THE Activity_Payload_View SHALL 将数组值渲染为逗号分隔的内联列表或可折叠的子区域（根据长度决定）
5. WHEN 用户取消选中事件（点击已选中的事件或关闭详情面板）, THE Activity_Log_Page SHALL 将 selectedEventId 重置为 null，Activity_Event_Detail 面板收起

### 需求 6：空状态与过滤无结果

**用户故事:** 作为 Offisim 用户，我希望在无事件或过滤无结果时看到清晰的游戏风格提示，以便了解状态并采取行动。

#### 验收标准

1. WHEN 事件列表为空（无任何事件）, THE Activity_Empty_State SHALL 显示全屏居中的游戏风格图标 + "No activity recorded yet" 文案 + 描述文本
2. WHEN 过滤后结果为空但原始事件列表非空, THE Activity_Empty_State SHALL 保留 Activity_Filter_Bar，内容区显示 "No events match your filters" 文案 + "Reset filters" 按钮
3. WHEN 用户点击 "Reset filters" 按钮, THE Activity_Log_Page SHALL 将 search 重置为空字符串、eventTypes 重置为空数组、actorFilters 重置为空数组、datePreset 重置为 '30d'

### 需求 7：事件时间分组算法

**用户故事:** 作为 Offisim 开发者，我希望事件时间分组是一个可测试的纯函数，确保所有事件被正确分组且不遗漏。

#### 验收标准

1. THE groupEventsByTime 函数 SHALL 接受过滤后的事件数组，返回 Time_Group 数组，每个 Time_Group 包含 label 字符串和 events 数组
2. FOR ALL 输入事件，groupEventsByTime 的输出 SHALL 包含每个输入事件恰好一次（不遗漏、不重复）
3. THE groupEventsByTime 函数 SHALL 按从新到旧的顺序排列 Time_Group（Today → Yesterday → This Week → This Month → Older）
4. FOR ALL Time_Group 内的事件，事件 SHALL 按时间戳从新到旧排列

### 需求 8：事件级别提取与显示标签

**用户故事:** 作为 Offisim 开发者，我希望事件级别提取和显示标签函数始终返回有效值，确保 UI 不会因为缺失数据而崩溃。

#### 验收标准

1. FOR ALL RuntimeEvent，getEventLevel(event) SHALL 返回 'Info'、'Warning' 或 'Error' 之一，不返回其他值
2. FOR ALL RuntimeEvent，getDisplayLabel(event) SHALL 返回非空字符串

### 需求 9：Actor 过滤器正确性

**用户故事:** 作为 Offisim 开发者，我希望 Actor 过滤器在空过滤器列表时允许所有事件通过，在非空时仅允许匹配的事件通过。

#### 验收标准

1. WHEN actorFilters 为空数组, THE matchesActorFilters 函数 SHALL 对任意事件返回 true
2. WHEN actorFilters 非空, THE matchesActorFilters 函数 SHALL 仅对 payload 中包含匹配 actor 标签的事件返回 true

### 需求 10：全屏布局与视觉设计约束

**用户故事:** 作为 Offisim 用户，我希望 Activity Log 页面充分利用全屏空间，呈现游戏事件日志的沉浸式视觉体验。

#### 验收标准

1. THE Activity_Log_Page SHALL 针对 1440px 及以上宽屏优化布局，事件时间线填满视口空间，不使用 max-width 限制或居中窄内容
2. THE Activity_Log_Page SHALL 使用深色主题，UI 元素使用半透明背景 + backdrop-blur 效果
3. THE Activity_Event_Row SHALL 在 hover 时显示背景高亮效果
4. THE Activity_Log_Page SHALL 保留现有的 activity-log-utils.ts、EventLog.tsx 和 EventItem.tsx 中的工具函数和类型
