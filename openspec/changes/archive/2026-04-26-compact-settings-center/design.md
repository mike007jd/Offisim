## Context

Settings workspace 当前由 `SettingsWorkspaceSurface.tsx`（213 行 barrel）+ 4 个 controller hook + 4 个 tab 组件构成：

| Tab | 文件 | 行数 | 当前容器结构 |
|-----|------|------|-------------|
| Provider | `SettingsProviderTab.tsx` | 293 | 4× SurfaceCard + 1 手写 inner card |
| Runtime | `SettingsRuntimeTab.tsx` | 294 | 5× SurfaceCard + VaultDirectorySection |
| MCP | `McpConfigPanel.tsx` | 424 | 2× ui-core/Card 嵌在外层 SurfaceCard 内（4 层 border） |
| External | `SettingsExternalTab.tsx` | ~309 | ul/li 扁平 |

主要 cards-in-cards 违例（已盘查到的具体行号）：
- `SettingsProviderTab.tsx:82-92` — SurfaceCard 包 `div.rounded-[20px]` 手写"Resolved product"内层卡（**3 层**：SurfaceCard 外 24px 圆角 + 内层 20px 圆角 + 文字 group）
- `SettingsProviderTab.tsx:111-208` 与 `:210-289` — "Advanced Routing" 标题在左右两栏各出现一份，重复 SurfaceCard
- `McpConfigPanel.tsx:256-340` 与 `:344-415` — 两张独立 ui-core/Card，外层在 `SettingsWorkspaceSurface.tsx` 还套了一层 SurfaceCard（**4 层 border**）

Sticky save bar 在 `SettingsContentArea.tsx:43-65`，依赖 `controller.hasUnsavedChanges` + `isSaveDisabled`；**仅 Provider + Runtime tab 走 onSave 上报**，MCP / External tab 各自管 state（MCP 走 localStorage 自管，External 走 row-level inline mutation）。

约束 / SSOT：
- `panel-and-dialog-sizing` Requirement "Touched surfaces have at most one visual container layer inside the shell" 已经包含 "main app shell workspace center" 的总则（Scenario "Main shell workspace center has no outer wrapping card"），但没有 Settings 子页 body 的专属 scenario
- `settings-controller-boundaries` Requirement "SettingsWorkspaceSurface barrel is thin" 限制 `SettingsWorkspaceSurface.tsx` ≤ 180 NBNC 行（当前 213，本来就超）
- 现有 `SurfaceCard` primitive 在 `settings-primitives.tsx:3-36`，`section.rounded-[24px].border.bg-slate-950/45`

## Goals / Non-Goals

**Goals:**

- 4 个 Settings tab 的 body 都 ≤ **1 层** "visual container"（=  border + bg + 圆角的盒子）；`SettingsSection` 段分隔不算 visual container（仅顶部分割线 + heading）
- Provider tab 删 "Resolved product" 内层手写卡 + 删 "Advanced Routing" 重复出现
- Runtime tab 5 SurfaceCard → 2 SettingsSection（"Runtime defaults" 包 execution mode / default model / employee runtime default / tool permission；"Conversation memory & summarization" 包 memory + summarization）
- MCP panel 两张 ui-core/Card → 直接 SettingsSection；外层不再套 SurfaceCard；server 列表按 transport 分组
- Sticky save bar disabled 状态文案具体（"No changes to save" / "Saving…" / 保存失败时显错误 + Retry 入口）；External tab 维持隐藏（无 dirty 概念）
- 1440x900 一屏看到 Provider 全部字段；Runtime 至少 4 段；MCP 至少 3 个 server 不滚动
- tab 切换 height 不跳（要么 sticky save bar 占据稳定 footer 位、要么 content 内部滚）
- `SettingsWorkspaceSurface.tsx` 重排后仍 ≤ 180 NBNC 行（不放宽既有 gate）

**Non-Goals:**

- **不动 controller 拆分**（4 hook 单一职责契约保持）
- **不动 MCP 自管 state 与 save bar 的 wiring**（MCP changes 不经 onSave 上报是 pre-existing inconsistency；用户没指明要解决，且解决要触 controller 与 schema，scope 远超 H1）
- **不动 provider product taxonomy 数据层**（`provider-product-taxonomy.ts` / `provider-presets.ts` 的 product 列表不重排，本 change 只重排 UI 呈现）
- **不动 External tab 的 list row schema**（F1 已收口；本 change 仅 row 圆角对齐）
- **不引入新 dependency**；`SurfaceCard` 不删除，只收紧 usage
- **3D / Office workspace 不动**

## Decisions

### Decision 1: 新建 `SettingsSection` primitive 代替"任意段都套 SurfaceCard"

**选择**：在 `settings-primitives.tsx` 加 `SettingsSection({ title, description, children, action? })`，渲染为：

```
<section class="space-y-3 border-t border-white/5 pt-6 first:border-t-0 first:pt-0">
  <header class="flex items-baseline justify-between gap-3">
    <div>
      <h3 class="text-sm font-semibold tracking-wide text-white/90 uppercase">{title}</h3>
      {description && <p class="text-xs text-white/55">{description}</p>}
    </div>
    {action}
  </header>
  <div class="space-y-3">{children}</div>
</section>
```

**Why over 继续用 SurfaceCard**：SurfaceCard 是 24px 圆角 + bg-slate-950/45 + border 的 visual container；把每段都套一份会产生 4-5 个并列容器矩阵，违背 UX overhaul 原则 7（cards-in-cards）。SettingsSection 是 row separator + heading（无 border / bg / 圆角），同等级段落水平铺，靠顶部分割线与段标题区分，宽屏自然密度更高。

**保留 SurfaceCard 的场合**：仅当一段配置代表"独立配置实体"且需要视觉强调（例：External tab 顶部 "Connect agent" 高亮 CTA 区，或 Settings → MCP "Configured Servers" 整组列表的 collapsible 边框可保留 1 层）。SurfaceCard 禁止嵌套自身。

**Alternative considered**：直接用 `<details>` HTML element 折叠每段——拒绝，理由：用户希望"一屏看到更多"，折叠会增加点击成本；且折叠收起后 sticky save bar 与内容的位置关系会跳变。

### Decision 2: Provider tab 双栏紧凑

**选择**：保留 `xl:grid-cols-[340px,minmax(0,1fr)]` 双栏布局；左栏 = product picker + access mode chip 选择器（合并），右栏 = 当前选中 product 的字段表单（API key / endpoint override / default model / default headers / execution lane）。"Resolved product" 改为右栏顶部 inline summary 行（一行文字 + 一个 tone chip，**不再是 card**）。"Advanced Routing" 不再左右各一份，整合到右栏底部一段 SettingsSection。

**Why**：当前左栏只有 product 选择，右栏只有"Resolved product"卡 + 表单 + Advanced Routing；信息密度低且 Advanced Routing 重复。合并后左栏纯导航、右栏纯表单，符合 IDE-style settings convention。

**Trade-off**：narrow viewport（< xl）会变成单列堆叠，"Resolved product" inline summary 行可能被推到字段表单中间——验收时确认 narrow tier 下顺序：product picker → resolved summary → fields → advanced routing。

### Decision 3: Runtime tab 5 SurfaceCard → 2 SettingsSection

**选择**：

- `SettingsSection "Runtime defaults"` 包：execution mode (Select) + default model (Input) + employee runtime default (RuntimeBindingControl scope=company) + tool permission（Select 或 chip group）。字段用 `md:grid-cols-2 xl:grid-cols-3` 排版，密集网格。
- `SettingsSection "Conversation memory & summarization"` 包：memory（4 字段 grid）+ summarization（3 字段 grid），用 H4 子标题区分子组。
- VaultDirectorySection 保持独立（它是 desktop-only 系统区，逻辑独立，留 SurfaceCard 1 层）。

**Why over 保留 5 个 SurfaceCard**：5 张 24px 圆角并列容器在 1440x900 占满首屏只露出 2 张；合并为 2 段后宽屏一屏可见 4-5 段（含 VaultDirectorySection）。

**Trade-off**：合并后 "Runtime defaults" 段略长（4 字段组），可能在 narrow tier 出现纵向爬行；接受，因为 Runtime tab 本身预期不是高频日常调整页面，narrow 优先级低。

**风险**：employee runtime default control（C2 加的 `RuntimeBindingControl scope="company"`）依赖 `availableEngineAdapters` + helper copy "Available on trusted desktop runtime"；移到密集 grid 内时要确保 helper copy 不被截断（用 `col-span-full` 或 `lg:col-span-2`）。

### Decision 4: MCP 子页按 transport 分组 + 删 ui-core/Card 包装

**选择**：

- 删 `McpConfigPanel.tsx` 内的两张 `ui-core/Card`，改用 SettingsSection
- 删 `SettingsWorkspaceSurface.tsx` 在 MCP tab 外层套的 SurfaceCard
- "Configured Servers" 列表按 `server.transport` 分组（stdio / sse / http），每组顶部一行 chip 标识 transport + count；组内 server row 用 flat list（无 card），row 高度紧凑（avatar 32px + name + status badge + Reconnect/Delete icon button）
- "Add MCP Server" 改为顶部一行 inline form（transport 选择器 + name + URL/command 输入 + Add 按钮），不再独占一段 card

**Why over 保留 Card 嵌套**：当前 4 层 border 是最严重的 cards-in-cards 违例；transport 分组也符合用户原话"按 server / rack / permission 分组"。rack/permission 在当前 schema 不直接表达（PRD v1.6 提到 "Rack/Slot MCP" 但 schema 层是 server-flat），本 change 不引入新 schema，rack/permission 留作未来 follow-up。

**风险**：MCP server 列表 re-render 时 `key={server.id}` 必须稳定（已确认 schema 有 `id` 字段）；transport 分组导致 server 顺序与原列表不同，要确认 add/remove/reconnect 操作不会因为 key 变化触发 unmount 闪烁。

### Decision 5: Sticky save bar disabled 状态文案 + Retry 入口

**选择**：扩 `SettingsContentArea.tsx:43-65` 的 disabled 文案分支：

| 状态 | 按钮文案 | title (tooltip) | 旁边 hint |
|------|---------|----------------|----------|
| 无变化 | `Save changes` | `No changes to save` | — |
| 有变化 | `Save changes` | `Save provider + runtime changes` | — |
| 保存中 | `Saving…` | (disabled) | `Reinitializing runtime` (在 reinitializing 阶段) |
| 保存失败 | `Save changes` | `Save failed — retry` | `<error msg>` + 一行 `<button>Retry</button>` 复用同 `handleSave` |

**Why**：当前 disabled tooltip 模糊（仅 "No changes to save"），保存失败后只在 SurfaceCard 内显错误文字 + Save 按钮重试不直观。Retry 按钮入口让用户在 sticky bar 上一眼看到失败状态 + 重试，无需滚回字段。

**External tab**：维持隐藏 save bar（`activeTab !== 'external'` 已有 gate），不变。

### Decision 6: 容器层级守门用静态 grep + live verify 双保险

**选择**：

- 静态 grep gate 入 tasks.md verify section：`grep -rE 'rounded-\[2[04]px\]|<SurfaceCard' packages/ui-office/src/components/settings/` 输出条目数 ≤ 阈值（具体阈值在 tasks 里定）
- live verify：1440x900 截 4 个 tab 的全屏图，目测无双层圆角嵌套 + 无并列大于 2 个的 SurfaceCard

**Why**：spec scenario 用 "at most 1 visual container per tab body" 是契约，但 grep 是机械化 falsification。两道关减少回归风险。

## Risks / Trade-offs

- **Risk**: 把 5 张 SurfaceCard 合 2 张可能让 Runtime tab 单段过长 → **Mitigation**: SettingsSection 内允许 H4 子标题再分小组，但禁止再加 border/bg/圆角层
- **Risk**: MCP 子页 transport 分组改写触发 server 列表 re-render，可能因 key 变化出现 unmount 闪烁 → **Mitigation**: 强制 `key={server.id}` 不变，分组只改渲染顺序不改 key
- **Risk**: Sticky save bar Retry 按钮在保存失败时复用 `handleSave` 可能与 reinit 5s timeout 状态机冲突（保存中 + reinit 期间用户连点 Retry） → **Mitigation**: Retry 按钮 disabled 当 `isSaving || isReinitializing`
- **Risk**: SettingsWorkspaceSurface.tsx 当前 213 行，重排后可能略减但不一定能压到 180 → **Mitigation**: 把 4 个 tab 的 props 透传逻辑提到 sub-helper（如 `getTabBodyProps(activeTab, controller)`），或确认 213 中有可压缩的 inline 注释 / 死分支；最坏情况切一个 `SettingsTabRouter` 子组件
- **Risk**: narrow viewport (< 1280) 下 Provider 双栏堆叠后 "Resolved product" inline summary 出现位置可能让用户困惑 → **Mitigation**: narrow tier 下把 "Resolved product" 改为 picker 下方一行，而非字段表单顶部
- **Trade-off**: 不解决 MCP changes 不走 save bar 的 pre-existing 问题——本 change 留作 follow-up，记入 archive 时的 followup observation
- **Trade-off**: Settings → MCP 的 "rack / permission" 分组按用户原话是 scope，但当前 schema 不表达 rack/permission；只做 transport 分组，rack/permission 留 follow-up（可能与 PRD v1.6 提到的 "Rack/Slot MCP" 冲突，需先审 MCP schema）

## Migration Plan

按 tasks.md 顺序：先建 primitive、再 4 tab 各自改写、最后 sticky bar 文案 + live verify。每步独立可回滚（git revert 单 commit）。无 schema 改动，无数据迁移。

## Open Questions

1. **MCP "rack / permission" 分组**：用户原话提到 server / rack / permission 三类分组，当前 MCP schema 仅 transport / server 维度。本 change 只做 transport 分组，rack/permission 是否要同 change 内做？建议：先 transport 分组 + transport 内 server 平铺，rack/permission 留独立 change（需先审 PRD v1.6 "Rack/Slot MCP" schema）。
2. **External tab 是否也走 SettingsSection 重排**：当前 ul/li 扁平已经够紧凑，不确定是否需要重排。建议：仅 row 圆角与新 SettingsSection 视觉对齐（li `rounded-md` → `rounded-lg`，与 SurfaceCard 24px 拉开层级），不动 list 结构。
3. **Sticky save bar Retry 按钮位置**：放 sticky bar 内（与 Save 按钮并列）还是错误文字下方一行？建议：错误文字下方一行 `<button class="text-cyan-300 underline">Retry</button>`，避免 sticky bar 内多个 CTA 让用户犹豫。
