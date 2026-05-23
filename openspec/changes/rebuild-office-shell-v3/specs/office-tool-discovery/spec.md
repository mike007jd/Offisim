## ADDED Requirements

### Requirement: Board and Live have visible run-axis entry points

The kanban (Board) and the run broadcast (Live) SHALL be openable through visible entries on the stage run-axis in addition to keyboard shortcuts (this replaces the former header-resident Dashboard + Kanban entry points). The Boss Dashboard entry SHALL NOT exist anywhere in the shell chrome (single-run cost lives in the diegetic run flow; a cross-project ledger is deferred). The Board entry SHALL expose open/active state consistently with the kanban overlay.

#### Scenario: Board opens from the run-axis

- **WHEN** the user activates the Board entry on the stage run-axis
- **THEN** the kanban board opens and the Board entry reflects its open/active state
- **AND** the user does not need to know the keyboard shortcut

#### Scenario: No Boss Dashboard entry exists

- **WHEN** auditing Office tool entries
- **THEN** there is no Boss Dashboard tool entry in the header or elsewhere in the shell chrome

## MODIFIED Requirements

### Requirement: Office tools are visible and distinct from peer workspaces
The Header SHALL distinguish peer workspace navigation from Office-scoped tools. Peer workspaces are Office, SOPs, Market, Personnel, Activity, and Settings — reached through the centered peer-nav pills plus the Activity + Settings iconbar entries. After the V3 shell change the only header-resident Office-scoped tool is Studio (rendered in the iconbar after a 1px divider, only when the active workspace is Office). Board (kanban) and Live (run broadcast) are NOT header tools — they live on the stage run-axis. The Boss Dashboard entry SHALL NOT exist. Employee creation ("Add") is reached from the stage Team dock, not the header. There SHALL be no notification bell in the header.

#### Scenario: Office header shows workspace and tool groups
- **WHEN** `activeWorkspace` is `'office'`
- **THEN** Header shows peer workspace navigation (Office, SOPs, Market, Personnel) plus Activity + Settings iconbar entries
- **AND** the only Office-scoped header tool is Studio (after a 1px divider in the iconbar)
- **AND** Header shows NO Dashboard, Kanban, Add Employee, or notification-bell entry

#### Scenario: Non-office header keeps workspace navigation focused
- **WHEN** `activeWorkspace` is not `'office'`
- **THEN** Header shows peer workspace navigation (six peers, via pills + Activity/Settings iconbar) and current workspace context
- **AND** the Studio entry is hidden (Office-only)

### Requirement: Header selected state is unique to peer workspace navigation

The Header SHALL render the active peer workspace as the only "selected chip" style indicator. Office-scoped tools that expose an active state SHALL use a visually weaker indicator than peer workspace selection. After the V3 shell change the only header-resident Office tool is Studio (Activity + Settings live in the iconbar; Board + Live live on the stage run-axis, not the header). The Personnel peer SHALL share the same chip style as the other peers when active.

#### Scenario: Peer workspace selected uses chip style

- **WHEN** a peer workspace is the active workspace in Office
- **THEN** its nav pill renders with the filled chip style (accent-surface + inset accent-ring) and `aria-current="page"`
- **AND** no Office-scoped tool (Studio) renders the same filled chip style at the same time

#### Scenario: Studio active uses subordinate indicator

- **WHEN** Studio is open
- **THEN** its entry uses an icon tint + non-chip indicator (not a filled chip), with `aria-pressed="true"`

## REMOVED Requirements

### Requirement: Dashboard and Kanban have visible entry points

**Reason**: The Boss Dashboard entry is removed in the V3 shell (V3 design DNA §2) and the Kanban entry moves from the header to the stage run-axis (renamed "Board"). The "Dashboard + Kanban header entry points" framing no longer holds, so this requirement is replaced by the new `Board and Live have visible run-axis entry points` requirement (ADDED).

**Migration**: Board (kanban) is reached via the stage run-axis entry and remains backed by the unchanged kanban data/CAS pipeline; the ⌘J keyboard shortcut is preserved. The Dashboard entry has no replacement (single-run cost is diegetic; cross-project ledger v1-deferred). See ADDED `Board and Live have visible run-axis entry points`.

### Requirement: Dashboard and Kanban panels are mutually exclusive

**Reason**: The Boss Dashboard entry point is removed in the V3 shell (V3 design DNA §2). With no Dashboard panel, there is no Dashboard/Kanban mutual-exclusion to enforce; the kanban (Board) is a persistent stage run-axis float and Live is a separate run-broadcast entry.

**Migration**: Board (kanban) is reached via the stage run-axis and remains backed by the unchanged kanban data/CAS pipeline; single-run cost is shown in the diegetic `.scene-cost` readout; a cross-project ledger (the former Dashboard's role) is deferred to a future change.
