## Context

Two independent React hooks each maintain their own map of
`employeeId → EmployeeState` and each computes an "active" count off of that
map. They subscribe to the same `employee.state.*` prefix on the runtime event
bus and to the same `employee.created` / `employee.deleted` lifecycle events,
but do not share state and do not share reset rules.

Current behavior, audited 2026-04-17:

- `packages/ui-office/src/hooks/useDashboardMetrics.ts:357-363` — Counts
  `state !== 'idle'` across `employeeStatesRef` (internal `Map<employeeId,
  EmployeeState>`). Feeds the **StatusBar footer** via
  `metrics.employeeUtilization.active / total`. Has two reset paths:
  - `isRunning → true` (line 172-217): reassigns every known employee's state
    back to `'idle'` without clearing the map (preserves roster).
  - `activeCompanyId` change (line 223-239): clears the map and re-seeds
    `total` from `bootstrapEmployeeCount`.
- `packages/ui-office/src/components/scene/useOffice3DViewState.ts:153-162`
  — Counts `agent.state !== 'idle'` across the `agents: Map<employeeId,
  AgentState>` returned by `useAgentStates()`. Feeds the **3D HTML overlay**
  via `activeCount` prop threaded through `Office3DView` → `SceneInfoOverlay`.
- `packages/ui-office/src/runtime/use-agent-states.ts:80-253` — The underlying
  agent-state map `useOffice3DViewState` derives `activeCount` from.
  Does **not** reset to idle on `isRunning → true`; only resets on company
  change (line 87-102). States persist across task runs.

The `EmployeeState` enum (`packages/shared-types/src/states.ts:2-14`) has 12
values. Using `!== 'idle'` as the "active" predicate sweeps in terminal states
(`success`, `failed`), user-controlled pauses (`paused`), and assigned-but-not-
moving (`assigned`). Users see employees standing still while the counter
claims they are "active."

## Goals / Non-Goals

**Goals:**

- One shared predicate `isEmployeeActive(state)` that defines "active" in a
  single place, reviewed against SCENE_STATE_MATRIX semantics.
- One shared React hook `useActiveEmployeeCount(companyId)` that both
  consumers subscribe to, so footer number ≡ 3D overlay number at every
  observed frame.
- Reset symmetry: both consumers see the same count through run-start
  transitions and company switches, with no divergence window.
- Exclude terminal and non-working states from the count so the displayed
  number matches what a user would intuitively call "in use right now."

**Non-Goals:**

- Changing `EmployeeState` values or transition rules. The enum is the
  runtime event contract; changing it is a separate, higher-risk effort.
- Reconciling the count with `moving` handles, speaking bubbles, or ceremony
  phase. Those are scene visual richness layered on top of `EmployeeState`
  — they animate the employee differently but don't change what "this
  employee is currently doing work" means at the data layer. If the live
  audit during apply shows that `EmployeeState` itself fails to reflect
  work (e.g., employee is visually moving but `state === 'idle'`), **pause
  and escalate**; fixing the enum is out of scope for this change.
- Changing the `blockedCount` display in the 3D overlay. The
  `blocked / failed` counter is intentionally separate and user-meaningful;
  keep it as-is.
- Tauri live verification. Same UI code path runs in both web and desktop;
  verifying on web is sufficient evidence for this change. Desktop may be
  verified opportunistically.

## Decisions

### Decision 1: Active-state set = working states, not `!== 'idle'`

Locked set: `assigned / thinking / searching / executing / meeting / reporting
/ waiting`.

Excluded, with rationale:
- `idle` — explicitly not active.
- `blocked` / `failed` — terminal-ish; surfaced by the separate
  `blockedCount` display which stays as-is. Double-counting here would
  confuse "blocked" with "working."
- `success` — a brief transition state before returning to idle. Including
  it inflates the count by 1 for the duration of the transition, which is
  exactly the kind of "ghost active" that breaks the trust bar.
- `paused` — user has deliberately stopped this employee. Counting as
  active contradicts the user's own action.

**Alternative considered**: include `blocked` but double-surface it. Rejected
— users already see a distinct amber "N employees blocked" line; adding
`blocked` to the main count means blocked employees show up in two places
with the same weight, which is double-counting, not richer signal.

**`assigned` inclusion rationale**: between the `assigned` and `thinking`
states, the employee has been handed work but may not have started processing.
Include — users should see the number tick up the moment an employee is
assigned, not wait for thinking to start. This matches scene behavior:
dispatch animation plays on assignment, not on thinking.

**`waiting` inclusion rationale**: employee is actively waiting on an external
dependency or human input; it is not idle, the system is mid-task. Count as
active.

### Decision 2: Shared hook `useActiveEmployeeCount()` over selector function

A React hook that internally owns the `Map<employeeId, EmployeeState>`, so both
consumers subscribe to exactly one state store. Alternative: a
`computeActiveCount(states, predicate)` pure function that each consumer calls
with their own state map. Rejected — that keeps two maps, two reset paths, two
event subscriptions. The whole point is one source of truth.

**Shape:**

```ts
// packages/ui-office/src/runtime/use-active-employee-count.ts
export interface ActiveEmployeeCount {
  active: number;
  total: number;
  blocked: number;
}

export function isEmployeeActive(state: EmployeeState): boolean { /* locked set */ }
export function isEmployeeBlocked(state: EmployeeState): boolean { /* 'blocked' | 'failed' */ }

export function useActiveEmployeeCount(): ActiveEmployeeCount;
```

Internally: subscribes to `employee.state.` / `employee.created` /
`employee.deleted` on `useOffisimRuntime().eventBus`, owns a
`Map<employeeId, EmployeeState>` via `useRef`, and publishes a derived
`{ active, total, blocked }` object via `useState`.

Both `useDashboardMetrics` and `useOffice3DViewState` call this hook and stop
maintaining their own employee state map **for the purpose of the counter**.
`useDashboardMetrics` still tracks cost / tasks / tokens internally.
`useOffice3DViewState` still consumes `useAgentStates()` for scene rendering
(which needs per-employee state, task info, workstation, etc.), but reads
the *number* only from the shared hook.

### Decision 3: Reset semantics — run-start symmetry via shared hook

The shared hook's internal map handles resets in one place:

- On `activeCompanyId` change: `.clear()` the map, re-seed `total` from
  `bootstrapEmployeeCount` or `repos.employees.findByCompany(activeCompanyId)`.
- On `isRunning → true`: reassign every known `employeeId` to `'idle'`
  without clearing the map (preserves roster). This matches the current
  `useDashboardMetrics` reset; `useAgentStates` does not do this today. By
  moving the reset into the shared hook, both counters see the same
  transition at the same time.

`useAgentStates` is not touched — it remains the source of truth for scene
rendering data (per-employee role, task assignment, workstation, subtasks).
Its lack of run-start reset continues to be correct for scene rendering
(scene visuals should not flicker to idle between runs). The counter is
where run-start reset matters, and the counter now lives in the shared hook.

### Decision 4: `total` stays the same across both consumers

Both consumers currently compute `total` from the known-employee count
(`employeeStatesRef.size` in `useDashboardMetrics`; `agents.size` in the
3D view). The shared hook returns `total` from its own map, same semantics.
Footer and 3D overlay show the same `total` implicitly.

### Decision 5: No behavior change on display strings

StatusBar keeps `{active}/{total} employees`. 3D overlay keeps
`{activeCount} employees active` and `{blockedCount} employees blocked`.
The displayed numbers change; the labels do not. Apply phase may adjust copy
only if the live audit reveals the label itself is misleading under the new
semantics.

## Risks / Trade-offs

- **[Live audit could reveal `EmployeeState` itself is wrong]** → Mitigation:
  during apply, live-verify on web runtime with a real multi-employee task
  before implementing. If footer count matches the scene but `EmployeeState`
  transitions don't match what the scene shows (e.g., scene shows moving
  employee but state is stuck at `idle`), escalate to the user — this is a
  core event contract bug, not a UI counter bug. Do not widen scope
  silently.
- **[Existing `useDashboardMetrics` behavior has a `bootstrapEmployeeCount`
  seeded `total` before `repos.employees.findByCompany` resolves]** →
  Mitigation: the shared hook must replicate this seeded-then-refined pattern.
  Otherwise `total` briefly shows 0 on cold mount. Pattern is clear in
  current code; carry it over.
- **[Two consumers subscribing to the same event stream via a shared hook
  means more React updates per event, not fewer]** → Mitigation: the shared
  hook publishes `{ active, total, blocked }` as one state object. React
  de-dupes via referential equality. Both consumers re-render on changes,
  same as today — this is not a regression; it's the same behavior with one
  map instead of two.
- **[`isEmployeeActive` predicate may be wrong for edge states we haven't
  enumerated live]** → Mitigation: apply phase live-verifies at least:
  idle → assigned → thinking → executing → reporting → idle (happy path)
  and idle → thinking → blocked → thinking → executing → idle (retry path).
  Unit-testable in isolation (pure function). If live shows a state transition
  we haven't considered, update the predicate and record the decision.
- **[Change touches two high-traffic hooks]** → Mitigation: the two hooks'
  other responsibilities (cost, task, token, workstation, subtask tracking)
  are untouched. Only the employee-state counting subtree moves.

## Migration Plan

Not a migration — no persisted state, no DB schema, no external API contract.
Pure UI refactor + semantic correction.

Rollback: revert the three changed files + delete the new shared hook file.
Behavior returns to pre-change (two independent counts, `!== 'idle'` predicate).
No data to clean up.

## Open Questions

- **Q1**: Does the live audit confirm that both counters today display the
  *same* number most of the time, with divergence only around run-start /
  company-switch? Or do they also diverge during steady-state operation?
  Answer during apply Task 1 (live sampling before implementation).
- **Q2**: Should the label change from "N employees active" to something
  more precise (e.g., "N employees working" or "N employees busy")? Defer
  decision to apply Task 6 — if live testing with the new semantics still
  reads as "these numbers don't match what I see," the label itself may
  need adjustment.
