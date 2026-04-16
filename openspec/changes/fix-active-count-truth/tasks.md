## 1. Pre-work — live audit

- [ ] 1.1 Boot web runtime (`cd apps/web && pnpm dev`) and open `http://localhost:5176` in Chrome DevTools MCP
- [ ] 1.2 Confirm default company loads with N employees (record N) and capture initial footer `{active}/{total}` and 3D overlay `{activeCount}` values (expect both 0/N and 0 respectively)
- [ ] 1.3 Kick off a real multi-employee task via chat (e.g., "create 3 files: readme, todo, design"); at each observed ceremony phase transition (gathering / analyzing / planning / dispatching / working / reporting), screenshot both the footer and 3D overlay
- [ ] 1.4 Record the actual divergence pattern: do the two numbers differ in steady state, or only around run-start / company-switch? Note any state transitions where a counter disagrees with the scene visual
- [ ] 1.5 If the audit reveals that `EmployeeState` itself fails to reflect scene visuals (e.g., employee animating but `state === 'idle'`), PAUSE and surface to user — the change scope needs to escalate before implementing

## 2. Introduce shared hook

- [ ] 2.1 Create `packages/ui-office/src/runtime/use-active-employee-count.ts` with exports: `isEmployeeActive`, `isEmployeeBlocked`, `useActiveEmployeeCount`, `ActiveEmployeeCount` type (shape per design.md Decision 2)
- [ ] 2.2 Wire the hook to `useOffisimRuntime().eventBus` with subscriptions to `employee.state.` (prefix), `employee.created`, `employee.deleted` (same pattern as existing hooks)
- [ ] 2.3 Seed `total` from `bootstrapState.reposSnapshot.employees` filtered by `activeCompanyId` on mount; refine via `repos.employees.findByCompany(activeCompanyId)` once `repos` is available (carry over the pattern from `useDashboardMetrics` lines 113-120, 137-169)
- [ ] 2.4 Implement run-start reset: when `isRunning → true`, reassign every tracked employee's state to `'idle'` without clearing the map (per design.md Decision 3)
- [ ] 2.5 Implement company-switch reset: on `activeCompanyId` change, clear the map and reseed `total` from the new company's bootstrap count (per design.md Decision 3)

## 3. Migrate consumers

- [ ] 3.1 In `packages/ui-office/src/hooks/useDashboardMetrics.ts`, call `useActiveEmployeeCount()` and read `.active` / `.total` into the `employeeUtilization` field; remove the local `employeeStatesRef` map for the **counting path** (cost / task / token refs untouched) and drop the `employee.state.` / `employee.created` / `employee.deleted` subscriptions that only fed the counter (keep any subscriptions that also feed other refs)
- [ ] 3.2 Audit `useDashboardMetrics` for remaining uses of `employeeStatesRef` after step 3.1 — if nothing else reads it, delete; if something does, document why it stays
- [ ] 3.3 In `packages/ui-office/src/components/scene/useOffice3DViewState.ts:153-162`, replace the `activeCount` / `blockedCount` `useMemo` blocks with reads from `useActiveEmployeeCount()`; keep the downstream prop thread (`Office3DView` → `SceneInfoOverlay`) unchanged
- [ ] 3.4 Verify `useAgentStates` is untouched and still renders scene data (per employee: role, task assignment, workstation, subtasks); it is no longer the source of truth for the count

## 4. Typecheck and build verification

- [ ] 4.1 Run `pnpm --filter @offisim/shared-types build` (no changes expected; establish baseline)
- [ ] 4.2 Run `pnpm --filter @offisim/core build`
- [ ] 4.3 Run `pnpm --filter @offisim/ui-office build`
- [ ] 4.4 Run `pnpm --filter @offisim/web build`
- [ ] 4.5 Run `pnpm typecheck` across the repo — zero TS errors expected

## 5. Live verification on web runtime

- [ ] 5.1 Boot `pnpm --filter @offisim/web dev` (port 5176) and open in Chrome DevTools MCP
- [ ] 5.2 Observe initial state: footer and 3D overlay both show `0/N` and `0` active; open DevTools console, confirm zero errors
- [ ] 5.3 Kick off a single-employee task (e.g., `"Write a haiku about testing"`). At each ceremony phase, take a snapshot — assert footer `.active` == 3D overlay `activeCount` (**invariant per Requirement 1, Scenario 1**)
- [ ] 5.4 Kick off a multi-employee task (e.g., file creation across 3 employees). At each dispatch, assert the counter ticks up correctly and both surfaces agree
- [ ] 5.5 Trigger a `paused` or `blocked` state if possible (e.g., simulate permission gate) and confirm the counter does NOT include that employee but `blockedCount` does (if state is `blocked`)
- [ ] 5.6 Run the task to completion; observe return to `idle` and confirm counter returns to `0/N` at both surfaces
- [ ] 5.7 Switch companies mid-session (if multi-company is set up); confirm counter resets atomically (both surfaces observe `0/M` before any `employee.state.*` event for the new company)
- [ ] 5.8 Start a second run in the same company; confirm run-start reset sets `.active` to 0 at both surfaces before any new state event

## 6. Label audit (decision point)

- [ ] 6.1 After live verification passes, re-examine the string "employees active" — does the count under the new semantics read as "employees active" to a user, or does it still mismatch? Decision per design.md Open Question Q2
- [ ] 6.2 If the label still misleads, propose a replacement (e.g., "employees working" / "employees busy") and update both `office3d-sections.tsx:259` and `StatusBar.tsx:141` strings; document the decision in a Phase note

## 7. Final pass

- [ ] 7.1 Run `openspec validate --specs` and confirm `scene-activity-display` validates clean
- [ ] 7.2 Write a verification note in the change folder (`verification.md`) summarizing: screenshots / observed transitions / any open follow-ups
- [ ] 7.3 Commit phase by phase (prefix commits with `refactor(ui-office): active-count-truth —` or `fix(ui-office): active-count-truth —`), no squash
- [ ] 7.4 Ready for `/opsx:archive`
