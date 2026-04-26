## Context

E1 (`sop-builder-canvas-rebuild`, archived 2026-04-26 commits `db01e0f5` / `0ee72325` / `dd2d64f9`) rebuilt the SOP workspace as a four-region builder shell and explicitly carved runtime visualization to E2:

> Runtime status visualization (per-step status pulse, edge flow animation tied to dispatch events, missing-role warnings, run history) is owned by `sop-run-surface` (E2). The Run action SHALL continue to dispatch via the existing `formatRunCommand` → `sendMessage` path with no inline state changes in this capability.

Concrete state of the codebase as we begin E2:

- `useSopRuntimeState(sopTemplateId)` (`packages/ui-office/src/hooks/useSopRuntimeState.ts`) returns `SopRuntimeStepState[] | null` where `status: 'pending' | 'active' | 'completed' | 'failed'`. **`'failed'` is a dead branch** because its source — `PlanStep.status` in `plan-step-store.tsx` — is typed `'pending' | 'active' | 'completed'`.
- `SopDagNode.STATUS_DOT` and `SopDagEdge.STROKE_CONFIG` already declare visuals for `'failed'`.
- `SopInspectorPanel` reads `runtimeState`; `STATUS_LABEL[status]` already covers `'failed'`.
- `handleRun` in `SopViewSurface.tsx` checks `definition.steps[].role_slug` against `repos.employees.findByCompany(activeCompanyId)` once at click time and emits a one-shot toast. The check is not memoized, not displayed on the graph, and disappears the moment the toast auto-dismisses.
- `PlanStepStoreProvider` already subscribes to `task.state.changed`. The store updates per-task `status` (including `failed` / `cancelled`) but does **not** roll terminal-failure up to `PlanStep.status`.
- `SopDagEdge` animates a flowing dot along the bezier path **only when `status === 'active'`**. Completed and failed edges render as static strokes.
- `useAgentStates()` exposes the live employee map (`Map<string, AgentState>` with `role: string` field), already mounted under `CompanyProvider`. It is the SSOT for "who exists at this moment" without hitting `repos.employees`.

Out-of-band but worth noting: `plan-step-store` canonical spec already grants this work the right to extend the store. Requirement #1 ("Single subscriber for plan step state") is preserved by this change — the new derivation runs **inside** the existing `task.state.changed` handler, not via a new subscription.

## Goals / Non-Goals

**Goals:**
- A user clicking `Run` on a SOP can watch the run inside the SOP workspace itself (graph + inspector + a thin status strip), without leaving for chat / Tasks / Activity.
- Step-level failure becomes a real first-class state, not a dead path in the type system.
- Missing-role state is visible **for as long as it is true**, not for the 4 seconds a toast survives.
- Failed steps explain themselves: the user can read the reason in the inspector without inspecting raw logs.
- Zero changes to dispatch path, repo schema, event names, or how runs are persisted. Run still flows through `sendMessage(formatRunCommand(...))` → PM planner → Boss → dispatcher.

**Non-Goals:**
- Run history list / "previous runs of this SOP". The user can already see history via Activity Feed; building a SOP-scoped history requires a new query path or schema column and is out of scope. (Queue lists run history under E2 as a hand-wave but the constraint "no new schema/repo/table" makes it incompatible with this change. Punted to a follow-up if requested.)
- Pause / Resume / Cancel from the SOP surface. Existing dispatch is fire-and-forget; control surface is owned by chat / global runtime.
- Multi-run concurrency. `useSopRuntimeState` is currently scoped to the single in-flight plan whose `sopTemplateId` matches; if the user runs SOP A and then SOP B before A finishes, the store reflects B and A becomes invisible. This was true before and remains true after — out of scope.
- Per-task progress on a node. Task fan-out is read in inspector ("Last error" pulls one failed task) but is not mirrored back onto the node body — the node stays at the step level.
- Replacing the existing edge-active flow animation with something fancier (particle, gradient sweep, etc). Visual polish punted.

## Decisions

### D1. Step-level `'failed'` is **derived** inside `PlanStepStoreProvider`, not added to the wire payload

**Decision:** Compute `step.status === 'failed'` inside the existing `task.state.changed` handler. After applying a task status update, recompute the parent step's status:
- If step is currently `'active'` → leave as `'active'` (an active step can have a failed task and still be retried; "all tasks failed" is a stronger signal).
- Else if any task in the step is `'failed'` or `'cancelled'` AND no task is `'completed'` AND no task is `'running'` / `'queued'` / `'planned'` → set step to `'failed'`.
- Else if the step is `'failed'` and a task transitions back to a non-terminal state → revert to `'pending'`.
- The derivation runs ONLY inside the existing `task.state.changed` and `plan.step.completed` handlers (no new subscription).

**Rationale:** The plan / step / task event protocol on the wire is established and documented; widening `PlanStepCompletedPayload` would touch core dispatcher code, repo writes, and serialization tests. Derivation is local to one consumer file (`plan-step-store.tsx`) and preserves the canonical spec's "single subscriber" rule.

**Alternatives considered:**
- *Emit `plan.step.failed`*: clean event-driven model but requires changes in `pm-planner`/`task-coordinator` core code and a serialization-version bump. Rejected because the queue mandates "执行仍走 PM / Boss / dispatcher，不绕 Offisim runtime"; widening the wire is exactly the kind of "绕 Offisim runtime" the user warned against.
- *Read `'failed'` only at render time inside `useSopRuntimeState`*: keeps the store unchanged but adds a derivation closure to every consumer. Rejected — `plan-step-store` spec already rules that the store is the single source of step state.

### D2. `useSopRuntimeState`'s status union shrinks to match reality, then re-expands cleanly

The hook today declares `'failed'` even though the store can never produce it. After D1, the store can produce it, so the union remains the same — but we update the spec wording and the surface contract together so consumers stop guarding against an unreachable case. No code change to the union itself; the change is "wire that was paint" → "wire that conducts."

### D3. Run progress strip is a presentational component reading `usePlanStepStore`, not a new context

**Decision:** New file `packages/ui-office/src/components/sop/SopRunProgressStrip.tsx`. Reads `usePlanStepStore()` directly. Renders only when `planId !== null` AND `(sopTemplateId === selectedSop.sopTemplateId)` AND (`isRunning` is true OR less than 3 seconds since the run completed). After the 3-second window, the strip unmounts (matches `useSopRuntimeState`'s auto-clear contract).

**Layout:** strip lives between `SopLibraryBar` and the canvas in `SopViewSurface.tsx`. Height 32px; full width of the center column. Content: `<pulse dot> Running step N of M · <currentStep.label> · <completed>/<total> tasks` (when running) or `Run completed · M of M steps` / `Run failed · X of M steps failed` (when just-finished). Failed-step run shows red accent.

**Rationale:** Keeps the strip outside the canvas so it does not steal pan / zoom / drag pointer events. Same viewport budget as `SopLibraryBar` so the canvas does not jump on mount.

**Alternatives considered:**
- *Embed inside `SopDagCanvas`*: pollutes pan / zoom math; adds a non-graph element to the canvas SSOT.
- *Float as a toast*: contradicts the queue's intent ("过程即价值") — this is not a notification, it is a permanent run-status surface.

### D4. Persistent missing-role warning is computed from `useAgentStates`, not from `repos.employees.findByCompany`

**Decision:** In `SopViewSurface`, replace the imperative `repos.employees.findByCompany(activeCompanyId)` inside `handleRun` with a memoized derivation:

```ts
const agents = useAgentStates();
const presentRoleSlugs = useMemo(() => new Set([...agents.values()].map(a => a.role)), [agents]);
const missingRoleSet = useMemo(() => {
  if (!definition) return new Set<string>();
  return new Set(
    definition.steps
      .map(s => s.role_slug)
      .filter(r => r && !presentRoleSlugs.has(r))
  );
}, [definition, presentRoleSlugs]);
```

Pass `missingRoleSet` down to `SopDagCanvas` → `SopDagNode` and to `SopInspectorPanel`. Each node whose `step.role_slug ∈ missingRoleSet` renders a small `⚠ no <role>` chip beside the role badge. Inspector adds a "Role gap" warning row when the selected step's role is missing. The `handleRun` toast is **removed** — the persistent on-graph chip is the new contract, and the user no longer needs a one-shot warning.

**Rationale:** `useAgentStates` is already the live SSOT (subscribes to `employee.created` / `employee.updated` / `employee.deleted`). Imperative repo reads inside `handleRun` were always racy — the user could create an employee, the toast had already disappeared, and "missing role" stayed visually true. Reactive derivation closes the gap.

**Alternatives considered:**
- *Use `repos.employees` query inside a `useEffect`*: adds a debounce + stale-closure surface. Rejected — `useAgentStates` already does this work via event subscription.

### D5. Failure reason surfaces via `inspector → step.tasks[]`, no new event

**Decision:** When a step's `status === 'failed'`, `SopInspectorPanel` shows a "Last error" section. Source: `step.tasks` filtered to `status === 'failed' || status === 'cancelled'`, sorted by latest update (the task list is in event-arrival order, so the last failed task in the array suffices). Render: `taskType` as the heading, `description` as the body. Color: red-300 / red-400 like other inspector failure surfaces.

The node itself does **not** show error text — only the existing `failed` status dot plus a new "failed" chip beside the role badge. Clicking the node opens the inspector, which is already the existing selection contract. This honors "node face = at-a-glance read" (E1's contract) and keeps verbose error text in a single dedicated surface.

### D6. Edge animation respects upstream failure

**Decision:** In `SopDagEdge`, gate the `<animateMotion>` on `status === 'active'` (existing) AND no upstream-failed predicate. The predicate is computed in `SopDagCanvas` once per render via the existing `getEdgeStatus(fromStepId)` helper:

- If `getStatus(fromStepId) === 'failed'`, force the edge `status` prop to `'failed'` so the downstream is visually short-circuited (red, no animation).
- Otherwise pass through the existing `getEdgeStatus(fromStepId)` value.

**Rationale:** A failed upstream means the downstream cannot run. Letting an edge below a failed step keep animating would lie about the run.

### D7. `PlanStepCompletedPayload` is **not** widened

The plan dispatch protocol stays at three step states on the wire. The fourth (`'failed'`) is a UI-derived rollup. If a future change wants `plan.step.failed` to be a real event, that's a separate spec change with core / dispatcher / repo work. Not in this scope.

### D8. `SopRuntimeStepState` type stays where it is

`useSopRuntimeState`'s exported type `SopRuntimeStepState.status` already includes `'failed'`. After D1 it becomes truthful; no type-level change.

## Risks / Trade-offs

- **[Risk] Step-failure derivation oscillation** — A failed task that gets retried and succeeds could cause a step status flicker `pending → failed → pending → completed`. → **Mitigation:** Step is marked `'failed'` ONLY when the step is not `'active'` AND no task is in a non-terminal state. While the dispatcher is retrying, the surviving task lives in `running`/`queued`/`planned` — the rollup correctly stays `'pending'` or `'active'` until the retry resolves.
- **[Risk] Missing-role chip churn during employee onboarding wizard** — when a user is mid-create on an employee, `useAgentStates` may transiently lack the role. → **Mitigation:** Acceptable; the chip disappears the moment `employee.created` fires, which the existing scene handler already processes within one event tick.
- **[Risk] Run progress strip flashes on every run start** — mount/unmount adds 32px to the canvas viewport. → **Mitigation:** Strip is allowed to be layout-influencing (canvas does not need a fixed pixel height); the canvas already responds to its container size via `flex-1`. Verified via a 32px height delta only when running, which is the correct trade-off for "visible progress."
- **[Trade-off] No run history** — user does not get "what ran 10 minutes ago." Activity Feed retains this. Accepted; queue scope was bounded to current-run visualization.
- **[Trade-off] Failure reason is "last failed task description"** — if the dispatcher attached a richer error payload (stack, attempt count), it is not surfaced. → **Mitigation:** Existing event payloads do not carry this richer shape today (`TaskStatePayload` is `{ prev, next, employeeId, ... }`). A richer error event is its own change.
- **[Risk] `handleRun` toast removal silently breaks any test relying on it** — repo has no automated tests, so this is theoretical, but live agents validating the run path may have memorized the toast wording. → **Mitigation:** Persistent on-graph warning is strictly more visible; verify-notes will document the swap.

## Migration Plan

Single live release, no migration. Steps:

1. Widen `PlanStep.status` union in `plan-step-store.tsx`. Compile-time errors at consumer sites flag any consumer that exhaustively switches on the union. (Today the only such sites are `SopDagNode.STATUS_DOT` and `SopInspectorPanel.STATUS_LABEL`, both of which already cover `'failed'` and need no update.)
2. Add the rollup logic inside `PlanStepStoreProvider`.
3. Add `SopRunProgressStrip.tsx` and mount it in `SopViewSurface.tsx`.
4. Add `failed` chip + missing-role chip to `SopDagNode`. Add "Last error" + "Role gap" rows to `SopInspectorPanel`.
5. Wire `missingRoleSet` propagation in `SopViewSurface` → `SopDagCanvas` → `SopDagNode` and `SopInspectorPanel`. Remove the one-shot `addToast(...missing roles...)` from `handleRun`.
6. Add upstream-failed gating in `SopDagCanvas.getEdgeStatus`.
7. Live verify: trigger a real run (`Run` button) on a seeded SOP with a known role gap and a guaranteed-fail task (e.g. point a step at a non-existent skill). Walk the visual surface as the run progresses; capture status transitions.

Rollback: revert the `SopViewSurface` mount of `SopRunProgressStrip` and the chip render branches in `SopDagNode` / `SopInspectorPanel`. The store-side derivation can stay (it does no harm if no consumer reads `'failed'`) or be reverted by reverting the same commit.

## Open Questions

- Should the missing-role chip be a click target that jumps to Personnel for the missing role? Lean **no** for this change (out of scope; cross-surface routing is its own contract). Open for follow-up.
- Should the run progress strip persist once a run completes, or auto-clear? Current decision: auto-clear after 3s (D3) to mirror `useSopRuntimeState`'s contract. If user feedback says "I want to see the last run until I navigate away," we can flip that to "stay until the next run starts or selectedSopId changes." Defer until live verify.
