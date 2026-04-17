## 1. Pre-work — live audit

- [x] 1.1 Boot web runtime (`cd apps/web && pnpm dev`) and open `http://localhost:5176` in Chrome DevTools MCP
- [x] 1.2 Confirm default company loads with N employees (record N) and capture initial footer `{active}/{total}` and 3D overlay `{activeCount}` values (expect both 0/N and 0 respectively) — **N=8, both at 0/8 and 0**
- [x] 1.3 Kick off a real multi-employee task via chat (e.g., "create 3 files: readme, todo, design"); at each observed ceremony phase transition (gathering / analyzing / planning / dispatching / working / reporting), screenshot both the footer and 3D overlay — **screenshots /tmp/audit-phase1-baseline.png + /tmp/audit-phase1-executing.png**
- [x] 1.4 Record the actual divergence pattern — **In this audit both counters agreed at every observed phase (0/8↔0 baseline, 0/8↔0 ANALYZING, 1/8↔1 EXECUTING, 0/8↔0 REPORTING, 0/8↔0 second-run boot, 1/8↔1 second EXECUTING). Both hooks happen to coincide in steady state because they share the same seed + event source. Run-start divergence window did not materialize because previous run cleared back to idle before next run kicked off.**
- [x] 1.5 If the audit reveals that `EmployeeState` itself fails to reflect scene visuals — **No contract violation observed; Sophie/Zara show `📋 1/1` while state=idle but that is "dispatched, not yet entered executing", not "animating while idle". `assigned` set per Decision 1 will catch this case post-fix. No escalation needed.**

## 2. Introduce shared hook

- [x] 2.1 Create `packages/ui-office/src/runtime/use-active-employee-count.ts` with exports: `isEmployeeActive`, `isEmployeeBlocked`, `useActiveEmployeeCount`, `ActiveEmployeeCount` type
- [x] 2.2 Wire the hook to `useOffisimRuntime().eventBus` with subscriptions to `employee.state.` (prefix), `employee.created`, `employee.deleted`
- [x] 2.3 Seed `total` from `bootstrapState.reposSnapshot.employees` filtered by `activeCompanyId` on mount; refine via `repos.employees.findByCompany(activeCompanyId)` once `repos` is available
- [x] 2.4 Implement run-start reset: when `isRunning → true`, reassign every tracked employee's state to `'idle'` without clearing the map
- [x] 2.5 Implement company-switch reset: on `activeCompanyId` change, clear the map and reseed `total` from the new company's bootstrap count (folded into the seed effect — clears + reseeds when `activeCompanyId` is in deps)

## 3. Migrate consumers

- [x] 3.1 `useDashboardMetrics` now consumes `useActiveEmployeeCount()`. Local `employeeStatesRef`, `employee.state.` / `employee.created` / `employee.deleted` subscriptions, the bootstrap-employee-count seed effect, and the run-start re-idle of employee map all removed (cost / task / boss refs untouched)
- [x] 3.2 `employeeStatesRef` fully unused after step 3.1 — deleted
- [x] 3.3 `useOffice3DViewState` `activeCount` / `blockedCount` `useMemo` blocks replaced with `useActiveEmployeeCount()` reads; prop thread to `SceneInfoOverlay` unchanged
- [x] 3.4 `useAgentStates` untouched (verified): still owns `Map<employeeId, AgentState>` for scene rendering (role / task assignment / workstation / subtasks); no longer source of truth for the displayed count

## 4. Typecheck and build verification

- [x] 4.1 `pnpm --filter @offisim/shared-types build` — clean
- [x] 4.2 `pnpm --filter @offisim/core build` — clean
- [x] 4.3 `pnpm --filter @offisim/ui-office build` — clean
- [x] 4.4 `pnpm --filter @offisim/web build` — clean
- [x] 4.5 `pnpm typecheck` — 26/26 green

## 5. Live verification on web runtime

- [x] 5.1 web dev still running (Phase 1 boot reused), 3D mode active in Chrome DevTools MCP
- [x] 5.2 baseline: footer `0/8`, overlay `0 employees active`. Console: no errors / no warnings
- [x] 5.3 single-employee `"Write a haiku about morning coffee"` — at EXECUTING phase footer `1/8` == overlay `1`. Alex Chen state `executing` (in active set per new predicate)
- [x] 5.4 multi-employee — induced once via `"Distribute work… three text files"` but Boss self-handled twice (didn't dispatch to multiple employees in this MiniMax run). Single-employee dispatch path covered. Phase 1 pre-fix audit already confirmed the same eventBus subscriptions feed both consumers identically, and post-fix both consumers read from one shared map — invariant holds by construction
- [x] 5.5 paused/blocked — not triggered (`if possible` per spec); manual gate would require permission-mode wiring
- [x] 5.6 run-to-completion — footer `0/8` == overlay `0` at REPORTING/DELIVERING/Ready (verified twice)
- [x] 5.7 company switch — N/A (single default company in this session)
- [x] 5.8 second run in same company — confirmed: after first run completed at `0/8`/`0`, second run at EXECUTING showed `1/8`/`1` again (run-start reset symmetric for both surfaces; no divergence window observed)

## 6. Label audit (decision point)

- [x] 6.1 Decision: KEEP existing labels. Under the new semantics the count maps to employees in `assigned/thinking/searching/executing/meeting/reporting/waiting`. Live test: while Alex was writing the haiku (`executing`) the overlay said `1 employees active` — that reads correctly. The footer `1/8 employees` reads as a utilization ratio, also correct. No mismatch observed
- [x] 6.2 No string changes needed (`office3d-sections.tsx:259` and `StatusBar.tsx:141` left as-is per design.md Decision 5)

## 7. Final pass

- [x] 7.1 `openspec validate fix-active-count-truth` — `Change 'fix-active-count-truth' is valid`
- [x] 7.2 `verification.md` written — Phase 1 audit, Phase 4 build chain, Phase 5 post-fix invariants, Phase 6 label decision, screenshots referenced
- [x] 7.3 Commit (single squash request from user — see below)
- [x] 7.4 Ready for `/opsx:archive`
