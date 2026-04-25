## Context

摸底 (`Explore` agent 报告) 确认 Studio 已经有完整 Zone 三态状态机和 4 个 PlotSize 预设，但 IA 在 UI 上不显式：

- `StudioState.tsx:484` 行 Zustand store，已持有 `selectedInstanceId / selectedZoneId / focusedZoneId / isEditingZone / plotSize`，`enterEditZone(zoneId)` 一次设三个 flag
- `StudioPalette.tsx:530` 行 已在 `useEffect` 内"进入 zone edit 自动切到 assets tab"（`L76-79`），但没按 `allowedCategories` 过滤
- `StudioProperties.tsx:567` 行 已按 `selectedInstanceId / selectedZoneId / 都为空` 三态分支，但顶部没有"我在哪一层"的视觉锚
- `StudioPage.tsx:527` 行 没有 breadcrumb，没有顶层 Esc handler
- `PlotSize` 4 预设（Small/Standard/Large/Campus）只用于视口边界、相机焦距，**未持久化**：用户切换后刷新 / 切公司丢失
- 公司模板里 zone 已有 `allowedCategories: SemanticCategory[]`（`packages/shared-types/src/zone.ts:54-71` Zone 接口字段已 hydrate 出来），从 `Workspace zone allows ['workspace', 'collaboration']` 这类约束有 SSOT 但 Palette 没消费

约束：
- 不允许 db migration（Q1 决策 b）
- 不允许动 zone 编辑内的物体操作交互（D2 scope）
- 不允许 3D mesh / 灯光（B1 / GPT 5.5 scope）
- 五个 Studio* 文件已 500+ 行，新逻辑必须抽到独立组件 / hook，避免顶过 700 行

## Goals / Non-Goals

**Goals:**

1. Studio UI 上层级**自描述**：用户任何时刻都能从 breadcrumb 一眼看到"我在 Plot 还是 Zone 还是 Asset 层"
2. **单键退栈**：Esc 一致按 Asset → Zone → Plot 一次退一层，可预测
3. **PlotSize 持久化**：切换后跨 reload / 跨切公司不丢；不打扰 DB schema
4. **Palette 三态语义**：未选 / 选中 / 编辑 三态行为契约写进 spec，编辑态按 `allowedCategories` 过滤
5. **Properties 顶部锚**：选中态自描述（`Plot · {n}` / `Zone · {l}` / `Asset · {n}`）

**Non-Goals:**

- Zone 内物体的选中 / 移动 / 旋转 / 删除交互行为契约（D2）
- 非法放置红色 ghost / 边界提示 / 松手回弹（D2）
- Studio Profile 独立页面拆除（D3）
- Plot 概念落 DB / 多 Plot 切换 / 无限画布 backing store（未来需要时再开 change）
- 3D mesh / 灯光 / 材质 / PBR（B1 / GPT 5.5）
- 删 / 重写 PlotSize 4 预设（保留现有四档）
- 改 zone `allowedCategories` 数据模型（已 hydrated，直接消费）

## Decisions

### D1. PlotSize 持久化走 localStorage（非 DB）

**Decision**: `localStorage[`offisim:studio:plot-size:${companyId}`] = plotSizeName`，StudioState 启动 effect 内读、`setPlotSize` 写。

**Why**：
- DB 列没有运行时消费方（PlotSize 只影响视口/相机，不影响 zones/prefab_instances 行为）
- 加列要写 db-local migration 第 34 条 + db-platform 镜像 + repo + 公司模板默认值，工时 / 风险都不匹配本 change 价值
- localStorage 跨 reload / 跨切公司（key 带 `companyId`）足够覆盖产品需求
- 真有"无限画布 / Plot 切换影响 runtime"业务时再开独立 change 落 DB，本 change 不预设迁移路径

**Alternatives**:
- (a) DB 列：过度设计，理由如上
- (b) Zustand persist middleware：已用 localStorage，多套一层中间件徒增依赖，本 change 不为别的 state 准备 persist
- (c) 不持久化：现状，违反 Goal #3

### D2. Breadcrumb 是独立组件，不内嵌进 StudioPage / Toolbar

**Decision**: 新建 `packages/ui-office/src/components/studio/PlotZoneBreadcrumb.tsx`，从 `useStudioStore` 读 `plotSize / selectedZoneId / selectedInstanceId / isEditingZone`，渲染三段 chip + 点击 handler。StudioPage 在顶部 toolbar 下、canvas 上插一行。

**Why**：
- StudioPage 已 527 行；breadcrumb 逻辑（zone 名查找 / asset 名查找 / 三段 disabled 判断 / 回退 handler）≈ 80 行，内嵌会顶过 600
- 独立组件天然便于 D2 加视觉态（编辑态高亮 / 拖拽中变色）
- 不放 toolbar 内：toolbar 是"操作"，breadcrumb 是"位置"，两层语义分清

**Alternatives**:
- (a) 内嵌 StudioPage：违反文件膨胀防线
- (b) 放 Toolbar 内：语义混淆
- (c) 浮层 / floating：层级感弱

### D3. Esc 退栈在 StudioPage 顶层 handler，单一来源

**Decision**: StudioPage 内 `useEffect` 注册 `keydown` listener，按以下优先级消费：
1. 若 `placement.active`（ghost 放置中）→ 不消费，让 placement 自己取消（已有逻辑）
2. 若 modal / dialog 打开 → 不消费（同上）
3. 否则按当前态退一层：`isEditingZone` → `exitEditZone()` → 退到选中态；`selectedInstanceId || selectedZoneId` → `clearSelection()` → 退到未选；都没则不消费

**Why**：
- 单一来源避免 Palette / Properties / Canvas 各自抢 Esc 导致行为不可预测
- 优先级和 macOS / Figma / Sketch 一致（先取消放置，再退层级）

**Risks**:
- StudioPage 已存在 keyboard handler？需要先查；若有则合并而非新增（避免双 listener）

### D4. Palette 三态：选中和未选共享布局，编辑态独立

**Decision**:
- 未选 + 选中（未编辑）：现有 `assets + zones` 两 tab 不变（共享一份 render path）
- 编辑态：强制 assets tab、列表按 `currentZone.allowedCategories` 过滤；空过滤态显 "No prefabs allowed in this zone"

**Why**：
- 未选 vs 选中（未编辑）功能上没区别，强行分态会让用户多一次思考；区分由 Properties 顶部 zone 摘要承担
- 编辑态过滤是 zone `allowedCategories` 数据模型的天然消费方，不消费等于让该字段成为僵尸字段

**Alternatives**:
- (a) 选中态独立显该 zone 已放置家具列表 + "Enter zone edit" CTA：信息冗余（Properties 已显计数 + 编辑入口）
- (b) 编辑态不过滤：违反 Goal #4

### D5. Properties 顶部"层级锚"行只有一行，不堆 metadata

**Decision**: 一行 `{icon} {Plot|Zone|Asset} · {name}`，灰色低对比 chip。具体属性照旧。

**Why**：
- 锚是为了"我在哪"，不是"详细元数据"
- 顶部多一行不挤压现有 properties 区（Properties 内部已是滚动）

### D6. allowedCategories 过滤的 fallback：字段缺失时不过滤

**Decision**: `currentZone.allowedCategories?.length > 0 ? filter : show all`。

**Why**：
- 公司模板里部分 zone（如 decorative / library）可能 `allowedCategories: []`，过滤会让 palette 完全空，反而难用
- 兜底保证编辑态永远有可放置项；空过滤态只在用户主动设了 `allowedCategories` 但没匹配 prefab 时出现

### D7. 不动 `enterEditZone` / `selectZone` / `focusZone` API 签名

**Decision**: Zustand store 加 `exitEditZone()` / `clearSelection()` 两个新 action（如未存在），其他 API 不动。

**Why**：
- 现有调用点（Canvas / Properties / Palette）已散布；改签名会扩散到 11 个文件
- 新增退栈语义靠新 action，旧逻辑不动

## Risks / Trade-offs

- **[Risk] StudioPage 已存在 keyboard handler 但摸底没扫到** → Mitigation: tasks.md 第 1 步先 grep `useEffect.*keydown` / `addEventListener.*keydown` 确认；有则合并，无则新增
- **[Risk] PlotSize localStorage key 带 companyId 但创建模式 (`mode='create'`) 还没 companyId** → Mitigation: 创建模式 key 用 `:create` 后缀（`offisim:studio:plot-size:create`），create→edit 切换时把 `:create` 值搬到 `:${realCompanyId}` 一次性迁移，再清掉 `:create`
- **[Risk] Esc 退栈优先级和 placement / dialog 模块的现有 keyboard 行为冲突** → Mitigation: handler 内显式查 `placement.active` 和 modal stack 状态再消费；不消费时不调 `preventDefault`，让事件冒泡到既有 listener
- **[Risk] Palette 编辑态 `allowedCategories` 过滤后用户分不清"为啥这个 prefab 看不到"** → Mitigation: tab bar 下加一行小字 "Filtered by {zoneLabel} allowed categories"，可点击 "Show all" 临时关掉过滤（**这条是 D2 scope 的提议项，本 change 先不做**——D1 只过滤，覆盖说明留 D2）
- **[Risk] 文件行数膨胀** → Mitigation: 5 个 Studio* 文件改动 budget 上限（StudioState +30 / StudioPage +40 / StudioPalette +25 / StudioProperties +20）；所有超出抽到独立模块。新建 PlotZoneBreadcrumb 100±20 行
- **[Trade-off] PlotSize 不落 DB 意味着 Tauri / web 切设备 PlotSize 不同步**：可接受。Studio 是单用户编辑器，跨设备同步等真业务需求出现再做
