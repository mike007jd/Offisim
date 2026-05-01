## ADDED Requirements

### Requirement: Active project's `workspace_root` SHALL reach the desktop builtin tool sandbox

When a Tauri desktop runtime is active AND the active project has a non-null `workspace_root`, the path SHALL reach the Rust-side builtin tool sandbox (`apps/desktop/src-tauri/src/builtin_tools.rs`) before any builtin tool (`read_file` / `write_file` / `bash`) is invoked. The runtime SHALL NOT throw `'no project workspace root is bound'` when the data layer has a bound `workspace_root` for the active project.

The binding SHALL be re-applied on:
- Initial runtime activation
- Active project switch (within the same company)
- Active company switch (when the new active company has a default project with `workspace_root`)
- Project edit that changes `workspace_root` from null to non-null OR between two non-null values

#### Scenario: Builtin tool succeeds when active project has bound workspace_root
- **WHEN** the active project has `workspace_root = '/Users/x/proj-a'` AND the user asks the boss to read a file under that path
- **THEN** the builtin `read_file` tool runs successfully against the real filesystem (subject to existing 8 MB read cap and path-sandbox guards)
- **AND** does NOT throw `'no project workspace root is bound'`

#### Scenario: Project switch re-binds workspace_root in Rust state
- **WHEN** the user switches the active project from one with `workspace_root = '/path/a'` to one with `workspace_root = '/path/b'`
- **THEN** subsequent builtin tool invocations resolve relative to `/path/b`, not `/path/a`

#### Scenario: Switching to project with null workspace_root surfaces typed error
- **WHEN** the user switches to a project whose `workspace_root` is null
- **THEN** subsequent builtin tool invocations throw a typed error of the form `'no project workspace root is bound'`
- **AND** that error category is observable in the runtime event stream (see next requirement)

### Requirement: Workspace-binding gaps SHALL emit an observable runtime event

When a builtin tool invocation fails because no `workspace_root` is bound, the runtime SHALL emit a `runtime_event` with `event_type='workspace-binding.unavailable'` and payload `{ companyId, projectId, expectedWorkspaceRoot, missingAt }` where `missingAt` is one of `'rust-state' | 'runtime-context' | 'project-switch'`. The event SHALL fire at most once per `(companyId, projectId)` tuple per session to avoid log spam from retry loops.

#### Scenario: First binding miss emits event with diagnostic payload
- **WHEN** a builtin tool invocation throws `'no project workspace root is bound'` for the first time in a session under a given `(companyId, projectId)` pair
- **THEN** a `workspace-binding.unavailable` event is emitted with the populated payload
- **AND** the event identifies the upstream layer (`rust-state` / `runtime-context` / `project-switch`) where the binding broke

#### Scenario: Repeated binding misses suppress duplicate events
- **WHEN** the same `(companyId, projectId)` pair triggers multiple binding-miss errors in the same session (e.g., the LLM retries the tool 5 times)
- **THEN** only the first miss emits an event; subsequent misses are suppressed

#### Scenario: Active company switch resets the suppression cache
- **WHEN** the user switches to a different active company and a binding miss occurs in the new company
- **THEN** the new company's first miss emits an event (suppression cache is per-`(companyId, projectId)`, not global)
