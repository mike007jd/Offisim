## Context

一轮 `fix-chat-streaming-ux`（2026-04-16）关闭了 `StreamingBubble.tsx` placeholder gap bug。但 live audit（2026-04-17 MiniMax-M2.7-highspeed，prompt `"Write a detailed 500-word essay arguing tabs vs spaces..."`）揭示系统仍有三个 "final-dump 观感" 源头：

- **Boss routing-for-delegate 阶段** ~30s 零 `llm.stream.chunk`。`packages/core/src/agents/boss-node.ts:297` 中 `if (route === 'direct_reply')` 才进 `recordedLlmStream`；delegate/meeting/direct_delegate 分支全走 JSON `.generate()` 非-stream。
- **Manager 阶段** ~20s 零 chunk。`packages/core/src/agents/manager-node.ts` 零 `llmStreamChunk` import，从无 streaming path。
- **Employee reasoning 段** chunks 按 **567ms 平均间隔** 以 `channel:'reasoning'` 传来（42 个 chunk / 23s 实测），但 `StreamingBubble.tsx` 把它们聚合成一整段大块显示（snapshot 证据：reasoning 文本一次性出现，不渐进 reveal）。

Content channel 本身（Employee 阶段）已经 chunk 级 re-render 正常（DOM mutation observer 数据：每秒 ~210 chars 稳定增长）—— content 层不是问题。

用户产品方向 "过程即价值" 下，前 50 秒 "像死机" 的感觉是破窗。

## Goals / Non-Goals

**Goals:**

- 让 Boss delegate / Manager routing 阶段也能在 chat bubble 里展示"正在思考"的内容预览（reasoning stream），不只是静态 "Drafting..." / "Analyzing..."
- Employee reasoning segment 按 chunk 渐进 reveal（与 content 段同等打字机体验），不再聚合 dump
- pre-chunk 阶段（LLM call 已起但首 chunk 未到）的 placeholder 必须动态（cursor / shimmer），消除"静止一分钟"的错觉
- 保持 Boss JSON routing decision parse 100% 正确（reasoning stream 不能污染 JSON 响应）

**Non-Goals:**

- 不改 `MessageBubble.tsx` 的 committed message 展示逻辑（上次 change 已 archive，不回归）
- 不改 `llm.stream.chunk` 事件 schema（`channel: 'content' | 'reasoning'` 已够用）
- 不做跨 provider 的 streaming 标准化（MiniMax-M2.7-highspeed 是唯一 live target）
- 不做 cursor 动画的 a11y 细化（reduced-motion 支持留给后续 UX polish）

## Decisions

### Decision 1 — Reasoning chunks 单独 buffer、按 chunk reveal

**选择**：`StreamingBubble.tsx` 为 `channel:'reasoning'` 维护独立 buffer，和 `content` buffer 并列，每次 chunk 到达触发 re-render，UI 上 reasoning 段渲染为可折叠的 "思考过程" 区块（灰阶小字），content 段下方正常显示。

**替代方案**：
- (a) 把 reasoning 和 content 合并到同一个字符串按时间顺序流（像 Claude.ai）。**否决**：用户场景下 reasoning 是内部过程，折叠展示更符合"透明但不喧宾夺主"。
- (b) 不动 reasoning，只做 content 层。**否决**：reasoning 占了 Employee ~75% 的前段体感时间（前 20 chunks 多是 reasoning），不做等于白做。

### Decision 2 — Boss delegate 路径 opt-in emit reasoning chunks

**选择**：`boss-node.ts` delegate / start_meeting / direct_delegate 的 JSON routing call 改用 `recordedLlmStream`（已有 infra），在 stream callback 里**只** emit `channel:'reasoning'` chunks，**不** emit `channel:'content'` chunks（避免片段化的 JSON 被 UI 当 content 显示）。JSON 响应由 stream 闭合后从 `streamResult.fullContent` 解析。

**替代方案**：
- (a) Boss routing 完全不动，仅靠 UI placeholder 动态化遮盖等待感。**否决**：UI shimmer 是"假动态"，用户仍等 30s 看不到内部思考。
- (b) Content 也 emit 再让 UI 侧过滤。**否决**：增加 UI 解析 JSON-partial 的复杂度，脆弱。

**风险点**：要验证 MiniMax provider 层 `recordedLlmStream` stream 完整响应后 `fullContent` 能被当前 JSON parser 正确处理 —— 与 `.generate()` 路径等价性必须先用现有 `direct_reply` 分支的成功历史作参考（该分支既用 stream 又提取 finalReply）。

### Decision 3 — Manager node 引入 reasoning-only stream

**选择**：同 Boss delegate 路径一致，Manager 的 LLM call 改用 `recordedLlmStream` emit `channel:'reasoning'`，不 emit content。

**替代方案**：manager 的 JSON 输出结构可能比 boss 更复杂（routing plan），直接引 stream 风险更大。**缓解**：Phase 1 先在 apply 阶段做 audit，若 manager 的 routing JSON 必须走 `.generate()` 兼容性不破坏，则 manager 仅保留 UI 层 placeholder 动态化（降级方案）。

### Decision 4 — pre-chunk placeholder 动态化

**选择**：`StreamingBubble.tsx` 在 `llm.call.started` 已 fire 但首 chunk 未到的窗口，placeholder 区域显示 cursor pulse（tail blink）+ 轻量 shimmer 背景，不是静态 "Drafting..."。文案保留但加上 elapsed-time indicator（"Drafting...（12s）"），让用户有"系统还活着"的信号。

**替代方案**：完全移除文字 placeholder 只留 cursor。**否决**：不同 nodeName（boss / manager / employee）的识别语义需要文字标签。

### Decision 5 — `VISIBLE_STREAMING_NODES` 扩充

**选择**：如果 Decision 2+3 落地，`boss`（delegate 分支）+ `manager` 都要加入 `VISIBLE_STREAMING_NODES`，否则 reasoning chunks 到了 UI 会被 drop。

**向后兼容性**：`chat-streaming-ux/spec.md` Requirement "Placeholder shows only in the pre-chunk gap" 当前逻辑依赖 `nodeName in VISIBLE_STREAMING_NODES`；扩充 set 不会破坏现有 scenario，只是让更多 node 进入 streaming UI。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| MiniMax provider stream-while-capturing-JSON 在 Boss routing 不工作（JSON parse 断） | Phase 0 apply 阶段先做 pre-flight：用 `recordedLlmStream` 替换一次 Boss delegate 路径，验证 `streamResult.fullContent` parse 出的 `decision` 与 `.generate()` 路径一致；不一致则 Decision 2 降级为仅 UI 侧 placeholder 动态化 |
| Reasoning chunks 很多（42 chunks / 23s = 每秒 2 个 UI update）→ React re-render 性能 | StreamingBubble 已用 ref + 手动 render tick 模式（A-1 fix），保留。新 reasoning buffer 用同样模式。必要时加 `requestAnimationFrame` coalesce |
| Reasoning 展示出来后反而干扰用户阅读 content | UI 侧折叠（默认展开但占空间有限，content 到来时自动收起或灰阶化）。Decision 1 已说明 |
| Manager routing JSON 比 Boss 更复杂，stream 路径要改动 `manager-node.ts` 的 response parse 链路 | apply 阶段先读 `manager-node.ts` 的 LLM 调用点，若兼容性风险高，Decision 3 降级为 UI 层 placeholder 动态化 |
| Cursor pulse + shimmer 叠加导致视觉噪音 | 约束：cursor 只在 tail 位置（单字符宽），shimmer 仅作为 placeholder 背景淡色不过强；不要加载 spinner icon |

## Migration Plan

1. **Phase 0 pre-flight**：apply 阶段第一步，在 Boss delegate 分支用 `recordedLlmStream` 做一次 live probe（单 prompt 测），确认 `streamResult.fullContent` 能 parse 回当前 `decision` 结构；如果不行，Decision 2/3 降级。
2. **Phase 1 UI 层（Decision 1+4）**：改 `StreamingBubble.tsx`，分 channel buffer + reasoning 渐进 reveal + pre-chunk dynamic placeholder。这部分风险低可先 ship。
3. **Phase 2 Core 层（Decision 2+3+5）**：按 Phase 0 结果决定是否改 `boss-node.ts` delegate 分支 + `manager-node.ts`；扩 `VISIBLE_STREAMING_NODES`。
4. **Phase 3 Live verify**：用 Phase 0 的同一 prompt（500-word essay）在 web runtime 做 golden-path 验证：Boss reasoning 可见 ✅、Manager reasoning 可见 ✅、Employee reasoning 渐进 reveal ✅、整体"50 秒死机感"消失 ✅。

**Rollback**：纯 git revert apply commit。UI 层改动影响面有限（只 `StreamingBubble.tsx`），core 层改动用 subpath 替换不影响其它 consumer。

## Open Questions

- Reasoning 段是否需要语义分类（例如 MiniMax-M2.7 给的 reasoning 有时包含 `Let me think about...` / `Here's my approach:` 等小标题）。**默认**：不分类，原文 reveal，折叠箱里显示。如果 reasoning 可读性太差，后续 change 可以做抽取式摘要——当前 change 不做。
- Placeholder elapsed-time indicator 颗粒度（"12s" vs "12.3s" vs "Drafting... 一个 spinner"）— 倾向最简，整数秒 + 静态文案，避免时间数字每 100ms 跳动再次制造闪烁感。
