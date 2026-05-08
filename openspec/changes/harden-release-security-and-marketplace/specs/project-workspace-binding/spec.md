## ADDED Requirements

### Requirement: Desktop local path, git, and deliverable commands SHALL be project workspace scoped

Desktop commands that open local paths, save deliverables, or execute git SHALL accept `projectId` plus a relative path or project operation. They SHALL resolve the canonical workspace root from the active project and reuse the same workspace containment helper as `project_list_dir`, `project_read_file`, and `project_write_file`.

Commands SHALL reject absolute paths, parent traversal, symlink escape, missing workspace roots, and overbroad roots. `save_deliverable_to_local` SHALL write only under the active project's `deliverables/` directory unless the user explicitly chose another location through a system file picker in the same user action.

#### Scenario: Open local path cannot escape workspace
- **WHEN** a caller asks to open `../../.ssh/config` for a bound project
- **THEN** the command rejects the request before invoking Finder, Explorer, or xdg-open
- **AND** the error message uses the same redacted-path policy as project file tools

#### Scenario: Deliverable save targets project deliverables folder
- **WHEN** an employee saves `report.md` as a deliverable for project P
- **THEN** the desktop command writes to `<workspace_root>/deliverables/report.md`
- **AND** a caller-provided arbitrary root is ignored or rejected

#### Scenario: Git cwd is canonical project workspace
- **WHEN** `git_exec` runs for project P
- **THEN** Rust canonicalizes cwd inside P's `workspace_root`
- **AND** a cwd outside the project workspace is rejected even for allowlisted git subcommands

### Requirement: Shell execution SHALL be treated as high-risk local execution

`bash_execute` SHALL require a project id and a cwd inside that project's workspace. It SHALL NOT fall back to all known workspace roots when project id is omitted. Shell execution SHALL clear inherited environment variables by default and restore only a minimal allowlist. Each shell run SHALL record command, cwd, project id, employee id when available, approval id, timeout, exit code, and redacted stdout/stderr metadata.

Network access from shell SHALL be disclosed and policy-gated. Without OS-level sandbox, firewall, proxy, or equivalent enforcement, Offisim SHALL represent network policy as explicit user approval plus audit metadata and SHALL NOT claim that network denial is technically enforced. When OS-level network enforcement is enabled, denied network access SHALL be verified by an actual network command failing under the denied policy.

#### Scenario: Project id required for shell
- **WHEN** `bash_execute` is invoked without project id
- **THEN** the command fails closed with a typed missing-project error
- **AND** no shell process is spawned

#### Scenario: Shell environment is scrubbed
- **WHEN** a shell command runs inside a project
- **THEN** the child process receives only the approved minimal environment variables
- **AND** provider secrets, session cookies, and unrelated host env vars are absent

#### Scenario: Shell audit redacts secrets
- **WHEN** shell stdout or stderr contains an API-key-shaped token
- **THEN** the persisted audit event stores redacted output
- **AND** the UI-visible output does not reveal the token

#### Scenario: Network deny is not claimed without sandbox
- **WHEN** shell execution runs without OS-level network sandbox or equivalent enforcement
- **THEN** the UI and audit mark network access as approval-gated/disclosed
- **AND** release evidence SHALL NOT claim network access was denied at OS level

#### Scenario: Enforced network denial is verified
- **WHEN** a shell profile claims network access is denied by OS-level enforcement
- **THEN** a command such as `curl https://example.com` or `wget https://example.com` fails under that profile
- **AND** the failure is recorded as release evidence

### Requirement: Tauri capabilities SHALL enforce local execution least privilege

Tauri capabilities and command permissions SHALL expose credential-injecting LLM commands and local execution commands only to the intended runtime window or webview. Capability allowlists are a first layer only; command-level provider host, workspace containment, approval, and business validation SHALL still run even when a command is reachable.

#### Scenario: Unprivileged webview cannot invoke local execution command
- **WHEN** a non-runtime webview attempts to invoke `bash_execute`, `git_exec`, `open_local_path`, or `save_deliverable_to_local`
- **THEN** Tauri capability denies IPC access before command execution
- **AND** direct command-level tests would still reject invalid project/workspace inputs
