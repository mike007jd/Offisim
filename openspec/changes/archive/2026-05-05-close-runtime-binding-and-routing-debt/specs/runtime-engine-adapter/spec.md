## ADDED Requirements

### Requirement: SDK lanes SHALL be text/reasoning-only

SDK execution lanes SHALL NOT receive Offisim builtin tools.
This covers `claude-agent-sdk`, `codex-agent-sdk`, and
`openai-agents-sdk`, including file / shell / memory / todo / skill /
MCP tools. Per CLAUDE.md "1.0 交付口径", these lanes are
text/reasoning-only — Offisim tool surfaces ship through the `gateway`
lane only. SDK lane adapters that receive a tool request from the
model SHALL fail closed (return an error result, not silently route to
a side channel). When the user request itself is classified as requiring
local Offisim tools, SDK lanes SHALL fail fast before any model call
with a typed, chat-visible outcome instructing the user to switch back
to Gateway.

#### Scenario: claude-agent-sdk lane has no builtin tools in its kit

- **WHEN** an employee is bound to `claude-agent-sdk` engine
- **AND** a chat session starts on that employee
- **THEN** the assembled tool kit for that session SHALL NOT include
  `read_file`, `write_file`, `bash`, memory, todo, skill, or MCP tools

#### Scenario: codex-agent-sdk lane fails closed on tool request

- **WHEN** an employee is bound to `codex-agent-sdk` engine
- **AND** the model returns a tool-call request anyway
- **THEN** the adapter SHALL return an error result identifying the
  request as out-of-lane
- **AND** SHALL NOT route the request to the gateway lane's builtin
  sandbox

#### Scenario: SDK lane local-tool request short-circuits before model

- **WHEN** a boss, direct employee, or YOLO chat session is bound to
  `claude-agent-sdk`, `codex-agent-sdk`, or `openai-agents-sdk`
- **AND** the user asks to read files, write files, run shell commands,
  access workspace tools, memory, todo, skills, or MCP tools
- **THEN** the graph SHALL return a typed chat outcome before any model
  call
- **AND** it SHALL NOT create task runs, execute tools, or write MCP
  audit rows
- **AND** the user-visible follow-up SHALL tell the user to switch the
  employee/runtime back to Gateway

### Requirement: Every chat lane SHALL receive the same active-context snapshot at session-start

Every chat lane SHALL read the same active-context snapshot at session-start.
This covers gateway, claude-agent-sdk, codex-agent-sdk, and
openai-agents-sdk. The snapshot includes active-{project, company,
employee, workspace_root, providerConfig} from the same canonical
resolver. Lanes SHALL NOT carry their own divergent init path that
forks from the canonical resolver under any platform (release `.app` /
desktop dev / web dev).

#### Scenario: Snapshot equivalence across lanes

- **GIVEN** an active project P, active company C, and active
  employee E with engine ∈ {gateway, claude-agent-sdk,
  codex-agent-sdk, openai-agents-sdk}
- **WHEN** a chat session starts on E
- **THEN** the session-start snapshot SHALL be byte-equivalent to
  what the gateway lane would have read for the same E (excluding
  tool-kit fields, which are lane-specific per the
  text/reasoning-only requirement)

#### Scenario: Release `.app` lane has no fork from dev lane

- **WHEN** a release `.app` session starts on any lane
- **THEN** the resolver path consulted at session-start SHALL be the
  same module / function as in desktop dev
- **AND** SHALL NOT have a release-only branch that bypasses the
  canonical resolver
