## 1. 前置量化（决定 theme-provider 改法）

- [x] 1.1 grep 全仓 Tailwind `dark:` variant 用量（`dark:bg-`/`dark:text-`/`dark:border-` 等）+ 手写 `.dark ` CSS selector；量化删 `.dark` class 的破坏面，决定 theme-provider 改法（恒 light 是否安全 / 是否要保留 class 机制但锁 light）。**结论**：全仓 `dark:` variant = **0 处**，唯一 `.dark` 写入是 `theme-provider.tsx:91` 的 `classList.toggle('dark')` + generated CSS `:root.dark` 块。删 `.dark` apply **零破坏面** → 钉死 resolvedTheme=light、停 apply `.dark`、恒 `.light`、类型/class-toggle 机制 retained pinned light（不 hard-delete）

## 2. Token TS 改值（revalue + 加 V3 层）

- [x] 2.1 `colors-semantic.ts`：`LIGHT_SEMANTIC_COLORS` 38 字段按 design.md 映射表 revalue 为 V3 值（字段名不动）；`DARK_SEMANTIC_COLORS` **不动**；新增 `V3_COLORS`（V3 原生调色板 + `wiz*` 暗色 token，含 `wizLine2 rgba(255,255,255,0.10)` ↔ prototype `--wiz-line-2`，供 `.wiz-emp` 卡片用）；`getSemanticColors` 签名保留
- [x] 2.2 `radius.ts`：`RADIUS_SCALE` = `{none:0,xs:5,sm:7,md:9,lg:13,xl:18,full:9999,pill:999}`
- [x] 2.3 `shadow.ts`：合并为单组 `SHADOW_SCALE`（light-only），resting→elev-1 / hover·popover→elev-2 / overlay·modal→elev-3，glow×4 保留；删 `SHADOW_SCALE_DARK`
- [x] 2.4 `typography.ts`：`FONT_FAMILY.sans→General Sans 栈`、`mono→V3 mono 栈`；加 `FONT_SIZE_V3`(micro10..xl19) + `LETTER_SPACING.caps='0.14em'`；`TYPOGRAPHY_SCALE` family 引用新 FONT_FAMILY
- [x] 2.5 `spacing.ts`：保 `SPACING_SCALE`；加 `SP_DENSITY`（normal `{1:4,2:6,3:8,4:10,5:12,6:14,7:16,8:20}` + compact/spacious）
- [x] 2.6 `tailwind-theme.ts`：加 `SHELL_HEIGHTS`(title40/toolbar54)；重写 `emitTailwindThemeCss`：① `@theme inline` 保留全部旧 key（经 `-val` 指向 revalued V3）+ 加 V3 命名 key（`--color-ink-1`/`--radius-r-md`/`--text-fs-sm`/`--shadow-elev-1`/`--spacing-sp-N`）；② 单一 `:root` = 旧 `-val`(已 V3) + root aliases + V3 原生变量 + `--wiz-*`；③ **删 `:root.dark` 块**；④ density `--sp-1..8`(+ 旧 `--sp-xs..xxxl` alias)
- [x] 2.7 `index.ts`：barrel 同步导出 V3_COLORS / SP_DENSITY / FONT_SIZE_V3 / LETTER_SPACING / SHELL_HEIGHTS（去 SHADOW_SCALE_DARK）；核 5 个直接 import `DARK_SEMANTIC_COLORS` 的文件仍可编译

## 3. 重生成 + token gate

- [x] 3.1 `pnpm --filter @offisim/ui-core build` → `pnpm tokens:emit` → `pnpm tokens:check` 绿
- [x] 3.2 人工核 generated CSS：旧 key（`--color-text-primary`→#131a27、`--color-error`→#d6453d、`--radius-md`→9px、`--shadow-modal`→elev-3）+ V3 原生（`--ink-1`/`--accent`/`--r-md`/`--elev-1`/`--sp-3`/`--title`/`--wiz-bg`）+ V3 key（`--color-ink-1: var(--ink-1)`）齐全；零 `:root.dark`

## 4. 强制 light + 守 intentional-dark

- [x] 4.1 `theme-provider.tsx`：按 1.1 结论钉 resolvedTheme=light、停 toggle `.dark`、恒 `.light`（保 `data-density`）
- [x] 4.2 `studio-style-helpers.ts`：`isLightStudioTheme()` 钉 `return false`（studio 恒 dark，读 `DARK_SEMANTIC_COLORS`）
- [x] 4.3 Wizard tokens（**仅 emit，不改 wizard 组件**）：在 generated CSS 的 `:root` emit 全部 `--wiz-*` 暗色 token（含 `--wiz-line-2`），并在文档/spec 把 Studio + lifecycle wizard 表面（CompanyCreationWizard / EmployeeCreatorOverlay）标记为 intentional-dark 例外集。**Phase 0 不重写任何 wizard 组件文件**——把 `var(--surface-*)`/语义色迁到 `--wiz-*` 的真实文件改造归属 Phase 8（`rebuild-lifecycle-dialogs-v3`）。现状核实：两个 wizard 文件当前都是 light（用 `bg-surface`/`border-border-*` 语义 utility，仅 import `DARK_SEMANTIC_COLORS` 做 role-dot fallback），不是已 dark，故迁移是真实 Phase 8 工作而非 Phase 0 回归
- [x] 4.4 核 `useSceneColors`/2D canvas：light 下走 LIGHT_SCENE_3D（V3 正确方向，不调色）；character eye LED / office3d-sections 的 inline DARK_ 引用不受影响

## 5. 自托管 General Sans

- [x] 5.1 取 General Sans woff2（Fontshare 官方，400/500/600/700）放 `apps/desktop/renderer/public/fonts/`；拿不到则保留 `FONT_FAMILY.sans` General-Sans-在前 + Inter 兜底，并把本 task 留未勾 + 标 blocker（不假装生效）
- [x] 5.2 `index.css` 加 General Sans `@font-face`（`font-display:swap`）；mono 复用现有 JetBrains woff2

## 6. assistant-ui 装 + 落骨架（不接线）+ shadcn 对齐

- [x] 6.1 `pnpm --filter @offisim/desktop-renderer add @assistant-ui/react`(+ markdown)，pin exact 版本；记录版本号 + React19 peer 结果（冲突则记确切组合）。**已装**：`@assistant-ui/react@0.14.7` + `@assistant-ui/react-markdown@0.14.0`（pin exact，无 caret）。React19 peer = `react: ^18 || ^19` → **无冲突**。骨架附带 npm dep（pin exact）：`remark-gfm@4.0.1` / `class-variance-authority@0.7.1` / `@radix-ui/react-collapsible@1.1.12` / `@radix-ui/react-slot@1.2.4`。唯一 peer warning 是既有 `apps/platform better-call→zod@4`（无关）
- [x] 6.2 shadcn CLI 拉 thread + markdown 组件骨架进 renderer（不 import 进 App、不接 runtime）；按需补 `@source`/alias。**实际方式（apply-time 决定）**：renderer `components.json` 的 `@/components` alias 指向 `packages/ui-core`（非 renderer 自身），shadcn CLI 会把骨架写进 ui-core 并经 attachment 子树拖回**已被本仓 intentional-remove 的 Dialog primitive**。为遵守 plan「骨架进 renderer」+ 不污染 ui-core 原子层，改为**手动从 assistant-ui registry（`r.assistant-ui.com`）逐字落骨架进 `apps/desktop/renderer/src/components/assistant-ui/`**：`thread` / `markdown-text` / `reasoning` / `tool-fallback` / `tool-group` / `tooltip-icon-button` + 本地 `collapsible`。sibling import 改相对路径，`button`/`tooltip`/`cn` 走 `@offisim/ui-core`。**跳过 `attachment` 子树**（Phase 1 设计明确保留 Offisim 自家 Tauri 附件管线、不采用 assistant-ui attachment adapter）——`thread.tsx` 的 3 个 attachment 组件用 inline `() => null` stub 占位。骨架不 import 进 App、不接 runtime。renderer tsc 全清（修了 1 处 registry 自带的 React19 `ElementType` className→never 类型摩擦：`tool-fallback` statusIconMap 改 `LucideIcon`）。无需新增 `@source`/alias（相对 import + 既有 `@offisim/ui-core` alias 已够）
- [x] 6.3 对齐 ui-core 既有 27 shadcn 组件到 canonical（仅修补漂移项，不改 API）。ui-core 既有组件已是 canonical shadcn 形态（`cva` + `cn` + Radix primitives）；build + 全量 typecheck 绿，无 API-breaking 漂移需补。Phase 0 不动其 API。

## 7. 验收 gate（串行）

- [x] 7.1 串行 build：`shared-types → ui-core → core → ui-office → desktop-renderer → desktop`；renderer build 后验证**旧 utility**（`text-text-primary`/`bg-error`/`text-caption`/`rounded-md`/`shadow-modal`）+ **V3 utility**（`text-ink-1`/`bg-accent`）都在产物里生成（不止 build 绿）。**结果**：core/ui-office/desktop-renderer build 全绿。产物 CSS（`dist/assets/index-*.css`）：旧 5 utility **全作为 class 生成 ✓**；V3 `bg-accent` **已生成 ✓**（证明 V3 @theme 层可用），`text-ink-1`/`text-ink-2`/`border-line` 因 Phase 0 暂无 surface 使用、按 Tailwind v4 on-demand 未生成（@theme key 已在生成的 `tailwind-theme.css`，使用即生成）；V3 root 变量 `--ink-1/--accent/--r-md/--elev-1/--wiz-bg/--title` 全在产物；`:root.dark` = 0；General Sans 入产物。`desktop`（Tauri Rust release）build 归 7.5 release 验收（用户/Codex），本地未跑 Rust 全量 release。
- [x] 7.2 `pnpm typecheck` 全绿（重点 5 个 DARK_ 直接消费文件）
- [x] 7.3 `pnpm tokens:check` + `pnpm tokens:lint-hex` 绿
- [ ] 7.4 OpenSpec archive gate 三查（spec/tasks/docs 一致）；协议台账无新增协议触及（assistant-ui 仅装包，Phase 1 再更）
- [ ] 7.5 release `.app` live 由用户/Codex 验：确认全屏变 V3 浅色 + General Sans 生效 + Wizard/Studio 仍暗 + 不崩；场景观感记录作 B1 输入。**BLOCKED 2026-05-24**：release `.app` 已用当前 worktree 精确路径构建并启动，但本机处于 macOS 锁屏界面；CGWindow 可见 Offisim 窗口存在，Computer Use 附着返回 `cgWindowNotFound`，无法完成 release live 视觉/交互验收。解锁后必须用同一 `.app` 路径补跑，不得用 dev server 或浏览器替代。
