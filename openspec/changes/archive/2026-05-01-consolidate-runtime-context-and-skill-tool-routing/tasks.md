## 1. Subagent kickoff

- [x] 1.1 Read proposal.md + design.md + all 3 spec deltas in `specs/` end-to-end before any code touch.
- [x] 1.2 Confirm subagent layout per Decision 4: Subagent A handles Streams 1 + 3 sequentially (shared boss prompt assembly file). Subagent B handles Stream 2 (Rust + runtime layer). T2.4 verify folds into Section 7 (no code subagent).
- [x] 1.3 Each subagent reports root-cause findings + diff scope back to consolidator before next stream is approved.

## 2. Stream 1 — `sync_from_claude_code` boss routing (Subagent A, first)

- [x] 2.1 Investigate (1-hour budget, per Decision 1): inspect Web boss tool prompt assembly (likely `packages/core/src/agents/boss/system-prompt.ts` or sibling — find via grep for boss-specific tool list strings). Is `sync_from_claude_code` listed in the available-tools section? Compare with desktop boss prompt.
- [x] 2.2 Confirm whether the runtime gate is at prompt-time (filter tool list before LLM sees) or at invoke-time (resolver throws). SSOT is invoke-time per Decision 1; remove any prompt-time filter that hides `sync_from_claude_code` from Web boss.
- [x] 2.3 Add a deterministic harness scenario `packages/core/harness/scenarios/boss-tool-routing-sync-from-claude-code-web.json` verifying Web boss reaches the resolver and gets the typed `desktop-only-tool` error. **Contract**: FakeGateway turn must match a real prompt+tool pair (no `finalOutputContains` against mock LLM text). RecordingToolExecutor needs `toolFixtures` for the `sync_from_claude_code` tool call.
- [x] 2.4 (Fallback path-(b), if 2.1-2.3 cannot complete in 1h budget): wrap `claude-code` resolver to throw `SkillInstallError(kind='desktop-only-tool', message)` instead of generic Error; ensure the boss surfaces this category as the Decision 1 user-facing copy. Document the fallback decision in design.md addendum `## Stream 1 Decision Note`. Path (a) completed; fallback was not needed, but the typed category/user-facing copy is still implemented.
- [x] 2.5 Ensure the `desktop-only-tool` error category renders in chat as `"This skill source requires the desktop app."` (typed boss reply, not error toast). Check tool-error → chat-reply formatter to confirm the category branches correctly.
- [x] 2.6 Build: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`.

## 3. Stream 3 — boss employee context plumbing (Subagent A, second — same boss prompt file)

- [x] 3.1 Locate boss prompt assembly site (likely `packages/core/src/agents/boss/system-prompt.ts` or sibling — same file Subagent A touched in Stream 1). Note: this is NOT `employee-prompt-assembly.ts` (per-employee).
- [x] 3.2 Confirm whether the boss prompt currently queries `repos.employees.findByCompany(activeCompanyId)` and injects roster. If missing: add the injection. If present but receiving 0 rows: trace why (wrong companyId? stale cache? race with company switch?).
- [x] 3.3 Document root cause in design.md addendum `## Stream 3 Diagnosis Notes`.
- [x] 3.4 Implement minimal fix in the prompt assembly. Roster format is freeform but MUST include at minimum `name + role_slug` per row.
- [x] 3.5 Add typed event `boss.employee-context.empty` per spec Requirement #2: emit ONCE per `companyId` session when DB has employees but prompt receives 0; payload `{ companyId, employeeCount: 0, expectedAtLeast: 1 }`. Add factory in `packages/core/src/events/`, payload type in `packages/shared-types/src/events/`. Re-export through `event-factories.ts` / `index.ts` / `browser.ts`.
- [x] 3.6 Wire event emission point at the prompt assembly site (only when DB row count > 0 AND prompt-injected count = 0).
- [x] 3.7 Build: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`.

## 4. Stream 2 — workspace_root binding plumbing (Subagent B, parallel to Subagent A)

- [x] 4.1 Reproduce on release `.app`: open with active project that has bound `workspace_root` (use existing project under `Release Verify Company` with `workspace_root = /Users/haoshengli/Seafile/WebWorkSpace/Offisim` or create one), invoke a boss tool that hits `read_file`. Capture exact error string + stack. Reproduced as chat-visible `'no project workspace root is bound'` before the runtime-context/thread-project fix; final positive/negative release proof is in 7.5/7.6.
- [x] 4.2 Diagnose layer-by-layer per Decision 2 (order: Rust state → project switch → runtime context):
  - Layer 1: `apps/desktop/src-tauri/src/builtin_tools.rs` — does the Rust state have `workspace_root` set when the tool fires? (Add temp `eprintln!` if needed; remove before commit.)
  - Layer 2: project-switch handler (find via grep for `set_workspace_root` or similar IPC name) — does it fire on project switch?
  - Layer 3: `packages/core/src/runtime/runtime-context.ts` + `apps/web/src/lib/tauri-runtime.ts` — does the active project's `workspace_root` reach the place that calls into Tauri builtin tools?
- [x] 4.3 Document root cause in design.md addendum `## Stream 2 Diagnosis Notes`: which layer was empty, why, and the minimal-change fix scope.
- [x] 4.4 Implement fix at the diagnosed layer. Stay within the failing layer; do NOT refactor adjacent code.
- [x] 4.5 Add typed event `workspace-binding.unavailable` per spec Requirement #2: emit ONCE per `(companyId, projectId)` session-tuple from the layer that detects the miss; payload `{ companyId, projectId, expectedWorkspaceRoot, missingAt }` where `missingAt ∈ {'rust-state', 'runtime-context', 'project-switch'}`.
- [x] 4.6 Add factory + payload type (shared-types + core); wire emission point. Re-export through event barrels.
- [x] 4.7 Build: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core build && pnpm --filter @offisim/install-core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build && pnpm --filter @offisim/desktop build`.

## 5. Consolidator merge (after all subagents finish)

- [x] 5.1 Read each subagent's diagnosis notes from design.md addenda. Confirm Streams 1 + 3 boss-prompt diff is internally consistent (one PR-level patch on the boss prompt file, not two).
- [x] 5.2 If Stream 2 subagent reports a root cause shared with anything Streams 1/3 touched, halt and re-plan; otherwise proceed.
- [x] 5.3 Single merged working tree: all event factories + payload types + emit points + boss prompt assembly fix + Rust binding fix.

## 6. Validation gates (post-merge)

- [x] 6.1 Serial build: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/install-core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`.
- [x] 6.2 `pnpm --filter @offisim/web typecheck`.
- [x] 6.3 `pnpm --filter @offisim/platform typecheck` (no regression).
- [x] 6.4 `pnpm openspec validate consolidate-runtime-context-and-skill-tool-routing --strict`.
- [x] 6.5 If Stream 1 added a deterministic harness scenario: run `node scripts/harness-contract.mjs` and confirm the new scenario loads + passes invariant assertions (no LLM-mock-content self-justification per repo discipline).

## 7. Master live verify (release `.app`, single session, codex)

- [x] 7.1 Build release: `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`. Confirm origin-sync prebuild passes. Note new bundle path / mtime.
- [x] 7.2 Start `pnpm --filter @offisim/platform dev` (port 4100). Open release `.app`. Use `Release Verify Company` (already exists from 2026-05-01 verify) or create a new one.
- [x] 7.3 **Stream 3 verify (roster)** — In team chat, ask `"who's on my team?"`. **Expected**: boss reply lists employee names matching left-rail list. **NOT acceptable**: `"no employee database access"` or any synonym. Window-level screenshot via `screencapture -l <Offisim window id>` → `.live-verify/runtime-context-and-tool-routing/7.3-stream3-roster.png`. Open with `view_image` to confirm window is Offisim.
- [x] 7.4 **Stream 3 verify (specific name)** — Ask `"is Alex Chen available?"`. **Expected**: boss acknowledges Alex Chen by name. Screenshot → `7.4-stream3-alex.png`.
- [x] 7.5 **Stream 2 verify (positive)** — Ensure active project has `workspace_root` bound (use existing or create one pointing to repo root). Ask boss `"read README.md and summarize"`. **Expected**: builtin `read_file` returns content; boss replies with summary. **NOT acceptable**: `'no project workspace root is bound'`. Screenshot → `7.5-stream2-readfile-pass.png`. Verify the diagnostic event does NOT fire (no `workspace-binding.unavailable` in runtime event log when binding is healthy).
- [x] 7.6 **Stream 2 verify (negative)** — Switch to a project with null `workspace_root` (or unbind via Edit project). Ask same `read README.md` request. **Expected**: typed error `'no project workspace root is bound'`; ONE `workspace-binding.unavailable` event in runtime event log with populated payload (check via Activity Log workspace if available, else log file). Screenshot → `7.6-stream2-unbound-error.png`.
- [x] 7.7 **T2.4 6.9 verify (happy path)** — In direct chat with an employee, prompt `"create a skill that summarizes long pages"`. Boss/employee invokes `create_skill_from_scratch`; confirm in `SkillInstallConfirmBubble`; vault SKILL.md exists at expected path; `skills` row inserted with `source_kind='self-authored'`. Screenshot → `7.7-t2.4-created.png`.
- [x] 7.8 **T2.4 6.10 verify (frontmatter rejection paths)** — Re-prompt with frontmatter `offisim.priority: high` → expect `forbidden-namespace` error rendered + Retry CTA. Screenshot → `7.8-t2.4-rejection.png`. (Cross-checks Stream 1's chat error formatter is healthy.)
- [x] 7.9 **T2.4 6.11 verify (mismatch path)** — In direct chat with Maya, simulate / coax LLM into passing wrong `targetEmployeeId='alex-chen-id'`. **Expected**: tool errors with mismatch category, no staging, error surfaced. Screenshot → `7.9-t2.4-mismatch.png`.
- [x] 7.10 **Stream 1 verify (Web side via deterministic web-runtime harness, no dev browser)** — `boss-tool-routing-sync-from-claude-code-web` covers Web boss routing to `sync_from_claude_code` and typed `"This skill source requires the desktop app."` output. This replaces the original dev-browser screenshot step per repo rule forbidding dev validation.
- [x] 7.11 **Stream 1 verify (desktop happy path)** — Same prompt on release `.app` with Claude Code skill present at known path. **Expected**: tool runs, staging interaction appears for review, no `desktop-only-tool` error. Screenshot → `7.11-stream1-desktop-pass.png`.
- [x] 7.12 Stop platform service. Confirm port 4100 freed. Save evidence dir `.live-verify/runtime-context-and-tool-routing/`. Append `## Live Verify Outcome` section to design.md addendum: PASS/FAIL per stream + screenshot list.

## 8. Archive readiness

- [x] 8.1 Cross-read proposal / design / specs / changed code comments / `packages/core/CLAUDE.md` / `apps/desktop/CLAUDE.md`. Add SSOT notes for: (a) Rust-side workspace_root binding lifecycle; (b) boss employee roster prompt section anchor; (c) `desktop-only-tool` typed error category.
- [x] 8.2 Re-run `pnpm openspec validate consolidate-runtime-context-and-skill-tool-routing --strict`.
- [x] 8.3 Update `openspec/protocols-ledger.md` only if any external protocol is touched (expected: none, confirm only). Confirmed no external protocol / SDK version contract was touched; no ledger row update needed.
- [x] 8.4 Single commit summarizing all 3 streams. Then `/opsx:archive`.
