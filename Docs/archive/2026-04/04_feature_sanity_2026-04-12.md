# Feature Sanity Check — 2026-04-12

Phase 4 of ship-grade audit. Goal: walk the 8 core user flows at source level, call out loading / failure / empty / back-cancel / idempotency / cross-workspace / persistence gaps. Read-only — no code edits in this phase.

**Method**: 4 parallel Explore subagents, 2 flows per agent. Every HIGH/CRITICAL agent claim was re-verified by direct file read before inclusion. Items that couldn't be verified from source alone are tagged **NEEDS-SMOKE** (browser verification needed) or **NEEDS-VERIFY** (second source read needed before acting).

**Exclusions honored (F1/F2/F4)**: LLM adapters, a2a/**, gateway/openclaw-client.ts, useOpenClaw, openclaw UI, Tauri desktop/launcher, Known Debt items. Already-known findings from Phase 2 (C1/C2/H1-H3/M1-M3/L1-L4) and Phase 3 (R1-R4) not re-flagged.

**Headline**: Flows 5 (Market), 7 (Activity Log) are solid. Flows 1/2/3/4/6/8 each have 1-2 user-visible gaps. One HIGH confirmed bug (FS1). Agent-reported "CRITICAL" was overblown and downgraded.

---

## HIGH (verified via direct source read)

### FS1. `useInterviewWizard.submit` has no catch → dialog stranded on failure
**Flow 3 (Employee creator)** — Severity: HIGH

- File: `packages/ui-office/src/hooks/useInterviewWizard.ts:201-238`
- Code: `const submit = useCallback(async () => { if (!repos) return; setIsSubmitting(true); try { ... await repos.employees.create(...); ... } finally { setIsSubmitting(false); } });` — **no catch clause, no error state exposed on the returned hook shape**.
- Caller: `packages/ui-office/src/components/employees/InterviewWizard.tsx:56-59`:
  ```
  const handleSubmit = async () => {
    await submit();
    onClose();
  };
  ```
  If `submit()` rejects, `onClose()` never runs (await short-circuits), and there is no caller-level `.catch(...)`. The dialog stays open with `isSubmitting` reset to false, the button re-enables, and the user sees **no error feedback at all** — just an apparent no-op on their click.

**Failure mode**: User fills wizard → clicks Create Employee → DB constraint violation / repos unavailable / versionService failure → promise rejects → unhandled rejection logged to devtools → dialog remains open pretending the click did nothing. User retries, same thing happens. No recovery affordance.

**Fix direction (Phase 5)**: add a `catch (err) { setError(err instanceof Error ? err.message : 'Failed to create employee'); }` inside `submit`, expose `error` + `clearError` from the hook, render an inline error banner in `InterviewWizard` footer, and let the user retry. Don't call `onClose()` in the caller when submit rejects.

---

## MEDIUM

### FS2. Settings save button reverts before runtime reinit completes
**Flow 6 (Settings → provider → reinit)** — Severity: MEDIUM (UX / perceived durability)

- Files: `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx:340-453` (handleSave), `apps/web/src/App.tsx:~437` (onSave → reinitRuntime)
- `handleSave()` finishes in ~ms (synchronous localStorage write + config push), clears `isSaving`, then fires `onSave()` which internally triggers `reinitRuntime()`. `reinitRuntime()` is async and can take seconds (runtime bootstrap: loads providers, checkpoint saver, repos). The button UI goes from "Saving…" back to "Save provider workspace" while the reinit is still in flight — the user thinks it's done.

**Failure mode**: User hits Save → UI immediately shows "success" → user clicks another action during reinit window → the new action runs against the old runtime or hits a race with the in-flight reinit.

**Fix direction (Phase 5)**: keep `isSaving` true (or add a distinct `isReinitializing` state) until the `OffisimRuntimeStatusContext.version` bumps past the value observed at save time. Settings surface can `useRuntimeStatus()` to observe this.

---

### FS3. Chat abort leaves scene ceremony in non-idle visual state
**Flow 2 (Chat → dispatch → ceremony)** — Severity: MEDIUM, **NEEDS-SMOKE**

- File: `packages/ui-office/src/components/chat/PipelineProgress.tsx:~183` and `useSceneOrchestrator.ts`
- When the user clicks Stop on PipelineProgress, `abortExecution()` cancels the LangGraph run. However, the scene orchestrator listens to `eventBus` for ceremony lifecycle events (gathering / analyzing / dispatching / working / reporting / dismissing). Source read suggests there's no explicit "abort → ceremony.cancelled → return to idle" event — the ceremony stays on the phase it was in when abort fired.

**Failure mode (suspected)**: User aborts mid-ceremony → 3D characters freeze in their current pose → user must click around or switch scene to reset.

**Fix direction (Phase 5 candidate)**: either emit a `ceremony.aborted` event from the graph's abort path that the orchestrator can consume to reset to idle, or have `abortExecution()` call into the orchestrator directly. Cheaper: in `useSceneOrchestrator`, subscribe to `graph.aborted` events (if any) and drive `CeremonyState` back to idle.

**Why NEEDS-SMOKE**: source read could not trace the full event route. Please verify in `pnpm dev` by starting a chat, clicking Stop mid-stream, and observing the scene.

---

### FS4. Settings / wizard handlers lack explicit `isSaving`/`isCreating` re-entry guards
**Flow 1 (Company creation) + Flow 6 (Settings save)** — Severity: MEDIUM

- `useCompanyCreation.ts:131-158` — sets `setIsCreating(true)` but the `create()` callback's `useCallback` deps include `isCreating`, so React re-memoizes on each toggle, and nothing inside the function short-circuits when a second call arrives with `isCreating === true`. The button-level `disabled` attribute is the only guard, and rapid double-click can beat it.
- `SettingsWorkspaceSurface.tsx:340-453` — `handleSave()` same pattern: sets `isSaving = true` inside but no early-return when already saving. Only the button's `disabled` on `isSaveDisabled` prevents it.

**Failure mode**: Rapid double-click on Create Company or Save Settings (trackpad click-through, accessibility tools, test automation) can fire two parallel async calls. For Create Company this has real data risk — two company creations with the same name + template could partially collide. For Settings it just wastes a reinit cycle.

**Fix direction (Phase 5)**: at the top of `create()` / `handleSave()`, `if (isCreating) return null;` / `if (isSaving) return;`. This is belt-and-suspenders with the button disabled state but closes the race window.

---

### FS5. SOP editing has no unsaved-changes guard on workspace switch
**Flow 4 (SOP DAG edit)** — Severity: MEDIUM

- File: `packages/ui-office/src/components/sop/SopViewSurface.tsx:~182`
- Unlike `StudioPage` (which has a `beforeunload` handler around line 227-234), SOP editing has no dirty check. If the user edits a DAG (adds steps, moves nodes, adds dependencies) and then clicks a different workspace via the nav, the edits do appear to persist through `updateDefinition` (which calls `SopService` via runtime context), but there's no user-level confirmation — and any un-persisted intermediate state held in React refs or popover state is lost silently.
- Also note: `SopSyncService` uses `JSON.parse`-then-`JSON.stringify` to compare definition shape (per CLAUDE.md), so the "save noise" path is clean, but that doesn't address the UX question of "did my edits actually commit before I navigated away."

**Failure mode**: User mid-edit → switches workspace → wonders if changes saved → no confirmation either way.

**Fix direction (Phase 5 optional)**: add a dirty-tracking ref in `SopViewSurface` that gates workspace switch via the existing `useWorkspaceBackNavigation` hook, or show a "All changes saved" / "Saving…" indicator in the SOP header. Lower priority than FS1.

---

### FS6. Studio `handleSave` has no in-flight guard — rapid Ctrl+S races deletes
**Flow 8 (Studio 3D editor)** — Severity: MEDIUM, **NEEDS-VERIFY**

- File: `packages/ui-office/src/components/studio/StudioPage.tsx:~299-353` and `lib/zone-persistence.ts:12-68`
- `saveZonesToDb` does `deleteByCompany(...)` followed by re-insert. If the user hits Ctrl+S twice within the round-trip window, the second call's `deleteByCompany` can wipe the rows the first call just inserted.
- There's a `setSaving(true)` at save start but no early-return check at the top of `handleSave`.

**Failure mode**: Rapid save keystroke could briefly empty the company's zone table. Low probability but data-loss class.

**Fix direction (Phase 5)**: add `if (savingRef.current) return;` guard at top of `handleSave`, or wrap `saveZonesToDb` in a mutex.

**Why NEEDS-VERIFY**: I did not open the exact handleSave code to confirm the guard is absent. If `isSaving` state already short-circuits, this is a non-issue. Verify before acting.

---

## LOW

### FS7. Company creation wizard has no cancel / back button
**Flow 1** — Severity: LOW, **NEEDS-SMOKE**

- `CompanyCreationWizard.tsx:24-340`: agent reports no close button, no Escape handler. Mid-flow the user can't back out without creating a company. If the caller App or parent provides an Escape / back-to-company-select handler, this is moot.
- **NEEDS-SMOKE**: verify in browser. If parent handles it, close the finding.

### FS8. SOP DAG canvas pan/zoom state not persisted across navigation
**Flow 4** — Severity: LOW

- `SopDagCanvas.tsx:122, 168-171`: scale + translate are local `useState`, no sessionStorage, no per-SOP persistence. Navigate away and back → zoom resets to fit-to-view. Agent report, not directly verified. Minor UX affordance, not ship-blocking.
- **Fix direction**: skip for 1.0, log as post-ship UX enhancement.

### FS9. Studio company-name modal cancel can orphan promise
**Flow 8** — Severity: LOW, **NEEDS-VERIFY**

- Agent reports `StudioPage.tsx:~299-353` — if user opens "save-as new company" name modal and then cancels, the wrapping promise may hang because the modal has no timeout / auto-resolve on unmount.
- Agent-reported only; source read not deep enough to confirm. Mark as follow-up, don't act without verification.

### FS10. Studio cross-company edit zone state leak
**Flow 8** — Severity: LOW, **NEEDS-VERIFY**

- Agent reports that `resetForCompany()` clears `isEditingZone` but `StudioToolbar` subscriptions to `focusedZoneId` may still point at the old company. Plausible but not verified. Low impact (Studio is single-company context in practice; users rarely switch companies mid-edit).

### FS11. Deleted SOP toast race on unmount
**Flow 4** — Severity: LOW, **NEEDS-VERIFY**

- Agent claims the `decideSopSelectionAction` toast path may fire after component unmount. R2 closure (commit e48dca9) already added `confirmedSelectedIdRef`, but the toast dispatch itself may still outlive the component. Low probability, defensive fix only.

---

## False positives (agent-reported, verified not-a-bug)

### FP1. `useCompanyCreation.create` "error not cleared on retry"
- Agent claimed `useCompanyCreation.ts:154-156` does not reset `error` state before next attempt. **Verdict: wrong.** Line 133 inside the same try block calls `setError(null);` before `materializeTemplate`. On retry, the previous error is cleared. Agent misread the control flow.

### FP2. SOP edit-mode bake "missing spinner + interaction race" (agent CRITICAL)
- Agent claimed `SopViewSurface.tsx:291-306` `handleEditModeToggle` races user interaction during auto-layout bake. **Verdict: not a CRITICAL bug.** The bake is pure synchronous JS layout computation (`computeAutoLayoutPositions`), and `setEditMode((prev) => !prev)` fires **after** the await — meaning the canvas stays in view-mode (no drag/drop enabled) throughout the bake. The await is on React's state flush, not an I/O call. There's a minor UX delay perception question but no concurrency hazard. Downgrade to OK.

### FP3. Flow 5 (Marketplace install) has real HIGH/CRITICAL issues
- Agent 4 found zero critical issues in Flow 5 and Flow 7 after thorough review. **Verdict: accepted.** Install flow state machine properly guards against double-confirm (`confirmBindings` state check), `hasAuthToken` is respected, `INSTALLABLE_KINDS` guard holds, `getEventId` R1 fix is verified present with `event.type` in the identity triple. No new findings from these flows.

---

## OK coverage (verified clean)

### Flow 1 — Company creation
- Empty state handled (`CompanySelectionPage:299-302`)
- Template carousel disables Create button when nothing selected (`CompanyCreationWizard:315-317`)
- Company preview loading state (`CompanyPortalPreview:119-123`)
- `CompanyEditor` shows "Saving..." text during save

### Flow 2 — Chat → dispatch → ceremony
- `PipelineProgress` shows stage progression
- `StreamingBubble` shows active LLM streaming
- `ChatPanel` has `EmptyState` with starter prompts
- `abortExecution` path exists and is wired to pipeline stop (only the ceremony coordination is the question — see FS3)
- `ChatPanel` `conversationKey` correctly keyed by `threadId + targetEmployeeId` (cross-workspace isolation)

### Flow 3 — Employee interview wizard
- `useReducer` + `completedSteps` tracks wizard progress correctly
- `isStepValid()` gates proceed
- Back/next navigation properly constrained
- Escape / dialog close path exists (only the submit error path is broken — see FS1)

### Flow 4 — SOP edit
- `confirmedSelectedIdRef` R2 regression fix still in place
- `SopSyncService` JSON normalization (parse-then-stringify) avoids key-order diff noise
- Cycle validation via `validateNoCycles()` wraps `getExecutionBatches()`
- Node drag commits via `handlePointerUp`
- Empty SOP state renders (`SopEmptyState`)

### Flow 5 — Marketplace install (clean — no findings)
- `MarketCardGrid` skeleton loaders
- `MarketDetailView` `DetailSkeleton` during load
- Platform 503 → `MarketErrorState` with retry (graceful, per CLAUDE.md Known Debt note)
- `useInstallFlow.confirmBindings` state-machine guarded
- `hasAuthToken` check before `/me`, `/drafts` per CLAUDE.md
- `INSTALLABLE_KINDS = new Set(['employee'])` — only employee path active
- `materializer.ts` employee-only branch stays (per Phase 2)
- Deep-link install cancel path exists
- Cross-workspace unwind via `mountedRef` guard + new InstallService per company

### Flow 6 — Settings
- Policy validation fallbacks exist (`parsePositiveInt`, `parseNonNegativeInt`, `parseConfidence`)
- Desktop (Tauri) API key uses secret-store (`setRuntimeSecret`); browser uses localStorage
- `requestDismiss` checks `hasUnsavedChanges` and prompts confirm (per CLAUDE.md gotcha: `toolPermissions` must be part of runtimePolicy save payload)

### Flow 7 — Activity Log (clean — no findings)
- `hydrateEventLogStore` boots from bootstrap state
- `ActivityEmptyState` handles both `no-events` and `no-results` (filtered empty)
- `getEventId` R1 fix verified: `${timestamp}-${type}-${entityId}` includes `type` in identity triple (commit cce6a9f stands)
- `EVENT_PREFIXES` ⊆ `TYPE_PREFIX_MAP` keys — no orphan filters
- `MAX_EVENTS = 200` cap + RAF batching keeps scroll performant under high event volume
- `filterEvents` + `groupEventsByTime` memoized

### Flow 8 — Studio 3D editor
- `beforeunload` guard present (line ~227-234)
- Saving spinner displayed via toolbar prop
- `saveZonesToDb` rewrites via `reparentZoneId` (Track A Track B compatible)
- `resetForCompany()` clears edit state on company switch
- `addZoneFromPreset` raw `crypto.randomUUID()` is correct per CLAUDE.md Track B exception — do not "fix"

---

## Phase 5 integration

Append to `05_action_plan_2026-04-12.md`. Ordered by confidence / severity:

| # | Finding | Change | Files | Blast radius |
|---|---|---|---|---|
| — | FS1 (HIGH, verified) | Add catch + error state to `useInterviewWizard.submit`, render error in wizard footer, don't auto-close on rejection | `packages/ui-office/src/hooks/useInterviewWizard.ts:201-238`, `components/employees/InterviewWizard.tsx:56-59` | Employee creator dialog |
| — | FS2 (MEDIUM) | Extend `isSaving` state through reinit window using `OffisimRuntimeStatusContext.version` | `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx:340-453` | Settings save UX |
| — | FS4 (MEDIUM) | Add `if (isCreating/isSaving) return` early-return at top of `useCompanyCreation.create` and `SettingsWorkspaceSurface.handleSave` | 2 files | Creation + save paths |
| — | FS3 (MEDIUM, NEEDS-SMOKE) | After smoke confirms ceremony stays non-idle post-abort, add `ceremony.aborted` event or direct orchestrator reset on abort | `useSceneOrchestrator.ts`, chat abort path | Scene visual state |
| — | FS5 (MEDIUM) | Add unsaved-changes indicator or `beforeunload` to SOP edit | `SopViewSurface.tsx` | SOP workspace |
| — | FS6 (MEDIUM, NEEDS-VERIFY) | Guard `handleSave` against re-entry OR confirm existing guard, close finding | `StudioPage.tsx` | Studio save path |
| — | FS7-FS11 (LOW, NEEDS-SMOKE/VERIFY) | Skip or revisit after primary fixes land. None are ship-blockers. | — | — |

---

## Summary

| Severity | Count | Verified | Phase 5 action |
|---|---|---|---|
| CRITICAL | 0 | — | — |
| HIGH | 1 (FS1 interview wizard submit) | ✅ direct read | Add catch + error state + retry affordance |
| MEDIUM | 5 (FS2-FS6) | 2 direct, 3 agent + light verify | Small surgical edits |
| LOW | 5 (FS7-FS11) | 0 verified | Skip or revisit post-ship |
| False positives | 3 (FP1-FP3) | recorded | Prevent re-discovery |
| Clean flows | 2 (Flow 5, Flow 7) | Full coverage | No action |

Phase 4 complete. No code changes. Next: Phase 5 writes `05_action_plan_2026-04-12.md` consolidating Phase 2 + Phase 3 + Phase 4 findings into ordered commits, then executes.
