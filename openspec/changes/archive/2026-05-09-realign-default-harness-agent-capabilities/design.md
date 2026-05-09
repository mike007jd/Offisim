## Context

The user-corrected product model has three layers:

1. Default runtime: Offisim's own `offisim-core` harness remains the default and must become stronger before release.
2. Model transport: `offisim-core` can call models directly through its own provider adapter/transport boundary. SDKs may implement that transport, but this is not a product lane.
3. Non-default agent routes: an employee may be configured with a complete agent runtime, and the main harness may later be driven or replaced, but only through explicit capability profiles and evidence gates.

The previous active change contained useful implementation work, but the surrounding wording can still train future agents into two wrong simplifications: "calling a model means selecting a SDK lane" and "tool execution must always be gateway-only." The correct statement is narrower: model calling is owned by `offisim-core`; non-default agent runtimes require explicit capability profiles and evidence.

## Decisions

### Decision 1: Default harness strengthening is the release path

`offisim-core` remains the owner of planning, routing, permissions, checkpointing, task state, MCP lifecycle, completion evidence, and release verification by default. Reference projects and SDK docs are capability targets that Offisim should absorb into its own harness, not replacements for the default path.

### Decision 2: Model transport is not employee engine profile

The default harness must be able to call models directly. A provider adapter, HTTP gateway, or SDK transport answers "how does this Offisim-owned harness call a model?" Employee engine profile answers "what runtime owns this employee task?" These must not share UI copy, docs wording, or code comments that imply a transport adapter is a product lane.

### Decision 3: Non-default routes must be complete, not casual

When Offisim exposes a tool-capable employee agent, driver, or replacement route, it must be strong enough to stand as a production route for its declared tier. Missing cancellation, denied-path, checkpoint/resume, telemetry, or rollback evidence keeps it preview-blocked.

### Decision 4: Avoid stale truth sources

Runtime architecture changes must include a stale-doc sweep and, when memory has misleading old entries, an additive correction note. We do not rewrite historical memory or archived changes, but we must leave an explicit newer truth source that future agents can prefer.

### Decision 5: Mainstream harness parity is a hard floor

The default harness cannot be judged only against old Offisim behavior. It must be measured against the mainstream agent-harness capability floor visible in Claude Code-style runtimes, Claude Agent SDK, OpenAI Agents, MCP, and the two reference source trees: multi-turn agent loop, stateful tools, MCP lifecycle, sessions/resume/fork, context compaction, permissions/hooks/guardrails, subagents/handoffs, tracing, cancellation, sandboxing, checkpoint/rollback, and release evidence.

### Decision 6: Full-power SDK runtime is a separate production route

There is no ordinary SDK product lane. SDKs have two allowed identities:

1. internal model transport/provider-adapter implementation detail owned by `offisim-core`
2. verified SDK-native employee runtime that keeps the SDK's own agent loop and tools alive

"Full-power SDK" means Offisim hosts and audits the runtime without stripping it down to `maxTurns=1`, final-text-only output, or transport-adapter behavior. It is allowed only as an employee runtime/control-plane profile with explicit permissions, sandbox, evidence, and rollback.

## Rollout

1. Create the corrected OpenSpec change and validate it strictly.
2. Archive the previous active change as superseded without syncing its deltas into main specs.
3. Update durable docs and user-visible messages that over-broaden Gateway-only language.
4. Add a memory correction note under the allowed ad hoc memory-extension path.
5. Run structural validation and relevant type/harness checks.
6. Add the second-audit parity/full-power SDK gates and leave implementation tasks open until the production route is actually verified.
7. Commit on `main`, push to `origin/main`, and verify the remote branch advanced.

## Risks

- Existing code has a large uncommitted implementation set from the previous change. This change must avoid accidentally reverting it; only incorrect architecture wording and specs should be corrected.
- User-facing copy changes touch high-impact runtime paths. The intended behavior remains fail-closed for unverified model transports that receive local-tool requests; only the product framing changes.
- Archived OpenSpec history can still be found by search. The archive must mark the old change as superseded and point to the new change.
- Full-power SDK runtime expands the security surface. The mitigation is not to keep it weak, but to require sandbox, permission mapping, telemetry normalization, checkpoint/rollback, and release evidence before advertising it.
