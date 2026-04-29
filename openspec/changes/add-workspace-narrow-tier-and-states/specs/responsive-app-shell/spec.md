## ADDED Requirements

### Requirement: All peer workspaces SHALL consume `useLayoutTier()` for layout topology

Every peer-level workspace surface component SHALL read the active
layout tier via `useLayoutTier()` and choose its column count, sidebar
visibility, drawer behavior, and pane stacking based on the returned
`LayoutTierConfig.tier` value (`'narrow' | 'tablet' | 'desktop'`). The
six surfaces in scope are `SopViewSurface`, `MarketPage`,
`ActivityLogPage`, `SettingsPage`, `PersonnelPage`, and the office
workspace's center surface. The hook lives at
`apps/web/src/components/workspaces/useLayoutTier.ts` and is re-exported
from
`apps/web/src/components/workspaces/useLayoutTier.ts` (re-exported from
`@offisim/ui-office/web` for ui-office consumers) and SHALL choose its
column count, sidebar visibility, drawer behavior, and pane stacking
based on the returned `LayoutTierConfig.tier` value
(`'narrow' | 'tablet' | 'desktop'`).

Tailwind responsive utility classes (`sm:` / `md:` / `lg:` / `xl:`) MAY
be used for cosmetic responsive tweaks — font size, padding, gap,
spacing — but SHALL NOT be the trigger for column counts, drawer
toggles, or pane visibility. Layout topology decisions SHALL flow
through the hook so the SSOT breakpoints (≤768 narrow, 769–1280 tablet,
>1280 desktop) match the spec contract.

#### Scenario: SOPs workspace consumes layout tier
- **WHEN** `SopViewSurface` renders at any viewport width
- **THEN** the component SHALL call `useLayoutTier()` and SHALL render
  the layout variant matching `tier` per the per-workspace decision
  table requirement below

#### Scenario: Personnel workspace consumes layout tier
- **WHEN** `PersonnelPage` renders at any viewport width
- **THEN** the component SHALL call `useLayoutTier()` and SHALL NOT
  rely on Tailwind `lg:` class alone for column count
- **AND** the tablet tier (769–1280) SHALL render a two-column layout
  (list + detail-or-tabs swap), not a single column

#### Scenario: Settings workspace consumes layout tier
- **WHEN** `SettingsPage` renders at any viewport width
- **THEN** the component SHALL call `useLayoutTier()` and at narrow
  tier SHALL render a horizontal tab strip variant of `SettingsTabNav`,
  not the desktop vertical rail

#### Scenario: Market workspace consumes layout tier
- **WHEN** `MarketPage` renders at any viewport width
- **THEN** the component SHALL call `useLayoutTier()` and at narrow
  tier SHALL render either the grid OR detail at a time (tab-style
  switch), not concurrent split panes

#### Scenario: Activity Log workspace consumes layout tier
- **WHEN** `ActivityLogPage` renders at any viewport width
- **THEN** the component SHALL call `useLayoutTier()` and SHALL NOT
  hard-code `w-3/5` / `w-2/5` for the timeline + detail pair — the
  width split SHALL be computed from `tier`

### Requirement: Tier × workspace layout decision table is the spec contract

Each implementing workspace SHALL satisfy the row of the following
table that matches the active tier. The table enumerates every (tier ×
workspace) layout decision and is the normative SHALL-level contract:

| Workspace | Narrow (≤768) | Tablet (769–1280) | Desktop (>1280) |
|-----------|---------------|--------------------|-----------------|
| Office | Right rail collapsed; chat panel via bottom sheet or overlay; left rail collapsed (existing) | Right rail expanded; left rail expanded (existing) | Three-slot AppLayout, all rails expanded (existing) |
| SOPs | DAG canvas full-viewport; sidebar via top hamburger button → drawer; inspector via bottom sheet; edit mode disabled | Sidebar visible (220px); inspector collapsed to right-edge handle, opens overlay; canvas fills remaining width; edit mode enabled | Sidebar (280px) + canvas + inspector (clamped 360–420px) all visible concurrently; edit mode enabled |
| Market | Single pane: grid OR detail (tab-style switch); back arrow returns to grid; filter bar collapses to icon button + sheet | Grid 60% / detail 40% with detail closable; manage tab list collapses to dropdown | Grid + detail side-by-side (existing-style); filters inline; manage tabs full nav |
| Activity Log | Timeline only by default; tap event opens detail full-screen with Back; filter bar collapses to icon button + sheet | Timeline 70% / detail 30% with detail closable; filters inline horizontal | Timeline 60% / detail 40% with detail closable; filter bar full inline |
| Settings | Horizontal tab strip across the top; content below fills viewport; sticky save bar at bottom | Vertical tab nav (224px) + content; sticky save bar at bottom | Vertical tab nav (224px) + content; sticky save bar at bottom |
| Personnel | Drill nav: list → detail → tabs; each pane fills viewport; Back unwinds | Two columns: `[220px_minmax(0,1fr)]`; tabs swap into detail pane on selection with `Back to detail` button | Three columns: `[280px_minmax(0,1fr)_minmax(0,420px)]` (existing) |

#### Scenario: Decision table row applies at exact tier boundary
- **WHEN** the viewport width is `768px`
- **THEN** the layout SHALL match the narrow row of the decision table
- **AND** at `769px` the layout SHALL match the tablet row

#### Scenario: Decision table row applies at upper tablet boundary
- **WHEN** the viewport width is `1280px`
- **THEN** the layout SHALL match the tablet row of the decision table
- **AND** at `1281px` the layout SHALL match the desktop row

#### Scenario: Office workspace at narrow tier hides right rail by default
- **WHEN** viewport width is `390px` and `activeWorkspace === 'office'`
  with no persisted right-rail preference
- **THEN** the right rail SHALL render collapsed
- **AND** the chat panel SHALL be reachable via a bottom sheet or
  toggle that does not steal focus from the scene canvas

#### Scenario: SOPs narrow tier hides sidebar behind a drawer
- **WHEN** viewport width is `390px` and `activeWorkspace === 'sops'`
- **THEN** `SopSidebar` SHALL NOT render inline
- **AND** a hamburger button SHALL be visible above the canvas that,
  when clicked, opens the SOP picker as a left-edge drawer
- **AND** the inspector SHALL render as a bottom sheet that opens when
  a step is selected, not as a permanently-mounted right rail

#### Scenario: SOPs narrow tier auto-disables edit mode
- **WHEN** viewport width is `390px` and the user enters the SOPs
  workspace
- **THEN** the `editMode` toggle in `SopLibraryBar` SHALL be hidden
- **AND** any persisted `editMode = true` state SHALL be coerced to
  `false` for the duration of the narrow-tier render

#### Scenario: Personnel tablet tier renders two columns with tab swap
- **WHEN** viewport width is `1024px` and `activeWorkspace === 'personnel'`
- **THEN** the page SHALL render two columns: list (220px) + detail
  area (remaining width)
- **AND** when the user selects a tab from the inspector, the tab
  content SHALL render in the detail area with a `Back to detail`
  affordance to return to the employee summary

#### Scenario: Settings narrow tier renders horizontal tab strip
- **WHEN** viewport width is `390px` and `activeWorkspace === 'settings'`
- **THEN** `SettingsTabNav` SHALL render as a horizontal scrollable
  strip across the top of the workspace
- **AND** content SHALL fill the remaining vertical space below the
  strip

#### Scenario: Market narrow tier swaps to single-pane tab style
- **WHEN** viewport width is `390px`, `activeWorkspace === 'market'`,
  and `mode === 'explore'`
- **THEN** when no listing is selected, the grid SHALL fill the viewport
- **AND** when a listing is selected, the detail SHALL fill the viewport
  and a Back arrow SHALL replace the grid until dismissed

#### Scenario: Activity Log narrow tier opens detail full-screen
- **WHEN** viewport width is `390px` and `activeWorkspace === 'activity-log'`
- **THEN** the timeline SHALL fill the viewport when no event is selected
- **AND** when a user taps an event row, the detail SHALL push to a
  full-screen view with a Back affordance to return to the timeline

### Requirement: Header SHALL adapt per tier

The application Header SHALL render a tier-specific layout. The
component lives at `packages/ui-office/src/components/layout/Header.tsx`.
At narrow tier (≤768) the peer
workspace nav, project selector, and provider config CTA SHALL be moved
out of the inline header into a hamburger overlay menu. At tablet tier
the inline layout is preserved but office tools SHALL cap at 2 visible
items (existing 3-cap reduces by 1). At desktop tier the existing layout
is preserved.

The Header SHALL accept a `tier` prop (or read `useLayoutTier()`
internally) to drive the variant. When `tier === 'narrow'`:

- A hamburger button (`Menu` icon, 32×32 hit area) appears at the top
  left where the peer workspace nav previously sat.
- The active workspace title SHALL render to the right of the hamburger
  in the central position (truncated with ellipsis if needed).
- A "More" overflow button (`MoreHorizontal` icon) at the top right
  consolidates project selector + view-mode toggle (office only) +
  office tools dropdown.
- The peer workspace nav, active company selector, provider config CTA,
  and notification slot SHALL move into the hamburger overlay.
- The hamburger overlay SHALL render as a left-edge drawer (or full-
  width sheet at viewports < 480px) with z-index 80, dismissed by
  Escape, outside click, or selecting a peer workspace.

#### Scenario: Narrow header renders hamburger and title only
- **WHEN** viewport width is `390px`
- **THEN** the inline header SHALL contain a hamburger button on the
  left, a workspace title in the middle, and at most one overflow
  button on the right
- **AND** the inline header SHALL NOT wrap onto multiple lines (height
  remains ≤ 56px)

#### Scenario: Narrow header hamburger opens peer nav drawer
- **WHEN** the user clicks the hamburger button at narrow tier
- **THEN** an overlay drawer SHALL render containing the peer workspace
  nav (full labels), active company selector, and provider config CTA
- **AND** clicking a peer workspace SHALL switch to that workspace and
  dismiss the drawer
- **AND** clicking outside the drawer or pressing Escape SHALL dismiss
  it without changing workspace

#### Scenario: Tablet header caps office tools at 2 visible items
- **WHEN** viewport width is `1024px` and `activeWorkspace === 'office'`
  with 5 office tools available
- **THEN** the office tool bar SHALL render the first 2 tools inline
  and place the remaining 3 in the `MoreHorizontal` dropdown

#### Scenario: Desktop header preserves existing layout
- **WHEN** viewport width is `1440px`
- **THEN** the header SHALL render the existing layout: peer workspace
  nav (full labels + icons), provider badge, project slot, mode toggle,
  office tools (3 visible + overflow), notification slot

### Requirement: Sidebar collapse persists per workspace via `localStorage`

Every workspace with a left sidebar SHALL support an `expanded` /
`collapsed` toggle whose state persists in `localStorage`. The
sidebars in scope are the Office left rail, SOPs sidebar, Personnel
list, and Settings nav. The persistence key SHALL be
`offisim:workspace:<key>:left-rail` where `<key>` is the WorkspaceKey
literal.

At narrow tier the persisted value SHALL be ignored and the layout
SHALL force `collapsed`. The persisted value SHALL NOT be overwritten
during narrow-tier render — when the viewport widens to tablet+, the
persisted preference SHALL take effect again.

At tablet tier the persisted value SHALL drive visibility, defaulting to
`expanded` if no value is stored.

At desktop tier the persisted value SHALL drive visibility, defaulting
to `expanded` if no value is stored.

The collapsed state of a sidebar SHALL render an icon-only rail (44px
wide for compact sidebars, 56px for those with action buttons) with a
visible "expand" affordance (chevron-right icon).

#### Scenario: Sidebar collapse preference persists per workspace
- **WHEN** the user collapses the SOPs sidebar at desktop tier
- **THEN** `localStorage.getItem('offisim:workspace:sops:left-rail')`
  SHALL return `'collapsed'`
- **AND** subsequent renders of the SOPs workspace at desktop tier SHALL
  restore the collapsed state

#### Scenario: Narrow tier forces collapse without overwriting preference
- **WHEN** the user has persisted `'expanded'` for the Personnel sidebar
  and the viewport is `390px`
- **THEN** the sidebar SHALL render collapsed regardless of the persisted
  value
- **AND** `localStorage.getItem('offisim:workspace:personnel:left-rail')`
  SHALL still return `'expanded'`
- **AND** when the viewport widens to `1440px`, the sidebar SHALL render
  expanded per the persisted value

#### Scenario: Default collapsed at narrow, expanded at tablet+
- **WHEN** the user has no persisted preference and the viewport is `390px`
- **THEN** the sidebar SHALL render collapsed
- **AND** when the viewport is `1024px` with no persisted preference,
  the sidebar SHALL render expanded

### Requirement: Responsive verification SHALL cover 5 viewports × 6 workspaces

The responsive change SHALL be live-verified at the five viewport widths
`390x844`, `768x1024`, `1024x768`, `1440x900`, `1920x1080` across all
six peer workspaces (Office, SOPs, Market, Activity Log, Settings,
Personnel) plus the Header narrow hamburger flow and the Onboarding tour.

The verification record SHALL include a 5×6 matrix marking each
(viewport × workspace) combination as either "verified" with a
screenshot or note, or "limitation" with a documented product decision.

#### Scenario: Verification matrix covers all combinations
- **WHEN** the change is verified before archive
- **THEN** the verification record SHALL contain at least 30
  (viewport × workspace) entries plus header narrow + tour entries
- **AND** any "limitation" entry SHALL state the product decision (e.g.
  "SOPs narrow tier is read-only; edit requires tablet+")

#### Scenario: Document overflow check at every narrow combination
- **WHEN** verifying any workspace at `390x844`
- **THEN** `document.documentElement.scrollWidth <= window.innerWidth`
  SHALL hold (no horizontal scroll)
- **AND** the active screen's primary CTA (if any) SHALL be visible or
  reachable by vertical scroll

## MODIFIED Requirements

### Requirement: App shell supports desktop tablet and narrow viewports

The main app shell SHALL define stable desktop, tablet, and narrow
layout behavior without horizontal document overflow. The active tier
SHALL be determined by `useLayoutTier()` (`narrow ≤768`, `tablet
769–1280`, `desktop >1280`) — Tailwind utility breakpoints SHALL NOT
be the trigger for layout topology decisions. At `390px` viewport
width, the user SHALL be able to reach the active screen's primary
action without content being clipped by side rails, collapse handles,
overlays, or fixed footers. At desktop and tablet widths in Office,
the right rail (chat / tasks surface) SHALL render expanded by default
unless the user has explicitly collapsed it (preference persisted in
`localStorage`).

#### Scenario: Desktop workspace retains full shell
- **WHEN** the viewport is `1440x900` and the active workspace is Office
- **THEN** the app renders Header, left panel, central scene/workspace
  area, right task panel, and StatusBar without overlapping the primary
  scene or task input controls
- **AND** the right rail SHALL render expanded by default

#### Scenario: Tablet workspace keeps right rail expanded
- **WHEN** the viewport is `1280x800` and the active workspace is Office
  with no persisted right rail preference
- **THEN** AppLayout SHALL render the right rail expanded (not collapsed)
- **AND** SHALL preserve visible peer workspace navigation, the active
  workspace body, and the current primary action
- **AND** MAY collapse other secondary rails or handles per the per-
  workspace tier decision table

#### Scenario: Narrow viewport has no horizontal overflow
- **WHEN** the viewport is `390x844` for any workspace
- **THEN** `document.documentElement.scrollWidth` SHALL be less than or
  equal to `window.innerWidth`
- **AND** the active screen's primary CTA SHALL be visible or reachable
  by vertical scrolling and clickable without pointer interception

### Requirement: Personnel workspace adapts at narrow tablet desktop tiers

The Personnel workspace SHALL render readable layouts at `390x844`,
`1024x768`, `1280x800`, and `1440x900`. At desktop the list rail,
detail+preview, and tabs inspector SHALL render as three concurrent
panes via `grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]`. At tablet
the layout SHALL render two columns `[220px_minmax(0,1fr)]` with the
detail pane swapping between summary and active tab content, and a
`Back to detail` affordance returning from a tab to the summary. At
narrow the panes SHALL stack and avoid horizontal document overflow,
with drill navigation list → detail → tabs.

The Personnel workspace SHALL consume `useLayoutTier()` rather than
relying on Tailwind `lg:` class alone — the existing
`grid-cols-1 lg:grid-cols-[…]` SHALL be replaced with tier-driven
column count selection so the tablet tier (769–1280) gets a real two-
pane experience instead of single-column stacking.

#### Scenario: Desktop renders three panes
- **WHEN** viewport is `1440x900` and `activeWorkspace === 'personnel'`
- **THEN** the list, detail+preview, and right tabs inspector SHALL
  render side by side
- **AND** each pane SHALL be vertically scrollable independently

#### Scenario: Tablet renders two panes with tab swap
- **WHEN** viewport is `1024x768` and `activeWorkspace === 'personnel'`
- **THEN** the page SHALL render two columns: list (220px) + detail
  area (remaining)
- **AND** when the user selects a tab from the inspector, the tab
  content SHALL render in the detail area
- **AND** a `Back to detail` affordance SHALL be visible while a tab
  is active, returning to the employee summary on click

#### Scenario: Narrow stacks panes and avoids overflow
- **WHEN** viewport is `390x844` and `activeWorkspace === 'personnel'`
- **THEN** `document.documentElement.scrollWidth` SHALL be ≤
  `window.innerWidth`
- **AND** the active pane (list, detail, or tabs) SHALL fill the viewport
  with the others reachable via Back

### Requirement: Responsive behavior is verified by screenshot QA

The responsive shell change SHALL be validated through local screenshots
or equivalent browser automation at `390x844`, `768x1024`, `1024x768`,
`1280x800`, and `1440x900`, AND `1920x1080` for verification of
ultra-wide layout stability. Coverage SHALL include all six peer
workspaces (Office, SOPs, Market, Activity Log, Settings, Personnel)
plus header narrow hamburger flow and onboarding tour walkthrough.

#### Scenario: Required viewport capture set exists
- **WHEN** implementation verification is performed
- **THEN** the verification notes SHALL include the six required
  viewport sizes and SHALL cover all six peer workspaces, the header
  narrow hamburger flow, and the onboarding tour
- **AND** any remaining narrow-screen limitation SHALL be documented as
  a product decision rather than an accidental clipping bug
