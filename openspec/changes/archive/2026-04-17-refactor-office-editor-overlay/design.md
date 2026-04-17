## Context

`packages/ui-office/src/components/office/OfficeEditorOverlay.tsx` 是 Studio Zone Mode 的唯一入口（"Offisim Studio"）。它承担从 preset 选择到保存的完整 zone 编辑闭环，950 行单文件。Round 1 屎山热点清理时（D 系列）没覆盖 overlay 层——D1 专注 `useSceneOrchestrator`，D2 是 `App.tsx` shell 但不进 overlay 内部，D3/D4 跟 overlay 无关。

既有 canonical spec 作为模板：
- `web-app-shell-boundaries`：App.tsx 794→311 NBNC，3 个 render-only 组件（AppMainShell / AppOverlayHost / AppGlobalDialogs）+ 5 个 hook（useOverlayState / useOfficeStateBindings / useAppKeyboardShortcuts / useCompanyBootstrap / useCompanyLifecycle）
- `scene-orchestrator-boundaries`：barrel + 5 lib 模块 + 8 handler

本 change 沿用同模式收 `OfficeEditorOverlay`。

## Goals / Non-Goals

**Goals:**

- `OfficeEditorOverlay.tsx` ≤ 200 NBNC thin shell，只做 open/close + hook 装配 + section 渲染
- 6 个 section 组件各 ≤ 200 行，单一视觉责任（含 ZoneInspector 右栏 + StatusBar 底栏）
- 4 个 composition hook 各 ≤ 250 行，单一逻辑责任
- overlay 打开后编辑行为 / 视觉 / save round-trip byte-identical
- `editor/useOfficeEditor.ts`（535 行 god-hook）整体下线，由 4 个 composition hook 接管

**Non-Goals:**

- 不改 zone preset 模型 / SVG 坐标系 / required archetype 规则——纯结构拆分
- 不动 `editor/archetype-visuals.ts` 和 `editor/types.ts` 的 public API
- 不引入 Context provider——section 和 hook 通过 props 显式传递
- 不引入测试（项目纪律 live agent 验证）

## Decisions

### D1. 目录定位：`components/office/editor/` 子目录

**选择**：`packages/ui-office/src/components/office/editor/`（新增 component 文件 + `hooks/` 子目录）。

**理由**：`editor/` 已存在（`archetype-visuals.ts` / `types.ts`），延续聚合性。与 `components/office/` 同级新增 overlay 内部拆分，不污染 `components/office/` 顶层。

### D2. Section 组件是 render-only，不拥有状态

**选择**：6 个 section 组件全部 props-in/JSX-out，不挂 useState/useRef/useEffect。所有状态住 4 个 hook 里，overlay barrel 通过 props 传下去。

**理由**：对齐 `AppMainShell` / `AppOverlayHost` / `AppGlobalDialogs` 的 "render-only, state 在 hook" 模式。section 组件只做视觉，易于 review 和替换。

**6 而非 4**：现有 UI 比 proposal 初版列得多——除了 toolbar / palette / canvas / banner 之外，还有右侧 `ZoneInspector` 和底部 `StatusBar` 两个独立视觉块（共 ~200 行 JSX）。强行折进 4 个槽位会让 ZoneCanvas / EditorToolbar 失去单一视觉责任并爆 200 行预算，故扩到 6 个 section 文件。

**不选**：Section 组件自己挂 useState——会让 save 时需要 forwardRef 或 context 收集，复杂度不降反升。

### D3. Hook 间的协作：显式 ref 或 return value，不依赖 context

**选择**：
- `useZoneEditorState` 拥有 editor zones / placed items / dirty flag / save handler，return `{ zones, items, isDirty, save, ... }`
- `useDragReposition` 接收 `{ zones, items, onUpdate }`，return `{ dragState, onDragStart, onDragMove, onDragEnd }`
- `useZonePanZoom` 纯 viewport transform，return `{ transform, onZoomIn/Out, onReset, onPan }`
- `useZoneValidation` 接收 `{ zones, items }`，return `{ errors, warnings }`

barrel 组合：`const state = useZoneEditorState()` → `const drag = useDragReposition({ zones: state.zones, items: state.items, onUpdate: state.onItemUpdate })` → `const validation = useZoneValidation({ zones: state.zones, items: state.items })` → `const viewport = useZonePanZoom()`。

**理由**：显式依赖链让 hook 之间的数据流在 barrel 里可见；单个 hook 易测 / 易替换；context 的 "action at distance" 在 overlay 这种 overlay-level scope 里没有必要。

### D4. ZoneCanvas 仍用 SVG，不切 canvas

**选择**：保留 SVG 渲染（不迁 canvas）。

**理由**：overlay 场景是低频交互（用户手动编辑 zones），entity 数少（10-20 zone/prefab），SVG 的 DOM 事件和 hover state 更适合；迁 canvas 要额外重建 hit-testing + drag overlay，scope 爆炸。Office2DCanvasView（runtime 场景）的 canvas 迁移是独立 change。

### D5. Save 的时序保留

**选择**：save 仍然是 fire-once `handleSave` 调用，内部 await repo update + close overlay。拆分后 `useZoneEditorState.save()` 返回 Promise<void>，barrel 在 `onClose` 前调 `await state.save()` 若 dirty。

**理由**：重构前后 save 的事件顺序字节一致——不引入乐观更新 / 不改 concurrency 模型。

## Risks / Trade-offs

- **风险：drag 坐标换算跨 hook 分裂**→ `useDragReposition` 和 `useZonePanZoom` 都读 `viewport.transform`，前者要做 pixel→svg 换算。通过 `useDragReposition({ viewport })` 显式注入解决，不共享 context。
- **风险：validation 和 drag 双向耦合**→ drag 中 banner 要实时更新。`useZoneValidation` 读 `items` 引用，items 由 drag mutate，React re-render 天然驱动 banner 重算；无需 drag handle invalidate validation。
- **风险：live verify 覆盖不足**→ overlay 交互多，必须覆盖：open overlay → 添加 preset → 拖动 → 触发 overlap → save → 重开确认持久化。
- **Trade-off：文件数增加**→ overlay 从 1 文件 + 1 god-hook 变成 11 文件（barrel + 6 section + 4 hook，god-hook 删除）。换来单文件 ≤ 200/250 行，对齐 `App.tsx` 拆分模式。
