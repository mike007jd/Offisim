## Why

E1 (`sop-builder-canvas-rebuild`) explicitly carved runtime visualization, missing-role warnings, and run lifecycle feedback to E2. Today the SOP workspace can author and dispatch a SOP, but once `Run` is clicked the surface tells the user almost nothing: the per-node `status` dot is wired but `PlanStep` only emits `'pending' | 'active' | 'completed'` (`'failed'` is a dead path in the type union — `useSopRuntimeState` advertises it but the store can never produce it), there is no progress indicator showing _which_ step is running or _how far_ the run is, missing roles surface only as a one-shot toast that disappears the moment the user looks away, and a failed task leaves no visible trace on the SOP graph. The user cannot watch the SOP run as a workflow — they have to leave for chat / Tasks / Activity feed to see what happened, contradicting the "process is the value" product axiom.

## What Changes

- **Wire `'failed'` step status end-to-end** — Derive step-level failure from task-level `failed`/`cancelled` events in `PlanStepStoreProvider` (current store keeps `'pending' | 'active' | 'completed'`). When all non-pending tasks in a step are failed/cancelled and the step is not active, the step status becomes `'failed'`. `useSopRuntimeState` then surfaces real `'failed'` to consumers; `SopDagNode` `STATUS_DOT` and `SopDagEdge` `STROKE_CONFIG` already cover `'failed'` color but were unreachable.
- **Run progress strip** — Add a thin status row above `SopDagCanvas` (still inside the same center column, between `SopLibraryBar` and the canvas) that renders only when a run is active or has just finished: current step label, `step N of M` counter, completed / failed counts, and an `isRunning` pulse. Clears 3 seconds after `isRunning` flips false (mirroring `useSopRuntimeState`'s auto-clear contract).
- **Failure reason surface** — When a step is `'failed'`, the node body shows a `failed` chip in red beside the role badge; `SopInspectorPanel` adds a "Last error" section that shows the `taskType` / `description` of the most recent failed task on that step. No new event type — read from existing `PlanStep.tasks[]`.
- **Persistent missing-role warning on the graph** — Compute missing-role set continuously from `useEmployees(companyId)` against `definition.steps[].role_slug` (not only inside `handleRun`). Each affected node shows a `⚠ no <role>` chip; the inspector shows a "Role gap" row when the selected step's role is unfilled. The existing one-shot Run toast is removed in favor of this persistent surface.
- **Edge "flow" remains wired through existing visual** — `SopDagEdge` already animates only on `'active'`; this change confirms the visual contract (active edges flow, completed edges go solid emerald, failed edges go red) and extends it: an edge whose **upstream** step is `'failed'` SHALL stop animating regardless of the downstream step's status (downstream is unreachable).
- **Dispatch path unchanged** — `Run` still calls `sendMessage(formatRunCommand(...))` through the existing PM planner / Boss / dispatcher pipeline. **No new event types, no new repo method, no new schema column, no new table.** `useSopRuntimeState` remains the single read path; `PlanStepStoreProvider` remains the single subscriber.

## Capabilities

### New Capabilities
- `sop-run-surface`: Visualization contract for an in-flight or just-finished SOP run inside the SOP workspace — node status (incl. `'failed'`) + edge flow + run progress strip + failure reason surface + persistent missing-role warning. Does **not** introduce a new dispatch path; reads from `usePlanStepStore` / `useSopRuntimeState`.

### Modified Capabilities
- `plan-step-store`: Extend `PlanStep.status` union to include `'failed'`, with a derivation rule from task-level failure (existing event handlers, no new events). Existing requirements unchanged; one new requirement covers step-level failure derivation.
- `sop-builder-canvas`: Spec already carves runtime visualization to `sop-run-surface`. No requirement-level change. The carve-out scenario currently lists `'failed'` as an existing color mapping — once `sop-run-surface` lands, that scenario is satisfied for real (today it is satisfied vacuously). No spec edit required, only a cross-reference noted in design.md.

## Impact

- **Code (ui-office)**:
  - `packages/ui-office/src/hooks/plan-step-store.tsx` — extend `PlanStep.status` union; derive `'failed'` in `task.state.changed` handler when all non-pending tasks of a step are terminal-failed.
  - `packages/ui-office/src/components/sop/SopDagNode.tsx` — add `failed` chip; add missing-role warning chip.
  - `packages/ui-office/src/components/sop/SopInspectorPanel.tsx` — add "Last error" section + "Role gap" warning row.
  - `packages/ui-office/src/components/sop/SopViewSurface.tsx` — host the new run progress strip; replace one-shot `handleRun` toast with persistent missing-role surface input.
  - **NEW** `packages/ui-office/src/components/sop/SopRunProgressStrip.tsx` — small presentational component reading `usePlanStepStore` + `definition.steps[].label`.
- **Code (shared-types)**: `PlanStep` / `PlanStepCompletedPayload` etc. — type union widening for `status` to include `'failed'` (already in `SopRuntimeStepState`, unify with `PlanStep`).
- **No core / db / repo / event-bus surface changes.** Dispatch path, repo schema, event names, and persistence shape are unchanged.
- **Validation**: live agent run of a SOP with at least one role gap (employee missing for that role) and at least one task forced to fail (Boss dispatch retry exhausted), confirming visual surface covers all four step states + missing-role warning + run progress strip clearing 3s after completion.
