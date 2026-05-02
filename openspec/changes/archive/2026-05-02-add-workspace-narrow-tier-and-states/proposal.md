## Why

`computeLayoutTier()` exists in `apps/web/src/components/workspaces/types.ts`
and `useLayoutTier()` exists in `apps/web/src/components/workspaces/useLayoutTier.ts`,
but the only consumer is `PersonnelPage.tsx` (and even there only via a
`grid-cols-1 lg:grid-cols-[280px_…]` Tailwind breakpoint, NOT the actual
hook). Five of six peer-level workspaces — Office, SOPs, Market, Activity
Log, Settings — make NO call to `useLayoutTier()`. The result, audited at
`390x844` / `768x1024` / `1280x800` / `1440x900` / `1920x1080`:

1. **SOPs** — `SopViewSurface.tsx:497` is `flex h-full` with a fixed-width
   280px `SopSidebar` + central canvas + fixed-width `SopInspectorPanel`.
   At narrow widths (≤768px) the sidebar eats 36% of the viewport, the
   inspector eats another ~28%, and the central DAG canvas is squeezed
   into ~36% — unusable. There is no drawer, no tab fallback, no
   collapse handle.

2. **Market** — `MarketPage.tsx` switches between `mode === 'explore'` (card
   grid + detail) and `mode === 'manage'`. The grid uses `flex` with hard
   widths and detail panel splits side-by-side at all breakpoints.

3. **Activity Log** — `ActivityLogPage.tsx:198–207` hard-codes `w-3/5` /
   `w-2/5` for timeline + detail when an event is selected. At narrow
   widths the timeline rows clip and the detail panel takes 40% of a 390px
   viewport (156px) — barely readable.

4. **Settings** — `SettingsPage.tsx:57` is `<div className="flex h-full">`
   with a 224px-wide `SettingsTabNav` to the left of the content area. At
   ≤768px the nav alone is 29% of viewport AND the content area's form
   fields wrap unpredictably.

5. **Personnel** — `PersonnelPage.tsx:129` uses
   `grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]`.
   `grid-cols-1` collapses ALL three panes into a single column at any
   width below `lg` (1024px in Tailwind default), so the tablet tier
   (769–1280) loses the second pane entirely instead of getting a sensible
   two-pane layout. The tier between mobile-stack and desktop-three-pane
   is just absent.

6. **Header** — `Header.tsx:78` uses `flex-wrap items-center justify-between`
   so when narrow the header soft-wraps onto two/three lines, project
   selector buttons and provider-config CTA pile up, and the peer
   workspace nav loses its labels (`hidden sm:inline` already strips them
   below 640px) without compensating drawer affordance.

**Loading and error coverage are equally broken.** `WorkspaceRouter.tsx:190–196`
ships a `<div>Loading workspace…</div>` with no spinner and no skeleton —
on the dark theme the text is barely visible, and during lazy-chunk fetch
the user sees an empty black screen for 200–600ms. `PersonnelPage`,
`SopViewSurface`, `ActivityLogPage`, `MarketPage`, `SettingsPage` have NO
loading skeletons for their list / detail panes — empty/loading/error
states are conflated, so a slow load looks identical to "no SOPs yet". No
workspace has a recoverable error UI; backend errors either surface as
toasts that fade or are swallowed silently. `EmptyState` (in `ui-core`)
already supports `primaryAction` / `secondaryActions` but the actual
empty-state call sites — `SopEmptyState`, `EmptyDetail` / `EmptyTabPlaceholder`
in `PersonnelPage.tsx:298–315`, `ActivityEmptyState` — half wire CTAs and
half don't.

**Onboarding is also stuck on the old DOM-selector-based controller.**
`OnboardingController.tsx` walks `data-onboarding-target="…"` selectors,
measures their `getBoundingClientRect()`, and pins a single hint card
near them. There is no progress indicator (1 of 3), no Back / Next /
Skip flow, and a hint can silently fail to render if the targeted DOM
node is mid-mount or behind a layout shift. The user feedback note in
this directive ("旧 selector 心智模型") confirms the controller's
selector-coupled design needs to be replaced with a step-data-driven tour
where targets are declared by workspace + slot identifier and the UI
layer maps them to DOM refs internally.

We are pre-launch — there is no back-compat shim debt. Do all six
workspaces, three states, three tiers, and the onboarding rebuild in a
single complete delivery.

## What Changes

- **All six workspaces SHALL consume `useLayoutTier()`**. Each workspace's
  top-level surface component reads `tier` and `workspaceLayout` and
  renders the layout decision per the per-workspace decision table
  (specs/responsive-app-shell). No silent reliance on Tailwind `lg:`
  breakpoints alone — `useLayoutTier()` is the SSOT for tier decisions
  involving sidebar drawer / tab-stack / split-pane behavior. Tailwind
  utility classes MAY still be used for purely cosmetic responsive tweaks
  (font-size, spacing) but layout topology decisions go through the hook.

- **Narrow tier (≤768px) SHALL stack content** for every workspace:
  SOPs → top-row drawer for SOP picker, full-viewport DAG canvas, bottom
  sheet for inspector; Market → tab-style switch between list and detail,
  no concurrent panes; Activity Log → tab-style timeline | detail with
  per-event "Open detail" navigation; Settings → horizontal tab strip
  along the top, content fills the rest; Personnel → drill navigation
  list → detail → tabs (each pane fills viewport, Back unwinds);
  Office → unchanged from existing right-rail collapsed default in
  `responsive-app-shell` spec.

- **Tablet tier (769–1280px) SHALL collapse one secondary pane** while
  keeping primary work surface usable: SOPs → sidebar visible (clamped
  220px), inspector collapsed to a right-edge handle that opens an overlay;
  Market → list 60% / detail 40% with detail closable; Activity Log →
  timeline 70% / detail 30% with collapsible detail; Settings → nav
  visible, content full; Personnel → two columns
  `[220px_minmax(0,1fr)]`, third pane (tabs) opens as overlay or swaps
  the detail; Office → right rail expanded by default (existing).

- **Desktop tier (>1280px) SHALL render all panes concurrently**: SOPs
  → sidebar + canvas + inspector; Market → grid + detail side-by-side;
  Activity Log → timeline + detail; Settings → nav + content; Personnel
  → list + detail + tabs (existing `lg:` behavior); Office → three-slot
  AppLayout (existing).

- **Header SHALL adapt per tier**: at narrow tier the peer workspace
  nav collapses behind a hamburger button that opens a list overlay;
  the project selector chip moves into a "More" dropdown; the
  `Open API Settings` provider-config CTA moves into the same dropdown
  when present. At tablet tier the peer workspace nav keeps icons + labels
  but office tools cap at 2 visible (overflow goes to the existing
  `MoreHorizontal` dropdown). At desktop tier the existing layout is
  preserved.

- **Sidebar collapse contract SHALL be globalized**: every workspace
  with a left sidebar (Office left rail, SOPs sidebar, Personnel list,
  Settings nav) supports a uniform `collapsed | expanded` toggle persisted
  per-workspace in `localStorage` under
  `offisim:workspace:<key>:left-rail`. At narrow tier the toggle is
  forced collapsed and the sidebar opens as a drawer. At tablet tier the
  toggle defaults to expanded but obeys the persisted preference. At
  desktop tier the toggle defaults to expanded.

- **Workspace state coverage (NEW capability) SHALL be exhaustive**: every
  workspace defines `empty` / `loading` / `error` / `unsupported` states
  with a unified visual contract:
  - **Empty** — `EmptyState` from `ui-core` with icon + title +
    description + at least one `primaryAction` CTA (no
    description-only empty states). Each workspace's empty CTAs are
    enumerated in spec.
  - **Loading** — `WorkspaceListSkeleton` (for sidebars, list panes)
    and `WorkspaceDetailSkeleton` (for detail panes) primitives added
    to `ui-core`. They render as 6–8 shimmer rows or 2 paragraph
    skeletons + a button stub. `WorkspaceRouter` lazy-chunk fallback
    upgrades from `<div>Loading workspace…</div>` to a centered
    `WorkspacePageSkeleton` (header strip + dual-column shimmer).
  - **Error** — `ErrorState` primitive (NEW in `ui-core`) with icon +
    title + message + Retry / Dismiss actions. Used by all workspace
    list/detail panes when the underlying repo call rejects. Errors
    SHALL NOT silently fade as toasts — recoverable errors render an
    inline banner the user can act on.
  - **Unsupported** — for desktop-only features rendering in browser
    (e.g. Tauri folder picker, file tree, MCP transport list), an
    explicit "Available on desktop" notice with link to download.

- **Onboarding tour system (NEW capability) SHALL replace the
  selector-based controller**:
  - `OnboardingTour` component owns step navigation (Back / Next / Skip)
    and renders the highlight ring + hint card.
  - `TourStep` shape is data: `{ id, workspace, slot, title, body,
    primaryAction?, dismiss }`. Each `slot` is a stable identifier
    (e.g. `'office:chat-input'`, `'settings:provider-tab'`) registered
    by the consuming workspace via a React context.
  - Workspaces register their slots via `useTourTarget(slot)` which
    returns a ref callback the workspace attaches to the actual DOM node.
    The tour layer reads the ref map, computes positioning, and renders
    the hint without ever calling `document.querySelector`.
  - Progress indicator: `Step N of M`, with M derived from the active
    step list (filters out steps the user has already completed).
  - First-run welcome screen: rendered once per fresh
    install (account onboarding state has no `provider_configured` yet,
    AND no company exists). Shows a 2-paragraph product intro, a
    primary CTA "Get started" that begins the tour, and a secondary
    "Skip and explore" that suppresses the tour.
  - Tour content (initial step list, copy enumerated in
    `specs/onboarding-tour-system/spec.md`):
    1. **Connect your AI provider** (target slot `settings:provider-cta`)
    2. **Pick or create a project** (target slot `office:project-selector`)
    3. **Send your first message** (target slot `office:chat-input`)
    4. **Open Tasks to watch progress** (target slot `office:tasks-tab`)
    5. **Browse Personnel** (target slot `personnel:nav-button`)
    6. **Try the Marketplace** (target slot `market:nav-button`)
  - Steps 1–4 require `activeWorkspace === 'office'`; steps 5–6 are
    cross-workspace introductions that auto-switch the workspace when
    the user clicks Next.

- **Header data-onboarding-target attributes SHALL be removed**. The
  legacy `data-onboarding-target="configure-provider"` etc. on Header
  buttons are no longer needed once `useTourTarget(slot)` ref-based
  registration replaces selector queries. Removal happens in the same
  change.

## Capabilities

### New Capabilities

- `workspace-state-coverage` — Defines the empty / loading / error /
  unsupported state contract every workspace SHALL implement. Owns the
  `WorkspaceListSkeleton` / `WorkspaceDetailSkeleton` / `WorkspacePageSkeleton`
  / `ErrorState` primitive contracts in `ui-core` and the per-workspace
  CTA + retry semantics.
- `onboarding-tour-system` — Defines the step-data-driven tour replacing
  the selector-based `OnboardingController`. Owns the `TourStep` shape,
  the `useTourTarget(slot)` ref-registration contract, the progress
  indicator semantics, the first-run welcome screen contract, and the
  initial 6-step tour content.

### Modified Capabilities

- `responsive-app-shell` — Extends from "Personnel + viewport screenshot
  QA" to "all six peer workspaces × narrow / tablet / desktop tiers
  consume `useLayoutTier()`". Adds the per-workspace tier decision
  table (sidebar / pane / drawer / tab behavior), the header tier
  adaptation contract, and the global sidebar collapse persistence
  contract.

## Impact

- **Code (apps/web)**:
  - `apps/web/src/components/workspaces/WorkspaceRouter.tsx` — replace
    `WorkspaceLoadingFallback` body with `<WorkspacePageSkeleton>` from
    `ui-core`.
  - `apps/web/src/components/OnboardingController.tsx` — delete; replace
    with a thin shim importing the new `OnboardingTour` from
    `ui-office` and feeding it the active company + account onboarding
    state.
  - `apps/web/src/components/onboarding/FirstRunWelcomeScreen.tsx` — new
    component, rendered by `App.tsx` when first-run conditions met.

- **Code (packages/ui-core)**:
  - `packages/ui-core/src/components/skeleton.tsx` — new file exporting
    `Skeleton` (the shimmer primitive), `WorkspaceListSkeleton`,
    `WorkspaceDetailSkeleton`, `WorkspacePageSkeleton`.
  - `packages/ui-core/src/components/error-state.tsx` — new file
    exporting `ErrorState` (icon + title + message + retry/dismiss).
  - `packages/ui-core/src/index.ts` — re-export the new primitives.
  - `packages/ui-core/src/components/empty-state.tsx` — no API change;
    spec adds the workspace-state-coverage contract that empty states
    MUST have at least one `primaryAction` CTA.

- **Code (packages/ui-office)**:
  - `packages/ui-office/src/components/sop/SopViewSurface.tsx` — accept
    `tier` from `useLayoutTier()`, render drawer/tab/three-pane variants.
  - `packages/ui-office/src/components/sop/SopSidebar.tsx` — accept
    `collapsed` prop, render compact icon-only mode when collapsed.
  - `packages/ui-office/src/components/marketplace/MarketPage.tsx` —
    consume `useLayoutTier()`; narrow tier swaps to
    `mode === 'detail-active'` tab style; tablet keeps grid + detail
    with detail closable.
  - `packages/ui-office/src/components/events/ActivityLogPage.tsx` —
    consume `useLayoutTier()`; narrow stacks timeline → tap to open
    detail full-screen with Back; tablet keeps `w-3/5 / w-2/5` but with
    detail closable; desktop unchanged.
  - `packages/ui-office/src/components/settings/SettingsPage.tsx` —
    consume `useLayoutTier()`; narrow renders horizontal tab strip;
    tablet+ keeps left-rail nav.
  - `packages/ui-office/src/components/settings/SettingsTabNav.tsx` —
    add horizontal-strip variant.
  - `packages/ui-office/src/components/employees/PersonnelPage.tsx` —
    consume `useLayoutTier()` (replace the static
    `grid-cols-1 lg:grid-cols-[…]` with tier-driven layout including
    a real tablet two-pane state); add list/detail loading skeletons
    and error banners; convert `EmptyDetail` and `EmptyTabPlaceholder`
    to wire `primaryAction` CTAs.
  - `packages/ui-office/src/components/layout/Header.tsx` — accept tier
    prop (or read `useLayoutTier()` directly) and render
    narrow / tablet / desktop variants.
  - `packages/ui-office/src/components/layout/HeaderNarrowMenu.tsx` —
    new component for narrow-tier hamburger overlay holding peer
    workspace nav + project selector + provider config CTA.
  - `packages/ui-office/src/components/onboarding/OnboardingTour.tsx`
    + `useTourTarget.ts` + `tour-context.tsx` + `tour-steps.ts` —
    new tour subsystem.
  - `packages/ui-office/src/components/onboarding/FirstRunWelcomeScreen.tsx`
    — new component (or re-export from apps/web depending on
    consumption).
  - `packages/ui-office/src/lib/sidebar-collapse-store.ts` — new
    `localStorage`-backed store for `offisim:workspace:<key>:left-rail`.

- **Code (apps/web/src/lib/onboarding-store.ts)** — extend with a
  `tour_completed` slot (separate from per-step slots already there) so
  the tour can record an explicit dismissal.

- **Specs**:
  - `responsive-app-shell` MODIFIED — adds tier × workspace decision
    table, header adaptation, sidebar collapse contract, persisted
    collapse keys.
  - `workspace-state-coverage` NEW — empty / loading / error /
    unsupported state requirements, skeleton primitives contract,
    error retry contract.
  - `onboarding-tour-system` NEW — `TourStep` shape, `useTourTarget`
    contract, progress indicator semantics, first-run welcome screen,
    6-step initial tour content.

- **Live verification**: at `390x844`, `768x1024`, `1280x800`, `1440x900`,
  and `1920x1080` walk through all 6 workspaces (every state: empty,
  populated, loading, error simulation), the header (narrow hamburger
  open/close), and the entire onboarding tour from welcome screen
  through step 6 with Back/Next/Skip flow. Document each viewport ×
  workspace combination as a verification checklist row.

- **No back-compat**: pre-launch — `OnboardingController` is deleted, not
  feature-flagged. `data-onboarding-target` attributes removed from all
  call sites in the same change. The 5 lazy-loaded workspace pages
  refactor their layout topology; old code paths are removed not
  flag-gated.
