## ADDED Requirements

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
