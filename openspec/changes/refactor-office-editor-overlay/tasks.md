## 1. Scaffolding

- [ ] 1.1 创建目录 `packages/ui-office/src/components/office/editor/` 下 4 个 section `.tsx` 空壳 + `editor/hooks/` 下 4 个 hook `.ts` 空壳
- [ ] 1.2 基线快照：`wc -l packages/ui-office/src/components/office/OfficeEditorOverlay.tsx`（当前 950）+ `grep -c 'useState\\|useRef' ... ` 基线 + `grep '^export' ...` 对照

## 2. 抽 4 个 composition hooks

- [ ] 2.1 `useZoneEditorState.ts`：editor zones / placed items / dirty flag / save handler 迁入；返回 `{ zones, items, isDirty, save, onItemAdd, onItemUpdate, onItemDelete }`
- [ ] 2.2 `useDragReposition.ts`：drag source/target 坐标换算 + obstacle snap + 重叠检测；接 `{ zones, items, viewport, onUpdate }`
- [ ] 2.3 `useZonePanZoom.ts`：viewport transform（zoom center-preserving / pan delta / reset）；return `{ transform, onZoomIn, onZoomOut, onReset, onPan }`
- [ ] 2.4 `useZoneValidation.ts`：required archetype coverage + overlap + bounds；return `{ errors, warnings }`
- [ ] 2.5 每个 hook typecheck 独立通过

## 3. 抽 4 个 section components

- [ ] 3.1 `EditorToolbar.tsx`：title + zoom buttons + grid toggle + save + close（props-only）
- [ ] 3.2 `PresetPalette.tsx`：zone preset group filter + preview cards（props 含 `onPresetDragStart`）
- [ ] 3.3 `ZoneCanvas.tsx`：SVG viewport + zone rects + prefab silhouettes（接 `transform`, `zones`, `items`, `onDrag*`）
- [ ] 3.4 `ValidationBanner.tsx`：errors / warnings 列表渲染（props-only）
- [ ] 3.5 每个 section typecheck + 无 useState/useRef/useEffect

## 4. Barrel 瘦身到 ≤ 200 行

- [ ] 4.1 `OfficeEditorOverlay.tsx` 改成：props → 调 4 hook → 拼 4 section + Dialog 外壳
- [ ] 4.2 删除原 30+ useState/useRef 声明 + inline callback + 超长 JSX return
- [ ] 4.3 `grep -cvE '^\\s*(//|$|/\\*|\\*)' packages/ui-office/src/components/office/OfficeEditorOverlay.tsx` ≤ 200
- [ ] 4.4 `grep -c 'useState\\|useRef' packages/ui-office/src/components/office/OfficeEditorOverlay.tsx` ≤ 1

## 5. Verification: typecheck + build

- [ ] 5.1 `pnpm --filter @offisim/shared-types build`
- [ ] 5.2 `pnpm --filter @offisim/ui-core build`
- [ ] 5.3 `pnpm --filter @offisim/core build`
- [ ] 5.4 `pnpm --filter @offisim/ui-office build`
- [ ] 5.5 `pnpm --filter @offisim/web build`
- [ ] 5.6 `pnpm typecheck` 全绿
- [ ] 5.7 `pnpm lint` ceremony-style local clean

## 6. Verification: spec gates

- [ ] 6.1 `ls packages/ui-office/src/components/office/editor/*.tsx` 正好 4 个 section 文件
- [ ] 6.2 `ls packages/ui-office/src/components/office/editor/hooks/*.ts` 正好 4 个 hook 文件
- [ ] 6.3 grep 每个 section 文件 `useState|useRef|useEffect` 零匹配
- [ ] 6.4 grep `editor/hooks/*.ts` 相互 import 零匹配
- [ ] 6.5 `grep -rn "from '.*OfficeEditorOverlay'"` 与基线对比，consumer import 不变

## 7. Live runtime verification

- [ ] 7.1 `cd apps/web && pnpm dev` → localhost:5176 → 打开 Studio overlay
- [ ] 7.2 添加 preset（rest-lounge）→ 拖到空位 → 验证预览卡消失、canvas 上新 zone 出现
- [ ] 7.3 拖动已有 zone 到与另一 zone 重叠 → 验证 ValidationBanner 实时显示 overlap error，同帧刷新
- [ ] 7.4 尝试删除 required archetype zone（e.g. meeting）→ 验证删除被拦截，banner 显示守卫文案
- [ ] 7.5 Save → close → reopen → 验证持久化 layout 与保存时一致
- [ ] 7.6 Zoom in/out + pan + reset → 验证 viewport 行为与重构前一致
- [ ] 7.7 观察结果记录到 `verify-notes.md`；异常回到 2.x / 3.x / 4.x 定位

## 8. 最终 gate

- [ ] 8.1 `openspec validate refactor-office-editor-overlay --strict` 全绿
- [ ] 8.2 通知用户 apply 结束等 `/opsx:archive`
