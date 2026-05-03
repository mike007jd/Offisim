# fix-office-overlay-interactions release verify

Date: 2026-05-03 23:39:04 +1200

Runtime:
- Release app: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Rebuilt binary timestamp before final launch: `2026-05-03 23:36:16 +1200`
- Window URL: `tauri://localhost`

How to (re)build the .app:

```
pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build
```

Then launch this worktree's exact `.app` path (do not rely on `open -b com.offisim.desktop` — see CLAUDE.md multi-worktree gotcha).

## Scenarios

| Task | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 6.3 | Single-card inspector — open `EmployeeInspector` for one idle and one dismissed employee. Confirm one elevated card; sections separated by dividers; Memories collapsed by default. | PASS | `6.3-inspector-idle.png`, `6.3-inspector-dismissed.png` |
| 6.4 | Footer reachability — resize office workspace from desktop → tablet; narrow tier verified in web SPA per `responsive-app-shell` spec. Every footer button visible; desktop = icon+text, tablet/narrow = icon-only where applicable. | PASS | `6.4-footer-desktop.png`, `6.4-footer-tablet.png`, `6.4-footer-narrow.png` |
| 6.5 | Optimistic Dismiss — click Dismiss on an enabled employee. Banner flips immediately; button switches to Re-enable. Click Re-enable → flips back. | PASS | `6.5-dismiss-before.png`, `6.5-dismiss-after.png`, `6.5-reenable-after.png` |
| 6.6 | DB-failure rollback — temporarily instrumented `EmployeeInspector` to throw `Live verify forced employee update failure`; rebuilt release `.app`; clicked Dismiss on Alex Chen. | PASS | `6.6-dismiss-rollback-toast.png` |
| 6.7 | Switcher direct-set — open `CompanySwitcher`, click `Empty Verify Company`. Active company switches; no `company-select` overlay flash. | PASS | `6.7-switcher-direct-set.png` |
| 6.8 | Manage companies route — click `Manage companies` footer action. `company-select` overlay opens normally. | PASS | `6.8-manage-companies-overlay.png` |

## Notes

- 6.4 narrow tier: capability `responsive-app-shell` defines narrow as `width ≤ 768 px`. Since Tauri release `.app` enforces a desktop product floor (`minWidth ≥ 1024`), narrow-tier verification target is **the web SPA in browser**, not the release `.app`. Reference: `openspec/specs/responsive-app-shell/spec.md` "Narrow tier verification scope is the web SPA in browser" Requirement.
- For 6.4 narrow specifically: `pnpm --filter @offisim/web dev` → resize browser to ≤768 px → repro.
- 6.6 (DB-failure rollback) easiest path: temporarily edit `packages/ui-office/src/runtime/offisim-runtime-context.tsx` (or wherever repos is constructed) to wrap `repos.employees.update` with a forced reject; rebuild ui-office + desktop; verify; revert.
- 6.6 actual path used: temporary throw inside `packages/ui-office/src/components/agents/EmployeeInspector.tsx` before `repos.employees.update`, then rebuilt release `.app`, captured rollback toast, reverted the throw, and rebuilt final release `.app` again.
- No project-local `MEMORY.md` / 9-bucket queue file exists in this worktree (`find ... -name MEMORY.md` returned none). Global Codex memory is read-only by policy, so task 7.1 is not applicable in this session.
- If any scenario fails: fix root cause (no UI suppress hacks) and re-verify before archiving.
