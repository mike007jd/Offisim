## Why

Simplify+ pass on 2026-04-30 — 2026-05-01 closed ~40 blocking/important UI findings against the GPT-authored Light Mode Core UI redo, but explicitly deferred four shell-level structural items because the risk/scope ratio was unfavorable inside that single pass. They are now the residual debt: Header maintains two parallel JSX trees that are guaranteed to drift, StatusBar reads as a debug HUD instead of product chrome, three peer surfaces hand-roll the same dropdown shape, and StudioPalette's 600+ inline-style block makes the palette the worst-maintained file in the studio surface. None of them changes user-observable behavior — they are all "GPT-shaped frontend that needs to be rewritten before the next surface lands on top of it."

## What Changes

- Replace Header's narrow vs desktop dual JSX trees (`tier === 'narrow' ? <full narrow tree> : <full desktop tree>`) with a single tier-driven shell that maps the same slot vocabulary to either narrow drawer chrome or desktop slot positions.
- Re-segment StatusBar's 13 status atoms into three product-shaped segments (run state · work · resources), collapse low-value atoms behind tooltips, and stop the footer from looking like a dev HUD.
- Extract a shared `<EntityDropdown>` primitive (header item + scrollable list + footer action) and migrate Header `CompanySwitcher`, `ProjectSelector`, and Market `MarketFilterBar` mode/manage tabs to consume it.
- Decompose `StudioPalette.tsx` into `<CategoryHeader>`, `<CollapseToggle>`, and `<PrefabCard>` primitives backed by Tailwind classes (Studio's deliberate inline-style aesthetic is preserved where it's load-bearing — only the duplicated shells move).

## Capabilities

### New Capabilities
<!-- None — all four items are internal structural refactors. No new user-facing behavior. -->

### Modified Capabilities
- `design-system-consolidation`: extend the "shared UI primitives cover repeated surfaces" requirement to include `EntityDropdown` (the new `@offisim/ui-core` primitive) and add a scenario covering Header company switcher / project selector / Market mode-manage tabs all consuming it.
<!-- Header narrow/desktop consolidation, StatusBar 3-segment grouping, and StudioPalette sub-component extraction are internal structural refactors only — no scenario edits needed in `responsive-app-shell` or `web-app-shell-boundaries`. Their existing scenarios continue to pass. -->

## Impact

- **Code touched**:
  - `packages/ui-office/src/components/layout/Header.tsx` (single tier-driven shell)
  - `packages/ui-office/src/components/layout/StatusBar.tsx` (three-segment grouping)
  - `packages/ui-office/src/components/studio/StudioPalette.tsx` (sub-component extraction)
  - `packages/ui-core/src/components/entity-dropdown.tsx` (new primitive)
  - `packages/ui-office/src/components/layout/Header.tsx` + `packages/ui-office/src/components/marketplace/MarketFilterBar.tsx` + `packages/ui-office/src/components/project/ProjectSelector.tsx` (three migrations to EntityDropdown)
- **APIs / data / runtime**: none. No store change, no event change, no IPC change, no DB change.
- **Risk surface**: Header is the highest-traffic shell component in the app — every workspace switch hits it. The tier-consolidation must preserve focus order, drawer Escape handling, tour target refs (`useTourTarget`), and aria-current semantics. StatusBar's pending-interaction badge and Stop button must stay visible when active. Live verify on dev server (`http://127.0.0.1:5176/`) at desktop / tablet / narrow viewports + dark / light theme is the gate.
- **Spec gate**: this change does NOT modify any `openspec/specs/*` requirements. Existing scenarios in `responsive-app-shell` (tier behavior), `design-system-consolidation` (shared primitives), and `web-app-shell-boundaries` (App.tsx thinness) must continue to pass.
