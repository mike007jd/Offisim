# interaction-modes Specification

## Purpose

Defines Offisim runtime entry modes for boss-proxy, human-in-loop, direct-to-employee, and YOLO execution, including mode-specific state reset and trusted tool availability.

## Requirements

### Requirement: Direct and YOLO modes SHALL start from clean plan-scoped state

Direct-to-employee and YOLO entry paths SHALL clear stale SOP/plan execution state before dispatching an employee turn. Old verifier evidence, pending assignments, dispatched steps, completed steps, blocked steps, and step outputs SHALL NOT leak into the new direct or YOLO run.

#### Scenario: YOLO mode does not reuse prior SOP state

- **WHEN** a prior boss-proxy plan left completed or dispatched step state in the checkpoint
- **AND** the user starts a YOLO turn
- **THEN** the graph enters `yolo-master` first
- **AND** the YOLO employee receives only the new assignment state.

### Requirement: Gateway lane SHALL expose trusted desktop file and shell tools

In a `desktop-trusted` Tauri runtime using the `gateway` lane, employee and YOLO tool pools SHALL include bounded built-in `read_file`, `write_file`, and `bash` capabilities for project workspaces.

Browser-limited runtimes SHALL NOT expose those built-ins. Agent SDK lanes remain known-limited for full Offisim fs/shell tool support until separately implemented.

#### Scenario: Desktop gateway YOLO sees project tools

- **WHEN** a desktop-trusted gateway runtime starts a YOLO employee turn
- **THEN** the model request exposes `read_file`, `write_file`, and `bash`
- **AND** the commands are constrained to bound project workspace roots.

#### Scenario: Browser runtime omits project tools

- **WHEN** a browser-limited runtime starts an employee turn without desktop built-ins
- **THEN** the model request does not expose `read_file`, `write_file`, or `bash`.

### Requirement: Agent SDK lanes SHALL be explicit about fs/shell limitation

Until SDK-lane tool bridging is implemented, Claude, Codex, and OpenAI agent SDK lane adapters SHALL fail with explicit user-facing limitation text when a task needs Offisim fs/shell tools.

#### Scenario: SDK lane tells the user to switch lane

- **WHEN** an employee task requires file or shell tools under an SDK lane
- **THEN** the adapter reports that SDK lane fs/shell tools are not currently supported
- **AND** it points the user to the gateway lane for project file and command work.
