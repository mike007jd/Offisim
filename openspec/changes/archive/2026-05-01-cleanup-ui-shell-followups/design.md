## Context

The 2026-04-30 → 2026-05-01 simplify+ pass on the GPT-authored Light Mode Core UI redo closed ~40 blocking/important findings (cards-in-cards, placeholder copy, broken affordances, dead refs, theme leftovers, magic numbers) and shipped them on the working tree. Inside that pass four findings were deferred because each was a non-trivial structural rewrite of a high-traffic shell component, and bundling them with the cosmetic fixes would have made the diff hard to live-verify in one go. They are tracked here as their own change so the rewrites can be reviewed against a clean baseline.

The four deferred items share a shape: GPT generated repetitive structural code that works but is brittle (Header double-tree), low-density (StatusBar HUD), or expensive to extend (CompanySwitcher hand-roll, StudioPalette inline-style). None of them affect runtime behavior, store shape, or persisted data — they are pure UI / component-shape refactors.

Constraints inherited from the codebase:
- `packages/ui-office/CLAUDE.md` — Header / StatusBar / Studio sit under `packages/ui-office/src/components/` with strict token discipline and the `pnpm tokens:lint-hex` gate that forbids raw hex outside the renderer.
- `responsive-app-shell` capability already pins user-observable tier behavior at `1440x900 / 1280x800 / 390x844`. Internal Header restructuring must not violate any of its scenarios.
- `design-system-consolidation` already requires touched surfaces to consume `SurfaceCard` / `Toolbar` / `SegmentedControl` / `DialogShell` / `EmptyState` / `ErrorState`. EntityDropdown extends that catalog.
- `web-app-shell-boundaries` keeps `apps/web/src/App.tsx` thin (≤350 non-blank lines). Header refactor only touches `packages/ui-office/...`, no upward drift expected.
- Validation discipline: no automated UI tests. Verification is `pnpm tokens:check` + `pnpm tokens:lint-hex` + `pnpm --filter @offisim/ui-core build` + `pnpm --filter @offisim/ui-office typecheck && build` + `pnpm --filter @offisim/web typecheck && build` + live agent verification on dev server (and Tauri release shell for Header drawer behavior).

## Goals / Non-Goals

**Goals:**
- Eliminate Header's narrow vs desktop dual JSX trees so a slot change cannot drift between viewports.
- Re-segment StatusBar so the footer reads as product chrome at a glance (run state · work · resources), not a developer telemetry strip.
- Lift the recurring "trigger row + scrollable item list + manage footer" dropdown shape into a single `<EntityDropdown>` primitive in `@offisim/ui-core` and migrate the three current consumers.
- Decompose `StudioPalette.tsx` so category-row, collapse-glyph, and prefab-tile are each ~30-line components, not buried inside one 700-line render.
- Maintain zero behavior change. All three relevant capability specs continue to pass without scenario edits.

**Non-Goals:**
- Theme system rework (`offisim.theme.change` event already exists, used by studio-style-helpers; not extending its consumers).
- StatusBar metric semantics — same data sources, same conditions, same `useDashboardMetrics` / `useRuntimeActivityFeed` / `usePipelineStage` hooks. Only grouping and visibility rules change.
- Studio drag/place behavior, prefab catalog, zone hierarchy, or the deliberate inline-style aesthetic for canvas-adjacent surfaces. Only Palette's repeated shells move.
- Touching any non-UI layer (core, runtime, gateway, db, Tauri).
- Migrating other dropdown surfaces (e.g. SOP NL command bar, employee command palette) to EntityDropdown — out of scope; only the three known consumers move.

## Decisions

### Decision 1 — Tier-driven Header is one component with slot maps, not two trees

**Choice**: Replace the `if (tier === 'narrow') return <Drawer-shaped tree>; return <Desktop-shaped tree>;` pattern with a single render that defines a `slots` object (left / center / right / overflow) once, and lets a `<HeaderShell>` consume the slot map differently depending on tier.

**Why**: The current dual-tree means `companyName`, `workspaceTitle`, `viewMode`, `projectSlot`, `modeSlot`, and the tour target refs are wired up twice. Any future slot addition has to be added in two places, which already burned us once during the simplify+ pass (indentation drift on the Back button at line 265). A single composition with a tier-aware layout component contains the divergence to one place: how slots render, not which slots exist.

**Alternatives considered**:
- *Keep two trees, add a structural lint*: rejected — lint catches reuse, not "this slot needs to also exist over there."
- *Two component files (`HeaderNarrow.tsx`, `HeaderDesktop.tsx`)*: rejected — same drift problem, different surface.
- *CSS-only responsive (single tree, media queries hide/show)*: rejected — narrow drawer is a stateful overlay (Escape handling, focus trap), not just hidden CSS, so the React tree must adapt.

### Decision 2 — StatusBar groups 13 atoms into 3 product segments, hides four behind tooltips

**Choice**: Re-shape StatusBar into:
- **Left (run state)**: pipeline stage OR run status + project status + pending-interaction badge.
- **Center (work)**: headline (truncate) — tools count + tasks count + employees collapse into a single hover-able cluster `${tools}t · ${tasks}T · ${active}/${total}P`.
- **Right (resources)**: model · energy meter · latency · Stop button (when running) · interaction-mode SegmentedControl · version (always opacity-40 with hover reveal).

Tracking, font-weight, and divider rules unify (one `tracking-wider`, one divider thickness).

**Why**: Currently 13 distinct atoms compete for attention in a 40px footer, each with its own tracking and color rules. The product reads as a debug HUD; the run-state signal (the actually critical one) gets lost between model name and tasks count. Three semantic groups give the eye structure without dropping any data — high-frequency atoms stay visible, low-frequency atoms collapse into hovers.

**Alternatives considered**:
- *Drop atoms entirely* (e.g. delete model name display): rejected — keep all data, just compress.
- *Two segments only (run / resources)*: rejected — headline + tools/tasks/employees deserves its own visual area; folding them into either side overloads it.
- *Vertical stack on narrow*: deferred — current StatusBar is horizontal-only; narrow-viewport StatusBar treatment is out of scope for this change.

### Decision 3 — `<EntityDropdown>` lives in `@offisim/ui-core`, not ui-office

**Choice**: Add `packages/ui-core/src/components/entity-dropdown.tsx` exposing `<EntityDropdown items activeId onSelect footerAction triggerLabel triggerIcon />`. Each item is `{ id, label, badge?, icon? }`. Footer action is `{ label, onSelect }` and renders below a divider. Built on the existing `DropdownMenu` primitive from ui-core.

**Why**: ui-core is the canonical home for shared primitives (per `design-system-consolidation`). The three current consumers (Header CompanySwitcher, ProjectSelector, MarketFilterBar mode/manage tabs) each live in different packages of `packages/ui-office/` and one of them is on the build-order critical path (Header — every workspace switch). Importing from ui-core respects the dependency direction (`ui-office` depends on `ui-core`, never the reverse) and means future consumers (SOP picker, skill picker) get the same primitive without a circular import.

**Alternatives considered**:
- *Lift to `packages/ui-office/src/lib/`*: rejected — lib is for hooks/utils, not React primitives.
- *Stay inline in Header and copy-fix the other two*: rejected — that's exactly the duplication this change exists to remove.
- *Generic `<MenuList>` in ui-core*: rejected — too thin; the EntityDropdown shape (header item + items + footer action) is the recurring pattern, not a flat menu.

### Decision 4 — StudioPalette extracts components, keeps inline-style aesthetic

**Choice**: Carve StudioPalette into:
- `<CategoryHeader collapsed onClick label icon count required?>` — replaces both the asset-category and zone-preset header rows (currently duplicated 14-property `style={{}}` blocks).
- `<CollapseToggle collapsed>` — wraps the rotation transform on the chevron (already migrated from Unicode `▼` to lucide `ChevronDown` during simplify+).
- `<PrefabCard definition isActive onSelect>` and `<ZonePresetCard preset isRequired onStartPlacement>` — already exist as functions; promote them into separate files for readability.

The inline `style={{...}}` aesthetic is preserved because it's load-bearing for Studio's "game-engine asset browser" feel (per the in-file comment) and because the pixel-precise sizing (`width: 28, height: 28, borderRadius: 4`) doesn't translate cleanly to Tailwind's `rem`-based scale at the prefab thumbnail tier. The duplication removal is the goal, not Tailwindification.

**Why**: The biggest maintenance pain in StudioPalette today is that the asset-category header row and the zone-preset group header row are two near-identical 14-property style objects, and the visual drift between them was a flagged issue in the simplify+ review. Extracting `<CategoryHeader>` makes them literally the same component called with different props.

**Alternatives considered**:
- *Convert all StudioPalette inline styles to Tailwind*: rejected — not the source of pain; would also break the deliberate Studio aesthetic.
- *Move helpers into `studio-style-helpers.ts`*: partial — some style objects can become helper functions there, but the components themselves still need to live in the palette file or its siblings.

## Risks / Trade-offs

- **Header tier-driven layout breaks narrow drawer Escape / focus trap** → Verify drawer still registers `aria-modal`, focus traps inside, and Escape closes both drawer and active overlays. Use the existing `useFocusTrap` / `useTopmostEscape` from ui-core (same pattern as ActivityFilterBar narrow sheet).
- **Tour target refs (`useTourTarget`) stop pointing at the right DOM nodes after refactor** → Keep the same five tour slot IDs (`settings:provider-cta`, `office:project-selector`, `personnel:nav-button`, `market:nav-button`, plus desktop/narrow drawer variants) and re-attach to the new slot positions. Live verify by running the onboarding tour at desktop and narrow.
- **StatusBar collapsed atoms hide critical signals at the wrong moment** → Keep pending-interaction, error state, and Stop button in always-visible positions. Only collapse model name, employee utilization, and tools count behind hover (these are high-info-density tooltips, not primary signals).
- **EntityDropdown extraction breaks the existing DropdownMenu consumer behaviors** (collisionPadding, slice(0,8), Active badge formatting, "Manage companies" footer divider) → Build EntityDropdown by literally lifting the current Header `CompanySwitcher` markup into ui-core and only then migrate ProjectSelector + MarketFilterBar to consume it. That way the source-of-truth for the shape is the well-tested CompanySwitcher behavior.
- **StudioPalette extraction changes the rendered pixel output by accident** → Each new sub-component receives the exact same props the current inline render computes; the `style={{...}}` literal moves verbatim. Spot-check by toggling Studio open and comparing palette rows side-by-side at desktop dark + light + narrow.
- **Live verification cost is high** (4 surfaces × 3 viewports × 2 themes = 24 visual checks) → Stage in the order Header → StatusBar → EntityDropdown → StudioPalette so each stage's verification is scoped to one surface; do not bundle.

## Migration Plan

This is a same-session refactor with no rollout, no flag, no migration. Steps:
1. Land Header tier-driven shell. Verify: navigate Office → SOPs → Market → Personnel → Settings → Office at `1440x900`, `1280x800`, `390x844`. Toggle 2D/3D, open + close company switcher, open API Settings dialog. Run onboarding tour from welcome.
2. Land StatusBar 3-segment grouping. Verify: pipeline stage runs, run status changes color, project status changes label, pending-interaction badge appears on permission_request, Stop button appears + disappears, interaction mode toggles in / out of Human, model + tools + employees tooltips reveal on hover.
3. Land `<EntityDropdown>` in ui-core (with its own export from `@offisim/ui-core`). Migrate Header CompanySwitcher → ProjectSelector → MarketFilterBar in three small commits. Verify each surface's open / select / footer action separately.
4. Decompose StudioPalette into sub-components. Verify: open Studio at desktop dark / light, expand and collapse each category, expand and collapse each zone preset group, place a prefab from each category, place a zone preset.

Rollback strategy: each stage is its own branch / commit, so a single revert is sufficient if a stage breaks live verification. No persisted state changes, so reverting is safe.

## Open Questions

- Should the EntityDropdown's footer action support multiple actions (e.g. "Manage" + "Create")? Current consumers all have exactly one footer action. **Default**: single action; extend later if a fourth consumer needs two.
- StatusBar tooltip-only model / tools / employees: do we keep them visible on tablet (`1280x800`) or only at desktop? **Default**: visible at desktop and tablet, hover-only at narrow (matches the existing right-rail collapse behavior in `responsive-app-shell`).
