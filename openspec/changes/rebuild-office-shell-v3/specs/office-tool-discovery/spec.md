## ADDED Requirements

### Requirement: Board and Live are not scene chrome

The stage SHALL NOT render visible Board or Live entries as floating scene chrome. The Boss Dashboard entry SHALL NOT exist anywhere in the shell chrome (single-run cost lives in the diegetic run flow; a cross-project ledger is deferred). Kanban data/CAS and keyboard access MAY remain, but Board and Live SHALL NOT be exposed as top-centered scene tabs or popovers.

#### Scenario: No Board or Live scene tabs

- **WHEN** auditing the Office scene
- **THEN** there is no Board tab, Live tab, run-axis control, or Live popover floating over the canvas

#### Scenario: No Boss Dashboard entry exists

- **WHEN** auditing Office tool entries
- **THEN** there is no Boss Dashboard tool entry in the header or elsewhere in the shell chrome

## MODIFIED Requirements

### Requirement: Office tools are visible and distinct from peer workspaces
The Header SHALL distinguish peer workspace navigation from Office-scoped tools. Peer workspaces are Office, SOPs, Market, Personnel, Activity, and Settings — reached through the centered peer-nav pills plus the Activity + Settings iconbar entries. After the V3 shell change the only header-resident Office-scoped tool is Studio (rendered in the iconbar after a 1px divider, only when the active workspace is Office). Board (kanban) and Live (run broadcast) are NOT header tools and are NOT scene floating tabs. The Boss Dashboard entry SHALL NOT exist. Employee creation ("Add") is reached from the stage Team dock, not the header. There SHALL be no notification bell in the header.

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

The Header SHALL render the active peer workspace as the only "selected chip" style indicator. Office-scoped tools that expose an active state SHALL use a visually weaker indicator than peer workspace selection. After the V3 shell correction the only header-resident Office tool is Studio (Activity + Settings live in the iconbar); Board + Live SHALL NOT live on a stage run-axis. The Personnel peer SHALL share the same chip style as the other peers when active.

#### Scenario: Peer workspace selected uses chip style

- **WHEN** a peer workspace is the active workspace in Office
- **THEN** its nav pill renders with the filled chip style (accent-surface + inset accent-ring) and `aria-current="page"`
- **AND** no Office-scoped tool (Studio) renders the same filled chip style at the same time

#### Scenario: Studio active uses subordinate indicator

- **WHEN** Studio is open
- **THEN** its entry uses an icon tint + non-chip indicator (not a filled chip), with `aria-pressed="true"`

## REMOVED Requirements

### Requirement: Dashboard and Kanban have visible entry points

**Reason**: The Boss Dashboard entry is removed in the V3 shell (V3 design DNA §2), and user screenshot review rejected the stage run-axis Board/Live treatment as old floating chrome. The "Dashboard + Kanban header entry points" framing no longer holds, so this requirement is replaced by the new `Board and Live are not scene chrome` requirement (ADDED).

**Migration**: Kanban remains backed by the unchanged kanban data/CAS pipeline; the ⌘J keyboard shortcut is preserved. The Dashboard entry has no replacement (single-run cost is diegetic; cross-project ledger v1-deferred). See ADDED `Board and Live are not scene chrome`.

### Requirement: Dashboard and Kanban panels are mutually exclusive

**Reason**: The Boss Dashboard entry point is removed in the V3 shell (V3 design DNA §2). With no Dashboard panel and no Board/Live stage float, there is no Dashboard/Kanban mutual-exclusion to enforce.

**Migration**: Kanban remains backed by the unchanged kanban data/CAS pipeline; single-run cost is shown in the diegetic `.scene-cost` readout; a cross-project ledger (the former Dashboard's role) is deferred to a future change.
