## 1. Phase 0 — pre-flight live audit

- [ ] 1.1 Boot web runtime (`cd apps/web && pnpm dev`, port 5176) + Chrome DevTools MCP; install stream probe on `window.__OFFISIM_DEBUG__.eventBus` to capture `llm.stream.chunk` events with `channel` breakdown + DOM mutation observer on chat tabpanel
- [ ] 1.2 Re-run the 500-word essay prompt; confirm baseline observations still hold: Boss delegate 0 chunks / Manager 0 chunks / Employee ~42 chunks at ~567 ms interval with reasoning-then-content ordering
- [ ] 1.3 **Pre-flight probe**: in a temporary branch of `boss-node.ts`, swap the delegate-path `.generate()` call for `recordedLlmStream` with a callback that only emits `channel:'reasoning'` events; run the same prompt and verify `streamResult.fullContent` parses into the same `decision` shape (`action`, `targetEmployeeId`, etc.) as the baseline
  - If parse OK → Decision 2 viable, proceed to Phase 2 as planned
  - If parse fails → Decision 2 降级：skip Boss core change, keep UI-layer dynamic placeholder only
- [ ] 1.4 **Pre-flight probe** (Manager): read `manager-node.ts` LLM call; assess whether response is JSON-structured (like Boss) or free-form. Record JSON-parse risk; if parse is fragile, Decision 3 降级 same way
- [ ] 1.5 Write Phase 0 findings into `verification.md`:  baseline chunk distribution, Decision 2 viability, Decision 3 viability, any降级 plan

## 2. Phase 1 — UI layer (StreamingBubble.tsx)

- [ ] 2.1 Add a dedicated `reasoningBuffer` ref alongside the existing `contentBuffer` in `StreamingBubble.tsx`; both updated by chunk handler based on `channel`
- [ ] 2.2 Introduce a `<ReasoningRegion>` render inside the bubble — muted typography, collapsible (default: expanded while no content, collapsed once content arrives)
- [ ] 2.3 Reasoning region progressive reveal: each chunk arrival appends to `reasoningBuffer` and triggers the same manual render-tick mechanism content uses (no React state for chunks — ref + forced render)
- [ ] 2.4 Dynamic pre-chunk placeholder: when `llm.call.started` has fired and neither buffer has text, render `<PlaceholderWithTimer nodeName={activeRun.node} elapsedMs={elapsedMs} />` (cursor pulse + shimmer background + whole-second elapsed counter)
- [ ] 2.5 Elapsed counter must not cause per-frame re-render — use a 1 s `setInterval` inside the placeholder component with cleanup on unmount
- [ ] 2.6 Extend `VISIBLE_STREAMING_NODES` set to include `boss`, `manager`, `boss_summary`, `employee`, `hr` (verify it already covers `boss_summary` / `hr` / `employee`; add `manager` and confirm `boss` is there)

## 3. Phase 2 — Core layer (opt-in reasoning-only stream)

- [ ] 3.1 Based on Phase 0 findings, if Boss Decision 2 viable: in `packages/core/src/agents/boss-node.ts`, replace the delegate-path `.generate()` call with `recordedLlmStream` (mirror the pattern at `boss-node.ts:297-334`); callback emits **only** `channel:'reasoning'` chunks, NOT content; extract JSON decision from `streamResult.fullContent` with same parser as baseline
- [ ] 3.2 If Boss Decision 2 降级: skip 3.1, leave delegate-path as `.generate()`; UI-layer dynamic placeholder carries the entire UX improvement for Boss
- [ ] 3.3 Based on Phase 0 findings, if Manager Decision 3 viable: in `packages/core/src/agents/manager-node.ts`, introduce the same `recordedLlmStream` + reasoning-only callback pattern; verify existing JSON parse unchanged
- [ ] 3.4 If Manager Decision 3 降级: skip 3.3, leave manager-node as-is; UI-layer dynamic placeholder carries Manager UX improvement
- [ ] 3.5 Confirm `hr-node.ts` / `boss-summary-node.ts` / `employee-turn-runner.ts` stream-emit paths are NOT touched (regression guard — they already work correctly)

## 4. Typecheck and build verification

- [ ] 4.1 `pnpm --filter @offisim/shared-types build` — clean (no schema change expected but verify)
- [ ] 4.2 `pnpm --filter @offisim/core build` — clean
- [ ] 4.3 `pnpm --filter @offisim/ui-office build` — clean
- [ ] 4.4 `pnpm --filter @offisim/web build` — clean
- [ ] 4.5 `pnpm typecheck` — all packages green (serial order: shared-types → core → ui-office → web)

## 5. Phase 3 — Live verification on web runtime

- [ ] 5.1 web dev running, 3D mode active, Chrome DevTools MCP attached
- [ ] 5.2 **Golden path**: re-run 500-word essay prompt; confirm:
  - Boss bubble appears, reasoning region starts filling within 2 s of user submit (Decision 2 viable) OR placeholder shows "Drafting... Ns" with visible shimmer/cursor (降级 path)
  - Manager bubble appears after Boss delegates; reasoning region fills (Decision 3 viable) OR dynamic placeholder shows (降级 path)
  - Employee bubble: reasoning region progressively fills (visible chunk-by-chunk growth), then content region progressively fills, both within one bubble with single speaker label
- [ ] 5.3 **Pre-chunk window**: confirm static "Drafting the response..." is never visible for more than 500 ms without motion/elapsed indicator
- [ ] 5.4 **Regression check — existing fix-chat-streaming-ux scenarios still pass**: placeholder→content transition at first chunk, speaker label stable, partial-preserved-on-error still works
- [ ] 5.5 **Direct chat mode**: trigger a direct-employee chat and verify same streaming discipline holds (reasoning progressive + dynamic placeholder)
- [ ] 5.6 **Short prompt**: "say hi" — verify short-response case doesn't regress (reasoning region empty, content region fills fast, placeholder exits immediately)
- [ ] 5.7 **Cost / latency / scene invariants**: confirm footer LAT counter, cost counter, scene executing state remain correct (not regressed by UI changes)
- [ ] 5.8 Capture screenshots of: Boss reasoning streaming, Manager reasoning streaming, Employee reasoning→content transition, pre-chunk dynamic placeholder
- [ ] 5.9 No new console errors / warnings during the golden-path run

## 6. Verification doc + final pass

- [ ] 6.1 `verification.md`: Phase 0 baseline + 降级 decisions, Phase 4 build chain, Phase 5 live scenarios + screenshot paths, any open follow-ups
- [ ] 6.2 `openspec validate fix-chat-streaming-visible-progress` — clean
- [ ] 6.3 Commit (single squash — hook + consumers + docs unless Phase 0 triggered 降级 branching, then split into UI-only + core-layer commits)
- [ ] 6.4 Ready for `/opsx:archive`
