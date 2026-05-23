## Why

V3 设计稿（`Docs/design/offisim-lifecycle-prototype.html` + DNA §11 Lifecycle）定：所有**非 wizard** dialog 用 `.dlg` shell、padding 16-18px（head `16px 18px 14px`/body `16px 18px`/foot `12px 18px`，非旧 ~20/22px）；**Wizards（CompanyCreationWizard / EmployeeCreatorOverlay）保留 V3 `--wiz-*` 暗色面板 —— intentional reverse-risk，不 relight**；toast/confirm/installable popover 用 V3 popover-card skin。无铃铛。

**当前真实状态（已核代码，纠正旧叙事）**：
- `DialogShell` 当前 head `px-5 pb-3 pt-5`、body `px-5 py-4`(~20/16)、foot `px-5 py-3`；popover 是 `bg-surface-elevated p-3`（无 V3 status-tinted card skin）；`ToastBanner` variant 用 `border bg-surface-elevated`。
- `CompanyCreationWizard.tsx` 与 `EmployeeCreatorOverlay.tsx` **没有硬编码暗色 hex** —— 它们用 **语义 Tailwind class**（`bg-surface*` / `border-border-*` / `text-text-*`）。它们当前显示为暗，是因为语义 token 仍 resolve 成暗色。**Phase 0 的 light-only revalue 会把这些语义 token 重打成亮色 → wizard 会被 relight（违 DNA §11）。** 这正是为什么必须把它们 pin 到 `--wiz-*`。
- 唯一持有原始 `var(--surface-*)` + 字面 hex 的是 `company-creation-wizard-preview.tsx`（场景 SVG）—— 这是第二条 relight 向量。

**Phase 0 是硬前置**：Phase 0 *仅 emit* `--wiz-*` 暗色 token（`--wiz-bg #0c1019` 等）+ V3 token；它**不**做 wizard 文件改写。**本 Phase 8 owns 实际的 wizard 改写**（D2），消费 Phase 0 已 emit 的 `--wiz-*`。

## What Changes

- **dialog `.dlg` padding 16-18**：`DialogShell` head/body/foot padding 对齐 V3（head `16px 18px 14px`、body `16px 18px`、foot `12px 18px`）。`InstallDialog`/`ExternalEmployeeInstallDialog`/`KeyboardShortcutsDialog` 等非 wizard dialog 走 `.dlg` shell。
- **wizard 消费 `--wiz-*` 暗色（本 phase 改写）**：把两条 relight 向量都 pin 到 `--wiz-*`：(a) `CompanyCreationWizard.tsx` + `EmployeeCreatorOverlay.tsx` 的**语义 token 表面**（`bg-surface*` / `border-border-*` / `text-text-*` → `--wiz-*`），(b) `company-creation-wizard-preview.tsx` SVG 的**原始 `var(--surface-*)` + 字面 hex** → `--wiz-*`。两者改完，light-only 下 wizard 仍全暗。
- **popover/confirm/toast V3 card skin**：toast/confirm/installable popover（`PopoverContent` 默认 / `ToastBanner` / `SkillInstallConfirmBubble`）改用 V3 popover-card skin（status-tinted surface + V3 token），替旧 `bg-surface-elevated p-3` / `border bg-surface-elevated`。**skin basis 见 design.md D3：lifecycle prototype 没有 `.icard` CSS 规则**（grep `.icard` 在 lifecycle prototype = 0；它只作注释出现在 states prototype）；真实可抄 grammar 是 lifecycle prototype 的 `.toast`（320px 卡、`--surface-1`、`--elev-2`、status-tinted `.tic` 图标 chip）。本 change 以 `.toast` grammar 为基准，落成 ui-core token-based class，**不再声称从某个 `.icard` 规则提取**。
  - **shell 区分**：`PopoverContent` 是 Radix popover content（1 个产品消费方 = `SopAddStepPopover`）；`ToastBanner` 是固定顶栏通知（14 个产品消费方）；`SkillInstallConfirmBubble` 是 **chat 气泡，渲染 `<Card>`（不是 PopoverContent）**。Card 与 Popover 是不同 shell，skin token 共用但挂载壳分别处理。
- **drop bell**：lifecycle 表面确认无铃铛。
- **InterviewWizard dead-module 处理**：`grep '<InterviewWizard'` 全仓 = **0 JSX 挂载点**，仅 barrel-export（`index.ts:31`）。判定 dead → 删除（含 `useInterviewWizard.ts` + `interview-steps/`）或明确标记保留为 open question，**不在本 phase 接线**。

## Capabilities

### New Capabilities
- `lifecycle-surface-v3`: lifecycle 表面 V3 视觉契约 —— 非 wizard dialog `.dlg` 16-18 padding、wizard 消费 `--wiz-*` 暗色（intentional，不 relight，本 phase 完成改写）、toast/confirm/installable popover V3 card skin（基于 `.toast` grammar）、drop bell。

### Modified Capabilities
- `panel-and-dialog-sizing`: 新增 DialogShell head/body/foot V3 padding（16-18px）要求；既有 clamp min/max height、tab 高度稳定、flex min-h-0、sticky footer reserve、≤1 容器层 等保持。

## Out of Scope (this change does NOT touch)

本 change 只改视觉 className / token，**不改任何协议行为**。以下能力归各自 capability，本 change 视为 no-op，不重述其 SHALL：

- `modal-stack`（`getModalStackDepth` / `useRegisterModal` / `useTopmostEscape`）—— `modal-stack.ts` 不进 diff。
- `dialog-overlay-protocol`（close 语义 / Escape 路由 / focus-trap+restore / a11y / 单一 `DialogShell` primitive）。
- `popover-protocol`（单一 Popover primitive / modal-stack 注册为 `kind:'popover'` / z-index / dirty-check）。
- install singularity（`useInstallFlow` 入口）。

如果本 change 的 diff 改到上述任一文件的行为，视为越界，需回退。

## Impact

- 代码：`ui-core` `dialog-shell.tsx`（padding）、`popover.tsx`/`toast-banner.tsx`（V3 card skin）；`ui-office` `onboarding/CompanyCreationWizard.tsx` + `onboarding/company-creation-wizard-preview.tsx`（`--wiz-*`）、`employees/EmployeeCreatorOverlay.tsx`（`--wiz-*`）、`install/InstallDialog`/`employees/ExternalEmployeeInstallDialog`（`.dlg` 确认）、`chat/SkillInstallConfirmBubble`（Card skin token）。`modal-stack.ts` 不动。
- blast radius：`DialogShell` padding 改动波及全仓非 wizard dialog（视觉，非行为）；`PopoverContent` skin 改动 **1 个产品消费方**（`SopAddStepPopover`）；`ToastBanner` skin 改动 **14 个产品消费方**；`SkillInstallConfirmBubble` 是单独 Card 气泡；wizard `--wiz-*` 改动隔离在 3 个 wizard 文件（含 preview SVG）。
- 验收 gate：typecheck + 串行 build；release `.app` live 验：dialog 16-18 padding / wizard 仍暗（`--wiz-*`，不被 light relight）/ popover+toast V3 card skin / 无铃铛 / modal-stack（Escape/focus-trap/backdrop/dirty-check）行为不破 / install 入口不破。
