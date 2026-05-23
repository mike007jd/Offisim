## 0. Precondition

- [x] 0.1 Phase 0 已 applied；V3 tokens（`--accent` / `--accent-surface` / `--accent-ring` / `--ok` / `--ok-surface` / `--danger` / `--danger-surface` / `--line-soft` / `--sp-5` / `--sp-3` / `--fs-micro` / `--ls-caps` / `--ink-3`）在 token SSOT 中可用
  - **已做**：grep `apps/desktop/renderer/src/generated/tailwind-theme.css` 确认全部 token 落地为 Tailwind v4 `@theme` key（`--color-{accent,accent-surface,accent-ring,ok,ok-surface,danger,danger-surface,warn,warn-surface,line-soft,ink-1/2/3/4,surface-2,surface-sunken}` / `--text-fs-{micro,meta,sm,md}` / `--spacing-sp-{3,5}` / `--radius-r-{xs,sm}` / `ls-caps` tracking），→ 对应 `bg-/text-/border-/p-/gap-/tracking-` utility 可用。sibling V3 reference = `settings-primitives.tsx`（caps label = `text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3`）。

## 1. Inspector sectioned panel

- [x] 1.1 `SopInspectorPanel.tsx`：各段套 `.insp-sec`（caps label `--fs-micro`/uppercase/`--ls-caps`/`--ink-3` + content block，段间 `--line-soft` 下边框、末段无，padding `--sp-5`、gap `--sp-3`）；不动数据/copy/last-error 逻辑
  - **已做**：`SectionLabel` → V3 caps（`text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3`）。panel 改为 column flex shell：header block（`insp-head`：`border-b border-line-soft px-sp-5 pb-sp-4 pt-sp-5`，title `text-fs-md font-bold text-ink-1` + status sub `text-fs-sm text-ink-3` 带 7px STATUS_DOT）+ 顺序 `.insp-sec` 块（`flex flex-col gap-sp-3 border-b border-line-soft p-sp-5`）：role-missing warn（warn 家族 `border-warn/40 bg-warn-surface text-warn`）→ last-error（danger 家族）→ instruction → dependencies → output key（**末段去 border-b** = 无 `border-b`，避免 `:last-child` 在条件 sibling 下不可靠）。dep 行 / copy 按钮 hover 走 `accent-surface`+`accent-ring`+`accent`，output code `font-mono text-accent bg-surface-sunken`。
  - **apply-time 决定**：（a）末段无下边框用「显式不加 border-b」实现而非 `[&:last-child]`——因 warn/error section 条件渲染会让 JSX `:last-child` 漂移，output-key 永远是最后一个 unconditional child，直接不加 border 最稳。（b）role-missing 也包进 `.insp-sec` 容器统一节奏（prototype `.insp-warn` 是 `.insp-sec` 内的 content block），保持段间 line-soft 分隔一致。（c）empty-state aside 颜色对齐 V3（`text-ink-4`），结构不变。

## 2. Run-strip token 收口

- [x] 2.1 `SopRunProgressStrip.tsx` token-family 迁移（**非 verify-only no-op**）：当前 `accentClass` / `dotClass` 用 legacy `--info`/`--success`/`--error` 系（`border-info bg-info-muted text-info` + `bg-success`），迁到 V3 status 系 —— run→`--accent-surface`+`--accent-ring`+`--accent`、done→`--ok-surface`+ok-tone border/text、fail→`--danger-surface`+danger-tone border/text；pulse dot 随 state 取 `--accent`/`--ok`/`--danger`。语义 token，无硬 hex；3s auto-clear 行为不变
  - **已做**：`accentClass` 改为 3-way —— `hasFailure → border-danger/40 bg-danger-surface text-danger`、`isRunning（无失败）→ border-accent-ring bg-accent-surface text-accent`、terminal-success → `border-ok/40 bg-ok-surface text-ok`。`dotClass` 同步：fail→`bg-danger`（in-flight `animate-pulse`）、run→`animate-pulse bg-accent`、done→`bg-ok`。**legacy `info`/`success`/`error` 引用全清**，无硬 hex；`shouldRender` / 3s clear-window / stats / body copy 逻辑零改动。
  - **apply-time 决定**：prototype `.run-strip.done` 文字用更深的 `#15824f`，但 V3 token 词汇是 `text-ok`（语义 token 优先于 prototype 内联 hex，符合「禁裸 hex + 走 V3 token」纪律）；border 用 `border-ok/40` / `border-danger/40` 近似 prototype 的 `rgba(...,0.4)`，全部经语义 token alpha 派生，无裸 hex。

## 3. 验收 gate

- [x] 3.1 串行 build + `pnpm typecheck`（`SopDagCanvas`/`sop-dag-layout`/`SopDagNode`/`SopDagEdge` 不进 diff）
  - **已做（全 exit 0）**：(1) `rm -rf ui-office/dist + tsbuildinfo && pnpm --filter @offisim/ui-office build` → 0；(2) `pnpm --filter @offisim/ui-office typecheck` → 0；(3) `apps/desktop/renderer` `npx tsc --noEmit` → 0；(4) `pnpm --filter @offisim/desktop-renderer build` → 0（chunk-size warning 为既有 known debt）；(5) `pnpm tokens:check` → 0 + `pnpm tokens:lint-hex` → 0（无裸 hex）；(6) `pnpm typecheck`（全量 25）→ 25 successful。Biome check 两文件 → clean。`git diff --name-only -- sop/` 仅 `SopInspectorPanel.tsx` + `SopRunProgressStrip.tsx`；`SopDagCanvas`/`sop-dag-layout`/`SopDagNode`/`SopDagEdge` 未进 diff。`grep -c foreignObject SopDagCanvas.tsx` = 0 → 确认 HTML node overlay + SVG interaction layer（共享 translate/scale）架构未动、release 渲染硬规则未破。
- [ ] 3.2 release `.app` live（用户/Codex）：inspector sectioned + line-soft 分隔 / run-strip status-tinted / 三栏 280|1fr|320 / 无铃铛 / **DAG release 渲染 node 卡片与 ports/edges 同步 transform 无错位** / drag-to-connect + cycle prevention + run + node drag 持久化 全不破  — **BLOCKED 2026-05-24**：release `.app` 已用当前 worktree 精确路径构建并启动，但本机处于 macOS 锁屏界面；Computer Use 附着返回 `cgWindowNotFound`，解锁后必须用同一 `.app` 路径补跑。
- [ ] 3.3 archive gate 三查（确认未触 DAG 锁定规则）  — 待 live verify 通过后做
