## Why

`OfficeEditorOverlay.tsx` 950 行是 D 系列 "单一组件吃多职责" 的未收残留——overlay 同时承担：zone preset palette（group-by-archetype 过滤 + preview card）、drag-to-reposition（像素坐标 clamp + 重叠检测）、required zone protection（删除/拖走守卫）、zoom/pan（viewport transform + SVG coordinate 换算）、validation banner、save/cancel lifecycle。单组件 30+ useState/useRef + 10+ useCallback + 1 个超长 JSX return，改任何子逻辑都得读完整个文件。对齐 `web-app-shell-boundaries` 的 shell 拆分 + `scene-orchestrator-boundaries` 的 composition hook 模式收一刀。

## What Changes

- **Thin shell**: `OfficeEditorOverlay.tsx` 压到 ≤ 200 非空非注释行，只做 open/close lifecycle + useCallback 调 sub-hook + 拼装 6 个 section component。
- **6 Section components** (`components/office/editor/` 子目录)：
  - `EditorToolbar.tsx` — top bar（title / zoom buttons / reset / save / close）
  - `PresetPalette.tsx` — zone preset group filter + preview cards（drag source）+ custom-zone form
  - `ZoneCanvas.tsx` — SVG viewport + zone rects + prefab silhouettes + ghost preview + drag target
  - `ZoneInspector.tsx` — selected-zone properties rail（label / variant swap / position nudge / delete guard）
  - `StatusBar.tsx` — bottom bar（zone count / item count / overlap badge / zoom %）
  - `ValidationBanner.tsx` — required-archetype / overlap / bounds violation inline banner（吃 `useZoneValidation` warning + 现 toast 路径）
- **4 Composition hooks** (`components/office/editor/hooks/` 子目录)：
  - `useZoneEditorState` — editor zones / placed items / dirty tracking / save orchestration
  - `useDragReposition` — drag 源/目标坐标换算 + obstacle snap + 重叠检测
  - `useZonePanZoom` — viewport transform（pan delta + zoom center-preserving）
  - `useZoneValidation` — required archetype coverage + overlap / bounds derived errors
- **保留**：`archetype-visuals.ts` / `types.ts` 现有子模块不动；SCALE / SVG_W / SVG_H 坐标系常量留在 `types.ts`。
- **可观测行为不变**：打开 overlay 后 zone 列表 / 拖放行为 / save round-trip / required zone 守卫视觉文案全部 byte-identical。

## Capabilities

### New Capabilities

- `office-editor-boundaries`

### Modified Capabilities

（无）

## Impact

- **目录新增**：`packages/ui-office/src/components/office/editor/{EditorToolbar,PresetPalette,ZoneCanvas,ZoneInspector,StatusBar,ValidationBanner}.tsx` + `editor/hooks/{useZoneEditorState,useDragReposition,useZonePanZoom,useZoneValidation}.ts`
- **删除**：`editor/useOfficeEditor.ts` 535 行 god-hook 整体被 4 个 composition hook 取代
- **文件重写**：`OfficeEditorOverlay.tsx` 950 → ≤ 200 行
- **消费者无改动**：`App.tsx` 里的 `<OfficeEditorOverlay open={...} onClose={...}>` import 路径 + props 不变
- **验证**：live runtime 打开 overlay 走一轮完整编辑（添加 preset / 拖动 / 触发 overlap banner / save），视觉 byte-identical
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
