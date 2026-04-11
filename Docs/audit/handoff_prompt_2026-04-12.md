# Handoff prompt — Offisim ship-grade audit resume

Paste everything below this line as the **first message** of a fresh Claude Code session (after `/compact` or a new session entirely). It is self-contained: the resuming agent does not need any prior conversation history.

---

## Task

You are resuming a ship-grade audit of the Offisim monorepo at `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`. This is a pnpm monorepo with 16 packages preparing for 1.0-rc.1. The audit is structured as 6 phases. Phases 1, 2, and 6 are done and committed. You are continuing from **Phase 3 (robustness audit)**.

**First, read these files in this order** before touching anything else:

1. `Docs/audit/00_master_plan_2026-04-12.md` — umbrella + **locked framing (F1-F5)** you must not violate
2. `Docs/audit/01_discovery_2026-04-12.md` — Phase 1 discovery snapshot (workspace map, package inventory)
3. `Docs/audit/02_mockup_hunt_2026-04-12.md` — Phase 2 findings (C1/C2/H1/H2/H3/M1-3/L1-4 with locked Phase 5 actions)
4. `Docs/audit/06_a2a_interop_plan_2026-04-12.md` — Phase 6 2.0 roadmap (NOT for 1.0 ship, context only)
5. `CLAUDE.md` — repo conventions + gotchas
6. `/Users/haoshengli/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/MEMORY.md` — session history memory

---

## The locked framing (non-negotiable, condensed)

**F1. Core employee runtime is `anthropic-adapter` / `openai-adapter` / `subscription-adapter (ACP)` ONLY.** These are architecturally load-bearing, do not audit them as dead code / mockup / refactor candidates.

**F2. `packages/core/src/a2a/` and `packages/core/src/gateway/openclaw-client.ts` are sleeping assets** (future external-agent interop extension points). They are NOT architecture, NOT product features, NOT deprecated. Zero callsite, zero instantiation, zero UI wiring. Phase 5 leaves them untouched. Maximum permitted visibility in CLAUDE.md is ONE line in Gotchas. Do not write architecture docs. Do not add `@deprecated`. Do not promote to first-class citizens.

**F3. Ship blocker = user-facing UI that pretends to work while backed by fake logic.** Silent unwired backend code is NOT a ship blocker.

**F4. Scope is 1.0-rc.1 ship readiness.** NOT bundle size / repo dedup / test coverage / Scene V2 / Known Debt items / Phase 6 A2A implementation. If you find something outside scope, log it as "post-1.0" and do not act.

**F5. Phase 5 changes are small, surgical, reversible.** No refactors. No new features. No architecture docs (except the one-line CLAUDE.md addendum specified in Phase 2). Ordered commits, each tied to a finding ID. Auto-pause every 5 commits for user status.

**If you believe any of F1-F5 is wrong, STOP and ask the user. Do not act against the framing.**

---

## Decisions already made (do NOT re-ask)

- A2A is the preferred future external-agent interop path over OpenClaw WebSocket v3. Recorded in Phase 6.
- A2A + OpenClaw code = sleeping assets, no deprecation, no promotion, no architecture doc.
- Phase 5 deletes `useOpenClaw` hook + `OpenClawSettings.tsx` + `LobsterInvitePanel.tsx` + Gateway tab. Backend `openclaw-client.ts` stays untouched.
- Phase 5 deletes `install-mock.ts` + 3 `MOCK_INSTALL_PLAN` fallback branches + fixes stale `offisim-runtime-context.tsx:42` comment.
- `tasks/get` A2A `-32001` error is NOT fixed in 1.0 (H2 downgraded to LOW no-fix).
- Scene `office3d-employees.tsx:311-312` lobster render hooks stay (dead but consistent with sleeping-asset).
- `EmployeeCreatorOverlay` 3D avatar toggle hidden (not labeled "Coming Soon").

---

## Current state (as of 2026-04-12 mid-audit)

- Phase 1 committed (`1386e61`): discovery snapshot written
- Phase 2 committed (`bdf00ee` + revision): mockup hunt findings locked
- Phase 6 committed (along with master plan): A2A 2.0 roadmap drafted
- **Phase 3 (robustness audit): not started** ← YOU ARE HERE
- Phase 4 (feature sanity check): not started
- Phase 5 (cleanup execution): not started, preview checklist in master plan section "Consolidated Phase 5 cleanup checklist"

Verify current git state with `git log --oneline -10` before assuming anything.

---

## Your immediate next action: execute Phase 3 — Robustness Audit

**Goal**: Find real bugs (not mockups) that could crash / leak / corrupt in production. READ-ONLY — no code edits in this phase.

**Scope**: five sub-areas, scan in order:

1. **Async / Promise / Effect** — `apps/web` + `packages/ui-office` + `packages/core`
   - All `async` functions: do awaits have outer try/catch?
   - `.then()` without `.catch()`
   - `useEffect` subscriptions without cleanup return
   - `setTimeout` / `setInterval` without clear
   - `addEventListener` without matching `removeEventListener`
   - `AbortController` created but never aborted
   - LLM adapter / fetch calls: timeout + abort signal coverage

2. **Concurrency / race / state machine**
   - `useState` followed by async setState on unmounted component
   - Stale `useRef` values
   - Drizzle / better-sqlite3 write paths inside `transact()`?
   - LangGraph nodes: interrupt / resume / checkpoint rollback handling
   - `HookRegistry` (sync serial) vs `EventBus` (async fire-and-forget) — correct usage

3. **Resources / connections / memory**
   - `OffisimRuntimeProvider` dispose path
   - `primeEventLogStore` cleanup → `disposeEventLogStore`
   - Scene 3D dispose: geometry / material / texture
   - WebSocket / SSE / gRPC / Tauri IPC close paths

4. **Input boundaries**
   - User input validation (chat, skill binding, manifest import, SOP JSON, company form)
   - `JSON.parse` without try/catch
   - Unchecked array indexing (CLAUDE.md says `noUncheckedIndexedAccess` is on, but verify)
   - NaN / Infinity guards on numeric input

5. **Platform boundaries**
   - `node:*` protocol imports only in desktop paths
   - `@tauri-apps/*` imports only in desktop paths
   - `window.*` access with guards

**Output file**: `Docs/audit/03_robustness_2026-04-12.md`

Use the same severity scheme as Phase 2: CRITICAL (production crash/leak/data loss) / HIGH (occasional but user-visible) / MEDIUM (defensive gap, not firing) / OK (checked and fine, list coverage).

**Commit message**: `chore(audit): phase 3 robustness audit`

**Each finding must have**: file:line, exact failure mode, suggested fix direction (do NOT write code in this phase).

**Out of scope for Phase 3**: any finding about A2A / OpenClaw sleeping asset code (per F2), any finding about core LLM adapters (per F1), any Known Debt item (F4). If you find robustness issues in core adapters, note them as "post-1.0 separate ticket" and do not include in the Phase 3 action plan.

---

## After Phase 3, proceed to Phase 4 without asking

Phase 4 = Feature Sanity Check. Same style, output `Docs/audit/04_feature_sanity_2026-04-12.md`. Walk 8 core user flows:

1. First company creation → office (`CompanySelectionPage` → `CompanyCreationWizard` → `OfficeWorkspaceShell`)
2. Chat → boss routing → employee dispatch → ceremony → report (`ChatPanel` → `boss-node.ts` → graph → scene)
3. Employee creation via interview wizard (`InterviewWizard`)
4. SOP create → DAG edit → execute (`SopViewSurface` + `SopDagCanvas`)
5. Marketplace browse → install employee → appears in office (`MarketPage` → `useDeepLinkInstall` → `materializer.ts`)
6. Settings modify provider → save → runtime reinit (`SettingsPage` → `provider-config` → `OffisimRuntimeProvider`)
7. Activity Log view recent events (`ActivityLogPage` + `EventLog`)
8. Studio 3D editor edit zone → save (`StudioPage` → `StudioState` → `saveZonesToDb`)

For each flow: loading state, failure state, idempotency, empty state, back/cancel, cross-workspace unwind, persistence. Source-verifiable issues only — browser UI verification marked `NEEDS-SMOKE` for user to check in `pnpm dev`.

Commit: `chore(audit): phase 4 feature sanity check`

---

## After Phase 4, generate Phase 5 action plan + execute

Phase 5 has two sub-steps:

1. **Write `Docs/audit/05_action_plan_2026-04-12.md`**: merge Phase 2 locked Phase 5 actions (see master plan "Consolidated Phase 5 cleanup checklist") with new items from Phase 3 + Phase 4 findings. Each action = one commit with explicit finding ID reference.
2. **Execute commits in order**, running `pnpm --filter '!@offisim/desktop' --filter '!@offisim/launcher' typecheck` after each. Auto-pause every 5 commits for user status report. Never bypass hooks. If typecheck fails, stop and report.

**Do NOT execute Phase 6.** Phase 6 is 2.0 roadmap, not 1.0 ship. It stays as docs only.

**Do NOT** push / create PRs / open issues without explicit user request.

---

## Anti-patterns to avoid (learned from prior session mistakes)

- **Do not** elevate A2A or OpenClaw to architecture status. They are sleeping assets. One line in CLAUDE.md Gotchas is the maximum visibility. No dedicated doc, no section, no @deprecated tags.
- **Do not** trust early-session subagent reports without verifying. Phase 1 had drift claims about prefab counts + doc-engine xlsx that turned out wrong under direct verification.
- **Do not** ask the user to make decisions that are already in "Decisions already made" list above.
- **Do not** re-derive findings that are already in Phase 2 — reference the finding ID instead.
- **Do not** act on speculation. Verify every claim via Read / Grep / Bash before including it in a Phase report.
- **Do not** expand scope. If a fix looks obvious but isn't tied to a finding, log it as "post-1.0 separate ticket" and move on.

---

## When you are stuck or unsure

Ask the user BEFORE acting. The user prefers being asked over wrong commits. Use short, specific questions with a default option they can accept with one word.

Respond in Chinese (per the user's global preferences and the existing audit artifacts).

Begin Phase 3 now. Start with `git log --oneline -10` to verify current state, then read the 6 files listed at the top of this handoff, then start the robustness scan. Do not wait for confirmation after reading.
