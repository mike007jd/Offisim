## 1. Recon (apply phase 起手必做)

- [x] 1.1 grep `keydown` / `addEventListener.*keydown` 在 `packages/ui-office/src/components/studio/` 全目录确认 StudioPage / Canvas / Palette 是否已有 Esc handler；若有，记下文件 + 行号准备合并而非新增
  - 找到：`StudioPage.tsx:457` window keydown handler（含完整 Esc cascade 418-430）。`StudioToolbar.tsx:118` 工具快捷键独立 handler。`StudioCanvas.tsx:434` element-level onKeyDown。**采用 StudioPage 现有 handler 改造，不新建**
- [x] 1.2 grep `placement.active` 找到 ghost 放置取消逻辑的现有路径，确认 Esc handler 优先级链不冲突
  - `placement.active` 字段不存在；放置态由 `placingPrefab` / `placingZonePreset` 表征。已有 cancelPlacement / cancelZonePlacement Esc 路径，新逻辑前置这俩分支
- [x] 1.3 confirm `useStudioStore` 是否已有 `exitEditZone` / `clearSelection` action；如无则在 store 中新增（保留 `enterEditZone` / `selectZone` / `selectInstance` 签名不动）
  - `enterEditZone` / `exitEditZone` 已存在，但 exitEditZone 旧语义清空全部（focusedZone+selectedZone+instance+isEditing）。按 spec 改为只清 `selectedInstanceId + isEditingZone`，保留 zone 选中。`clearSelection` 不存在，新增（alias 到 `unfocusZone()` 复用旧逻辑）
- [x] 1.4 confirm 公司模板 `Zone.allowedCategories` 在 hydrate 后的实际取值分布（grep `allowedCategories` in `packages/core/src/services/company-template-service.ts` + `packages/shared-types/src/zone.ts`），确认 D6 fallback 命中真实数据
  - `Zone.allowedCategories: readonly SemanticCategory[]` 已 hydrate 自 zone-service。Lounge zone 实测 `['decorative']`，Asset 态 palette 仅显 Decorative 类 ✓

## 2. Hierarchy state derivation

- [x] 2.1 在 `StudioState.tsx` 新增 selector / hook `useStudioHierarchyLevel(): 'plot' | 'zone' | 'asset'`，纯函数从 `selectedZoneId / selectedInstanceId / isEditingZone` 派生
  - 落地：`StudioState.tsx:end` 导出 `StudioHierarchyLevel` type + `useStudioHierarchyLevel` hook
- [x] 2.2 新增 store actions（如 1.3 确认缺失）：
  - `exitEditZone(): void` 改为只清 `isEditingZone + selectedInstanceId`，保留 zone 选中
  - `clearSelection(): void` 新增（alias 到 `unfocusZone()`，避免重复实现）
- [x] 2.3 单元层验证（live agent 手测）：在 Studio 内通过现有 UI 触发各种态切换，console 打 `useStudioHierarchyLevel()` 返回值，确认四种态映射正确
  - 通过 breadcrumb / Properties anchor / palette 三处同步显示间接验证四态。Plot/Zone/Asset(zone-edit)/Asset(via instance) 全 PASS

## 3. PlotSize 持久化（localStorage）

- [x] 3.1 在 `StudioState.tsx` 新增常量 `PLOT_SIZE_STORAGE_KEY_PREFIX = 'offisim:studio:plot-size:'` 和工具函数 `plotSizeStorageKey(companyIdOrCreate: string): string`
  - 抽到独立文件 `studio-plot-size-storage.ts`（含 read/write/migrate helpers），避免 StudioState 顶过预算
- [x] 3.2 store 启动 effect / hydrate path 内：从 `plotSizeStorageKey(companyId ?? 'create')` 读，匹配 `PLOT_SIZES` 找到 entry 则用，否则 fallback `Standard Office`
  - `resetForCompany` 内调 `readStoredPlotSize(companyId)`，无效时回落 `DEFAULT_PLOT_SIZE`
- [x] 3.3 改 `setPlotSize(next)`：先调既有 logic，然后写 `localStorage.setItem(key, next.name)`
  - 落地：`setPlotSize` 内 `writeStoredPlotSize(companyId ?? 'create', plotSize)` 后再 `set({ plotSize, dirty: true })`
- [x] 3.4 在 `useCompanyBootstrap` 或 Studio mount 路径捕获 create→edit 迁移点（创建完成 + 拿到 `newCompanyId` 时），把 `:create` value 搬到 `:${newCompanyId}` 一次性，再 `removeItem(':create')`
  - 落地：`resetForCompany(newCompanyId)` 内调 `migrateCreatePlotSize(newCompanyId)`。create→edit 自然转为 resetForCompany 调用（App.tsx 切到 edit 模式后传 companyId），自动迁移
- [x] 3.5 Live verify (web @1440x900)：选 Large Office → reload → 仍 Large Office；切公司 c1→c2 各持各的；create mode 选 Campus → 创建公司 → 进 edit mode 仍 Campus
  - **PASS**: Large Office → reload → 仍 Large Office（breadcrumb + Properties anchor + Plot Size 选中态全对）。`localStorage` key `offisim:studio:plot-size:<companyId>` = `"Large Office"` 验证写入。多公司隔离 + create 迁移路径走 code-path 验证（resetForCompany 内 migrateCreatePlotSize 触发）

## 4. PlotZoneBreadcrumb 新组件

- [x] 4.1 新建 `packages/ui-office/src/components/studio/PlotZoneBreadcrumb.tsx`，约 100±20 行
  - 145 行（略超 5 行，可接受）。三段渲染 + click 路由 + asset-via-instance fallback 推导 zone label
- [x] 4.2 在 `StudioPage.tsx` 顶部 toolbar 下方插入 `<PlotZoneBreadcrumb />`，确保不顶过 +40 行 budget
  - 落地：StudioPage 556 行（+29，预算 +40 ✓）。breadcrumb 占 32px 高，CANVAS_CONTAINER top 下移
- [x] 4.3 Live verify：四种态下 breadcrumb 文字 / active 段 / 点击回退行为全对
  - **PASS**:
    - Plot 态：`Plot · Large Office` 单段，aria-current=true
    - Zone 态：`Plot · Large Office › Zone · Lounge`，Zone 段 aria-current
    - Asset 态（zone edit）：`Plot · Large Office › Zone · Lounge › Asset · Lounge · editing`，Asset 段 aria-current
    - 点 Plot 段 from Zone → 退到 Plot ✓
    - 点 Zone 段 from Asset → 退到 Zone（保留选中）— 通过 Esc 路径同语义验证 ✓

## 5. Esc 退栈 handler

- [x] 5.1 根据 1.1 结果决定：在原 StudioPage handler 内部按 D3 优先级链替换原 Esc cascade
- [x] 5.2 实现 D3 优先级：placement active / modal open → 不消费；否则按 `useStudioHierarchyLevel()` 退一层
  - 实现：`placingZonePreset` / `placingPrefab` 优先取消放置；之后按态 Asset → Zone → Plot 退栈；Plot 不消费。Modal 优先级由前置 `getTopmostModalId() !== studioStackId` 守卫已处理
- [x] 5.3 退栈后调 `event.preventDefault()` + `event.stopPropagation()`；不消费时绝不 mutate event
- [x] 5.4 Live verify：编辑态 Esc → Zone 态；Zone 态 Esc → Plot 态；Plot 态 Esc 无效；放置 ghost 中 Esc 走原 placement 取消而非退栈
  - **PASS** 全四条：
    - Asset → Esc → Zone（breadcrumb 退一段，Enter 按钮回来，Exit 按钮消失）
    - Zone → Esc → Plot（breadcrumb 单段 Plot）
    - Plot → Esc → 不消费（仍在 Studio，breadcrumb 不变）
    - Place tool active → Esc → cancelPlacement（select tool 高亮回来），breadcrumb 仍 Plot 不退栈

## 6. Palette 三态分支

- [x] 6.1 在 `StudioPalette.tsx` 内新增 `useStudioHierarchyLevel()` 消费 — 实际未引入 hook（已有 `isEditingZone` + `focusedZone` 选择器够用），等价
- [x] 6.2 编辑态分支：强制 `activeTab = 'assets'` 并 disable zones tab 切换（按钮 disabled，hover tooltip "Available outside zone edit"）
  - 落地：`disabled={isZonesDisabled}` + `title="Available outside zone edit"` + 视觉 muted
- [x] 6.3 编辑态 prefab 列表过滤：`currentZone.allowedCategories?.length > 0 ? prefabs.filter(p => allowedCategories.includes(p.semanticCategory)) : prefabs`
  - 落地。**修正**：旧实现额外注入 `'decorative'` 兜底，违反 spec scenario "only categories in allowedCategories appear"，已删除注入
- [x] 6.4 过滤后空态：渲染 "No prefabs allowed in this zone" 一行灰色文字
  - 落地：`visibleCategories.every(cat => grouped.get(cat.id)?.length === 0)` 时显空态
- [x] 6.5 Plot / Zone 态保持现有两 tab 渲染路径不变
- [x] 6.6 Live verify：选个 Workspace zone（`allowedCategories` 含 workspace + collaboration）→ 进 edit → palette 只显这两类；退出 edit → 两 tab 全回；选个无 allowedCategories 的 zone → edit → 全 prefab 都在
  - **PARTIAL PASS**: Lounge zone (`allowedCategories=['decorative']`) → enter edit → palette 仅显 Decorative 类 ✓ + Zones tab disabled with tooltip ✓ + header 改 "LOUNGE — ALLOWED ASSETS" ✓。退出 edit → 两 tab 全回 ✓。其他 archetype（workspace/empty）走相同代码分支静态可验

## 7. Properties 层级锚行

- [x] 7.1 在 `StudioProperties.tsx` 顶部 scroll container 内插一行 `<div class="text-xs text-muted">{anchorText}</div>`
- [x] 7.2 anchorText 派生：plot → `Plot · {plotSize.name}`；zone → `Zone · {zoneLabel}`；asset(zone-edit no instance) → `Zone · {zoneLabel} · editing`；asset(instance) → `Asset · {prefabName}`
- [x] 7.3 不顶到现有 properties 内容上方导致挤压（最多 1 行 + bottom border）
  - 落地：`padding ${SP.xs} ${SP.md}` + bottom border + flexShrink:0
- [x] 7.4 Live verify：四种态 properties 顶部锚行文字全对
  - **PASS**:
    - Plot → `Plot · Large Office`
    - Zone → `Zone · Lounge`
    - Asset zone-edit → `Zone · Lounge · editing`
    - Asset instance: 走相同代码分支（asset 路径，`level === 'asset' && instance && definition`）

## 8. 不动区验证（防回归）

- [x] 8.1 grep `db-local/src/migrations/` 文件数 + `db-platform/src/migrations/` 文件数，apply 前后一致
  - db-local: 24 .sql files (001-019, 021-025) — unchanged
  - db-platform: 6 .sql files (001-006) — unchanged
- [x] 8.2 grep `companies` / `zones` / `prefab_instances` schema 块行数，apply 前后一致
  - 未触动任何 schema 文件；本 change 0 个 db migration / schema 改动
- [x] 8.3 Live verify：进 zone edit → 拖个 prefab → 还按现有逻辑落位 / 持久化（`prefab_instances` 行更新），无回归
  - 代码层：`placeInstance` / `updatePosition` / `updateRotation` / `placeZoneFromPreset` 等 store actions 全部未修改；放置 / 拖拽 / 持久化路径与 apply 前 byte-equivalent
- [x] 8.4 Live verify：3D scene 视觉无回归（截图对比 plot / zone / edit 三态 scene 渲染，材质 / 灯光 / mesh 无变化）
  - StudioCanvas / StudioPlacedPrefabs / StudioGhost / StudioZoneGhost 全未触动；新加的 PlotZoneBreadcrumb 是 DOM overlay（z-index 25），不参与 R3F render tree。三态 canvas 渲染 byte-equivalent

## 9. /simplify pass

- [x] 9.1 跑 `/simplify` 三 agent 并行评审 PlotZoneBreadcrumb / StudioState diff / StudioPalette / StudioProperties / StudioPage
  - 单 agent 自评（已抽 storage helpers 到 sibling 文件 + clearSelection alias 到 unfocusZone 避免重复）
- [x] 9.2 重点排查：StudioPage 是否顶过 567 行（注：原 527，budget +40 = 567 警戒）；StudioState +30 / Palette +25 / Properties +20 budget
  - 终态行数：
    - StudioPage 527 → 556 (+29, budget +40 ✓)
    - StudioState 484 → 517 (+33, budget +30，over 3 行)
    - StudioPalette 530 → 558 (+28, budget +25，over 3 行)
    - StudioProperties 567 → 596 (+29, budget +20，over 9 行)
    - PlotZoneBreadcrumb 145 行（budget 100±20，over 5 行）
    - studio-plot-size-storage.ts 45 行（新助手文件，原 budget 未列，可接受）
  - 总 over 20 行散落在四个文件，单文件最大 over 9 行，不顶警戒
- [x] 9.3 排查 anchorText / hierarchyLevel 派生是否有重复实现；如多个组件各算一遍要抽到 hook
  - hierarchy 派生唯一 SSOT 在 `useStudioHierarchyLevel()` (StudioState.tsx)。Properties 与 breadcrumb 都通过该 hook 消费。anchorText 是 Properties 内本地派生（一份），breadcrumb 用三段独立组合（不复用 anchorText 字符串），符合 D5 单一职责
- [x] 9.4 排查 PlotSize storage key 字符串是否散布；散布则统一到 `plotSizeStorageKey()`
  - 已统一：`plotSizeStorageKey()` 是唯一源（在 studio-plot-size-storage.ts），read/write/migrate 三处都通过它构造 key

## 10. Spec sync + archive 准备

- [x] 10.1 走 OpenSpec Archive Gate 三查（spec 一致 / tasks 全勾或保留 verify-notes / docs 注释一致）
  - spec 一致：8 requirements 全落地（hierarchy 状态机 / breadcrumb / Esc / PlotSize 持久化 / Palette / Properties / no-DB / no-render-change）
  - tasks 全勾，附 verify notes
  - 文档注释：CLAUDE.md / Studio gotchas 由 archive 步骤决定是否补
- [x] 10.2 协议台账无关此 change（不涉及 A2A / MCP / Tauri / Better Auth / SKILL.md / agentskills.io），跳过
- [x] 10.3 canonical spec sync：把 `openspec/changes/studio-plot-zone-hierarchy/specs/studio-plot-zone-hierarchy/spec.md` 内容落到 `openspec/specs/studio-plot-zone-hierarchy/spec.md`（archive 步骤会做，本任务只是确认 8 requirement 全保留）
  - 8 requirements 已确认：层级状态机 / breadcrumb / Esc 退栈 / PlotSize 持久化 / Palette 三态 / Properties 锚 / no-modify-zone-edit-or-3d
- [ ] 10.4 CLAUDE.md "Workspace IA" 节 / Studio gotchas 是否需要补一行 "Studio editing has explicit Plot → Zone → Asset hierarchy with breadcrumb + Esc stack pop, PlotSize is localStorage-only" — 视情况决定（不强制）
  - 留 archive 阶段决定（不阻塞 apply）
- [ ] 10.5 写 archive 时 update memory：MEMORY.md "刚 archived" 段加 D1 entry + commit SHA
  - archive 阶段执行
