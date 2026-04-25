## ADDED Requirements

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

A new component `PlotZoneBreadcrumb` SHALL be mounted in `StudioPage` between toolbar and canvas. It SHALL render exactly three segments:

- `Plot · {plotName}` — always present, derived from `useStudioStore.plotSize.name`
- `Zone · {zoneLabel}` — present when level ≥ `'zone'`, derived from the zone matching `selectedZoneId`
- `Asset · {assetLabel}` — present when level === `'asset'`, derived from the prefab instance matching `selectedInstanceId` (or the zone label suffixed `· editing` when in edit mode without instance selection)

Clicking a segment SHALL collapse the stack to that level: clicking Plot clears `selectedInstanceId`, `selectedZoneId`, and exits zone edit; clicking Zone clears `selectedInstanceId` and exits zone edit but keeps `selectedZoneId`. The currently active segment SHALL be visually distinct (full opacity / underline) while inactive segments SHALL be muted (low opacity, hover-cursor).

#### Scenario: Plot segment renders the active PlotSize name
- **WHEN** `plotSize.name === 'Standard Office'`
- **THEN** the first breadcrumb segment text reads `Plot · Standard Office`

#### Scenario: Clicking Plot from Asset level collapses the full stack
- **GIVEN** the user is at Asset level (zone edit mode, instance selected)
- **WHEN** the user clicks the Plot segment
- **THEN** `selectedInstanceId === null && selectedZoneId === null && isEditingZone === false`
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

1. If a placement ghost is active (`useStudioStore.placement.active === true`), the listener SHALL NOT consume Escape (placement cancels itself first).
2. If any modal / dialog from the global modal stack is open, the listener SHALL NOT consume Escape.
3. Otherwise:
   - At Asset level → call `exitEditZone()` (and clear `selectedInstanceId` if set), which moves the level to Zone (preserving `selectedZoneId`).
   - At Zone level → call `clearSelection()` (clears `selectedZoneId`), which moves the level to Plot.
   - At Plot level → do not consume; let the event bubble.

When the listener consumes the event it SHALL call `event.preventDefault()` and `event.stopPropagation()`. When it declines (precedence 1, 2, or Plot-level no-op) it SHALL NOT mutate the event.

#### Scenario: Escape at Asset level returns to Zone level
- **GIVEN** `isEditingZone === true && selectedZoneId === 'z1'`
- **WHEN** the user presses Escape
- **THEN** `isEditingZone === false && selectedZoneId === 'z1'`
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
- **GIVEN** `useStudioStore.placement.active === true`
- **WHEN** the user presses Escape
- **THEN** the level handler does not call `preventDefault`
- **AND** the existing placement-cancel logic runs unaltered

#### Scenario: Escape at Plot level does not consume the event
- **GIVEN** the resolved level is `'plot'`
- **WHEN** the user presses Escape
- **THEN** the level handler does not call `preventDefault`

### Requirement: PlotSize selection SHALL persist across reloads via localStorage

Studio SHALL persist the active `plotSize.name` to `localStorage` keyed by company:

- Edit mode: key = `offisim:studio:plot-size:${companyId}`
- Create mode: key = `offisim:studio:plot-size:create`

On Studio mount, the store SHALL hydrate `plotSize` by reading the key; if absent or the stored value does not match a `PLOT_SIZES` entry, it SHALL fall back to `Standard Office`. On `setPlotSize(next)`, the new value's name SHALL be written to the key. When create mode transitions to edit mode (a new company is created), the value at `:create` SHALL be migrated to `:${newCompanyId}` exactly once and then `:create` SHALL be removed.

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

### Requirement: Palette SHALL switch presentation by hierarchy level

`StudioPalette` SHALL render based on the resolved hierarchy level:

- **Plot level** and **Zone level**: render the existing two-tab layout (`assets | zones`). Both levels share the same render path; differentiation between "no zone selected" and "zone selected" is delegated to the Properties panel anchor row.
- **Asset level via zone edit** (`isEditingZone === true`): force the active tab to `assets` and filter the prefab list to the current zone's `allowedCategories`.
- **Asset level via instance selection** (no zone edit): render unchanged (instance selection does not alter palette).

#### Scenario: Plot level shows both palette tabs
- **GIVEN** the resolved level is `'plot'`
- **WHEN** the user opens the Palette
- **THEN** both `assets` and `zones` tabs are visible
- **AND** the user may switch between them freely

#### Scenario: Zone level keeps both palette tabs
- **GIVEN** the resolved level is `'zone'` (zone selected, edit mode off)
- **WHEN** the user opens the Palette
- **THEN** both `assets` and `zones` tabs are visible

#### Scenario: Entering zone edit forces assets tab
- **GIVEN** the user clicks `Enter zone edit` on a selected zone
- **WHEN** `isEditingZone` becomes `true`
- **THEN** the active palette tab is `assets`
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
- Asset level (zone edit): `Zone · {zoneLabel} · editing`
- Asset level (instance selected): `Asset · {prefabName}`

The anchor row SHALL be visually subordinate (small text, muted color) to the existing properties content and SHALL NOT consume more than one text line.

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

- Prefab instance selection / drag / rotation / deletion behavior inside zone edit (D2 scope)
- Illegal-placement ghost coloring or rebound logic (D2 scope)
- 3D mesh, lighting, materials, or any Three.js geometry (B1 / GPT 5.5 scope)
- The `enterEditZone` / `selectZone` / `focusZone` / `selectInstance` Zustand action signatures
- The `companies` / `zones` / `prefab_instances` table schemas

New Zustand actions `exitEditZone()` and `clearSelection()` MAY be added if not already present, but existing actions MUST retain their current signatures and side effects.

#### Scenario: Existing prefab drag inside zone edit is unaffected
- **GIVEN** the user is in zone edit and drags a placed prefab instance
- **WHEN** the drag completes within the zone bounds
- **THEN** the instance position updates exactly as before this change (same handler, same persistence path)

#### Scenario: No new database tables or columns
- **WHEN** this change is applied
- **THEN** `db-local/src/schema.ts` and `db-platform/src/schema.ts` SHALL be unchanged
- **AND** no new migration file SHALL be added under `db-local/src/migrations/` or `db-platform/src/migrations/`

#### Scenario: 3D scene rendering is byte-equivalent
- **WHEN** PlotSize, breadcrumb, and palette filter changes are applied
- **THEN** the 3D scene mesh / lighting / materials produced by `StudioCanvas` SHALL render identically to the pre-change baseline (no new Three.js nodes, no material parameter changes)
