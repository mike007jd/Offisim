## Why

2026-05-02 release `.app` live verify exposed four overlay-layer regressions that survived the post-refactor surface (issues #2, #3, #7):

- `EmployeeInspector` ships **6 nested elevated `SurfaceCard` sections** in violation of the `panel-and-dialog-sizing` spec's "no cards-in-cards" rule (also called out in `packages/ui-office/CLAUDE.md`). The footer's `Re-enable` and `Dismiss` buttons overflow the card on narrow widths and on enabled-state width — the user can't reliably reach the dismiss action.
- The dismiss action is **fire-and-forget on the DB write**: `updateEnabled(0)` resolves before `setEmployee` repaints, so the button label and the "DISMISSED" banner stay frozen for one round-trip. Looks like the click did nothing.
- The Header `CompanySwitcher` dropdown items **route every selection through the `company-select` overlay**, even when the user just wants to swap to an already-existing company. That overlay is the picker / creator surface; opening it for a one-tap switch is the wrong path.

These are not new behaviors — they are the contract `panel-and-dialog-sizing` and `office-editor-boundaries` already presupposed. The fix is structural enforcement at the inspector + switcher sites, not a new abstraction.

## What Changes

- **Collapse `EmployeeInspector` 6 inner SurfaceCards into 1 outer card with internal dividers.** Memories disclosure becomes a `<details>`/disclosure pattern, not a nested card. Per `panel-and-dialog-sizing` "Settings tab body ≤ 1 layer SurfaceCard" rule, generalized to any overlay body.
- **Footer buttons adapt to width**: icon-only at narrow tier, icon + text at desktop, wrap to two rows when both `Re-enable` / `Dismiss` are visible at the same time. The dismiss / re-enable affordance SHALL never clip or overflow.
- **Dismiss + Re-enable are optimistic**: `setEmployee({ ...employee, enabled: 0 })` runs synchronously before `repos.employees.updateEnabled()` resolves. On DB-write failure: roll back `setEmployee`, surface the error via the existing toast / inline banner channel; do not silently swallow.
- **`CompanySwitcher` dropdown selection goes direct**: clicking a company item calls `setActiveCompany(id)` + closes the menu, no overlay route. Only the explicit `Manage companies` button keeps routing to the `company-select` overlay (creator / picker surface).
- **Spec lands on a new `office-overlay-interactions` capability.** Four Requirements: SurfaceCard nesting limit on overlay bodies; footer affordance never clips; mutating overlay actions are optimistic with rollback; switcher dropdowns distinguish "switch" from "manage".

## Capabilities

### New Capabilities

- `office-overlay-interactions`: behavioral contract for office overlays — inspector / switcher / company picker — covering layout discipline (no cards-in-cards on overlay bodies; footer affordances stable across tiers), interaction lifecycle (optimistic mutations with rollback), and routing discipline (dropdown direct-set vs. overlay route distinction).

### Modified Capabilities

(none — `panel-and-dialog-sizing` already enforces no-cards-in-cards generically; this change adds the overlay-level enforcement layer it always assumed, in a sibling capability.)

## Impact

- **ui-office**: `EmployeeInspector.tsx` (collapse 6 SurfaceCards → 1; disclosure for Memories; footer width-adaptive; optimistic dismiss / re-enable). `Header.tsx` `CompanySwitcher` (direct-set on item click; only `Manage companies` opens overlay).
- **apps/web**: no change to `useOverlayState` semantics; `setActiveCompany` is the existing path. `OverlayKey` stays `'company-select'` for the picker — direct switch never sets the overlay.
- **No DB / schema impact**: behavioral fix only. `repos.employees.updateEnabled()` signature unchanged.
- **No persistence change.** `companies.last_active_company_id` (or wherever the active company is persisted) writes through the same `setActiveCompany` channel as today.
- **Live verify**: release `.app` walk-through covers the four scenarios on desktop / tablet / narrow tiers. Toast-on-DB-failure path tested by simulating a write failure (e.g. revoke vault permission mid-click).
