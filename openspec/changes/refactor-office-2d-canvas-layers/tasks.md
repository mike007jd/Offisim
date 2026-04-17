## 1. Scaffolding

- [ ] 1.1 创建 `packages/ui-office/src/components/scene/canvas-layers/` 空 dir + `components/scene/hooks/` 空 dir
- [ ] 1.2 基线：`wc -l` view(963) + renderer(753)；截屏 Office 2D default 公司空闲态 + 单员工 executing 态

## 2. Renderer 按层拆 7 文件

- [ ] 2.1 `canvas-layers/draw-background.ts`：clear + floor grid（提现有 renderer 里的 step 1-2）
- [ ] 2.2 `canvas-layers/draw-zones.ts`：zone fill + stroke + label（step 3-4）
- [ ] 2.3 `canvas-layers/draw-prefabs.ts`：prefab silhouettes via render registry（step 5）
- [ ] 2.4 `canvas-layers/draw-employees.ts`：desk backgrounds + avatar + status ring + name label（step 6-7）
- [ ] 2.5 `canvas-layers/draw-ceremony.ts`：phase color overlay + meeting bubble + waiting relationships
- [ ] 2.6 `canvas-layers/draw-interactions.ts`：hover / selection / interaction hold indicators
- [ ] 2.7 `canvas-layers/draw-drag-overlay.ts`：drag preview + snap guides
- [ ] 2.8 每层签名统一 `drawX(ctx, snapshot, transform)`，无状态，无 cross-layer import

## 3. `office-2d-canvas-renderer.ts` 瘦成 orchestrator

- [ ] 3.1 `drawScene` body 改为 7 行顺序调用 + dpr scaling setup 在入口（既有 5 条 requirement 保持）
- [ ] 3.2 `STATUS_COLORS` / `getStatusColor` / `SceneSnapshot` 等 type / `computeSemicirclePositions` 保留 export（消费者兼容）
- [ ] 3.3 `wc -l + non-blank-non-comment` ≤ 200 gate 达成

## 4. View 抽 3 hook

- [ ] 4.1 `hooks/useCanvasViewport.ts`：pan / zoom / reset / transform matrix
- [ ] 4.2 `hooks/useCanvasRedrawLoop.ts`：`needsRedraw` ref + 单 rAF + drawScene 调用
- [ ] 4.3 `hooks/useCanvasInteraction.ts`：pointer events → hit test → select / drag 回调
- [ ] 4.4 hook 之间无相互 import，view barrel 显式装配

## 5. `Office2DCanvasView.tsx` 瘦成 composition barrel

- [ ] 5.1 barrel 只剩：snapshot useMemo + canvasRef + 3 hook 调用 + `<canvas>` + text overlay
- [ ] 5.2 删除 inline pan/zoom state / inline rAF / inline pointer handlers
- [ ] 5.3 `wc -l + non-blank-non-comment` ≤ 250 gate
- [ ] 5.4 grep `requestAnimationFrame\\|addEventListener.*(pointer|mouse|wheel)` in barrel 零匹配

## 6. Verification: typecheck + build

- [ ] 6.1 shared-types → ui-core → core → ui-office → web 串行 build 全绿
- [ ] 6.2 `pnpm typecheck` 26/26 绿
- [ ] 6.3 ceremony 相关文件 biome check clean

## 7. Verification: spec gates

- [ ] 7.1 `ls canvas-layers/*.ts` 恰好 7 文件
- [ ] 7.2 `ls components/scene/hooks/*.ts` 恰好 3 文件
- [ ] 7.3 grep cross-layer import 零匹配
- [ ] 7.4 renderer + barrel 尺寸 gate 达标

## 8. Live runtime verification

- [ ] 8.1 dev server 起，localhost:5176，2D view 打开默认公司
- [ ] 8.2 发 "Write a one-sentence tagline for a coffee shop"，观察 ceremony 各 phase 视觉与 baseline 截图对齐
- [ ] 8.3 pan/zoom 测试：wheel zoom in/out + drag pan + 双击 reset；行为与重构前一致
- [ ] 8.4 员工 click select：点击 employee node 观察 selection highlight 同步 snapshot；hover prefab 观察 hover indicator
- [ ] 8.5 观察记录到 `verify-notes.md`

## 9. 最终 gate

- [ ] 9.1 `openspec validate refactor-office-2d-canvas-layers --strict` 全绿
- [ ] 9.2 通知用户等 `/opsx:archive`
