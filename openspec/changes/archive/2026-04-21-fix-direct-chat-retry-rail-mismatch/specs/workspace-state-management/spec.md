## MODIFIED Requirements

### Requirement: Office session state is managed through WorkspaceSessionState
All Office workspace UI state (`viewMode`, `selectedEmployeeId`, `studioMode`, `dashboardOpen`, `kanbanOpen`, `marketplaceListingId`, `leftPanelWidth`, `rightPanelWidth`) SHALL be stored in the `OfficeSessionState` slice of `WorkspaceSessionState` and updated exclusively via `updateWorkspaceState('office', updater)`. For direct chat, `selectedEmployeeId` SHALL be the only UI-state input used when composing a NEW run. Once a message has been sent, that run's resolved target employee SHALL be treated as run-local state for streaming / interaction / retry purposes; later `selectedEmployeeId` changes SHALL affect only future runs and MUST NOT retarget an in-flight or pending direct-chat run. The same rule SHALL apply to the run's conversation rail identity: switching `selectedEmployeeId` after a run fails may change which rail the user is currently viewing, but it MUST NOT re-key the failed run's retry rail or move that retry's committed output onto the newly selected employee.

#### Scenario: Reading office state
- **WHEN** any component needs to read Office UI state (e.g. whether dashboard is open)
- **THEN** it SHALL read from `workspaceSessionState.office.dashboardOpen`, not from an independent `useState` variable

#### Scenario: Writing office state
- **WHEN** any component needs to toggle the dashboard overlay
- **THEN** it SHALL call `updateWorkspaceState('office', prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen }))`, not a standalone `setDashboardOpen()` setter

#### Scenario: Office state persists across workspace switches
- **WHEN** user navigates from Office to Settings and back to Office
- **THEN** Office state (`viewMode`, `selectedEmployeeId`, panel widths) SHALL be preserved, except overlays (`dashboardOpen`, `kanbanOpen`, `marketplaceListingId`) which SHALL be closed on leave

#### Scenario: Direct-chat send captures the current selected employee
- **WHEN** `workspaceSessionState.office.selectedEmployeeId === 'maya'` and the user sends a new direct-chat message
- **THEN** that run SHALL be created with `maya` as its target employee
- **AND** the UI SHALL NOT re-resolve the run target from any other ref after the send begins

#### Scenario: Switching selected employee does not retarget an in-flight run
- **WHEN** a direct-chat run was sent while `selectedEmployeeId === 'maya'`, and before the run finishes the user switches the UI selection to `alex`
- **THEN** the already-started run, its pending interaction, and any retry derived from that failed run SHALL remain targeted at `maya`
- **AND** only the next newly-sent message MAY target `alex`

#### Scenario: Switching selected employee does not re-key a failed run retry rail
- **WHEN** a direct-chat run failed while `selectedEmployeeId === 'maya'`, the user then switches `selectedEmployeeId` to `alex`, and later invokes retry on the failed run
- **THEN** the failed run's retry SHALL still use Maya's conversation rail identity
- **AND** Alex becoming the current UI selection SHALL affect only what the user is looking at, not where the retry output is stored or committed
