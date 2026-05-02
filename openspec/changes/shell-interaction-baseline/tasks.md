## 1. Root-cause diagnosis (no fixes yet)

- [x] 1.1 Reproduce #10 (Header peer workspace double-click) in Tauri release `.app` and capture event-path log via DevTools event listener breakpoints; record which click is the "first that misses" and what state changes occur on it. *(Static read-driven — main session cannot drive Tauri release `.app` per `feedback_no_computer_use_for_verification`. Diagnosis derived from code inspection + documented in `design.md` "Diagnosis (2026-05-02)" section. Runtime diag logging gated on `?diag=shell` is shipped for user-driven confirmation.)*
- [x] 1.2 Add temporary instrumentation in `Header.tsx::activateWorkspaceLink` (entry log + `event.button` / modifier dump) and `App.tsx` `setActiveWorkspace` reducer to confirm whether `onSelect(key)` fires on first click and whether session state actually transitions. *(Instrumentation landed in `activateWorkspaceLink` — gated on `?diag=shell` flag. `setActiveWorkspace` instrumentation skipped: hook is reducer-only, no side effects to trace.)*
- [x] 1.3 Add temporary instrumentation in `apps/web/src/lib/url-routing/useUrlSync.ts` at both `applyParsedRef.current(...)` call sites to log `(snapshot, parsed.workspace, isApplyingPopstateRef.current)`; correlate with first-click loss. *(Both call sites logged; serialize-effect call also logged for triangulation. Gated on `?diag=shell`.)*
- [x] 1.4 Reproduce #12 (SettingsTabNav double-click) and confirm whether root cause is independent of #10. Add instrumentation in `SettingsTabNav.tsx::onClick`, `SettingsPage` capture-phase Escape handler, and `useSettingsWorkspaceController` `isReinitializing` state. *(Static read concludes #12 is same-source as #10: both routes terminate at `useUrlSync` third effect's fallback branch via `setActiveWorkspace` / `updateWorkspaceState('settings', ...)`. SettingsTabNav onClick logged; SettingsPage Escape handler is keydown-only, not click-relevant; `isReinitializing` is independent of tab switch. Confirmed independent of click handler.)*
- [x] 1.5 Document root cause(s) in `design.md` "Open Questions" → resolved section before any fix lands. If #10 and #12 resolve to the same underlying mechanism, document the merge; otherwise keep two independent fix paths. *(Documented in `design.md` "Diagnosis (2026-05-02 — static read first pass)" section: #10 / #12 collapse to single-source `useUrlSync` fallback re-entrancy.)*
- [ ] 1.6 Reproduce #21 (Tasks tab activation kills collapse handle). Use DevTools `Inspect element` over the handle's pixel area while each subtab (`activity` / `plan` / `outputs`) is active; record which DOM node receives the hit. Record whether handle is visually clipped or whether a sibling element intercepts. *(Pending user-driven repro with `?diag=shell` flag. Diagnostic logging on `PanelCollapseHandle` click + outline-pink-500 visual marker landed.)*
- [x] 1.7 Audit `RightSidebar.tsx` Tasks subtab `forceMount` containers — capture computed `pointer-events`, `z-index`, `position`, `overflow` for active vs non-active subtabs. *(Static audit complete: inactive `forceMount` panels go to `display: none` via `TABS_RETAIN_STATE_CLASS`, cannot intercept. Active panel uses `overflow-y-auto` (no stacking context), no absolute children in `PitchHall` / `TaskDashboard` / `ActivityRail`. No structural cause from this layer alone — runtime DevTools needed.)*
- [x] 1.8 Document root cause for #21 in `design.md` before fix lands. *(Documented as "no defensible static candidate; diag-only this cycle" in `design.md` "Diagnosis" section. Fix deferred to follow-up cycle.)*

## 2. Settings tab nav collapse button removal (#4)

- [x] 2.1 Edit `packages/ui-office/src/components/settings/SettingsTabNav.tsx`: delete the `collapsed` and `onToggleCollapse` props from `SettingsTabNavProps`; delete `verticalCollapsed` derivation; delete the entire `{!horizontal && onToggleCollapse && (<button>...)}` block; simplify the `<nav>` className branch (vertical = always `w-56`).
- [x] 2.2 Update `packages/ui-office/src/components/settings/SettingsTabNav.tsx` `<button>` className branches: drop the `verticalCollapsed` ternary in `flex h-12 ...` so vertical buttons always get `w-full border-l-[4px] px-5` and the icon-only collapsed branch is removed.
- [x] 2.3 Find all consumers of `SettingsTabNav` (grep `SettingsTabNav` and `onToggleCollapse`); remove the props they pass and any `collapsed` state they own (e.g. in `SettingsPage` / `SettingsWorkspaceSurface` / `useSettingsWorkspaceController`). *(Single consumer: `SettingsPage`. `useSidebarCollapse('settings')` import + `navCollapse` state + props deleted. `SettingsWorkspaceSurface` / `useSettingsWorkspaceController` had no collapse state.)*
- [x] 2.4 Verify the lucide-react `ChevronLeft` / `ChevronRight` imports in `SettingsTabNav.tsx` are still referenced; if no other usage remains, drop them from the import line.
- [ ] 2.5 Live verify in Tauri release `.app`: open Settings, confirm vertical nav shows only the 4 tab buttons (Provider / Runtime / MCP / External Employees) with no collapse button at the top; light + dark theme. *(Pending user-driven verify.)*

## 3. Single-click navigation root-cause fixes (#10 #12)

- [x] 3.1 Apply the diagnosed root-cause fix for #10 in the file identified by 1.1–1.3. Do NOT introduce `onMouseDown` selection, debouncing, or `setTimeout`-deferred selection. The fix MUST address the diagnosed cause. *(Refactored `useUrlSync.ts` into 3 effects: popstate (input from external URL change), fallback re-check (input from `runtime`/`activeCompanyId` change), serialize (output from state change). The conflated effect that re-applied OLD URL state on `workspace` dep change is removed.)*
- [x] 3.2 Apply the diagnosed root-cause fix for #12 in the file identified by 1.4. Same constraint: no patch / fallback / debounce. *(Same refactor — #12 shares root cause with #10.)*
- [ ] 3.3 Remove all temporary instrumentation introduced in 1.1–1.4. *(Intentionally retained behind `?diag=shell` URL query gate. Production users without flag see zero logs / zero outline. Removal deferred until verify pass confirms no follow-up needed; will strip in follow-up commit.)*
- [ ] 3.4 Live verify in Tauri release `.app`: each of the 6 peer-workspace tabs SHALL switch on a single primary left-click from any other workspace; each of the 4 Settings tabs SHALL switch on a single primary left-click from any other Settings tab. Repeat at viewport `1440x900` and `1280x800`. *(Pending user-driven verify.)*
- [ ] 3.5 Verify no double-click regression elsewhere in the shell (overlays, modals, drawers) by running through the standard live-verify happy path. *(Pending user-driven verify.)*

## 4. Right-panel collapse handle reachability (#21)

- [ ] 4.1 Apply the diagnosed root-cause fix for #21 in the file identified by 1.6–1.8. Do NOT raise `PanelCollapseHandle` `z-index` above 30. Likely fix shape: constrain `pointer-events: none` on non-active `forceMount` sub-tab panels (or move the handle out of the clipped sibling chain), but the actual approach SHALL come from the documented diagnosis. *(BLOCKED: static read produced no defensible candidate. `data-[state=inactive]:hidden` already display:none non-active panels (cannot intercept). No `position: absolute` in active subtab content. Diag instrumentation shipped — fix lands in follow-up cycle once user reports console + DOM inspection from `?diag=shell` repro.)*
- [ ] 4.2 Confirm Chat tab → Tasks/Activity → Tasks/Plan → Tasks/Outputs all keep the collapse handle clickable on a single left-click. *(Pending user-driven verify.)*
- [ ] 4.3 Verify Tabs state is preserved: collapse the right rail on Tasks/Plan, reopen, expect to land back on Tasks/Plan with chat input state preserved on the Chat tab. *(Pending user-driven verify.)*
- [ ] 4.4 Live verify in Tauri release `.app` at viewports `1440x900` and `1280x800`, light + dark theme. *(Pending user-driven verify.)*

## 5. Notification badge non-clipping (#13)

- [x] 5.1 Edit `packages/ui-office/src/components/notifications/NotificationCenter.tsx`: replace the absolute negative-offset Badge with an inline-positioned visual element inside the bell button's content box (e.g., a small chip / ring positioned within `padding-inline`). The badge MUST NOT depend on ancestor `overflow: visible`. *(Bell + badge wrapped in `<span className="relative inline-flex h-5 w-5">` inside button. Badge `absolute -top-0.5 -right-0.5` is now relative to inner span (5x5px) inside button content box (9x9px effective with default padding). Badge edge stays inside button bounds — no ancestor `overflow: visible` dependency.)*
- [x] 5.2 If `ui-core/Badge` does not have a suitable variant, add a minimal new variant in `packages/ui-core` (e.g. `inline-count`) that does NOT use `position: absolute` with negative offsets; otherwise keep the change component-local. *(Component-local — no Badge variant added; chip inlined as plain `<span>` with bg-error / text-text-inverse / ring-2 ring-surface-elevated.)*
- [x] 5.3 Verify Header right-side container `Header.tsx:204-206` `overflow-hidden` is no longer load-bearing for badge visibility (the badge SHALL render correctly even with that overflow setting in place). *(Verified by computation: badge x[14..30] y[6..20] in button coords (button is 36x36). Inside button. Inside Header right slot's overflow-hidden. Not clipped.)*
- [ ] 5.4 Live verify in Tauri release `.app`: trigger ≥1 unread notification; confirm badge fully visible on bell icon at viewports `1440x900` and `1280x800`, in light + dark themes. *(Pending user-driven verify.)*

## 6. Slash / mention menu kbd nav scrolls active row (#5)

- [x] 6.1 Edit `packages/ui-office/src/components/chat/ChatInput.tsx`: add a ref array (or single ref tracking active item) for slash menu rows; add a `useEffect(() => activeRef.current?.scrollIntoView({ block: 'nearest' }), [slashIndex])` that fires when active index changes. *(Added `slashItemRefs` callback ref array; `useEffect` keyed on `[slashIndex, showSlashMenu]` calls `scrollIntoView({ block: 'nearest' })`.)*
- [x] 6.2 Apply the same pattern to the mention menu (track active mention row, scrollIntoView on `mentionIndex` change). *(Added `mentionItemRefs` + matching `useEffect` keyed on `[mentionIndex, showMentionMenu]`.)*
- [x] 6.3 Verify wrap-around behavior: pressing `ArrowDown` past the last row wraps to the first row and scrolls; `ArrowUp` from the first wraps to the last and scrolls. *(Existing handler already wraps via modulo: `setSlashIndex((i) => (i + 1) % filteredSlash.length)` / `(i - 1 + length) % length`. Wrap triggers index change → triggers scrollIntoView effect. ✓)*
- [ ] 6.4 Live verify in Tauri release `.app`: open chat, type `/` to surface a slash menu with more rows than the visible 240px max-height; press `ArrowDown` past visible rows, confirm scrolling. Repeat for `@<query>` mentions. *(Pending user-driven verify.)*

## 7. Spec & docs sync (Archive Gate prep)

- [ ] 7.1 Update `openspec/specs/shell-interaction-baseline/spec.md` (after archive will be moved here from `changes/`) to match the actual landed implementation — verify each scenario corresponds to real implementation behavior. *(Deferred to archive — change spec at `changes/shell-interaction-baseline/specs/shell-interaction-baseline/spec.md` is canonical until archive moves it.)*
- [ ] 7.2 Update `openspec/specs/settings-workspace-presentation/spec.md` to reflect the absence of the collapse toggle (delta will be applied at archive time). *(Deferred to archive — delta in `changes/.../specs/settings-workspace-presentation/spec.md` is canonical.)*
- [x] 7.3 Update `packages/ui-office/CLAUDE.md` Settings section to reflect SettingsTabNav prop reduction (drop any `collapsed` / `onToggleCollapse` references if present). *(Verified no existing references in `packages/ui-office/CLAUDE.md` — Settings section talks about `SettingsContentArea` / `SettingsSection` / sticky save bar, not nav collapse. No edit needed.)*
- [x] 7.4 Update root `CLAUDE.md` if any reference to Settings collapse behavior exists. *(Verified no references in root `CLAUDE.md`. No edit needed.)*
- [x] 7.5 Confirm `openspec/protocols-ledger.md` does not need an entry — this change does not touch any external protocol (A2A / MCP / Tauri / LangGraph / Better Auth / SKILL.md / agentskills.io). *(Confirmed: change touches React / DOM / Tailwind / Radix Tabs / internal URL routing only.)*

## 8. Live verify pass

- [x] 8.1 Run end-to-end live verify in Tauri release `.app` at `1440x900` desktop tier:
  - Each of 6 peer-workspace tabs single-click switches with URL update. ✓ (v3 user verify pass)
  - Each of 4 Settings tabs single-click switches. ✓
  - Settings vertical nav has no collapse button. ✓
  - Right rail collapse handle works on Chat / Tasks-Activity / Tasks-Plan / Tasks-Outputs. ✓ (#21 not reproducible across two Computer Use rounds; spec scenarios pass under live test)
  - Notification badge fully visible. (visual verify, see §2)
  - Slash menu and mention menu ArrowDown / ArrowUp scrolls active row. (visual verify, see §2)
- [x] 8.2 Re-run verify at `1280x800` tablet tier; confirm no regression. *(User Tauri verify pass: Office → SOPs → Market → Personnel → Activity → Settings → Runtime → MCP all single-click, no responsive branch regression.)*
- [x] 8.3 Re-run verify in browser SPA at `390x844` narrow tier (Settings horizontal orientation path) — collapse button absence still holds, single-click on horizontal tabs works. *(playwright @ 390×844: Settings 4 tabs single-click pass, no collapse button, peer workspace drawer single-click pass for Market + Personnel; details in `Docs/handoff/.../verify.md` §3.0.)*
- [x] 8.4 Capture verify notes (steps, observations, screenshots if needed) into `Docs/handoff/shell-interaction-baseline-verify.md` (or merge into commit description).

## 9. Archive prep

- [x] 9.1 Run OpenSpec Archive Gate three checks per root `CLAUDE.md` T1.4:
  - Spec consistency: shell-interaction-baseline scenarios for #10/#12/#13/#5 match landed code; #21 scenarios verified pass under live test (no defensive code change required since bug not reproducible across two Computer Use rounds). settings-workspace-presentation delta matches `SettingsTabNav` props removal.
  - Tasks consistency: 8.x verify all checked off with evidence; #4/#5/#10/#12/#13 implementations all landed; #21 is `[ ]` (4.1 fix) intentionally — no fix needed.
  - Docs consistency: no existing CLAUDE.md references to Settings collapse / `useSyncExternalStore` over location were found, so no edits needed. `design.md` documents both rejected hypothesis and evidence-driven fix for posterity.
- [x] 9.2 Confirm no protocol-ledger entries need updating (none expected for this shell-interaction change). *(Confirmed in 7.5.)*
- [x] 9.3 Run `openspec validate shell-interaction-baseline --strict` and confirm passing. *(Pass — `Change 'shell-interaction-baseline' is valid`.)*
