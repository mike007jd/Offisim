# PR-B3 evidence

Checked at: 2026-07-19 NZST

## Structural equivalence

- Base: `e083a655e72afe71d32f862e4188ac022a6b0839` (`refactor/B2-host-event-dispatch`).
- `buildLiveConversationTerminalMessage` plus the seven roadmap `persist*` methods were parsed with the TypeScript AST from the base runtime and the new module. Method bodies were exact for 8/8 methods.
- `DesktopNativeAgentRuntime` now owns one `AgentRunPersistence(companyId, repos)` queue and delegates persistence calls to it. Event ordering, terminal checkpoint retry/coalescing, repository instance, and runtime event bus behavior are unchanged.
- Four source-structure harnesses were redirected to the new module or receiver; their original behavioral assertions remain present.

## Recorded plan deviations

- The roadmap names seven `persist*` methods. The extraction also moves the private `buildLiveConversationTerminalMessage` helper because it is used only by `persistRootTerminal` and belongs to the same persistence boundary. Its method body is included in the 8/8 AST-exact proof. No other plan deviation was taken.

## Automated gates

- `pnpm --filter @offisim/desktop-renderer typecheck`: PASS.
- Targeted gates: agent-run-projection 65/65; runtime-conformance 12/12; chat-persistence 18/18 plus 50 interleavings; execution-provenance 29/29; conversation-deletion PASS; stream-watchdog PASS; run-recovery 34/34; project-workspace PASS; Pi agent host PASS; employee-memory 28 checks.
- `node scripts/release-gates.mjs --lane=node`: PASS, 4/4 gates (validate, UI hygiene, security harness, production dependency audit).
- GitNexus `detect_changes(scope=all)` initially reported HIGH because formatter-only runtime hunks made unrelated symbols appear touched. Those hunks were removed; the mandatory rerun reports MEDIUM, 19 changed symbols and five affected flows, all at the intentional persistence-call boundary.
- `pnpm --filter @offisim/desktop build`: PASS. Signed release bundle:
  `/Users/haoshengli/worktrees/offisim-refactor-b/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`.

## Release app persistence proof

- Window identity before interaction: PID `63615`; executable is the exact B3 worktree release binary; title `Offisim`; AX URL `tauri://localhost`; content matched company `W6 Memory Lab` and project `offisim-w6-live-project`.
- Created conversation `thread-d7cb3673-cdf5-4b71-ac07-23fef61f322b` and submitted `回复唯一文本 B3_HISTORY_OK`.
- Durable run `attempt-31eaa975-0b5c-43dc-ac64-6f78d093e66b` reached `completed` (`2026-07-18T13:43:01.098Z` to `2026-07-18T13:43:09.779Z`) with a 1646-byte runtime context.
- The durable event ledger contains the boss row and assistant row `assistant-07273c68-0f3e-4eae-a388-f3ce79d1535a`, whose body is `B3_HISTORY_OK`.
- `before-restart.jpg`: release UI visibly shows the original user message and the complete `B3_HISTORY_OK` assistant response. The 4/4 terminal state was verified from the same Computer Use AX snapshot and is recorded in the durable run evidence above, not claimed as a visible screenshot detail.
- Closed the release window through Computer Use and verified PID `63615` exited.
- Relaunched the exact bundle path; the replacement process is PID `75646`, again with title `Offisim` and AX URL `tauri://localhost`.
- After entering `W6 Memory Lab`, the conversation list showed the new thread as `DONE`. Opening it restored both `回复唯一文本 B3_HISTORY_OK` and `B3_HISTORY_OK`, with no active run and the durable usage projection intact.
- `after-restart.jpg`: restarted release UI showing the complete two-message history.

## Independent review

- Fresh read-only review: APPROVE, 0 blocker / 0 important / 0 actionable nit.
- Reviewer independently rechecked 8/8 moved bodies, all 45 remaining runtime methods under the receiver-only rewrite, old-receiver/call-site absence, the single queue instance, exact `companyId`/`repos` injection, type-only reverse reference, four harness assertion counts (30/113/152/61), targeted gate results, plan-deviation wording, and both release screenshots.
