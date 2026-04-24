## ADDED Requirements

### Requirement: Workspace states provide actionable next steps
Empty, error, and default states in touched workspaces SHALL include a concise title, reason or context, one primary next action, and optional secondary action. These states SHALL avoid bare technical errors as the only user-facing explanation.

#### Scenario: Empty state has primary action
- **WHEN** SOP, Activity, Studio Properties, or another touched workspace has no content selected or no records
- **THEN** the state includes a primary action that starts the next likely workflow

#### Scenario: Error state explains recovery
- **WHEN** a touched workspace cannot load its data or dependency
- **THEN** the state explains the dependency or failure at user level and offers retry or a safe alternate path

### Requirement: SOP default state starts a clear workflow
The SOP workspace default state SHALL guide the user to select a template, create a SOP, or import a SOP before exposing commands that require a selected SOP or runnable graph.

#### Scenario: SOP opens with no selection
- **WHEN** the user opens SOPs without an active SOP
- **THEN** the central state presents template, create, and import actions
- **AND** run actions that require a SOP are hidden, disabled with reason, or visually secondary

### Requirement: Market unavailable state is recoverable
When Market platform data is unavailable, the Market workspace SHALL show a recoverable error state that explains the platform/API dependency and preserves a low-priority view of available filters or cached/offline content if present.

#### Scenario: Market fetch fails
- **WHEN** Market fails to fetch platform data
- **THEN** the user sees a user-level unavailable message, retry action, and any available offline or cached context
- **AND** raw `Failed to fetch` text is not the only explanation

### Requirement: Activity empty state explains event coverage
The Activity workspace empty state SHALL explain what event families can appear and SHALL provide filter-reset or return-to-Office guidance when no entries match.

#### Scenario: Activity has no events
- **WHEN** Activity Log contains no entries
- **THEN** the empty state describes the kinds of workspace/runtime activity that will appear
- **AND** provides a route back to Office or a filter reset when applicable

### Requirement: Settings save area communicates state
Settings SHALL constrain form width for readability, keep save actions within the content flow or a non-obscuring sticky region, and explain why Save is disabled.

#### Scenario: Save disabled reason is visible
- **WHEN** Settings Save is disabled because there are no changes, invalid input, or a save/reinit is in progress
- **THEN** the save area displays the reason in user-facing language

#### Scenario: Settings form width is readable
- **WHEN** Settings renders on desktop width
- **THEN** the active tab content uses a readable maximum width rather than stretching every control across the full workspace

### Requirement: Studio and employee creation states reduce ambiguity
Studio SHALL provide a clear Properties empty state and current-tool context. Employee Creator SHALL group form sections by task, keep action buttons visible, and avoid fixed actions obscuring content.

#### Scenario: Studio has no selected object
- **WHEN** Studio Properties has no selected object
- **THEN** the panel explains how to select an object or start editing
- **AND** the current tool or mode remains visible

#### Scenario: Employee Creator bottom actions remain usable
- **WHEN** Employee Creator is open at desktop or narrow width
- **THEN** Deploy/Cancel actions remain available
- **AND** no field, validation message, or section heading is hidden behind the bottom action area
