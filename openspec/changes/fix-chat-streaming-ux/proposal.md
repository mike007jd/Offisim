## Why

Offisim 的产品 promise 是"过程即价值"——用户必须能看到系统在干活。但当前 chat rail 在任务执行期间只显示占位（如 `Working through the request...`），最终答案一次性落下。live audit 确认：真 MiniMax 调用、cost/latency 计数器都在动，scene 也有执行态——唯独**用户盯着的 chat 气泡是静默的**，直到一次性刷出最终答案。这与"过程即价值"直接矛盾。

Transport 层已经备齐：`use-chat-streaming-sync.ts` 已订阅 `llm.stream.chunk` 并调 `appendStreamingChunkForActiveRun`，`StreamingBubble.tsx` / `chat-session-store.ts` / `use-streaming-content` 这些基础设施都在。所以这**不是事件 pipeline 问题**，是 **UI 渲染层** placeholder 逻辑压过了 streaming content——气泡没把已累积的 chunk 展示出来，或者 placeholder 条件错了在 streaming 开始后仍然主导。

完整产品方向、UX 要求、acceptance 都已经落在 `Docs/04_runtime_experience/CHAT_STREAMING_UX_FIX_SPEC.md`（345 行，2026-04-14 (late) 写好），本 change 把它转成 openspec canonical spec + 可执行 tasks。

## What Changes

- 让 chat 气泡在 `llm.stream.chunk` 陆续到来时真正逐段显示累积内容，placeholder 只在"已开始但 chunk 还没到"的空窗期出现，且一旦真实内容到达即让位
- 保证 streaming 气泡显式标示 speaker（Boss / Manager / Employee / 未来 external department），team chat 和 direct chat 都一致
- partial 视觉与 completed 视觉有可感知区别（游标 / 脉动 / 微指示器）；completed 时指示器撤除，不闪
- finalization 连续：同一气泡从 partial → final，不是"placeholder 消失 + 新气泡突现"
- 错误 / 中断场景保留已经流出的 partial 内容，不清空
- 修改范围：`StreamingBubble.tsx` / `ChatPanel.tsx` / `chat-session-store.ts` 为主，必要时 touch `use-streaming-content`。**不触** transport (`use-chat-streaming-sync.ts`)、不改 `llm.stream.chunk` payload schema、不动 provider 层

## Capabilities

### New Capabilities
- `chat-streaming-ux`: chat rail 中 LLM 响应的 streaming 渲染契约——placeholder/speaker/partial/completed/interrupted/failed 五态清晰，transport 已完成时 UI 立即反映

### Modified Capabilities
(无 — 不改任何已有 canonical spec)

## Impact

- `packages/ui-office/src/components/chat/StreamingBubble.tsx`（79 行）— 主修改点
- `packages/ui-office/src/components/chat/ChatPanel.tsx`（568 行）— placeholder vs streaming 切换条件
- `packages/ui-office/src/components/chat/chat-session-store.ts`（336 行）— 确认 activeRun 的 streamingContent / placeholder 字段语义
- （可能）`packages/ui-office/src/runtime/use-streaming-content.*`（若存在）
- **不触**：`use-chat-streaming-sync.ts`（transport 已正确）、event payload schema、provider adapters、scene 层
- 参考文档：`Docs/04_runtime_experience/CHAT_STREAMING_UX_FIX_SPEC.md`（保留为 working note，不删；但 canonical spec 以 `openspec/specs/chat-streaming-ux/spec.md` 为准）
- 验证：live Playwright 发一个多秒任务，观察气泡从 placeholder → partial stream → final 的完整过渡，按 spec §11 的 3 条 acceptance 各跑一遍
