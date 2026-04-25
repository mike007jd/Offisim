## MODIFIED Requirements

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
