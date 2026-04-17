## Why

一轮 `fix-chat-streaming-ux`（2026-04-16 archive）修好了 `node entered → first chunk` 空窗期 placeholder 消失 bug，让 Employee 的 content chunks 真能逐段进气泡。但产品"过程即价值"方向下，用户当前实际体验仍像 "loading 一分钟然后啪一下东西出现"：live audit（2026-04-17 MiniMax-M2.7-highspeed，500-word essay prompt）硬数据显示——

- **Boss `delegate` 阶段 ~30 秒零 chunk**。Boss 做 routing decision 走 JSON `.generate()` 非-stream 分支（`boss-node.ts` `if (route === 'direct_reply')` 之外的路径都不 stream），用户看到静态 `"Drafting the response..."` 长达半分钟
- **Manager 阶段 ~20 秒零 chunk**。`manager-node.ts` 全无 `llmStreamChunk` import，从来没有 streaming path，整个 routing/planning 阶段只有静态 `"Analyzing request..."`
- **Employee reasoning chunks 虽然按 567ms 间隔进来**（42 个 chunk，channel='reasoning'），但 `StreamingBubble` 把它们聚合成一整段大块显示，snapshot 实测 reasoning 气泡是一次性 dump 不递增

三层叠加 → 每次复杂任务前 50 秒"像死机"，这是"过程即价值"的破窗。

## What Changes

- **修改 `chat-streaming-ux`**：扩展契约覆盖 *reasoning channel 的渐进显示要求* 与 *LLM-call-in-flight but-pre-chunk 阶段的动态占位要求*
- UI 层（`StreamingBubble.tsx`）：reasoning 和 content chunks 分别按 chunk 到达渐进追加渲染，不聚合 dump；已分 channel 维护两个 buffer
- UI 层 placeholder 升级：pre-chunk 阶段（node entered 且 `llm.call.started` 已 fire 但 chunks 未到）显示动态指示（cursor / shimmer / 阶段文案），不是静态字符串
- Core 层（`boss-node.ts` delegate-decision 分支 + `manager-node.ts`）：JSON-routing LLM call 路径 opt-in emit `channel:'reasoning'` 的 chunks，让内部思考过程可被 UI 预览——**content chunks 不 emit**（避免污染 JSON parse），**reasoning 安全因为 reasoning 不参与 JSON decision）

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `chat-streaming-ux`: 新增 reasoning channel 渐进显示要求；扩充 placeholder 契约覆盖 LLM-in-flight-but-pre-chunk 阶段必须动态；新增对 Boss delegate / Manager routing 阶段必须有 reasoning preview 的要求

## Impact

- **Code**
  - `packages/ui-office/src/components/chat/StreamingBubble.tsx` — 分 channel buffer、reasoning 渐进渲染、动态 placeholder
  - `packages/core/src/agents/boss-node.ts` — delegate-decision 路径 opt-in reasoning stream
  - `packages/core/src/agents/manager-node.ts` — 引入 reasoning-only stream
  - 可能扩 `recordedLlmStream` / `recordedLlmCall` 的 API 让 JSON-routing call 也能订阅 reasoning chunks
- **Schema / Types**: `LlmStreamChunkPayload` 已有 `channel: 'content' | 'reasoning'` 字段，无需扩。可能需要新增 `VISIBLE_STREAMING_NODES` 包含 `manager` / `boss` delegate 分支的识别
- **Dependencies**: 无新增
- **Risk**: Boss JSON routing 的 LLM call 目前走 `.generate()`，改成 stream-while-capturing-JSON 必须验证 MiniMax provider 层 stream 闭合后能拿到完整响应（reasoning 和 content 都完整）；若 provider 层不兼容则 fallback 到"UI 层动态 placeholder 为主，不改 core"的窄 scope
