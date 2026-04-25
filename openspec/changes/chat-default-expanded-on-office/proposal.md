## Why

进入 Office 时用户的第一动作几乎都是聊天派活，但当前 right rail 在 tablet (≤1280px) 视口默认折叠成一条 44px 竖条，要求用户先点 collapsed bar 再开始打字。空态又被 onboarding 卡片 + starter prompts 顶到屏幕中间，输入框反而被挤到底部小一块——把"直接开聊"挡成了"先穿三道门"。A3 把这两层多余仪式拆掉：首屏即聊。

## What Changes

- **AppLayout right rail tablet 默认展开**：把当前 `useState(() => !initNarrow && !initTablet)` 的初始值改成 `useState(() => !initNarrow)`。Tablet 进 Office 看到展开的 chat，narrow 仍折叠（空间不够）。viewport tier 切换 effect 同步：tier 进 tablet 不再强制 `setRightOpen(false)`。
- **Office 空态低占用**：`ChatPanel` team-chat 空态不再渲染 `EmptyState` 全高布局（boss greeting card + starter prompts + footnote 占满 message area），改成在 message area 底部贴近输入框的轻量 placeholder（一行 hint + 可选 starter prompt chips inline 在 input 上方），message area 上半部分留白，input 立刻可点击。`isDirectChat` 空态保留现有一行小字。
- **Office 首屏首次访问 contract**：首次进 Office（无 localStorage 保存的 `right-open` 偏好）时 right rail 必须展开（desktop+tablet）；之后用户手动 collapse 通过 localStorage 持久化（**新增**：right rail open state 上 localStorage，AppLayout 当前没有持久化）。
- **保留**：`requestRightExpandToken` 自动展开 hook、mobile ChatDrawer 行为、`EmptyState` 组件本身（onboarding/welcome 仍可在别处复用，比如 first-run wizard 关停后第一次进入可以一次性 dialog 而不是常驻 chat 空态）。

## Capabilities

### New Capabilities
- `office-chat-default-presentation`: Office 模式下 chat surface 的默认展开行为（per viewport tier）+ 空态轻量化契约。覆盖 right rail 初始 open state、viewport tier 切换、localStorage 持久化、空态布局规则。

### Modified Capabilities
- `responsive-app-shell`: tablet 视口默认行为补充——right rail（`eventLog` slot）现在默认展开；secondary rails 折叠规则不再统一。

## Impact

- **代码**：
  - `packages/ui-office/src/components/layout/AppLayout.tsx`（right rail 初始 state、viewport tier effect、localStorage persistence）
  - `packages/ui-office/src/components/chat/ChatPanel.tsx`（team-chat 空态分支，Office 不再走 `<EmptyState>` 全高布局）
  - `packages/ui-office/src/components/error/EmptyState.tsx`（保留组件，但 Office team-chat 空态不再调用；可能新增轻量 inline-prompt 子组件或在 ChatPanel 内联）
- **行为兼容**：
  - 已存在 `offisim-chat-open` (mobile drawer) localStorage key 不复用，新增 `offisim-rightrail-open` 给 desktop/tablet right rail——两个状态独立，不串
  - `EmptyStateWelcome` / `StarterPrompts` props 链路保留（`App.tsx` → `CollaborationRail` → `ChatPanel`），但 Office team-chat 空态消费方式简化
- **依赖**：无新依赖
- **验证**：live runtime 三视口（desktop 1440 / tablet 1280 / narrow 390）打开 Office；首次访问 chat 默认展开 + 空态可立即输入；手动 collapse 后刷新仍 collapsed
- **Specs**：`responsive-app-shell` 加 delta（tablet right rail 展开行为）；新建 `office-chat-default-presentation`
- **协议台账**：未触及 A2A/MCP/Tauri/LangGraph/Better Auth/SKILL.md
