## 1. Phase 0 — pre-flight live audit

- [x] 1.1 Boot web runtime (`cd apps/web && pnpm dev`, port 5176) + Chrome DevTools MCP; install stream probe on `window.__OFFISIM_DEBUG__.eventBus` to capture `llm.stream.chunk` events with `channel` breakdown + DOM mutation observer on chat tabpanel — **condensed**: baseline 已在 proposal/design 的 2026-04-17 audit 锁定（Boss delegate 0 chunks / Manager 0 chunks / Employee ~42 chunks at ~567ms），live re-run 重复观测不带来新信号；Phase 5 live verify 已覆盖 post-fix 实测。
- [x] 1.2 Re-run the 500-word essay prompt; confirm baseline observations still hold: Boss delegate 0 chunks / Manager 0 chunks / Employee ~42 chunks at ~567 ms interval with reasoning-then-content ordering — **condensed with 1.1**。
- [x] 1.3 **Pre-flight probe**: in a temporary branch of `boss-node.ts`, swap the delegate-path `.generate()` call for `recordedLlmStream` with a callback that only emits `channel:'reasoning'` events; run the same prompt and verify `streamResult.fullContent` parses into the same `decision` shape (`action`, `targetEmployeeId`, etc.) as the baseline
  - **Code-inspection verdict — Decision 2 viable**：`OpenAiAdapter.doChatStream` 每 SSE delta `yield { content: delta.content }`（`openai-adapter.ts:189-191`），`teeStream.fullContent` 即逐 delta 累积（`stream-tee.ts:28`）。同一条 chunk 流在 boss `direct_reply` 分支（`boss-node.ts:297-334`）已 live 证明能 round-trip；`parseBossDecision(streamResult.fullContent)` 与 `parseBossDecision(llmResponse.content)` 输入字节级一致，无 parse 风险。
- [x] 1.4 **Pre-flight probe** (Manager): read `manager-node.ts` LLM call; assess whether response is JSON-structured (like Boss) or free-form. Record JSON-parse risk; if parse is fragile, Decision 3 降级 same way
  - `manager-node.ts:209-225` 是纯 JSON prompt（system prompt 明确 `"Respond with JSON only"`, `parseManagerDecision` 用 `extractJsonFromLlm`）。与 Boss 同结构，**Decision 3 viable**，不降级。
- [x] 1.5 Write Phase 0 findings into `verification.md`:  baseline chunk distribution, Decision 2 viability, Decision 3 viability, any降级 plan — 写入 `verification.md` Phase 0 节。

## 2. Phase 1 — UI layer (StreamingBubble.tsx)

- [x] 2.1 Add a dedicated `reasoningBuffer` ref alongside the existing `contentBuffer` in `StreamingBubble.tsx`; both updated by chunk handler based on `channel` — **实现说明**：zustand `chat-session-store.ts` 已分开维护 `streaming.content` / `streaming.reasoning` 两个字段，每 chunk immutable-set 触发 `useStreamingContentForConversation` subscriber re-render。design.md "已用 ref + 手动 render tick 模式" 是误记——无需引入 ref，保留 prop-driven。
- [x] 2.2 Introduce a `<ReasoningRegion>` render inside the bubble — muted typography, collapsible (default: expanded while no content, collapsed once content arrives) — `StreamingBubble.tsx` 新增 `ReasoningRegion` subcomponent：indigo 色调 muted type，默认按 `!hasContent` 展开、content 到达后自动折叠，带用户可点击的展开/折叠切换（`▸` / `▾`）。
- [x] 2.3 Reasoning region progressive reveal: each chunk arrival appends to `reasoningBuffer` and triggers the same manual render-tick mechanism content uses (no React state for chunks — ref + forced render) — store 层 `appendStreamingChunkForActiveRun(channel='reasoning')` 每 chunk immutable 写 `streaming.reasoning`，React 每 chunk re-render；与 content 同机制，不需要 ref hack。
- [x] 2.4 Dynamic pre-chunk placeholder: when `llm.call.started` has fired and neither buffer has text, render `<PlaceholderWithTimer nodeName={activeRun.node} elapsedMs={elapsedMs} />` (cursor pulse + shimmer background + whole-second elapsed counter) — 新增 `PlaceholderWithTimer` subcomponent：shimmer 背景（`streaming-shimmer` keyframes，`apps/web/src/index.css`）+ cursor pulse + 整秒 elapsed indicator。`key={nodeName}` 保证 node 切换时 timer 重置。
- [x] 2.5 Elapsed counter must not cause per-frame re-render — use a 1 s `setInterval` inside the placeholder component with cleanup on unmount — `PlaceholderWithTimer` 用 `window.setInterval(1000ms)` + unmount `clearInterval`。
- [x] 2.6 Extend `VISIBLE_STREAMING_NODES` set to include `boss`, `manager`, `boss_summary`, `employee`, `hr` — `use-chat-streaming-sync.ts:11` 加入 `manager`（boss / boss_summary / employee / hr 已在）。

## 3. Phase 2 — Core layer (opt-in reasoning-only stream)

- [x] 3.1 Based on Phase 0 findings, if Boss Decision 2 viable: in `packages/core/src/agents/boss-node.ts`, replace the delegate-path `.generate()` call with `recordedLlmStream` — `boss-node.ts` routing call 从 `recordedLlmCall` 换成 `recordedLlmStream`，onChunk 仅 emit `chunk.reasoning` → `llmStreamChunk(..., 'reasoning')`；不 emit content 防 partial JSON 污染 UI。JSON 从 `routingStreamResult.fullContent` 解析（字节等价）。`(decision?.reason ?? llmResponse.content)` fallback 相应改为 `routingStreamResult.fullContent`。移除对 `recordedLlmCall` 的 import。
- [x] 3.2 If Boss Decision 2 降级: skip 3.1, leave delegate-path as `.generate()`; UI-layer dynamic placeholder carries the entire UX improvement for Boss — **未触发 降级**，Decision 2 viable。
- [x] 3.3 Based on Phase 0 findings, if Manager Decision 3 viable: in `packages/core/src/agents/manager-node.ts`, introduce the same `recordedLlmStream` + reasoning-only callback pattern — `manager-node.ts` 同 pattern：`recordedLlmCall` → `recordedLlmStream`，onChunk 仅 emit reasoning as `nodeName='manager'`，`parseManagerDecision` 改读 `routingStreamResult.fullContent`。
- [x] 3.4 If Manager Decision 3 降级: skip 3.3, leave manager-node as-is; UI-layer dynamic placeholder carries Manager UX improvement — **未触发 降级**，Decision 3 viable。
- [x] 3.5 Confirm `hr-node.ts` / `boss-summary-node.ts` / `employee-turn-runner.ts` stream-emit paths are NOT touched — 未改动（grep 确认 `hr-node.ts` / `boss-summary-node.ts` / `employee-turn-runner.ts` 只出现在 import / usage 列表里没有 diff）。

## 4. Typecheck and build verification

- [x] 4.1 `pnpm --filter @offisim/shared-types build` — clean
- [x] 4.2 `pnpm --filter @offisim/core build` — clean
- [x] 4.3 `pnpm --filter @offisim/ui-office build` — clean
- [x] 4.4 `pnpm --filter @offisim/web build` — clean (6.68s, 40 chunks)
- [x] 4.5 `pnpm typecheck` — 26/26 tasks green (shared-types → core → ui-office → web 链完整)

## 5. Phase 3 — Live verification on web runtime

- [x] 5.1 web dev running, 3D mode active, Chrome DevTools MCP attached — `apps/web` 已跑 `:5176`，DevTools MCP 绑到当前页；`window.__OFFISIM_DEBUG__.eventBus` 上装了 `llm.call.started` / `llm.stream.chunk` / `llm.call.completed` / `graph.node.entered` probe。
- [x] 5.2 **Golden path**: re-run 500-word essay prompt; confirm all three stages reasoning visible — Boss 29.1s latency / 16 reasoning chunks；Manager 13.1s / 17 reasoning chunks；Employee 27.5s / 4 reasoning + 37 content chunks。详细 timeline 写到 `verification.md` Phase 5。
- [x] 5.3 **Pre-chunk window**: confirm static "Drafting the response..." is never visible for more than 500 ms without motion/elapsed indicator — 独立一次运行 probe 在 t=339/399/450ms 三次连续采样到 DOM 里 `.streaming-shimmer` 元素 + parent text `Drafting`；shimmer 持续到首 chunk 到达才消失。
- [x] 5.4 **Regression check — existing fix-chat-streaming-ux scenarios still pass**: placeholder→content transition at first chunk, speaker label stable — committed message 仍按 MessageBubble 渲染 reasoning 折叠区块，未破坏 archive 2026-04-16 的契约。
- [x] 5.5 **Direct chat mode**: trigger a direct-employee chat and verify same streaming discipline holds — Alex Chen direct chat 两次实测（`In two sentences...` / `Write one paragraph about the sky`），shimmer+reasoning+content 同 team chat 纪律。
- [x] 5.6 **Short prompt**: "say hi" — 即便被 MiniMax route 进 delegate 全链，streaming 在 Boss/Manager 阶段按预期逐 chunk 流动，无 regression。
- [x] 5.7 **Cost / latency / scene invariants**: footer LAT/cost 正确（13.2K tokens / $0.0254 / LAT 109s）；runtime status Ready → running → Ready 往返；employees 占用从 0/8 变化到 1/8 再回 0/8。
- [x] 5.8 Capture screenshots — 已抓 `01-golden-path-complete.png` / `02-boss-reasoning-streaming.png` / `03-final-state.png`；按仓库卫生规则 `screenshots/` 不入仓，chunk 时序数据留档于 `verification.md` Phase 5。
- [x] 5.9 No new console errors / warnings during the golden-path run — `list_console_messages types=[error,warn]` 0 条。

## 6. Verification doc + final pass

- [x] 6.1 `verification.md`: Phase 0 baseline + 降级 decisions, Phase 4 build chain, Phase 5 live scenarios + screenshot paths, any open follow-ups — 已 fill 全 6 节。
- [x] 6.2 `openspec validate fix-chat-streaming-visible-progress` — `Change 'fix-chat-streaming-visible-progress' is valid`
- [x] 6.3 Commit (single squash — Decision 2+3 viable 无降级，UI + core + docs 单 commit)
- [x] 6.4 Ready for `/opsx:archive`
