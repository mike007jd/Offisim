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

### Requirement: Agent SDK lanes SHALL NOT expose Offisim runtime tools

Until SDK-lane tool bridging is implemented, Claude, Codex, and OpenAI agent SDK lanes SHALL set runtime tool-call capability false and SHALL NOT expose file, shell, memory, todo, skill, MCP, or built-in tool schemas to the model.

Adapters for SDK lanes SHALL fail closed with explicit user-facing text if any tool request reaches them. Provider/UI capability copy SHALL NOT label SDK-lane execution as an Offisim tools-capable path.

#### Scenario: SDK lane hides all Offisim tools
- **WHEN** an employee or YOLO turn runs under an SDK lane
- **THEN** the model request contains none of `read_file`, `write_file`, `bash`, `todo_create`, `todo_update`, `todo_list`, `handoff_to`, skill tools, memory tools, MCP tools, or built-in tools
- **AND** settings copy describes the lane as text/reasoning-only for Offisim tools.

#### Scenario: SDK adapter fails closed on unexpected tools
- **WHEN** a tool request reaches an SDK lane adapter
- **THEN** the adapter rejects the request instead of forwarding it to a sidecar that cannot execute Offisim tools
- **AND** the error points the user to the gateway lane for project file and command work.

### Requirement: Local tool work SHALL NOT route to external A2A employees

Requests that require Offisim-local filesystem, shell, workspace, or path-bounded project tools SHALL route only to enabled internal employees running in a tools-capable gateway context. External A2A employees and text/reasoning-only SDK lanes SHALL NOT be selected for those tasks as if they could access local project files or commands.

Direct-to-employee requests that explicitly target an external A2A employee for local file or command work SHALL fail fast with a user-facing explanation instead of sending the task to the external endpoint.

#### Scenario: Boss avoids external A2A for local tools
- **WHEN** a user asks to read, write, list, or execute commands in the project workspace
- **AND** both internal and external employees are available
- **THEN** routing selects an enabled internal employee for the local-tool task
- **AND** no A2A request is sent as local filesystem evidence.

#### Scenario: External direct local-tool request fails fast
- **WHEN** direct chat targets an external A2A employee with a local file or shell request
- **THEN** the request is rejected before external dispatch
- **AND** the user is told to use an internal gateway-lane employee for project file and command work.
