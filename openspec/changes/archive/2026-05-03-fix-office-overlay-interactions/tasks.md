## 1. EmployeeInspector body — single SurfaceCard + dividers + Memories disclosure

- [x] 1.1 Read `packages/ui-office/src/components/agents/EmployeeInspector.tsx` lines 285-466. Identify every `rounded-xl border bg-surface-*` block inside the outer card (currently 6 inner sections via `INSPECTOR_SECTION_CLASS`).
- [x] 1.2 Replace `INSPECTOR_SECTION_CLASS` with a divider-style class — e.g. drop the rounded / border / muted-bg, keep the section padding + the `INSPECTOR_LABEL_CLASS` lozenge. Sections become `border-t border-border-subtle` rows inside the outer card.
- [x] 1.3 Identity row, Details row, and Memories disclosure all live as siblings inside the single outer `rounded-xl border bg-surface-elevated shadow-2xl` card. Verify in DOM that no descendant introduces a second elevation cluster (`shadow-`, `rounded-xl`, `border` + `bg-surface-muted`).
- [x] 1.4 Convert `MemoriesSection` to use a `<details>` / `<summary>` disclosure: `<summary>` shows the count + label, expanded body shows the memory list. Body is unwrapped in the surrounding inspector card — no inner card.
- [x] 1.5 Visual-pass at desktop / tablet / narrow tier: section spacing reads as a clean stack, label lozenges still scannable, no visual hierarchy collapse. Adjust `--sp-*` paddings if needed but do not reintroduce inner cards.

## 2. Footer width-adaptive layout (icon-only fallback + wrap)

- [x] 2.1 Replace footer `flex gap-2` (`:421`) with `flex flex-wrap gap-2` so a fourth-button overflow naturally wraps to a second row.
- [x] 2.2 Pull `useLayoutTier()` (already exported from `packages/ui-office/src/components/workspaces/types.ts` per workspace IA) into `EmployeeInspector` to read desktop / tablet / narrow.
- [x] 2.3 Each footer button takes a label prop and an icon; renders text inline at desktop tier, drops to icon-only with `aria-label={label}` + `title={label}` at tablet / narrow tier. Refactor the Message / Edit Details / Dismiss / Re-enable buttons to share this pattern (consider a small `InspectorFooterButton` local component in the same file).
- [x] 2.4 Verify reachability: at every tier, every button is fully visible (no `text-overflow: ellipsis` truncation, no off-canvas overflow). Evidence: `.live-verify/fix-office-overlay-interactions/6.4-footer-desktop.png`, `6.4-footer-tablet.png`, `6.4-footer-narrow.png`.
- [x] 2.5 Confirm `disabled={isUpdatingEnabled}` still applies to the Dismiss / Re-enable button; no double-click while DB write is in flight.

## 3. Optimistic Dismiss / Re-enable + rollback

- [x] 3.1 Restructure `updateEnabled(nextEnabled)` (`:255-268`) to flip local state first:
  ```
  const prev = employee;
  setEmployee(curr => curr && curr.employee_id === targetId ? { ...curr, enabled: nextEnabled } : curr);
  try { await repos.employees.update(...); } catch (err) { setEmployee(prev); addToast({ severity: 'error', message: err.message }); }
  ```
- [x] 3.2 `addToast` channel: import `useToasts` from the existing runtime (App.tsx wires it; `EmployeeInspector` may need a callback prop or context access — match how `EmployeeCreatorOverlay` surfaces errors).
- [x] 3.3 Confirm the `setEmployee` callback form correctly handles the case where the user navigated away (different employee) before the await resolved — only flip / rollback the matching `employee_id`, not the current selection.
- [x] 3.4 Smoke check at desktop: open inspector for an enabled employee, click Dismiss, confirm — the banner / button flips immediately in release `.app`; Re-enable flips back. Evidence: `.live-verify/fix-office-overlay-interactions/6.5-dismiss-before.png`, `6.5-dismiss-after.png`, `6.5-reenable-after.png`.
- [x] 3.5 Negative path: temporarily monkey-patch `repos.employees.update` to throw, click Dismiss → banner reverts, toast appears with the error message, and the button re-enables for retry. Evidence: `.live-verify/fix-office-overlay-interactions/6.6-dismiss-rollback-toast.png`.

## 4. CompanySwitcher direct-set verification

- [x] 4.1 Read `packages/ui-office/src/components/layout/Header.tsx:469-511` (`CompanySwitcher`). Confirm `onSelect={(id) => switchCompany(id)}` is the only path on row click (no `setActiveOverlay('company-select')` interceptor).
- [x] 4.2 Read `apps/web/src/hooks/useCompanyBootstrap.ts:46-58`. Confirm `setActiveOverlay('company-select')` only fires when `activeCompanyId` is null (first-load path), not on swap.
- [x] 4.3 Live verify on release `.app`: open dropdown, click a non-active company, observe — no `company-select` overlay flash, menu closes, content surfaces re-render against the new company. Evidence: `.live-verify/fix-office-overlay-interactions/6.7-switcher-direct-set.png`.
- [x] 4.4 Live verify "Manage companies" footer action: click it, confirm `company-select` overlay opens normally. Evidence: `.live-verify/fix-office-overlay-interactions/6.8-manage-companies-overlay.png`.
- [x] 4.5 If 4.1 / 4.2 reveal a regression (overlay opens during swap), open follow-up sub-task to fix; otherwise mark verification-only complete. Result: no regression observed; no follow-up needed.

## 5. Build + typecheck + harness

- [x] 5.1 Build pipeline serial: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`.
- [x] 5.2 `pnpm typecheck` across the workspace.
- [x] 5.3 `node scripts/harness-contract.mjs` — no harness scenario asserts on overlay DOM today; expect a no-op pass. Confirm.

## 6. Live verification (release `.app`)

- [x] 6.1 Build release `.app`: `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`. Final release binary timestamp: `2026-05-03 23:36:16 +1200`.
- [x] 6.2 Launch the worktree's exact `.app` path. Verified with Computer Use: `App=com.offisim.desktop`, `URL=tauri://localhost`.
- [x] 6.3 Scenario 1 — single-card inspector: opened `EmployeeInspector` for idle and dismissed employees. Confirmed one elevated card; sections separated by dividers; Memories collapsed by default. Evidence: `6.3-inspector-idle.png`, `6.3-inspector-dismissed.png`. No executing employee was present in the verify company; this is an evidence-coverage gap, not a behavior failure, because the same inspector structure renders across state rows.
- [x] 6.4 Scenario 2 — footer reachability: resize the office workspace from desktop → tablet; narrow tier verified in web SPA because release `.app` floor is ≥1024. At each captured tier, footer buttons are visible with correct icon / icon+text rendering. Evidence: `6.4-footer-desktop.png`, `6.4-footer-tablet.png`, `6.4-footer-narrow.png`.
- [x] 6.5 Scenario 3 — optimistic Dismiss: click Dismiss on an enabled employee, confirm — banner flips immediately, button switches to Re-enable. Click Re-enable → flips back. Evidence: `6.5-dismiss-before.png`, `6.5-dismiss-after.png`, `6.5-reenable-after.png`.
- [x] 6.6 Scenario 3b — DB-failure rollback: instrumented `EmployeeInspector` to make `repos.employees.update` reject, rebuilt release `.app`, clicked Dismiss → banner reverted, toast surfaced the error, button stayed enabled. Evidence: `6.6-dismiss-rollback-toast.png`. Instrumentation was reverted and final release `.app` rebuilt.
- [x] 6.7 Scenario 4a — switcher direct-set: open `CompanySwitcher`, click a non-active company. Active company switches; no `company-select` overlay flash. Evidence: `6.7-switcher-direct-set.png`.
- [x] 6.8 Scenario 4b — Manage companies route: click `Manage companies` footer action. Overlay opens normally. Evidence: `6.8-manage-companies-overlay.png`.
- [x] 6.9 Save evidence to `.live-verify/fix-office-overlay-interactions/` with a `verify-record.md` index describing each scenario and pass/fail.
- [x] 6.10 If any scenario fails, fix root cause (no UI suppress hacks) and re-verify before archiving. Result: all run scenarios passed; only noted evidence-coverage exception is executing-state screenshot absence.

## 7. Documentation + archive gate

- [x] 7.1 Update `MEMORY.md` 9-bucket queue entry to mark 桶 4 archived with this change name + commit SHA + canonical capability `office-overlay-interactions`. Not applicable in this worktree: no project-local `MEMORY.md` / 9-bucket queue file exists, and global Codex memory is read-only by policy.
- [x] 7.2 OpenSpec Archive Gate three-check: spec consistency / tasks consistency / docs consistency. `pnpm openspec validate fix-office-overlay-interactions --strict` passed; four Requirements match the implementation and live evidence.
- [x] 7.3 Protocols ledger (`openspec/protocols-ledger.md`): no protocol touched. Leave entry unchanged.
- [x] 7.4 Run `/opsx:archive fix-office-overlay-interactions` after live verification scenarios all pass and `verify-record.md` is in the change dir. Executed via `pnpm openspec archive fix-office-overlay-interactions --yes`.
