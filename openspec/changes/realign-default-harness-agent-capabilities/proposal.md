## Why

The previous harness work mixed three different concepts too easily: the default Offisim harness, provider SDK leaf lanes, and non-default agent-capable employee or harness-control routes. This change re-establishes the product truth before release work continues: make `offisim-core` stronger by absorbing reference-agent harness capabilities, while keeping alternate agent routes complete, explicit, and non-arbitrary.

## What Changes

- Re-state `offisim-core` as the default production harness and the primary place to absorb ClaudeSource, ClaudeRust, Claude Agent SDK, OpenAI Agents, MCP, and long-running stability lessons.
- Split provider SDK lanes from employee agent runtimes: SDK provider lanes remain text/reasoning leaf adapters, while a configured employee agent profile may be a complete agent runtime when it has evidence.
- Define non-default agent routes as production-grade capability tiers, not weak preview shortcuts: text-only, sandbox-native, gateway-bridged, full-agent employee, driver, and replacement.
- Require explicit policy, capability records, audit, checkpoint/resume, rollback, denied-path, cancellation, telemetry, and release evidence before any employee agent or main-harness driver/replacement is advertised.
- Clean stale wording in docs, specs, code comments, and user-facing copy that says or implies "all tool work must forever be gateway-only" without scoping that claim to provider SDK lanes and current verified profiles.
- Add a memory correction note so future agents do not reuse old 2026-04 dual-mode or 2026-05 provider-lane notes as a global gateway-only rule.
- Archive the previous `strengthen-default-agent-harness` change as superseded without syncing its delta specs into main specs.

## Capabilities

### New Capabilities

- `default-agent-harness`: Defines the corrected default-harness strengthening target and evidence boundary.
- `harness-agent-control-plane`: Defines complete but non-default employee-agent, driver, and replacement routes.

### Modified Capabilities

- `agent-sdk-provider-lanes`: Clarifies that provider SDK lanes are leaf text/reasoning lanes and are not the same thing as employee agent profiles.
- `runtime-engine-adapter`: Clarifies employee engine profiles, native/gateway-bridged tool evidence, and no silent downgrade/override behavior.
- `provider-lane-matrix`: Narrows "gateway-only" wording to provider SDK lane exposure and current verified profiles.
- `openspec-docs-alignment`: Adds stale-memory, dead-doc, and stale-code cleanup gates for runtime architecture work.
- `runtime-live-verification-gates`: Requires release evidence before alternate agent routes are advertised.

## Impact

- OpenSpec source of truth: active changes, archived changes, main specs, provider lane matrix, protocol ledger, harness capability map.
- Runtime docs and user-facing copy: AGENTS/CLAUDE guidance, SDK-lane tool rejection messages, Codex host instructions, and interaction follow-up text.
- Future implementation planning: default harness strengthening stays the release-critical path; alternate agent employee and main-harness control routes remain complete but gated.
