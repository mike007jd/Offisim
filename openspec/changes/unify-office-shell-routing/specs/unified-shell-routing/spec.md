## ADDED Requirements

### Requirement: Single shell render path
App.tsx SHALL render exactly one AppLayout instance for all workspaces. There SHALL NOT be conditional branching between different shell components based on active workspace.

#### Scenario: Office workspace active
- **WHEN** `activeWorkspace` is `'office'` and no overlay is open
- **THEN** AppLayout renders with all Office slots populated (agentPanel, sceneCanvas, chatDrawer, eventLog, statusBar) and centerContent is null

#### Scenario: Non-office workspace active
- **WHEN** `activeWorkspace` is `'sops'` / `'market'` / `'activity-log'` / `'settings'`
- **THEN** AppLayout renders with centerContent populated by WorkspaceRouter output, and agentPanel / sceneCanvas / chatDrawer / eventLog are null

### Requirement: Header adapts to active workspace
The Header component SHALL conditionally render UI elements based on `activeWorkspace`.

#### Scenario: Office mode header
- **WHEN** `activeWorkspace` is `'office'`
- **THEN** Header displays 2D/3D toggle, company chip with editor button, project selector slot, notification slot, and full workspace navigation

#### Scenario: Non-office mode header
- **WHEN** `activeWorkspace` is not `'office'`
- **THEN** Header displays a back-to-office button, current workspace title, workspace navigation buttons, and settings button. 2D/3D toggle, company chip, and project selector are hidden.

### Requirement: FullPageWorkspaceShell and WorkspacePageHeader removed
The codebase SHALL NOT contain `FullPageWorkspaceShell` or `WorkspacePageHeader` components after this change.

#### Scenario: No dead shell components
- **WHEN** searching the codebase for `FullPageWorkspaceShell` or `WorkspacePageHeader`
- **THEN** zero references exist (excluding git history and openspec artifacts)

### Requirement: WorkspaceRouter serves as AppLayout centerContent
WorkspaceRouter output SHALL be passed as AppLayout's `centerContent` prop when a non-office workspace is active.

#### Scenario: WorkspaceRouter replaces FullPageWorkspaceShell wrapper
- **WHEN** user navigates from Office to SOPs
- **THEN** WorkspaceRouter renders SopViewSurface directly inside AppLayout's center area, without any intermediate shell wrapper

### Requirement: AppLayout tolerates null slots
AppLayout SHALL render correctly when agentPanel, chatDrawer, eventLog, or sceneCanvas are null, collapsing those regions without visual artifacts.

#### Scenario: All side panels null
- **WHEN** AppLayout receives null for agentPanel, chatDrawer, eventLog, and sceneCanvas
- **THEN** centerContent fills the full available area, no empty panel gutters or collapse handles are visible

### Requirement: StatusBar visible across all workspaces
StatusBar SHALL render in AppLayout regardless of active workspace, displaying model name and active project status.

#### Scenario: StatusBar in non-office workspace
- **WHEN** `activeWorkspace` is `'settings'`
- **THEN** StatusBar is visible at the bottom showing provider model name
