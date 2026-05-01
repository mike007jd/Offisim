## Context

3 backend streams bundled per "consolidate" pattern (mirrors archive `2026-04-26-consolidate-post-overhaul-runtime-followups`). Each stream's surface is known; root causes are diagnosis-first (not pre-judged). Live verify is single release `.app` session at the end so this change doesn't repeat the "ship code, forget verify" failure mode that left 6.9 / 6.11 / 3.5 unticked.

**Surface map**:

- **Stream 1 (`sync_from_claude_code` routing)**: tool + descriptor + resolver locations:
  - `packages/core/src/agents/skill-install-tools.ts:680` (handler)
  - `packages/core/src/agents/skill-install/tool-defs.ts:92` (descriptor)
  - `packages/core/src/skills/skill-source-resolvers/claude-code.ts:74` (resolver throws desktop-only message on web)
  - Boss prompt assembly: find via grep for boss-specific tool list strings; likely in `packages/core/src/agents/boss/`.
- **Stream 2 (workspace_root binding)**: G1 capability `project-workspace-binding` shipped (`projects.workspace_root` column + ProjectCreateDialog + ProjectContextStrip + Tauri dialog/opener plugins + `project_list_dir` / `project_read_file_preview` IPC). Builtin tool sandbox at `apps/desktop/src-tauri/src/builtin_tools.rs` reads `workspace_root` from Rust-side state. Active project's `workspace_root` must reach the Rust state via runtime init + project-switch path.
- **Stream 3 (boss employee context)**: boss system prompt assembly is NOT `employee-prompt-assembly.ts` (that's per-employee). Likely `packages/core/src/agents/boss/system-prompt.ts` or sibling. Roster injection wires into `repos.employees.findByCompany(activeCompanyId)`.

## Goals / Non-Goals

**Goals**:
- Each stream lands as an independently reviewable diff; merge order matters only for Streams 1 + 3 which share the boss prompt assembly file (do them in same subagent / sequential).
- One master live-verify session covers all 3 streams + T2.4 6.9 / 6.11.
- Streams 2 + 3 land observability events (typed `workspace-binding.unavailable` / `boss.employee-context.empty`) so future regressions surface in `runtime_event` log instead of silent miss.

**Non-Goals**:
- T2.2 (a) chat panel "Attach file" affordance — separate brainstorm change.
- T2.2 (b) chat outcome formatter — split into companion change `fix-skill-install-outcome-chat-surface`.
- Refactor of boss prompt assembly architecture — fix the immediate gap, don't restructure.
- New skill source kinds.
- Auto-tests — entire validation is master live verify per repo discipline.

## Decisions

### Decision 1 — Stream 1: investigate first (path-(a)), fall back to guard message (path-(b)) if 1h budget blown

Two viable fixes:
- **Path (a)**: Boss can't pick `sync_from_claude_code` because the Web prompt either omits the descriptor, gates it by a wrong runtime check, or ranks it below `install_skill_from_git`. Fix: ensure tool descriptor reaches Web boss + write a deterministic harness scenario in `packages/core/harness/scenarios/`.
- **Path (b)**: Tool reachable but resolver throws `'requires desktop runtime'` — surface this as typed `'desktop-only-tool'` error category → boss replies `"This skill source requires the desktop app."` (no silent miss).

**Rule**: do (a) first, time-box at 1h. If blown, switch to (b). Mark fallback explicitly in tasks.md so subagent doesn't bottomless-debug.

**Why**: (a) is the right fix if achievable; (b) is the fallback that ships a clear UX even when (a) is too deep. Both are spec-acceptable per the Requirement (Web reachability OR clear typed guard).

### Decision 2 — Stream 2: diagnose order = Rust state → project switch → runtime context

Failure surface is `'no project workspace root is bound'` from builtin tools (Rust). Three possible upstream causes:
1. Rust state never received `set_workspace_root(path)` because runtime init forgot to call it.
2. Project-switch handler doesn't propagate `workspace_root` change to Rust on company / project switch.
3. Runtime context (`packages/core/src/runtime/runtime-context.ts`) doesn't carry the active project's `workspace_root` into the Tauri call site.

**Diagnose 1 → 2 → 3**: cheaper to find first (Rust eprintln), most likely root cause first. Once located, fix is local.

**Add observability**: `runtime_event` `workspace-binding.unavailable` with payload `{ companyId, projectId, expectedWorkspaceRoot, missingAt: 'rust-state' | 'runtime-context' | 'project-switch' }`. Fire ONCE per `(companyId, projectId)` per session to avoid log spam.

### Decision 3 — Stream 3: boss prompt assembly site is NOT employee-prompt-assembly.ts

`employee-prompt-assembly.ts` is for individual employee prompts (per-employee context, including Available skills section). The boss has its own assembly path — find it via grep for boss-specific prompt strings. Likely fix is 1-2 lines wiring `repos.employees.findByCompany(activeCompanyId)` results into the boss system prompt template. Roster format: minimum `name + role_slug` per row (free-form structure within section).

**Add observability**: `boss.employee-context.empty` payload `{ companyId, employeeCount: 0, expectedAtLeast: 1 }` — fires only when DB has employees in active company but boss prompt receives 0. Empty company is benign and does NOT fire the event. Fire ONCE per `companyId` per session.

### Decision 4 — Streams 1 + 3 share boss prompt assembly file → single subagent / sequential

Both streams modify `packages/core/src/agents/boss/system-prompt.ts` (or wherever boss prompt is composed). To avoid merge conflict, they run sequentially in the same subagent OR in adjacent subagents that read each other's diff. **Recommendation**: same codex subagent does Streams 1 + 3 back-to-back; Stream 2 (Rust + runtime layer) runs in parallel as a separate subagent.

### Decision 5 — Master live-verify = single release `.app` session

Codex-friendly script in tasks.md final section. ~7-8 screenshots covering all 3 streams + T2.4. Single session + screencapture window-level + `view_image` self-check pattern from 2026-05-01 verify discipline.

Web verify for Stream 1 goes via Chrome devtools / playwright (NOT computer-use — main session avoids that per CLAUDE.md feedback rule). Codex agent is permitted to use computer-use for Tauri release `.app` shells, which is exactly the use case for this verification batch.

## Risks / Trade-offs

- **Risk**: Stream 1 path-(a) investigation goes past 1h budget → **Mitigation**: documented fallback to path-(b) in Decision 1; subagent must respect time budget.
- **Risk**: Streams 1 + 3 same-file merge surface → **Mitigation**: Decision 4 — sequential within same subagent.
- **Risk**: Stream 2 root cause turns out to be a shared infrastructure issue (e.g., runtime context layer affects multiple tools) → **Mitigation**: subagent reports root cause to consolidator; if cross-cutting, scope check before continuing.
- **Risk**: Master live verify fails on a single stream and cascades doubt on others → **Mitigation**: tasks.md verify section labels each scenario by stream id (1.x, 2.x, etc.) so failure attribution is trivial; PASS rows can be batch-ticked, FAIL rows escalate single-stream re-investigation.
- **Trade-off**: Bundling 3 streams is heavier per change than splitting — but the "ship code, forget verify" failure of 2026-04-26 cycle is exactly what consolidation prevents (single big verify gate by construction).

## Migration Plan

No data migration. Code-only. Rollback = `git revert` of the merge commit.

## Open Questions

- Stream 1: is `sync_from_claude_code` Web-supportable at all (vs always desktop-only)? Codex agent host runs in sidecar; resolver path may need filesystem access Web doesn't have. **Resolution**: subagent answers in stream 1 task investigation note before choosing (a) vs (b).
- Stream 2: is the binding in Rust state per-runtime-instance or global? **Resolution**: subagent reports state shape during diagnosis; spec scenario is binding-per-active-project regardless of internal storage shape.

## Stream 1 Decision Note

Path (a) completed. The Web employee execution surface already exposes the skill install tool descriptors when `skillStagingManager` and `skillLoader` are present; there was no prompt-time filter hiding `sync_from_claude_code`. The actual gap was the Web resolver returning the generic `not-supported-in-web` category, leaving the chat outcome dependent on the model rephrasing a JSON tool result. The fix keeps runtime guard as SSOT: Web still sees the real `sync_from_claude_code` tool, the resolver returns typed `desktop-only-tool`, and the employee tool loop converts that typed result into the fixed boss-visible reply `"This skill source requires the desktop app."`

The deterministic harness scenario `boss-tool-routing-sync-from-claude-code-web` verifies a real boss-to-employee prompt path: boss routes the request, PM creates a task, the employee LLM turn receives a tool list containing `sync_from_claude_code`, invokes it, and the Web runtime guard produces the typed reply. The assertion does not rely on a mocked final LLM sentence; the final copy is produced by the typed tool-result branch.

## Stream 3 Diagnosis Notes

Boss prompt assembly is `packages/core/src/agents/boss-node.ts`, not `employee-prompt-assembly.ts`. The first boss routing prompt already queried `repos.employees.findByCompany(companyId)` and included a filtered `Available employees` section, but the second `BOSS_DIRECT_REPLY_PROMPT` call did not include any employee roster. For direct user questions such as `"who's on my team?"`, the route can correctly be `direct_reply`; the final answer model then saw only the user request plus the routing intent, not the actual roster, so it could plausibly claim it had no employee database access.

The fix adds an active-company roster section derived from the same `findByCompany(companyId)` rows and injects it into both boss routing and direct-reply prompts. The roster includes at least `name + role_slug` per row, plus employee id and external brand when present. `boss.employee-context.empty` is emitted once per company session only when DB rows are non-empty but the prompt-injected roster count is zero; benign empty companies do not emit it.

## Stream 2 Diagnosis Notes

Rust state was not the empty layer: `builtin_tools.rs` does not hold an active-project binding state; each file/shell command loads non-empty `projects.workspace_root` rows from SQLite and enforces the sandbox against those roots.

Project switch was partially healthy: the graph thread carries `project_id` for the active project, and legacy project-created threads may also be discoverable through `projects.thread_id`. The missing hop was runtime context / builtin tool dispatch: `ToolCallRequest` did not carry the current thread into the builtin file/shell adapter, so `createTauriBuiltinFs` / `createTauriShellExec` could only infer roots from company-level or active-status project rows. That breaks selected-project semantics and can report no bound root even when the selected project has one.

Minimal fix scope: carry `threadId` through builtin tool execution context, resolve the active project through `threads.project_id` first (falling back to `projects.thread_id` for legacy rows), and emit `workspace-binding.unavailable` once per `(companyId, projectId)` session when the runtime-context layer detects a selected project with no usable `workspace_root`. Rust sandbox behavior stays unchanged.

## Live Verify Outcome

Release `.app` verification used `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` launched by `open -b com.offisim.desktop`, with MiniMax-M2.7 as the provider. Dev webview validation was not used.

- Stream 3 roster: PASS. `7.3-stream3-roster.png` shows the boss listing active employee names from the left rail; `7.4-stream3-alex.png` shows Alex Chen recognized by name.
- Stream 2 workspace root: PASS. `7.5-stream2-readfile-pass.png` shows a bound project (`workspace_root=/Users/haoshengli/Seafile/WebWorkSpace/Offisim`) and a README summary without the `'no project workspace root is bound'` error. The runtime event table has no healthy-binding `workspace-binding.unavailable` event; the only such event is the expected null-project negative case. `7.6-stream2-unbound-error.png` captures that negative path and the persisted payload `{ companyId, projectId, expectedWorkspaceRoot, missingAt: 'runtime-context' }`.
- T2.4 self-authoring: PASS. `7.7-t2.4-created.png` captures the create confirmation path, and DB/vault checks confirmed a `source_kind='self-authored'` row plus the employee-scope `SKILL.md`. `7.8-t2.4-rejection.png` captures `forbidden-namespace` frontmatter rejection. `7.9-t2.4-mismatch.png` captures the release app mismatch path: Maya was coerced to pass `targetEmployeeId='alex-chen-id'`, no staging preview appeared, and chat surfaced `Skill author must match the active chat employee.`
- Stream 1 web runtime: PASS via deterministic harness, not dev browser. `boss-tool-routing-sync-from-claude-code-web` proves Web boss routes to `sync_from_claude_code`, the web resolver returns `desktop-only-tool`, and chat output is `This skill source requires the desktop app.`
- Stream 1 desktop runtime: PASS. `7.11-stream1-desktop-pass.png` captures the release app staging confirmation for project-local Claude Code skill `.claude/skills/offisim-live-verify-sync/SKILL.md`, with source `Claude Code` and company scope, proving no desktop-only guard fired in the desktop runtime.

Additional validation:

- `pnpm --filter @offisim/core build`
- `pnpm --filter @offisim/web typecheck`
- `pnpm --filter @offisim/web build`
- `pnpm --filter @offisim/desktop build`
- `node scripts/harness-contract.mjs`
- `node scripts/harness-replay.mjs`
