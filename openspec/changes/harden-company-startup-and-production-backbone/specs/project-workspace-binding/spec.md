## ADDED Requirements

### Requirement: Project creation without workspace folder is enforced end to end
Creating a project without a local workspace folder SHALL be a valid product path across service, repository, runtime, and desktop renderer layers. No layer SHALL require `workspace_root` for project creation. Missing workspace root SHALL only disable local file/folder operations that require a bound folder.

#### Scenario: Service creates project with null workspace
- **WHEN** `ProjectService.createProject` is called with no `workspaceRoot`
- **THEN** the project row SHALL be created with `workspace_root = null`
- **AND** its dedicated chat thread / lifecycle SHALL be created normally

#### Scenario: Desktop create flow permits null workspace
- **WHEN** the desktop renderer requests project creation with a valid project name and no selected folder
- **THEN** the create request SHALL be accepted
- **AND** no validation layer SHALL block the submit solely because `workspace_root` is null

### Requirement: Workspace-dependent tools fail fast when project has no folder
When a project has `workspace_root = null`, local file/folder operations that require a workspace SHALL fail with a typed workspace-binding-unavailable outcome. Pure chat, project lifecycle, SOP planning, and non-file deliverables SHALL remain available if provider/runtime readiness permits.

#### Scenario: File read blocked by missing workspace
- **WHEN** an employee task requires reading a project file
- **AND** the active project has `workspace_root = null`
- **THEN** the tool path SHALL return a typed workspace-binding-unavailable outcome
- **AND** it SHALL NOT silently fall back to process cwd or an unrelated folder

#### Scenario: Pure text task remains available
- **WHEN** the active project has `workspace_root = null`
- **AND** the user starts a pure text planning task with provider credentials configured
- **THEN** the graph may execute normally without workspace file tools
