# Change: Close Runtime Binding And Routing Debt

## Why

`MEMORY.md` Active Backlog #4 has been carrying a placeholder change ID
`close-runtime-binding-and-routing-debt` ("Change B 待 propose") since
the runtime-context / tool-routing 2026-04-29 verify pass. The original
intent: capture the residual debt around how the runtime context
(active project, active company, active employee, workspace_root,
provider config) is propagated to and consumed by every chat lane —
gateway / agent-sdk lanes, builtin tool sandbox, A2A external
dispatch, boss-prompt assembly, deliverable contributors — and pin
the rules so future regressions trip an observable contract, not a
silent UX divergence.

The proximate reasons this change is being proposed *now*:

1. **Sub-bug overlap with `fix-workspace-binding-and-employee-context-mismatch`**.
   Backlog #2 names two concrete release-session regressions
   (workspace_root not reaching builtin lane; Boss roster vs.
   personnel rail divergence). Both look like specific manifestations
   of the broader debt this change targets. The implementer SHOULD
   evaluate folding #2 into this change at apply time if root cause
   is shared.

2. **Working-tree drift signals**. As of 2026-05-05 the main branch
   working tree carries uncommitted modifications to
   `apps/web/src/runtime/{BootstrapProvider,OffisimRuntimeProvider}.tsx`,
   `apps/web/src/lib/{tauri-runtime,browser-runtime,browser-runtime-storage}.ts`,
   `packages/core/src/runtime/runtime-context.ts`, and
   `packages/core/src/tools/builtin/{index,types}.ts`. These are
   exactly the runtime-context propagation hot-path. The implementer
   MUST read those diffs first; if they are part of an in-flight fix,
   this change either consumes them or is superseded by them.

3. **`task-tool-intent` SSOT exists but downstream rebind events are
   unverified end-to-end**. Spec
   `task-tool-intent` already pins detection (`detectTaskToolIntent`)
   and per-turn state field (`OffisimGraphState.taskToolIntent`). What
   is *not* yet pinned is end-to-end: when manager filters out an
   external A2A employee due to local-tool requirements, OR when
   `pm-planner/sanitize-rebind.ts` swaps a missing/disabled employee,
   the `task.assignment.rerouted` event MUST always be observable on
   the release session activity feed, with the right `source` /
   `reason` / collapse behaviour. Live evidence is missing.

## What Changes

This change is a debt-closure bundle. Concrete scope is partially
TBD because root cause is unknown until the implementer reads the
working-tree diffs and reproduces on release `.app`. The known
target areas:

**A. Runtime context propagation contract**

- Pin: every chat lane (gateway / claude-agent-sdk / codex-agent-sdk /
  openai-agents-sdk) SHALL read the same active-{project, company,
  employee, workspace_root, providerConfig} snapshot at session-start.
- Pin: the SDK lanes are text/reasoning-only (per CLAUDE.md "1.0 交付
  口径"). Their context snapshot SHALL reflect this — file/shell/memory
  /todo/skill/MCP/builtin tools SHALL NOT be in their tool kit.
- Pin: gateway lane is the only lane authorized to expose builtin
  tools, and it MUST reach builtin tools with the active project's
  `workspace_root` attached.

**B. Tool-routing rebind observability**

- Pin: `task.assignment.rerouted` event fires on every manager rebind
  AND every pm-planner sanitize-rebind, with `source` ∈ `{manager,
  pm-planner}` and `reason` from the closed enum
  (`requires-local-tools` / `employee-not-found` / `employee-disabled` /
  `no-recommendation-fallback`).
- Pin: activity feed collapse contract (3+ same source+reason+taskRunId
  → `×N` badge) holds in release session.

**C. Verify-only follow-ups carried over from the 2026-04-29
remediation sweep**

- Whatever is still on the candidate list of "code landed but live
  verify never run on release `.app`" within runtime-context /
  tool-routing scope. Concrete list determined by the implementer
  reading `MEMORY.md` Active Backlog and recent archive tasks
  (`2026-04-29-long-running-harness-interaction-modes-kanban-data`,
  `2026-05-01-consolidate-runtime-context-and-skill-tool-routing`,
  `2026-05-02-2026-04-29-sandbox-honesty-and-kanban-cas`).

Spec deltas (subject to revision at apply time):

- `runtime-engine-adapter` MODIFIED — pin SDK-lane tool-kit boundary
  per (A).
- `task-tool-intent` MODIFIED — pin end-to-end rebind observability
  per (B).
- `runtime-live-verification-gates` MODIFIED — add a release-session
  context-snapshot equivalence gate per (A).

If the working-tree diffs at apply time already contain the fix, this
change reduces to a spec / verify-only formalization. If they don't,
this change is the implementation.

## Impact

- Affected capabilities: `runtime-engine-adapter`, `task-tool-intent`,
  `runtime-live-verification-gates`. Possibly
  `personnel-runtime-engine-binding` if SDK-lane gating moves there.
- Affected code (best-guess targets — implementer reads diffs first):
  `apps/web/src/runtime/{BootstrapProvider,OffisimRuntimeProvider}.tsx`,
  `apps/web/src/lib/{tauri-runtime,browser-runtime}.ts`,
  `packages/core/src/runtime/runtime-context.ts`,
  `packages/core/src/tools/builtin/{index,types}.ts`,
  `packages/core/src/agents/{manager,pm-planner}/*`,
  `packages/core/src/agents/task-tool-intent.ts`,
  `packages/core/src/runtime/runtime-engine-adapter.ts`.
- Migration: none.
- Live verify required on release `.app`.

## Out of Scope

- Re-architecting the SDK lanes themselves (claude-agent-sdk /
  codex-agent-sdk / openai-agents-sdk). Their existing 1.0 lane
  boundary stays.
- Designing a new tool-kit registration system. The existing
  per-employee tool-kit assembly stays; this change only pins
  invariants on its outputs.
- Backlog #2's specific repro evidence reconstruction. The prior
  `.live-verify/runtime-context-and-tool-routing/` evidence directory
  was deleted in commit `58c5da57` (repo hygiene pass); fresh repro
  at apply time is in scope, recovering the deleted screenshots is
  not.
- Backlog #3 (`add-skills-self-authoring` live verify). That is a
  separately proposed change with non-overlapping scope.
- This change overlaps with `fix-workspace-binding-and-employee-context-mismatch`.
  The two are proposed separately on the user's instruction. The
  implementer SHOULD evaluate merging at apply time if root cause is
  shared, OR commit to running them in strict sequence with the
  smaller-scope one first.
