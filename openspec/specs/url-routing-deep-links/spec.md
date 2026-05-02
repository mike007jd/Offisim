# url-routing-deep-links Specification

## Purpose
TBD - created by archiving change add-url-sync-and-deep-links. Update Purpose after archive.
## Requirements
### Requirement: URL is the canonical source of truth for workspace identity, primary entity, secondary state, and non-modal overlays

`window.location.pathname + window.location.search` SHALL be the canonical
expression of the user's current workspace, the primary entity selected
within that workspace (employee id, sop id, listing id, settings section,
activity event id), the secondary state (tab, view mode, filters, search),
and any addressable overlay (`employee-creator`, `office-editor`, `studio`).
Two separate web sessions presenting the same URL — one freshly opened
from the address bar, one resumed via browser refresh — SHALL render the
same workspace + nested state + overlay byte-equivalent (modulo
async-loaded content like network-fetched listings).

The `company-select` overlay SHALL NOT appear in the URL — it is a modal
pre-condition that opens automatically when `activeCompanyId === null`
and closes when a company is chosen.

#### Scenario: Identical URL produces identical state
- **WHEN** two browser windows load `http://localhost:5176/personnel/emp_maya_001?tab=appearance`
- **THEN** both windows display the Personnel workspace with `selectedEmployeeId = 'emp_maya_001'` and `activeEmployeeTab = 'appearance'`
- **AND** the URL bar in both windows reads exactly that path + query

#### Scenario: Refresh preserves URL state
- **WHEN** the user navigates from Office to Personnel, drills into employee Maya, switches to Appearance tab, then presses `Cmd+R`
- **THEN** after reload the address bar still reads `/personnel/emp_maya_001?tab=appearance`
- **AND** the visible app state is Personnel + Maya + Appearance, not the default Office

#### Scenario: company-select overlay is not in URL
- **WHEN** the user opens the app with `activeCompanyId === null`
- **THEN** the `company-select` overlay is shown
- **AND** the URL does NOT contain `?overlay=company-select` and the parser does NOT recognize that token

### Requirement: URL Grammar Table SHALL define exactly one canonical URL per addressable state

The URL parser and serializer SHALL implement the URL Grammar Table from
the design document, covering 6 workspaces and 4 overlays. For every
addressable state there SHALL be exactly one canonical serialized URL,
and `parseUrl(serializeUrl(state))` SHALL be deeply equal to `state` for
every state in the canonical corpus.

The table SHALL include:

- Office: `/` or `/office` (parse accepts both, serialize emits `/`); query params `view=2d|3d`, `company=<id>`, `dashboard=1`, `kanban=1`, `listing=<id>`, `overlay=office-editor`.
- SOPs: `/sops` (list), `/sops/<sopId>` (selected), `/sops/<sopId>?step=<stepId>` (selected + focused step), query param `q=<search>`.
- Market: `/market/explore`, `/market/explore/<listingId>`, `/market/manage`, `/market/manage/<tab>` where `<tab> ∈ {installed,updates,published}`, `/market/manage/<tab>?detail=<listingId>`, plus query params `q`, `kind`, `sort`.
- Personnel: `/personnel`, `/personnel/new` (employee-creator overlay), `/personnel/<employeeId>`, `/personnel/<employeeId>?tab=<tabId>` where `<tabId> ∈ {profile,appearance,runtime,skills,memory,history}`.
- Activity Log: `/activity` (filterless), `/activity?event=<eventId>`, query params `type=<csv>`, `actor=<csv>`, `date=today|7d|30d|custom`, `q=<search>`.
- Settings: `/settings/<section>` where `<section> ∈ {provider,runtime,mcp,external}`.
- Studio overlay: `/studio?company=<companyId>`.

#### Scenario: Round-trip identity
- **WHEN** the canonical state corpus is iterated and each state is round-tripped through `serializeUrl` then `parseUrl`
- **THEN** the parsed result is deeply equal to the original state for every entry in the corpus

#### Scenario: Personnel URL grammar
- **WHEN** the user opens Personnel, selects employee `emp_alex_002`, switches to the Skills tab
- **THEN** the URL becomes `/personnel/emp_alex_002?tab=skills`
- **AND** parsing that URL yields `{ workspace: 'personnel', sessionPatch: { personnel: { selectedEmployeeId: 'emp_alex_002', activeEmployeeTab: 'skills' } } }`

#### Scenario: Activity log filter grammar
- **WHEN** the user filters Activity by event types `task,manager`, actor `pm-planner`, date preset `7d`, search `maya`, with no event focused
- **THEN** the URL is `/activity?type=task,manager&actor=pm-planner&date=7d&q=maya`
- **AND** parsing that URL recovers the same filter slice

#### Scenario: Market manage tab with detail
- **WHEN** the user is on the Manage section, Published tab, with listing `skill_audit_v1` showing in the detail panel
- **THEN** the URL is `/market/manage/published?detail=skill_audit_v1`

### Requirement: parseUrl and serializeUrl SHALL be pure functions

`parseUrl({ pathname, search })` and `serializeUrl(state)` SHALL be
deterministic and side-effect-free. Calling either function twice with
the same input SHALL return deeply-equal output. Neither function SHALL
read `window.location` directly nor make network calls. They SHALL be
import-side-effect-free at module level.

#### Scenario: Determinism
- **WHEN** `parseUrl(input)` is called twice
- **THEN** the two return values are deeply equal
- **AND** no logger, event bus, fetch, or DOM call is made during execution

#### Scenario: No window.location read inside parser
- **WHEN** `parseUrl` is invoked
- **THEN** the function only consults its argument; the only entry point that reads `window.location` is the `parseInitialUrl()` helper

### Requirement: URL writes SHALL distinguish push vs replace based on identity changes

`useUrlSync` SHALL classify every state change and emit
`history.pushState` for identity changes or `history.replaceState`
for in-place changes:

- **Identity change (pushState)**: `activeWorkspace` differs, OR `activeOverlay` differs, OR primary path entity differs (employee id, sop id, market listing id, market manage tab, settings section, activity event id), OR `office.viewMode` toggles, OR Office overlay flags `dashboardOpen`/`kanbanOpen`/`marketplaceListingId` toggle.
- **In-place change (replaceState)**: any other state change including filter param toggles, search string typing, sort/kind dropdown changes, panel widths, scroll positions.

#### Scenario: Workspace switch pushes a new history entry
- **WHEN** the user clicks the Personnel nav button while on Office
- **THEN** `history.pushState` is called with the new URL `/personnel`
- **AND** `window.history.length` increases by 1

#### Scenario: Tab toggle replaces in place
- **WHEN** the user is on `/personnel/emp_alex/?tab=profile` and switches to the Memory tab
- **THEN** `history.replaceState` is called with `/personnel/emp_alex?tab=memory`
- **AND** `window.history.length` does NOT increase

#### Scenario: Filter toggle replaces in place
- **WHEN** the user is on `/activity?type=task` and adds the `manager` filter
- **THEN** `history.replaceState` is called with `/activity?type=task,manager`

#### Scenario: Office viewMode toggle pushes a new entry
- **WHEN** the user toggles Office viewMode from 3D to 2D
- **THEN** `history.pushState` is called with the URL containing `?view=2d`
- **AND** browser back returns to 3D view

### Requirement: popstate SHALL re-parse URL and reapply state

A `popstate` event SHALL trigger `parseUrl(window.location)`, run
`applyFallbackRules(parsed, runtime)`, then call the registered
`applyParsed(result)` callback to write through `setActiveWorkspace`,
`updateWorkspaceState`, and `setActiveOverlay` in one batched update.
The popstate handler SHALL set an `isApplyingPopstate` ref before
the setters fire and clear it after a microtask, so the re-render
triggered by popstate does NOT cause `useUrlSync` to push a new entry
(avoiding the `popstate → setState → useUrlSync → pushState` loop).

#### Scenario: Browser back rolls back to previous state
- **WHEN** the user navigates Office → Personnel → Personnel/Maya → Personnel/Alex, then presses browser back twice
- **THEN** the user lands on Personnel without selection
- **AND** the URL bar reads `/personnel`
- **AND** no extra history entries are introduced by the popstate handler

#### Scenario: Browser forward replays
- **WHEN** the user has navigated Office → Personnel and pressed back to Office
- **AND** then presses browser forward
- **THEN** the user returns to Personnel
- **AND** the URL bar reads `/personnel`

#### Scenario: popstate does not loop
- **WHEN** popstate fires and `applyParsed` causes a state update
- **THEN** the `useUrlSync` hook does NOT re-emit `pushState` or `replaceState` for the corresponding render
- **AND** `window.history.length` is unchanged across the popstate handling

### Requirement: createRouteToPersonnel SHALL drive a single URL navigation

`createRouteToPersonnel` in `apps/web/src/lib/personnel-routing.ts` SHALL compute the target URL via `serializePersonnelUrl(employeeId, tab)`, call `history.pushState(null, '', url)`, then call the registered `applyParsedUrl(parsed)` once. It SHALL NOT call `setActiveWorkspace` and `updateWorkspaceState` separately.

The same single-URL-write pattern applies to any future cross-surface
navigation helper (e.g. `routeToActivityEvent`, `routeToSop`,
`routeToMarketDetail`).

#### Scenario: routeToPersonnel pushes one history entry
- **WHEN** any callsite calls `routeToPersonnel('emp_maya_001', 'appearance')` while on Office
- **THEN** exactly one new entry is added to `window.history`
- **AND** the URL bar reads `/personnel/emp_maya_001?tab=appearance`
- **AND** the React app renders the Personnel workspace with Maya selected, Appearance tab

#### Scenario: routeToPersonnel replaces when same primary entity
- **WHEN** the callsite calls `routeToPersonnel('emp_maya_001', 'memory')` while already on `/personnel/emp_maya_001?tab=appearance`
- **THEN** the URL change `tab=appearance → tab=memory` is treated as in-place
- **AND** `history.replaceState` is used instead of `pushState`

### Requirement: Initial-paint URL parse SHALL happen before first render

`App.tsx` SHALL call `parseInitialUrl()` synchronously at module load
or in a `useState` initializer that runs exactly once, then pass the
parsed result as `initial` props to `useWorkspaceSessionState({ initial })`
and `useOverlayState({ initial })` so the first render reflects the
deep-link target without an interim Office flash.

#### Scenario: First paint matches deep link
- **WHEN** the user opens `/personnel/emp_alex/?tab=skills` in a fresh window
- **THEN** the very first frame renders the Personnel workspace with Alex selected on the Skills tab
- **AND** there is NO observable transition from Office to Personnel during initial paint

#### Scenario: parseInitialUrl runs once
- **WHEN** the App component re-renders for any reason
- **THEN** `parseInitialUrl` SHALL NOT be called again — the parsed result is captured at first render via `useState` initializer

### Requirement: Fallback rules SHALL handle unknown URLs gracefully

The URL parser SHALL route unknown workspace keys, unknown overlay tokens, malformed query parameters, and missing primary entities through `applyFallbackRules`, which:

- Falls back to Office workspace with default state when the workspace
  key is unknown (silent — no toast).
- Falls back to the workspace base when a primary entity is not found
  in the active runtime data, AND emits an info-level toast `Couldn't
  open the link — <entity-kind> not found.` (e.g. employee, sop, listing).
- Drops cosmetic params (filter values, sort, search) that fail
  validation, silently — they are not load-bearing for identity.
- Drops unrecognized overlay tokens silently.

#### Scenario: Unknown workspace falls back to Office silently
- **WHEN** the user pastes `/garbage_workspace`
- **THEN** the app loads Office workspace
- **AND** no toast is shown
- **AND** `history.replaceState` rewrites the URL to `/`

#### Scenario: Missing employee surfaces a toast
- **WHEN** the user pastes `/personnel/emp_does_not_exist`
- **THEN** the app loads Personnel workspace with no selection
- **AND** an info-level toast appears reading `Couldn't open the link — employee not found.`
- **AND** the URL is rewritten to `/personnel`

#### Scenario: Invalid filter value drops silently
- **WHEN** the user pastes `/activity?date=invalid_preset`
- **THEN** the app loads Activity Log with default `date=today`
- **AND** no toast is shown
- **AND** the URL is rewritten to remove the invalid `date` param

#### Scenario: Studio with missing company falls back to Office
- **WHEN** the user pastes `/studio?company=co_deleted`
- **THEN** the studio overlay does NOT open
- **AND** Office workspace loads
- **AND** an info-level toast reads `Couldn't open the link — company not found.`

### Requirement: Tauri webview SHALL load deep-link paths via SPA fallback

The Tauri release `.app` SHALL serve `index.html` for any pathname
that does not match a real bundled asset. The webview SHALL
successfully load `tauri://localhost/personnel/maya?tab=appearance`
and the rendered app SHALL parse that URL via `parseInitialUrl`.

The Tauri shell deep-link channel (`useDeepLinkInstall` listening
for `'deep-link-install'` events from `offisim://install?...` URLs)
SHALL remain unchanged — install is an async event, not a navigation.
The new URL routing system and the existing install deep-link channel
SHALL be independent.

#### Scenario: Tauri loads a non-root path
- **WHEN** the user (or a `tauri://localhost/personnel/<id>` deep link) targets a non-`/` path inside the Tauri webview
- **THEN** the webview loads `index.html`
- **AND** the React app parses the URL and renders the corresponding workspace

#### Scenario: Tauri reload preserves URL
- **WHEN** the user has navigated to `/sops/sop_abc?step=step_42` inside the Tauri webview
- **AND** triggers webview reload (`Cmd+R` from dev menu, or runtime reload)
- **THEN** after reload the URL bar still reads the same path + query
- **AND** the rendered app state matches

#### Scenario: offisim install deep link does not collide with URL routing
- **WHEN** the OS triggers `offisim://install?listing_id=foo&version=1.0`
- **THEN** `useDeepLinkInstall` fires its install handler
- **AND** the handler runs the install flow without altering `window.location`
- **AND** the user's current URL state is preserved

### Requirement: useUrlSync SHALL be the only writer of history.{push,replace}State

`apps/web/src/lib/url-routing/useUrlSync.ts` SHALL be the sole
component that calls `history.pushState` and `history.replaceState`
during normal navigation. `useWorkspaceBackNavigation` SHALL no
longer push entries on mount. Cross-surface helpers
(`createRouteToPersonnel` and siblings) MAY directly call
`history.pushState` AS PART of a single navigation step that
immediately calls `applyParsedUrl`, but they SHALL NOT push entries
that `useUrlSync` is not aware of.

#### Scenario: No stray pushState
- **WHEN** grepping `apps/web/src` for `pushState\|replaceState`
- **THEN** matches occur only in `apps/web/src/lib/url-routing/` and `apps/web/src/lib/personnel-routing.ts`
- **AND** no occurrence exists in `useWorkspaceBackNavigation.ts`, `useWorkspaceSessionState.ts`, or workspace page components

#### Scenario: Existing useDeepLinkInstall is unchanged
- **WHEN** grepping for `pushState` or `replaceState` in `packages/ui-office/src/hooks/useDeepLinkInstall.ts`
- **THEN** zero matches exist — install events do not write URLs

### Requirement: URL writes SHALL skip during popstate-driven re-applies

`useUrlSync` SHALL set an internal `isApplyingPopstate` ref to true before invoking `applyParsed` (to break the loop `popstate → setState → useUrlSync → pushState`), then clear the ref via a microtask. While the ref is true, the URL writer SHALL skip all push/replace calls for the current render cycle.

#### Scenario: popstate handler does not append history entries
- **WHEN** popstate fires and the resulting `applyParsed` causes one or more state mutations that flow through `useUrlSync`
- **THEN** `window.history.length` is unchanged after the popstate handling completes
- **AND** the URL bar matches the URL that triggered popstate

### Requirement: Free-text query parameters SHALL be URL-encoded with bounded length

The serializer SHALL `encodeURIComponent` free-text values (`q`,
`actor`, search strings) and the parser SHALL `decodeURIComponent`
them. Empty-string params SHALL be omitted from the serialized URL.
Inputs longer than 1024 characters per param SHALL be truncated
with a `console.warn`; this is a defensive guard against malformed
or malicious deep links and is not user-facing.

#### Scenario: Special characters round-trip
- **WHEN** the user types the search term `maya & alex's task` into Activity Log search
- **THEN** the URL is `/activity?q=maya%20%26%20alex%27s%20task`
- **AND** parsing that URL recovers the original string `maya & alex's task`

#### Scenario: Empty value omitted
- **WHEN** the user clears the search input on Personnel (search becomes empty)
- **THEN** the URL has no `q=` param at all (not `q=`)

#### Scenario: Oversized input truncated with warning
- **WHEN** an external deep link contains `q=<10kb_string>`
- **THEN** the parser truncates `q` to 1024 chars and emits a `console.warn`
- **AND** the resulting state holds only the truncated 1024-char value

### Requirement: Company-select gate SHALL queue deep links for replay

The App shell SHALL hold the parsed initial URL in a `pendingDeepLinkRef` when `activeCompanyId === null` and the URL targets a non-Office workspace OR a primary entity. The `company-select` overlay shows first. Once `activeCompanyId` becomes non-null AND the user has selected the company that satisfies the deep link's context (or any company if no specific company is required), the stored URL SHALL be replayed via `applyParsed` and the ref cleared.

If the user navigates back during the gate (browser back), the ref
SHALL be cleared and the deep link SHALL NOT replay.

#### Scenario: Deep link queued and replayed after company select
- **WHEN** the user opens `/personnel/maya?tab=memory` in a fresh window with no `activeCompanyId`
- **THEN** the company-select overlay shows
- **AND** the parsed URL is held in `pendingDeepLinkRef`
- **WHEN** the user selects a company
- **THEN** the overlay closes, Personnel workspace opens with Maya selected on Memory tab
- **AND** `pendingDeepLinkRef` is cleared

#### Scenario: Browser back during gate clears the queue
- **WHEN** the user opens `/sops/sop_42` in a fresh window with no `activeCompanyId`
- **AND** the company-select overlay shows
- **AND** the user presses browser back
- **THEN** `pendingDeepLinkRef` is cleared
- **AND** if the user then selects a company, the app loads default Office, NOT the queued SOPs URL

