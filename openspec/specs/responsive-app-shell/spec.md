# responsive-app-shell

## Purpose

The main app shell defines stable layout behavior at desktop (1440x900), tablet (1280x800), and narrow (390x844) viewports without horizontal document overflow. The active screen's primary action is reachable at narrow widths without being clipped by rails, collapse handles, overlays, or fixed footers. Company Portal and the template wizard stack into single column on narrow screens. Screens with sticky/fixed bottom actions reserve enough bottom padding so the last form field, validation message, or preview is never hidden behind the footer. The responsive change is validated through screenshot QA at the three reference viewports across all primary screens.
## Requirements
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

### Requirement: Company entry flows stack on narrow screens
Company Portal and the template wizard SHALL switch from desktop multi-column layouts to narrow single-column layouts at narrow viewport widths. Company list, template selection, details, preview, and primary action SHALL appear in a linear order that preserves task continuity.

#### Scenario: Empty Company Portal on narrow viewport
- **WHEN** the user has no active company and opens the app at `390x844`
- **THEN** the portal presents the create-company path in a single column
- **AND** the primary create CTA is not clipped by the company list, preview region, or right-side brief panel

#### Scenario: Template wizard start action on narrow viewport
- **WHEN** the template wizard is open at `390x844`
- **THEN** the template selector, selected template details, preview, and `Start Company` action stack vertically
- **AND** tapping `Start Company` is not blocked by any overlapping side panel or scroll container

### Requirement: Fixed bottom action areas reserve readable content space
Screens with sticky or fixed bottom actions SHALL reserve enough bottom padding in the scrollable content area so the last form field, preview, validation message, or card is not obscured by the footer.

#### Scenario: Employee Creator footer does not cover form content
- **WHEN** Employee Creator is open and the user scrolls to the bottom
- **THEN** the last editable field and validation message remain fully visible above the bottom action bar

#### Scenario: Settings save area does not cover controls
- **WHEN** Settings has unsaved or invalid changes and the user scrolls to the bottom of a tab
- **THEN** the save area remains visible without covering the last control in the active tab

#### Scenario: Company Editor footer does not cover preview content
- **WHEN** Company Editor is open at desktop or narrow width
- **THEN** footer actions remain available and the editable content above them retains readable spacing

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

### Requirement: Personnel page reserves bottom action space
The Profile tab inside Personnel SHALL render any sticky save / delete actions without obscuring the last visible field. Placeholder tabs SHALL not introduce sticky footers.

#### Scenario: Profile tab save bar leaves the last form field visible
- **WHEN** the user scrolls to the bottom of the Profile tab content with unsaved changes
- **THEN** the last form field, validation message, or section heading SHALL remain fully visible above any sticky action bar

### Requirement: Narrow tier verification scope is the desktop renderer in browser

The narrow tier (`390x844`) verification surface SHALL be the desktop renderer opened in a browser viewport (`pnpm --filter @offisim/desktop-renderer dev` plus browser DevTools resize, or a production browser opening the deployed desktop renderer). The Tauri release `.app` window SHALL NOT be required to support narrow tier viewports.

This Requirement does not weaken any of the existing narrow-tier scenarios (e.g., `Narrow viewport has no horizontal overflow`, `Empty Company Portal on narrow viewport`, `Template wizard start action on narrow viewport`, `Narrow stacks panes and avoids overflow`). Those scenarios continue to apply unchanged — but their verification target is the desktop renderer, not the desktop release shell.

#### Scenario: Narrow scenario verification target is desktop renderer
- **WHEN** any narrow-tier (`390x844`) scenario in this capability is verified during a release-readiness pass
- **THEN** the verifier SHALL drive the desktop renderer in a browser viewport (or equivalent browser automation)
- **AND** the verifier SHALL NOT use the Tauri release `.app` as the narrow-tier surface

#### Scenario: Tauri release `.app` is exempt from narrow tier
- **WHEN** the desktop release `.app` is launched
- **THEN** the OS window SHALL NOT be required to render correctly below the desktop product floor
- **AND** verifiers SHALL NOT log a regression against narrow-tier scenarios solely because the desktop window cannot reach `390px` width

### Requirement: Tauri release window enforces desktop product floor

The Tauri release `.app` main window SHALL define a `minWidth` of at least `1024` and a `minHeight` consistent with the existing `responsive-app-shell` desktop and tablet tiers. The window's default `width` × `height` SHALL remain at least the existing tablet tier (`1280x800`) so first-launch lands inside a verified responsive tier.

The desktop product floor SHALL NOT be relaxed solely to enable narrow-tier verification inside the desktop shell — narrow-tier verification has its own surface (desktop renderer, see prior Requirement).

#### Scenario: Release `.app` window enforces minWidth ≥ 1024
- **WHEN** the user attempts to drag the desktop release `.app` window to a width below `1024px`
- **THEN** the OS window manager SHALL clamp the window at `1024px` per the configured `minWidth`

#### Scenario: First-launch window lands at tablet tier or larger
- **WHEN** the user launches the release `.app` for the first time on a fresh install
- **THEN** the main window opens at `1280x800` or larger (within OS desktop bounds)
- **AND** the rendered shell matches the existing tablet-tier scenario `Tablet workspace keeps right rail expanded`

#### Scenario: Window minimum is enforced at the Tauri config layer
- **WHEN** a developer or verifier inspects `apps/desktop/src-tauri/tauri.conf.json` `app.windows[0]`
- **THEN** `minWidth` SHALL be a number ≥ `1024`
- **AND** `minHeight` SHALL be a number consistent with the documented tablet tier baseline (`700` or higher)

### Requirement: App shell SHALL initialize workspace state from URL on first paint

`apps/desktop/renderer/src/App.tsx` SHALL parse `window.location` exactly once on
first render (via `parseInitialUrl()`) and pass the resulting
`{ workspace, sessionPatch, overlay }` triple as `initial` props to
`useWorkspaceSessionState({ initial })` and `useOverlayState({ initial })`.
The first frame SHALL render the workspace + entity + overlay encoded in
the URL, not the default Office workspace, when the URL targets a
non-default state.

If the URL targets a non-Office workspace OR a primary entity AND
`activeCompanyId === null`, the parsed deep link SHALL be queued in a
`pendingDeepLinkRef` and the `company-select` overlay SHALL show.
Once a company is selected, the queued deep link SHALL be replayed via
`applyParsedUrl` and the ref cleared.

#### Scenario: Deep link rendered on first paint
- **WHEN** the user opens `http://localhost:5176/personnel/emp_alex_002?tab=runtime` in a fresh window with an existing `activeCompanyId`
- **THEN** the very first frame renders the Personnel workspace with Alex selected on the Runtime tab
- **AND** there is no observable Office → Personnel transition during initial paint

#### Scenario: Initial parse runs once
- **WHEN** the App component re-renders due to runtime initialization or any other reason
- **THEN** `parseInitialUrl` SHALL NOT be re-invoked — the parsed result is captured at first render via `useState` initializer or module-level computation

#### Scenario: Deep link queued during company-select gate
- **WHEN** the user opens `/personnel/emp_alex_002?tab=skills` in a fresh window with no active company
- **THEN** the company-select overlay shows
- **AND** the parsed URL is held in `pendingDeepLinkRef`
- **WHEN** the user picks a company
- **THEN** the Personnel workspace + Alex + Skills tab restore in one step
- **AND** the ref is cleared

#### Scenario: Browser back during company-select gate clears the queue
- **WHEN** the user opens `/sops/sop_abc` in a fresh window with no active company AND presses browser back before selecting
- **THEN** `pendingDeepLinkRef` is cleared
- **AND** subsequent company selection lands on default Office, not on SOPs

### Requirement: useWorkspaceSessionState SHALL accept initial URL state and emit URL writes through useUrlSync

`useWorkspaceSessionState` SHALL accept an optional `{ initial?: {
activeWorkspace?: WorkspaceKey; sessionPatch?: Partial<WorkspaceSessionState>
} }` parameter. When `initial.activeWorkspace` is set, the hook
SHALL initialize `activeWorkspace` to that value (else default `'office'`).
When `initial.sessionPatch` is set, the hook SHALL deep-merge it over
`createDefaultSessionState()` for the initial `sessionState`.

The hook SHALL no longer maintain an internal `historyStack:
WorkspaceKey[]` — back navigation flows through `popstate` and the URL
parser. `setActiveWorkspace` SHALL update active workspace + run the
existing office-leave cleanup, but SHALL NOT push onto an internal stack.

State changes that fall under the URL grammar SHALL flow through
`useUrlSync`, which is hooked once at the App level and writes to
`history.{push,replace}State` per Decision 4 (push for identity changes,
replace for in-place changes).

#### Scenario: Hook accepts initial workspace
- **WHEN** `useWorkspaceSessionState({ initial: { activeWorkspace: 'personnel' } })` is invoked
- **THEN** the returned `activeWorkspace` is `'personnel'` immediately on first render

#### Scenario: Hook accepts initial sessionPatch
- **WHEN** `useWorkspaceSessionState({ initial: { activeWorkspace: 'personnel', sessionPatch: { personnel: { selectedEmployeeId: 'emp_maya', activeEmployeeTab: 'memory' } } } })` is invoked
- **THEN** the returned `state.personnel` equals `{ selectedEmployeeId: 'emp_maya', activeEmployeeTab: 'memory' }`

#### Scenario: setActiveWorkspace does not maintain internal stack
- **WHEN** the user calls `setActiveWorkspace('sops')` then `setActiveWorkspace('market')`
- **THEN** the hook does NOT carry an internal `historyStack` — back navigation is driven by `popstate`

#### Scenario: useUrlSync is the sole URL writer
- **WHEN** the hook updates state via `updateWorkspaceState` or `setActiveWorkspace`
- **THEN** the hook itself does NOT call `history.pushState` or `history.replaceState`
- **AND** the URL change is emitted by `useUrlSync` after the React render commits

### Requirement: useWorkspaceBackNavigation SHALL delegate to URL-driven popstate

`useWorkspaceBackNavigation` SHALL no longer push an initial history
entry on mount. The popstate handler SHALL re-parse `window.location`
through `parseUrl` + `applyFallbackRules` and call `applyParsed` to
update workspace + session state + overlay. Internal drill-in
(via `tryWorkspaceInternalBack`) SHALL no longer be triggered by
browser back — instead it SHALL be invoked by the Escape-key
shortcut, which writes the resulting state via `updateWorkspaceState`
(URL replace flows through `useUrlSync`).

The hook SHALL remain importable from `apps/desktop/renderer/src/components/workspaces/`
for backward compatibility but its internal implementation SHALL be
URL-routing-driven.

#### Scenario: Mount does not push initial entry
- **WHEN** `useWorkspaceBackNavigation` mounts
- **THEN** the hook SHALL NOT call `history.pushState` during the mount effect
- **AND** `window.history.length` is unchanged immediately after mount

#### Scenario: popstate triggers URL re-parse
- **WHEN** the user presses browser back from `/personnel/emp_alex` to `/personnel`
- **THEN** the popstate handler calls `parseUrl(window.location)`
- **AND** the parsed result is applied via `applyParsed` (single batched setter call)
- **AND** the rendered app state matches `/personnel` (no selection)

#### Scenario: Escape unwind uses URL replace
- **WHEN** the user is on `/personnel/emp_alex?tab=memory` and presses Escape
- **THEN** `tryWorkspaceInternalBack('personnel', state)` returns the unwind step (tab → profile)
- **AND** `updateWorkspaceState` writes the result
- **AND** `useUrlSync` emits `history.replaceState` with `/personnel/emp_alex?tab=profile`
- **AND** browser back then returns to the original `?tab=memory` URL only if there is a previous history entry for it (which there is NOT, because tab toggle is replace; back skips it)

### Requirement: useOverlayState SHALL accept initial overlay and emit URL writes

`useOverlayState` SHALL accept an optional `{ initial?: OverlayKey | null }`
parameter alongside the existing `activeCompanyId`. The hook SHALL
initialize `activeOverlay` from `initial` if explicitly set, else
fall back to the existing rule (`'company-select'` if no company,
else `null`).

URL-addressable overlays (`employee-creator`, `office-editor`, `studio`)
SHALL be reflected in the URL through `useUrlSync`. The
`'company-select'` overlay SHALL NOT be in the URL.

#### Scenario: Initial overlay applied
- **WHEN** `useOverlayState({ initial: 'office-editor', activeCompanyId: 'co_acme' })` is invoked
- **THEN** the returned `activeOverlay` is `'office-editor'` immediately

#### Scenario: company-select overrides null when no company
- **WHEN** `useOverlayState({ initial: null, activeCompanyId: null })` is invoked
- **THEN** the returned `activeOverlay` is `'company-select'` (existing behavior preserved)

#### Scenario: Overlay change syncs to URL
- **WHEN** the user opens the office-editor overlay via `openOfficeEditor()`
- **THEN** `useUrlSync` emits `history.pushState` with `/?overlay=office-editor`
- **WHEN** the user calls `closeOverlay()`
- **THEN** `useUrlSync` emits `history.pushState` with `/`

### Requirement: createRouteToPersonnel SHALL drive single URL navigation

`apps/desktop/renderer/src/lib/personnel-routing.ts` `createRouteToPersonnel` SHALL
build the target URL using the URL serializer, perform exactly one
navigation step (`history.pushState` or `replaceState` per Decision 4),
and call `applyParsedUrl` to write through state. It SHALL NOT call
`setActiveWorkspace` and `updateWorkspaceState` separately.

The deps interface SHALL be `{ applyParsedUrl: (parsed: ParsedUrl) =>
void }` instead of `{ setActiveWorkspace, updateWorkspaceState }`.

#### Scenario: Single navigation per call
- **WHEN** `routeToPersonnel('emp_maya', 'appearance')` is invoked while on Office
- **THEN** exactly one new entry is added to `window.history`
- **AND** `setActiveWorkspace` and `updateWorkspaceState` are each invoked at most once each (through `applyParsedUrl`'s single batched setter)
- **AND** the URL becomes `/personnel/emp_maya?tab=appearance`

#### Scenario: Same primary entity replaces in place
- **WHEN** `routeToPersonnel('emp_maya', 'memory')` is invoked while on `/personnel/emp_maya?tab=appearance`
- **THEN** `history.replaceState` is used (not `pushState`) because primary entity is unchanged
- **AND** `window.history.length` does NOT increase

### Requirement: All peer workspaces SHALL consume `useLayoutTier()` for layout topology

Every peer-level workspace surface component SHALL read the active
layout tier via `useLayoutTier()` and choose its column count, sidebar
visibility, drawer behavior, and pane stacking based on the returned
`LayoutTierConfig.tier` value (`'narrow' | 'tablet' | 'desktop'`). The
six surfaces in scope are `SopViewSurface`, `MarketPage`,
`ActivityLogPage`, `SettingsPage`, `PersonnelPage`, and the office
workspace's center surface. The hook lives at
`apps/desktop/renderer/src/components/workspaces/useLayoutTier.ts` and is re-exported
from
`apps/desktop/renderer/src/components/workspaces/useLayoutTier.ts` (re-exported from
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

### Requirement: WorkspacePageShell loading skeleton SHALL match ready-state floor per workspace

`WorkspacePageShell.LoadingSkeleton` SHALL reserve a `min-height` equal to the active workspace's known ready-state floor. The reservation SHALL be expressed via the CSS custom property `--workspace-min-content-height` declared in `workspace-shell.css` keyed off the `data-workspace` attribute.

Per-workspace floors:

- `office`: `540px`
- `personnel`: `600px`
- `sops`: `540px`
- `market`: `480px`
- `activity-log`: `600px`
- `settings`: `480px`
- Default fallback (any workspace not yet listed): `480px`

The skeleton's outer block SHALL apply class `workspace-shell-loading-region` whose CSS resolves to `min-height: var(--workspace-min-content-height)`.

#### Scenario: Personnel loading reserves 600 px

- **WHEN** Personnel workspace renders with `loading=true` at 1440x900
- **THEN** `getComputedStyle(skeletonOuterBlock).minHeight` SHALL be `'600px'`
- **AND** the loading→ready transition SHALL NOT shift the page

#### Scenario: Office loading reserves 540 px

- **WHEN** Office workspace renders with `loading=true` at 1440x900
- **THEN** `getComputedStyle(skeletonOuterBlock).minHeight` SHALL be `'540px'`

#### Scenario: Default fallback applies to unknown workspace

- **WHEN** a workspace renders with `data-workspace` not yet declared in `workspace-shell.css`
- **THEN** the skeleton SHALL apply `min-height: 480px` via the `.workspace-shell` default
- **AND** loading SHALL NOT collapse to zero or unreserve space

### Requirement: Web shell SHALL preload custom fonts with font-display: swap

`apps/desktop/renderer/index.html` SHALL contain `<link rel="preload" as="font" type="font/woff2" crossorigin>` tags for every custom font referenced by `apps/desktop/renderer/src/index.css` `@font-face` declarations. Each font SHALL be served from a same-origin path under `/fonts/` so the Tauri release `.app` running from `tauri://localhost` can load it without CSP allowlist changes.

Each `@font-face` block SHALL declare `font-display: swap` so first-paint uses system fallback and the swap to the custom font is non-blocking.

After this change the desktop renderer shell SHALL preload:

- `Inter` variable woff2 (`/fonts/inter-var.woff2`), weight `100 900`, Latin + Latin Extended subset, ≤ 110 KB.
- `JetBrains Mono` variable woff2 (`/fonts/jetbrains-mono-var.woff2`), weight `100 800`, Latin subset, ≤ 80 KB.

Combined preload payload SHALL be ≤ 200 KB.

#### Scenario: Web index.html preloads both fonts

- **WHEN** loading `apps/desktop/renderer/dist/index.html` after build
- **THEN** the document `<head>` SHALL contain `<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>`
- **AND** SHALL contain `<link rel="preload" href="/fonts/jetbrains-mono-var.woff2" as="font" type="font/woff2" crossorigin>`

#### Scenario: Both @font-face blocks declare font-display: swap

- **WHEN** auditing `apps/desktop/renderer/src/index.css` `@font-face` blocks
- **THEN** both Inter and JetBrains Mono blocks SHALL declare `font-display: swap`
- **AND** `src` URLs SHALL resolve to same-origin `/fonts/*.woff2` paths (no third-party CDN)

#### Scenario: First-paint FOUT is bounded

- **WHEN** loading the desktop renderer shell at 1440x900 with cache disabled and Slow 3G throttle
- **THEN** the cumulative layout shift attributable to font swap SHALL be ≤ 0.10 measured by Chrome DevTools Performance trace
- **AND** the first contentful paint SHALL render text in system fallback within 100 ms after navigation start
- **AND** the font preload requests SHALL initiate ≤ 50 ms after navigation start

### Requirement: Responsive break SHALL preserve same height budget on both sides

When a workspace surface uses a responsive grid that swaps between layouts at the `lg` (1280 px) break, the surface SHALL maintain the same `min-height` budget for any tabbed content region on both sides of the break. Resizing the window across the break SHALL NOT cause the tabbed content's height to change.

This applies specifically to:

- Personnel page (`PersonnelPage.tsx:129`): the inspector's `min-h-[560px]` SHALL apply in both narrow (flex column) and desktop (3-column grid) tiers.

Future surfaces with responsive grids holding tabbed content SHALL document and preserve their height budget similarly.

#### Scenario: Personnel inspector keeps 560 px floor across 1280 px resize

- **WHEN** the user resizes the Personnel page window between 1270 px and 1290 px
- **THEN** the inspector tabs region SHALL maintain `min-height: 560px` on both sides of the break
- **AND** the page layout SHALL NOT change the inspector's height budget

#### Scenario: Narrow tier preserves height budget

- **WHEN** the viewport is < 1280 px and Personnel is open with an employee selected
- **THEN** the inspector pane in the stacked (flex column) layout SHALL apply `min-h-[560px]`
- **AND** the inspector SHALL NOT collapse below 560 px even if its current tab content is shorter

