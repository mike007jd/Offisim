## Context

`SettingsPage`→`SettingsTabNav`(`w-56`=224)+`SettingsContentArea`(sticky save bar，External 隐藏，content 不限宽 —— commit `dbb2bde9` 桶 8 已 drop `max-w-5xl`，**当前无任何 max-width 全局封顶**，save bar 全宽)。`settings-primitives.tsx`：`SettingsSection`(bare：`space-y-3 border-t border-border-default pt-4 first:border-t-0`，无 border/bg/radius，children `space-y-3`；border token 实为 light `border-border-default`，**不是** dark `border-white/5`)、`SurfaceCard`(`rounded-xl`+`border-border-default`+`bg-surface-elevated`+`p-4`)。

实测 grep：**8× `<SettingsSection>` 调用点**（Provider×2 `SettingsProviderTab.tsx` / Runtime×3 `SettingsRuntimeTab.tsx` / SceneDiagnostics×1 `SceneDiagnosticsSection.tsx` / MCP×2 `McpConfigPanel.tsx`）+ 1 处定义。`VaultDirectorySection` 唯一用 SurfaceCard。controller hook `useSettingsWorkspaceController`（脏追踪/save/reinit/toolPermissions）。（前稿写「14×」是错的，已据真实 grep 修正；「API 不变 → 调用点零改」结论不变。）

现有 base spec `settings-workspace-presentation` 相关 req（按 base 原标题）：「Settings tab body has at most one visual container layer」(SurfaceCard 或 border+bg+≥12px radius，SettingsSection 不算容器)、「SettingsSection primitive is the canonical row separator」(bare row-separator，无 border/bg/radius；base req 文案 stale-claims 用 `border-white/5`，但**代码实际是 `border-border-default`**)、「Provider tab uses single resolved-product summary line」、「Runtime tab merges defaults and memory groups」(exactly two SettingsSection rows，no additional SurfaceCard borders)、「Settings Provider and Runtime use workspace width in release」(SHALL NOT 被 centered max-width wrapper 全局封顶)。

V3 prototype `.card-block`：`border 1px var(--line-soft)` + `var(--surface-1)` + `var(--r-md)`(9px) + `var(--elev-1)` + 16px pad，相邻 `+ .card-block { margin-top: var(--sp-3) }`。nav 244、`.set-pane` max-width 720（`.set-scroll` flex justify-center 居中）、`.save-bar-inner` `max-width:720px; margin:0 auto`（居中，与内容栏对齐）。

## Goals / Non-Goals

**Goals:** Settings = V3（每 section card-block / nav 244 / content max-720 居中 / save bar inner 720 居中 / light），section API 不变（8 调用点零改）。

**Non-Goals:** controller 行为(`settings-controller-boundaries`)；tab 功能逻辑；surface 配色(Phase 0)。

## Decisions

### D1 — SettingsSection 内置 card-block（API 不变）
`SettingsSection` 渲染 caps label(`--fs-micro` uppercase `--ls-caps` `--ink-3`) + 把 children 包进单层 `.card-block`（light token）。**8 处**调用点不改（内部 wrap）。border 当前 `border-border-default` → 映射 V3 `--line-soft`（不是 dark→light swap，本来就是 light）。`.card-block` 样式定义在 `settings-primitives.tsx`（或经 Tailwind utility/`@layer`）。
**理由**：DNA §11「每 section = caps label + card-block」；内置 wrap 避免改 8 处。

### D2 — 视觉容器模型反转（MODIFIED「Settings tab body has at most one visual container layer」+「SettingsSection primitive is the canonical row separator」）
从「tab body ≤1 容器」改为「每 section 单层 card-block（siblings 允许）+ 禁嵌套」。card-block 是 9px radius（< 旧 ≥12px 阈值），但本 phase 显式把模型改写成「per-section card-block」，不靠阈值字面规避。嵌套禁令保留（card-block/SurfaceCard 内不再套 card）。`VaultDirectorySection` 的 SurfaceCard 保留为独立实体（不在 card-block 内）。
**MODIFIED header 纪律**：delta 的 `### Requirement:` 标题逐字沿用 base 原文（match key），body 重写为反转后的完整需求。不在 MODIFIED 下改名；改名走 REMOVED+ADDED。

### D2b — 非冲突 base req 的处理（reconcile vs retain）
- 「Provider tab uses single resolved-product summary line」/「Runtime tab merges defaults and memory groups」：这两条仍含「不在 section 内再套 SurfaceCard / `rounded-[20px]`」的措辞，与 card-block 模型表面相邻 —— 一并 MODIFIED，显式声明「section card-block 本身不是违规，只禁第二层嵌套；sibling card-block 是 V3 norm」，避免它们继续断言旧 flat-row IA。
- 「MCP tab groups configured servers by transport」/「Sticky save bar shows specific disabled and failure copy」/「Settings sub-page content area reserves bottom padding」/「Settings primitives module exports remain backward-compatible」/「Settings tab nav does not render an inner collapse toggle」：与容器模型不冲突（transport 分组、文案分支、reserve、导出兼容、collapse 都是正交关注点），**原样存活，不进 delta**。
- **save bar Retry 契约背离（flag，不固化）**：base「Sticky save bar shows specific disabled and failure copy」req 描述 save bar 内一个 `<button>Retry</button>` + hint region。**代码实际已背离**：`SettingsContentArea.tsx` 用顶部 `<ErrorState variant="banner" ... primaryAction={{ label:'Retry', onClick: handleSave }}>`，save bar 只剩 Save 按钮 + tooltip，无 inline Retry。本 phase 是 restyle，不改 controller / save-error UX → **不去「preserve」一个代码已不实现的 save-bar Retry 契约**；该背离记为 known drift，留给后续 save-UX change 收口（要么把 spec 对齐成 top banner，要么把 Retry 加回 save bar）。本 change 不改这块行为，也不在 delta 里固化旧 Retry-in-bar 措辞。

### D3 — nav 244 + content max-720 + save bar inner 720（MODIFIED「Settings Provider and Runtime use workspace width in release」+ ADDED nav/content req）
`SettingsTabNav` `w-56`→`w-[244px]`。`SettingsContentArea` 内层内容栏 `max-w-[720px]` 居中（nav 不算），外层 scroll 区 + save bar 外层 chrome 占满全宽。save bar inner 控件栏收成 `max-w-[720px] mx-auto`（匹配 prototype `.save-bar-inner`），与上方内容栏对齐。sticky save bar bottom padding reserve 保持。
**桶 8 反转论证**：commit `dbb2bde9` 刻意 drop `max-w-5xl` 让 Provider/Runtime 铺满，base req 因此立「SHALL NOT 全局 max-width 封顶」。V3 反转：Settings 是聚焦配置表单非数据网格，720 居中读栏是刻意构图；Provider 双列 grid（`xl:grid-cols-[340px_minmax(0,1fr)]`）在 720 内仍放得下。因此 MODIFIED 该 req 为「外层占满（无 `max-w-5xl` 旧窄 clamp）+ 内层 720 居中读栏」，二者共存而非二选一。

### D4 — light-only + drop bell
确认无铃铛、无 `--wiz-*`（Phase 0 已 light-only）。

## Risks / Trade-offs

- **SettingsSection 内置 card-block 改变 DOM** → 8 调用点视觉变（每 section 变浅卡），但 API 不变；live 验各 tab 不出现嵌套卡/3 层 border。
- **MCP/Runtime 内已有 SurfaceCard(VaultDirectorySection)** → 确保 card-block 不再套它（VaultDirectorySection 独立，不进 SettingsSection 的 card-block，或其 SettingsSection 不再二次包）。
- **content max-720 与桶 8「workspace width in release」直接冲突 —— 已在本 change 解决（非 apply 时再核）**：桶 8（commit `dbb2bde9`）刻意 drop `max-w-5xl`；720 居中读栏是对它的刻意反转。delta 已 MODIFIED 该 base req 为「外层占满（无旧窄 clamp）+ 内层 720 居中」，二者共存（外层 chrome 占满、内层读栏居中限宽）。论证见 D3。
- **save bar Retry 契约背离** → base「sticky save bar」req 描述 save-bar 内 Retry button，代码实际是顶部 ErrorState banner；本 phase 不改 save-error UX，记为 known drift（D2b），不固化旧措辞、不在 delta 里 preserve。
- controller 行为不动（`settings-controller-boundaries` 独立 capability）。

## Migration Plan

1. `.card-block` 样式 + `SettingsSection` 内置 wrap（light token）。
2. nav 244、content max-720。
3. 核 VaultDirectorySection 不双层；核无铃铛/wiz。
4. 串行 build + live 验。
5. 回滚：primitives + 2 layout 文件，单 commit 可 revert。

## Open Questions

- `.card-block` 落在 `settings-primitives.tsx` inline class 还是 `index.css @layer`（apply 决定，倾向 primitives 内 cn() class）。

（已关闭：content 720 vs 桶 8「workspace width」冲突已在 delta MODIFIED 该 base req 解决，见 D3 / Risks，不再 deferred。）
