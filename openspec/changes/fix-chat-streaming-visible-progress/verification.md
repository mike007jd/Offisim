# Verification — fix-chat-streaming-visible-progress

## Phase 0 — pre-flight audit (code-inspection condensed path)

### Baseline (from 2026-04-17 live audit, already captured in proposal / design)

- Boss delegate-decision 分支（`boss-node.ts:184-197` 的 `recordedLlmCall`）：~30s 零 `llm.stream.chunk`
- Manager routing call（`manager-node.ts:209-225` 的 `recordedLlmCall`）：~20s 零 chunk
- Employee：42 chunks / 23s, ~567ms 间隔, reasoning → content 顺序。Content chunk 层进气泡正常。
- 500-word essay prompt 下前 ~50s 无任何 streaming 输出。

### Decision 2 / Decision 3 viability — 代码层推定（无 live probe）

**为什么跳过 live probe**：Boss `direct_reply` 分支已长期使用 `recordedLlmStream` 并成功从 `streamResult.fullContent` 提取最终文本（`boss-node.ts:297-334`，`fix-chat-streaming-ux` archive 2026-04-16 已 live verify）。Core infra 层面，`recordedLlmStream` 与 `.generate()` / `recordedLlmCall` 返回的 `content` 是**逐 delta 累积同一份字符串**（`openai-adapter.ts:150-249` `doChatStream` 的 `delta.content` + `teeStream.ts:28` 的 `fullContent += chunk.content`）。因此：

- `parseBossDecision(streamResult.fullContent)` ≡ `parseBossDecision(llmResponse.content)` — 两者输入字符串字节级一致
- 同理 `parseManagerDecision(streamResult.fullContent)` ≡ `parseManagerDecision(llmResponse.content)`

**结论**：Decision 2 viable ✅；Decision 3 viable ✅；无需降级。MiniMax-M2.7-highspeed 已验证走 OpenAI-compat 路径（`openai-adapter.ts` 的 `chatStream` 每 SSE delta `yield { reasoning: delta.reasoning_content }` / `yield { content: delta.content }`——与 direct_reply 分支共享同一条 chunk 流）。

### Design-note 修正

`design.md` 提到 "StreamingBubble 已用 ref + 手动 render tick 模式（A-1 fix），保留" — 实际代码是 prop-driven（zustand `appendStreamingChunkForActiveRun` 每 chunk immutable 新对象 → `useStreamingContentForConversation` subscriber 每 chunk re-render）。每 chunk 已触发 re-render，不需要 ref + 手动 tick。Phase 1 UI 层按 prop 语义实现，不引入 ref-hack。

## Phase 1 — UI layer changes

- `packages/ui-office/src/components/chat/StreamingBubble.tsx` 重写：
  - `ReasoningRegion` subcomponent（indigo muted type）：每 chunk 到达 zustand 推新 `streaming.reasoning` 字符串 → selector 新引用 → React re-render → 文本逐段增长；用户可点 toggle 折叠/展开；默认 `!hasContent` 时展开，content 到达后自动折叠（`expanded = expandedByUser ?? !hasContent`）。
  - `PlaceholderWithTimer` subcomponent：shimmer 背景（`.streaming-shimmer` keyframes，90 deg gradient sweep, 1.6s ease-in-out infinite） + cursor pulse + 整秒 elapsed counter。1s `setInterval` 在组件内部，无 per-frame re-render；unmount `clearInterval`；`key={nodeName}` 保证 node 切换重置 timer。
  - Placeholder text 删除末尾 `...`（shimmer + cursor + elapsed 已是动态信号，静态 dots 冗余）；文案短化（`Drafting` / `Coordinating` / `Working`...）。
- `packages/ui-office/src/runtime/use-chat-streaming-sync.ts`：`VISIBLE_STREAMING_NODES` 加 `'manager'`；其余保留。
- `apps/web/src/index.css`：新增 `.streaming-shimmer` keyframes + `@media (prefers-reduced-motion: reduce)` 禁用动画 fallback。

## Phase 2 — Core layer changes

- `packages/core/src/agents/boss-node.ts`：routing call 由 `recordedLlmCall` → `recordedLlmStream`；onChunk 仅 `emit llmStreamChunk(..., chunk.reasoning, 'reasoning')`，不 emit content；`parseBossDecision` 输入从 `llmResponse.content` 换成 `routingStreamResult.fullContent`；replyContent fallback 同步换；移除 `recordedLlmCall` import。
- `packages/core/src/agents/manager-node.ts`：同 pattern；新增 `llmStreamChunk` import；`parseManagerDecision` 读 `routingStreamResult.fullContent`。
- `hr-node.ts` / `boss-summary-node.ts` / `employee-turn-runner.ts`：零 diff（regression guard 成立）。

## Phase 4 — Typecheck + build chain

- `pnpm --filter @offisim/shared-types build` ✓
- `pnpm --filter @offisim/core build` ✓
- `pnpm --filter @offisim/ui-office build` ✓
- `pnpm --filter @offisim/web build` ✓（6.68s, 40 chunks）
- `pnpm typecheck` ✓（26/26 tasks green, serial `shared-types → core → ui-office → web`）

## Phase 5 — Live verification

Live 2026-04-17 runtime：`apps/web` @ `:5176` + Chrome DevTools MCP stream probe, MiniMax-M2.7-highspeed。

### Golden path — 500-word essay prompt

Prompt：`Write a detailed 500-word essay arguing tabs vs spaces in programming. Cover readability, tooling, team conventions, and accessibility. Wrap up with a clear recommendation.`

Probe 抓到事件 timeline（相对 user submit）：

| 事件 | t (ms) | 细节 |
|---|---|---|
| `graph.node.entered` boss | 300 | |
| `llm.call.started` boss | 318 | Decision 2 生效，routing call 走 `recordedLlmStream` |
| 第 1 个 boss/reasoning chunk | ~2500 | 开始可见流动 |
| `llm.call.completed` boss | 29397 | 29.1s latency；共 **16 reasoning chunks**（baseline 0） |
| `graph.node.entered` manager | 29409 | Boss bubble 被 commit 逻辑跳过（content 空）→ Manager bubble 接上 |
| `llm.call.started` manager | 29441 | Decision 3 生效 |
| 第 1 个 manager/reasoning chunk | ~29800 | |
| `llm.call.completed` manager | 42524 | 13.1s latency；共 **17 reasoning chunks**（baseline 0） |
| `graph.node.entered` pm_planner | 42527 | 不在白名单，chat 静默（预期行为） |
| `graph.node.entered` step_dispatcher | 57310 | |
| `graph.node.entered` employee | 58056 | |
| `llm.call.started` employee | 58108 | |
| 第 1 个 employee chunk | ~58500 | reasoning → content ordering |
| `llm.call.completed` employee | 85646 | 27.5s latency；**4 reasoning + 37 content chunks** |
| `graph.node.entered` boss_summary | 110685 | 收尾 |

**关键验证点**：

- **Boss reasoning 可见**（Decision 2 viable 成立）：29s 内 16 个 chunks 逐段 reveal 到 Boss bubble 的 Reasoning 区块，不再是 0 chunks。
- **Manager reasoning 可见**（Decision 3 viable 成立）：13s 内 17 个 chunks。
- **Employee reasoning+content 渐进**：4 reasoning chunks 先到（Reasoning 区块自动展开），content chunks 开始流入后 Reasoning 自动折叠、content 区块每 300-700ms 长度单调增长。37 个 content chunks → 完整 500-word essay（实际字数：500，MiniMax 自标 `**Word count: 500**`）。
- **Dynamic placeholder with shimmer 实测生效**：独立一次 `Write one paragraph about the sky` 运行中，probe 在 t=339/399/450ms 三次连续采样到 DOM 里存在 `.streaming-shimmer` 元素，parent text `Drafting`；shimmer bounding rect 稳定（平移动画走 keyframes，元素位置稳定）。2.5s 首 chunk 到达后 shimmer 被 reasoning/content 区块替代。
- **Footer state 正确**：Ready → running → Ready 往返；end-state 显示 `13.2K tokens / $0.0254 / LAT: 109.0s`，与 end-to-end 实际 latency 一致，cost 合理。
- **No console errors/warnings**（`list_console_messages types=["error","warn"]` → 0 条）。

### Short prompt regression

Prompt：`say hi`（因 prior conversation context，MiniMax 把它 route 进了 delegate 链路，走了 Boss → Manager → pm_planner → step_dispatcher → employee → boss_summary 全流程，不是 direct_reply）。即便走了复杂链路：

- Boss 14.2s / 19 reasoning chunks 正常流
- Manager 7.6s / 8 reasoning chunks 正常流
- 最终 Boss summary `Task processing complete.` 顶上
- **无 streaming regression**

这验证了 `fix-chat-streaming-ux`（2026-04-16 archive）的 placeholder/commit 行为不受回归影响。

### Direct chat regression

切到 Alex Chen direct chat 发 `In two sentences, describe what you do.` / `Write one paragraph about the sky.`：

- 首 chunk 之前 shimmer + cursor + Boss 角色标签按 `VISIBLE_STREAMING_NODES` 正确显示
- reasoning 区块渐进填充，content 接上；committed 的 MessageBubble 保留可折叠 reasoning（`▸ REASONING` 按钮）
- 无 layout flicker

### Evidence artifacts

Live-verify 截图（`01-golden-path-complete.png` / `02-boss-reasoning-streaming.png` / `03-final-state.png`）未入仓（按仓库卫生规则，`screenshots/` 不长期保留）；chunk 时序 / DOM probe 数据已记录在上表，可复现。

## Phase 6 — Final pass

- `verification.md` 已 fill Phase 0–5。
- Tasks.md Phase 1–5 全勾；Phase 6 待 commit + archive 后收尾。
- 改动文件（6 条）：
  - `packages/ui-office/src/components/chat/StreamingBubble.tsx`
  - `packages/ui-office/src/runtime/use-chat-streaming-sync.ts`
  - `packages/core/src/agents/boss-node.ts`
  - `packages/core/src/agents/manager-node.ts`
  - `apps/web/src/index.css`
  - `openspec/changes/fix-chat-streaming-visible-progress/{proposal,design,tasks,verification}.md` + specs delta
- Single squash commit 符合 Phase 6.3（UI + core 打包，Decision 0/2/3 同向不降级，改动互依；不需要拆 commit）。
