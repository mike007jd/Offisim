## 1. Step-failure derivation in plan-step-store

- [x] 1.1 Widen `PlanStep.status` type union in `packages/ui-office/src/hooks/plan-step-store.tsx` to `'pending' | 'active' | 'completed' | 'failed'`
- [x] 1.2 Inside the existing `task.state.changed` handler, after applying the per-task update, recompute the parent step's status using the rule from spec (D1): mark `'failed'` only when step is not `'active'` AND no task is in non-terminal state AND no task is `'completed'` AND at least one task is `'failed'` / `'cancelled'`; revert to `'pending'` if a previously `'failed'` step gets a task back to non-terminal
- [x] 1.3 Apply the same rollup inside `plan.step.completed` handler so completion of a non-failed step short-circuits the rollup and a step that completed with mixed terminal outcomes does NOT regress to `'failed'`
- [x] 1.4 Run `pnpm --filter @offisim/ui-office typecheck` and confirm consumer sites compile (`SopDagNode.STATUS_DOT`, `SopInspectorPanel.STATUS_LABEL`, `useTaskDashboard`, `useSopRuntimeState`)

## 2. SopRunProgressStrip component

- [x] 2.1 Create `packages/ui-office/src/components/sop/SopRunProgressStrip.tsx` reading `usePlanStepStore` and accepting `{ definition: SopDefinition; sopTemplateId: string }`
- [x] 2.2 Render only when `planId !== null && store.sopTemplateId === sopTemplateId && (isRunning || withinClearWindow)`; gate `withinClearWindow` on a 3s timer started when `isRunning` flips false (mirror `useSopRuntimeState` clearing contract)
- [x] 2.3 Strip layout: 32px height, full column width, content `<pulse dot> Running step N of M · <currentStep.label> · <completed>/<total> tasks` while running; `Run completed · M of M steps` or `Run failed · X of M steps failed` when just finished; red accent if any step is `'failed'`
- [x] 2.4 Mount the strip in `SopViewSurface.tsx` between `SopLibraryBar` and the canvas/empty-state branch

## 3. Persistent missing-role warning

- [x] 3.1 In `SopViewSurface.tsx`, add `agents = useAgentStates()` and derive `presentRoleSlugs = useMemo(...)` and `missingRoleSet = useMemo(...)` from `definition.steps[].role_slug`
- [x] 3.2 Pass `missingRoleSet` down to `SopDagCanvas` and `SopInspectorPanel`
- [x] 3.3 In `SopDagCanvas`, forward `missingRoleSet` to each `SopDagNode` based on `step.role_slug`
- [x] 3.4 In `SopDagNode`, render `⚠ no <role>` chip beside the role badge when the step's role is in `missingRoleSet` (amber styling)
- [x] 3.5 In `SopInspectorPanel`, add a "Role gap" warning row under the existing "Role" row when the selected step's role is missing
- [x] 3.6 Remove the one-shot `addToast(\`Missing roles: ...\`)` block from `handleRun` in `SopViewSurface.tsx`; keep the dispatch (`sendMessage(formatRunCommand(...))`) unchanged

## 4. Failed step surface

- [x] 4.1 In `SopDagNode`, render a `failed` chip beside the role badge when `status === 'failed'` (red background, white text, short label)
- [x] 4.2 In `SopInspectorPanel`, add a "Last error" section above the existing "Status" row that renders only when `status === 'failed'`. Source: from the store, look up the step's tasks and pick the latest `'failed'` / `'cancelled'` task; render its `taskType` as heading + `description` as body; fallback `(no detail provided)` if both empty
- [x] 4.3 Pass the step's `tasks` array to `SopInspectorPanel` (it already gets `definition` + `selectedStepId`; either thread the runtime task list through or read `usePlanStepStore` inside the inspector — pick whichever keeps the inspector mostly read-only on store data)

## 5. Edge upstream-failed gating

- [x] 5.1 In `SopDagCanvas`, modify `getEdgeStatus(fromStepId)`: if `getStatus(fromStepId) === 'failed'`, return `'failed'` to short-circuit; otherwise return the existing rollup of upstream status
- [x] 5.2 Confirm `SopDagEdge` already short-circuits `<animateMotion>` to active-only — no edit required if so; otherwise gate the `status === 'active'` motion branch additionally on the upstream not being failed (already implicit if `getEdgeStatus` returns `'failed'` for downstream of a failed step)

## 6. Build / lint / typecheck

- [x] 6.1 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build` (serial, per CLAUDE.md ordering)
- [x] 6.2 `pnpm --filter @offisim/ui-office typecheck`
- [x] 6.3 `pnpm lint:fix` and confirm no warnings introduced (biome formatter ran on touched files; pre-existing repo lint debt outside this scope left untouched)
- [x] 6.4 `pnpm --filter @offisim/web build` to verify the web app composes the new component

## 7. Live verify (web @ 5176)

Pre-condition: at least one Offisim-seeded SOP with steps whose roles include both a present role (e.g. `developer`) and a missing role (e.g. `qa` not in any employee). If such a SOP is not in the seed, edit the seed SOP via NL command to add a `qa`-roled step before verifying.

- [x] 7.1 Open SOP workspace, select a SOP. Confirm `⚠ no qa` chip on the qa-roled node and "Role gap" row in inspector when that step is selected
- [x] 7.2 Create a new employee with `role = 'qa'` from Personnel. Confirm the `⚠ no qa` chip and "Role gap" row disappear within one event tick (no toast involved)
- [x] 7.3 Delete that qa employee. Confirm the chip + row reappear without re-clicking Run
- [x] 7.4 Click Run. Confirm: (a) NO missing-role toast fires (replaced by persistent chip), (b) the run-progress strip mounts above the canvas with running pulse, (c) `step 1 of N` counter visible, (d) current step label visible
- [x] 7.5 Watch the run progress: confirm strip updates `step N of M` as `plan.step.started` fires; confirm step nodes transition `pending → active → completed` (or `failed`); confirm active-edge motion animates and completed-edge stroke turns emerald
- [x] 7.6 Force a step to fail (point a step at a deliberately invalid skill or role with no available employee — depends on seed). Confirm: (a) node shows red `failed` chip + dot, (b) inspector "Last error" section renders with the failed task's `taskType` + `description`, (c) downstream edges from the failed step render red and stop animating
- [x] 7.7 Wait for `plan.completed`. Confirm strip enters "just finished" state (running pulse stops, terminal copy appears) and unmounts after ~3s
- [x] 7.8 Run a SOP whose `sopTemplateId` differs from the currently selected SOP. Confirm the strip does NOT mount on the currently viewed SOP

## 8. Verify-notes + canonical sync

- [x] 8.1 Capture screenshots / console transcript covering each 7.x scenario; persist under the change folder as `verify-notes.md`
- [ ] 8.2 After live verify passes, run `/opsx:archive sop-run-surface`. Pre-archive gate: confirm spec ↔ tasks ↔ code consistency (CLAUDE.md T1.4)
- [ ] 8.3 Sync canonical specs: create `openspec/specs/sop-run-surface/spec.md` from the new capability spec; merge MODIFIED requirements into `openspec/specs/plan-step-store/spec.md`
- [ ] 8.4 Update `memory/MEMORY.md` "Next Change Queue" + `memory/project_ux_overhaul_queue.md` Phase E to reflect E2 archived; record archive commit SHA
