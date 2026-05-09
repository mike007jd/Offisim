## ADDED Requirements

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
