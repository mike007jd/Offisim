## Why

V3 设计稿（`Docs/design/*.html` + `.v3-dna-brief.md`）是整产品 UI 的规格，但当前 token SSOT 用的是另一套命名与值（`--color-text-*`/`--spacing-N`/`--radius-md` + light/dark 双主题 + legacy `--hud-*`/`--ocean-*`/`--lobster-red`），与 V3 的 `--ink-1..4`/`--sp-1..8`/`--r-*`/light-only/`--ok·warn·danger·violet` 不一致。token 是整套视觉的根，必须先把基座换成 V3，后续 9 个 surface 才有统一可用的 token；这是 V3 全前端重做的 Phase 0。

> 调查修订（2026-05-23）：5 路 fan-out 调查后修订。关键发现：V3 几乎全 light（连 3D 办公场景 prototype 都是 light 底 `rgba(244,247,251,0.82)`），唯一 intentional-dark 表面是 **Wizard**（`--wiz-*`）+ Studio（DNA 要求）。token 消费 95% 走 Tailwind utility（色彩 3047 + 圆角 386 + 阴影 42 + 字号 1023，直接 TS import 仅 18 文件），**重命名字段会炸 ~1500 处 utility**。故策略改为 **revalue（保留旧名、值重指 V3）**，不 rename。

## What Changes

- **Revalue 现有 light 语义 token 值为 V3（保留旧字段名，零 call-site 改动）**：`LIGHT_SEMANTIC_COLORS` 的 38 字段逐个映射到 V3 值（`textPrimary→ink-1` / `surface*→bg·surface-0/1/2·sunken` / `border*→line·line-soft·line-strong·accent-ring` / `accent→#2f6bff` / `error→danger` / `success→ok` / `warning→warn` / `info→accent` …）。结果：现有 `text-text-primary`/`bg-error`/`rounded-md`/`shadow-modal` 等 ~1500 处 utility **一个不动**，全屏即时渲染成 V3 浅色。`radius.ts` md/lg/xl→9/13/18 + 加 xs(5)/pill(999)；`shadow.ts` 旧 5+4 名重指 V3 elev-1/2/3 + 保留 glow；`typography.ts` `FONT_FAMILY.sans→General Sans` 栈、加 `FONT_SIZE_V3`(micro..xl) + `--ls-caps`。
- **叠加 V3 原生 token 层（additive）**：新增 V3 原生变量（`--bg`/`--surface-0/1/2`/`--surface-sunken`/`--ink-1..4`/`--line*`/`--accent*`/`--ok·warn·danger·violet*`/`--r-*`/`--elev-*`/`--fs-*`/`--ls-caps`/`--sp-1..8`/`--title`/`--toolbar`/`--wiz-*`）+ V3 命名 Tailwind key（`--color-ink-1`/`--color-accent`…），供后续 surface phase 用 V3 名编写新结构。
- **BREAKING：强制 light-only（machinery retained, pinned to light）**：`theme-provider` 钉死 resolvedTheme=`light`、运行时不再 apply `.dark` class；`emitTailwindThemeCss` 不再 emit `:root.dark` 块。**但不 hard-delete `:root.dark` machinery**——`Theme`/`ResolvedTheme` 类型 + class-toggle 代码路径作为本提案的 D2 light-only fallback 保留在代码里（pinned to light、inert），后续可无类型破坏地重启。**保留** `DARK_SEMANTIC_COLORS` / `DARK_SCENE_3D` TS 导出（intentional-dark 消费者直接读，不依赖 `.dark` CSS class）。
- **守住 intentional-dark（Phase 0 仅 emit token，不改 wizard 文件）**：Studio 一行 decouple（`isLightStudioTheme` 钉 false）保持 dark（读 `DARK_SEMANTIC_COLORS`）。Phase 0 **emit** `--wiz-*` token 并把 Studio + lifecycle wizard 表面（`CompanyCreationWizard` + `EmployeeCreatorOverlay`）标记为 intentional-dark **例外集**；把 wizard 组件文件从 light 语义 utility 真正迁到 `--wiz-*` 的改造**归属 Phase 8（`rebuild-lifecycle-dialogs-v3`）**，Phase 0 不重写任何 wizard 组件文件。现状核实：两个 wizard 文件当前都是 light（`bg-surface`/`border-border-*`），故迁移是真实 Phase 8 工作。3D/2D 场景跟随 light（V3 正确方向；美术微调属 B1）。
- **Tailwind v4 双层 emit**：`@theme inline` 同时保留**全部旧 key（重指 V3 值）**+ 新增 V3 key；`:root` 承载 V3 原生变量 + 旧 `-val` 别名（仍指向各自语义值，现已是 V3）。
- **gate 适配**：`emit/check-tailwind-theme.mjs` 重新生成对账；`lint-no-raw-hex.mjs` 沿用。
- **自托管 General Sans**：从 Fontshare 取 woff2 放 renderer `public/fonts/`（**不**用 CDN，避 Tauri CSP/离线翻车），`@font-face` + `font-display:swap`，沿用现有 Inter/JetBrains 自托管模式。
- **shadcn 对齐 + assistant-ui 落地（无 runtime）**：确认 `components.json`（已就位），对齐 ui-core 既有 27 组件；**Phase 0 拥有「把 `@assistant-ui/react`(+ markdown) 加进 renderer」这步**（安装并 pin exact 版本），用 shadcn CLI 把 thread/markdown 组件**骨架**落进 renderer。本 phase 不接 ExternalStoreRuntime、不改 chat UI（runtime 接线属 Phase 1）。**D3：因为 assistant-ui 依赖由 Phase 0 落地，Phase 1（`rebuild-chat-rail-on-assistant-ui`）可显式把 Phase 0 声明为前置依赖（assistant-ui 已 pin 进 renderer）。**

**明确不在范围**：surface 布局/结构重做（Phase 2-9）、assistant-ui runtime 接线（Phase 1）、`colors-3d.ts` 场景美术值调优（B1/GPT 5.5）、把 utility 从旧名迁到 V3 名（随每个 surface phase 做）。

## Capabilities

### New Capabilities
<!-- 无。assistant-ui runtime 契约属于 Phase 1；本 phase 只装依赖+落骨架，不形成可验收行为。 -->

### Modified Capabilities
- `design-token-foundation`: light 语义 token 值 revalue 为 V3（保留字段名）；圆角/阴影/字号/字体值切 V3 + 自托管 General Sans；新增 V3 原生变量层 + V3 命名 Tailwind key + `--wiz-*`（含 `--wiz-line-2`）；emit 不再 emit `:root.dark`（强制 light，但 machinery retained pinned light、不 hard-delete），`@theme` 保留全部旧 key 重指 V3 值；保留 `DARK_SEMANTIC_COLORS`/`DARK_SCENE_3D` 导出供 intentional-dark 消费者；Phase 0 仅 emit `--wiz-*` + 标记 intentional-dark 例外集，wizard 组件文件迁移归属 Phase 8。
- `theme-light-dark-switching`（D1 reconcile）：light-only 决策使本能力的 user-facing dark toggle / system-follow / dark-emit 失效——REMOVE「System theme via prefers-color-scheme」+「Settings UI theme control」两条；MODIFY `Theme` 类型 / dual-scope emit / `useSceneColors` / force-dark removal / class-based toggling / localStorage persist / pre-hydration script 为「resolved theme is light-only；`.dark` machinery retained but inert」。
- `scene-2d-theme-tokens`（D1 reconcile）：MODIFY「2D canvas re-renders on theme switch」+「preserve product semantics across themes」两条为「场景跟随 light only，`DARK_SCENE_3D` 2D 字段 retained 但 light-only canvas 不读」。
- `design-system-consolidation`（D1 reconcile）：MODIFY「Visual tokens are constrained on touched surfaces」（含「renders correctly in both light and dark」断言）为「touched surface 只需在单一 light theme 正确渲染；intentional-dark 例外（Studio / Phase 8 后的 wizard）走 `DARK_SEMANTIC_COLORS`/`--wiz-*`」。

## Impact

- token 代码：`packages/ui-core/src/tokens/{colors-semantic,radius,shadow,typography,spacing,tailwind-theme}.ts`、`apps/desktop/renderer/src/generated/tailwind-theme.css`、`scripts/{emit,check}-tailwind-theme.mjs`。
- 主题 + intentional-dark：`packages/ui-office/src/theme/theme-provider.tsx`（钉 light、运行时不 apply `.dark`，但 `.dark` machinery/类型/class-toggle 路径 retained 不 hard-delete）、`studio-style-helpers.ts`（钉 dark）。`useSceneColors`/2D canvas 随 light（V3 正确方向，scene 美术调优属 B1）。**Phase 0 不动 wizard 组件文件**——`CompanyCreationWizard.tsx` / `EmployeeCreatorOverlay.tsx`（当前都是 light）迁到 `--wiz-*` 的真实改造归属 Phase 8。
- 字体：`apps/desktop/renderer/public/fonts/`（新增 General Sans woff2）+ `apps/desktop/renderer/src/index.css`（@font-face）。
- 依赖：`@assistant-ui/react`(+ markdown) pin 进 renderer；shadcn CLI 落 thread/markdown 骨架。
- 兼容面：~1500 utility call-site **零改动**（旧名重指 V3）；直接读 `DARK_SEMANTIC_COLORS` 的 5 文件保持工作；需 apply 阶段核查全仓 Tailwind `dark:` variant 用量（删 `.dark` class 后是否有失效）。
- 验收 gate：typecheck + `tokens:check` + `tokens:lint-hex` + 串行全量 build（shared-types→ui-core→core→ui-office→renderer→desktop，renderer build 后验证旧+新 utility 都生成）。release `.app` live 由用户/Codex 验。
