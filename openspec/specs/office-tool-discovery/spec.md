# office-tool-discovery

## Purpose

The Office workspace cleanly distinguishes peer workspace navigation (Office, SOPs, Market, Personnel, Activity, Settings) from Office-scoped tools (Studio, Dashboard, Kanban, Add Employee). Office tools have visible entry points in the Header in addition to keyboard shortcuts, expose their open state, and collapse cleanly outside Office. The Office right panel prioritizes the task input; first-run guidance never floats over task controls or the central scene. Employee Inspector anchors to its selected employee rather than floating ambiguously between rail and scene.

## Requirements

### Requirement: Office tools are visible and distinct from peer workspaces
The Header SHALL distinguish peer workspace navigation from Office-scoped tools. Peer workspaces are Office, SOPs, Market, Personnel, Activity, and Settings. Office-scoped tools include Studio, Dashboard, Kanban, and Add Employee.

#### Scenario: Office header shows workspace and tool groups
- **WHEN** `activeWorkspace` is `'office'`
- **THEN** Header shows peer workspace navigation including Personnel
- **AND** Header shows visible Office tool entries for Studio, Dashboard, Kanban, and Add Employee

#### Scenario: Non-office header keeps workspace navigation focused
- **WHEN** `activeWorkspace` is not `'office'`
- **THEN** Header shows peer workspace navigation (six peers) and current workspace context
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

### Requirement: Header selected state is unique to peer workspace navigation
The Header SHALL render the active peer workspace as the only "selected chip" style indicator. Office-scoped tools that expose an active panel state (Dashboard, Kanban) SHALL use a visually weaker indicator than peer workspace selection so users can distinguish workspace navigation from panel toggles. The Personnel peer SHALL share the same chip style as the other five peers when active.

#### Scenario: Peer workspace selected uses chip style
- **WHEN** a peer workspace is the active workspace in Office
- **THEN** its nav entry SHALL render with a filled chip style (border + background + highlighted text) and `aria-current="page"`
- **AND** no Office-scoped tool entry SHALL render the same filled chip style at the same time

#### Scenario: Personnel peer selected uses chip style
- **WHEN** `activeWorkspace === 'personnel'`
- **THEN** the Personnel nav entry SHALL render with the same filled chip style and `aria-current="page"` used by the other peers
- **AND** the chip style SHALL NOT differ from Office, SOPs, Market, Activity, or Settings selection

#### Scenario: Office tool active uses subordinate indicator
- **WHEN** an Office tool with `isActive=true` (Dashboard or Kanban panel open) is rendered in the Office tool group
- **THEN** the active state SHALL be expressed by an icon tint plus a non-chip indicator (such as an underline or dot), not by a filled chip border + background
- **AND** the tool button SHALL retain `aria-pressed="true"` for assistive technology

#### Scenario: Inactive office tool stays neutral
- **WHEN** an Office tool with `isActive=false` is rendered
- **THEN** the button SHALL render in the neutral icon-only style with no border, background, or active indicator
- **AND** `aria-pressed="false"` SHALL be present

### Requirement: Dashboard and Kanban panels are mutually exclusive
The Office workspace SHALL allow at most one panel-style overlay (Dashboard or Kanban) to be active at a time. Activating one panel while the other is open SHALL close the other. Studio and Add Employee are dialog/overlay entries with different semantics and SHALL NOT participate in this exclusion.

#### Scenario: Opening Kanban while Dashboard is open closes Dashboard
- **WHEN** the Boss Dashboard overlay is currently open in Office
- **AND** the user activates the Kanban tool entry (visible button or keyboard shortcut)
- **THEN** the Kanban overlay SHALL open
- **AND** the Boss Dashboard overlay SHALL close
- **AND** only the Kanban tool entry SHALL show its active indicator

#### Scenario: Opening Dashboard while Kanban is open closes Kanban
- **WHEN** the Kanban overlay is currently open in Office
- **AND** the user activates the Dashboard tool entry (visible button or keyboard shortcut)
- **THEN** the Boss Dashboard overlay SHALL open
- **AND** the Kanban overlay SHALL close
- **AND** only the Dashboard tool entry SHALL show its active indicator

#### Scenario: Studio and Add Employee do not affect panel state
- **WHEN** the Boss Dashboard or Kanban overlay is open
- **AND** the user activates Studio or Add Employee
- **THEN** the open Dashboard or Kanban overlay SHALL remain open
- **AND** Studio / Add Employee SHALL open their own dialog or overlay independently

### Requirement: Office tool overflow popover is viewport-aware
When Office tools exceed the visible threshold, the overflow menu SHALL render through a portal attached to `document.body` so it is not clipped by parent stacking context, and its position SHALL avoid overflowing any viewport edge by collision-aware placement.

#### Scenario: Overflow menu defaults to right-aligned below trigger
- **WHEN** the user activates the Office tool overflow trigger
- **AND** the menu fits to the right and below the trigger inside the viewport
- **THEN** the menu SHALL render right-aligned to the trigger and below it

#### Scenario: Overflow menu flips to left-aligned when right edge would overflow
- **WHEN** the user activates the Office tool overflow trigger
- **AND** rendering right-aligned would place the menu past the viewport's right edge
- **THEN** the menu SHALL flip to left-aligned to the trigger

#### Scenario: Overflow menu flips above when bottom would overflow
- **WHEN** the user activates the Office tool overflow trigger
- **AND** rendering below the trigger would place the menu past the viewport's bottom edge
- **THEN** the menu SHALL flip to render above the trigger

#### Scenario: Overflow menu stays inside viewport on resize or scroll
- **WHEN** the overflow menu is open
- **AND** the viewport is resized or the page scrolls
- **THEN** the menu SHALL remain visible inside the viewport, repositioning if necessary
- **AND** the menu MAY close if it cannot remain anchored to the trigger (for example, if the trigger scrolls out of view)
