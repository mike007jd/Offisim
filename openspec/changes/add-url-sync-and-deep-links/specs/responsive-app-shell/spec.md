## ADDED Requirements

### Requirement: App shell SHALL initialize workspace state from URL on first paint

`apps/web/src/App.tsx` SHALL parse `window.location` exactly once on
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

The hook SHALL remain importable from `apps/web/src/components/workspaces/`
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

`apps/web/src/lib/personnel-routing.ts` `createRouteToPersonnel` SHALL
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
