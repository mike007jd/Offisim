## Context

**既有基础设施（已 verify 接线正确）**：

- `packages/ui-office/src/runtime/use-chat-streaming-sync.ts`（86 行）：订阅 `graph.node.entered` / `llm.stream.chunk` / `tool.execution.telemetry` / `execution.aborted`，调 `appendStreamingChunkForActiveRun` 写 store。`VISIBLE_STREAMING_NODES = { boss, boss_summary, employee, hr }` —— manager / pm_planner / pm_replan / pm_heartbeat / error_handler 等**不进视觉 streaming**，但 `StreamingBubble.tsx` 里的 NODE_PLACEHOLDERS 却列出了全部节点。这是第一条可疑 mismatch。
- `packages/ui-office/src/components/chat/chat-session-store.ts`（336 行）：有 `setActiveRunNode`、`appendStreamingChunkForActiveRun`、`commitSpeakerSegment`、`setActiveRunStreaming`、`clearActiveRunStreamingContent`、`terminateActiveRun` 等方法。
- `packages/ui-office/src/components/chat/StreamingBubble.tsx`（79 行）：
  - `showPlaceholder = !content && !reasoning && isStreaming`
  - `displayContent = content || (showPlaceholder ? placeholder : '')`
  - cursor pulse 只在 `content` 非空时出
  - **逻辑本身看起来正确**：content 一到就让位 placeholder
- `packages/ui-office/src/components/chat/ChatPanel.tsx`（568 行）：组合 ChatDrawer/input/bubble/rail/system-feed 的主容器，StreamingBubble 的实际 mount 点 + activeRun 数据源头要在这里追。

**Live 观察到的症状 vs 代码预期的差距**：

- 用户侧看到的是 placeholder（一个占位文本）→ 一次性完整答案。
- StreamingBubble 代码逻辑说：content 一到就让位 placeholder。
- 那么 **content 要么根本没到 bubble、要么到了但 bubble 没 mount**。
- live 实测 2026-04-16 audit 里截到的"Analyzing request..." 其实是 **3D scene ceremony bubble** 而非 chat bubble（ceremony-visuals.ts 的 DEFAULT_BUBBLE_TEXT）。用户可能记忆混淆；chat 真实表现需重跑 live 锁定。

**候选根因（需 Task 1 用 Playwright 实际采样 DOM + store 状态后裁决）**：

1. **RC-1 ChatPanel 未 mount StreamingBubble**（或条件渲染把它藏了）—— `isStreaming` / `activeRun` 判断没走到渲染分支。
2. **RC-2 store 的 streamingContent 被写了但 StreamingBubble 读错字段**（prop 映射错位）。
3. **RC-3 Chunk 事件确实到了 sync、也调了 append，但 chunk 的 `nodeName` 不在 `VISIBLE_STREAMING_NODES` 白名单里**（例如 manager 节点的回答被丢弃），导致 bubble 长时间无 content。
4. **RC-4 Tool execution telemetry 触发 `clearActiveRunStreamingContent()`**（use-chat-streaming-sync.ts line 71）在某些时机把累积的 content 清零，导致视觉上只看到最后一段完整答复。

每条 RC 都有 tasks 里的具体抓数据动作可裁决。design 不预判哪条对，implementation 阶段跟数据走。

**Transport 侧确认过的：**`llm.stream.chunk` 事件确实被 emit（memory 里 2026-04-14 live 已验证 MiniMax 真调用、cost/latency 更新），chunk 到达 `use-chat-streaming-sync.ts` 的订阅回调是 99% 确定的。问题在 sync → store 或 store → bubble 这段。

## Goals / Non-Goals

**Goals:**

- 满足 `Docs/04_runtime_experience/CHAT_STREAMING_UX_FIX_SPEC.md` §11 的 3 条 acceptance（Live / Direct chat / Failure）
- 每一条 acceptance 都有 Playwright 可复现的测试步骤
- UX 五态清晰可视：pending / streaming / completed / interrupted / failed
- placeholder 只在"node 已知但 chunk 未到"的空窗出现；chunk 一到立即让位
- speaker label（Boss / Manager / Employee）在 streaming 过程中始终可见，team / direct chat 都一致
- 修改锁在 chat UI 层 + store 字段语义层；transport / provider 不动

**Non-Goals:**

- 不改 `use-chat-streaming-sync.ts` 的事件订阅列表（若发现 `VISIBLE_STREAMING_NODES` 白名单需要扩，列为 follow-up，不在本 change 里扩展）
- 不改 `llm.stream.chunk` payload schema
- 不改 provider adapter（OpenAI/MiniMax/Anthropic）的 stream 输出形式
- 不动 3D scene ceremony bubble（那是另一个面）
- 不做 deliverable artifact / file 下载 UX（spec §12 明确 out of scope，属 change B 范围）
- 不做 onboarding / A2A external department 外观（spec §12）

## Decisions

### D1: 先用 Playwright + store state 抓数据裁决 RC，不预设根因

**选择**：Tasks 第一组就是"live 复现 + 抓 DOM + 抓 store state"，拿到数据后再决定改 StreamingBubble / ChatPanel / 还是 store。不在 design 里钉死"改这几行"。

**理由**：上面 4 个 RC 每个要改的位置都不同，猜错就白工。Playwright `browser_evaluate` 可以直接读 `useChatSessionStore.getState()` 和具体 DOM，裁决成本低。

**备选**：按 RC-1（最可能）直接动 ChatPanel。否决：即使 RC-1 对，也得先确认 StreamingBubble 没被隐藏再动。

### D2: placeholder 兜底只保留 "node known + no chunk yet" 一种情形

**选择**：按 spec §6.2，placeholder 只在 `activeRun.node != null && content === '' && reasoning === ''` 时显示。其他任何情形（node 未知 / content 已非空 / 已 terminated）placeholder 隐藏。这个判定可以在 StreamingBubble 已有的 `showPlaceholder` 常量上微调，必要时把"node 已知"的条件从隐式（调用方传 nodeName）做成显式。

**理由**：spec §6.1–§6.2 直接约束。

### D3: Speaker label 在 streaming 中始终渲染，即便 content 为空

**选择**：当前 `StreamingBubble` 已有 `label` 渲染在 content 上方（line 49-55）。只要 ChatPanel 不在 streaming 期间隐藏 StreamingBubble 本身，这条就满足。Task 阶段要确认在 `activeRun.node != null` 就挂 StreamingBubble（不要等 content 非空才挂）。

### D4: Tool-telemetry clear 行为保留但加保护

**选择**：`use-chat-streaming-sync.ts` line 71 `store.clearActiveRunStreamingContent()` 在 `tool.execution.telemetry status=started nodeName=employee` 时清空，是为了 tool call 返回后 content 不和前轮叠加。**此行为保留**。但要确认：tool round 结束后，下一轮的 chunk 能重新 append 到干净的 bubble，不会让整段回答看起来"被清空"。若 RC-4 证实这里是根因，需要在 store 端调整清空后的视觉 state（比如保留上一轮的最终文本作为历史，而不是清空 active bubble）。

### D5: 修改路径倾向 "最小改动 + 明确语义"

**选择**：优先改 UI 层（StreamingBubble / ChatPanel）的条件分支，次选改 store 语义。不重写任何大文件。**若一条 5 行左右的条件修正能闭环，就不扩面积。**

**理由**：chat-session-store 336 行 / ChatPanel 568 行都是屎山候选但不在本 change scope。本 change 目标是 UX 可用，不是重构。

## Risks / Trade-offs

- **[风险] 根因跨多个组件、无法用 5 行改完** → Mitigation：tasks 第一组 live 采样裁决；若真的需要改 store + bubble + panel 三处，在 tasks 执行时暴露并对话确认继续，不盲扩 scope。
- **[风险] `VISIBLE_STREAMING_NODES` 白名单缺 manager / pm** → 若 live 发现 manager/pm 的回答本来就不该出现在 chat（它们只是协调节点），接受现状；若发现某 node 的用户级回答被白名单挡了，记录为 follow-up，不在本 change 扩展（避免连锁影响 scene/ceremony）。
- **[风险] 抖动 / 滚动作战** → Mitigation：tasks 最后一步要求 Playwright 在 1280×800 窗口下，发一个长任务（> 500 token）观察气泡文字增长有无跳帧；acceptance 含 "scroll 不与用户互相抢"。
- **[风险] direct chat 和 team chat 共用 ChatPanel，修改影响两条路径** → Mitigation：acceptance §11 和 Task 4 分别跑 team / direct，各截一次图。
- **[风险] 修改破坏 StreamingBubble 在 reasoning-only 时的展示（line 72-76 分支）** → Mitigation：不动 reasoning 分支的独立渲染；只动 content placeholder 分支的条件。

## Open Questions

- **VISIBLE_STREAMING_NODES 是否应包含 manager?** → 暂按现状（不含）。若 live 观察到 manager 回合完全静默是问题，另起 follow-up。
- **Interrupted / failed 态的视觉是否复用 MessageBubble 的 error 样式，还是在 StreamingBubble 里单独画？** → 由 Task 阶段决定，偏向复用 MessageBubble（保持风格一致）。
