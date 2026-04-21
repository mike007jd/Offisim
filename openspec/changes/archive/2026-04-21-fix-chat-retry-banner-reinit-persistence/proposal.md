## Why

2026-04-21 的 web live verify 暴露了一个真实 UX 断层：direct chat 失败后虽然 `lastFailedMessageRef` 仍然保留，runtime reinit 一发生，聊天区可见的 `Retry` banner 就消失了。这样用户刚修好 provider 配置，也失去了继续同一失败 run 的直接入口，必须依赖调试桥或手动重发。

## What Changes

- 保持聊天失败态的 retry affordance 跨 runtime reinit 可见，直到用户显式 dismiss、成功重试，或发送一条新的消息替代它。
- 把“失败 run 的可重试元数据”从易丢失的运行时瞬态错误展示里拆出来，定义成可在同一页面会话内跨 reinit 存活的 chat UI 状态。
- 收紧错误 banner 清理规则：provider save / runtime reinit 不得无故清空同一失败 run 的 retry affordance；只有成功恢复、用户 dismiss、或新 run 覆盖时才允许移除。
- 为 web live verify 补上真实闭环：失败 direct-chat run -> 修 provider -> runtime reinit -> 仍可见 Retry -> 点击后沿原失败 run 语义继续。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-streaming-ux`: failed chat runs must preserve a visible retry affordance across runtime reinit until the failure is explicitly dismissed or superseded by a successful/new run.

## Impact

- `apps/web/src/runtime/hooks/useRuntimeInit.ts`
- `apps/web/src/runtime/OffisimRuntimeProvider.tsx`
- `packages/ui-office/src/components/chat/ChatPanel.tsx`
- `packages/ui-office/src/components/error/ErrorBanner.tsx`
- Possibly adjacent runtime error / retry metadata helpers in `apps/web/src/runtime/hooks/`
- `openspec/specs/chat-streaming-ux/spec.md`
