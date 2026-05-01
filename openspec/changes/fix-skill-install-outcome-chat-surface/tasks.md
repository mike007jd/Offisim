## 1. Event plumbing

- [x] 1.1 Add `SkillInstallOutcomePayload` type in `packages/shared-types/src/events/install.ts` mirroring `SkillInstallConfirmOutcome` plus `interactionId`. Add the payload type to `packages/shared-types/src/index.ts` named exports.
- [x] 1.2 Add factory `skillInstallOutcome(companyId, threadId, payload)` in `packages/core/src/events/install-events.ts` (event type `skill.install.outcome`). Re-export from `event-factories.ts`, `index.ts`, `browser.ts` (mirror the `marketListingInstalled` re-export pattern from commit `a0a4ed5f`).
- [x] 1.3 At the resolve site in `packages/core/src/services/interaction-service.ts` (post-`handler.handle()`), when the resolved interaction was a `skill_install_confirm`, emit the new event with the outcome carried in `InteractionResolveResult.skillInstallOutcome`.
- [x] 1.4 Build: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core build`.

## 1b. Outcome SSOT in shared-types (post-codex live verify rework)

- [x] 1b.1 Move `SkillInstallOutcomeKind` definition into `packages/shared-types/src/events/install.ts`; add required `skillSlug: string` to `installed` / `created` / `edited` variants. Re-alias as `SkillInstallConfirmOutcome` in `packages/core/src/services/interaction-service.ts`.
- [x] 1b.2 Add SSOT label function `skillInstallOutcomeLabel(outcome)` in shared-types, with the Decision 2 copy table (slug-aware, error truncated 120 UTF-16). Export `SKILL_INSTALL_OUTCOME` constant.
- [x] 1b.3 In `packages/core/src/skills/skill-install-committer.ts`, populate `skillSlug: row.slug` on the `installed` / `created` / `edited` outcome paths.
- [x] 1b.4 Build: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core build`.

## 2. Surface unification

- [x] 2.1 In `packages/ui-office/src/runtime/activity-feed/mappers/interaction-mappers.ts`, register subscriber for `SKILL_INSTALL_OUTCOME` and push entry using `skillInstallOutcomeLabel(payload)` from shared-types. Tone via local `SKILL_OUTCOME_TONE` Record.
- [x] 2.2 Activity rail mapper: drop async slug DB lookup + `getSkillSlug` plumbing — slug now bundled in outcome.
- [x] 2.3 In `packages/ui-office/src/runtime/runtime-activity-formatters.ts`, drop the local `skillInstallOutcomeLabel` / `skillInstallOutcomeNeedsSlug`. Drop `skill_install_confirm` case from `interactionResolvedLabel`. `interaction.resolved` mapper SHALL skip `skill_install_confirm` to avoid double-log with `SKILL_INSTALL_OUTCOME`.
- [x] 2.4 In `apps/web/src/runtime/interaction-follow-up.ts`, replace the inline copy table (`SKILL_INSTALL_CANCELLED_MESSAGE` / `SKILL_CREATION_CANCELLED_MESSAGE` / per-kind switch) with `skillInstallOutcomeLabel(skillInstallOutcome ?? { kind: 'cancelled' })`. Keep the `action === 'create' && selectedOptionId === 'retry'` branch (separate from outcome — it never reaches the committer).
- [x] 2.5 Drop `getSkillSlug` / `skillsRepoRef` plumbing from `use-runtime-activity-feed.ts` (no longer needed).
- [x] 2.6 Build: `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`.

## 2b. ChatPanel followUp surfacing fix (post second codex live verify)

- [x] 2b.1 Root cause: `ChatPanel.handleInteractionRespond` routed startRun + finalizeActiveRun to `getScopedConversationKey(activeThreadId, interactionTarget)` where `interactionTarget` resolves to the bubble owner's employeeId; in team chat (`selectedEmployeeId === null`) the followUp wrote to the EMPLOYEE'S direct chat, invisible from the team view. Even with the right convKey, `startRun` activeRun raced with the agent resume after `interactionService.resolve()` — agent's own `startRun` / `terminateActiveRun` cleared/replaced our run during the await, so `finalizeActiveRun(response)` was a no-op or clobbered the boss summary.
- [x] 2b.2 Route startRun + addMessage + finalize to the current view's `conversationKey` (the conversation where the bubble was rendered), not the interaction owner's direct chat. Keep the existing direct-chat safety guard (`resolveDirectChatTarget` throws on mismatch).
- [x] 2b.3 For `pending.kind === 'skill_install_confirm'`, bypass the activeRun mechanism entirely: `addMessage(targetKey, { role: 'assistant', content: response, status: 'completed' })` directly. The agent resume produces its own boss/employee summary under its own runtime-driven activeRun separately; both messages land chronologically in the visible conversation.
- [x] 2b.4 Build: `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build && pnpm --filter @offisim/web typecheck`.

## 3. Validation gates

- [x] 3.1 Serial build: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/install-core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`.
- [x] 3.2 `pnpm --filter @offisim/web typecheck`.
- [x] 3.3 `pnpm --filter @offisim/platform typecheck` (no regression).
- [x] 3.4 `pnpm openspec validate fix-skill-install-outcome-chat-surface --strict`.

## 4. Live verify (release `.app`, single session, codex)

- [x] 4.1 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`. Note new bundle mtime. → `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` mtime `May  1 19:15:14 2026` (post 2b ChatPanel fix).
- [x] 4.2 Start `pnpm --filter @offisim/platform dev` (port 4100). Open release `.app`. (Codex round 3, release `.app` mtime `May 1 19:15:14 2026`.)
- [x] 4.3 **Created outcome** — Confirmed `create_skill_from_scratch` with valid frontmatter; chat assistant message `Skill codex-live-created-3-skill created from scratch.` appears alongside boss summary + deliverable. Screenshot `.live-verify/skill-install-outcome-chat/4.3-created.png`.
- [x] 4.4 **Cancelled outcome** — Cancelled `create_skill_from_scratch`; chat assistant message `Skill action cancelled.` appears after boss summary, no fallback to legacy copy. Screenshot `.live-verify/skill-install-outcome-chat/4.4-cancelled.png`.
- [x] 4.5 **(Optional) Installed outcome via git** — Skipped per spec note (`installed` shares SSOT with `created`; slug-bundling code path verified by 4.3).
- [x] 4.6 Stop platform service. Confirmed port 4100 freed.

**Out of live-verify scope** (code-covered via shared SSOT):
- `error` outcome — requires committer-time fault injection (DB write failure, FS error). Forbidden-frontmatter is preview validation, not a committer error, and never reaches `skillInstallOutcomeLabel`.
- `staging-expired` — requires waiting out the staging TTL with the bubble open.
- `edited` — exercised by `edit_skill_body` agent tool; same SSOT path as `created` / `installed`.

## 5. Archive readiness

- [x] 5.1 Cross-read proposal / design / spec / `packages/ui-office/CLAUDE.md` for SSOT note about `skillInstallOutcomeLabel` being the unified copy source for both surfaces.
- [x] 5.2 Re-run `pnpm openspec validate fix-skill-install-outcome-chat-surface --strict`.
- [x] 5.3 Single commit + `/opsx:archive`.
