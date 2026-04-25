## Why

Studio 已经有完整的 Zone 三态状态机（`selectedZoneId` / `focusedZoneId` / `isEditingZone`）和四个 PlotSize 预设，但层级在 UI 上没有任何显式表达：用户进入 zone edit 后只能靠相机焦距和 palette tab 间接感知"我现在在哪一层"，没有 breadcrumb、没有回退路径、没有"plot vs zone"视觉锚。Palette 只在"进入 zone edit"做一次上下文切换，没区分"未选 zone / 选中 zone（未编辑） / 进入 zone edit"三态；编辑态也没按 zone 的 `allowedCategories` 过滤可放置 prefab。结果 Studio 看上去像"摆物件工具"而不是"按 plot → zone 装修的编辑器"，违背 UX overhaul §0 不可变原则 #2。

## What Changes

- 顶部新增 **PlotZoneBreadcrumb**：常驻三段 `Plot · {plotName} › {zoneName} › 资产`，进入哪层亮哪段；点上层段回退一层（清 `selectedInstanceId` / `selectedZoneId` / `isEditingZone`）
- **Esc 单层退栈**：编辑态 Esc → 选中态；选中态 Esc → 未选；未选 Esc 不消费（让 placement / modal 等更高优先级消费方先吃）
- **PlotSize 持久化到 localStorage**（key `offisim:studio:plot-size:<companyId>`），不落 DB；StudioState `plotSize` 启动从 localStorage 水合，切换写回；公司模板默认 `Standard Office`
- **Palette 三态显式化**：
  - 未选 zone：当前 `assets + zones` 两 tab 不变
  - 选中 zone（未编辑）：仍两 tab 不变（区分由 Properties 的 zone 摘要承担）
  - 进入 zone edit：只显 assets tab，prefab 列表按当前 zone 的 `allowedCategories` 过滤；过滤为空时显 "No prefabs allowed in this zone" 空态
- **Properties 加层级锚**：顶部一行 `Plot · {plotName}` / `Zone · {zoneLabel}` / `Asset · {prefabName}`，让用户一眼看到自己在编辑哪一层
- **新 canonical spec** `studio-plot-zone-hierarchy`（8 requirement 覆盖层级状态机 / breadcrumb / Esc 退栈 / PlotSize 持久化 / Palette 三态 / Properties 锚 / allowedCategories 过滤 / 不动 zone 编辑交互）

**不在本 change 范围**（留给 D2 / D3）：
- zone 编辑内 prefab 选中 / 移动 / 旋转 / 删除的交互行为契约（D2）
- 非法放置红色 ghost + 边界提示 + 松手回弹（D2）
- 删除 Studio Profile 独立页面（D3）
- 任何 3D mesh / 灯光 / 材质实现（B1，遇到提醒交 GPT 5.5）

## Capabilities

### New Capabilities

- `studio-plot-zone-hierarchy`: Studio 编辑层级 IA — Plot/Zone/Asset 三层栈、breadcrumb 导航、Esc 退栈、PlotSize 持久化、Palette/Properties 上下文切换契约

### Modified Capabilities

无。Studio 之前没有 canonical spec 覆盖编辑层级；本次为新增。`workspace-state-management` 已覆盖 `studioMode` 入口但不涉及 Studio 内部 IA，不动。

## Impact

- **Code**:
  - `packages/ui-office/src/components/studio/StudioState.tsx`（484 行）— 加 `plotSize` localStorage 水合 + `enterEditZone` 改为可被 Esc 消费的状态机
  - `packages/ui-office/src/components/studio/StudioPage.tsx`（527 行）— 顶部挂 `PlotZoneBreadcrumb`；接 Esc keyboard handler
  - `packages/ui-office/src/components/studio/StudioPalette.tsx`（530 行）— 三态分支 + `allowedCategories` 过滤
  - `packages/ui-office/src/components/studio/StudioProperties.tsx`（567 行）— 顶部加层级锚行
  - **新文件** `packages/ui-office/src/components/studio/PlotZoneBreadcrumb.tsx` — 独立组件，避免 StudioPage 进一步膨胀
- **No DB migration**: PlotSize 不落 DB（Q1 决策 b）
- **No spec deletion**: 全新 capability
- **Verification**: web live verify @ 1440x900 + 1280x800（PlotSize 切换持久化跨 reload / breadcrumb 三段点击回退 / Esc 单层退栈 / Palette 三态切换 / Properties 锚行随选中变化 / allowedCategories 过滤）
- **Out of scope verification**: zone 编辑内的具体物体操作交互留给 D2 验
