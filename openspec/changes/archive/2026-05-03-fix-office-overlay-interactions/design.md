## Context

Three of the four sub-fixes are implementation-level enforcement of contracts the codebase already presupposed:

- `panel-and-dialog-sizing` already says "≤ 1 layer SurfaceCard, no cards-in-cards" (Settings tab body context). `EmployeeInspector.tsx:296-466` violates the spirit of that rule by stacking 6 inner sections each with `rounded-xl border bg-surface-muted`-style elevation against an outer `rounded-xl border bg-surface-elevated shadow-2xl backdrop-blur-md` card.
- The footer at `:419-465` lays out three `flex-1 gap-1.5` buttons in a single row; at narrow widths or when the third button toggles between Dismiss / Re-enable (different label widths), the row clips. The user reported the Dismiss button was unreachable in the 2026-05-02 release `.app` walk.
- `updateEnabled` at `:255-268` awaits `repos.employees.update` before flipping `setEmployee`. The DB round-trip is fast on local SQLite but visibly stutters when the runtime is under load. The user perceives the click as a no-op for the duration of the round-trip, then a sudden flip.

The fourth — `CompanySwitcher` direct-set — is locking in a behavior that **already appears correct in the current code** (`Header.tsx:490` does `onSelect={(id) => switchCompany(id)}` directly; `useCompanyBootstrap.ts:46-58` only opens `company-select` when `activeCompanyId` is null). The 2026-05-02 live verify report likely caught a now-fixed regression. The spec scenario is defensive — pin the current behavior so a refactor cannot silently re-introduce the overlay round-trip.

## Goals / Non-Goals

**Goals:**
- Collapse `EmployeeInspector` into a single elevated card with internal dividers / disclosure for memories.
- Footer button overflow disappears at every supported layout tier; Dismiss / Re-enable always reachable.
- Dismiss + Re-enable flip inspector state in the same render as the click; persistence failure rolls back and surfaces.
- Lock `CompanySwitcher` direct-set behavior via spec scenarios so future shell refactors cannot regress it.
- All four behaviors land under the new `office-overlay-interactions` capability so the contract is discoverable from one place.

**Non-Goals:**
- Re-architecting the overlay system. `OverlayKey` stays as-is. `setActiveOverlay` channel unchanged.
- Adding new overlay surfaces. The four touched surfaces (`EmployeeInspector`, `CompanySwitcher`, the `company-select` overlay, the dropdown shell) all exist.
- Persistence-layer changes. `repos.employees.update` signature stays the same; we only change the call-site sequencing.
- Replacing `window.confirm` for the Dismiss prompt — the inline confirmation pattern is consistent with other destructive office actions and out of scope for this change.
- Touching `panel-and-dialog-sizing` spec text. The new capability supplies the overlay-layer enforcement that spec always assumed.
- Switcher behavior beyond Company. Future `ProjectSwitcher` will inherit the same shape but is not built here.

## Decisions

### Decision 1: New capability `office-overlay-interactions`, not a delta on `panel-and-dialog-sizing`

**Choice**: A new `office-overlay-interactions` capability with four Requirements (single-card nesting, footer reachability, optimistic mutation, switcher direct-set).

**Alternative rejected**: extend `panel-and-dialog-sizing` with overlay-specific Requirements. Rejected because three of the four Requirements are not about sizing — optimistic mutation is a lifecycle contract, switcher direct-set is a routing contract. Forcing them under a sizing spec makes the spec a junk drawer.

**Alternative rejected**: scatter the four Requirements across existing capabilities (panel-and-dialog-sizing for nesting, dialog-overlay-protocol for switcher, a new "interaction-lifecycle" for optimistic mutation). Rejected because all four originate from the same surface (office overlays) and from the same live-verify batch; keeping them co-located makes the contract discoverable from one place.

**Why a single new capability**: the four Requirements share an audience (anyone touching `EmployeeInspector`, `CompanySwitcher`, future office overlays) and a verification surface (release `.app` walk on the office workspace). Splitting them buries the relationship.

### Decision 2: Single SurfaceCard + internal dividers, no `<details>` polyfill

**Choice**: Inspector body becomes one elevated card with `border-b` divider lines between sections (existing pattern in `SettingsContentArea` per ui-office CLAUDE.md). Memories disclosure uses native `<details>` / `<summary>` (no JS framework dependency).

**Alternative rejected**: keep individual section cards but lower their visual weight (drop `border` / `bg-surface-muted`). Rejected because the rule is "no cards-in-cards", not "less obvious cards-in-cards"; the structural fix beats the cosmetic dimming.

**Alternative rejected**: Headless UI `Disclosure` component. Rejected because native `<details>` already gives correct keyboard / screen-reader semantics; we don't need state management for a one-shot collapsible. If a future overlay needs animated transitions, swap then.

### Decision 3: Footer width strategy is `flex-wrap` + container queries on label visibility

**Choice**: footer becomes `flex flex-wrap gap-2`. Each button uses `aria-label` always (for icon-only fallback) and renders its text label conditionally based on a width measurement (existing `useLayoutTier()` from `responsive-app-shell` capability — already in scope). At desktop tier all buttons fit on one row with text. At tablet / narrow, text drops to icon-only. If even icon-only would overflow, the natural `flex-wrap` wraps the third button onto a second row.

**Alternative rejected**: a CSS-only solution using `min-width: 0` + `text-overflow: ellipsis` on labels. Rejected because ellipsizing the action label ("Re-enab…") is worse than collapsing to icon — the user can't recognize the action from the truncated text.

**Alternative rejected**: an "overflow menu" `…` button that hides extra actions. Rejected because the spec's primary scenario is "Dismiss / Re-enable always reachable" — burying the destructive action one click deeper violates the live-verify finding.

**Alternative rejected**: container queries (`@container`) instead of `useLayoutTier`. Rejected because the inspector is an absolutely-positioned popover; container size doesn't reflect the layout tier the user sees. Tier is the right signal.

### Decision 4: Optimistic mutation lives in the inspector, not in `repos.employees`

**Choice**: `updateEnabled` flips local state via `setEmployee(prev => prev ? { ...prev, enabled: nextEnabled } : prev)` synchronously, then awaits `repos.employees.update`. On failure, the catch block sets `setEmployee` back to the prior value and surfaces via `useToasts.addToast`.

**Alternative rejected**: push optimism into `repos.employees.update` itself (e.g. emit an optimistic event before the DB write). Rejected because repos are stateless — they don't own UI state. The pattern would leak repo concerns into UI rendering.

**Alternative rejected**: tanstack-query-style mutation cache. Rejected because we don't use it elsewhere in this surface; introducing it here would be inconsistent with the rest of the office UI's plain `useState` + repo direct-call pattern. If the codebase later adopts a cache, the inspector port is trivial.

**Why explicit catch-block rollback**: silent failure was the live-verify finding. The catch block is the contract — `try { setOptimistic(); await repos.update(); } catch { setRollback(); addToast(error); }`. Reads as the spec scenarios.

### Decision 5: `CompanySwitcher` is verification-only

**Choice**: the spec's switcher Requirement codifies behavior that already appears correct in current code. Implementation task is "verify with a release `.app` walk + add a smoke check that the dropdown does not flash `company-select` overlay during selection".

**Alternative considered**: refactor `useCompanyBootstrap` to remove the `if (!activeCompanyId) setActiveOverlay('company-select')` line. Rejected because that line is the legitimate first-load path (no company → must pick / create one); the bug is only if it fires during a swap, which it does not.

**Why include in this change**: the four sub-fixes share the same live-verify origin and the same overlay capability. Splitting Company switcher into its own change doubles the propose / archive overhead for a one-scenario spec lock.

## Risks / Trade-offs

- **Risk**: collapsing 6 SurfaceCards into one card with dividers loses some visual hierarchy that helped the user scan section types (Current Focus vs Subtasks vs Memories). → **Mitigation**: section labels (the `INSPECTOR_LABEL_CLASS` lozenges) stay; replace the card-level visual weight with denser typographic hierarchy (label uppercase tracking, slightly larger gap above each label). The information ordering is unchanged.
- **Risk**: optimistic flip + DB failure produces a confusing flicker (banner appears for ~50 ms then reverts). → **Mitigation**: this is the standard pattern for optimistic UI and matches the user's mental model ("I clicked, system tried, system failed, I see the error"). The toast surfaces the error so the user understands the revert. Out of scope: a longer "saving…" indeterminate state during the DB write.
- **Risk**: `useLayoutTier()` is a workspace-level signal; when the inspector is rendered as a floating popover at fixed width 320 px (the current `w-80`), the tier reflects the workspace's tier, not the popover's. At narrow workspace tier the popover becomes a constrained surface — but the popover is already 320 px wide regardless. Footer width adapts based on workspace tier as a proxy. → **Mitigation**: at narrow workspace tier the popover positioning shifts (`max-w-[min(22rem,calc(100vw-2rem))]`), so the footer width does narrow proportionally. Layout tier is a reasonable proxy. If verification shows the proxy fails at some specific tier, swap to a `useResizeObserver` on the inspector ref in a follow-up.
- **Trade-off**: `<details>` does not animate the disclosure expand. Acceptable for an inspector popover where the open / close action is direct and infrequent. If product later wants an animated reveal, swap to `<Disclosure>` from Headless UI as a one-line drop-in.
- **Trade-off**: locking `CompanySwitcher` direct-set as a spec scenario without changing implementation means the verification evidence is "no `company-select` overlay flash during swap" rather than a code diff. The release-app walk-through is the authority. Documented in the live-verify section of `tasks.md`.

## Migration Plan

No DB / schema impact. No API surface change. Single-direction code change at three call sites:

1. `EmployeeInspector.tsx` — body collapse + footer width-adaptive + optimistic dismiss / re-enable.
2. `Header.tsx` `CompanySwitcher` — verification only; no edit expected unless live-verify shows regression.
3. Spec lands `office-overlay-interactions` capability under `openspec/specs/`.

Rollback: revert the change. No data shape changes to undo.

## Open Questions

- **Q1**: Should the inspector's `Dismiss` confirmation move from `window.confirm` to an inline confirmation strip (matching `EmployeeCreatorOverlay` patterns)? **Tentative**: out of scope for this change. The confirmation is a separate UX concern from the overlay nesting / optimistic-mutation contract. If the live-verify walkthrough reveals the `window.confirm` is itself a friction point, open a follow-up.
- **Q2**: Do future overlays (e.g. ProjectSwitcher per 桶 5 ⭐) inherit the switcher Requirement automatically, or do we re-state it per surface? **Tentative**: the Requirement is generic ("dropdown switchers SHALL treat row-item selection and management entry as distinct affordances"); ProjectSwitcher inherits without re-statement. If 桶 5 needs surface-specific scenarios, add scenarios under the same Requirement.
- **Q3**: Should the optimistic-mutation Requirement extend to other inspector actions (Message, Edit Details)? **Tentative**: No — those navigate (open chat / open editor) rather than mutate state in place. Optimism only applies where the click flips a piece of state the user can immediately observe.
