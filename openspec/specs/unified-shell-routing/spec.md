# unified-shell-routing

## Purpose

All five peer-level workspaces (Office, SOPs, Market, Activity Log, Settings) render through a single `AppLayout` shell. Office populates every slot; non-Office workspaces pass their page body via `centerContent` and leave `agentPanel` / `sceneCanvas` / `chatDrawer` / `eventLog` null. The legacy `FullPageWorkspaceShell` + `WorkspacePageHeader` wrappers are removed; the Header adapts its controls to the active workspace.

## Requirements

### Requirement: Single shell render path
`App.tsx` SHALL render exactly one `AppLayout` instance for all workspaces. There SHALL NOT be conditional branching between different shell components based on the active workspace.

#### Scenario: Office workspace active
- **WHEN** `activeWorkspace` is `'office'` and no overlay is open
- **THEN** `AppLayout` renders with all Office slots populated (`agentPanel`, `sceneCanvas`, `chatDrawer`, `eventLog`, `statusBar`) and `centerContent` is null

#### Scenario: Non-office workspace active
- **WHEN** `activeWorkspace` is `'sops'` / `'market'` / `'activity-log'` / `'settings'`
- **THEN** `AppLayout` renders with `centerContent` populated by `WorkspaceRouter` output, and `agentPanel` / `sceneCanvas` / `chatDrawer` / `eventLog` are null

### Requirement: Header adapts to active workspace
The Header component SHALL conditionally render UI elements based on `activeWorkspace`.

#### Scenario: Office mode header
- **WHEN** `activeWorkspace` is `'office'`
- **THEN** Header displays 2D/3D toggle, company chip with editor button, project selector slot, notification slot, and full workspace navigation

#### Scenario: Non-office mode header
- **WHEN** `activeWorkspace` is not `'office'`
- **THEN** Header displays a back-to-office button, current workspace title, workspace navigation buttons, and settings button. 2D/3D toggle, company chip, and project selector are hidden.

### Requirement: FullPageWorkspaceShell and WorkspacePageHeader removed
The codebase SHALL NOT contain `FullPageWorkspaceShell` or `WorkspacePageHeader` components.

#### Scenario: No dead shell components
- **WHEN** searching the codebase for `FullPageWorkspaceShell` or `WorkspacePageHeader`
- **THEN** zero references exist (excluding git history and openspec artifacts)

### Requirement: WorkspaceRouter serves as AppLayout centerContent
`WorkspaceRouter` output SHALL be passed as `AppLayout`'s `centerContent` prop when a non-office workspace is active.

#### Scenario: WorkspaceRouter replaces FullPageWorkspaceShell wrapper
- **WHEN** user navigates from Office to SOPs
- **THEN** `WorkspaceRouter` renders `SopViewSurface` directly inside `AppLayout`'s center area, without any intermediate shell wrapper

### Requirement: AppLayout tolerates null slots
`AppLayout` SHALL render correctly when `agentPanel`, `chatDrawer`, `eventLog`, or `sceneCanvas` are null, collapsing those regions without visual artifacts.

#### Scenario: All side panels null
- **WHEN** `AppLayout` receives null for `agentPanel`, `chatDrawer`, `eventLog`, and `sceneCanvas`
- **THEN** `centerContent` fills the full available area, no empty panel gutters or collapse handles are visible

### Requirement: StatusBar visible across all workspaces
`StatusBar` SHALL render in `AppLayout` regardless of the active workspace, displaying model name and active project status.

#### Scenario: StatusBar in non-office workspace
- **WHEN** `activeWorkspace` is `'settings'`
- **THEN** `StatusBar` is visible at the bottom showing provider model name

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
