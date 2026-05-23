## Context

Token SSOT 在 `packages/ui-core/src/tokens/`：TS 常量 → `tailwind-theme.ts:emitTailwindThemeCss(commit)` 纯函数 → `scripts/emit-tailwind-theme.mjs` 写 `apps/desktop/renderer/src/generated/tailwind-theme.css`，`check-tailwind-theme.mjs` drift 对账，`lint-no-raw-hex.mjs` 禁裸 hex。

**5 路 fan-out 调查结论（决定本设计）**：
1. **V3 几乎全 light**：`offisim-office-layout-v3-prototype.html` 的 `.stage` 背景 `rgba(244,247,251,0.82)`（浅蓝灰）—— 连 3D 办公场景都是 light。唯一 intentional-dark **设计目标** = **Wizard**（`offisim-lifecycle-prototype.html` 定义 `--wiz-*` 暗色 token，CompanyCreationWizard + EmployeeCreatorOverlay）+ **Studio**（DNA §11 要求保持 dark，不在 prototype 套件里）。**现状核实**：两个 wizard 组件文件（`CompanyCreationWizard.tsx` / `EmployeeCreatorOverlay.tsx`）**当前都是 light**（用 `bg-surface`/`border-border-*` 语义 utility，仅 import `DARK_SEMANTIC_COLORS` 做 role-dot fallback）；把它们迁到 `--wiz-*` 暗色是真实未完成工作，归 **Phase 8**。Phase 0 只 emit `--wiz-*` token + 标记例外集，不改组件文件。Studio 已经走 `DARK_SEMANTIC_COLORS` 恒 dark。
2. **token 95% 走 Tailwind utility**：色彩 3047 + 圆角 386 + 阴影 42 + 字号 1023 处 utility；直接 TS import 仅 18 文件（几乎全是 scene/studio）。**重命名字段会炸 ~1500 处 utility**（静默掉样式）。
3. **`DARK_SEMANTIC_COLORS`/`DARK_SCENE_3D` 是活代码**：5 文件直接读（studio / wizard / character-mesh / office3d-sections / useZoneEditorState）。
4. **主题接线**：`theme-provider` toggle `root.classList .dark/.light`；`useSceneColors`/2D canvas/studio(`isLightStudioTheme` 读 `.light` class) 都跟 `resolvedTheme` 走 → 强制 light 会让它们全变 light。Wizard preview 用 `var(--surface-*)` 也跟着变；wizard 的 `DARK_SEMANTIC_COLORS` fallback + character eye LED 是 inline 写死 dark 不受影响。
5. **基础设施全绿**：components.json / Tailwind v4 `@tailwindcss/vite` + `@source` / ui-core 27 标准 shadcn 组件 + `cn()` / 自托管字体目录 `public/fonts/`（Inter + JetBrains woff2）/ pnpm workspace 全就位。V3 字体 = General Sans（prototype 走 Fontshare CDN）。

## Goals / Non-Goals

**Goals:**
- Phase 0 一次把**全产品切到 V3 配色 + light + General Sans**，且不动 ~1500 处 utility call-site。
- V3 原生变量 + V3 命名 Tailwind key 可用，供 Phase 2-9 用 V3 名写新结构。
- intentional-dark（Studio）保持 dark；emit `--wiz-*` token 并标记 lifecycle wizard 表面为例外集（Phase 0 不改 wizard 组件，迁移归 Phase 8）；3D/2D 场景跟随 light（V3 正确方向）。
- assistant-ui 装好 pin + shadcn 组件骨架落地，不接线。
- 所有 gate 绿。

**Non-Goals:**
- surface 布局/结构重做（Phase 2-9）。
- assistant-ui runtime / chat UI（Phase 1）。
- `colors-3d.ts` 场景美术值调优（B1 / GPT 5.5）—— 本 phase 让场景走 LIGHT_SCENE_3D 现值，不调色。
- 把 utility 从旧名迁到 V3 名（随每个 surface phase 做）。
- 主题切换 UI（已 light-only，无切换）。

## Decisions

### D1 — Revalue 而非 Rename（最关键）
保留 `colors-semantic.ts` 的 `SemanticColors` 字段名（surface/textPrimary/error/…），把 `LIGHT_SEMANTIC_COLORS` 的 38 字段**值** revalue 成 V3 映射（见下表）。`emit` 的 `@theme` 旧 key（`--color-text-primary`/`--color-error`/`--text-caption`/`--shadow-modal`/`--radius-md`…）随之渲染 V3 值。
**理由**：~1500 处 utility 一个不动即全屏 V3 浅色；rename 会炸这 1500 处 + 18 TS import。
**Alternative 拒掉**：rename→V3 字段（爆炸面太大）；纯 additive 不动旧值（要 8 个 phase 后才看到 V3 色，价值滞后）。

**LIGHT_SEMANTIC_COLORS revalue 映射**（V3 值来自 prototype `:root` 逐字）：
| 旧字段 | → V3 值 | | 旧字段 | → V3 值 |
|---|---|---|---|---|
| surface | `#f7f9fc` (surface-0) | | accent | `#2f6bff` |
| surfaceElevated | `#ffffff` (surface-1) | | accentHover | `#1f54d8` (accent-press) |
| surfaceMuted | `#f1f4f9` (sunken) | | accentMuted | `#ecf2ff` (accent-surface) |
| surfaceHover | `#f1f4f9` | | accentText | `#1f54d8` |
| surfaceActive | `#e9edf4` (line-soft) | | success | `#1aa46a` (ok) |
| textPrimary | `#131a27` (ink-1) | | successMuted | `#e4f5ec` |
| textSecondary | `#3c4a60` (ink-2) | | warning | `#c98410` (warn) |
| textMuted | `#647186` (ink-3) | | warningMuted | `#fdf2dd` |
| textDisabled | `#93a0b2` (ink-4) | | error | `#d6453d` (danger) |
| textInverse | `#ffffff` | | errorMuted | `#fdeae9` |
| borderSubtle | `#e9edf4` (line-soft) | | info | `#2f6bff` (=accent) |
| borderDefault | `#dde3ec` (line) | | infoMuted | `#ecf2ff` |
| borderStrong | `#c8d1de` (line-strong) | | glassBg | `rgba(255,255,255,0.82)` |
| borderFocus | `rgba(47,107,255,0.36)` (accent-ring) | | glassBorder | `#dde3ec` (line) |

status×12 映射到 V3（idle/paused→ink-3 `#647186`、assigned/reporting→accent、thinking/searching/meeting→violet `#7c4ddb`、executing/success→ok、blocked/failed→danger、waiting→warn）。`DARK_SEMANTIC_COLORS` **不改**（intentional-dark 消费者继续读 dark）。

### D2 — 强制 light-only（machinery retained, pinned to light）
`theme-provider.tsx` 钉死 resolvedTheme=`light`（去掉 system/dark **解析**路径——不再 follow OS、不再 resolve dark），运行时恒 `.light`、不再 apply `.dark`。`emitTailwindThemeCss` 不再 emit `:root.dark { }` 块。
**不 hard-delete `:root.dark` machinery**：`Theme`/`ResolvedTheme` 类型 + class-toggle 代码路径作为 light-only fallback 保留在代码里（pinned to light、inert），后续可无类型破坏地重启——这是本提案自己的 light-only fallback 口径，不是把 `:root.dark` 从代码硬删。
**保留** `DARK_SEMANTIC_COLORS` / `DARK_SCENE_3D` TS 导出（5 文件直接读，不依赖 `.dark` CSS class）。
**Alternative 拒掉**：删 dark 导出（编译炸 + 违 DNA）；hard-delete `.dark` machinery（失去可逆 fallback，无收益）。
**风险点**：若有 Tailwind `dark:` variant 用法依赖 `.dark` class，因不再 apply `.dark` 而失效 → apply 先 grep `dark:` 用量，有则逐个处理（machinery 仍在、只是不 apply）。

### D3 — 守住 intentional-dark（Wizard / Studio），Phase 0 仅 emit token
- **Studio**：`studio-style-helpers.ts:isLightStudioTheme()` 钉 `return false`（恒 dark），与 app light 解耦。studio 继续读 `DARK_SEMANTIC_COLORS`。
- **Wizard（Phase 0 只 emit，不改组件）**：emit 新增 `--wiz-*` token（prototype 值：`--wiz-bg:#0c1019`、`--wiz-line-2:rgba(255,255,255,0.10)` 等），并把 lifecycle wizard 表面（`CompanyCreationWizard.tsx` + `EmployeeCreatorOverlay.tsx`）连同 Studio 标记为 intentional-dark **例外集**。**Phase 0 不重写任何 wizard 组件文件**——把 `var(--surface-*)`/语义色迁到 `var(--wiz-*)` 的真实改造归属 **Phase 8（`rebuild-lifecycle-dialogs-v3`）**。现状核实：两个 wizard 文件当前都是 light（`bg-surface`/`border-border-*`，仅 import `DARK_SEMANTIC_COLORS` 做 role-dot fallback），故迁移是真实 Phase 8 工作而非 Phase 0 回归。
**理由**：DNA §11 明确 wizard/studio intentional dark；但 Phase 0 是 token 基座，组件改造分到拥有该 surface 的 Phase。
**Alternative 拒掉**：让 wizard/studio 跟 light（违 DNA，且 wizard 暗色插画在浅底会糊）；在 Phase 0 抢改 wizard 组件（越界 Phase 8 owner，且与「token foundation」职责不符）。

### D4 — V3 原生层 additive
emit 在 `:root` 增 V3 原生变量（`--bg`/`--surface-0/1/2`/`--surface-sunken`/`--ink-1..4`/`--line·line-soft·line-strong`/`--accent·accent-press·accent-fg·accent-surface·accent-ring`/`--ok·warn·danger·violet`+`-surface`/`--r-xs..pill`/`--elev-1/2/3`/`--fs-micro..xl`/`--ls-caps`/`--sp-1..8`/`--title`/`--toolbar`/`--wiz-*`）；`@theme` 增 V3 命名 key（`--color-ink-1: var(--ink-1)` 等 + `--radius-r-md`/`--text-fs-sm`/`--shadow-elev-1`）。新文件（assistant-ui 骨架、未来 surface）用 V3 名。
**理由**：旧名（revalued）保后向兼容，V3 名供新结构；两套并存，per-surface 迁移后删旧。

### D5 — token 文件值变更（保 emit/check 纯函数管线）
- `radius.ts`：`md/lg/xl→9/13/18`，加 `xs:5`、`pill:999`（保 none/sm/full 名给旧 utility）。
- `shadow.ts`：旧 5 名重指 V3 三档（resting/hover→elev-1·2，popover→elev-2，overlay/modal→elev-3），glow×4 保留。删 `SHADOW_SCALE_DARK`/light 拆分 → 单组（light-only）。
- `typography.ts`：`FONT_FAMILY.sans→General Sans 栈`、`mono→V3 mono 栈`；加 `FONT_SIZE_V3`(micro10/meta11/sm12/base13/md14/lg15/xl19) + `LETTER_SPACING.caps='0.14em'`。`TYPOGRAPHY_SCALE` family 引用新 FONT_FAMILY。
- `spacing.ts`：保 `SPACING_SCALE`；加 `SP_DENSITY`(V3 1..8 + compact/spacious)。
- `tailwind-theme.ts`：`emitTailwindThemeCss` 重写（旧 @theme key 重指 V3 + V3 新 key + V3 原生 :root + `--wiz-*` + 旧 `-val` 别名 + density `--sp-1..8`），删 `:root.dark`；加 `SHELL_HEIGHTS`。

### D6 — 自托管 General Sans
从 Fontshare 取 General Sans woff2（400/500/600/700）放 `apps/desktop/renderer/public/fonts/`，`index.css` 加 `@font-face`（`font-display:swap`），沿用现有 Inter/JetBrains 模式。**不用 CDN**（Tauri release CSP/离线翻车前科）。mono 复用现有 JetBrains woff2。

### D7 — assistant-ui 装但不接线
`pnpm --filter @offisim/desktop-renderer add @assistant-ui/react`(+ markdown) pin exact；shadcn CLI 拉 thread/markdown 组件骨架进 renderer（不 import 进 App、不接 runtime）。
**理由**：依赖/版本/React19 peer 风险隔离在 foundation 先验。
**D3 — Phase 1 前置**：把 `@assistant-ui/react` 加进 renderer 这步**归 Phase 0 拥有**（保 task 6.1）。因为依赖在 Phase 0 落地，Phase 1（`rebuild-chat-rail-on-assistant-ui`）可显式声明 Phase 0 为前置依赖（assistant-ui 已 pin 进 renderer），Phase 1 只接 runtime / 改 chat UI。

## Risks / Trade-offs

- **不再 apply `.dark` class 破坏 Tailwind `dark:` variant 用法** → apply 先 grep `dark:` 全仓用量；class machinery retained（pinned light、不 hard-delete）但运行时不 apply，有依赖则逐个改写。**未量化前不动 theme-provider**。
- **revalue 映射在某 surface 视觉偏差** → 都是浅色近色相，且 per-surface phase 会精修；apply 后浏览器层 DOM 抽检几个 surface 不塌陷。
- **General Sans woff2 获取**（Fontshare 下载）→ 能拿到就自托管；拿不到则 `FONT_FAMILY.sans` 仍列 General Sans 在前、Inter 兜底（graceful fallback），并把"补 woff2"留未勾 task + 标 blocker，不假装已生效。
- **Tailwind v4 `@theme` key 写错 utility 静默不生成** → renderer build 后验证旧 key（`text-text-primary`/`bg-error`/`rounded-md`/`shadow-modal`）+ 新 key（`text-ink-1`/`bg-accent`）都在产物里。
- **assistant-ui pre-1.0 + React19 peer** → pin 版本，装完即 build 验证。
- **check drift gate** → 改完必 `tokens:emit` 重生成再提交。
- **场景走 LIGHT_SCENE_3D 未经美术调优** → 属 B1，本 phase 不调色，接受现值；live verify 时记录场景观感作为 B1 输入。

## Migration Plan

1. grep `dark:` variant 用量，定 theme-provider 改法。
2. 改 token TS（revalue + 加 V3 + wiz）→ `pnpm --filter @offisim/ui-core build` → `tokens:emit` → `tokens:check`。
3. theme-provider 钉 light（machinery retained）；studio 钉 dark；emit `--wiz-*` token（Phase 0 不改 wizard 组件文件，迁移归 Phase 8）。
4. General Sans woff2 + @font-face。
5. assistant-ui 装 + 骨架。
6. 串行 build + typecheck + lint-hex；renderer build 验 utility 生成。
7. 回滚：token + theme-provider + 2 wizard 文件 + studio 一行 + 字体，单 commit 可整体 revert。

## Open Questions

- Tailwind `dark:` variant 全仓用量（apply 第一步量化，决定 theme-provider 改法）。
- General Sans woff2 是否能在环境内下载（不能则 fallback Inter + 留 blocker task）。
