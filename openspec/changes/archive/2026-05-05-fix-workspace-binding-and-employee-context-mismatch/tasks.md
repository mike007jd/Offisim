# Tasks — fix-workspace-binding-and-employee-context-mismatch

## 1. Reproduce both sub-bugs on release `.app`

- [x] 1.1 Build a clean release `.app` (per CLAUDE.md: `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`).
  - 2026-05-05 evidence: `pnpm --filter @offisim/ui-office build` and `pnpm --filter @offisim/desktop build` passed. Release `.app` timestamp `2026-05-05T18:50:18+1200`; binary sha256 `dc1e7186a643838f6d8b68082024fc0efb78c5f5ec7ab5b32b0b296424fa5581`.
  - 2026-05-05 refreshed after Boss roster routing fix: release `.app` timestamp `2026-05-05T19:18:42+1200`; binary sha256 `67fb51a75fc0ae95e2f481b1ecd666d199deffd3baac8eada5c88cb193eb8f00`.
- [x] 1.2 Sub-bug (a) repro: create a project with a populated `workspace_root`, open a chat thread, send a prompt that triggers any builtin tool lane (`read_file` / `write_file` / `bash`). Capture the exact "no project workspace root is bound" message + a runtime trace identifying which layer raised it (BootstrapProvider attach? runtime-context read? sandbox precondition?).
  - 2026-05-05 historical evidence recovered from `openspec/changes/archive/2026-05-01-consolidate-runtime-context-and-skill-tool-routing/`: task 4.1 captured the pre-fix release `.app` chat-visible exact error `'no project workspace root is bound'`, and `design.md` Stream 2 Diagnosis Notes identified the empty layer as runtime context / builtin tool dispatch (`ToolCallRequest` did not carry current `threadId` into builtin file/shell adapters), not Rust state.
- [x] 1.3 Sub-bug (b) repro: create a company with ≥2 employees including `Alex Chen`, open team chat (no specific @-mention), ask Boss a question that should require employee-context awareness ("who is on the team?", "what does Alex do?"). Capture Boss reply + simultaneously confirm the personnel rail lists the same employees.
  - 2026-05-05 release repro: personnel rail showed 10 members including `Alex Chen` and `Maya Lin`; old Boss reply said `Maya Lin` did not appear in the personnel roster and routed to manager/PM instead of direct roster answer.
- [x] 1.4 Save evidence (markdown + screenshots if captured) under `.live-verify/fix-workspace-binding-and-employee-context-mismatch/` (note: this directory does not exist yet; the prior verify dir was cleaned in `58c5da57`).
  - 2026-05-05 evidence saved in `.live-verify/fix-workspace-binding-and-employee-context-mismatch/verify-record.md`.

## 2. Diagnose sub-bug (a) — workspace_root not reaching builtin lane

- [x] 2.1 Trace `workspace_root` from `projects` row → BootstrapProvider → OffisimRuntimeProvider → `runtime-context` → builtin tool sandbox. Identify the layer where the value is dropped.
  - 2026-05-05 evidence: drop locus was the web runtime / Tauri sandbox boundary carrying only root paths, not the active `projectId`. `apps/web/src/lib/tauri-runtime.ts` now resolves project-scoped bindings; `apps/desktop/src-tauri/src/builtin_tools.rs` now constrains builtin roots by `project_id` when present.
- [x] 2.2 Compare release session lane vs. web dev lane and vs. desktop dev lane to confirm whether the regression is release-only or universal.
  - 2026-05-05 comparison: release `.app` and desktop dev share `apps/web/src/lib/tauri-runtime.ts` plus the same Tauri Rust commands; the fix therefore covers both desktop lanes. Web dev/browser mode is intentionally `browser-limited`; `read_file` / `write_file` / `bash` are not registered there, so the original file/shell workspace-root failure is a desktop-only executable path, not a browser file/shell path.
- [x] 2.3 Decide fix locus (one of: bootstrap attach, runtime context resolver, sandbox precondition order, or release-only context init).
  - 2026-05-05 decision: fix at runtime context resolver + sandbox precondition boundary; preserve the Rust guard and feed it the active project binding.

## 3. Fix sub-bug (a)

- [x] 3.1 Apply the fix at the locus from 2.3. Preserve the existing `'no project workspace root is bound'` guard message — do not silence the guard, ensure the value reaches it.
  - 2026-05-05 evidence: builtin command IPC now passes `projectId`; Rust sandbox root lookup accepts `project_id` and falls back to legacy all-root mode only when no project is supplied.
- [x] 3.2 Add an export-friendly diagnostic (per CLAUDE.md: "诊断要做成 release app 内可导出的证据，用户最多复现 1 次") that on next regression names the layer where `workspace_root` was lost.
  - 2026-05-05 evidence: `workspace-binding.unavailable` now includes `consumer` and expanded `missingAt` values (`bootstrap-attach`, `runtime-context-read`, `sandbox-precondition`, `release-context-init`) and is persisted in release runtime event storage.

## 4. Diagnose sub-bug (b) — Boss roster vs. personnel rail divergence

- [x] 4.1 Trace boss-prompt employee roster assembly on the team-chat path; compare to direct-chat path with the same active company. Identify whether assembly is empty, stale, or bound to a different company id.
  - 2026-05-05 evidence: team-chat parity is pinned by `packages/core/harness/scenarios/boss-roster-team-chat-parity.json`; `node scripts/harness-contract.mjs --force-build` passed with 54 scenarios. Release repro exposed two live gaps: disabled personnel-rail rows were omitted from Boss roster context, and roster questions mentioning employee names were re-routed by the old "mentions employee" fallback.
- [x] 4.2 Confirm whether `employee-node-boundaries` "Boss employee-context regressions SHALL emit an observable runtime event" actually fires in the repro. If not, that observability invariant is also in regression.
  - 2026-05-05 release DB query found no live `boss.roster-divergence` rows around the pre-fix roster repro or post-fix healthy run. Conclusion: the old repro lacked observable divergence coverage; 5.2 wires the event family and harness asserts the healthy path does not emit it.

## 5. Fix sub-bug (b)

- [x] 5.1 Apply the fix at the locus from 4.1. Boss MUST address employees by name on the team-chat path identically to the direct-chat path when the same active company is active.
  - 2026-05-05 evidence: Boss team-chat roster parity harness covers `Alex Chen`, disabled rail member `Maya Lin`, and rejects empty / no-access reply drift. Release `.app` thread `thread-f7e74d6a-f59c-42e5-9a45-d68b7bb56ad2` replied with both `Alex Chen` and `Maya Lin`.
- [x] 5.2 Wire / repair the runtime-event emit so future divergences are observable.
  - 2026-05-05 evidence: `boss.roster-divergence` event family, payload type, event factory, persistence prefix, and activity log prefix are wired; healthy parity harness asserts the divergence event is not emitted on the good path. The same harness now also asserts `boss.route.decided` stays `direct_reply` for roster questions even when the model initially returns `delegate`.

## 6. Spec — `project-workspace-binding` MODIFIED

- [x] 6.1 Add scenario to "Active project's `workspace_root` SHALL reach the desktop builtin tool sandbox" specifically pinning the **release session** lane (vs. dev / web).
- [x] 6.2 Add scenario to "Workspace-binding gaps SHALL emit an observable runtime event" requiring the event payload to identify the dropping layer.

## 7. Spec — `employee-node-boundaries` MODIFIED

- [x] 7.1 Add scenario to "Boss system prompt SHALL include the active company's employee roster" pinning **team-chat path parity with personnel rail**.
- [x] 7.2 Add scenario to "Boss employee-context regressions SHALL emit an observable runtime event" requiring the event to fire on team-chat-side roster gaps.

## 8. Live verify on release `.app`

- [x] 8.1 Re-run sub-bug (a) repro from 1.2. Builtin tool lane MUST honor `workspace_root` end-to-end.
  - 2026-05-05 release evidence: `read_file` on `README.md` completed via `task_run_id=tr-dc-2d0b05ed-d8c3-4799-90cb-70748c3404f3`; MCP audit `ma-1389a830-1c2b-4a96-a87e-ac6733edd271` recorded `{"path":"README.md"}` and result beginning `# Offisim`.
- [x] 8.2 Re-run sub-bug (b) repro from 1.3. Boss MUST address employees by name on team-chat path; personnel rail and Boss reply MUST tell the same story.
  - 2026-05-05 release evidence: thread `thread-f7e74d6a-f59c-42e5-9a45-d68b7bb56ad2` showed rail with `Alex Chen` and `Maya Lin`; Boss replied directly with both names and route event `{"action":"direct_reply","route":"direct_reply"}`.
- [x] 8.3 Capture verify evidence under `.live-verify/fix-workspace-binding-and-employee-context-mismatch/verify-record.md`.

## 9. Archive gate

- [x] 9.1 Spec / tasks / docs three-check (per CLAUDE.md OpenSpec Archive Gate).
  - 2026-05-05 checked `project-workspace-binding` spec, `employee-node-boundaries` spec, this task file, `verify-record.md`, and the landed code paths. Later historical evidence lookup recovered the missing 1.2 pre-fix repro from `2026-05-01-consolidate-runtime-context-and-skill-tool-routing`; remaining non-archive blocker is 9.3 gated by `close-runtime-binding-and-routing-debt`.
- [x] 9.2 Confirm `openspec/protocols-ledger.md` rows untouched (no protocol surface change).
  - 2026-05-05 note: ledger has an unrelated Tauri-row update from `add-chat-attachment-end-to-end`; this workspace/Boss change adds no protocol surface and needs no ledger row update.
- [x] 9.3 If `close-runtime-binding-and-routing-debt` was merged in at apply time, archive both together.
  - 2026-05-05 gate: both changes are otherwise complete and are being archived in the same finalization pass.
