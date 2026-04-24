## ADDED Requirements

### Requirement: Header separates peer workspaces from Office tools
Header SHALL render peer workspace navigation separately from Office-scoped tools while continuing to use the single `AppLayout` shell for all workspaces. Peer workspace controls SHALL change `activeWorkspace`; Office tool controls SHALL open Office overlays or Office-scoped UI without becoming peer workspace routes.

#### Scenario: Office header groups navigation by scope
- **WHEN** `activeWorkspace` is `'office'`
- **THEN** Header renders peer workspace navigation for Office, SOPs, Market, Activity, and Settings
- **AND** Header renders Office tool controls for Studio, Dashboard, Kanban, and Add Employee in a distinct group

#### Scenario: Non-office header does not expose ambiguous Office tools
- **WHEN** `activeWorkspace` is `'sops'`, `'market'`, `'activity-log'`, or `'settings'`
- **THEN** Header keeps peer workspace navigation visible
- **AND** Office-scoped tool controls are hidden, disabled with a return-to-Office explanation, or grouped behind a clear Office affordance

### Requirement: Constrained Header preserves primary navigation
At constrained widths, Header SHALL preserve access to peer workspace navigation and active workspace identity before exposing secondary Office tools. Office tools MAY collapse into a menu or overflow control.

#### Scenario: Narrow Header keeps workspace identity
- **WHEN** Header renders at `390px` viewport width
- **THEN** the active workspace identity remains visible
- **AND** peer workspace navigation or its menu remains reachable
- **AND** Office tools do not force horizontal document overflow
