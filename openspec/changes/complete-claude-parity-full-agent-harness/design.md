## Context

Offisim now has a real default harness surface: deterministic scenarios, replay, provider-adapter checks, stream-tool parity, engine-profile gates, MCP lifecycle checks, context/resume/chaos/soak hooks, and release `.app` verification patterns. The remaining problem is not that the harness has no foundation. The problem is that the current truth still allows agents to conclude "full-agent remains blocked" and stop there.

ClaudeSource is the practical reference for a full coding-agent runtime: streaming main loop, early tool execution, context compaction, session restore, permission hooks, MCP surfaces, fork/subagent behavior, and long-running task visibility. ClaudeRust is the practical reference for CLI/local-tool parity: file/bash/grep/edit flows, permission modes, workspace boundaries, task/tool registries, MCP/LSP registry surfaces, and mock parity harnesses. Offisim must absorb the product outcomes that matter without surrendering runtime ownership.

This change treats parity as one release program with explicit gates. It does not claim that every vendor SDK becomes the main harness. It requires Offisim to support two truthful paths:

- `offisim-core` as the default product harness with Claude-class local execution behavior.
- verified full-agent employee/driver/replacement profiles that preserve native agent runtime semantics and are promoted only after evidence exists.

## Goals / Non-Goals

**Goals:**

- Close the full-agent parity backlog in one coordinated OpenSpec change rather than more narrow follow-up changes.
- Turn `sdk-native-full-power` into an implemented, testable, release-gated route instead of a permanent blocked placeholder.
- Preserve the default Offisim harness as the main product owner for planning, task state, permissions, checkpoint, audit, and completion evidence.
- Normalize native SDK/agent events into Offisim without stripping the native loop down to one-shot text.
- Add a cross-route benchmark that proves where `offisim-core`, gateway-bridged profiles, and SDK-native full-agent profiles are stronger/weaker.
- Make stale memory/docs cleanup a blocking gate so future agents do not keep reintroducing the old "SDK lane/text-only/blocked" framing.

**Non-Goals:**

- No silent product takeover by Claude Agent SDK, Codex, OpenAI Agents, ClaudeSource, or ClaudeRust.
- No unreviewed code copy from ClaudeSource or ClaudeRust.
- No claim that native SDK tool evidence equals Offisim gateway evidence unless a bridge proves equivalence.
- No archive if release `.app` live verification is unavailable, except with an explicit unshipped blocker left open.

## Decisions

### 0. Source-backed feature map is the scope authority

The change includes `reference-feature-map.md`, which maps every feature family to ClaudeSource,
ClaudeRust, Offisim target behavior, required gates, and non-copy decisions. This is the first check
for whether an implementation is on track. If a task, spec scenario, benchmark case, or release claim
does not map back to a feature row, it is not part of the parity scope unless the row is added or the
item is explicitly declared out of scope.

The map is behavioral. ClaudeSource supplies full-agent/subagent and streaming orchestration
reference. ClaudeRust supplies local harness, typed runtime, sandbox, and benchmark discipline.
Offisim must combine the two and record deliberate product divergence instead of copying either codebase.

### 1. Treat parity as a capability ledger plus gates, not a narrative comparison

The source comparison lives in a parity ledger that maps each reference capability to an Offisim module and gate. A capability is shipped only when it has code, deterministic/backend proof, and release evidence where user-visible behavior is involved.

Alternative considered: keep using ad hoc audit notes. Rejected because prior rounds repeatedly left memory/docs that made the next agent stop at the old boundary.

### 2. Make the local-productivity floor explicit

The ledger must cover the practical work users expect from a Claude-class coding agent: file tree, read/write/edit/patch, grep/search, shell and long-running process lifecycle, git/worktree operations, MCP, artifacts/deliverables, memory/todo/skill, browser/desktop boundaries, permission UX, and secret/credential handling. A route that only proves chat, one file edit, or one MCP call is not parity.

Alternative considered: rely on broad phrases such as "local tools". Rejected because those phrases let future work skip git/process/artifact/skill/memory edges.

### 3. Keep `offisim-core` default, but require it to meet the Claude-class floor

The default harness remains the default owner. It must support bounded multi-turn loops, stream/tool progress, permission/audit, MCP lifecycle, context retention, resume/checkpoint, cancellation, completion evidence, sandboxing, and failure taxonomy at the level needed for Offisim workflows.

Alternative considered: make SDK-native runtime the default. Rejected because it would bypass existing product state, SOP, approval, and evidence contracts.

### 4. Implement full-agent profiles as explicit runtime profiles

`sdk-native-full-power` becomes a real implementation target. It is unavailable until gates pass, but tasks cannot complete by merely observing that it is blocked. The implementation must preserve native SDK/agent semantics: multi-turn loop, native tools, MCP, sessions, hooks/guardrails, subagents/handoffs, cancellation, budgets, usage, typed partial failures, and checkpoint/rollback.

Alternative considered: gateway-only bridge for every tool. Rejected because it can be useful, but it does not prove native full-agent parity and would hide what SDK-native profiles actually can or cannot do.

### 5. Separate provider transport, product selection, runtime profile, and control-plane ownership

Provider products and `executionLane` fields describe model access and transport. They do not select employee full-agent behavior, driver mode, or replacement mode. Runtime profile selection and control-plane policy carry those decisions, with separate evidence and availability state.

Alternative considered: use the existing provider lane as the user-facing full-agent switch. Rejected because it recreates the old "ordinary SDK lane" confusion and can accidentally expose local tools through an unverified transport.

`reference-feature-map.md` is the source-backed taxonomy check: provider or transport rows must not be
used to smuggle in full-agent, driver, or replacement claims.

### 6. Separate native evidence, gateway evidence, and bridge evidence

Completion verification and activity feeds must label evidence correctly. Native SDK tool work is SDK-native evidence. Gateway-bridged work is gateway evidence with a native-agent proposal/initiation trail. A release decision may accept either only if the profile has explicit evidence for that task class.

Alternative considered: normalize every tool as `offisim-gateway`. Rejected because it would make audits and rollback claims misleading.

### 7. Promote only through release `.app` gates

Backend harnesses can prove semantics, but user-visible full-agent availability requires the release `.app` body: exact current worktree app path, Computer Use attachment, real interaction, DB/event evidence, bundle hash/time, and remaining blockers.

Alternative considered: count dev webview or localhost smoke. Rejected by repo policy and by prior release-verification failures.

### 8. Clean truth sources before implementation is considered complete

The change must update or correct all active truth sources that could mislead future agents: specs, ledgers, provider matrices, root guidance, archived searchable notes when current, and memory correction notes. Existing historical memory files are append-only; the allowed cleanup is a newer ad hoc correction note that supersedes the toxic interpretation.

Alternative considered: rely on final chat explanation. Rejected because future agents do not reliably see prior chat.

## Risks / Trade-offs

- **Risk: full-agent route becomes a second hidden product owner** -> Mitigation: all promotion goes through harness control-plane policy, checkpoint identity, audit evidence, and rollback gates.
- **Risk: native SDK events are too different to normalize cleanly** -> Mitigation: use a typed event envelope with raw-provider payload kept behind debug/audit fields, not renderer contracts.
- **Risk: release `.app` verification blocks because credentials or Computer Use are unavailable** -> Mitigation: leave the task unchecked and mark the route unavailable; do not archive or claim parity.
- **Risk: benchmark rewards shallow happy paths** -> Mitigation: benchmark matrix includes denied path, cancellation, resume/fork, MCP failure, budget exhaustion, sandbox escape, and rollback.
- **Risk: stale memory continues to poison follow-up work** -> Mitigation: this change requires a specific ad hoc memory correction note and a grep/report over repo truth sources before completion.

## Migration Plan

1. Land the parity ledger and stale-truth cleanup first so implementation work starts from the correct target.
2. Extend default harness gates and release evidence for any ClaudeSource/ClaudeRust floor gaps that are still backend-only.
3. Implement full-agent profile event envelopes and host adapters without enabling production selection.
4. Add deterministic profile gates and cross-route benchmarks.
5. Add Personnel/runtime UI surfaces that show unavailable reasons until release gates pass.
6. Run release `.app` verification for default harness and each promoted profile.
7. Only then mark full-agent profiles available, update provider/runtime matrices, and archive the change.

Rollback is simple until profile availability is flipped: keep the profiles unavailable. After availability is flipped, rollback means disabling the profile in runtime policy and restoring `offisim-core` as the selected owner while preserving run/audit records.

## Open Questions

No product decision is open. The only external dependency is live verification availability: provider credentials, Computer Use attachment, and any local SDK host prerequisites. Missing live evidence blocks promotion rather than changing scope.
