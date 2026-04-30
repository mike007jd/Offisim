## 1. Stage A — Header tier-driven shell

- [x] 1.1 Audit current `packages/ui-office/src/components/layout/Header.tsx`: enumerate every slot wired into both narrow and desktop trees (companyName, workspaceTitle, viewMode, projectSlot, modeSlot, officeTools, notificationSlot, providerName, needsConfig, drawer items, tour target refs).
- [x] 1.2 Define a single `slots` object inside `Header()` that holds the resolved nodes/values once.
- [x] 1.3 Replace the `if (tier === 'narrow') return <...>; return <...>;` block with a single render that branches the **layout shell** by tier (drawer vs slot grid) but consumes the same `slots` source.
- [x] 1.4 Re-attach the five `useTourTarget` refs (`settings:provider-cta`, `office:project-selector`, `personnel:nav-button`, `market:nav-button`, plus drawer-side refs) to the new slot positions; verify `tour-context` still finds them by slot id at both tiers.
- [x] 1.5 Preserve narrow drawer's accessibility contract: `aria-modal`, focus trap (`useFocusTrap`), Escape close (`useTopmostEscape`), backdrop click close. Reuse the same hooks rather than re-rolling the keydown listener.
- [x] 1.6 Live verify on dev server (`http://127.0.0.1:5176/`) at `1440x900`, `1280x800`, `390x844`: navigate Office → SOPs → Market → Personnel → Settings → Office, toggle 2D/3D, open + close company switcher, open API Settings, run onboarding tour from welcome. Codex live pass: Playwright dev matrix passed all three viewports; narrow drawer Esc/backdrop/focus-trap passed; 2D/3D toggle, CompanySwitcher Active/Manage, and Settings API panel passed. Onboarding initially exposed real narrow target gaps (`office:project-selector` under closed More menu; Personnel/Market refs only inside closed drawer); fixed Header narrow tour refs and reran desktop + 390 tour through Personnel and Market.
- [x] 1.7 Run `pnpm tokens:check`, `pnpm tokens:lint-hex`, `pnpm --filter @offisim/ui-office typecheck && build`, `pnpm --filter @offisim/web typecheck && build`. Stop and fix at first failure.

## 2. Stage B — StatusBar three-segment grouping

- [x] 2.1 Sketch the three segments on paper: **Left** (pipeline-or-run + project status + pending interaction), **Center** (headline + collapsed `Nt · NT · X/YP` cluster), **Right** (model + EnergyMeter + latency + Stop + interaction-mode SegmentedControl + version).
- [x] 2.2 Refactor `packages/ui-office/src/components/layout/StatusBar.tsx` so the three segments are three sibling `<div>`s in a single `flex justify-between`, each owning its atoms.
- [x] 2.3 Collapse model name + active-tools count + employee utilization into a single `WorkCluster` sub-component that renders compact text and exposes the per-atom detail via `title=` tooltip.
- [x] 2.4 Unify divider style and tracking across all three segments (one `tracking-wider`, one `1px bg-border-subtle` divider, one `text-[10px]` baseline).
- [x] 2.5 Keep pending-interaction badge, error state coloring, and Stop button always-visible when their condition fires.
- [x] 2.6 Live verify: trigger pipeline stage transitions (boss task), trigger run/error state, change project status, fire a permission_request to surface the pending badge, click Stop while running, toggle interaction mode in/out of Human, hover the work cluster to confirm tooltips reveal model/tools/employees. Codex live pass: boss run showed `DELIVERING -> READY`; long boss run exposed Stop and click succeeded; direct-chat missing target surfaced StatusBar `ERROR`; created `Live QA Project` and saw status chip; emitted runtime `permission_request` through dev eventBus and saw `AWAITING APPROVAL`; Proxy/Human controls clicked; WorkCluster title showed employee utilization.
- [x] 2.7 Run the full build chain again; fix typecheck/build before moving on.

## 3. Stage C — `<EntityDropdown>` primitive + 3 migrations

- [x] 3.1 Create `packages/ui-core/src/components/entity-dropdown.tsx` exposing `<EntityDropdown items activeId onSelect footerAction triggerLabel triggerIcon align? collisionPadding?>`. Items: `{ id, label, badge?, icon? }`. Footer: `{ label, onSelect, divider? }`. Built atop the existing `DropdownMenu` primitive.
- [x] 3.2 Export `EntityDropdown` and its types from `packages/ui-core/src/index.ts`.
- [x] 3.3 Migrate Header `CompanySwitcher` (`packages/ui-office/src/components/layout/Header.tsx`) to consume `<EntityDropdown>`. Preserve the 8-item slice, "Active" badge, and "Manage companies" footer divider. Live verify: open switcher, select another company, click Manage, confirm Active badge moves.
- [x] 3.4 Migrate `packages/ui-office/src/components/project/ProjectSelector.tsx` to consume `<EntityDropdown>`. Live verify: open at desktop, switch project, confirm Edit / Open folder ribbon still works.
- [x] 3.5 Migrate the dropdown-shaped portion of `packages/ui-office/src/components/marketplace/MarketFilterBar.tsx` (mode + manage tabs) to consume `<EntityDropdown>`. Live verify: open Market, switch between Explore and Manage, switch manage tab.
- [x] 3.6 Run build chain; fix typecheck/build before continuing.

## 4. Stage D — StudioPalette sub-component extraction

- [x] 4.1 Create `packages/ui-office/src/components/studio/StudioPaletteCategoryHeader.tsx` exposing `<CategoryHeader collapsed onClick label icon count required?>` whose body matches the current asset-category and zone-preset header rows verbatim (same `style={{}}` literal, lifted).
- [x] 4.2 Create `packages/ui-office/src/components/studio/StudioPaletteCollapseToggle.tsx` (or fold into CategoryHeader) wrapping the lucide `ChevronDown` + rotation transform.
- [x] 4.3 Refactor `StudioPalette.tsx` so the asset-categories pass and the zone-preset-groups pass each render `<CategoryHeader>` with their respective props. The 14-property duplicated style block disappears.
- [x] 4.4 Promote `PrefabCard` and `ZonePresetCard` into their own files (`StudioPalettePrefabCard.tsx`, `StudioPaletteZonePresetCard.tsx`) so palette top-level reads as data + sub-components, not one 700-line render.
- [x] 4.5 Confirm Studio aesthetic preserved: open Studio at desktop dark and light, expand/collapse each category, expand/collapse each zone preset group, place a prefab from each category, place a zone preset, hover a `required` zone preset to confirm Lock overlay still renders. Codex live pass: dark + light Studio opened; Workspace/Meeting/Library/Rest Area/Server zone preset groups collapsed/expanded; required preset label/lock state visible on hover; placed Small Office zone; PRODUCT asset palette collapsed/expanded Workspace/Infrastructure/Decorative and placed Standard Workstation, Network Switch, Small Plant with Save enabled.
- [x] 4.6 Run build chain. Confirm `pnpm tokens:lint-hex` still passes — the inline-style hex values were already token-routed via `STUDIO_COLORS`.

## 5. Final verification

- [x] 5.1 `pnpm --filter @offisim/ui-core build`
- [x] 5.2 `pnpm tokens:check`
- [x] 5.3 `pnpm tokens:lint-hex`
- [x] 5.4 `pnpm --filter @offisim/ui-office typecheck && pnpm --filter @offisim/ui-office build`
- [x] 5.5 `pnpm --filter @offisim/web typecheck && pnpm --filter @offisim/web build`
- [x] 5.6 Live verify the four touched surfaces side-by-side at desktop/tablet/narrow + dark/light: Header (workspace switching, drawer at narrow, all slot positions), StatusBar (three segments, tooltips, stop, mode toggle), the three EntityDropdown call sites (open/select/manage), StudioPalette (categories, zone presets, prefab cards). Codex live pass: dark/light sweep across 1440x900, 1280x800, 390x844 covered Header + StatusBar + Market/Office routes; EntityDropdown call sites verified for CompanySwitcher Active/Manage, ProjectSelector select + Edit + web workspace-folder state, Market Explore/Manage; StudioPalette verified in dark/light. Dev web ProjectSelector correctly shows `No workspace folder` for a project without a bound folder; desktop file browsing remains Tauri-only.
- [x] 5.7 Tauri release shell: `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`, then open the built `.app` and re-verify Header drawer behavior + Studio palette (the only surfaces where Tauri-specific webview behavior can diverge from web). Codex live release pass: initial release app could not reach narrow tier because `tauri.conf.json` had `minWidth: 1024`; fixed to `360`, rebuilt release `.app`, verified 390x844 hamburger drawer opens, Esc closes, workspace item closes+navigates, and StudioPalette asset categories collapse/select/place in release app (item count 23 -> 24, Save enabled). After the narrow tour-ref fix, reran `pnpm --filter @offisim/web build` and `pnpm --filter @offisim/desktop build`; rebuilt release `.app` attached via Computer Use.
