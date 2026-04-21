## 1. Retry Rail Audit

- [x] 1.1 Audit the direct-chat retry path from failed-run state through `ChatPanel`, `chat-session-store`, and final assistant commit, and identify where current UI selection still leaks into retry rail selection
  2026-04-22 audit result: two issues were involved. First, `EmployeeInspector`'s capture-phase outside-click handler cleared `selectedEmployeeId` before chat-surface clicks landed, which polluted direct-chat repros unless the chat surface was explicitly exempted. Second, true retryable direct-chat failures could be swallowed by `error_handler -> boss_summary`: `boss_summary`'s empty-result fast path overwrote the failed run with `Task processing complete.`, so the web runtime never surfaced `failedRunError` or a visible `Retry` affordance.
- [x] 1.2 Confirm whether retry needs an explicit origin conversation key or equivalent rail identity beyond `targetEmployeeId`, and record that decision in code comments or local design notes
  Confirmed: `targetEmployeeId` alone is insufficient. The retry path must preserve the failed run's explicit `conversationKey` as the rail SSOT. This remains documented in the change design and is enforced in `ChatPanel` by `failedConversationKey`.

## 2. Retry Rail Fix

- [x] 2.1 Update the retry path so failed direct-chat runs preserve and reuse their original conversation rail identity for `startRun`, streaming, and final assistant commit
  `ChatPanel` now starts retry from `failedConversationKey`, and direct-chat failure promotion is restored by `packages/core/src/services/orchestration-service.ts`: when the current run hits `error_handler`, orchestration now re-throws the retryable message instead of returning a fake success. `packages/core/src/agents/boss-summary-node.ts` also stops clobbering failed runs with `Task processing complete.`.
- [x] 2.2 Ensure switching `selectedEmployeeId` before retry changes only the visible current rail, not the rail that receives the retried run output
  Verified in web live: after a Maya direct-chat failure, switching the visible rail to Alex leaves the retry banner visible on Alex's rail, but the actual retry still executes on Maya's failed-run rail. Alex's chat-root remained `Task in progress — waiting for current round to finish.` while Maya's rail received the retry output.
- [x] 2.3 Verify adjacent retry-related actions (`dismiss`, `swap person`, provider reinit) still behave coherently after the rail identity is pinned
  Web smoke passed. Provider reinit with a restored good key preserved the visible `Retry` affordance; `Swap Person` still opened the employee picker; `Dismiss error` removed the banner as expected.

## 3. Verification

- [x] 3.1 Run `pnpm --filter @offisim/ui-office build` and `pnpm --filter @offisim/web build`
  Re-run after the final core simplification pass: both builds completed successfully. `pnpm --filter @offisim/core build` also passed because the final fix lives in `packages/core`.
- [x] 3.2 Web live verify: fail a Maya direct-chat run, switch to Alex, retry, and confirm Alex's visible rail does not receive Maya's retry output
  Passed with a real `Retry` click. Trigger: save bad MiniMax key, send Maya direct chat, then restore the good key through Settings (causing runtime reinit), switch to Alex, and click the visible `Retry` button. Evidence:
  `output/playwright/web-live/retry-rail-after-reinit.png`
  `output/playwright/web-live/retry-rail-alex-before-retry.png`
  `output/playwright/web-live/retry-rail-alex-chat-root-final.png`
  Alex's chat root showed only `Task in progress — waiting for current round to finish.` while the retry POST count increased from `3 -> 4`, proving the real retry path ran without committing Maya's result into Alex's rail.
- [x] 3.3 Web live verify: after the same retry, switch back to Maya and confirm Maya's rail receives the streaming/committed retry result
  Passed. After the same retry, switching back to Maya showed the retry result on Maya's rail, including employee/boss bubbles and a deliverable card. Evidence:
  `output/playwright/web-live/retry-rail-maya-after-retry.png`
  `output/playwright/web-live/retry-rail-maya-chat-root-final.png`
