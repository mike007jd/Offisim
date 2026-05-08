## Why

Offisim should keep its own harness as the default product runtime, but the current harness must absorb the production strengths visible in the two reference implementations: persistent conversation state, mature tool-loop recovery, context survival, MCP lifecycle management, and evidence-grade verification. SDK lanes and external agents are valuable architectural coverage, but they must not redefine the default path, ship as thin placeholders, or blur the boundary between Offisim-owned tools and vendor-owned agent runtimes.

## What Changes

- Strengthen the default Offisim harness into the primary production runtime for boss, manager, employee, long-running, local-tool, and release verification flows.
- Add a capability-map contract that turns ClaudeSource, ClaudeRust, Claude Agent SDK, OpenAI Agents JS, and MCP docs into concrete Offisim harness requirements rather than loose inspiration.
- Add first-class support for "agent-capable employees" as a separate engine profile: a configured employee may own a trusted external or SDK-backed agent runtime, but Offisim still owns routing, permissions, checkpoints, task state, and user-visible evidence.
- Add a controlled main-harness agent control plane so another agent can drive or replace the main harness only through explicit policy, audit, capability profile, and equivalence gates. The default remains `offisim-core`.
- Define a production-grade completeness bar for non-default agent routes: capability tiers, explicit unsupported states, full telemetry, cancellation, resume/checkpoint, permission, rollback, and release evidence.
- Prohibit arbitrary override: no provider lane, employee profile, SDK runtime, or external peer may silently promote itself into the main harness, replace `offisim-core`, or downgrade to a different runtime without an auditable policy decision.
- Preserve the existing rule that provider SDK lanes are leaf model/reasoning adapters, not Offisim tool executors.
- Make current red harness gates part of the entry criteria: deterministic replay and context harness failures must be fixed before the new harness can be called production-ready.

## Capabilities

### New Capabilities
- `default-agent-harness`: Defines the Offisim-owned default harness capability target, including persistent run state, tool-loop recovery, context survival, MCP lifecycle, and production-grade evidence.
- `harness-agent-control-plane`: Defines how external or SDK-backed agents may be configured as employee engines or main-harness drivers/replacements without changing the default harness ownership.

### Modified Capabilities
- `agent-sdk-provider-lanes`: Clarifies that provider SDK lanes remain text/reasoning-only leaf lanes and are separate from agent engine/control-plane capability.
- `runtime-engine-adapter`: Extends employee engine mode with capability profiles for full agent employees while preserving Offisim-owned task state and tool boundaries.
- `backend-harness-verification`: Adds reference-parity suites, MCP lifecycle coverage, context survival coverage, and current-red-gate entry criteria.
- `runtime-live-verification-gates`: Adds release evidence gates proving default harness ownership and safe behavior when alternate agent engines are configured.

## Impact

- Core runtime: employee loop, turn runner, tool registry, completion verification, context budget, checkpoint/session storage, provider adapter boundaries, MCP registry.
- UI/product: Personnel runtime tab, Settings runtime defaults, future main-harness runtime policy surface, activity feed evidence.
- Verification: deterministic harness, context harness, replay, stream-tools, model-bench, MCP smoke, backend smoke/load/edge, release `.app` live verification.
- Documentation/specs: provider lane matrix, protocol ledger, runtime verification gate docs, harness capability map, alternate-agent capability matrix, override audit policy.
