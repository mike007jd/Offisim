## Context

`fix-web-direct-chat-target-mismatch` 已经把 direct chat 的 send-time target、pending interaction target、retry metadata target 收紧到了 run-origin employee，但 2026-04-22 的后续 web live verify 仍然看到一个可见层残留 bug：Maya rail 上失败的 direct-chat run，在用户切到 Alex 后点击 `Retry`，成功响应会显示在 Alex rail。说明“target 没漂”与“可见 conversation rail 没漂”还没有完全等价。

当前聊天 UI 至少有两层身份：
- run target / failed-run metadata（谁在执行）
- conversation key / visible rail（结果被提交到哪条聊天轨）

这条 change 的核心是把 retry 路径上的这两层重新绑死，避免当前 UI selection 在 retry 时重新决定 conversation key。

## Goals / Non-Goals

**Goals:**
- 让 direct-chat retry 的 streaming 与最终 assistant bubble 都落在原失败 run 的 conversation rail。
- 保持当前 UI selection 只影响“你现在正在看哪条 rail”，不影响 retry 结果归属。
- 不破坏已经修好的 pending interaction / preview target 绑定。

**Non-Goals:**
- 不改 team chat 的 rail 语义。
- 不重做聊天 session store 的整体结构。
- 不处理 provider reinit / retry affordance 持久化以外的错误体验问题。

## Decisions

### 1. Retry path 需要显式保存 origin conversation key，而不只保存 employee target
只保留 `targetEmployeeId` 还不够，因为 UI 最终是否把 assistant 内容落到正确 rail，取决于 `conversationKey` 在 retry 生命周期里是否稳定。retry 启动时必须使用失败 run 自身的 conversation key，并让后续 finalize/commit 继续沿用它。

备选方案：
- 每次 retry 时根据 `targetEmployeeId` 重新算 conversation key：理论上可行，但容易再次被“当前 thread / current selection / team rail fallback”污染。
- 直接从当前 selected rail 推断：这是本次 bug 的来源，不能继续依赖。

### 2. 失败 run 状态应同时携带 retry rail 身份
当前 failed-run state 已经能在 reinit 后保留 `Retry` affordance，但还没有把“这次 retry 属于哪条 rail”定义成显式状态。修复方案应把 retry rail 身份与 failed-run metadata 绑定在一起，作为 retry 的唯一可见提交归属。

### 3. Chat session store 继续作为 committed output 的唯一落点
不在 UI 组件里手动 append assistant bubble 到某条 rail；而是确保 `startRun` / activeRun / finalize 这条 store 路径从 retry 开始就拿到正确的 conversation key。这样流式内容、最终内容和失败/中断状态会自然保持一致。

## Risks / Trade-offs

- [retry metadata 再增加一层 rail 身份] → 用单一 failed-run source of truth 承载，避免 `targetEmployeeId` / `conversationKey` 分裂在多个 refs。
- [修复时可能影响 team rail 或 swap-person 再派发] → 用 `direct_chat` retry live verify 和 swap-person smoke 分开证明。
- [已有 `ChatPanel` refs 继续膨胀] → 优先把 rail 身份收进 failed-run state 或 chat-store 输入，不再散落成更多局部 ref。

## Migration Plan

1. 审计 retry 当前从失败态到 `startRun` / `finalizeActiveRun` 的 conversation key 来源。
2. 给 failed-run retry 状态补上 origin rail/conversation key。
3. 让 retry 的 streaming 与 final commit 都只读这份 origin rail 身份。
4. 做 web live verify：Maya fail -> switch Alex -> retry -> Alex rail 无结果、Maya rail 有结果。

## Open Questions

- retry rail 身份是否应该直接保存完整 `conversationKey`，还是保存最小必要字段（`threadId + targetEmployeeId`）并在 retry 时再统一生成。
- `Swap Person` 从失败 banner 再派发时，是否应显式覆盖掉 origin rail 身份，还是重用同一 failed-run container 但替换其目标。
