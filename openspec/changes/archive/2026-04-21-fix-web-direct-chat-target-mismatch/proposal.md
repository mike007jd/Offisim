## Why

2026-04-21 的 web live verify 里，direct chat 选择 `Maya` 时，`fork_skill` / `edit_skill_body` preview 偶发落到 `Alex Chen`。这会直接破坏 direct chat 的可信度，也会继续污染后续 T2.x web live verify，因为用户看到的目标员工和实际当前选中的员工不一致。

## What Changes

- 收紧 web direct chat 的 target 解析：一次发送周期内只解析一次目标员工，并把这个 resolved target 贯穿用户消息落盘、streaming run、pending interaction、retry、follow-up。
- 禁止 direct chat 在 run 已发出后再根据当前 UI 选中员工或旧 ref 重新解释 target；切换员工只影响后续新消息，不得回写正在进行中的 run。
- 为 web direct chat 补充 live verify：Maya/Alex 切换、pending interaction、retry 三条路径都要验证 preview / bubble header / follow-up 目标一致。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-state-management`: `selectedEmployeeId` 作为新 direct-chat run 的唯一 UI 来源，切换选中员工只影响未来 run，不得回改正在执行或待确认的 run target。
- `chat-streaming-ux`: direct chat 的 employee identity 在 send → stream → pending interaction → retry 整条链上必须保持稳定，不得把 preview / bubble label / follow-up 路由到别的员工。

## Impact

- `packages/ui-office/src/components/chat/ChatPanel.tsx`
- `apps/web/src/runtime/hooks/useInteractionSync.ts`
- 可能涉及 `apps/web/src/runtime/hooks/useRuntimeInit.ts` 与 chat session key / failed-message metadata 的 target 传递
- `openspec/specs/workspace-state-management/spec.md`
- `openspec/specs/chat-streaming-ux/spec.md`
