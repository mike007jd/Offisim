## Context

Office shell 双轨状态：
- **Right rail open state** 在 `AppLayout.tsx` 内 `useState`，依据 `MOBILE_BREAKPOINT (≤768)` + `TABLET_BREAKPOINT (≤1280)` 两个 mediaQuery 决定初始值。当前规则：desktop 开 / tablet 折 / mobile 折。无 localStorage 持久化——刷新或 viewport tier 跳变都会重置。
- **Chat empty state** 在 `ChatPanel.tsx` `showEmpty` 分支里：team-chat 空态走 `<EmptyState>`，渲染 boss greeting card + starter prompts + 一行 footnote，整体 `flex-1` 顶满 message area；input 一直在最下面 `<ChatInput>`。

A3 要解决的实际症状：
1. 用户在 1280×800 笔记本（最常见的 tablet tier 边界）打开 Office，右边是 44px 的 collapsed bar，必须先点开才能聊天。
2. 即便是 desktop 已展开，空态把 boss 寒暄卡 + 三个 starter prompt 顶到中央，输入框被挤到底部一小块；视觉重心错位，"打字"不像首位动作。

A2 (`fix-header-ia-and-popover`) 刚把 header overflow popover 切到 Radix `DropdownMenu`，证明既有 `ui-core` 原子能用就用、不要手写——A3 沿用同思路：localStorage 持久化用最小可靠 try/catch，不引入额外 store。

## Goals / Non-Goals

**Goals:**
- 首次进入 Office（任意 desktop/tablet viewport，无 localStorage 偏好）时 chat surface 默认展开，输入框立即可点
- Tablet (`769 ≤ w ≤ 1280`) 进 Office 不再把 right rail 折叠成 collapsed bar
- 团队聊天空态不再用 `EmptyState` 全高布局占据 message area；改成消息区留白 + input 上方一行 inline placeholder + starter prompt chips（如有）
- 用户手动 collapse 后刷新仍保持 collapsed（持久化）；viewport tier 跳变（resize tablet ↔ desktop）不强制重置 user preference

**Non-Goals:**
- 不动 mobile (`≤768`) ChatDrawer 行为
- 不动 `EmptyState` 组件本身（仍保留给可能复用：first-run welcome dialog / 其他 surface）
- 不动 `requestRightExpandToken` 自动展开 hook（direct chat 选员工时已经有效）
- 不重构 `RightSidebar` Tabs (`Chat | Tasks`) 内部；A3 只管 right rail 整体 open/collapse + ChatPanel 空态
- 不调整 left rail (`agentPanel`) 默认折叠行为

## Decisions

### 1. Right rail 默认 = "非 narrow 即展开"
**选择**：`useState(() => !initNarrow)`，去掉 tablet 判断；viewport tier 切换 effect 同步——`mode === 'tablet'` 不再 setRightOpen(false)。

**Why**：office 的核心交互入口就是 right rail chat。tablet 视口空间够（>768px），让出 ~440px 给 chat 不会挤掉 scene canvas（scene 在背后绝对定位 z-0，rail 是 overlay）。spec `responsive-app-shell` 的"tablet MAY collapse secondary rails"——"MAY" 给空间，不是硬约束。

**Alt 考虑**：(a) 所有 tier 都默认展开包括 mobile——pass，mobile 视口 right rail 440px 会盖死整个屏幕；(b) Tablet 默认折但加显眼的"打开 chat"按钮——pass，A3 的产品诉求就是首屏即聊，不要再加一道点击。

### 2. localStorage 持久化 right rail open
**选择**：新增 `offisim-rightrail-open` key，`AppLayout` 内 `useState(() => readStoredOrDefault())`，`setRightOpen` 包一层 sync 到 localStorage。viewport tier 切换 effect **优先读 localStorage**，没有再 fallback default。

**Why**：用户手动 collapse 后跨 session 保留偏好。和 A2 chat-streaming-ux 不冲突（那是消息流；这是布局）；和 mobile drawer 的 `offisim-chat-open` 是两个独立 surface，不复用 key。

**Alt 考虑**：(a) sessionStorage——pass，跨刷新就丢，体感等于无持久化；(b) workspace session state 走 `useWorkspaceSessionState`——overkill 且 right rail 是 layout 而非 workspace 状态，跨 workspace 的 office 都该一致。

### 3. 空态：低占用 inline placeholder
**选择**：`ChatPanel` team-chat 空态 (`showEmpty && !isRunning && !isDirectChat`) 不再渲染 `<EmptyState>`。改为：
- message area 渲染轻量 placeholder（一行 hint：`Message your team to start.`），居中靠下贴近 input；上半留白（`flex-1` 占位但内容压缩）
- starter prompts（如有）作为 chip 行 inline 在 input 上方（在 `ChatPanel` 内 `showEmpty && starterPrompts && !isDirectChat` 分支渲染，挂在 input 上方 `shrink-0` 区域）
- 不再渲染 onboardingWelcome card；该卡未来可移到 first-run wizard onboarding 完成后的一次性 banner（A3 不做，仅删除当前 chat 空态调用点）

**Why**：产品方向是首屏即聊。Onboarding welcome card 占据视觉中心 → 输入被边缘化，违反"过程即价值"中"系统让用户立刻能干预"。Starter prompts 不删掉，但下沉到 input 上方一行 chip——既给路标又不抢位。

**Alt 考虑**：(a) 完全移除 starter prompts——pass，它对新用户仍有价值，只是位置该让；(b) 全删空态文案 input placeholder 自承担——pass，用户没启动 boss 之前看不到任何指引会茫然；(c) 保留 EmptyState 但缩小高度——pass，治标不治本，UI 复杂度不变。

### 4. EmptyState 组件保留但 Office 不再调用
**选择**：`EmptyState.tsx` 不删，仅 `ChatPanel.tsx` 不再调用。`onboardingWelcome` / `onboardingStarterPrompts` props 在 `ChatPanel` 内只有 `starterPrompts` 仍消费（→ inline chip row）；`onboardingWelcome` 在 ChatPanel 不再使用。

**Why**：保留可选未来复用。`CollaborationRail` → `ChatPanel` props 链不破坏（避免大批 cascading 改动）；`App.tsx` 传 props 也无需改。

**Alt 考虑**：删 props 链上 `onboardingWelcome`——pass，跨包 surface 改动太大，A3 scope 不值得；保留接口、内部不消费即可。

### 5. localStorage read/write 错误兜底
**选择**：复用既有 `ChatDrawer` 模式：try/catch 包 read & write，失败 fallback 默认值；不抛错。

**Why**：private mode / Tauri sandboxed webview / disabled storage 历史上都遇过；ChatDrawer 已经验证此模式可用。

## Risks / Trade-offs

- **[Risk] tablet (1280px wide) 同时展开 left+right rail 会挤 center scene canvas**
  → Mitigation：scene canvas 是 `absolute inset-0 z-0` 背景层，rail 是 overlay，center scene 视觉不会被压缩；且 left rail 在 tablet tier `setLeftOpen(true)`、right rail 现在也展开，center 中间的 main 区域会变窄但 scene canvas 物理像素不变。验证时确认 scene 关键 widget（meeting bubble / employee positions）在 1280×800 没被两边 rail 盖死。

- **[Risk] 空态删除 onboardingWelcome 渲染对 first-run 用户损失温度**
  → Mitigation：A3 只动 chat 空态调用点；first-run welcome 在 wizard 落幕后是否要单独一次性 dialog 是另一条 change（不在 A3 scope）。当前 A3 后 first-run 用户仍看到 starter prompts chips（向下沉），不算彻底没有指引。

- **[Risk] localStorage 持久化跨 viewport tier 反直觉**：用户 desktop 关 → 笔电 1280 打开还是关
  → Mitigation：这是用户 explicit preference，预期就该跨 session 保留。viewport tier 跳变不动 user preference 是 decision 2 的明确选择；如果 product 后续想"tier 跳变重置"再做小 change。

- **[Trade-off] starter prompts 从中央 prominent CTA → input 上方 chip**：visibility 下降
  → 接受：产品诉求里"空态不占大块无意义空间"明确高于 starter prompt 显眼度；且 chip 行仍在视觉路径上（紧贴 input）。

- **[Risk] AppLayout localStorage 读早于 SSR / hydration mismatch**
  → 当前项目纯 SPA（vite + Tauri），无 SSR；`useState(() => ...)` lazy initializer 在 client mount 时跑，读 localStorage 安全。无 mitigation 需要。

## Migration Plan

无 data migration。纯前端 layout state + localStorage 新 key。已存 `offisim-chat-open` 不复用、不迁移。

回滚：revert commit 即可，无 schema/migration 链。

## Open Questions

- 空态 inline placeholder 文案最终敲定（"Message your team to start." 还是更轻的 "Type to begin..." 或不写文字仅靠 input placeholder）—— apply 阶段对照 A2 的 UI 文案密度原则（"删除营销文案、不要重复展示同一信息"，input placeholder 已经写了 "Message your team..."，message area 可能根本不需要再说一遍）。倾向 **不写 message area 文案，仅留白 + starter chip row**。
- starter prompts 在 input 上方 chip 行：是否在 `isDirectChat` 也显示？倾向不（direct chat 已是明确目标，starter 是 team-chat 入口的发现性辅助）。
