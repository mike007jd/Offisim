## 1. Target Audit

- [x] 1.1 Audit web direct-chat target flow across `ChatPanel`, runtime send/retry metadata, and interaction follow-up; identified the live readers of `selectedEmployeeId`, `targetKey`, `errorTargetRef`, `interactionTargetRef`, and `lastFailedMessageRef.targetEmployeeId` — the direct-chat drift was concentrated in `ChatPanel` where send-time resolved target and current UI target were mixed during message append / run start / interaction routing
- [x] 1.2 Confirm the live repro path from T2.3 verify notes (`selected Maya` → preview lands on Alex) and record the exact trigger sequence in the change notes — root cause narrowed to post-send fallback reusing current-target refs instead of the originating run target, especially once direct-chat selection changed between send and pending interaction render

## 2. Direct-Chat Target Fix

- [x] 2.1 Refactor `packages/ui-office/src/components/chat/ChatPanel.tsx` so each new direct-chat send captures one resolved target employee and reuses it for message append, `startRun`, error bookkeeping, and interaction routing
- [x] 2.2 Update web interaction / retry plumbing (`apps/web/src/runtime/hooks/useInteractionSync.ts` and any adjacent runtime metadata helpers) so pending interaction, follow-up, and retry prefer the originating run target over the current UI selection — final fix landed in `ChatPanel` by resolving interaction target from the pending request payload first, then falling back to run-origin refs; no separate `useInteractionSync.ts` edit was required after audit
- [x] 2.3 Verify no regression to team chat or mention-hint routing when `selectedEmployeeId` is null — 2026-04-21 web smoke with `@Maya Lin reply with exact token TEAM-HINT-0421 and nothing else.` stayed on the team rail and returned the exact token

## 3. Verification

- [x] 3.1 Run `pnpm --filter @offisim/ui-office build` and `pnpm --filter @offisim/web build`
- [x] 3.2 Web live verify: 2026-04-21 / local Vite dev on `http://localhost:4173` — seeded company-scope `frontend-design` via debug bridge, then selected Maya direct chat and sent `fork_skill` prompt with the exact company `skillId`; preview rendered `Fork skill · frontend-design` with `Employee: Maya Lin`, `resolvedEmployeeName='Maya Lin'`, and screenshot evidence at `output/playwright/web-live/web-direct-maya-fork-check.png`
- [x] 3.3 Web live verify: 2026-04-21 / local Vite dev on `http://localhost:4173` — used a deterministic bad-provider injection (`baseURL=http://127.0.0.1:1/v1`) to fail a Maya direct-chat run, switched selection to Alex, restored the valid MiniMax config, then invoked the same runtime retry path (`retryLastMessage`) without changing the current Alex selection; browser trace logged `dispatch branch` for `Maya Lin` (`employeeId=a02683ea-3205-41d6-8a2b-ab5a7c165e16`) while Alex remained selected, Alex’s rail showed no Maya preview/result, and Maya’s rail carried the retried run’s follow-up side effect. The visible `Retry` button still disappeared across runtime reinit, so this proof used the debug bridge to hit the identical retry path after config recovery.
