## Why

Settings workspace 把 4 个子页（Provider / Runtime / MCP / External）都用 `SurfaceCard`（24px 圆角 border 容器）平铺；Provider tab 还在 SurfaceCard 内手写第二层 `rounded-[20px]` 内卡（"Resolved product"），MCP 子页把 `ui-core/Card` 嵌在 SurfaceCard 内构成 4 层 border 嵌套，Runtime tab 5 张同等级 SurfaceCard 占满首屏却只能露出 2 张。结果：宽屏一屏看不到几条有效配置、容器层级不一致、违背 UX overhaul 第 7 条原则（"UI 禁止 cards 套 cards；稳定 shell、固定 panel、明确层级"）。本 change 对照图 10 收口 H1。

## What Changes

- **新增 Settings 二级 IA primitive `SettingsSection`**（替代当前 4 子页直接堆 `SurfaceCard` 的写法）：纯 row separator + heading + 内容区，不再为每段加 24px 圆角 border，而是用顶部分割线 + 段标题划分；SurfaceCard 仅在需要"高亮一段独立配置实体"时使用，且禁止嵌套。
- **删 cards-in-cards 嵌套**：
  - Provider tab 的 "Resolved product" 内层手写 `rounded-[20px]` 卡 → 降级为同级 SettingsSection 第一段或顶部 inline summary 行
  - MCP panel 内的两张 `ui-core/Card`（"Add MCP Server" / "Configured Servers"）→ 直接铺成 SettingsSection，外层不再额外包 SurfaceCard
- **Provider 子页双栏紧凑化**：左栏 product/access 选择器（保留）+ 右栏只展示当前 product 必要字段；删除"Advanced Routing" 重复出现（左右各一份）的双 SurfaceCard，改为右栏底部一段 collapsible 区。
- **Runtime 子页表单合并**：execution mode / default model / employee runtime default / memory / summarization / tool permission 从 5 个 SurfaceCard 折成 2 个 SettingsSection（"Runtime defaults" 一段 + "Conversation memory & summarization" 一段），表单字段用密集 grid（`md:grid-cols-2 xl:grid-cols-3`）排版，不再每个字段单独配 SurfaceCard。
- **MCP 子页按 transport 分组**：当前所有 server 平铺改为按 transport（stdio / sse / http）分组小标题；每个 server row 减少说明文字密度（label `text-[11px] uppercase tracking-wide`，placeholder 提示一句即可），rack/permission 状态以 inline chip 表达。
- **Sticky save bar 行为对齐**：保留 SettingsContentArea 底部 sticky bar；明确 `pb-28` 内容区 padding 在所有子页生效（含 External 子页 placeholder），并要求 disabled 状态文案具体（"No changes to save" / "Saving…" / 错误时显错误文案 + Retry 按钮入口）。
- **External Employees 子页**保持 F1 之后的现状（唯一外部接入入口），仅顺路把列表 row 圆角与新 SettingsSection 风格对齐。
- **不在本 change 范围内**：MCP changes 经由 onSave 上报到 SettingsContentArea（当前是 MCP 自管 state + localStorage，未通过 save bar），Provider product taxonomy 数据层调整，runtime controller hook 拆分。这些是独立 change。

## Capabilities

### New Capabilities

- `settings-workspace-presentation`: Settings workspace 视觉 IA 契约——SettingsSection vs SurfaceCard 使用边界、容器嵌套深度上限、子页布局密度规则、sticky save bar 与内容区共存契约、disabled 状态文案要求。

### Modified Capabilities

- `panel-and-dialog-sizing`: 现有 spec 在抽象 Requirement "Touched surfaces have at most one visual container layer inside the shell" 提到 "main app shell workspace center"，但只给了 Office / SOP / Market / Activity / Settings 一句概括 + 没有 Settings 专属 scenario。本 change 把 Settings tab body 的容器层级上限明确化（每个 Settings tab body ≤ 1 层 SurfaceCard / SettingsSection 不算 visual container）。新增 1 条 Requirement 覆盖 sticky save bar 在 workspace surface 上的内容预留契约。

## Impact

- **代码**：
  - `packages/ui-office/src/components/settings/settings-primitives.tsx`（新增 `SettingsSection` primitive，保留 `SurfaceCard` 但收紧使用约束）
  - `packages/ui-office/src/components/settings/SettingsProviderTab.tsx`（重排双栏 + 删内层 card）
  - `packages/ui-office/src/components/settings/SettingsRuntimeTab.tsx`（5 SurfaceCard → 2 SettingsSection 合并）
  - `packages/ui-office/src/components/settings/McpConfigPanel.tsx`（按 transport 分组 + 文字降噪 + 删 ui-core/Card 包装）
  - `packages/ui-office/src/components/settings/SettingsExternalTab.tsx`（list row 风格对齐）
  - `packages/ui-office/src/components/settings/SettingsContentArea.tsx`（sticky bar disabled 文案 + Retry 入口）
  - `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx`（轻微重排，保持 ≤180 行）
- **API / 数据层**：不动。Provider config / runtime policy / MCP server schema / external employee schema 全保持。MCP 仍走自管 state + localStorage（不在本 change 解决）。
- **canonical spec**：新建 `settings-workspace-presentation`；扩 `panel-and-dialog-sizing`。`settings-controller-boundaries` 不动 spec，但 tasks.md 要明确加一项 verify SettingsWorkspaceSurface.tsx 重排后仍 ≤180 NBNC 行（现有 spec gate）。
- **依赖 / 构建**：无新依赖。`SurfaceCard` 不删除，只是收紧 usage。
- **风险**：(1) 把 5 张 SurfaceCard 合 2 张可能让 Runtime tab 单段过长，需 SettingsSection 内允许再分小标题（但禁止再加边框/圆角层）；(2) MCP 子页 transport 分组改写会触发 server 列表 re-render，要确认 `serverId` key 稳定；(3) sticky save bar 在 External tab 当前隐藏，统一规则后要明确 External tab 是不是也要永远没有 save bar（按 F1 现状是 "External 子页全 inline 操作，无 dirty 概念"，保留隐藏）。
- **验收**：对照图 10，无多层 card 套 cards；1440x900 一屏看到 Provider 全部字段 / Runtime 至少 4 段、MCP 至少 3 个 server 不滚动；sticky save bar 不遮挡内容、disabled 状态文案具体；tab 切换 height 不跳。
