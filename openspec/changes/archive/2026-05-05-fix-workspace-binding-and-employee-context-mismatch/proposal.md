# Change: Fix Workspace Binding And Employee Context Mismatch

## Why

Two release-session regressions surfaced in 2026-05-01 reverify (recorded
in `MEMORY.md` Active Backlog #2). Both contradict shipped invariants in
already-archived capabilities — the spec is correct, the runtime is
drifting, so this change is regression containment, not new capability
design.

**Sub-bug (a) — release tool lane reports "no project workspace root is bound"**

`project-workspace-binding` (archive 2026-04-26 commit `6c10a82d`) already
holds the invariant *"Active project's `workspace_root` SHALL reach the
desktop builtin tool sandbox"*. The G1 wiring (Tauri dialog plugin +
`projects.workspace_root` column + `ProjectCreateDialog` + `pickWorkspaceFolder`
SSOT + builtin sandbox `read_file` / `write_file` / `bash` honoring
workspace_root) is all in code. Yet a release session whose active
project has a populated `workspace_root` still hits the
`'no project workspace root is bound'` guard when an employee's tool lane
calls a builtin. Either:

- The active project's `workspace_root` is not attached to the runtime
  context at session-start (BootstrapProvider / OffisimRuntimeProvider
  layer), or
- The builtin sandbox reads from a stale `runtime-context` snapshot that
  predates the active-project switch, or
- The release lane resolves `runtime-context` via a different code path
  than the dev / web lane and never sees `workspace_root`.

Root cause is unknown — see Out of Scope for diagnostics requirement.

**Sub-bug (b) — Boss in team chat denies an employee that the personnel list shows**

`employee-node-boundaries` already holds *"Boss system prompt SHALL
include the active company's employee roster"* and *"Boss employee-context
regressions SHALL emit an observable runtime event"*. Yet in a release
session where the left personnel rail clearly lists `Alex Chen` for the
active company, the team-chat Boss responds with phrasing equivalent to
"no employee database access" or "I cannot see that employee". So either:

- The boss-prompt employee roster is being assembled with a stale or
  empty company snapshot in team-chat path (vs. direct-chat path where
  the same employee is reachable), or
- The roster is assembled correctly but the boss prompt template no
  longer interpolates it on the team-chat branch, or
- The active-company resolver returns a different company id for
  team-chat than the rail, so the rosters genuinely diverge.

The contradiction with the personnel rail is the loud signal; the user
experience is "the system contradicts itself across surfaces", which
violates *"同一功能的多块表面必须讲同一个故事"* in `CLAUDE.md`.

## What Changes

This change is a fix bundle, not a new capability. It MAY end up touching:

- `apps/web/src/runtime/{BootstrapProvider,OffisimRuntimeProvider}.tsx` —
  active-project workspace_root attach to runtime context.
- `apps/web/src/lib/{tauri-runtime,browser-runtime,browser-runtime-storage}.ts` —
  release-session runtime context plumbing.
- `packages/core/src/runtime/runtime-context.ts` — workspace_root accessor
  surface for the gateway tool sandbox lane.
- `packages/core/src/tools/builtin/{index,types}.ts` — guard message,
  precondition order.
- `packages/core/src/agents/*` — boss-prompt employee roster assembly on
  the team-chat path (and direct-chat parity check).

Spec deltas:

- `project-workspace-binding` MODIFIED — add a regression scenario that
  pins the contract to the release session lane (not just the desktop
  builtin sandbox unit invariant), AND add a scenario that ties the
  observable runtime event ("Workspace-binding gaps SHALL emit ...")
  to *this exact failure mode* so future regressions trip the same
  signal.
- `employee-node-boundaries` MODIFIED — add a scenario specifically for
  team-chat Boss vs. personnel rail parity.

## Impact

- Affected capabilities: `project-workspace-binding`,
  `employee-node-boundaries`. Both MODIFIED with regression scenarios.
- Affected code: see What Changes (exact files determined during apply).
- Migration: none — single-baseline schema unchanged.
- Live verify required on release `.app` (per CLAUDE.md product closure
  bar, builtin tool lane is the canonical evidence path).

## Out of Scope

- Re-architecting how `runtime-context` is propagated to the gateway
  builtin lane. If root cause is "release session has its own context
  resolver", scope expands; this change just fixes the regression.
- Diagnostic instrumentation: an export-friendly diagnostic that surfaces
  WHICH layer dropped `workspace_root` (BootstrapProvider attach? runtime
  resolver read? sandbox precondition?) is in scope for this change.
  User-facing telemetry plumbing is not.
- The 2026-05-01 verify-only `.live-verify/runtime-context-and-tool-routing/`
  evidence directory was deleted in commit `58c5da57` (repo hygiene
  pass). If apply needs a fresh repro, capture new evidence at apply
  time.
- This change overlaps with `close-runtime-binding-and-routing-debt`
  (Backlog #4). The two are proposed separately on the user's
  instruction; the implementer SHOULD evaluate merging them at apply
  time if root cause is shared.
