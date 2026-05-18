# unified-shell-routing

## MODIFIED Requirements

### Requirement: Single shell render path

The desktop renderer SHALL render exactly one `AppLayout` instance for all workspaces. There SHALL NOT be conditional branching between different shell components based on the active workspace. This shell lives under the desktop renderer ownership boundary, not under a standalone web app.

#### Scenario: Office workspace active

- **WHEN** `activeWorkspace` is `'office'` and no overlay is open
- **THEN** `AppLayout` renders with all Office slots populated (`agentPanel`, `sceneCanvas`, `chatDrawer`, `eventLog`, `statusBar`) and `centerContent` is null

#### Scenario: Non-office workspace active

- **WHEN** `activeWorkspace` is `'sops'` / `'market'` / `'personnel'` / `'activity-log'` / `'settings'`
- **THEN** `AppLayout` renders with `centerContent` populated by `WorkspaceRouter` output, and `agentPanel` / `sceneCanvas` / `chatDrawer` / `eventLog` are null

### Requirement: WorkspaceRouter serves as AppLayout centerContent

`WorkspaceRouter` output SHALL be passed as `AppLayout`'s `centerContent` prop when a non-office workspace is active. The implementation SHALL live in the desktop renderer source tree after migration.

#### Scenario: WorkspaceRouter replaces FullPageWorkspaceShell wrapper

- **WHEN** user navigates from Office to SOPs
- **THEN** `WorkspaceRouter` renders `SopViewSurface` directly inside `AppLayout`'s center area, without any intermediate shell wrapper

## ADDED Requirements

### Requirement: Shell routing has no standalone web entrypoint

Unified shell routing SHALL be reachable through the Tauri desktop renderer entrypoint only. It SHALL NOT expose a standalone web route as an active product entrypoint.

#### Scenario: Entry point audit

- **WHEN** active app entrypoints are inspected
- **THEN** workspace routing is mounted by the desktop renderer entrypoint
- **AND** there is no active `apps/web/src/main.tsx` product entrypoint

