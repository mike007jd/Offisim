## MODIFIED Requirements

### Requirement: Active project's `workspace_root` SHALL reach the desktop builtin tool sandbox

When a Tauri desktop runtime is active AND the active project has a non-null `workspace_root`, that active project SHALL be the only source for the Rust-side builtin tool sandbox (`apps/desktop/src-tauri/src/builtin_tools.rs`) before any builtin tool (`read_file` / `write_file` / `bash`) is invoked. The runtime SHALL NOT throw `'no project workspace root is bound'` when the data layer has a bound `workspace_root` for the active project. Desktop commands SHALL bind `company_id` and `project_id` together before accepting a workspace root, so a stale or cross-company project ID cannot widen the sandbox.

The binding SHALL be re-applied on:
- Initial runtime activation
- Active project switch within the same company
- Active company switch when the new active company has an active/default project with `workspace_root`
- Project edit that changes `workspace_root` from null to non-null OR between two non-null values

`ProjectService.activateProject()` SHALL emit a project-activated runtime signal after the DB status update and SHALL synchronize runtime context `activeProjectId` before the next builtin tool invocation. The desktop builtin-tool layer SHALL receive the active project ID and active company ID through trusted IPC/context propagation or through an equivalent trusted active-project pointer, and `workspace_roots()` SHALL resolve only that active company's active project's `workspace_root`; it MUST NOT scan all projects and accept stale roots from inactive projects.

#### Scenario: Builtin tool succeeds when active project has bound workspace_root
- **WHEN** the active project has `workspace_root = '/Users/x/proj-a'` AND the user asks the boss to read a file under that path
- **THEN** the builtin `read_file` tool runs successfully against the real filesystem (subject to existing read caps and path-sandbox guards)
- **AND** does NOT throw `'no project workspace root is bound'`

#### Scenario: Project switch re-binds workspace_root in Rust state
- **WHEN** the user switches the active project from one with `workspace_root = '/path/a'` to one with `workspace_root = '/path/b'`
- **THEN** runtime context `activeProjectId` changes to the second project before the next builtin tool invocation
- **AND** subsequent builtin tool invocations resolve relative to `/path/b`, not `/path/a`

#### Scenario: Old project root is blocked after switch
- **WHEN** the user switches the active project from `/path/a` to `/path/b`
- **AND** a builtin tool request attempts to read `/path/a/secret.txt`
- **THEN** the request is rejected by the workspace sandbox
- **AND** `/path/a` is not present in the Rust-side allowed root set for that invocation

#### Scenario: Switching to project with null workspace_root surfaces typed error
- **WHEN** the user switches to a project whose `workspace_root` is null
- **THEN** subsequent builtin tool invocations throw a typed error of the form `'no project workspace root is bound'`
- **AND** that error category is observable in the runtime event stream

#### Scenario: Harness proves project switch rebinds workspace root
- **WHEN** deterministic harness scenario `switch-project-rebinds-workspace-root` switches from project A to project B
- **THEN** the recorded builtin tool context contains project B's root
- **AND** the scenario asserts project A's root is no longer readable

## ADDED Requirements

### Requirement: Workspace-relative path adapters SHALL reject path escape attempts

Any UI or skill-install adapter that accepts a workspace-relative file path SHALL reject `..` traversal, absolute-path substitution, and encoded path segments that escape the active project workspace root. This includes `apps/web/src/lib/tauri-skill-install-adapters.ts`; the implementation MUST keep the current path-escape defense as a durable workspace-sandbox invariant.

#### Scenario: `..` path is rejected before Tauri invocation
- **WHEN** a skill-install adapter is asked to write `../outside/SKILL.md`
- **THEN** the adapter rejects the request before invoking any Tauri command
- **AND** no file outside the active project workspace root is read or written

#### Scenario: Encoded traversal is rejected
- **WHEN** a workspace-relative path contains an encoded traversal segment such as `%2e%2e/outside.txt`
- **THEN** the adapter normalizes or rejects the segment so it cannot escape the active workspace root
- **AND** the failure is surfaced as a sandbox/path validation error, not as a silent fallback
