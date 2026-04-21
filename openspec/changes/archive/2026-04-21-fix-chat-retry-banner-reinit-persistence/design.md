## Context

当前 web runtime 的失败重试链分成两层：`useRuntimeInit()` 里用 `lastFailedMessageRef` 保留可重试消息元数据，聊天 UI 则直接依赖 `error: string | null` 来决定是否渲染 [ErrorBanner](/Users/haoshengli/Seafile/WebWorkSpace/Offisim/packages/ui-office/src/components/error/ErrorBanner.tsx)。这导致一个错位：runtime reinit 会重建 runtime bundle 和相关 UI 状态，但不会清掉 `lastFailedMessageRef`；结果是“底层仍可 retry，界面却失去 Retry 入口”。

这次 change 只修 retry affordance 的生命周期，不改 provider save 逻辑、不改 direct-chat target 解析，也不引入跨页面持久化。目标范围是同一个页面会话内的 runtime reinit，例如用户在 Settings 修正 provider 配置后返回 Chat。

## Goals / Non-Goals

**Goals:**
- 让失败 run 的可见 retry affordance 跨 runtime reinit 继续存在。
- 让 `Retry` 的展示状态和 `retryLastMessage()` 使用的失败元数据保持同源。
- 保持当前 direct-chat / team-chat retry 语义不变，包括已修好的 run-origin target 绑定。

**Non-Goals:**
- 不把失败态持久化到 localStorage、DB、URL 或跨页面刷新恢复。
- 不重做 `ErrorBanner` 的视觉样式或新增新的错误中心。
- 不修所有可能清掉错误 UI 的路径；本次只覆盖 runtime reinit 导致的丢失。

## Decisions

### 1. 把“失败可重试态”从裸 `error` 文本提升为独立 runtime 状态
`error` 继续表示当前可见错误消息，但 retry 能力需要单独的结构化状态，例如 `failedRunState`，至少包含 `message`、`retryable`、失败时的 send metadata，以及 direct-chat target 相关信息。`ErrorBanner` 是否显示 `Retry` 不再依赖“当前是否刚好还有 error string”，而是依赖这份失败快照是否存在且可重试。

之所以不继续复用 `error`：
- `error` 是瞬态显示值，天然容易在 reinit、dismiss、interaction follow-up 中被清掉。
- `lastFailedMessageRef` 只有 send metadata，没有 banner 文案与展示生命周期。
- 把两者合成一份失败快照，能减少“底层可 retry / UI 不可 retry”的分裂状态。

备选方案：
- 只在 reinit 时保留 `error` string：不够稳，因为仍然把结构化 retry 能力绑在展示文本上。
- 把 retry banner 状态放进 `ChatPanel` 本地 state：会让 runtime hooks 和 UI 各自维护失败快照，源头分裂。

### 2. runtime reinit 默认保留失败快照，只有成功新 run / dismiss /显式替换才清掉
`reinitRuntime()` 的职责是换 runtime bundle，不应被视为“用户放弃这次失败 run”。因此 reinit 不得清空失败快照。允许清理的时机只包括：
- 用户点击 dismiss
- 用户发送一条新的消息，显式替代旧失败 run
- `retryLastMessage()` 或新的 send 成功启动并最终不再需要旧错误展示

备选方案：
- provider save 成功后强制清除旧错误：会复现当前问题，本质上又把 retry affordance 吃掉。
- reinit 时始终保留所有历史失败：会让 banner 长期陈旧，因此本次只保留“当前最后一个可重试失败”。

### 3. ChatPanel 继续只消费 runtime 暴露的单一失败接口
`ChatPanel` 不应自己推断“现在到底还能不能 retry”。runtime context 应直接暴露可见失败快照或至少暴露足够稳定的 `error` + `canRetry` / `failedRunState`。这样 ChatPanel 只负责：
- 渲染 banner
- 调用 `retryLastMessage()`
- 调用 dismiss / swap person / swap model

备选方案：
- 让 ChatPanel 根据 `lastFailedMessageRef` 和 `error` 自己拼：需要额外把 refs 暴露给 UI，破坏封装。

## Risks / Trade-offs

- [失败快照比现在多一层状态] → 用单一 source of truth 替代“error + ref 分裂”，避免更多临时布尔值。
- [reinit 后保留旧错误，可能短暂显示已过时文案] → 仅在成功新 run、dismiss、或明确覆盖时清理；文案允许短暂滞后，但 retry 入口必须可靠。
- [team/direct chat 都共享这套失败快照，回归面会扩大] → spec 和 tasks 都要求 team/direct 两条路径做 smoke，避免只修 direct chat。

## Migration Plan

1. 在 web runtime hook 里引入结构化失败快照，并让 `retryLastMessage()` / dismiss / new send 统一维护它。
2. 通过 runtime context 把失败快照或其派生信息暴露给 Chat UI。
3. 调整 ChatPanel / ErrorBanner 使用新的失败接口，确保 reinit 前后 `Retry` 可见性一致。
4. 做 web live verify：失败 -> 修 provider -> reinit -> Retry 仍可见 -> 点击后沿原 run 继续。

## Open Questions

- `swap person` / `swap model` 是否也应跨 runtime reinit 一并保留，还是本次只保证 `Retry` 主动作保留。
- 成功重试后是立即清空旧失败 banner，还是等新的 run 明确进入非失败状态后再清。前者更简单，后者视觉更平滑。
