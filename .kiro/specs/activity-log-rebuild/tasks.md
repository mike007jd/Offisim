# 任务：Activity Log 页面重建 (Activity Log Rebuild)

## 1. 删除现有组件与创建纯函数模块
- [x] 1.1 删除 `packages/ui-office/src/components/events/workspace/ActivityLogPage.tsx`、`ActivityLogEventFocus.tsx`、`ActivityLogFiltersPane.tsx`（保留 `activity-log-utils.ts`）
- [x] 1.2 创建 `activity-log-grouping.ts` 纯函数模块：导出 `TimeGroup` 接口（label: string, events: FilteredEvent[]）、`GROUP_ORDER` 常量（['Today', 'Yesterday', 'This Week', 'This Month', 'Older']）和 `groupEventsByTime(events)` 函数——计算 today/yesterday/thisWeekStart/thisMonthStart 时间边界，将事件分配到对应桶，桶内按 timestamp 降序排列，过滤空桶，按 GROUP_ORDER 顺序返回
- [x] 1.3 创建 `activity-log-filter.ts` 纯函数模块：导出 `FilterOptions` 接口（datePreset/eventTypes/actorFilters/search）和 `filterEvents(events, filters)` 函数——组合日期过滤（getDateCutoff）、类型过滤（TYPE_PREFIX_MAP 前缀匹配）、Actor 过滤（matchesActorFilters）和搜索过滤（type + getDisplayLabel + entityType 全文匹配），返回 FilteredEvent 数组

## 2. 纯函数属性测试
- [x] 2.1 <PBT> Property 1: 时间分组保持事件总数 — 使用 fast-check 生成随机 FilteredEvent 数组（随机 timestamp 在过去 60 天内、随机 type 字符串、随机 level），验证 groupEventsByTime 输出的所有 TimeGroup 中事件总数之和等于输入数组长度。Tag: `Feature: activity-log-rebuild, Property 1: Time grouping preserves event count`
- [x] 2.2 <PBT> Property 2: 组内降序排列 — 使用 fast-check 生成随机 FilteredEvent 数组，验证 groupEventsByTime 返回的每个 TimeGroup 内，相邻事件满足 events[i].event.timestamp >= events[i+1].event.timestamp。Tag: `Feature: activity-log-rebuild, Property 2: Within-group descending order`
- [x] 2.3 <PBT> Property 3: getEventLevel 返回有效值 — 使用 fast-check 生成随机字符串作为 event.type（包含 'failed'、'error'、'blocked'、'warning' 等关键词的随机组合），构造 RuntimeEvent，验证 getEventLevel 返回值在 ['Info', 'Warning', 'Error'] 中。Tag: `Feature: activity-log-rebuild, Property 3: getEventLevel returns valid level`
- [x] 2.4 <PBT> Property 4: 空 Actor 过滤器允许所有事件通过 — 使用 fast-check 生成随机 RuntimeEvent（随机 payload 结构），验证 matchesActorFilters(event, []) 返回 true。Tag: `Feature: activity-log-rebuild, Property 4: Empty actor filters pass all events`
- [x] 2.5 <PBT> Property 5: 组合过滤管道结果满足所有条件 — 使用 fast-check 生成随机事件数组和 FilterOptions，验证 filterEvents 返回的每个事件同时满足：timestamp >= getDateCutoff(datePreset)、类型前缀匹配（如 eventTypes 非空）、matchesActorFilters 返回 true、搜索词匹配（如 search 非空）。Tag: `Feature: activity-log-rebuild, Property 5: Combined filter pipeline correctness`

## 3. ActivityEventRow 与 ActivityTimeGroup 组件
- [x] 3.1 创建 `ActivityEventRow.tsx`：接受 event/level/selected/onClick，渲染 48px 高行，水平排列：域图标(24px, 使用 domainIcon) → 事件标签(flex-1, 使用 getDisplayLabel, 单行截断) → 时间戳(固定宽度, 使用 formatTimestamp) → 级别色条(4px 宽)，Error 行左侧 4px 红色边条 border-l-[4px] border-red-500，Warning 行左侧 4px 琥珀色边条 border-l-[4px] border-amber-500，hover 效果 hover:bg-white/[0.04]，选中效果 bg-white/[0.06]
- [x] 3.2 创建 `ActivityTimeGroup.tsx`：接受 label/eventCount/events/selectedEventId/onSelectEvent，渲染分组标题行（bg-white/[0.03] 半透明背景 + 粗体标签 + 事件计数 badge）+ ActivityEventRow 列表

## 4. ActivityTimeline 与 ActivityEmptyState 组件
- [x] 4.1 创建 `ActivityTimeline.tsx`：接受 groups/selectedEventId/onSelectEvent/className，渲染垂直滚动容器（overflow-y-auto），遍历 TimeGroup 数组渲染 ActivityTimeGroup 列表
- [x] 4.2 创建 `ActivityEmptyState.tsx`：接受 variant/onResetFilters，variant='no-events' 时渲染全屏居中游戏风格图标（Activity 图标）+ "No activity recorded yet" + 描述文本，variant='no-results' 时渲染 Search 图标 + "No events match your filters" + "Reset filters" 按钮

## 5. ActivityPayloadView 与 ActivityEventDetail 组件
- [x] 5.1 创建 `ActivityPayloadView.tsx`：接受 payload/depth，递归渲染 key-value 表格——基本类型直接显示（key 用 font-mono text-slate-400，值用 text-slate-200），数组长度 ≤5 内联显示，>5 可折叠显示 "[N items]"，对象渲染为可折叠子区域（depth<2 默认展开，深层默认折叠），每行约 32px 高
- [x] 5.2 创建 `ActivityEventDetail.tsx`：接受 event/onClose，渲染右侧详情面板——标题行（"Event Detail" + 关闭按钮）+ 分区展示：Event Type（格式化路径）、Level（颜色 badge）、Timestamp（formatFullTimestamp）、Entity（entityType + entityId + getDisplayLabel）、Payload（ActivityPayloadView）

## 6. ActivityFilterBar 组件
- [x] 6.1 创建 `ActivityFilterBar.tsx`：固定高度 h-16，水平排列 px-6，包含日期预设下拉（Today/Last 7 days/Last 30 days/All time，默认 '30d'）、事件类型下拉（多选，使用 ALL_EVENT_TYPES）、Actor 下拉（多选，使用 actorOptions）、搜索输入框（flex-1, Search 图标, placeholder "Search events..."）

## 7. ActivityLogPage 入口组件与集成
- [x] 7.1 创建 `ActivityLogPage.tsx`：接受 ActivityLogSessionState + onSessionStateChange，编排垂直布局（ActivityFilterBar + 内容区），调用 hydrateEventLogStore 订阅事件流，通过 store.listeners 同步事件到 state，使用 filterEvents 过滤 + groupEventsByTime 分组
- [x] 7.2 实现 selectedEventId 驱动的布局切换：selectedEventId 为 null 时 ActivityTimeline 全宽，非 null 时 Timeline w-3/5 + ActivityEventDetail w-2/5 border-l
- [x] 7.3 实现事件选中/取消选中逻辑：点击事件行更新 selectedEventId（使用 getEventId），关闭详情面板重置为 null，选中事件不在 store 中时 Toast 提示并重置
- [x] 7.4 实现 Reset filters 回调：将 search 重置为 ''、eventTypes 重置为 []、actorFilters 重置为 []、datePreset 重置为 '30d'
- [x] 7.5 实现空状态路由：events 为空时渲染 ActivityEmptyState variant='no-events'，filteredEvents 为空但 events 非空时渲染 ActivityEmptyState variant='no-results'

## 8. 清理引用与编译验证
- [x] 8.1 更新 `packages/ui-office/src/components/events/` 目录的导出：如有 index.ts，移除已删除组件的导出，新增 ActivityLogPage、ActivityLogSessionState 等导出
- [x] 8.2 更新所有引用已删除 workspace/ActivityLogPage 的文件（如 App.tsx 中的导入），替换为新的 ActivityLogPage 组件路径
- [x] 8.3 运行 TypeScript 编译检查（`tsc --noEmit`），修复所有因组件删除和替换导致的类型错误
- [x] 8.4 运行 Biome lint 检查，确保所有新文件符合项目规范（2-space indent, single quotes, trailing commas）
