## Why

V3 设计稿把 Settings 定为：左 nav 244px、右 content 内部 max-width 720px（宽屏不铺满，居中读栏）、每 section = caps label + `.card-block`（`--line-soft` border + `--surface-1` + `--r-md` + `--elev-1` + 16px pad）、drop bell、Settings 非 wizard（全 light 不用 `--wiz-*`）。当前 nav 是 224px(`w-56`)、content 不限宽（commit `dbb2bde9` 桶 8 已 drop `max-w-5xl`，宽屏铺满）、section 用 `SettingsSection`（**无 border/bg/radius 的 bare 顶部分割线**，border token 实为 light `border-border-default`，**不是** dark `border-white/5`）。V3 的 card-block 与现有「SettingsSection 是 canonical row-separator + 每 tab ≤1 视觉容器」直接冲突 —— 这是刻意的视觉模型反转（flat dividers → 每 section 一个浅卡）。720 居中读栏与桶 8「Provider/Runtime use workspace width / 无 max-width 全局封顶」也直接冲突，是第二处刻意反转。Phase 5 把 Settings 重做成 V3。依赖 Phase 0 token。

## What Changes

- **section 模型反转 → card-block**：`SettingsSection` 从 bare 顶部分割线改为「caps label + 把 children 包进单层 `.card-block`」（`--line-soft` border + `--surface-1` + `--r-md`(9px) + `--elev-1` + 16px pad，相邻 section gap `--sp-3`）。border token 当前已是 light `border-border-default`，V3 映射到 `--line-soft`（**没有** dark→light token swap，本来就是 light）。
- **「≤1 视觉容器」模型更新**：从「每 tab body ≤1 个 SurfaceCard」改为「每 section 是单层 card-block（siblings 允许），但**禁止嵌套**（card-block / SurfaceCard 内不再套 card）」。`VaultDirectorySection` 的 `SurfaceCard` 仍是允许的独立实体（不在 card-block 内再套）。
- **content 宽度反转 → 720 居中读栏**：桶 8 drop `max-w-5xl` 让 Provider/Runtime 铺满；V3 反转为「外层占满（无全局 max-width 封顶）+ 内层 720 居中读栏」。同步 MODIFIED base「Provider/Runtime use workspace width in release」req（论证反转：V3 是聚焦表单非数据网格，720 居中读栏是刻意构图，Provider 双列 grid 仍能在 720 内放下）。
- **nav 244px**：`SettingsTabNav` `w-56`(224) → 244px。
- **content max-width 720**：`SettingsContentArea` scroll 容器内部 max-w 720 居中（nav 不算），宽屏不铺满。
- **sticky save bar 保持 + inner 720 居中**：在 `SettingsContentArea`、External tab 隐藏、文案分支不变、bottom padding reserve 保持。prototype `.save-bar-inner` 是 `max-width:720px; margin:0 auto`（居中），与上方内容栏对齐；外层 chrome（border-top + bg + footer pad）占满全宽，inner 控件栏 720 居中。当前 save bar 是全宽（commit `dbb2bde9`），需把 inner 收成 720 居中匹配 prototype。
- **drop bell + light-only**：已确认 Settings 无铃铛、无 `--wiz-*`（grep 验证，全 light，Phase 0 已 light-only）。

**不在范围**：settings controller 行为（脏追踪/save/reinit/toolPermissions —— `settings-controller-boundaries` 不动）；MCP/Provider/Runtime 的功能逻辑；surface 配色（Phase 0）。

## Capabilities

### Modified Capabilities
- `settings-workspace-presentation`: 5 个 MODIFIED req（header 全部沿用 base 原文）+ 1 个 ADDED req。
  - MODIFIED「Settings tab body has at most one visual container layer」：从「每 tab body ≤1 个 SurfaceCard」反转为「每 section 是单层 card-block（siblings 允许）+ 禁嵌套」。
  - MODIFIED「SettingsSection primitive is the canonical row separator」：从 bare 顶部分割线改为 caps label + 单层 card-block（light token；border 实为 `border-border-default` → `--line-soft`，无 dark token swap）。
  - MODIFIED「Provider tab uses single resolved-product summary line」：保留「禁第二层嵌套卡（旧 `rounded-[20px]`）」，但显式说明 section card-block 本身不是违规。
  - MODIFIED「Runtime tab merges defaults and memory groups」：sibling card-block 是 V3 norm，不算「额外 SurfaceCard」违规；保留「section 内禁套卡」。
  - MODIFIED「Settings Provider and Runtime use workspace width in release」：反转桶 8「无 max-width 封顶」→「外层占满 + 内层 720 居中读栏」，论证反转理由。
  - ADDED「Settings left nav SHALL be 244px and content SHALL cap at 720px」：nav 244 + content 内层 720 居中 + save bar inner 720 居中（匹配 prototype）。
  - **不动**：MCP transport 分组 / flat row、sticky save bar 文案分支、bottom padding reserve、primitives 向后兼容导出、SettingsTabNav 无 collapse toggle —— 这些 base req 与 card-block 模型不冲突，原样存活。

## Impact

- 代码：`settings-primitives.tsx`（`SettingsSection` → card-block；`.card-block` 样式）、`SettingsTabNav.tsx`（nav 244）、`SettingsContentArea.tsx`（content max-720 居中 + save bar inner 720 居中 + reserve 保持）、各 tab（Provider/Runtime/MCP）随 SettingsSection 自动获得 card-block（若 SettingsSection 内置 wrap 则 tab 无需逐个改）。
- blast radius：`SettingsSection` 改内部 wrap → **8 处调用点**无需改（API 不变）。8 处 = Provider×2（`SettingsProviderTab.tsx`）+ Runtime×3（`SettingsRuntimeTab.tsx`：Runtime defaults / Main harness control / Conversation memory & summarization）+ SceneDiagnostics×1（`SceneDiagnosticsSection.tsx`）+ MCP×2（`McpConfigPanel.tsx`：Add server / Configured servers）；外加 1 处定义。`SurfaceCard` 仅 `VaultDirectorySection` 用（保留）；`settings-controller-boundaries`（脏追踪/save/toolPermissions）不动。
- 验收 gate：typecheck + 串行 build；release `.app` live 验：nav 244 / content 居中 max-720 / save bar inner 720 居中 / 每 section 浅 card-block / 无嵌套卡 / reserve / 无铃铛 / 全 light。
