## Context

The user-corrected product model has three layers:

1. Default runtime: Offisim's own `offisim-core` harness remains the default and must become stronger before release.
2. Provider SDK lanes: Claude/Codex/OpenAI SDK provider lanes are leaf text/reasoning transports for Offisim-owned graph nodes.
3. Non-default agent routes: an employee may be configured with a complete agent runtime, and the main harness may later be driven or replaced, but only through explicit capability profiles and evidence gates.

The previous active change contained useful implementation work, but the surrounding wording can still train future agents into the wrong simplification: "tool execution must always be gateway-only." The correct statement is narrower: current provider SDK lanes cannot execute Offisim-local tools; current verified full-agent/gateway-bridged profiles are not production-advertised yet.

## Decisions

### Decision 1: Default harness strengthening is the release path

`offisim-core` remains the owner of planning, routing, permissions, checkpointing, task state, MCP lifecycle, completion evidence, and release verification by default. Reference projects and SDK docs are capability targets that Offisim should absorb into its own harness, not replacements for the default path.

### Decision 2: Provider lane is not employee engine profile

Provider lane selection answers "how does this Offisim graph node call a model?" Employee engine profile answers "what runtime owns this employee task?" These must not share UI copy, docs wording, or code comments that imply the SDK provider lane can become a tool-capable employee simply because the SDK supports tools.

### Decision 3: Non-default routes must be complete, not casual

When Offisim exposes a tool-capable employee agent, driver, or replacement route, it must be strong enough to stand as a production route for its declared tier. Missing cancellation, denied-path, checkpoint/resume, telemetry, or rollback evidence keeps it preview-blocked.

### Decision 4: Avoid stale truth sources

Runtime architecture changes must include a stale-doc sweep and, when memory has misleading old entries, an additive correction note. We do not rewrite historical memory or archived changes, but we must leave an explicit newer truth source that future agents can prefer.

## Rollout

1. Create the corrected OpenSpec change and validate it strictly.
2. Archive the previous active change as superseded without syncing its deltas into main specs.
3. Update durable docs and user-visible messages that over-broaden Gateway-only language.
4. Add a memory correction note under the allowed ad hoc memory-extension path.
5. Run structural validation and relevant type/harness checks.
6. Commit on `main`, push to `origin/main`, and verify the remote branch advanced.

## Risks

- Existing code has a large uncommitted implementation set from the previous change. This change must avoid accidentally reverting it; only incorrect architecture wording and specs should be corrected.
- User-facing copy changes touch high-impact runtime paths. The intended behavior remains fail-closed for provider SDK lanes; only the guidance wording changes.
- Archived OpenSpec history can still be found by search. The archive must mark the old change as superseded and point to the new change.
