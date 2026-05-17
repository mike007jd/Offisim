## ADDED Requirements

### Requirement: Default tool loop SHALL soft-stop on round exhaustion (G04)

The default `offisim-core` provider-lane tool loop SHALL use a high, role/model-configurable round cap. Reaching the cap SHALL produce a typed partial completion that preserves partial state, NOT a failure/blocked terminal. The loop SHALL carry a `stopReason` through the model response so the harness can distinguish a finished turn, an output-truncated turn, and a refusal.

#### Scenario: Round exhaustion yields a typed partial completion

- **WHEN** the default tool loop reaches its configured round cap with work still pending
- **THEN** the run terminates as a typed partial completion with preserved partial state
- **AND** it is not routed to the error/blocked handler

#### Scenario: Output truncation is detected

- **WHEN** a model turn's output tokens reach the configured `maxTokens` limit
- **THEN** the loop records a truncated `stopReason`
- **AND** a truncated assistant message is not silently treated as a normal completion

### Requirement: Aborted turns SHALL leave a well-formed message history (G04)

When a turn is aborted mid-round, the harness SHALL append a synthetic error tool-result for every dispatched-but-unfinished tool call before finalizing cancellation, so no `tool_use` is persisted without a matching `tool_result`.

#### Scenario: Abort reconciles in-flight tool calls

- **WHEN** a turn is aborted while one or more dispatched tool calls have not returned
- **THEN** each unfinished tool call receives a synthetic error tool-result in the persisted history
- **AND** a subsequent checkpoint resume finds no unmatched `tool_use` block

### Requirement: Shell execution SHALL pass a command-classification gate (G02)

Before a shell command reaches execution, the default harness SHALL parse it into subcommands and classify each. Catastrophic patterns SHALL fail closed. Destructive-but-legitimate patterns SHALL route through the approval flow so non-interactive runs fail closed. A per-run read-only mode SHALL block write commands and write redirections. This gate is additive to, and SHALL NOT weaken, the existing workspace path-containment sandbox.

#### Scenario: Catastrophic command is denied

- **WHEN** a tool call requests a catastrophic command (e.g. recursive root delete, fork bomb, raw device write, recursive world-writable chmod)
- **THEN** the command is blocked before execution
- **AND** the denial is recorded as a typed permission outcome

#### Scenario: Destructive command requires approval

- **WHEN** a tool call requests a destructive-but-legitimate command (e.g. `rm -rf <path>`, `git push`, `git reset --hard`)
- **THEN** execution is gated through the approval flow
- **AND** a non-interactive run fails closed instead of executing it

#### Scenario: Read-only mode blocks writes

- **WHEN** the run is in read-only mode and a command would write files or redirect output
- **THEN** the command is blocked with a read-only-mode reason

### Requirement: Tool input SHALL be validated before dispatch (G05)

The composite tool executor SHALL validate and coerce tool input against the tool's schema before any side effect, and SHALL reject malformed input with a structured error rather than passing raw untyped arguments into execution.

#### Scenario: Malformed tool input is rejected structurally

- **WHEN** a tool call arrives with input that does not satisfy the tool schema (missing/mistyped required field)
- **THEN** the executor returns a structured validation error before dispatch
- **AND** no shell/file side effect occurs and no value is force-cast into the sandbox

### Requirement: Model-facing tool results SHALL be size-capped (G05)

Each tool SHALL declare a maximum result size fed back to the model. Oversized results SHALL be spilled to disk and replaced with a bounded preview plus a reference, so conversation history is not flooded by large MCP or attachment results.

#### Scenario: Oversized result spills with a preview

- **WHEN** a tool returns a result exceeding the tool's declared max result size
- **THEN** the model receives a bounded preview plus a spill reference
- **AND** the full result is retained on disk rather than inlined into history

### Requirement: Default harness SHALL provide core edit and search builtins (G06)

The builtin tool catalog SHALL include match-based file edit (with an ambiguous-match guard), glob, grep, and web-fetch tools, backed by the existing sandbox. File read SHALL support offset/limit with line numbers, and file write SHALL enforce a read-before-write guard.

#### Scenario: Match-based edit guards ambiguous matches

- **WHEN** an edit targets a string that occurs more than once without a replace-all intent
- **THEN** the edit is rejected as ambiguous rather than silently editing the first match

#### Scenario: Search and edit do not require shell fallback

- **WHEN** the model needs to find files by pattern, search file contents, or apply a targeted edit
- **THEN** dedicated glob/grep/edit builtins are available
- **AND** the model is not forced to reimplement these through `bash`

### Requirement: Tool execution SHALL support veto-capable lifecycle hooks (G08)

The harness SHALL expose `tool.before` and `tool.after` hook events whose handlers can allow, deny, or update tool input, consumed synchronously at the tool-execution boundary before side effects. Permission decisions SHALL be matched against tool arguments, not tool name alone. Name-pattern auto-allow for MCP tools SHALL be removed; unknown MCP tools SHALL default to ask, trusting read-only only from server-declared annotations.

#### Scenario: A pre-tool hook can block a call

- **WHEN** a registered `tool.before` handler blocks a tool call
- **THEN** the tool does not execute and the block reason is recorded

#### Scenario: Permission matches on arguments

- **WHEN** a tool call's arguments contain a destructive command/path
- **THEN** the permission decision evaluates the arguments, not only the tool name

#### Scenario: Spoofed-name MCP tool is not auto-allowed

- **WHEN** an MCP server exposes a destructive tool whose name begins with a read-only-looking prefix (e.g. `get_`/`list_`)
- **THEN** the tool is not auto-allowed by name
- **AND** it defaults to ask unless a server annotation declares it read-only

### Requirement: Delegated work SHALL run in an isolated sub-run context (G09)

The harness SHALL provide an isolated sub-run primitive: a delegated task receives a fresh message context and a scoped tool subset, and returns a typed summary handoff. Delegation SHALL NOT re-enter a worker against shared global graph state in a way that pollutes the parent transcript. The org-graph product metaphor is preserved as a recorded deliberate divergence; the isolation primitive operates underneath it.

#### Scenario: Sub-run context is isolated

- **WHEN** a task is delegated through the isolated sub-run primitive
- **THEN** the sub-run sees only its scoped task context and tool subset
- **AND** the parent receives a typed summary, not the full sub-run transcript
