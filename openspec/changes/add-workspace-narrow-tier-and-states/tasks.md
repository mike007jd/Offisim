## 1. ui-core skeleton primitives

- [ ] 1.1 Create `packages/ui-core/src/components/skeleton.tsx` exporting `Skeleton` (base shimmer atom: `width` / `height` / `className` / `as` props; CSS keyframe gradient animation 1500ms; honors `prefers-reduced-motion`)
- [ ] 1.2 In the same file export `WorkspaceListSkeleton` (`rows?: number = 6`; renders stack of rows each with avatar circle + 60% line + 40% line)
- [ ] 1.3 Export `WorkspaceDetailSkeleton` (header chunk: avatar 80×80 + title line + subtitle line; 2 paragraph blocks 3 lines each; button-shaped skeleton at bottom)
- [ ] 1.4 Export `WorkspacePageSkeleton` (page-level: 40px header strip + dual-column shimmer 280px list + flex-1 detail)
- [ ] 1.5 Re-export all four primitives from `packages/ui-core/src/index.ts`
- [ ] 1.6 Verify `prefers-reduced-motion` branch renders static muted background instead of animated gradient (visual check at narrow tier with reduced-motion enabled)

## 2. ui-core ErrorState primitive

- [ ] 2.1 Create `packages/ui-core/src/components/error-state.tsx` exporting `ErrorState` with `ErrorStateProps` (`title`, `message?`, `icon?`, `primaryAction?`, `secondaryAction?`, `variant?: 'banner' | 'page'`, `className?`)
- [ ] 2.2 Default icon `AlertCircle` from `lucide-react`; default variant `'page'`
- [ ] 2.3 `'page'` variant fills container with vertical centering (`flex h-full items-center justify-center`)
- [ ] 2.4 `'banner'` variant renders inline horizontal banner with red-tinted border (`border-red-500/40`) and bg (`bg-red-500/10`)
- [ ] 2.5 Re-export from `packages/ui-core/src/index.ts`
- [ ] 2.6 Build `pnpm --filter @offisim/ui-core build` clean

## 3. EmptyState contract enforcement

- [ ] 3.1 Audit `EmptyState` invocations across `packages/ui-office/src/components/{employees,sop,marketplace,events,settings,company,project}/` — list every call site
- [ ] 3.2 For each call site without `primaryAction`, add a CTA per the per-workspace empty CTA table in `specs/workspace-state-coverage`
- [ ] 3.3 `EmptyDetail` in `PersonnelPage.tsx:298` — wire `primaryAction: { label: 'Pick someone on the left', onClick: () => focusList() }` and add a list-focus ref
- [ ] 3.4 `EmptyTabPlaceholder` in `PersonnelPage.tsx:309` — same as 3.3
- [ ] 3.5 `SopEmptyState` — already wires `onCreateClick` / `onImportClick`; verify both surface via `EmptyState`'s `primaryAction` / `secondaryActions`, NOT custom buttons
- [ ] 3.6 `MarketEmptyState` — verify filter-empty variant has `Reset filters` CTA; manage-tab-empty has `Browse the marketplace` CTA
- [ ] 3.7 `ActivityEmptyState` `'no-events'` variant — add `Open Office to start working` CTA
- [ ] 3.8 `ActivityEmptyState` `'no-results'` variant — already has `onResetFilters`; verify it surfaces as `EmptyState.primaryAction`
- [ ] 3.9 Office no-active-company empty state — verify `Create your first company` + `Pick existing company` are present

## 4. Personnel workspace tier-driven layout

- [ ] 4.1 In `PersonnelPage.tsx` import `useLayoutTier` from `@offisim/ui-office/web` (re-export the hook from `packages/ui-office/src/index.ts` if not already)
- [ ] 4.2 Replace `grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]` with a tier switch: desktop → three-pane grid, tablet → two-pane grid (`[220px_minmax(0,1fr)]`), narrow → drill nav (single pane)
- [ ] 4.3 Implement tablet detail-pane swap: when an employee is selected and a tab is opened, the detail pane (right of list) renders the tab content with a `Back to detail` button at the top of the pane returning to the employee summary
- [ ] 4.4 Implement narrow drill nav: list view → on selection push to detail view → on tab selection push to tab view; Back button at top of detail/tab views unwinds via `onSessionStateChange`
- [ ] 4.5 Add `viewState` discriminated union to track list pane (`loading | empty | error | ready`) and detail pane (`unselected | loading | empty | error | ready`)
- [ ] 4.6 Render `WorkspaceListSkeleton` (rows=6) when list `viewState.kind === 'loading'`
- [ ] 4.7 Render `ErrorState` (variant `'page'`, title `Couldn't load employees`, primaryAction `Retry` invoking the fetch) when list `viewState.kind === 'error'`
- [ ] 4.8 Render `WorkspaceDetailSkeleton` when detail `viewState.kind === 'loading'`
- [ ] 4.9 Add try/catch around `findByCompany` to set `viewState.kind = 'error'` on rejection; add Retry handler that re-invokes fetch

## 5. SOPs workspace tier-driven layout

- [ ] 5.1 In `SopViewSurface.tsx` import `useLayoutTier`; capture `tier`
- [ ] 5.2 Desktop tier: keep existing three-pane (sidebar + canvas + inspector) layout
- [ ] 5.3 Tablet tier: render sidebar at 220px width; collapse inspector to a right-edge handle button; clicking the handle opens an overlay panel positioned over the canvas with the inspector content
- [ ] 5.4 Narrow tier: hide `SopSidebar` from inline layout; render a hamburger button `<Menu>` in `SopLibraryBar` that toggles a left-edge drawer overlay containing the sidebar; render `SopInspectorPanel` as a bottom sheet that opens when a step is selected
- [ ] 5.5 Narrow tier: force `editMode = false` for the duration of narrow render; hide `editMode` toggle in `SopLibraryBar`
- [ ] 5.6 `SopSidebar` accepts new `collapsed?: boolean` prop; collapsed renders icon-only rail (44px wide) with chevron-right expand affordance — used at tablet tier when user toggles collapse
- [ ] 5.7 Add `WorkspaceListSkeleton` rendering when `useSops().loading === true` inside `SopSidebar`
- [ ] 5.8 Add `ErrorState` banner for SOP fetch errors; wire Retry to `refreshSops()`

## 6. Settings workspace tier-driven layout

- [ ] 6.1 In `SettingsPage.tsx` import `useLayoutTier`
- [ ] 6.2 Add tier switch around `<SettingsTabNav />`: desktop+tablet render existing vertical 224px nav, narrow renders horizontal scrollable strip variant
- [ ] 6.3 In `SettingsTabNav.tsx` add `variant?: 'vertical' | 'horizontal'` prop (default `'vertical'`); horizontal renders flex-row scrollable container with same icon + label combo
- [ ] 6.4 Verify content area below the nav strip fills viewport at narrow tier (no horizontal page scroll)
- [ ] 6.5 Sticky save bar (`SettingsContentArea` bottom) — verify it remains anchored to bottom regardless of tier
- [ ] 6.6 Add `WorkspaceDetailSkeleton` rendering when `controller.isLoading === true` inside `SettingsContentArea`
- [ ] 6.7 Add `ErrorState` banner for provider verification / runtime reinit failures (above tab content)

## 7. Market workspace tier-driven layout

- [ ] 7.1 In `MarketPage.tsx` import `useLayoutTier`
- [ ] 7.2 Desktop tier: keep existing grid + detail side-by-side layout
- [ ] 7.3 Tablet tier: grid 60% / detail 40% with detail closable (existing close affordance preserved); manage tab list collapses to a dropdown if it doesn't already
- [ ] 7.4 Narrow tier: single pane — when no listing selected, grid fills viewport; when a listing is selected, detail fills viewport with a Back arrow that clears `selectedListingId`
- [ ] 7.5 `MarketFilterBar` narrow variant: collapse to icon button + sheet
- [ ] 7.6 Render `MarketGridSkeleton` (composition of `WorkspaceListSkeleton` adapted for cards, ≥6 cards) when `useMarketplace().isLoading && results.length === 0`
- [ ] 7.7 Migrate `MarketErrorState` (existing) to use new `ErrorState` primitive with Retry → `refresh()`
- [ ] 7.8 Migrate `MarketDetailSkeleton` (existing) to use the shared `Skeleton` atom from `ui-core`

## 8. Activity Log workspace tier-driven layout

- [ ] 8.1 In `ActivityLogPage.tsx` import `useLayoutTier`
- [ ] 8.2 Replace hard-coded `w-3/5` / `w-2/5` (lines 198–207) with tier-driven width allocation
- [ ] 8.3 Desktop tier: timeline 60% / detail 40% with detail closable (existing close affordance)
- [ ] 8.4 Tablet tier: timeline 70% / detail 30%
- [ ] 8.5 Narrow tier: timeline fills viewport; tap event row pushes detail to full screen; Back returns to timeline
- [ ] 8.6 `ActivityFilterBar` narrow variant: collapse to icon button + sheet
- [ ] 8.7 Render list skeleton when event log store is mid-hydration (events array empty AND store hydrated flag false)
- [ ] 8.8 Add `ErrorState` for event log subscription failures with Retry

## 9. Office workspace right-rail tier handling

- [ ] 9.1 Verify Office workspace already consumes `useLayoutTier()` via `AppLayout` or `OfficeSceneSurface`; if not, add the consumption
- [ ] 9.2 Confirm right rail collapsed at narrow tier (existing responsive-app-shell requirement)
- [ ] 9.3 Confirm chat panel reachable via bottom sheet or overlay at narrow tier (no overlap with scene canvas)
- [ ] 9.4 No new logic — this task is verification only

## 10. Header tier adaptation

- [ ] 10.1 In `Header.tsx` import `useLayoutTier`; capture `tier`
- [ ] 10.2 At desktop tier: render existing layout unchanged
- [ ] 10.3 At tablet tier: cap `OfficeToolBar` visible items at 2 (was 3); rest go to MoreHorizontal dropdown — change `MAX_VISIBLE_OFFICE_TOOLS` to be tier-driven
- [ ] 10.4 At narrow tier: replace inline peer workspace nav with a hamburger button (`Menu` icon, 32×32 hit area) on the left; render workspace title in the middle; render a single MoreHorizontal overflow on the right
- [ ] 10.5 Create `packages/ui-office/src/components/layout/HeaderNarrowMenu.tsx` — left-edge drawer overlay (z-80, dim backdrop, dismissed on Escape / outside / nav select); contains peer workspace nav (full labels + icons), active company selector chip, provider config CTA when `needsConfig`
- [ ] 10.6 Wire hamburger button `onClick` → opens `HeaderNarrowMenu`
- [ ] 10.7 Narrow More overflow: dropdown containing project selector (office only), view-mode toggle (office only), office tools dropdown contents
- [ ] 10.8 Verify narrow header inline height ≤ 56px (no soft-wrap onto multiple lines)

## 11. Sidebar collapse persistence

- [ ] 11.1 Create `packages/ui-office/src/lib/sidebar-collapse-store.ts` exporting `getSidebarCollapse(workspaceKey): 'expanded' | 'collapsed'`, `setSidebarCollapse(workspaceKey, value): void`, `useSidebarCollapse(workspaceKey): [value, setValue]`
- [ ] 11.2 Use `localStorage` key `offisim:workspace:<key>:left-rail`; default `'expanded'`
- [ ] 11.3 Wire SOPs sidebar to consume `useSidebarCollapse('sops')`; render collapse toggle in sidebar header; collapsed state forced at narrow tier
- [ ] 11.4 Wire Personnel list to `useSidebarCollapse('personnel')`; collapsed list shows icon-only employee rows (avatar circles only)
- [ ] 11.5 Wire Settings nav to `useSidebarCollapse('settings')`; vertical variant supports collapse to icon-only rail (44px); horizontal variant unaffected
- [ ] 11.6 Wire Office left rail to `useSidebarCollapse('office')` (verify existing logic; align with new key if it currently uses ad-hoc storage)
- [ ] 11.7 Verify forced-collapse-at-narrow does NOT overwrite persisted value (read-only override)
- [ ] 11.8 Verify resize from narrow → tablet restores persisted value

## 12. Tour primitive subsystem

- [ ] 12.1 Create `packages/ui-office/src/components/onboarding/tour-context.tsx` exporting `TourContext` (Map<TourSlot, HTMLElement | null> + listeners), `TourProvider` component, `useTourSlots()` hook for the tour layer to subscribe
- [ ] 12.2 Create `packages/ui-office/src/components/onboarding/useTourTarget.ts` exporting `useTourTarget(slot: TourSlot): (el: HTMLElement | null) => void`; memoize ref callback per slot via `useCallback`
- [ ] 12.3 Create `packages/ui-office/src/components/onboarding/tour-steps.ts` exporting `TourSlot` union, `TourStep` interface, `TOUR_STEPS` const array (6 steps per spec)
- [ ] 12.4 Create `packages/ui-office/src/components/onboarding/OnboardingTour.tsx` — reads tour state, computes active step, reads slot map, renders highlight ring + hint card OR returns null
- [ ] 12.5 Hint card UI: progress indicator `Step N of M`, title, body, Back / Skip / Next (or Done on last step) buttons
- [ ] 12.6 Position computation reuses logic from existing `computeHintPosition()`; keep the function pure and testable
- [ ] 12.7 When active step's slot is unregistered, render hint centered with text "Switch to <workspace> to continue" + a Next button that triggers workspace switch
- [ ] 12.8 Suppress rendering when `anyOverlayOpen === true`

## 13. Tour state and migrations

- [ ] 13.1 Extend `apps/web/src/lib/onboarding-store.ts` with `tour_step_completed: Set<string>`, `tour_dismissed: boolean`, `welcome_seen: boolean` slots
- [ ] 13.2 Add `markTourStepComplete(stepId)`, `markTourDismissed()`, `markWelcomeSeen()`, `unmarkTourStep(stepId)` actions
- [ ] 13.3 Implement one-shot migration at module init: if `account.provider_configured === true` add `'connect-provider'` to `tour_step_completed`; for any company with `first_task_sent === true` add `'send-first-message'`; for any company with `first_deliverable_seen === true` add `'open-tasks'`
- [ ] 13.4 Make migration idempotent (guard with a `migrated_v1: boolean` flag in store, set true after first run)
- [ ] 13.5 Persist all new slots through existing `localStorage` mechanism in `onboarding-store.ts`
- [ ] 13.6 Selectors: `selectActiveTourStep(state, currentWorkspace): TourStep | null`

## 14. First-run welcome screen

- [ ] 14.1 Create `packages/ui-office/src/components/onboarding/FirstRunWelcomeScreen.tsx` rendering an `xl` Dialog
- [ ] 14.2 Content: product name "Offisim", tagline "Your AI office", 2–3 sentence intro, primary CTA `Get started`, secondary CTA `Skip and explore`
- [ ] 14.3 Wire `Get started` → `markWelcomeSeen()` (tour proceeds to step 1 by virtue of welcome dismissal)
- [ ] 14.4 Wire `Skip and explore` → `markWelcomeSeen()` AND `markTourDismissed()`
- [ ] 14.5 Render condition (in `App.tsx`): `account.welcome_seen === false && account.provider_configured === false && companies.length === 0 && tour_dismissed === false`
- [ ] 14.6 Memoize render condition via `useMemo` keyed only on the four state slices

## 15. Slot registration in workspaces

- [ ] 15.1 In `SettingsPage` provider tab CTA element call `useTourTarget('settings:provider-cta')` and attach the ref to the relevant button (`Open API Settings` or equivalent)
- [ ] 15.2 In Office workspace project selector (existing `data-onboarding-target` site or its replacement) call `useTourTarget('office:project-selector')`
- [ ] 15.3 In `ChatPanel` chat input element call `useTourTarget('office:chat-input')`
- [ ] 15.4 In Office tasks tab button call `useTourTarget('office:tasks-tab')`
- [ ] 15.5 In `Header` peer-nav personnel button call `useTourTarget('personnel:nav-button')`
- [ ] 15.6 In `Header` peer-nav market button call `useTourTarget('market:nav-button')`
- [ ] 15.7 Remove all `data-onboarding-target=` attributes from the codebase: `grep -rn 'data-onboarding-target' apps/ packages/` SHALL return zero matches after this task

## 16. App.tsx integration

- [ ] 16.1 Mount `<TourProvider>` at App.tsx root, wrapping the workspace tree
- [ ] 16.2 Mount `<OnboardingTour>` after the workspace router (so it overlays the active workspace)
- [ ] 16.3 Mount `<FirstRunWelcomeScreen>` at App.tsx root, gated on the four conditions
- [ ] 16.4 Delete `apps/web/src/components/OnboardingController.tsx` OR reduce to a thin shim that just renders `<OnboardingTour>` (per design Decision 1)
- [ ] 16.5 Remove `OnboardingController` import / mount sites except the one shim

## 17. WorkspaceRouter loading fallback

- [ ] 17.1 In `WorkspaceRouter.tsx` replace `<WorkspaceLoadingFallback />` body — use `<WorkspacePageSkeleton />` from `@offisim/ui-core`
- [ ] 17.2 Verify `data-testid="workspace-loading"` attribute is preserved (or replaced with equivalent) for any harness that asserts on it
- [ ] 17.3 Visual check at narrow tier: skeleton fills viewport, no plain-text fallback visible

## 18. Build + typecheck gates (serial per CLAUDE.md)

- [ ] 18.1 `pnpm --filter @offisim/shared-types build`
- [ ] 18.2 `pnpm --filter @offisim/ui-core build`
- [ ] 18.3 `pnpm --filter @offisim/core build`
- [ ] 18.4 `pnpm --filter @offisim/ui-office typecheck`
- [ ] 18.5 `pnpm --filter @offisim/ui-office build`
- [ ] 18.6 `pnpm --filter @offisim/web typecheck`
- [ ] 18.7 `pnpm --filter @offisim/web build`
- [ ] 18.8 `npx biome check .` zero new errors
- [ ] 18.9 `pnpm harness:contract` green (no harness scenarios touched but invariants must still hold)

## 19. Live verification — viewports

> Verification matrix: 6 viewports × 6 workspaces + Header + Tour = ≥38 entries. Use Chrome DevTools device toolbar to set viewport sizes precisely. Capture screenshots in `output/verification/<change>/<workspace>-<viewport>.png` (and delete output/ before commit per repo hygiene).

- [ ] 19.1 Set viewport `390x844` (narrow). Walk Office, SOPs, Market, Activity Log, Settings, Personnel. For each: verify decision-table row matches, no horizontal scroll, primary CTA reachable
- [ ] 19.2 Set viewport `768x1024` (narrow upper boundary). Walk same 6. Verify tier transition still treats this as narrow (≤768)
- [ ] 19.3 Set viewport `1024x768` (tablet). Walk same 6. Verify tier transition treats this as tablet
- [ ] 19.4 Set viewport `1280x800` (tablet upper boundary). Walk same 6
- [ ] 19.5 Set viewport `1440x900` (desktop). Walk same 6. Confirm three-pane / standard layouts
- [ ] 19.6 Set viewport `1920x1080` (ultra-wide). Walk same 6. Confirm no excessive whitespace, layouts scale gracefully

## 20. Live verification — header narrow flow

- [ ] 20.1 Viewport `390x844`. Confirm header hamburger visible on left, workspace title in middle, More overflow on right. Header height ≤ 56px
- [ ] 20.2 Click hamburger → drawer slides in from left containing peer workspace nav, company selector, provider config CTA
- [ ] 20.3 Click a peer workspace inside drawer → workspace switches, drawer dismisses
- [ ] 20.4 Open drawer again → press Escape → drawer dismisses, workspace unchanged
- [ ] 20.5 Open drawer → click backdrop outside drawer → drawer dismisses
- [ ] 20.6 Click More overflow on right → dropdown shows project selector, view mode toggle (office only), office tools

## 21. Live verification — sidebar collapse persistence

- [ ] 21.1 Viewport `1440x900`. SOPs workspace. Click sidebar collapse toggle → sidebar collapses to 44px icon rail. `localStorage.getItem('offisim:workspace:sops:left-rail')` returns `'collapsed'`
- [ ] 21.2 Reload page. Sidebar still collapsed
- [ ] 21.3 Resize to `390x844` (narrow). Sidebar forced collapsed (drawer behavior). `localStorage` value still `'collapsed'`
- [ ] 21.4 Inside drawer, expand → resize back to `1440x900`. Sidebar respects the manually expanded state? (Note: at narrow tier the toggle is disabled or operates on the drawer; the persisted value should reflect the explicit `setSidebarCollapse('sops', 'expanded')` action only)
- [ ] 21.5 Repeat 21.1–21.3 for Personnel, Settings, Office

## 22. Live verification — workspace state coverage

- [ ] 22.1 Personnel: with no employees in the active company, verify list renders empty state with "Hire your first employee" CTA. Click CTA → opens employee creator
- [ ] 22.2 Personnel: trigger `findByCompany` rejection (e.g. by killing platform) → verify list renders ErrorState with Retry. Click Retry → re-fetches
- [ ] 22.3 Personnel: with employees but no selection, detail pane shows "Pick someone on the left" CTA. Click CTA → list focuses (first row gets focus indicator)
- [ ] 22.4 SOPs: with no SOPs, sidebar shows skeleton briefly then empty state with Create / Import CTAs
- [ ] 22.5 SOPs: simulate fetch error → ErrorState banner with Retry
- [ ] 22.6 Activity Log: with no events, page shows empty state with "Open Office to start working" CTA
- [ ] 22.7 Activity Log: while events are hydrating, page shows skeleton (not empty state)
- [ ] 22.8 Market: filter to no-match query → empty state with "Reset filters" CTA
- [ ] 22.9 Market: with no installed assets in manage tab → "Browse the marketplace" CTA
- [ ] 22.10 Settings: kill platform → settings tab shows ErrorState banner with Retry; sticky save bar still functional for unrelated edits
- [ ] 22.11 WorkspaceRouter Suspense fallback: throttle network in DevTools, switch to Market workspace → verify `WorkspacePageSkeleton` renders during chunk fetch (not plain text)

## 23. Live verification — onboarding tour

- [ ] 23.1 Clear `localStorage` (simulate first-run user). Reload app. Welcome screen renders as full-viewport modal with intro + Get started + Skip and explore
- [ ] 23.2 Click "Get started" → welcome dismisses, tour begins. Active step `connect-provider` renders highlight ring around the Settings provider CTA + hint card with "Step 1 of 6", title, body, Back (disabled), Next, Skip
- [ ] 23.3 Click Next → step marked complete, workspace switches to office, active step `pick-project` renders ring around project selector + hint card "Step 2 of 6"
- [ ] 23.4 Click Back → previous step un-completes, ring/hint return to settings step "Step 1 of 6"
- [ ] 23.5 Click Skip → tour dismisses, all rings/hints disappear, `tour_dismissed === true` in localStorage
- [ ] 23.6 Reload app → no welcome, no tour
- [ ] 23.7 Clear `localStorage` again. Welcome → Get started. Walk through all 6 steps clicking Next each time. Step 6 button label says "Done". Click Done → tour dismisses
- [ ] 23.8 During step 2 (`pick-project`), open Studio overlay → tour suppresses (no ring/hint visible). Close Studio → tour resumes at step 2
- [ ] 23.9 With no active company / project, jump to a step targeting a not-yet-mounted slot (manually clear local state to force step 5 active while not on personnel) → tour shows centered hint with "Switch to Personnel to continue" + Next button that switches workspace
- [ ] 23.10 Verify `grep -rn 'data-onboarding-target' apps/ packages/` returns zero matches

## 24. Live verification — migration

- [ ] 24.1 Set `localStorage` to a state simulating an old user: `account.provider_configured = true`, one company with `first_task_sent = true`, no new tour_* slots
- [ ] 24.2 Reload app. Tour begins at step 4 (`open-tasks`) — first incomplete step after migration of legacy slots into completed set (`connect-provider` + `send-first-message` from legacy)
- [ ] 24.3 Verify migration idempotency: reload again, active step is still `open-tasks` (no double-completion or missing-step crash)

## 25. Documentation + memory sync

- [ ] 25.1 Update `packages/ui-office/CLAUDE.md` `## UI / Scene / 3D` section: add note that all peer workspaces consume `useLayoutTier()` SSOT and Tailwind responsive breakpoints are cosmetic-only for layout topology
- [ ] 25.2 Update `packages/ui-office/CLAUDE.md` to add an `## Onboarding tour` section describing the slot-based registration contract
- [ ] 25.3 Update `CLAUDE.md` Workspace IA section: note tier × workspace decision table is the spec contract
- [ ] 25.4 Update `apps/web/src/components/workspaces/CLAUDE.md` (if exists) or add equivalent note: `useLayoutTier()` is the SSOT
- [ ] 25.5 Memory: when archive runs, mark this change off `MEMORY.md` Active Backlog (no current entry maps directly; add a note that "responsive + state coverage + onboarding rebuild" is closed)

## 26. Repo hygiene

- [ ] 26.1 Delete `output/verification/<change>/` screenshots before commit (per repo hygiene rule)
- [ ] 26.2 Verify no `console.log` / debug toasts left in modified files
- [ ] 26.3 Verify no orphaned `data-onboarding-target` attributes (confirmed in 15.7 / 23.10)
- [ ] 26.4 Verify no orphaned imports from deleted `OnboardingController.tsx`
