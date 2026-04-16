## Why

Scene UI has two independent "employees active" counters — the 3D HTML overlay
(`office3d-sections.tsx:259` = `{activeCount} employees active`) and the global
StatusBar footer (`StatusBar.tsx:141` = `{active}/{total} employees`). Both hooks
(`useOffice3DViewState` and `useDashboardMetrics`) compute "active" independently as
`employeeState !== 'idle'`, driven by the same `employee.state.*` events, but with
different reset semantics (only `useDashboardMetrics` re-idles employees on
`isRunning` transitions). This causes two failure modes that directly break the
product's "过程即价值" trust bar:

1. **Definition divergence from scene truth** — The `EmployeeState` enum has 12
   values (`idle / assigned / thinking / searching / executing / meeting / blocked /
   waiting / reporting / success / failed / paused`). The blanket `!== 'idle'` rule
   counts terminal states (`success`, `failed`), user-paused employees (`paused`),
   and employees that are assigned-but-not-yet-moving as "active," even when the
   scene visually shows them standing still. Users see a number that disagrees with
   what the scene shows.
2. **Reset symmetry drift** — When a new run starts, `useDashboardMetrics` forcibly
   re-idles every employee in its local ref, while `useOffice3DViewState` keeps
   the previous run's states until new `employee.state.*` events arrive. The two
   counters can show different numbers during the first ~1s of each run.

Scene activity (moving handles, speaking bubbles, ceremony-phase participation)
is layered on top of `EmployeeState` but not all of it is represented in that
field. Any counter claiming "N employees active" must reconcile the numeric
surface with the scene's visual truth, or the product direction (players must be
able to see / understand / intervene in what the system does) collapses.

## What Changes

- Introduce a shared `useActiveEmployeeCount()` selector (single source of
  truth) derived from a named `isEmployeeActive(state: EmployeeState)` predicate.
- Lock the active-state set to **working** states only: `assigned / thinking /
  searching / executing / meeting / reporting / waiting`. Exclude `idle /
  blocked / failed / success / paused` (each has a clearer dedicated display
  when relevant — e.g., `blockedCount` already shown separately in 3D overlay).
- Replace the two independent counters in `useOffice3DViewState.ts:153` and
  `useDashboardMetrics.ts:330-342, 357-363` with the shared selector; both
  footer and 3D overlay show the same number.
- Unify reset symmetry: the shared selector's internal state is reset
  consistently on `activeCompanyId` change and on `isRunning → true` transitions
  — no divergence between what the footer and the 3D overlay see.
- Live verify via Chrome DevTools MCP: run a real multi-step task on the web
  runtime, pause mid-task, single-step employees through ceremony phases, and
  assert footer count == 3D overlay count == visible scene employee count at
  every observed frame (within the subscription turn).

Not in scope (defer):
- Changing the `EmployeeState` enum itself or its transition rules (core event
  contract; any such change would cascade into employee-node / scene
  orchestrator and is not needed to fix the display).
- Layering `moving` / `speaking` / ceremony phase into the count (scene visual
  richness lives in handles + bubbles + ceremony state; the numeric counter
  targets `EmployeeState` only).

## Capabilities

### New Capabilities
- `scene-activity-display`: Defines the contract between `EmployeeState` and
  the numeric counters that claim to represent "employees active" in the
  scene. Covers the shared selector, the active-state set definition, reset
  symmetry between run lifecycle and company switch, and the
  footer↔overlay consistency invariant.

### Modified Capabilities
(none — `useDashboardMetrics` / `useOffice3DViewState` internals are not
currently captured by any canonical spec; this change introduces the first
spec for that surface.)

## Impact

- **UI**: `packages/ui-office/src/hooks/useDashboardMetrics.ts` (drop local
  active-count computation; consume shared selector), `packages/ui-office/src/
  components/scene/useOffice3DViewState.ts` (same), new `packages/ui-office/
  src/runtime/use-active-employee-count.ts` (shared selector + predicate).
- **No core / shared-types changes** — `EmployeeState` enum stays, event
  contract stays, employee-node / graph / scene-orchestrator untouched.
- **No DB changes** — count is a pure UI derivation.
- **Live verification target**: web runtime (Vite dev on 5176) with MiniMax
  provider — real multi-employee task. Tauri desktop verification deferred
  (non-blocking, same UI code path).
