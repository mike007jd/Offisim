## Context

`ui-core`：
- `dialog-shell.tsx`（`DialogShell` + `DIALOG_SIZING_CLASS`；head 当前 `px-5 pb-3 pt-5`、body `px-5 py-4`、foot `px-5 py-3`；表面用语义 token `bg-surface-elevated` / `border-border-subtle` / `bg-surface-muted`；modal-stack `useRegisterModal(...,'dialog')`；size xs..full）。
- `popover.tsx`（`PopoverContent` `bg-surface-elevated p-3`；modal-stack `kind:'popover'`）。**产品消费方 = 1**（`SopAddStepPopover`）。
- `toast-banner.tsx`（variant info/success/warning/error，每个 `border-* bg-* text-*` 语义 token）。**产品消费方 = 14**。
- `modal-stack.ts`（锁定，不动）。

`ui-office`：
- `onboarding/CompanyCreationWizard.tsx`（`useRegisterModal(...,'overlay')` + `useTopmostEscape`）—— **用语义 Tailwind class，没有硬编码暗 hex**。
- `onboarding/company-creation-wizard-preview.tsx`（场景 SVG）—— **唯一持有原始 `var(--surface-mid/light/lighter/-)` + 字面 hex（`#0ea5e9` 等）的文件**。
- `employees/EmployeeCreatorOverlay.tsx` —— 同样用语义 class，无硬 hex。**prototype 把它标 "intentionally hard-dark"，但代码里它的暗色来自语义 token resolve，不是写死的；本 phase 把它 pin 到 `--wiz-*` 让 light-only 下保持暗**。
- `install/InstallDialog`（`AppGlobalDialogs.tsx`）、`employees/ExternalEmployeeInstallDialog`（已走 `DialogShell`）。
- `chat/SkillInstallConfirmBubble.tsx` —— **渲染 `<Card>`（`ui-core`）的 chat 气泡，不是 PopoverContent**；用语义 token。

V3 lifecycle prototype 实测 grammar：
- `.dlg-head padding 16px 18px 14px` / `.dlg-body 16px 18px` / `.dlg-foot 12px 18px`（与 D1 padding 目标一致）。
- `--wiz-bg #0c1019` / `--wiz-surface rgba(255,255,255,0.02)` / `--wiz-line` / `--wiz-line-2` / `--wiz-ink-1..4` / `--wiz-blue #3b82f6` / `--wiz-emerald #34d399`（**Phase 0 已 emit**）。
- `.toast`（320px 卡、`background var(--surface-1)`、`border 1px var(--line)`、`box-shadow var(--elev-2)`、status-tinted `.tic` 图标 chip `background var(--accent-surface) color var(--accent)`）—— 这是真实的 popover/confirm card grammar。
- **`.icard` 在 lifecycle prototype 不存在**（grep = 0）；它只作为注释字符串出现在 states prototype（`/* V3 .icard / .dlg shell ... */`），从无 CSS 规则。任何"从 lifecycle prototype 提取 `.icard`"的说法是错的。

协议锁定（本 change 不动其行为，详见 proposal Out of Scope）：`dialog-overlay-protocol` / `popover-protocol` / `panel-and-dialog-sizing`（clamp/tab 稳定/flex min-h-0/≤1 容器）/ `modal-stack` / install singularity。

## Goals / Non-Goals

**Goals:** dialog 16-18 padding、wizard `--wiz-*` 暗色（本 phase 改写两条 relight 向量）、popover/confirm/toast V3 card skin（基于 `.toast` grammar）、drop bell。协议/modal-stack 行为不变。

**Non-Goals:** modal-stack 实现；dialog/popover 协议行为；install singularity 入口；surface 配色 + `--wiz-*` token emit（Phase 0）。

## Decisions

### D0 — Phase 0 是硬前置（token emit），Phase 8 owns wizard 改写
Phase 0 *仅 emit* V3 token + `--wiz-*` 暗色 token；它**不**改 wizard 文件。**本 Phase 8 持有 wizard 文件的实际改写**（消费 `--wiz-*`）。任何"Phase 0 已改写 wizard"的框架都是错的，已剔除。Precondition：开工前确认 Phase 0 applied、`--wiz-*` + V3 token 在 `:root` 可用。

### D1 — dialog padding 16-18（panel-and-dialog-sizing 加 req）
`DialogShell` head/body/foot padding 对齐 V3（head `16px 18px 14px`、body `16px 18px`、foot `12px 18px`）。size clamp / tab 稳定 / flex min-h-0 / sticky footer reserve 不动。

### D2 — wizard 消费 `--wiz-*`（守 intentional dark，本 phase 改写）
把两条 relight 向量都 pin 到 `--wiz-*`：
1. **语义 token 表面**：`CompanyCreationWizard.tsx` + `EmployeeCreatorOverlay.tsx` 的 `bg-surface*` / `border-border-*` / `text-text-*` → `--wiz-*`。当前它们是暗的，但 Phase 0 light-only 把语义 token 重打成亮 → 不 pin 就会被 relight。
2. **preview SVG 的原始 var + hex**：`company-creation-wizard-preview.tsx` 的 `var(--surface-mid/light/lighter/-)` + 字面 hex → `--wiz-*`（场景几何用对应 `--wiz-*` 暗色，accent 几何保留品牌 hex 但底面/线条走 `--wiz-*`）。
**理由**：与 Phase 4 调查发现一致（wizard preview `var(--surface-*)` 会跟 light）。**纠正**：旧叙事说 wizard "hard-dark"是误读 —— 没有硬 hex；relight 风险来自语义 token + preview 的原始 var/hex 两条向量，这正是必须 pin `--wiz-*` 的根因。

### D3 — popover/confirm/toast V3 card skin（基于 `.toast` grammar，非 `.icard`）
**skin basis（纠正 BLOCKER）**：lifecycle prototype 没有 `.icard` CSS 规则。本 change 以 lifecycle prototype 的 `.toast` grammar 为基准定义 popover-card skin：status-tinted surface（`--surface-1` 底 + `--elev-2` 阴影 + status-tinted 图标 chip via `--accent-surface`/对应 status surface token），落成 `ui-core` token-based class。**不再声称"从 prototype 提取 `.icard`"。**
**shell 区分**（NOTE）：skin token 共用，但挂载壳分别处理：
- `PopoverContent`（Radix popover content，1 个产品消费方 `SopAddStepPopover`）：默认 className 替 `bg-surface-elevated p-3` 为 V3 card skin。
- `ToastBanner`（固定顶栏通知，14 个产品消费方）：variant 表对齐 V3 status-tinted card token。
- `SkillInstallConfirmBubble`（chat 气泡，渲染 `<Card>` 不是 PopoverContent）：Card shell 上落同一套 status-tinted token，不强塞进 Popover 壳。

### D4 — 协议/modal-stack 锁定（本 change no-op）
不动 `modal-stack.ts`、close/escape/focus-trap/dirty-check/单一 primitive/install 入口。只改视觉 className/token。本 change 不重述这些 capability 的 SHALL（见 proposal Out of Scope）；它们由各自 capability 拥有，本 change 仅断言 no-op。

### D5 — InterviewWizard dead-module
`grep '<InterviewWizard'` 全仓 = 0 JSX 挂载点，仅 barrel-export（`index.ts:31` + `useInterviewWizard.ts`）。判定 dead → 删除（含 `useInterviewWizard.ts` + `interview-steps/`）；若产品决策未定，则明确标记保留为 open question，**不接线**（不在本 phase mount）。

## Risks / Trade-offs

- **`.icard` 不存在导致 skin basis 落空（已解 HIGH）** → 改以 `.toast` grammar 为基准（D3），不再 gate 在不存在的 `.icard`。
- **wizard `--wiz-*` 改不全 → 局部变浅** → 逐个核两条向量（语义 class + preview 原始 var/hex）全改 `--wiz-*`；live 验 wizard 全暗无浅斑。
- **dialog padding 改动波及多个非 wizard dialog 布局** → live 验各 dialog 内容不被裁 / footer 不盖；tab 高度稳定不破。
- **误动 modal-stack/协议** → 只改 className/token，`modal-stack.ts` 不进 diff；live 验 Escape/focus-trap/backdrop/dirty-check。
- **Card vs Popover 误用同一壳** → SkillInstallConfirmBubble 保持 Card shell（D3），不改成 PopoverContent。

## Migration Plan

1. 确认 Phase 0 precondition（`--wiz-*` + V3 token 在 `:root`）。
2. 以 `.toast` grammar 定义 ui-core popover-card skin token class。
3. `DialogShell` padding 16-18。
4. wizard `--wiz-*` 全量替换（语义 class + preview SVG 两条向量）。
5. popover/toast/SkillInstallConfirmBubble 套 V3 card skin（Card vs Popover 各自壳）。
6. InterviewWizard dead 判定（grep 确认 0 mount → 删 or 标保留）。
7. 串行 build + live 验。
8. 回滚：ui-core 2-3 文件 + ui-office wizard/skin 文件，单 commit 可 revert。

## Open Questions

- popover-card skin 的精确 token 组（apply 时按 `.toast` grammar 落，status 变体映射到对应 status surface token）。
- InterviewWizard：dead-remove 还是保留（已确认 0 mount；待产品决策是否未来接线）。
