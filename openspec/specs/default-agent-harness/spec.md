# default-agent-harness Specification

## Purpose
TBD - created by archiving change realign-default-harness-agent-capabilities. Update Purpose after archive.
## Requirements
### Requirement: Default harness strengthening SHALL be the primary release path

Offisim SHALL keep `offisim-core` as the default runtime harness. The default harness SHALL own planning, routing, permission policy, checkpoint state, task state, MCP client lifecycle, cancellation, usage accounting, completion verification, and user-visible evidence unless an explicit verified non-default harness policy is selected.

Reference agent implementations, Claude Agent SDK, OpenAI Agents SDK, MCP docs, and Context7 research SHALL be used as capability targets for strengthening Offisim's own harness. They SHALL NOT be treated as automatic replacement of the default harness.

`offisim-core` SHALL be able to call models directly through an Offisim-owned model transport/provider adapter boundary. Using a vendor SDK inside that boundary SHALL NOT create a product-level SDK lane, SHALL NOT change runtime ownership, and SHALL NOT bypass Offisim planning, policy, telemetry, checkpoints, or completion evidence.

#### Scenario: Reference capability becomes Offisim evidence only after implementation

- **WHEN** a reference implementation or SDK exposes a capability such as tool-loop recovery, session resume, MCP lifecycle, or subagent handoff
- **THEN** Offisim marks that capability shipped only after an Offisim-owned module and gate prove the behavior
- **AND** reference source or SDK documentation alone is not release evidence

#### Scenario: Fresh runtime keeps Offisim as owner

- **WHEN** a fresh internal employee task runs without an explicit verified override
- **THEN** the runtime owner is `offisim-core`
- **AND** provider SDK availability or external agent discovery does not change the main harness owner

#### Scenario: Harness calls model without becoming a SDK lane

- **WHEN** `offisim-core` invokes Claude, OpenAI, Codex-compatible, Anthropic-compatible, or custom model transport
- **THEN** the product runtime remains the default Offisim harness
- **AND** SDK usage is recorded only as model transport/provider adapter detail unless a verified SDK-native employee runtime profile was explicitly selected

### Requirement: Docs SHALL distinguish tool ownership from model transport

Docs, specs, code comments, and user-facing copy SHALL NOT state or imply that calling a model means selecting an ordinary SDK lane. They SHALL state that the default harness owns model calling through Offisim model transport, while full SDK agent behavior belongs only to a verified SDK-native employee runtime or harness control-plane profile.

Docs also SHALL NOT state that all future tool-capable work must always use one fixed gateway route. Tool-capable work MAY use the default Offisim gateway harness or a verified tool-capable employee profile once that profile has the required evidence.

#### Scenario: Transport warning points to both valid concepts

- **WHEN** an unverified model transport receives a local-tool task it cannot execute
- **THEN** the warning says model transport is not a product runtime owner
- **AND** it points to the default Offisim harness/gateway tools or a verified tool-capable employee profile

#### Scenario: Future full-agent route is not forbidden by old wording

- **WHEN** an employee agent profile later passes full-agent or gateway-bridged release gates
- **THEN** existing docs and runtime messages do not contradict that product route
- **AND** they still preserve fail-closed behavior for unverified local-tool requests

### Requirement: Default harness SHALL meet the mainstream agent-harness parity floor

The default `offisim-core` harness SHALL be evaluated against a mainstream agent-harness parity floor before release. The floor SHALL include at minimum:

- multi-turn agent loop with bounded continuation, partial-state recovery, and max-turn exhaustion handling
- persistent run state, session resume, session fork, checkpoint identity, and rollback
- streaming text/reasoning/tool activity with no fake completion
- unified tool registry for builtin, MCP, gateway, workstation, and future runtime-profile tools
- tool input/output validation, permission callbacks, pre/post tool hooks, and guardrail outcomes
- MCP lifecycle including initialize, capability negotiation, tools, resources, prompts, roots, sampling, elicitation, logging, progress/task cancellation, list-changed notifications, and shutdown
- context budget, compaction, prompt-too-long recovery, anchor retention, and context usage reporting
- subagent/handoff proposal semantics that do not mutate global plan state without Offisim approval
- cancellation/interrupt propagation across model turn, tool call, MCP request, task-run state, and UI
- sandbox and filesystem boundary enforcement for local work
- tracing, telemetry, cost/usage, failure taxonomy, and replayable audit evidence
- release `.app` evidence for default ownership, successful tool work, denied path, cancellation, resume/checkpoint, and rollback where applicable

#### Scenario: Parity floor has no silent gaps

- **WHEN** a release candidate claims the default harness is production-grade
- **THEN** each parity-floor capability has an Offisim module, deterministic/backend/live gate, and evidence status
- **AND** any missing capability is recorded as a release blocker or explicitly scoped out of the claim

#### Scenario: Mainstream feature is absorbed rather than name-dropped

- **WHEN** Claude Agent SDK, OpenAI Agents, MCP, ClaudeSource, or ClaudeRust expose a capability such as hooks, guardrails, subagents, session fork, hosted MCP, or partial-state error recovery
- **THEN** Offisim does not claim parity until the same product outcome is implemented or intentionally superseded by an Offisim-owned equivalent
- **AND** the evidence identifies why the Offisim equivalent is not weaker for the target workflow

#### Scenario: Main harness is not weaker than SDK route for local productivity

- **WHEN** a task can be executed by both `offisim-core` and a verified SDK-native employee runtime
- **THEN** the harness benchmark compares task completion, tool validity, context retention, cancellation, cost/latency, and evidence quality
- **AND** release sign-off blocks if `offisim-core` is materially weaker without an explicit product reason

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

