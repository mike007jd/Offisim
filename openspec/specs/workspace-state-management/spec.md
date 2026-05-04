# workspace-state-management

## Purpose

All Office workspace UI state — view mode, selected employee, studio mode, overlay toggles (dashboard / kanban / marketplace detail), panel widths — is stored in one `OfficeSessionState` slice of `WorkspaceSessionState`, written exclusively through `updateWorkspaceState('office', updater)`. There is no parallel `useState` / `setView` / per-overlay setter. `activeWorkspace`, `activeOverlay`, and Office state are orthogonal.
## Requirements
### Requirement: Office session state is managed through WorkspaceSessionState

All Office workspace UI state (`viewMode`, `selectedEmployeeId`, `selectedThreadId`, `studioMode`, `dashboardOpen`, `kanbanOpen`, `marketplaceListingId`, `leftPanelWidth`, `rightPanelWidth`) SHALL be stored in the `OfficeSessionState` slice of `WorkspaceSessionState` and updated exclusively via `updateWorkspaceState('office', updater)`. `selectedThreadId` SHALL identify the currently active `chat_threads` row within the active project; it SHALL be `null` only when no project is bound or the bootstrap has not yet ensured a default thread.

For direct chat, `selectedEmployeeId` SHALL be the only UI-state input used when composing a NEW run. Once a message has been sent, that run's resolved target employee SHALL be treated as run-local state for streaming / interaction / retry purposes; later `selectedEmployeeId` changes SHALL affect only future runs and MUST NOT retarget an in-flight or pending direct-chat run. The same rule SHALL apply to the run's conversation rail identity: switching `selectedEmployeeId` after a run fails may change which rail the user is currently viewing, but it MUST NOT re-key the failed run's retry rail or move that retry's committed output onto the newly selected employee. The same rule SHALL extend to `selectedThreadId`: switching the active thread SHALL NOT retarget any in-flight or failed-run-retry's resolved thread.

#### Scenario: Reading office state

- **WHEN** any component needs to read Office UI state (e.g. whether dashboard is open, or which thread is active)
- **THEN** it SHALL read from `workspaceSessionState.office.dashboardOpen` / `workspaceSessionState.office.selectedThreadId`, not from an independent `useState` variable

#### Scenario: Writing office state

- **WHEN** any component needs to switch the active thread
- **THEN** it SHALL call `updateWorkspaceState('office', prev => ({ ...prev, selectedThreadId: nextId }))`, not a standalone `setSelectedThreadId()` setter

#### Scenario: Office state persists across workspace switches

- **WHEN** user navigates from Office to Settings and back to Office
- **THEN** Office state (`viewMode`, `selectedEmployeeId`, `selectedThreadId`, panel widths) SHALL be preserved, except overlays (`dashboardOpen`, `kanbanOpen`, `marketplaceListingId`) which SHALL be closed on leave

#### Scenario: Direct-chat send captures the current selected employee and thread

- **WHEN** `workspaceSessionState.office.selectedEmployeeId === 'maya'` and `selectedThreadId === 'T1'` and the user sends a new direct-chat message
- **THEN** that run SHALL be created with `maya` as its target employee and `T1` as its thread
- **AND** the UI SHALL NOT re-resolve the run target or run thread from any other ref after the send begins

#### Scenario: Switching selected employee does not retarget an in-flight run

- **WHEN** a direct-chat run was sent while `selectedEmployeeId === 'maya'`, and before the run finishes the user switches the UI selection to `alex`
- **THEN** the already-started run, its pending interaction, and any retry derived from that failed run SHALL remain targeted at `maya`
- **AND** only the next newly-sent message MAY target `alex`

#### Scenario: Switching selected employee does not re-key a failed run retry rail

- **WHEN** a direct-chat run failed while `selectedEmployeeId === 'maya'`, the user then switches `selectedEmployeeId` to `alex`, and later invokes retry on the failed run
- **THEN** the failed run's retry SHALL still use Maya's conversation rail identity
- **AND** Alex becoming the current UI selection SHALL affect only what the user is looking at, not where the retry output is stored or committed

#### Scenario: Switching selectedThreadId does not retarget an in-flight or retry run

- **WHEN** a chat run was started under `selectedThreadId === 'T1'` and the user switches the active thread to `T2` before the run resolves (or before invoking retry on a failed run from T1)
- **THEN** the in-flight run and any retry derived from a T1 failed run SHALL remain bound to T1
- **AND** subsequent newly-sent messages while the thread is `T2` MAY target T2

### Requirement: OfficeSessionState exposes selectedThreadId in defaults and serialization

The `createDefaultSessionState()` factory SHALL return an `office` slice containing `selectedThreadId: null`. URL routing serialization / deserialization (`apps/web/src/lib/url-routing/`) SHALL round-trip `selectedThreadId` so deep links to a specific thread restore correctly. On bootstrap, when `selectedThreadId === null` and the active project has at least one `chat_threads` row, the runtime SHALL set `selectedThreadId` to the project's most-recently-updated thread.

#### Scenario: Default factory includes selectedThreadId

- **WHEN** `createDefaultSessionState()` is called
- **THEN** the returned object SHALL include `office.selectedThreadId === null`

#### Scenario: URL round-trips selectedThreadId

- **WHEN** the URL contains a thread parameter referencing thread `T1`
- **THEN** the parser SHALL set `office.selectedThreadId` to `T1`
- **AND** subsequent `office` updates that change `selectedThreadId` SHALL be reflected in the serialized URL

#### Scenario: Bootstrap selects most-recent thread

- **WHEN** the runtime mounts with `selectedThreadId === null`, an active project bound, and the project has at least one `chat_threads` row
- **THEN** `selectedThreadId` SHALL be set to the project's most-recently-updated thread before the rail renders message content

### Requirement: Workspace identity uses a single state source
The active workspace SHALL be identified solely by `activeWorkspace: WorkspaceKey` from `useWorkspaceSessionState()`. The legacy `view: AppView` variable SHALL NOT exist as independent state.

#### Scenario: Workspace switching
- **WHEN** user clicks a workspace nav button (e.g. SOPs)
- **THEN** only `setActiveWorkspace('sops')` SHALL be called; there SHALL be no parallel `setView('sops')` call

#### Scenario: No sync effects between view and activeWorkspace
- **WHEN** the app renders
- **THEN** there SHALL be zero `useEffect` hooks synchronizing `view` with `activeWorkspace`

### Requirement: Full-page overlays are separate from workspace identity
Full-page overlays (`employee-creator`, `office-editor`, `company-select`, `studio`) SHALL be managed by a separate `activeOverlay: OverlayKey | null` state, orthogonal to `activeWorkspace`.

#### Scenario: Opening an overlay does not change active workspace
- **WHEN** user opens Studio from Office
- **THEN** `activeWorkspace` SHALL remain `'office'` and `activeOverlay` SHALL become `'studio'`

#### Scenario: Closing an overlay reveals the underlying workspace
- **WHEN** user closes the office-editor overlay
- **THEN** `activeOverlay` SHALL become `null` and the Office workspace SHALL be visible without any workspace switch

#### Scenario: App shell visibility
- **WHEN** `activeWorkspace === 'office'` and `activeOverlay` is `null` or `'employee-creator'`
- **THEN** `OfficeWorkspaceShellLazy` SHALL render
- **WHEN** `activeOverlay` is `'company-select'` or `'studio'` or `'office-editor'`
- **THEN** `OfficeWorkspaceShellLazy` SHALL NOT render (overlay takes full screen)

### Requirement: Office Escape unwind integrates with workspace back navigation
Pressing Escape while in the Office workspace SHALL unwind internal drill-in state through `tryWorkspaceInternalBack('office', sessionState)`, using the same mechanism as other workspaces.

#### Scenario: Escape closes dashboard first
- **WHEN** dashboard is open and kanban is closed
- **THEN** Escape SHALL close dashboard and nothing else

#### Scenario: Escape unwind priority
- **WHEN** multiple Office overlays are open (dashboard + kanban + marketplace + selectedEmployee)
- **THEN** Escape SHALL close them in order: dashboard → kanban → marketplace → selectedEmployee (one per keypress)

#### Scenario: Escape with no internal state falls through to workspace back
- **WHEN** no Office overlays are open, no employee is selected
- **THEN** Escape SHALL delegate to `goBack()` which attempts workspace-level back navigation

### Requirement: OfficeWorkspaceShell receives consolidated state
`OfficeWorkspaceShellLazy` SHALL receive an `officeState: OfficeSessionState` prop and an `updateOfficeState` callback, instead of individual props for each state field.

#### Scenario: Props reduction
- **WHEN** OfficeWorkspaceShell renders
- **THEN** it SHALL NOT receive individual `dashboardOpen`, `kanbanOpen`, `marketplaceListingId`, `viewMode`, `selectedEmployeeId`, `leftPanelWidth`, `rightPanelWidth` props
- **THEN** it SHALL receive `officeState` containing all these fields

#### Scenario: Overlay close callback
- **WHEN** OfficeWorkspaceShell needs to close the dashboard
- **THEN** it SHALL call `updateOfficeState(prev => ({ ...prev, dashboardOpen: false }))` instead of receiving an `onCloseDashboard` prop

### Requirement: Keyboard shortcuts route through workspace state
Keyboard shortcuts that modify Office state (Cmd+D for dashboard, Cmd+J for kanban, Cmd+1 for viewMode toggle) SHALL update state via `updateWorkspaceState('office', updater)` and SHALL only fire when `activeWorkspace === 'office'`.

#### Scenario: Cmd+D in office
- **WHEN** user presses Cmd+D while `activeWorkspace === 'office'`
- **THEN** `dashboardOpen` SHALL toggle via `updateWorkspaceState('office', prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen }))`

#### Scenario: Cmd+D outside office
- **WHEN** user presses Cmd+D while `activeWorkspace === 'settings'`
- **THEN** the shortcut SHALL be ignored (no state change)

### Requirement: Office leave cleanup closes transient overlays
When the user navigates away from Office workspace, transient overlay state (`dashboardOpen`, `kanbanOpen`, `marketplaceListingId`) SHALL be reset to closed/null. Persistent state (`viewMode`, `selectedEmployeeId`, `leftPanelWidth`, `rightPanelWidth`) SHALL be preserved.

#### Scenario: Leaving office with dashboard open
- **WHEN** user switches from Office to Market while dashboard is open
- **THEN** `dashboardOpen` SHALL become `false` in `OfficeSessionState`
- **THEN** `viewMode` SHALL remain unchanged

#### Scenario: studioMode cleanup on leave
- **WHEN** user switches away from Office while `studioMode` is not null
- **THEN** `studioMode` SHALL become `null` (existing behavior, preserved)

### Requirement: Visible Office tools update existing Office session state
Visible Office tool controls for Dashboard and Kanban SHALL update the existing `OfficeSessionState` through `updateWorkspaceState('office', updater)`. They SHALL NOT introduce independent `useState` variables or alternate overlay state owners for those surfaces.

#### Scenario: Dashboard visible control uses workspace state
- **WHEN** the user activates the visible Dashboard tool control
- **THEN** `workspaceSessionState.office.dashboardOpen` toggles through `updateWorkspaceState('office', updater)`
- **AND** no standalone `setDashboardOpen` state owner is introduced

#### Scenario: Kanban visible control uses workspace state
- **WHEN** the user activates the visible Kanban tool control
- **THEN** `workspaceSessionState.office.kanbanOpen` toggles through `updateWorkspaceState('office', updater)`
- **AND** no standalone `setKanbanOpen` state owner is introduced

### Requirement: Visible tool controls and shortcuts share behavior
Office tool controls and keyboard shortcuts SHALL call the same action layer or equivalent state update path so Dashboard/Kanban open, close, Escape cleanup, and Office-leave cleanup remain consistent.

#### Scenario: Dashboard control and shortcut produce same state
- **WHEN** the user opens Dashboard via the visible control
- **AND** later toggles Dashboard via `Cmd/Ctrl+D`
- **THEN** both interactions mutate the same `office.dashboardOpen` state and the overlay reflects the latest value

#### Scenario: Office leave cleanup still closes visible-tool overlays
- **WHEN** Dashboard or Kanban was opened from a visible Office tool control
- **AND** the user navigates to Market or Settings
- **THEN** the existing Office leave cleanup closes Dashboard/Kanban while preserving persistent Office state

### Requirement: Dialog-active state blocks Office state shortcuts
When a topmost modal dialog or full-screen overlay owns keyboard input, Office shortcuts that mutate `OfficeSessionState` SHALL be ignored unless that surface explicitly delegates the shortcut.

#### Scenario: Modal blocks Kanban shortcut
- **WHEN** Employee Creator, Company Editor, or a wizard dialog is open
- **AND** the user presses `Cmd/Ctrl+J`
- **THEN** `office.kanbanOpen` does not change behind the topmost surface



### Requirement: Personnel session state is managed through WorkspaceSessionState
All Personnel workspace UI state (`selectedEmployeeId`, `activeEmployeeTab`) SHALL be stored in the `PersonnelSessionState` slice of `WorkspaceSessionState` and updated exclusively via `updateWorkspaceState('personnel', updater)`. Personnel SHALL be wired into `SESSION_KEY` and `SessionStateKeyMap` such that `WorkspaceKey === 'personnel'` maps to the `personnel` slice.

#### Scenario: Reading personnel state
- **WHEN** any component needs to read which employee is selected in Personnel
- **THEN** it SHALL read from `workspaceSessionState.personnel.selectedEmployeeId`
- **AND** SHALL NOT use a local `useState` variable as the source of truth

#### Scenario: Writing personnel state
- **WHEN** any component needs to change the active Personnel tab
- **THEN** it SHALL call `updateWorkspaceState('personnel', prev => ({ ...prev, activeEmployeeTab: nextTab }))`

#### Scenario: Default factory provides personnel slice
- **WHEN** `createDefaultSessionState()` is called
- **THEN** the returned object SHALL include a `personnel` field equal to `{ selectedEmployeeId: null, activeEmployeeTab: 'profile' }`

### Requirement: tryWorkspaceInternalBack handles personnel
`tryWorkspaceInternalBack('personnel', sessionState)` SHALL unwind in this order: tab → selection. If `activeEmployeeTab` is not `'profile'`, it SHALL be reset to `'profile'`. Otherwise if `selectedEmployeeId` is non-null, it SHALL be cleared. Otherwise the function SHALL return `[false, sessionState]`.

#### Scenario: Tab unwinds first
- **WHEN** `state.personnel.activeEmployeeTab === 'memory'` and `state.personnel.selectedEmployeeId === 'alex'`
- **THEN** `tryWorkspaceInternalBack('personnel', state)` SHALL return `[true, next]` where `next.personnel.activeEmployeeTab === 'profile'` and `next.personnel.selectedEmployeeId === 'alex'`

#### Scenario: Selection clears after tab is profile
- **WHEN** `state.personnel.activeEmployeeTab === 'profile'` and `state.personnel.selectedEmployeeId === 'alex'`
- **THEN** `tryWorkspaceInternalBack('personnel', state)` SHALL return `[true, next]` where `next.personnel.selectedEmployeeId === null`

#### Scenario: No personnel drill-in falls through
- **WHEN** `state.personnel.selectedEmployeeId === null` and `state.personnel.activeEmployeeTab === 'profile'`
- **THEN** `tryWorkspaceInternalBack('personnel', state)` SHALL return `[false, state]` so the workspace history stack pops

### Requirement: Cross-surface edit routes through workspace state
"Edit employee" affordances on any surface SHALL route the user into Personnel by writing through `setActiveWorkspace('personnel')` and `updateWorkspaceState('personnel', updater)`. They SHALL NOT open `EmployeeEditorDialog` or any modal substitute.

#### Scenario: Office shortcut for selected employee writes personnel state
- **WHEN** `activeWorkspace === 'office'`, `office.selectedEmployeeId === 'alex'`, and the edit-employee shortcut fires
- **THEN** `setActiveWorkspace('personnel')` SHALL run
- **AND** `updateWorkspaceState('personnel', prev => ({ ...prev, selectedEmployeeId: 'alex', activeEmployeeTab: 'profile' }))` SHALL run
- **AND** no `useEmployeeEditor.openForEdit` call SHALL fire from the shortcut

#### Scenario: Settings external row edit writes personnel state
- **WHEN** the user clicks Edit on a Settings → External Employees row
- **THEN** the same two writes SHALL run
- **AND** no dialog SHALL open
