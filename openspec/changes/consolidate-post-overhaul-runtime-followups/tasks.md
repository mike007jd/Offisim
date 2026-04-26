## 1. #3 update-llm-gateway-default-model — paperwork formalize (recommended first; no code)

- [ ] 1.1 Re-confirm commit `f3bb26dd` already migrated `MINIMAX_MODEL` defaults in `apps/web/vite.config.ts`, `packages/ui-office/src/lib/provider-config.ts`, `catalog/provider-source-registry/`, and any other code site
- [ ] 1.2 Grep `MiniMax-M2.7-highspeed` across repo (excluding `openspec/changes/archive/**`) — should return 0 hits in active code; if any remain, treat as bug to fix in this segment
- [ ] 1.3 Spec already declares the requirement (`specs/llm-gateway-provider-binding/spec.md`); ensure no extra MODIFY of pre-existing requirements is needed (this segment is paperwork, code already landed)

## 2. #5 fix-web-direct-chat-target-mismatch — chat target resolver

- [ ] 2.1 Grep `targetEmployeeId` + `selectedEmployeeId` use sites in `packages/ui-office/src/components/chat/**`, `packages/ui-office/src/runtime/**`, and `apps/web/src/**` to map every chat dispatch caller
- [ ] 2.2 Identify the path where direct chat selection of Maya can leak to Alex Chen on `fork_skill` preview; expected suspect is a path that resolves target from active-agent / first-agent / boss fallback rather than `selectedEmployeeId`
- [ ] 2.3 Replace fallback resolution with strict `selectedEmployeeId`-first; throw `Error('Direct chat target missing — selectedEmployeeId not propagated')` when programming error leaves it absent
- [ ] 2.4 Ensure `respondToInteraction` and `sendMessage` and tool dispatch all consult the same single source of truth for `targetEmployeeId`
- [ ] 2.5 Live verify on web @5176: select Maya in agent panel → invoke `fork_skill` (or any skill tool) → confirm preview bubble employee chip is Maya; repeat with Alex and a third employee to rule out single-employee coincidence
- [ ] 2.6 Live verify on web @5176: programmatic missing-target case — confirm error throws and chat surfaces typed message rather than silent fallback (this may require a small dev-only injection point or a fault-injection toggle, scope as light as possible)

## 3. #2 fix-doubled-boss-bubble — single commit at finalize

- [ ] 3.1 Reproduce the bug locally: web or desktop, send `hi` in team chat, observe Boss reply renders two bubbles (one with reasoning fold + body, one with body only)
- [ ] 3.2 Trace finalize / commit paths in `packages/ui-office/src/runtime/use-chat-streaming-sync.ts`, `chat-session-store.ts`, and any other commit caller; map exactly where `appendMessage(role: 'assistant')` is invoked per turn
- [ ] 3.3 Identify the double-write source; expected suspects are streaming tail commit + final commit both writing, or reasoning region writing one row + content writing another
- [ ] 3.4 Converge to a single `finalizeAssistantMessage(conversationKey, runId, payload)` entry; refactor parallel commit paths to call this single entry with the full payload (content + reasoning) so the dedupe is structural, not post-write cleanup
- [ ] 3.5 Live verify: web + desktop both show single bubble after `hi` round-trip (with reasoning fold present); abort mid-stream, confirm still single bubble; tool-call mid-stream confirm still single bubble

## 4. #4 fix-tauri-release-csp-platform-allowlist — release CSP alignment

- [ ] 4.1 Locate Tauri CSP config — typically `apps/desktop/src-tauri/tauri.conf.json` `app.security.csp` field; record the current `connect-src` directive
- [ ] 4.2 Compare release CSP `connect-src` with `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` (which already includes `tauri://localhost`); identify what release blocks vs dev allows
- [ ] 4.3 Update release CSP `connect-src` to include `http://localhost:4100`, `https://localhost:4100`, `tauri://localhost`; ensure the addition does not relax other directives unintentionally
- [ ] 4.4 Update `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` comment to point to the spec requirement (`desktop-llm-credential-isolation` Requirement on release CSP allowlist alignment) so future drift is caught
- [ ] 4.5 Build release `.app`: `pnpm --filter @offisim/desktop tauri build`; launch the resulting `.app` against `pnpm --filter @offisim/platform dev` running on 4100; verify Market / Settings / external-employee install paths reach the platform endpoint without CSP violation
- [ ] 4.6 Verify a non-allowlisted port (e.g., 43177) is still blocked and surfaces typed network error (do not relax beyond the documented allowlist)

## 5. #1 fix-langgraph-step-dispatcher-recursion — root-cause investigation FIRST

- [ ] 5.1 **Investigation phase (no code changes yet)**: reproduce the recursion-limit-25 hit with a SOP that triggered it during E2 verify (or construct a synthetic equivalent — small DAG with mixed deps); capture LangGraph state at recursion entry: `plannedSteps`, `completedSteps`, `pendingSteps`, current step under dispatch, last edge taken
- [ ] 5.2 Diagram the dispatcher state machine: `step_dispatcher → routeFromStepDispatcher → (employee | step_advance) → routeFromStepAdvance → (step_dispatcher | boss_summary | re-plan)` plus `step.completed` event flow; pinpoint which transition fails to converge
- [ ] 5.3 Write investigation report to `apps/desktop/src-tauri/` (or wherever the team prefers — root cause notes go into the change archive's design.md addendum at archive time); name probable root cause among: (a) dispatcher misses `step.completed` (b) dispatcher finds no unblocked step but routes to itself (c) plan state out-of-sync with planStep store (d) other
- [ ] 5.4 **Fix phase (only after 5.1-5.3 complete)**: implement the minimal change that converges the dispatcher — likely in `packages/core/src/agents/step-dispatcher-node.ts` and/or `packages/core/src/graph/main-graph.ts` `routeFromStepDispatcher` / `routeFromStepAdvance`
- [ ] 5.5 Add observability: emit `runtime_event` with `event_type='sop.dispatcher.recursion_limit'` + payload `{ planId, stepCount, completedSteps, pendingSteps, recursionDepth }` BEFORE the LangGraph limit-hit error throws; this is observability-only, does not fix root cause
- [ ] 5.6 Live verify: re-run the original failing SOP — dispatcher converges to `boss_summary` once all steps terminal, no recursion limit hit; verify a complex synthetic SOP (8+ steps with mixed deps) also converges
- [ ] 5.7 Negative-path verify: hand-craft an actual infinite loop (debug-only) and confirm the new diagnostic event fires with full payload BEFORE the limit hits

## 6. #6 T2.4 add-skills-self-authoring — new capability

- [ ] 6.1 Schema audit: confirm `skills` table already accepts arbitrary `source_kind` / `source_ref` strings (no enum constraint preventing `'self-authored'` / `'llm-author:<modelKey>'`); if any DB-level CHECK constraint exists, propose schema relaxation here
- [ ] 6.2 Extend `SkillLoader.installSkill` `source` union with `{ kind: 'self-authored', modelKey: string }`; reuse staging + commit path from T2.2 / T2.3 — no parallel pipeline
- [ ] 6.3 Add `installSkill` validation: `source.kind === 'self-authored' && scope === 'company'` throws `SkillScopeError(kind='self-authoring-requires-employee-scope')`
- [ ] 6.4 Implement strict frontmatter whitelist for self-authoring on top of T2.1 `parseSkillMd`: required `name + description`, optional `allowedTools / license / version`, reject `offisim.*` and any unknown field; emit `SkillFrontmatterError` with reason code (`missing-required` / `forbidden-namespace` / `unknown-field` / `invalid-yaml`)
- [ ] 6.5 Register employee tool `create_skill_from_scratch(skillBody, targetEmployeeId?)` in employee tool kit (alongside T2.2 / T2.3 tools); tool stages via `skillStagingManager` and emits `skill_install_confirm` interaction with `action='create'`
- [ ] 6.6 Tool MUST reject `targetEmployeeId` mismatch with chat's resolved selectedEmployeeId — return typed error to LLM
- [ ] 6.7 Extend `SkillInstallConfirmBubble` with `'create'` action branch: header `Create new skill from {employeeName}`, SKILL.md preview pane, slug, scope label, model attribution, `Create skill` / `Cancel` CTAs; on `frontmatterError` show inline error + `Retry` CTA
- [ ] 6.8 Wire `respondToInteraction` outcome path: confirm → vault write + skills row insert + chat surfaces "Skill created."; cancel → discard staging + chat surfaces "Skill creation cancelled."; staging-expired → chat surfaces retry CTA
- [ ] 6.9 Live verify on desktop release `.app` (verify on real Tauri runtime; web is acceptable secondary): (a) employee invokes `create_skill_from_scratch` with valid LLM body → preview bubble appears with create header + SKILL.md preview; (b) confirm → vault SKILL.md exists at expected path + `skills` row inserted with `source_kind='self-authored'`; (c) cancel → no vault file, no `skills` row
- [ ] 6.10 Live verify rejection paths: (a) frontmatter with `offisim.priority: high` → `forbidden-namespace` error rendered, retry CTA visible; (b) frontmatter with unknown field `category: ops` → `unknown-field` error rendered; (c) frontmatter missing `description` → `missing-required` rendered
- [ ] 6.11 Live verify mismatch path: in direct chat with Maya, simulate LLM passing `targetEmployeeId='alex-chen-id'` → tool errors out, no staging, error surfaced to LLM
- [ ] 6.12 Live verify scope rejection: programmatic `installSkill({ source: { kind: 'self-authored' }, scope: 'company' })` throws `SkillScopeError`

## 7. Build, typecheck, lint, doc sync

- [ ] 7.1 Dependency-ordered build per CLAUDE.md: `shared-types → ui-core → core → ui-office → web`; clean dist between to avoid stale-product false-pass
- [ ] 7.2 `pnpm typecheck` — zero errors across all 26 packages
- [ ] 7.3 `pnpm lint` — touched files clean (use `npx @biomejs/biome check --write` per file if format/imports drift); pre-existing repo-wide lint debt is out of scope
- [ ] 7.4 `cargo check` (`apps/desktop/src-tauri`) — Rust compiles with any CSP / capability changes
- [ ] 7.5 Update root `CLAUDE.md`: add (a) `step_dispatcher` invariant note in core gotchas; (b) `finalizeAssistantMessage` SSOT note for chat; (c) Tauri release CSP allowlist note; (d) chat target resolver invariant note; (e) skill self-authoring entry point in core skills section
- [ ] 7.6 Update `packages/core/CLAUDE.md` and `packages/ui-office/CLAUDE.md` with sub-package specifics for the same five topics
- [ ] 7.7 Update `openspec/protocols-ledger.md`: LangGraph row gets dispatcher convergence invariant note; SKILL.md row gets self-authoring entry note

## 8. Live verify (web @5176)

- [ ] 8.1 #5 chat target — Maya selected, fork_skill preview lands on Maya (not Alex); repeat with two more employees
- [ ] 8.2 #2 boss bubble — single bubble after `hi` round-trip with reasoning fold; abort mid-stream still single bubble; tool-call mid-stream still single bubble
- [ ] 8.3 #1 SOP dispatcher — re-run the originally failing SOP, dispatcher converges to `boss_summary`, no recursion limit; verify complex synthetic 8-step DAG converges
- [ ] 8.4 #6 self-authoring happy path on web (web is secondary verify surface; desktop is primary)
- [ ] 8.5 #6 self-authoring rejection paths on web

## 9. Live verify (desktop release `.app`)

- [ ] 9.1 Build release `.app` via `pnpm --filter @offisim/desktop tauri build`
- [ ] 9.2 #4 release CSP — Market / Settings / external-employee paths reach platform `localhost:4100` without CSP violation; non-allowlisted port still blocked
- [ ] 9.3 #2 boss bubble — same single-bubble invariant on desktop
- [ ] 9.4 #1 SOP dispatcher — same convergence on desktop
- [ ] 9.5 #6 self-authoring full happy path on desktop (primary verify surface for skill writes — vault inspection)
- [ ] 9.6 #6 self-authoring rejection paths on desktop
- [ ] 9.7 #5 direct chat target on desktop (Tauri webview path)

## 10. Archive gate three-check

- [ ] 10.1 Spec consistency: re-read all 8 spec deltas against landed code; tighten / loosen wording to match reality; update Purpose stanzas if scope drifted
- [ ] 10.2 Tasks consistency: every `[x]` truly verified live; partial passes documented as DEFERRED with reason; LangGraph investigation report attached
- [ ] 10.3 Doc consistency: root + core + ui-office CLAUDE.md updated; `openspec/protocols-ledger.md` LangGraph + SKILL.md rows updated; no stale "fix-langgraph-step-dispatcher-recursion outstanding" claim left
- [ ] 10.4 Protocols ledger sync: LangGraph + SKILL.md rows checked
- [ ] 10.5 If any of #1-#6 is documented as DEFERRED rather than verified, propose a single-segment follow-up change name in archive notes for next session pickup
