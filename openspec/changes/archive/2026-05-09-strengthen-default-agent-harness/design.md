## Context

The product direction is now explicit: Offisim's own harness remains the default. The two reference source trees are not a reason to outsource orchestration to a vendor SDK; they are a benchmark for what our harness must learn to do well.

The reference implementations show five gaps that matter for production:

- Conversation ownership: a run keeps durable state across turns instead of rebuilding each request from scratch.
- Tool-loop maturity: tool availability, permission filtering, streaming, retry, stop hooks, and missing tool-result recovery are first-class.
- Context survival: large tool results, long sessions, summaries, prompt-too-long recovery, and anchor preservation are managed by the runtime.
- MCP lifecycle: tools/resources/prompts are discovered through initialized, stateful protocol connections with capability changes, cancellation, and shutdown.
- Evidence discipline: parity is proven by replay, captured requests, live smoke/load/edge, and release runtime checks rather than adapter existence.

Context7 confirms the same shape from current public SDK/protocol docs: Claude Agent SDK exposes session resume/fork, permission callbacks, tool allow/deny, MCP servers, hooks, subagents, budgets, sandbox, checkpointing, and streaming; OpenAI Agents JS exposes runner ownership, handoffs, guardrails, MCP/hosted tools, tracing, max-turn state, and typed errors; MCP itself requires initialize, capability negotiation, operation, notifications/cancellation, and shutdown.

## Goals / Non-Goals

**Goals:**

- Make `offisim-core` the production default harness and raise it toward reference-runtime parity.
- Let internal employees be configured with richer agent engines without treating provider SDK lanes as Offisim tools.
- Define a future-proof main harness control plane where another agent can drive or replace the harness only under explicit policy and verification.
- Treat non-default agent routes as real production-grade routes once advertised, with complete capability profiles and release evidence rather than placeholder coverage.
- Prevent arbitrary override: every driver/replacement decision must be scoped, auditable, reversible, and impossible to trigger from provider lane selection alone.
- Convert this into deterministic, backend, and release evidence gates before archive.
- Keep product language clean: users choose employee capability and runtime trust, not raw transport jargon.

**Non-Goals:**

- Do not make Claude Agent SDK, Codex Agent SDK, or OpenAI Agents SDK the default main harness.
- Do not expose Offisim file, shell, memory, todo, skill, MCP, or workspace tools through provider SDK lanes.
- Do not accept "SDK can do it" as proof that Offisim can do it.
- Do not mark the change complete while `pnpm harness:deterministic`, `pnpm harness:context`, or release `.app` gates are red.

## Decisions

### Decision 1: Default harness is `offisim-core`

`offisim-core` remains the default owner of planning, routing, employee execution, permissions, checkpoints, task state, tool execution, and evidence. This matches the product need: Offisim is an office operating system, not a thin launcher around somebody else's agent.

Alternative considered: make Claude/Codex/OpenAI SDK agents the default execution engine. Rejected because it weakens Offisim's control over local tools, user trust, audit, and release verification.

### Decision 2: Split three concepts that were getting conflated

- Provider lane: a leaf model transport/reasoning adapter.
- Employee agent engine: a configured employee runtime with its own agent capability profile.
- Main harness driver/replacement: a controlled top-level runtime mode that can only be enabled by policy and equivalence gates.

This lets a "super employee" use a rich SDK-backed agent runtime without pretending that a text-only provider lane has Offisim tool authority.

### Decision 3: Full agent employees require capability profiles

An employee may be configured with a richer agent runtime only when the runtime declares a capability profile: session model, tool namespace, sandbox boundary, permission callback, audit stream, cancellation, checkpoint behavior, and supported handoff semantics. Offisim maps that activity into employee evidence and proposals, while preserving its own task state.

### Decision 4: Main harness control is explicit and non-default

The main harness can later be driven by another agent through a control plane, but only as one of two named modes:

- Driver mode: external agent proposes actions; Offisim executes approved actions through its own harness.
- Replacement mode: trusted agent runtime owns a run segment, but Offisim still owns policy, audit, checkpoint handoff, release gates, and rollback.

Both modes are disabled by default.

### Decision 5: Non-default agent routes are capability-complete by tier

Alternate agent routes are not the default route, but once exposed they must be strong. The product should support explicit tiers such as text-only, sandbox-native tools, gateway-bridged tools, employee-agent, driver, and replacement. Each tier must state what it can do, what it cannot do, how it is verified, and what user-visible evidence it emits.

Alternative considered: expose alternate engines as generic preview toggles. Rejected because it creates weak coverage and makes users/debuggers guess what actually happened.

### Decision 6: Override is explicit, scoped, and auditable

Main harness override must resolve from a policy object, not from convenience branching. The policy records scope, actor, reason, runtime profile, previous mode, next mode, verification status, and rollback checkpoint. Provider lane choice, employee profile choice, or SDK availability cannot self-promote into main harness control.

Alternative considered: auto-select the most capable runtime available. Rejected because it makes release evidence and incident debugging unreliable.

### Decision 7: Verification starts with current red gates

The change starts by fixing the current deterministic and context harness failures. Then it adds reference-parity suites: tool-loop recovery, context survival, MCP lifecycle, permission denial, cancellation, session resume/fork, long-running budget behavior, and release `.app` evidence.

## Risks / Trade-offs

- [Risk] Agent capability language could confuse users into thinking SDK lanes execute local tools. -> Mitigation: UI and specs keep provider lane, employee engine, and main harness mode visibly separate.
- [Risk] Main harness replacement could weaken Offisim audit. -> Mitigation: replacement mode cannot archive without equivalence evidence and audit replay.
- [Risk] Non-default route ships as a weak toggle. -> Mitigation: capability tier matrix plus release evidence is required before advertising support.
- [Risk] Runtime override happens accidentally through config drift. -> Mitigation: override policy requires explicit scope, actor, reason, previous/next mode, and rollback point.
- [Risk] Context features become expensive or slow. -> Mitigation: use bounded micro-compact, synopsis, and prompt-too-long recovery with deterministic budget metrics.
- [Risk] MCP tool surface changes during a run. -> Mitigation: runtime owns initialized MCP client sessions, list-changed notifications, refresh policy, cancellation, and shutdown.
- [Risk] Reference parity becomes vague. -> Mitigation: every absorbed capability maps to a named harness scenario or release gate.

## Migration Plan

1. Fix red baseline gates and record the starting harness truth.
2. Implement default harness parity improvements behind Offisim-owned abstractions.
3. Add employee agent capability profiles and control-plane contracts without enabling replacement by default.
4. Add alternate-agent capability tiers, override policy, and rollback contracts before exposing product toggles.
5. Add UI/runtime policy surfaces only after backend contracts and replay evidence are stable.
6. Run deterministic, backend, context, MCP, model-bench, stream-tools, and release `.app` gates before archive.

Rollback is straightforward for the extension surfaces: keep `offisim-core` as default and disable non-default agent engine/control-plane configs. Rollback is not a substitute for fixing baseline harness regressions.

## Open Questions

- Which agent engines are allowed in the first trusted employee-agent profile: Claude-only, Codex-only, OpenAI-only, or all three behind separate profiles?
- Should main harness replacement be exposed in product UI for 1.0, or remain config-only until after default harness parity is proven?
- Which MCP transports are in scope for first production evidence: stdio only, HTTP/SSE only, or both?
