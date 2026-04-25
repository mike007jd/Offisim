# studio-plot-zone-hierarchy

## Purpose

Studio editing exposes a fixed three-level stack — Plot → Zone → Asset — so users always know "where they are" without inferring from camera focus or palette mode flips. The level is a pure derivation of `useStudioStore` state (`selectedZoneId`, `selectedInstanceId`, `isEditingZone`); a `PlotZoneBreadcrumb` component renders the stack and routes click-segments back up the hierarchy; a single Escape handler in `StudioPage` pops one level at a time with deterministic precedence over ghost placement and the global modal stack; `StudioPalette` switches its presentation by hierarchy level (Plot / Zone share the two-tab layout; zone-edit forces the assets tab and filters prefabs by the active zone's `allowedCategories`); `StudioProperties` carries a one-line hierarchy anchor row at the very top of its scroll container. PlotSize selection is persisted per-company in `localStorage` (`offisim:studio:plot-size:<companyId|create>`) — no DB column, no migration, with a one-shot `:create` → `:<newCompanyId>` migration when create mode resolves to a real company. The contract explicitly does NOT modify 3D rendering (mesh / lighting / materials remain B1 scope) or the existing Zustand action signatures except that `exitEditZone`'s side effect was tightened to clear `focusedZoneId` so Zone level is byte-equivalent to canvas-click selection. The Asset-level interaction surface (zone-edit prefab selection / drag / rotation / deletion / illegal-placement ghost coloring / edge-rebound logic) is formalized in the sibling `studio-asset-edit-contract` capability; this hierarchy contract remains the SSOT for level resolution that the asset-edit contract consumes.

## Requirements

### Requirement: Studio editing surface SHALL expose a fixed Plot → Zone → Asset hierarchy

The Studio editor SHALL treat its editing context as a three-level stack:

1. **Plot level** — no zone selected, no instance selected
2. **Zone level** — a zone is selected (`selectedZoneId !== null`) but `isEditingZone === false`
3. **Asset level** — either entered zone edit (`isEditingZone === true`) or a prefab instance is selected (`selectedInstanceId !== null`)

The current level SHALL be derivable purely from `useStudioStore` state (`plotSize`, `selectedZoneId`, `selectedInstanceId`, `isEditingZone`). No component MAY introduce a parallel `currentLevel` field.

#### Scenario: No selection resolves to Plot level
- **WHEN** Studio mounts and `selectedZoneId === null && selectedInstanceId === null && isEditingZone === false`
- **THEN** the resolved hierarchy level is `'plot'`
- **AND** the breadcrumb shows only the Plot segment as active

#### Scenario: Selecting a zone without entering edit mode resolves to Zone level
- **WHEN** the user clicks a zone in canvas (`selectZone(zoneId)`) and `isEditingZone === false`
- **THEN** the resolved hierarchy level is `'zone'`
- **AND** the breadcrumb shows Plot · Zone with the Zone segment active

#### Scenario: Entering zone edit resolves to Asset level
- **WHEN** the user invokes `enterEditZone(zoneId)`
- **THEN** the resolved hierarchy level is `'asset'`
- **AND** the breadcrumb shows Plot · Zone · Asset with the Asset segment active

#### Scenario: Selecting a placed prefab instance resolves to Asset level
- **WHEN** the user selects a prefab instance (`selectedInstanceId !== null`) regardless of `isEditingZone`
- **THEN** the resolved hierarchy level is `'asset'`

### Requirement: PlotZoneBreadcrumb SHALL render three segments and route clicks back up the stack

A `PlotZoneBreadcrumb` component SHALL be mounted in `StudioPage` between toolbar and canvas. It SHALL render exactly three segments:

- `Plot · {plotName}` — always present, derived from `useStudioStore.plotSize.name`
- `Zone · {zoneLabel}` — present when level ≥ `'zone'`, derived from the zone matching `selectedZoneId`; if level is `'asset'` via instance-only selection (`selectedInstanceId` set, `selectedZoneId` null), the zone is derived from `instance.zoneId`
- `Asset · {assetLabel}` — present when level === `'asset'`, derived from the prefab instance matching `selectedInstanceId` (or the zone label suffixed `· editing` when in edit mode without instance selection)

Clicking a segment SHALL collapse the stack to that level: clicking Plot clears `selectedInstanceId`, `selectedZoneId`, `focusedZoneId`, and exits zone edit; clicking Zone clears `selectedInstanceId` and exits zone edit but keeps `selectedZoneId`. The currently active segment SHALL be visually distinct (full opacity / underline) while inactive segments SHALL be muted (low opacity, hover-cursor).

#### Scenario: Plot segment renders the active PlotSize name
- **WHEN** `plotSize.name === 'Standard Office'`
- **THEN** the first breadcrumb segment text reads `Plot · Standard Office`

#### Scenario: Clicking Plot from Asset level collapses the full stack
- **GIVEN** the user is at Asset level (zone edit mode, instance selected)
- **WHEN** the user clicks the Plot segment
- **THEN** `selectedInstanceId === null && selectedZoneId === null && isEditingZone === false && focusedZoneId === null`
- **AND** the resolved level is `'plot'`

#### Scenario: Clicking Zone from Asset level keeps zone selection
- **GIVEN** the user is at Asset level
- **WHEN** the user clicks the Zone segment
- **THEN** `selectedInstanceId === null && isEditingZone === false`
- **AND** `selectedZoneId` is preserved
- **AND** the resolved level is `'zone'`

#### Scenario: Active segment is visually distinct
- **WHEN** the resolved level is `'zone'`
- **THEN** the Zone segment SHALL render at full opacity with an underline / accent color
- **AND** the Plot segment SHALL render at reduced opacity with a clickable cursor

### Requirement: Escape key SHALL collapse the editing stack one level at a time

A single `keydown` listener registered at `StudioPage` top level SHALL consume `Escape` to perform exactly one level of stack pop, with the following precedence:

1. If a placement ghost is active (`useStudioStore.placingPrefab !== null` or `placingZonePreset !== null`), the listener SHALL cancel placement (existing `cancelPlacement` / `cancelZonePlacement` semantics) and SHALL NOT pop the level.
2. If any modal / dialog from the global modal stack owns the topmost slot (`getTopmostModalId() !== studioStackId`), the StudioPage listener SHALL early-return so the modal handles its own Escape.
3. Otherwise:
   - At Asset level → call `exitEditZone()`, which clears `selectedInstanceId`, `isEditingZone`, and `focusedZoneId`, preserving `selectedZoneId`. Resolved level moves to Zone.
   - At Zone level → call `unfocusZone()`, which clears `selectedZoneId`, `focusedZoneId`, `selectedInstanceId`, and `isEditingZone`. Resolved level moves to Plot.
   - At Plot level → do not consume; let the event bubble.

When the listener consumes the event it SHALL call `event.preventDefault()` and `event.stopPropagation()`. When it declines (precedence 1 cancel-placement still consumes the event; precedence 2 modal-owns-topmost early-returns; Plot-level no-op does NOT mutate the event) it SHALL behave per the corresponding rule.

#### Scenario: Escape at Asset level returns to Zone level
- **GIVEN** `isEditingZone === true && selectedZoneId === 'z1'`
- **WHEN** the user presses Escape
- **THEN** `isEditingZone === false && selectedZoneId === 'z1' && focusedZoneId === null`
- **AND** the resolved level is `'zone'`

#### Scenario: Escape at Asset level with instance selected clears instance
- **GIVEN** `isEditingZone === true && selectedInstanceId === 'p1'`
- **WHEN** the user presses Escape
- **THEN** `selectedInstanceId === null && isEditingZone === false`
- **AND** the resolved level is `'zone'`

#### Scenario: Escape at Zone level returns to Plot level
- **GIVEN** `selectedZoneId === 'z1' && isEditingZone === false && selectedInstanceId === null`
- **WHEN** the user presses Escape
- **THEN** `selectedZoneId === null`
- **AND** the resolved level is `'plot'`

#### Scenario: Escape during ghost placement is not consumed by the level handler
- **GIVEN** `useStudioStore.placingPrefab !== null` or `placingZonePreset !== null`
- **WHEN** the user presses Escape
- **THEN** placement is cancelled (existing semantics preserved)
- **AND** no level pop fires

#### Scenario: Escape at Plot level does not consume the event
- **GIVEN** the resolved level is `'plot'`
- **WHEN** the user presses Escape
- **THEN** the level handler does not call `preventDefault`

### Requirement: PlotSize selection SHALL persist across reloads via localStorage

Studio SHALL persist the active `plotSize.name` to `localStorage` keyed by company:

- Edit mode: key = `offisim:studio:plot-size:${companyId}`
- Create mode: key = `offisim:studio:plot-size:create` (the `'create'` suffix is exposed as `CREATE_PLOT_KEY` in `studio-plot-size-storage.ts`)

On Studio mount, the store SHALL hydrate `plotSize` by reading the key; if absent or the stored value does not match a `PLOT_SIZES` entry, it SHALL fall back to `Standard Office` (`DEFAULT_PLOT_SIZE`). On `setPlotSize(next)`, the store SHALL early-return if the new value's name equals the current `plotSize.name` (no `localStorage` write, no `dirty` flip); otherwise the new name SHALL be written to the key. When create mode transitions to edit mode (a new company is created), the value at `:create` SHALL be migrated to `:${newCompanyId}` exactly once and then `:create` SHALL be removed; this migration runs inside `resetForCompany(newCompanyId)`.

The PlotSize SHALL NOT be persisted to any database table; no migration in `db-local` or `db-platform` is permitted by this change.

#### Scenario: PlotSize choice survives a reload
- **GIVEN** the user is editing company `c1` and selects `Large Office`
- **WHEN** the page reloads and the user re-enters Studio for `c1`
- **THEN** `plotSize.name === 'Large Office'`

#### Scenario: First-time entry defaults to Standard Office
- **GIVEN** `localStorage` has no `offisim:studio:plot-size:c1` entry
- **WHEN** the user opens Studio for `c1`
- **THEN** `plotSize.name === 'Standard Office'`

#### Scenario: Create-mode preference migrates to the new company
- **GIVEN** the user is in create mode and selects `Campus`, then completes company creation yielding `companyId === 'c2'`
- **WHEN** the user lands in edit mode for `c2`
- **THEN** `localStorage['offisim:studio:plot-size:c2'] === 'Campus'`
- **AND** `localStorage['offisim:studio:plot-size:create']` is absent

#### Scenario: Corrupted stored value falls back to default
- **GIVEN** `localStorage['offisim:studio:plot-size:c1'] === 'Mars Base'` (not in `PLOT_SIZES`)
- **WHEN** the user opens Studio for `c1`
- **THEN** `plotSize.name === 'Standard Office'`

#### Scenario: PlotSize is not stored in any database table
- **WHEN** the user changes PlotSize in Studio
- **THEN** no row in `companies`, `zones`, `prefab_instances`, or any other table is mutated

#### Scenario: Re-clicking the active PlotSize button is a no-op
- **GIVEN** `plotSize.name === 'Large Office'` and `dirty === false`
- **WHEN** the user clicks the `Large Office` button in `StudioPlotSelector` again
- **THEN** `plotSize` reference is unchanged
- **AND** `dirty` SHALL NOT flip to `true`
- **AND** no `localStorage.setItem` call SHALL fire

### Requirement: Palette SHALL switch presentation by hierarchy level

`StudioPalette` SHALL render based on the resolved hierarchy level:

- **Plot level** and **Zone level**: render the existing two-tab layout (`assets | zones`). Both levels share the same render path; differentiation between "no zone selected" and "zone selected" is delegated to the Properties panel anchor row.
- **Asset level via zone edit** (`isEditingZone === true`): force the active tab to `assets` and filter the prefab list to the current zone's `allowedCategories`. The `zones` tab SHALL render disabled with `title="Available outside zone edit"` and `cursor: not-allowed` (NOT hidden — the affordance must remain visible).
- **Asset level via instance selection** (no zone edit): render unchanged (instance selection does not alter palette).

The filter in zone edit SHALL NOT inject any implicit category (no automatic `decorative` override or similar). The set of allowed categories is exactly `currentZone.allowedCategories`.

#### Scenario: Plot level shows both palette tabs
- **GIVEN** the resolved level is `'plot'`
- **WHEN** the user opens the Palette
- **THEN** both `assets` and `zones` tabs are visible and enabled
- **AND** the user may switch between them freely

#### Scenario: Zone level keeps both palette tabs
- **GIVEN** the resolved level is `'zone'` (zone selected, edit mode off)
- **WHEN** the user opens the Palette
- **THEN** both `assets` and `zones` tabs are visible and enabled

#### Scenario: Entering zone edit forces assets tab and disables zones tab
- **GIVEN** the user clicks `Enter zone edit` on a selected zone
- **WHEN** `isEditingZone` becomes `true`
- **THEN** the active palette tab is `assets`
- **AND** the `zones` tab SHALL render with `disabled` attribute and `title="Available outside zone edit"`
- **AND** the user cannot switch to `zones` tab while in edit mode

#### Scenario: Asset filter respects zone allowedCategories
- **GIVEN** the active zone's `allowedCategories === ['workspace', 'collaboration']`
- **WHEN** the palette renders in zone edit mode
- **THEN** only prefabs whose `semanticCategory` is in `['workspace', 'collaboration']` appear
- **AND** prefabs in other categories are hidden

#### Scenario: Empty allowedCategories falls back to showing all prefabs
- **GIVEN** the active zone's `allowedCategories === []` or is undefined
- **WHEN** the palette renders in zone edit mode
- **THEN** all prefabs are shown
- **AND** no empty-state placeholder is displayed

#### Scenario: Filtered list with no matches shows empty state
- **GIVEN** `allowedCategories === ['knowledge']` and no prefab in the catalog has `semanticCategory === 'knowledge'`
- **WHEN** the palette renders in zone edit mode
- **THEN** an empty-state message reads "No prefabs allowed in this zone"

### Requirement: Properties panel SHALL display a hierarchy anchor row

`StudioProperties` SHALL render a single anchor row at the very top of its scroll container, derived from the resolved hierarchy level:

- Plot level: `Plot · {plotSize.name}`
- Zone level: `Zone · {zoneLabel}`
- Asset level (zone edit, no instance): `Zone · {zoneLabel} · editing`
- Asset level (instance selected): `Asset · {prefabName}`

The anchor row SHALL be visually subordinate (small text, muted color) to the existing properties content and SHALL NOT consume more than one text line. It SHALL be `flexShrink: 0` inside the panel's flex column so that the existing scrolling content below is unaffected.

#### Scenario: Plot-level anchor reflects PlotSize
- **GIVEN** no selection and `plotSize.name === 'Standard Office'`
- **WHEN** the Properties panel renders
- **THEN** the anchor row reads `Plot · Standard Office`

#### Scenario: Zone-level anchor reflects zone label
- **GIVEN** `selectedZoneId === 'z1'` and the zone's `label === 'Workspace'`
- **WHEN** the Properties panel renders
- **THEN** the anchor row reads `Zone · Workspace`

#### Scenario: Asset-level anchor in zone edit reflects edit state
- **GIVEN** `isEditingZone === true && selectedInstanceId === null`
- **WHEN** the Properties panel renders
- **THEN** the anchor row reads `Zone · {zoneLabel} · editing`

#### Scenario: Asset-level anchor for selected prefab reflects prefab name
- **GIVEN** `selectedInstanceId === 'p1'` and the prefab definition's `name === 'Standing Desk'`
- **WHEN** the Properties panel renders
- **THEN** the anchor row reads `Asset · Standing Desk`

### Requirement: Hierarchy contract SHALL NOT alter zone-edit interaction or 3D rendering

This change SHALL NOT modify any of:

- 3D mesh, lighting, materials, or any Three.js geometry (B1 / GPT 5.5 art-pass scope)
- The `enterEditZone` / `selectZone` / `focusZone` / `selectInstance` Zustand action signatures
- The `companies` / `zones` / `prefab_instances` table schemas

`exitEditZone`'s side effect set is the only existing action whose behaviour was tightened: it now also clears `focusedZoneId` (in addition to `selectedInstanceId` and `isEditingZone`) so Zone level is byte-equivalent to canvas-click selection. `selectedZoneId` is preserved so the user lands on Zone level rather than Plot. No new action was added to the store.

The Asset-level interaction surface — prefab instance selection / drag / rotation / deletion behavior inside zone edit, illegal-placement ghost coloring, and edge-rebound logic — was originally carved out as D2 scope and is now formalized in the `studio-asset-edit-contract` capability. The hierarchy contract defined here remains the SSOT for level resolution; the asset-edit contract consumes that resolution to gate selection and drag.

#### Scenario: Existing prefab drag inside zone edit is unaffected
- **GIVEN** the user is in zone edit and drags a placed prefab instance
- **WHEN** the drag completes within the zone bounds
- **THEN** the instance position updates exactly as before this change (same handler, same persistence path)
- **AND** any zone-bounds clamping during drag is governed by the `studio-asset-edit-contract` capability, not by this hierarchy contract

#### Scenario: No new database tables or columns
- **WHEN** this change is applied
- **THEN** `db-local/src/schema.ts` and `db-platform/src/schema.ts` SHALL be unchanged
- **AND** no new migration file SHALL be added under `db-local/src/migrations/` or `db-platform/src/migrations/`

#### Scenario: 3D scene rendering is byte-equivalent
- **WHEN** PlotSize, breadcrumb, and palette filter changes are applied
- **THEN** the 3D scene mesh / lighting / materials produced by `StudioCanvas` SHALL render identically to the pre-change baseline (no new Three.js nodes, no material parameter changes)
