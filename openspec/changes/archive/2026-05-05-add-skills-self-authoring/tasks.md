# Tasks — add-skills-self-authoring

## 1. Pre-flight code audit

- [x] 1.1 Confirm `create_skill_from_scratch` is registered in the employee tool kit assembly module (`packages/core/src/agents/employee-node/*`).
  - 2026-05-05 evidence: `SKILL_INSTALL_TOOL_DEFS` includes `create_skill_from_scratch`, and `skill-create-real-tool-call` / `skill-create-frontmatter-errors` passed in the contract harness.
- [x] 1.2 Confirm `SkillInstallConfirmBubble` renders the `'create'` action variant when staging payload `action='create'`.
  - 2026-05-05 evidence: `packages/ui-office/src/components/chat/SkillInstallConfirmBubble.tsx` handles `action === 'create'` and frontmatter error state.
- [x] 1.3 Confirm `installSkill` accepts `source: 'self-authored'` and that the staging path leads through `skillStagingManager`, not a direct vault write.
  - 2026-05-05 evidence: self-authored create path stages through `skillStagingManager` and commit uses the existing skill install committer path; no direct vault write occurs before confirmation.
- [x] 1.4 Confirm frontmatter whitelist enforcement is at the tool layer (rejecting before staging), not deep in vault write.
  - 2026-05-05 evidence: `parseSelfAuthoredSkillMd` rejects before staging; `skill-create-frontmatter-errors` covers `missing-required`, `forbidden-namespace`, `unknown-field`, and `invalid-yaml`.

## 2. Build clean release `.app`

- [x] 2.1 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`.
  - 2026-05-05 evidence: both commands passed. Release `.app` timestamp `2026-05-05T19:59:26+1200`; binary sha256 `ea517781a7ca4e49a3b55331e88fffe292a67092a1a8d409d5d0e911397dd9c9`.
- [x] 2.2 Launch release `.app` via the precise worktree path (per CLAUDE.md "多 worktree 桌面验收不能靠 bundle id"). Attach Computer Use.
  - 2026-05-05 evidence: release app attached with Computer Use as `com.offisim.desktop`, pid `40738`, URL `tauri://localhost`.

## 3. Live verify — Invariant 1 (tool reachability)

- [x] 3.1 Open a chat with an employee whose company has skill-staging wired. Send a prompt asking the employee to "create a skill that lists files in a directory" (or any well-formed self-authoring request).
  - 2026-05-05 evidence: YOLO Master was prompted to create `release-verify-list-files`, then re-prompted after layout fix to create `release-verify-layout-list-files`.
- [x] 3.2 Observe whether the LLM picks `create_skill_from_scratch`. Capture the chat transcript + tool-call trace.
  - 2026-05-05 evidence: release app created `skill_install_confirm` interactions for `action='create'`; `ix-0ed7698e-97b7-47e4-9cd7-0571a836a760` staged `release-verify-layout-list-files`.
- [x] 3.3 If the LLM does not stably hit the tool, capture the prompt + boss-layer routing decision and decide whether the gap is wiring (tool not in kit) or prompt-template / availability gating.
  - 2026-05-05 evidence: no wiring gap surfaced; LLM reached `create_skill_from_scratch` before and after the release layout fix.

## 4. Live verify — Invariant 2 (frontmatter whitelist)

- [x] 4.1 Trigger a `create_skill_from_scratch` call with a deliberately invalid frontmatter for each of the four reason codes: `missing-required`, `forbidden-namespace`, `unknown-field`, `invalid-yaml`.
  - 2026-05-05 evidence: release app surfaced all four reason codes; see `.live-verify/add-skills-self-authoring/verify-record.md`.
- [x] 4.2 Confirm each call returns `SkillFrontmatterError` with the matching reason code, NO staging entry is created, and the chat surface re-prompts the LLM.
  - 2026-05-05 evidence: DB `interaction_history` has cancelled rows for `missing-required`, `forbidden-namespace`, `unknown-field`, and `invalid-yaml`; only successful `release-verify-*` skills exist in `skills`.

## 5. Live verify — Invariant 3 (staging pipeline reuse)

- [x] 5.1 Trigger a successful `create_skill_from_scratch` call. Confirm staging entry appears in `skillStagingManager`, `skill_install_confirm` interaction event fires with `action='create'`, and the chat preview bubble renders.
  - 2026-05-05 evidence: `release-verify-list-files` and `release-verify-layout-list-files` both produced create preview bubbles with active `skill_install_confirm` rows.
- [x] 5.2 Confirm clicking `Cancel` on the bubble removes staging without writing to vault.
  - 2026-05-05 evidence: first `release-verify-list-files` preview was cancelled (`ixh-93dae47a-f02c-4faf-9652-7cedf8ebf04e`) and no skill row existed after cancel.
- [x] 5.3 Confirm clicking `Create skill` on the bubble writes to vault via the same two-phase commit as T2.2 install / T2.3 fork.
  - 2026-05-05 evidence: `release-verify-list-files` and post-fix `release-verify-layout-list-files` were confirmed and written to vault under the YOLO Master employee skill path.

## 6. Live verify — Invariant 4 (preview bubble create variant)

- [x] 6.1 Confirm preview bubble UI for `action='create'` shows: SKILL.md preview text, slug, `Create skill` primary button, `Cancel` secondary button.
  - 2026-05-05 evidence: release app showed SKILL.md preview text, slug, `Create skill`, and `Cancel` for `release-verify-layout-list-files`.
- [x] 6.2 Confirm bubble visually distinguishes `create` from `install` / `fork` / `edit` variants.
  - 2026-05-05 evidence: bubble title and primary CTA showed the create variant (`Create new skill from YOLO Master`, `Create skill`) rather than install/fork/edit wording.

## 7. Fix any regression surfaced

- [x] 7.1 If 3.x exposes a wiring gap (tool not in kit / availability check broken), fix at `packages/core/src/agents/employee-node/*`.
  - 2026-05-05 evidence: no wiring fix required; release app reached `create_skill_from_scratch`.
- [x] 7.2 If 4.x exposes whitelist drift, fix at the tool definition layer.
  - 2026-05-05 evidence: no whitelist fix required; four release frontmatter guards returned expected reason codes.
- [x] 7.3 If 5.x or 6.x exposes staging or bubble drift, fix at `packages/core/src/skills/*` or `packages/ui-office/src/components/chat/SkillInstallConfirmBubble.tsx`.
  - 2026-05-05 evidence: staging/bubble logic was correct, but release verification exposed a right-sidebar focus/layout blocker. Fixed `packages/ui-office/src/components/layout/RightSidebar.tsx` so thread list scrolls and Chat/interaction controls stay visible.

## 8. Spec — `skill-self-authoring` MODIFIED

- [x] 8.1 Add a new Requirement: "Self-authoring SHALL pass release-`.app` live verify before the capability is considered shipped" with one Scenario per invariant (1-4 above) pinned to release session.

## 9. Live re-verify

- [x] 9.1 If anything was fixed in step 7, rebuild release `.app` and re-run sections 3-6.
  - 2026-05-05 evidence: rebuilt release `.app` after `RightSidebar.tsx` fix; re-ran frontmatter and successful create/confirm paths in release app.
- [x] 9.2 Capture verify evidence under `.live-verify/add-skills-self-authoring/verify-record.md`.

## 10. Archive gate

- [x] 10.1 Spec / tasks / docs three-check.
  - 2026-05-05 evidence: spec requirement 8.1 was already present; tasks and live verify record are now synchronized.
- [x] 10.2 Confirm `openspec/protocols-ledger.md` rows untouched (SKILL.md row already says ✅).
  - 2026-05-05 evidence: `openspec/protocols-ledger.md` SKILL.md row still says ✅.
- [x] 10.3 Update `MEMORY.md` Active Backlog: remove #3.
  - 2026-05-05 check: repo has no local `MEMORY.md`, and global `/Users/haoshengli/.codex/memories/MEMORY.md` has no `Active Backlog`, `Backlog #3`, or `add-skills-self-authoring` entry to remove. No memory write was required.
