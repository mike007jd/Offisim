# Offisim Prelaunch Clean-Slate Runtime + Dramaturgy Claude Execution Loop

Checked at: 2026-06-23 00:29 NZST.

Source requirement:

- `/Users/haoshengli/.codex/attachments/de07d1e8-fd33-41f9-bc9c-99d6de57397a/pasted-text.txt`

This is the execution handoff for Claude Opus. Treat the source requirement as
product truth, but execute only against the current repository state after
re-reading live code.

## Fixed Audit Premise

Offisim has not launched. Development data can be cleared. Do not preserve old
local data, do not add compatibility readers, do not keep historical data repair
logic, and do not keep migration/backfill code just to support pre-public local
SQLite shapes.

Local developer SQLite can be deleted and rebuilt if needed. Public migration
history starts only after the first public release baseline.

## Non-Negotiable Execution Rule

Each implementation phase must complete this gate before the next phase starts:

```text
inspect live code
-> run GitNexus impact before editing each function/class/method
-> implement phase
-> run phase-local verification
-> run simplify xhigh on the integrated phase diff
-> apply simplification fixes that preserve behavior
-> run codex:review on the simplified phase diff
-> verify every finding against live code/runtime evidence
-> fix confirmed findings
-> rerun impacted tests/builds
-> run GitNexus detect_changes()
-> commit the phase
-> only then start the next phase
```

Do not skip this gate for small changes. Do not defer review fixes to a later
phase. Do not treat codex:review output as automatically true: confirm or reject
each finding with concrete code/runtime evidence.

## Repository Rules To Obey

- Confirm current real-world time before technical freshness judgments.
- Read `AGENTS.md`, `CLAUDE.md`, `Docs/SYSTEM_FRAMEWORK.md`,
  `Docs/HARNESS_ARCHITECTURE.md`, `Docs/DELEGATION_ARCHITECTURE.md`,
  `Docs/UI_FRAMEWORK_STACK.md`, and `Docs/00_start_here/RELEASE_GATES.md`.
- Offisim remains Pi Agent-only. Do not restore Offisim-owned provider/model
  catalogs, Claude Code SDK lane, Codex lane, OpenAI Agents lane, legacy
  Boss/Graph runtime, or runtime provider profiles.
- The desktop product is Tauri-only. Do not add standalone web/browser/launcher
  product work.
- Renderer ownership stays in `apps/desktop/renderer`.
- Do not put animation instructions into Pi prompt/context.
- Do not let GUI scene logic decide agent execution topology.
- Do not let LLMs generate action timelines.
- Before editing a function/class/method, run GitNexus impact analysis for the
  symbol and record direct callers, affected processes, and risk. Warn before
  editing HIGH/CRITICAL risk surfaces.
- Before each commit, run GitNexus `detect_changes()` and confirm the affected
  scope matches the phase.
- Preserve unrelated dirty-tree changes.

## Current Repository Facts From Initial Inspection

Re-check these before editing; they are not a substitute for live inspection.

- Current branch was `main`, tracking `origin/main`, with no dirty files reported.
- Package manager is `pnpm@10.15.1`; Node engine is `>=22.19.0`.
- Core gates live in `package.json`, `scripts/release-gates.mjs`, CI, and
  `Docs/00_start_here/RELEASE_GATES.md`.
- Relevant live paths include:
  - `packages/core/src/services/template-backfill.ts`
  - `packages/core/src/services/company-template-service.ts`
  - `packages/core/src/templates/index.ts`
  - `scripts/harness-template-contract.mts`
  - `packages/shared-types/src/events/agent-run.ts`
  - `packages/shared-types/src/events/agent-run-projection.ts`
  - `scripts/pi-delegation-extension.mjs`
  - `scripts/pi-child-supervisor.mjs`
  - `scripts/tauri-pi-agent-host.entry.mjs`
  - `scripts/pi-agent-host-wire.mjs`
  - `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`
  - `apps/desktop/renderer/src/assistant/runtime/office-dramaturgy.ts`
  - `apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.ts`
  - `packages/shared-types/src/dramaturgy/beat-composer.ts`
  - `packages/shared-types/src/dramaturgy/office-projection.ts`
  - `packages/shared-types/src/dramaturgy/staging.ts`
  - `packages/shared-types/src/dramaturgy/modes.ts`
  - `packages/shared-types/src/dramaturgy/profiles.ts`
  - `packages/shared-types/src/dramaturgy/replay.ts`
  - `apps/desktop/renderer/src/surfaces/office/scene`
  - `packages/db-local/src/schema.sql`
  - `packages/db-local/src/schema.ts`
  - `packages/db-local/src/migrations`
  - `apps/desktop/src-tauri/src/local_db.rs`
- `AgentRunEvent` already defines `workKind`, but the live delegate tool schema
  does not expose it.
- `AgentRunRelation` currently includes `parallel`; the new contract must move
  parallelism to execution mode and keep relation as parent-child semantics.
- `projectEmployeeRunStates()` currently collapses by employee identity but keeps
  only one `threadId` and `attemptId`.
- `office-dramaturgy.ts` only recomputes expiry when new events arrive.
- `runParallel()` currently runs child sessions in the same cwd and returns one
  concatenated summary.
- `PER_CHILD_OUTPUT_CAP` is currently 50 KB.
- `CompanyPerformanceProfile`, optional template employee performance, and replay
  are mostly contract/harness surfaces; keep only fields with real consumers.

## Authority Boundary

Authorized:

- Local code edits, local dev data reset, local test/build/release app build,
  local commits, and local temporary worktrees.
- Removing prelaunch compatibility code and flattening local SQLite baseline.

Not authorized without explicit user approval:

- Push, open/merge PR, deploy, mutate production/shared services, delete remote
  branches, force-push, or delete unknown user work.

If Pi provider auth is unavailable, close every deterministic code gate and
release-app smoke that does not require provider auth, then report provider live
AI verification as blocked. Do not mark the full loop complete if the acceptance
demo requires a real Pi run and no model/auth is available.

## Acceptance Demo

The final product behavior must prove these user-visible truths in the current
release `.app` when Pi auth/model is available:

1. A normal root Pi task with no delegation emits the same neutral `agent.run`
   stream as delegated child work: `run.started`, tool start/completion,
   approval request when applicable, artifacts only when real refs exist, and
   terminal `run.completed`/`run.failed`/`run.cancelled`.
2. Root Plan mode, root tool use, root approval, and root completion drive the
   chat run projection and office dramaturgy through the same event contract as
   child runs.
3. Delegation exposes `workKind`, separates `relation` from `executionMode`, and
   rejects invalid `single`/`parallel` task counts.
4. The same employee appears once even when multiple runs are active, with an
   active-count badge and one dominant performance. Terminal overlays are brief;
   if another run remains active, the employee returns to that active run, not to
   stale completed work.
5. Beat lifetimes expire without needing a future event. Idle employees return to
   home workstation.
6. Parallel read/review delegation is allowed. Parallel write plus anything else
   is rejected with a validation error or explicitly serialized. Do not let two
   write children modify the same cwd concurrently.
7. Child summaries are bounded and structured; full telemetry stays out of the
   root model context.
8. Kept scene/profile/replay code has real consumers. Unused scaffolding is
   deleted rather than described as done.
9. Prefab affordances reserve by beat priority, handle dual workstations, and
   use explicit scale so 2D/3D staging agrees.
10. Reduced motion suppresses relocation and large/continuous animation while
    preserving status, labels, approval, and error information.

## Native Claude Topology

Use Claude Code's native subagents, agent teams, background sessions, worktree
isolation, agent view, and cleanup controls where available.

Do not build a custom fleet controller, scheduler, daemon, lifecycle database,
heartbeat system, or wrapper script to manage Claude agents.

Use high useful concurrency:

- Read-only discovery agents can fan out broadly.
- Writable agents must own disjoint files or run in isolated worktrees.
- If two writers would edit the same unstable shared file, sequence them or
  appoint one owner.
- Freeze shared contracts before implementation fan-out.
- Maker and checker must be separate.
- Consume every worker result, integrate or reject it, then close/archive the
  worker and release temporary worktrees through native controls.

## Discovery Wave

Spawn read-only agents first. Each returns file evidence, risks, and proposed
owned changes. Close agents after consuming results.

1. Clean-slate data/template agent:
   - Inspect template backfill, local SQLite migration chain, template harness,
     exports, activation paths, and empty config usage.
   - Return exact files to delete/update and any schema/test gates affected.

2. Root/child event contract agent:
   - Inspect Pi host event sources, renderer runtime, wire contract, persistence,
     UI approval flow, abort/error classification, and child supervisor events.
   - Return the unified `AgentRunEvent` normalizer contract and required tests.

3. Delegation policy agent:
   - Inspect delegate schema, `runSingle`, `runParallel`, concurrency limits,
     cwd use, output caps, token accounting, and generated host resources.
   - Return the exact `executionMode`, `relation`, `workKind`, write-safety, and
     summary-cap plan.

4. Workload/projection dramaturgy agent:
   - Inspect conversation run projections, office dramaturgy store,
     beat composer, office projection, staging, 2D/3D scene consumers, and badges.
   - Return `EmployeeWorkloadProjection`, dominant-beat, expiry, and home-return
     rules.

5. Scene quality cleanup agent:
   - Inspect prefab affordances, scale, dual workstation anchors, priority
     reservation, reduced motion, profile/replay consumers, and harnesses.
   - Return what to keep/delete and visible verification requirements.

6. Verification/docs agent:
   - Inspect `package.json`, CI, release gates, docs, generated resources, and
     stale references.
   - Return phase-local gates and docs that must change.

Lead synthesizes these findings into one contract before any writable fan-out.

## Frozen Contracts

Freeze these before broad implementation:

### Clean-slate local data

- No legacy template company repair.
- No pre-v2 persona compatibility path.
- No "best effort" activation backfill.
- No empty runtime config placeholder unless a real live consumer requires it.
  Preferred current baseline: null for no employee config.
- Local schema/migration story is public-baseline first, not historical local
  upgrade support.

### Agent run events

Root and child facts normalize into the same `AgentRunEvent` family:

```text
Root Pi events ----+
                  |-> AgentRunEventNormalizer -> one agent.run stream
Child Pi events ---+
```

Required root and child event types:

```text
run.started
tool.started
tool.completed
approval.requested
artifact.created only for real artifact refs
run.completed
run.failed
run.cancelled
```

`AgentRunEvent` is semantic, not visual. It must not contain animation names,
coordinates, room names, prefab ids, or prompt-authored choreography.

### Delegation input

Use current names only; no backward compatibility aliases are required prelaunch.

```ts
type AgentRunRelation = 'delegate' | 'review' | 'handoff';
type DelegateExecutionMode = 'single' | 'parallel';

interface DelegateTaskInput {
  employeeId: string;
  objective: string;
  access: 'read' | 'write' | 'review';
  workKind?: WorkKind;
  relation?: AgentRunRelation;
}

interface DelegateToolInput {
  tasks: DelegateTaskInput[];
  executionMode: DelegateExecutionMode;
}
```

Rules:

- `single` requires exactly one task.
- `parallel` allows one or more tasks.
- Invalid counts return a validation error.
- `parallel` is never a relation.
- Default relation is `review` only when the task is explicitly review-like
  (`relation: 'review'`, `workKind: 'review'`, or `access: 'review'`); otherwise
  default `delegate`.
- `workKind` must flow through delegate params -> supervisor -> wire ->
  `AgentRunEvent` -> persistence/projection -> dramaturgy.

### Parallel write safety

First version policy:

```text
parallel read + read       allowed
parallel read + review     allowed
parallel review + review   allowed
parallel write + anything  reject with validation error
```

Do not implement a worktree scheduler in this loop. When true concurrent write
agents are needed later, add native worktree isolation as a separate feature.

Rename `maxConcurrentChildren` to `maxParallelPerDelegation` because it is a
per-delegate-call cap, not a global run-tree semaphore.

### Child output contract

Hard caps:

- Per child model-visible summary: 4-8 KB target, 8 KB hard cap.
- Combined delegate tool result: 16-24 KB target, 24 KB hard cap.

Structured child return shape:

```ts
interface DelegateChildSummary {
  summary: string;
  artifacts: string[];
  decisions: string[];
  risks: string[];
  verification: string[];
}
```

Full transcript, tool timeline, and usage belong in telemetry/events, not in the
root model context.

### Employee workload projection

Replace one-run-per-employee state with workload aggregation:

```ts
interface EmployeeWorkloadProjection {
  employeeId: string;
  activeRunIds: readonly string[];
  activeCount: number;
  waitingCount: number;
  dominant: {
    runId: string;
    state: 'working' | 'waiting';
    beat: SceneBeat | null;
  } | null;
}
```

Rules:

- Always one visible employee actor per employee.
- `activeCount > 1` shows `x2`, `x3`, etc.
- Dominant performance is deterministic and priority-based.
- Approval/failure may briefly override.
- After a terminal overlay ends, if another run is still active, return to that
  run's performance.
- With no active runs, return to home workstation.

### Beat lifecycle

`SceneBeat` must carry a lifecycle:

```ts
interface SceneBeat {
  startedAt: number;
  endsAt: number;
}
```

Recommended durations:

- Micro action: 2.5-4 s.
- Delegation/review/join: 6-10 s.
- Complete: 3-6 s.
- Failure/approval: until resolved by state, or explicitly ended by a later
  event.

The live store must set a single timer for the next beat expiry. Expiry must
cause recomputation even when no new runtime event arrives.

### Scene affordance and motion

- `workstation-dual` exposes two workstation anchors.
- Anchor offsets and prefab visual scale must be reconciled through explicit
  shared data, not hidden renderer constants.
- Reservation order is:

```text
priority DESC
-> beat time
-> deterministic actorId tie-break
-> nearest suitable anchor
-> deterministic seeded variant
```

- Reduced motion disables walk/relocation, strongly reduces or disables idle
  bob/typing loops, disables celebration jumps and large gestures, and preserves
  status color, labels, approval, and error information.

### Profile and replay cleanup

Delete scaffolding unless there is a real product consumer.

- Delete `CompanyPerformanceProfile`, template employee optional `performance`,
  motif weights, and harness-only profile checks unless they are wired into live
  scene decisions in this loop.
- Keep only a small role-to-tempo utility if `OfficeScene3D` or `BlockCharacter`
  truly uses it.
- Delete `replayDramaturgy` and its harness if there is no persisted semantic
  event log plus replay UI. Do not describe pure-function replay as a completed
  product feature.

## Implementation Waves

### Commit 1 - Remove prelaunch compatibility burden

Scope:

- Delete `packages/core/src/services/template-backfill.ts`.
- Remove `backfillTemplateCompany` exports from core/browser indexes.
- Remove activation-time backfill calls.
- Remove legacy/backfill sections from `scripts/harness-template-contract.mts`.
- Remove all pre-v2/legacy persona compatibility assertions.
- Change template employee config from `'{}'` placeholder to null/no config,
  updating schema/types/repos/harnesses where required.
- Remove `schemaVersion: 2` from template persona if live reader/editor does not
  need it. If a live consumer still needs a version field, keep it only as the
  current baseline marker with no compatibility behavior.
- Flatten local SQLite into one public baseline if migrations are only preserving
  prelaunch local data:
  - update `packages/db-local/src/schema.sql`
  - update `packages/db-local/src/schema.ts`
  - update `packages/db-local/src/migrations`
  - update `apps/desktop/src-tauri/src/local_db.rs`
  - update migration docs/tests
- Delete the empty `limits.maxDepth` file if it is still present.
- Update docs that claimed old backfill/migration support is current behavior.

Acceptance:

- No source file imports or exports `template-backfill`.
- No template harness creates synthetic legacy company/persona repair.
- Fresh template materialization still creates truthful employees, personas,
  zones, prefabs, and home workstations.
- Local DB baseline opens cleanly; no prelaunch upgrade path is required.
- `TEMPLATE_EMPLOYEE_CONFIG_JSON = '{}'` no longer exists unless a real current
  consumer forced a renamed/current-baseline replacement.

Phase gates:

- `pnpm harness:template-contract`
- `pnpm validate`
- `cargo test --locked` in `apps/desktop/src-tauri` if local DB/Rust changes
- `git diff --check`
- simplify/review/fix/detect_changes/commit

### Commit 2 - Unify root and child AgentRunEvent

Scope:

- Add or extract an `AgentRunEventNormalizer` around root Pi host events and child
  `agentRun` wire events.
- Emit root `run.started` for every user run, not only when delegation roster is
  non-empty.
- Emit root `tool.started` and `tool.completed` into `agent.run` as well as the
  existing tool telemetry.
- Emit root `approval.requested` when Ask mode UI prompt is sent.
- Emit `artifact.created` only when the event has a real artifact ref. Do not
  fabricate artifact events from arbitrary text.
- Emit root `run.completed`, `run.failed`, and `run.cancelled`.
- Classify user abort as `cancelled`, not `failed`.
- Persist root and child lifecycle through the same event contract where the DB
  schema supports it.
- Change `AgentRunRelation` to `delegate | review | handoff`.
- Introduce `DelegateExecutionMode` / `executionMode`.
- Add `workKind` and `relation` to the TypeBox delegate schema.
- Remove `mode` compatibility if present; prelaunch means no alias is required.
- Stamp `workKind`, `relation`, and `executionMode` through supervisor -> wire ->
  renderer -> projection -> persistence -> dramaturgy.
- Update wire-contract fixture, Rust event type if needed, and generated host
  resources via the repo's existing build script.

Acceptance:

- A root-only fixture stream reconstructs run tree, employee state, activity,
  approval, artifacts, and terminal status from `AgentRunEvent`.
- A child fixture stream uses the exact same reconstruction path.
- No event uses `relation: 'parallel'`.
- Invalid `single` with more than one task fails validation.
- Invalid empty task list fails validation.
- `parallel` with any number of non-write tasks is explicit and honest.
- Root abort becomes `run.cancelled`.

Phase gates:

- `pnpm harness:agent-run-projection`
- `pnpm check:pi-wire-contract`
- `pnpm harness:pi-agent-host`
- `pnpm harness:conversation-run-controller`
- `pnpm build:pi-agent-host`
- `pnpm validate`
- `cargo test --locked` in `apps/desktop/src-tauri` if Rust wire changes
- `git diff --check`
- simplify/review/fix/detect_changes/commit

### Commit 3 - Aggregate multiple runs per employee

Scope:

- Replace `projectEmployeeRunStates()` with `projectEmployeeWorkloads()` or an
  equivalent name.
- Return `activeRunIds`, `activeCount`, `waitingCount`, and deterministic
  `dominant`.
- Update `conversation-run-react.ts` and all renderer consumers.
- Update office scene actor state so one employee never duplicates when multiple
  runs are active.
- Add visible active-count badge for `activeCount > 1` in the office surface.
- Use the same workload truth for chat side run tree/detail and office actor
  lighting; do not fork incompatible projections.
- Add fixtures for same employee running multiple child/root tasks, mixed
  waiting/working, and terminal overlay fallback.

Acceptance:

- Same employee with three active runs appears once with `activeCount = 3`.
- Waiting count is represented without downgrading active working state.
- A terminal beat for run B does not permanently override still-running run A.
- When all runs end, the employee returns to home workstation.
- Chat detail can still show all runs individually.

Phase gates:

- `pnpm harness:conversation-run-controller`
- `pnpm harness:office-projection`
- `pnpm harness:beat-composer`
- renderer typecheck/build:
  - `pnpm --filter @offisim/desktop-renderer typecheck`
  - `pnpm --filter @offisim/desktop-renderer build`
- `pnpm validate`
- release `.app` build and desktop smoke if visible UI changed
- `git diff --check`
- simplify/review/fix/detect_changes/commit

### Commit 4 - Fix dramaturgy runtime quality and remove dead scaffolding

Scope:

- Add `startedAt`/`endsAt` to `SceneBeat` and all harness fixtures.
- Add live expiry scheduling in `office-dramaturgy.ts`.
- Ensure expired beat recomputation happens without new events.
- After expiry, recompute from active workloads; with none, home workstation.
- Enforce parallel write safety in delegate validation/supervisor.
- Rename `maxConcurrentChildren` to `maxParallelPerDelegation` across source,
  docs, harnesses, and generated resource outputs.
- Reduce per-child and combined delegate tool result caps.
- Return structured child summaries.
- Keep full telemetry out of root model context.
- Fix `workstation-dual` to expose two workstation anchors.
- Add explicit scale to shared staging/prefab placement or otherwise remove
  hidden renderer-scale drift between visual model and world anchor.
- Change anchor reservation to priority/time/actorId/nearest deterministic order.
- Finish reduced-motion behavior for relocation, bobbing, typing, celebration,
  and large gestures.
- Delete profile/replay scaffolding without real product consumers, or wire the
  kept subset into actual renderer decisions and evidence. Preferred route:
  delete unused company-level profiles and replay module; keep only role tempo
  if currently consumed.
- Update `package.json` validate script when harnesses are deleted or renamed.
- Update `Docs/DELEGATION_ARCHITECTURE.md`, `Docs/SYSTEM_FRAMEWORK.md`,
  `Docs/FEATURES.md`, and `Docs/CODEBASE_MAP.md` when their current truth
  changes.

Acceptance:

- Beat expiry tests pass without injecting a later event.
- Parallel write fan-out is impossible in one shared cwd.
- Child tool result cannot exceed combined model-visible cap.
- Scene staging reserves high-priority actors first.
- Dual workstation can seat two independent workstation actors.
- 2D and 3D agree on staged target after scale handling.
- Reduced motion visibly suppresses continuous/large motion while preserving
  state and labels.
- No exported profile/replay API remains if it has no real consumer.

Phase gates:

- `pnpm harness:beat-composer`
- `pnpm harness:scene-staging`
- `pnpm harness:office-projection`
- `pnpm harness:dramaturgy-modes` if retained; otherwise validate script updated
- `pnpm harness:dramaturgy-replay` only if replay is retained and product-backed
- `pnpm build:pi-agent-host`
- renderer typecheck/build:
  - `pnpm --filter @offisim/desktop-renderer typecheck`
  - `pnpm --filter @offisim/desktop-renderer build`
- `pnpm validate`
- release `.app` build and desktop smoke
- `git diff --check`
- simplify/review/fix/detect_changes/commit

## Final Verification Matrix

Run on the final integrated revision, not only inside worker worktrees:

```bash
git status --short --branch
git diff --check
pnpm lint
pnpm validate
pnpm security:harness
pnpm audit --prod --audit-level high
pnpm build:pi-agent-host
pnpm --filter @offisim/desktop-renderer typecheck
pnpm --filter @offisim/desktop-renderer build
(cd apps/desktop/src-tauri && cargo test --locked)
pnpm --filter @offisim/desktop build
pnpm build
```

If release-bound, also run:

```bash
pnpm release:run
```

Then launch the exact release app from the current worktree:

```text
apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
```

Use Computer Use, not browser/localhost, for final desktop interaction. Attach to
the exact release app window, capture screenshots, exercise the relevant chat and
office scene flows, and record the app path plus bundle hash/evidence. Do not use
`open -b com.offisim.desktop` because bundle ids collide across worktrees.

## Review Lanes

After every phase, assign fresh reviewers:

- Contract reviewer: event shapes, workKind/relation/executionMode, persistence.
- Runtime safety reviewer: abort/cancel, concurrency, output caps, cwd safety.
- UX/scene reviewer: one actor per employee, badge, beat expiry, reduced motion.
- Cleanup reviewer: deleted compatibility paths, no stale docs/harness exports.
- Gate reviewer: validates that the exact phase gates ran on integration head.

Reviewer output must be `pass`, `needs-fix`, or `blocked` with file paths and
evidence. Confirm every `needs-fix` before changing code.

## Stop And Escalation Rules

Do not stop for reversible naming/layout/implementation choices. Pick the path
that best matches the contracts above and continue.

Stop only when:

- Pi SDK behavior contradicts the assumed event/control surface and no local
  workaround preserves the architecture.
- A required live provider/model is unavailable for final acceptance.
- GitNexus reports HIGH/CRITICAL risk and the change cannot be reduced.
- Branch protection or remote policy blocks an explicitly requested merge/push.
- A decision would affect production/shared services or spend money.

## Cleanup Definition

Before final report:

- Close/archive all Claude subagents, teams, and background sessions used for the
  run.
- Release temporary native worktrees only after accepted work is committed or
  safely handed off.
- Stop temporary servers/processes.
- Remove run-created debug logs, scratch fixtures, generated debris, and stale
  unused dependencies/imports.
- Preserve unknown user changes.
- Confirm final `git status --short --branch`.

## Completion Report Required From Claude

At the end of every phase, report only:

- phase commit;
- concrete acceptance evidence;
- `simplify xhigh` result;
- `codex:review` result and how findings were resolved;
- gates run;
- GitNexus impact/detect_changes summary;
- remaining blockers, if any.

At final completion, report:

- final revision;
- acceptance evidence across all phases;
- release `.app` verification evidence;
- whether provider-backed live Pi acceptance passed or was externally blocked;
- GitNexus `detect_changes()` scope confirmation;
- cleanup confirmation for agents, worktrees, branches, temporary files, and
  runtime resources.
