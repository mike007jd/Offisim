## Why

2026-04-22 的 web live verify 暴露了一个剩余 direct-chat bug：Maya 的 direct chat 失败后，用户切到 Alex、修好 provider 并点击 `Retry`，可见响应仍会落到当前 Alex rail，而不是原失败 run 的 Maya rail。这样会直接破坏 retry 的可信度，也说明“run-origin target”在可见聊天提交阶段仍有遗漏。

## What Changes

- 把 direct-chat retry 的 conversation rail 绑定补到完整闭环：失败 run 的 retry 必须沿用原失败 run 的 conversation key，而不是当前 UI 选中的 rail。
- 收紧 retry 期间的聊天提交规则，让 streaming bubble、最终 assistant bubble、以及任何 retry 后续消息都归属于原失败 run 的 rail。
- 为 web live verify 补上更严格的实证：`Maya fail -> switch to Alex -> Retry` 后，Alex rail 不得承接 Maya 的重试结果，Maya rail 必须承接。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-streaming-ux`: direct-chat retry must keep the original failed run's visible streaming and committed assistant output on the same conversation rail, even if the user changes the currently selected employee before invoking retry.
- `workspace-state-management`: the selected employee may change the current UI view, but it must not re-key the conversation rail or committed output of an already-failed run being retried.

## Impact

- `packages/ui-office/src/components/chat/ChatPanel.tsx`
- `packages/ui-office/src/components/chat/chat-session-store.ts`
- Possibly adjacent runtime/chat metadata helpers in `apps/web/src/runtime/`
- `openspec/specs/chat-streaming-ux/spec.md`
- `openspec/specs/workspace-state-management/spec.md`
