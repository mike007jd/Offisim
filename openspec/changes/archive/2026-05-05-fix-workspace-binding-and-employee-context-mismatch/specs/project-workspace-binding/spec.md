## MODIFIED Requirements

### Requirement: Active project's `workspace_root` SHALL reach the desktop builtin tool sandbox

The runtime SHALL ensure that the active project's `workspace_root` is
visible to the gateway-lane builtin tool sandbox (`read_file` /
`write_file` / `bash` / `project_read_file_preview`) for every chat
session in every lane (release `.app`, desktop dev, web dev). When
`workspace_root` is populated on the active project but the sandbox
guard `'no project workspace root is bound'` fires, that is a regression
of this requirement and SHALL be treated as a release blocker.

#### Scenario: Builtin tool lane in release session honors workspace_root

- **WHEN** the user runs a release `.app` session whose active project
  carries a non-null `workspace_root`
- **AND** sends a chat prompt that triggers any builtin tool lane
- **THEN** the builtin sandbox SHALL execute against `workspace_root`
- **AND** SHALL NOT raise the `'no project workspace root is bound'`
  guard

#### Scenario: Diagnostic exposes the dropping layer on regression

- **WHEN** `workspace_root` is populated on the active project but the
  builtin lane still fails the precondition guard
- **THEN** the runtime diagnostic event SHALL identify the layer where
  `workspace_root` was lost (e.g., `bootstrap-attach` /
  `runtime-context-read` / `sandbox-precondition` /
  `release-context-init`)
- **AND** the diagnostic SHALL be exportable as evidence (per CLAUDE.md
  "诊断要做成 release app 内可导出的证据，用户最多复现 1 次")

### Requirement: Workspace-binding gaps SHALL emit an observable runtime event

The runtime SHALL emit a typed observable event whenever an active
project's `workspace_root` exists in the database row but is not
visible to a downstream consumer (builtin sandbox, file tree, opener
plugin, project_read_file_preview command). The event payload SHALL
include enough context to identify which downstream consumer raised the
gap and which propagation layer dropped the value.

#### Scenario: Event fires when builtin lane sees missing workspace_root

- **WHEN** the builtin tool sandbox precondition guard fires
- **AND** the active project row has a non-null `workspace_root`
- **THEN** the runtime SHALL emit a workspace-binding-gap event
- **AND** the event payload SHALL include `consumer: 'builtin-sandbox'`
  and the dropping-layer identifier from the diagnostic above
