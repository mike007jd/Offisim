## ADDED Requirements

### Requirement: MCP stdio registration SHALL require trusted source and user approval

Desktop MCP stdio registration SHALL be treated as local process execution. A stdio MCP server MAY be registered only from a trusted source: user-created config, verified installed asset manifest, or explicit developer/runtime setting. Marketplace assets SHALL declare stdio MCP requirements in their manifest permissions before install.

The UI SHALL show command, args, source, requested tool names when available, and risk class before the user confirms registration. No marketplace asset or employee task may silently register or start an arbitrary stdio MCP server.

#### Scenario: Marketplace asset cannot silently register stdio command
- **WHEN** an installed marketplace asset attempts to register `command: "node"` with arbitrary args without declared MCP permission
- **THEN** registration is rejected
- **AND** no process is spawned

#### Scenario: User sees command before approval
- **WHEN** a stdio MCP registration is requested
- **THEN** the confirmation surface displays executable command, args, source package or user config, and risk class
- **AND** registration is persisted only after explicit approval

### Requirement: Tauri capabilities SHALL restrict MCP bridge entry surfaces

Tauri capabilities and command permissions SHALL expose MCP registration, connect, and tool-call commands only to the runtime approval surface. Marketplace browse/detail surfaces SHALL NOT have direct static IPC access to stdio registration or startup commands by default.

Dynamic approval state, command fingerprint matching, source package/version validation, project scope checks, and current permission state SHALL be enforced by Rust command-level policy before any stdio process is spawned. Tauri capability controls who can reach the doorway; Rust policy decides whether this specific invocation may execute.

#### Scenario: Marketplace browse surface cannot start stdio MCP
- **WHEN** a marketplace browse/detail webview attempts to invoke `mcp_register_server` or `mcp_connect_registered`
- **THEN** Tauri capability denies the invocation before command execution
- **AND** no stdio process is spawned

#### Scenario: Runtime approval surface still requires command policy
- **WHEN** the runtime approval surface invokes `mcp_connect_registered`
- **THEN** Rust command-level policy verifies approval id, command fingerprint, source package/version, project scope when applicable, and current permission state
- **AND** any mismatch prevents stdio process spawn

### Requirement: MCP stdio startup and tool calls SHALL be audited

Starting a registered stdio MCP server and calling a tool through it SHALL emit audit events. Audit events SHALL include server id, command fingerprint, source, project id when scoped, employee id when available, approval id, tool name, and redacted input/output metadata. Raw secrets SHALL be redacted.

MCP tool permission classification SHALL come from verified installed asset manifest permission declarations, user-created config classification, or trusted built-in adapter metadata. Unknown or ambiguous MCP tool side effects SHALL be treated as high risk by default. If classification is missing, Offisim SHALL require explicit user approval or deny by default; it SHALL NOT assume an MCP tool is safe because its JSON schema omits filesystem, shell, network, or credential wording.

MCP tool calls classified as local file, shell, network, or credential-sensitive behavior SHALL pass through the same permission engine semantics as builtin tools.

#### Scenario: Startup audit exists
- **WHEN** `mcp_connect_registered` spawns a stdio process
- **THEN** an audit event records server id, source, command fingerprint, and approval id

#### Scenario: Tool call follows permission policy
- **WHEN** an MCP tool call requests filesystem write behavior
- **THEN** the permission engine evaluates it under the active project/user policy
- **AND** denial prevents the MCP call from executing

#### Scenario: Unknown MCP tool side effect is high risk
- **WHEN** an MCP tool lacks verified manifest permission, user-created classification, and trusted built-in adapter metadata
- **THEN** the permission engine treats the tool as high risk
- **AND** the tool requires explicit user approval or is denied by default

### Requirement: MCP command identity SHALL be fingerprinted

MCP stdio registration and startup SHALL compute a command fingerprint from canonical executable path, args, source package id/version when present, and source manifest hash when present. The fingerprint SHALL be stored with approval and audit records so approval reuse cannot silently transfer to a different executable or package version.

#### Scenario: Command args change invalidates approval reuse
- **WHEN** a previously approved MCP server changes command args
- **THEN** the computed fingerprint changes
- **AND** Offisim requires a new approval before startup

#### Scenario: Package version change invalidates MCP approval reuse
- **WHEN** an installed asset updates from version A to version B with a different manifest hash
- **THEN** MCP stdio approval tied to version A is not reused for version B
