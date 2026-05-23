## 0. Precondition

- [x] 0.1 Phase 0 已 apply；V3 设计 token 在 renderer 可用（本 change 的 chrome 重皮依赖 V3 tokens）
  - **已做**：核对 `apps/desktop/renderer/src/generated/tailwind-theme.css` 已含全量 V3 token（`--color-surface-*`、`--color-text-*`、`--color-line-*`、`--radius-*`、`--shadow-elev-*`、`--z-sticky` 等）。`grid-activity-detail`(`1fr minmax(20rem,26.25rem)`) / `grid-activity-filter`(`repeat(3,minmax(0,1fr)) minmax(10rem,2fr)`) 两条 utility 已在 `index.css` 就位。

## 1. 单列时间线 + split detail（chrome 重皮，布局不变）

- [x] 1.1 `ActivityTimeline.tsx` + `ActivityTimeGroup.tsx`：保持单列时间组列表，chrome（group header / spacing / typography）重皮到 V3 tokens；content grid 列定义（`grid-cols-1` ↔ `grid-activity-detail`）**不动**
  - **已做**：`ActivityTimeline.tsx` 已是 V3 grammar（无改动需要）。`ActivityTimeGroup.tsx` group header 对齐 prototype `.tl-grp-head`：(a) 加 `sticky top-0 z-sticky`（prototype `position:sticky; top:0; z-index:1`，此前缺失会导致滚动时分组头不悬停）；(b) bg `surface-muted → surface-sunken`（prototype band 用 `--surface-sunken`）；(c) label `text-xs → text-fs-sm`（prototype `--fs-sm`）；(d) count pill 加 `border border-line-soft` + bg `surface-elevated → surface-1`（prototype `.tl-cnt { background: surface-1; border: 1px solid line-soft }`）。**apply-time 决定**：z-index 用命名 token `z-sticky`（theme 无 `z-raised`；prototype `z-index:1` 语义即 sticky group header，命名 token 优于裸值）。
- [x] 1.2 确认不引入多列事件网格、不扩 `ActivityLogSessionState`（prototype `.act-body` 是单列 + split detail，代码已一致）
  - **已做**：`ActivityLogPage.tsx` content grid 仍是 `grid-cols-1` ↔ `grid-cols-1 md:grid-activity-detail`，未触；`ActivityLogSessionState` 形状未改。无多列网格引入。

## 2. row / filter / detail V3 grammar

- [x] 2.1 `ActivityEventRow.tsx`：level border + domain icon + label + `×N` collapse badge + timestamp（V3 grammar）
  - **已做**：domain icon / label（含 `formatTaskAssignmentReroutedLabel` 分支）/ timestamp / 右侧 level bar 已是 V3。两处 chrome 收口对齐 prototype `.ev-row`/`.ev-x`：(a) Info level 由 `''` → `border-l-[4px] border-transparent`（prototype 每行恒有 `border-left:4px solid transparent`，level 只换颜色；此前 Info 无左边框导致 label 相对 Warning/Error 行水平偏移 4px）；(b) `×N` badge bg `surface-muted → surface-sunken`（prototype `.ev-x { background: var(--surface-sunken) }`）。`border-l-[4px]` 任意值与既有 Error/Warning 行同款（宽度任意值非 hex，合规）。
- [x] 2.2 `ActivityFilterBar.tsx`（h-14/56px，`grid-activity-filter`）：date/type/actor 3 单选 + search 用 V3 container-grammar，filter 行为不变
  - **已做**：已是 V3 grammar（`h-14 grid-activity-filter bg-surface-elevated px-6 gap-3`，3× ui-core `Select` + `Input` search，narrow variant sliders + bottom sheet 走 `useRegisterModal`/`useTopmostEscape`/`useFocusTrap`）。filter 管道（date→type→actor→search）行为未触。无改动需要。
- [x] 2.3 `ActivityEventDetail.tsx`：5 段 V3 sectioned；`ActivityPayloadView` 递归 tree 保留
  - **已做**：5 段（EventType mono / Level badge / Timestamp / Entity / Payload）+ 递归 `ActivityPayloadView` 已是 V3 sectioned grammar（`bg-surface-elevated`、`Section` caps micro label、`LEVEL_BADGE` 走 `*-muted`/border token）。无改动需要。
- [x] 2.4 grep 确认无铃铛
  - **已做**：`grep -rn 'bell\|Bell' packages/ui-office/src/components/events/` → 无匹配，合规。

## 3. 验收 gate

- [x] 3.1 串行 build + `pnpm typecheck`；diff 限定 `packages/ui-office/src/components/events/` 下的 7 个 UI 文件（`ActivityLogPage` / `ActivityFilterBar` / `ActivityTimeline` / `ActivityTimeGroup` / `ActivityEventRow` / `ActivityEventDetail` / `ActivityPayloadView`），且 `ActivityLogPage` 的 content grid 列定义不变；`EventLog.tsx` / `activity-log-filter.ts` / `activity-log-grouping.ts` **不进 diff**
  - **已做（全绿，exit 0）**：clean `pnpm --filter @offisim/ui-office build`（rm dist + tsbuildinfo 后）→ ok；`pnpm --filter @offisim/ui-office typecheck` → exit 0；renderer `npx tsc --noEmit` → exit 0；`pnpm --filter @offisim/desktop-renderer build` → built（chunk-size warning 为已知 accepted debt，非失败）；`pnpm tokens:check` → exit 0；`pnpm tokens:lint-hex` → exit 0；`pnpm typecheck`（全量 25）→ 25 successful。**diff 限定**：`git diff --stat` 仅 `ActivityEventRow.tsx` + `ActivityTimeGroup.tsx` 两个 UI 文件（其余 5 个 UI 文件已在前序 commit 达 V3 parity，无需改）；content grid 列定义未变；`EventLog.tsx` / `activity-log-filter.ts` / `activity-log-grouping.ts` 未进 diff。
- [ ] 3.2 release `.app` live（用户/Codex）：单列时间线 + ≤420px split detail（重皮到 V3 tokens）/ row grammar + `×N` collapse / filter 4 维 / event 实时流不破 / 无铃铛 — **BLOCKED 2026-05-24**：release `.app` 已用当前 worktree 精确路径构建并启动，但本机处于 macOS 锁屏界面；Computer Use 附着返回 `cgWindowNotFound`，解锁后必须用同一 `.app` 路径补跑。
- [ ] 3.3 archive gate 三查（确认行为层未触 `activity-feed-composition`、布局栅格未变）— 待 live verify 后做

## Verify Record

- 静态 / build gate（2026-05-23）：6 道 gate 全 exit 0（见 3.1）。diff = 2 文件 6 改动行，纯 chrome（border-transparent 占位 / sticky group header / surface-sunken band + count-pill border / ×N badge surface-sunken），零行为层、零布局栅格、零 session-state 改动。
- 待补：3.2 release `.app` live（macOS 锁屏阻塞，解锁后补）。
