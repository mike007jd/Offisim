# fix-active-count-truth — verification log

Live runtime: `pnpm --filter @offisim/web dev` (port 5176), Chrome DevTools MCP,
MiniMax-M2.7-highspeed (`.env.local`), default company, 8 employees.

Date: 2026-04-17

## Phase 1 — pre-fix audit (current divergence pattern)

Captured state at every observable phase of two consecutive multi-employee
runs (3-file dispatch, then haiku):

| Phase | Footer | 3D overlay | Aligned? |
|---|---|---|---|
| Baseline | 0/8 | 0 | ✅ |
| ANALYZING (boss) | 0/8 | 0 | ✅ |
| EXECUTING (1 in run, 1 in flight) | 1/8 | 1 | ✅ |
| REPORTING / DELIVERING | 0/8 | 0 | ✅ |
| Second run, baseline | 0/8 | 0 | ✅ |
| Second run, EXECUTING | 1/8 | 1 | ✅ |

**Findings:**

- In this audit both counters always agreed because (a) both are seeded from
  the same `bootstrapState.reposSnapshot.employees`, (b) both react to the
  same `employee.state.*` events, and (c) both apply the same `!== 'idle'`
  predicate. The proposal-anticipated divergence window (run-start re-idle
  asymmetry) did not materialise because the previous run cleared employees
  back to idle naturally before the next run kicked off.
- No `EmployeeState` contract violation: every employee that animated in the
  scene held a non-idle state. Sophie/Zara momentarily showed `📋 1/1` task
  badges while state still `idle` — that is "dispatched, not yet entered
  executing", which Decision 1's `assigned` set will pick up post-fix.
- **No scope escalation needed.**

Transient local screenshots were captured during the audit and intentionally not retained in the archive.

## Phase 4 — typecheck / build

```
pnpm --filter @offisim/shared-types build  ✅ clean
pnpm --filter @offisim/core build          ✅ clean
pnpm --filter @offisim/ui-office build     ✅ clean
pnpm --filter @offisim/web build           ✅ clean
pnpm typecheck                             ✅ 26/26 green (turbo)
```

## Phase 5 — post-fix live verification (3D mode)

Reloaded page after fix landed; HMR picked up the new shared hook.

| Scenario | Footer | Overlay | Result |
|---|---|---|---|
| 5.2 baseline (no console errors) | 0/8 | 0 | ✅ aligned |
| 5.3 single-employee EXECUTING (`Alex Chen` writing haiku) | 1/8 | 1 | ✅ aligned, `executing` ∈ active set |
| 5.6 run-to-completion → DELIVERING / Ready | 0/8 | 0 | ✅ aligned |
| 5.8 second run EXECUTING after first finished | 1/8 | 1 | ✅ aligned (run-start reset symmetric) |

**Notes:**

- 5.4 (true parallel multi-employee dispatch) only induced once during Phase 1
  pre-fix. Two attempts post-fix saw the Boss self-handle without delegating
  to multiple employees in parallel — model behaviour is non-deterministic in
  this MiniMax-M2.7 session. Single-dispatch case verified; multi-dispatch
  invariant holds by construction since both consumers now share one
  `Map<employeeId, EmployeeState>` rather than maintaining two.
- 5.5 (paused / blocked) not triggered organically. Spec says "if possible".
- 5.7 (company switch) N/A — single default company in this session.

Transient local screenshots were captured during the audit and intentionally not retained in the archive.

## Phase 6 — label decision

KEEP existing strings unchanged. Under the new semantics "1 employees active"
correctly mirrors what the user sees: Alex was actively writing the haiku
when the overlay showed that text. No mismatch observed during live testing.

Per design.md Decision 5 (`No behavior change on display strings`).

## Open follow-ups

- None blocking. The shared hook now owns `total / active / blocked` for the
  active company; consumers stay focused on their own concerns
  (`useDashboardMetrics` for cost / tasks / boss intervention,
  `useOffice3DViewState` for scene drag / flow lines / zone activity).
- `useAgentStates` remains the source of truth for per-employee scene
  rendering (role / task assignment / workstation / subtasks) — no longer
  the source of truth for the displayed *count*. Confirmed unchanged.
