## MODIFIED Requirements

### Requirement: Gateway-lane filesystem and shell tools are honest about their bounds

Gateway-lane project file tools SHALL only operate under canonicalized `projects.workspace_root` directories that pass workspace-root sanity checks. Write paths SHALL validate the deepest existing ancestor before any parent directory creation or file write occurs, and SHALL re-validate the final written path after the write.

Workspace roots that are host-level directories such as `/`, `/Users`, `/home`, `/tmp`, `/usr`, `/opt`, `/private`, the current user home, the current user home's parent, or paths with insufficient depth SHALL be ignored for tool binding.

LLM-facing filesystem errors SHALL NOT include host absolute paths. Errors SHALL use a stable redacted form or a path relative to a bound root.

Bash execution in the gateway lane SHALL be cwd-bound to a project workspace and SHALL NOT source login profiles. It SHALL NOT be described as a full command sandbox.

Read and write tools SHALL enforce in-process file size limits.

#### Scenario: Symlink write escape is rejected before side effects
- **WHEN** a project workspace contains a symlink to a directory outside all bound roots
- **AND** the gateway lane attempts to write through that symlink
- **THEN** the write is rejected before creating parent directories outside the root
- **AND** the LLM-facing error does not include a host absolute path

#### Scenario: Overbroad workspace roots are ignored
- **WHEN** a project row binds `/` as `workspace_root`
- **THEN** gateway filesystem tools report that no project workspace root is bound

#### Scenario: Oversized file IO is rejected
- **WHEN** a read or write payload exceeds the configured in-process byte limit
- **THEN** the tool rejects the operation with a redacted path and size-limit error

### Requirement: Desktop privileged invokes require explicit capabilities

Desktop fs/shell invokes and agent bridge invokes SHALL each be guarded by a dedicated Tauri capability limited to the main window. These privileged commands SHALL NOT rely only on broad default capability visibility.

#### Scenario: Privileged invoke is main-window scoped
- **WHEN** desktop capabilities are loaded
- **THEN** fs/shell and agent bridge commands are granted only to the main window capability set
