## 1. Scaffolding

- [x] 1.1 创建 `packages/ui-office/src/components/scene/canvas-layers/` 空 dir + `components/scene/hooks/` 空 dir
- [x] 1.2 基线：`wc -l` view(963, NBNC 804) + renderer(753, NBNC 578)；consumer 只 Office2DCanvasView 自身，re-export 安全；live 截图放 verify-notes.md 里做前后对比

## 2. Renderer 按层拆 7 文件

- [x] 2.1 `canvas-layers/draw-background.ts`：clear + floor grid（提现有 renderer 里的 step 1-2）
- [x] 2.2 `canvas-layers/draw-zones.ts`：zone fill + stroke + label（step 3-4）
- [x] 2.3 `canvas-layers/draw-prefabs.ts`：prefab silhouettes via render registry（step 5）
- [x] 2.4 `canvas-layers/draw-employees.ts`：desk backgrounds + avatar + status ring + name label（step 6-7）
- [x] 2.5 `canvas-layers/draw-ceremony.ts`：phase color overlay + meeting bubble + waiting relationships
- [x] 2.6 `canvas-layers/draw-interactions.ts`：hover / selection / interaction hold indicators
- [x] 2.7 `canvas-layers/draw-drag-overlay.ts`：drag preview + snap guides
- [x] 2.8 每层签名统一 `drawX(ctx, snapshot, transform)`，无状态，无 cross-layer import

## 3. `office-2d-canvas-renderer.ts` 瘦成 orchestrator

- [x] 3.1 `drawScene` body 改为 7 行顺序调用 + dpr scaling setup 在入口（既有 5 条 requirement 保持）
- [x] 3.2 `STATUS_COLORS` / `getStatusColor` / `SceneSnapshot` 等 type / `computeSemicirclePositions` 保留 export（消费者兼容）
- [x] 3.3 `wc -l + non-blank-non-comment` ≤ 200 gate 达成（132 NBNC）

## 4. View 抽 3 hook

- [x] 4.1 `hooks/useCanvasViewport.ts`：pan / zoom / reset / transform matrix
- [x] 4.2 `hooks/useCanvasRedrawLoop.ts`：`needsRedraw` ref + 单 rAF + drawScene 调用
- [x] 4.3 `hooks/useCanvasInteraction.ts`：pointer events → hit test → select / drag 回调
- [x] 4.4 hook 之间无相互 import，view barrel 显式装配

## 5. `Office2DCanvasView.tsx` 瘦成 composition barrel

- [x] 5.1 barrel 只剩：snapshot useMemo（走 `useSceneSnapshot` 合并 hook）+ canvasRef + 3 hook 调用 + `<canvas>` + text overlay
- [x] 5.2 删除 inline pan/zoom state / inline rAF / inline pointer handlers
- [x] 5.3 `wc -l + non-blank-non-comment` ≤ 250 gate 达成（173 NBNC）
- [x] 5.4 grep `requestAnimationFrame\|addEventListener.*(pointer|mouse|wheel)` in barrel 零匹配

## 6. Verification: typecheck + build

- [x] 6.1 shared-types → ui-core → core → ui-office → web 串行 build 全绿
- [x] 6.2 `pnpm typecheck` 26/26 绿（turbo cache hit 23, new run 3）
- [x] 6.3 ceremony 相关文件 biome check clean（13 scene files: 0 errors / 0 warnings）

## 7. Verification: spec gates

- [x] 7.1 `ls canvas-layers/*.ts` 恰好 7 文件
- [x] 7.2 `ls components/scene/hooks/*.ts` 恰好 3 文件
- [x] 7.3 grep cross-layer import 零匹配
- [x] 7.4 renderer + barrel 尺寸 gate 达标（132 / 173 NBNC）

## 8. Live runtime verification

- [x] 8.1 dev server 起，localhost:5176，2D view 打开默认公司
- [x] 8.2 发 "Write a one-sentence tagline for a coffee shop"，ceremony ANALYZING 进入 canvas 显示 active 状态 ring；Boss direct_reply 路径跑完生成 deliverable
- [x] 8.3 pan/zoom 测试：wheel zoom in ×2 + drag pan 150/100px；cursor flip 正常回 default
- [x] 8.4 员工 click select：sr-only `Alex Chen employee node` → `aria-pressed=true`，BUDDY IMPACT 弹出，chat 切 direct 会话
- [x] 8.5 观察记录到 `verify-notes.md`（含 4 张 screenshot 路径 + 静态 gate 结果 + console error=0）

## 9. 最终 gate

- [x] 9.1 `openspec validate refactor-office-2d-canvas-layers --strict` 全绿
- [x] 9.2 通知用户等 `/opsx:archive`
