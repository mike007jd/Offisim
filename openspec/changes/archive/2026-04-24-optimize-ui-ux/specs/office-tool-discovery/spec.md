## ADDED Requirements

### Requirement: Office tools are visible and distinct from peer workspaces
The Header SHALL distinguish peer workspace navigation from Office-scoped tools. Peer workspaces are Office, SOPs, Market, Activity, and Settings. Office-scoped tools include Studio, Dashboard, Kanban, and Add Employee.

#### Scenario: Office header shows workspace and tool groups
- **WHEN** `activeWorkspace` is `'office'`
- **THEN** Header shows peer workspace navigation
- **AND** Header shows visible Office tool entries for Studio, Dashboard, Kanban, and Add Employee

#### Scenario: Non-office header keeps workspace navigation focused
- **WHEN** `activeWorkspace` is not `'office'`
- **THEN** Header shows peer workspace navigation and current workspace context
- **AND** Office-scoped tools are hidden or grouped behind a clear return-to-Office affordance

### Requirement: Dashboard and Kanban have visible entry points
Dashboard and Kanban SHALL be openable through visible Office tool controls in addition to keyboard shortcuts. The controls SHALL expose selected/open state and close state consistently with the overlay content.

#### Scenario: Dashboard opens from visible control
- **WHEN** the user activates the visible Dashboard tool entry in Office
- **THEN** the Boss Dashboard overlay opens
- **AND** the Dashboard tool entry reflects that Dashboard is active or open

#### Scenario: Kanban opens from visible control
- **WHEN** the user activates the visible Kanban tool entry in Office
- **THEN** the Kanban overlay opens
- **AND** the user does not need to know `Cmd/Ctrl+J`

### Requirement: Office right panel prioritizes task input
The Office right panel SHALL prioritize the current task input and task context. First-run guidance SHALL appear inline in a panel or content region and SHALL NOT float over the task input, right panel controls, or central scene.

#### Scenario: First-run guidance does not cover task controls
- **WHEN** a first-run guide is displayed in Office
- **THEN** the Chat/Tasks input and primary task controls remain fully visible and clickable

#### Scenario: Right panel hierarchy remains clear
- **WHEN** the right panel contains Chat, Tasks, or employee context
- **THEN** the active mode, input field, and primary action are visually higher priority than instructional or secondary metadata

### Requirement: 2D and 3D scene controls remain inspectable
The Office 2D/3D scene region SHALL remain inspectable when panels, labels, employee inspector, or guidance are present. Employee-related accessible names SHALL distinguish scene nodes from list cards when both are visible.

#### Scenario: Scene is not obscured by guidance
- **WHEN** Office 3D or 2D view is active with first-run guidance visible
- **THEN** guidance does not cover the central scene's primary interaction area or scene view toggle

#### Scenario: Employee controls have distinct accessible names
- **WHEN** the same employee appears in the left rail and as a 2D scene node
- **THEN** the accessible names distinguish the employee card from the scene node target

### Requirement: Employee details have clear ownership
Employee Inspector SHALL either anchor near the selected employee or render as a right-side detail drawer. It SHALL NOT float ambiguously between the left rail and central scene without a clear visual relationship to the selected employee.

#### Scenario: Inspector follows selected employee context
- **WHEN** the user selects an employee from the scene or rail
- **THEN** the inspector or detail drawer identifies the selected employee and its source context
- **AND** closing the inspector returns the Office view to the previous task context without changing workspace
