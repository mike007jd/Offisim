## ADDED Requirements

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
