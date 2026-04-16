## ADDED Requirements

### Requirement: Office session state is managed through WorkspaceSessionState

All Office workspace UI state (viewMode, selectedEmployeeId, studioMode, dashboardOpen, kanbanOpen, marketplaceListingId, leftPanelWidth, rightPanelWidth) SHALL be stored in the `OfficeSessionState` slice of `WorkspaceSessionState` and updated exclusively via `updateWorkspaceState('office', updater)`.

#### Scenario: Reading office state

- **WHEN** any component needs to read Office UI state (e.g. whether dashboard is open)
- **THEN** it SHALL read from `workspaceSessionState.office.dashboardOpen`, not from an independent `useState` variable

#### Scenario: Writing office state

- **WHEN** any component needs to toggle the dashboard overlay
- **THEN** it SHALL call `updateWorkspaceState('office', prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen }))`, not a standalone `setDashboardOpen()` setter

#### Scenario: Office state persists across workspace switches

- **WHEN** user navigates from Office to Settings and back to Office
- **THEN** Office state (viewMode, selectedEmployeeId, panel widths) SHALL be preserved, except overlays (dashboardOpen, kanbanOpen, marketplaceListingId) which SHALL be closed on leave

### Requirement: Workspace identity uses a single state source

The active workspace SHALL be identified solely by `activeWorkspace: WorkspaceKey` from `useWorkspaceSessionState()`. The legacy `view: AppView` variable SHALL NOT exist as independent state.

#### Scenario: Workspace switching

- **WHEN** user clicks a workspace nav button (e.g. SOPs)
- **THEN** only `setActiveWorkspace('sops')` SHALL be called; there SHALL be no parallel `setView('sops')` call

#### Scenario: No sync effects between view and activeWorkspace

- **WHEN** the app renders
- **THEN** there SHALL be zero `useEffect` hooks synchronizing `view` with `activeWorkspace`

### Requirement: Full-page overlays are separate from workspace identity

Full-page overlays (employee-creator, office-editor, company-select, studio) SHALL be managed by a separate `activeOverlay: OverlayKey | null` state, orthogonal to `activeWorkspace`.

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

When the user navigates away from Office workspace, transient overlay state (dashboardOpen, kanbanOpen, marketplaceListingId) SHALL be reset to closed/null. Persistent state (viewMode, selectedEmployeeId, leftPanelWidth, rightPanelWidth) SHALL be preserved.

#### Scenario: Leaving office with dashboard open

- **WHEN** user switches from Office to Market while dashboard is open
- **THEN** `dashboardOpen` SHALL become `false` in `OfficeSessionState`
- **THEN** `viewMode` SHALL remain unchanged

#### Scenario: studioMode cleanup on leave

- **WHEN** user switches away from Office while `studioMode` is not null
- **THEN** `studioMode` SHALL become `null` (existing behavior, preserved)
