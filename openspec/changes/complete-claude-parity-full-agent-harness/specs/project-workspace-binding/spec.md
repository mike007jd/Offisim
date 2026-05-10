## ADDED Requirements

### Requirement: Workspace binding SHALL be a parity evidence boundary

Claude-class local work SHALL prove that the active project's `workspace_root` reaches every local-work consumer that depends on it: project file tree, bounded file preview, gateway builtin `read_file` / `write_file` / `bash`, SDK-native or gateway-bridged full-agent tools, completion evidence, diagnostics, and release `.app` verification.

Any route that cannot prove the active workspace root SHALL be considered unavailable for file, shell, git/worktree, attachment-derived local file, or artifact-write task families.

#### Scenario: Release local task proves workspace root

- **WHEN** a release `.app` parity task reads, writes, edits, patches, greps, runs shell, or inspects git under an active project
- **THEN** evidence records the active project id, `workspace_root`, tool route, sandbox decision, and task-run/checkpoint identity
- **AND** completion cannot rely on final text alone

#### Scenario: Workspace-root drop blocks promotion

- **WHEN** the active project row has `workspace_root` but a downstream file tree, preview, builtin tool, full-agent adapter, or bridge reports no workspace root
- **THEN** the route emits a workspace-binding-gap event
- **AND** full-agent or default-harness parity remains blocked until the dropping layer is fixed

#### Scenario: UI preview remains bounded and separate from agent tool reads

- **WHEN** a parity run exercises the project file tree UI
- **THEN** the UI uses bounded `project_read_file_preview`
- **AND** agent work that requires larger reads uses the gated tool lane with its own byte budget and evidence class
