# studio-asset-edit-contract

## Purpose

Studio's Asset-level interaction surface — selection / move / rotate / delete on placed prefab instances and ghost validity during placement — is formalized so future refactors and adjacent surfaces have a single contract to honor. Selection is gated on zone-edit + zone-match + tool (no scattered checks across pointer handlers); `TransformControls` translate clamps the dragged footprint inside the focused zone every frame so the gizmo can never escape; `R` key + gizmo rotate both snap to 90° increments through the same store action; `Delete` / `Backspace` and an explicit Properties-panel button both call `deleteSelected()` (no confirm dialog); ghost validity is multi-reason (`overlap` / `outside-zone` / `category-not-allowed`) with priority ordering driving a single red/green visual + a one-line label string; the ghost group additionally clamps its visual to the focused zone AABB so the cursor straying past the wall still renders red but the mesh stays pinned at the edge — click placement no-ops via the same blocked reasons. Pure spatial helpers (`clampFootprintToRect`, `footprintInsideRect`, `zoneToFootprintRect`, `resolveWorldFootprint`, `getRotatedSize`) live in `prefab-spatial.ts` so the store stays free of spatial logic and ghost / placed-prefab paths share one footprint resolver.

## Requirements

### Requirement: Studio SHALL gate prefab instance selection on zone-edit + zone match + tool

A prefab instance click SHALL set `selectedInstanceId` only when ALL of the following hold:

1. `useStudioStore.tool ∈ {select, move, rotate}` (NOT `place`).
2. `useStudioStore.isEditingZone === true`.
3. The clicked instance's `zoneId === useStudioStore.focusedZoneId`.

When any condition fails the click SHALL be a no-op for selection — the existing pointer-event still fires (e.g., `stopPropagation()` to prevent canvas pointer-missed) but `selectedInstanceId` is not mutated.

Hover feedback (emissive highlight + cursor: pointer) SHALL be gated by the same three conditions.

#### Scenario: Click in zone-edit on focused zone's prefab selects
- **GIVEN** `tool === 'select' && isEditingZone === true && focusedZoneId === 'z1'`
- **AND** an instance `p1` with `zoneId === 'z1'`
- **WHEN** the user clicks `p1`
- **THEN** `selectedInstanceId === 'p1'`

#### Scenario: Click outside zone-edit does not select
- **GIVEN** `isEditingZone === false` and an instance `p1` is rendered
- **WHEN** the user clicks `p1`
- **THEN** `selectedInstanceId` is unchanged
- **AND** no hover highlight is shown

#### Scenario: Click in zone-edit on a non-focused zone's prefab does not select
- **GIVEN** `isEditingZone === true && focusedZoneId === 'z1'`
- **AND** an instance `p2` with `zoneId === 'z2'`
- **WHEN** the user clicks `p2`
- **THEN** `selectedInstanceId` is unchanged

#### Scenario: Click while tool is 'place' does not select
- **GIVEN** `tool === 'place'`
- **WHEN** the user clicks any instance
- **THEN** `selectedInstanceId` is unchanged

#### Scenario: Hover feedback respects the same gate
- **GIVEN** `isEditingZone === false`
- **WHEN** the user hovers any instance
- **THEN** the cursor remains `default` and no emissive highlight is applied

### Requirement: Selection SHALL persist across tool switches and clear only on explicit paths

`selectedInstanceId` SHALL be cleared by exactly these paths:

- `Escape` key (D1 stack-pop semantics — Asset → Zone clears `selectedInstanceId`)
- `Delete` / `Backspace` key (via `deleteSelected`)
- Properties panel Delete button (via `deleteSelected`)
- Click on empty canvas surface (via `onPointerMissed` → `selectInstance(null)`)
- `unfocusZone()` (D1 contract — clearing selection at Zone-pop)
- `loadZonesFromDb()` (initial load resets selection)

`selectedInstanceId` SHALL NOT be cleared by:

- Switching `tool` between `select`, `move`, `rotate` (any combination).
- Clicking a different placed-prefab instance — that re-targets selection to the new id without going through null.
- Switching `tool` from `place` to any other tool. `cancelPlacement` SHALL clear `placingPrefab` and reset `tool` to `select` but leave `selectedInstanceId` intact (which is already `null` because `startPlacement` cleared it).
- Rotating, moving, or modifying the selected instance.

#### Scenario: Tool switch select → move → rotate keeps selection
- **GIVEN** `selectedInstanceId === 'p1' && tool === 'select'`
- **WHEN** the user clicks the Move tool, then the Rotate tool
- **THEN** `selectedInstanceId === 'p1'` after each switch

#### Scenario: Clicking a different prefab re-targets selection
- **GIVEN** `selectedInstanceId === 'p1'` and instance `p2` is also in the focused zone
- **WHEN** the user clicks `p2`
- **THEN** `selectedInstanceId === 'p2'`
- **AND** the transition does NOT pass through `null` (no flicker of the highlight ring)

#### Scenario: Pointer-missed clears selection but preserves zone focus
- **GIVEN** `selectedInstanceId === 'p1' && focusedZoneId === 'z1' && selectedZoneId === 'z1'`
- **WHEN** the user clicks empty canvas (R3F `onPointerMissed` fires)
- **THEN** `selectedInstanceId === null`
- **AND** `focusedZoneId === 'z1' && selectedZoneId === 'z1'` (preserved by D1 `onPointerMissed` guard)

### Requirement: Move tool SHALL clamp drag inside the focused zone every frame

When `selectedInstanceId !== null && isEditingZone === true && (tool === 'move' || tool === 'select')` and the user drags the selected instance via `TransformControls` translate, the `onObjectChange` handler SHALL on every frame:

1. Read the current world position from the gizmo group (`group.getWorldPosition`).
2. Compute the rotated footprint via `toWorldFootprint(spec.footprint, [pos.x, pos.z], inst.rotation)`.
3. Compute `clamped = clampFootprintToRect(footprint, focusedZoneRect)` where `focusedZoneRect = { cx, cz, halfW: zone.w/2, halfD: zone.d/2 }`.
4. Set `group.position.x = clamped.cx`, `group.position.z = clamped.cz` (writes back to the bound object so the gizmo visual pins to the clamped position).
5. Call `updatePosition(selectedId, [clamped.cx, group.position.y, clamped.cz])` (writes back to the store so persistence is consistent).

The clamp formula SHALL be:

- `clamped.cx = max(zone.cx - zone.halfW + footprint.halfW, min(zone.cx + zone.halfW - footprint.halfW, pos.cx))`
- `clamped.cz = max(zone.cz - zone.halfD + footprint.halfD, min(zone.cz + zone.halfD - footprint.halfD, pos.cz))`

Footprint padding SHALL be included via the existing `toWorldFootprint` (which adds `padding` to `halfW`/`halfD`). Grid snap SHALL apply BEFORE clamp — so the user gets a snapped + clamped position. Zone reassignment via `updateZoneId` SHALL NOT fire during zone-edit drag because clamping prevents the position from leaving the focused zone.

When `isEditingZone === false`, no clamp SHALL be applied — drag remains free, and existing `updateZoneId` re-resolution preserved.

#### Scenario: Drag past zone east edge clamps to zone east edge
- **GIVEN** focused zone `z1` at `(cx=0, cz=0, w=10, d=10)` and selected instance `p1` with footprint `halfW=1.0, padding=0.3`
- **WHEN** the user drags `p1` to world position `(8.5, 0, 2)`
- **THEN** `p1.position[0]` clamps to `5 - (1.0 + 0.3) === 3.7`
- **AND** `p1.position[2]` remains at the original z (within bounds)

#### Scenario: Drag inside zone is unmodified
- **GIVEN** focused zone `z1` at `(cx=0, cz=0, w=10, d=10)` and a drag target `(2, 0, 1.5)`
- **WHEN** drag fires `onObjectChange`
- **THEN** `p1.position` is `[2, 0, 1.5]` (no clamp applied, snap-only)

#### Scenario: Free drag outside zone-edit reassigns zone
- **GIVEN** `isEditingZone === false && selectedInstanceId === 'p1'`
- **WHEN** the user drags `p1` from zone `z1` into zone `z2`'s area
- **THEN** `p1.position` updates without clamp
- **AND** `p1.zoneId === 'z2'` after `updateZoneId` re-resolution

#### Scenario: Grid snap applies before clamp
- **GIVEN** grid snap is enabled (`gridSnap === true`) and the gizmo emits raw position `(3.32, 0, 1.18)`
- **WHEN** `onObjectChange` fires
- **THEN** the snapped value is `(3.5, 0, 1.0)` first
- **AND** then the clamp is applied to that snapped value (no-op if already inside)

### Requirement: Rotate tool SHALL snap to 90° increments via both R key and gizmo

`rotateSelected()` (R key path) SHALL advance `instance.rotation` to the next entry in `[0, 90, 180, 270]` modulo 4. `TransformControls` rotate-mode `onObjectChange` SHALL read the gizmo's Y-axis euler angle, snap to the nearest of `{0, 90, 180, 270}` degrees, and write that exact integer back via `updateRotation(snapped)`.

After rotation, the position SHALL NOT auto-clamp into the zone unless the next translate frame fires. If the rotated footprint exceeds the focused zone's AABB on any axis, the asset MAY visibly overflow zone bounds; this overflow SHALL NOT block the rotation (per design D3).

The R key path SHALL be inert when `selectedInstanceId === null && (selectedZoneId === null || selectedInstanceId !== null)` AND no ghost is active. Specifically, R key precedence (existing behavior preserved) is:

1. If `placingPrefab !== null || placingZonePreset !== null` → `rotateGhost()`.
2. Else if `selectedZoneId !== null && selectedInstanceId === null` → `rotateZone(selectedZoneId)` (Zone-level rotate).
3. Else if `selectedInstanceId !== null` → `rotateSelected()`.
4. Else → no-op.

#### Scenario: R key rotates selected instance 90° clockwise
- **GIVEN** `selectedInstanceId === 'p1'` and `p1.rotation === 0`
- **WHEN** the user presses R
- **THEN** `p1.rotation === 90`

#### Scenario: R key wraps 270 → 0
- **GIVEN** `p1.rotation === 270`
- **WHEN** the user presses R
- **THEN** `p1.rotation === 0`

#### Scenario: Gizmo rotate snaps to nearest 90°
- **GIVEN** gizmo emits Y rotation `1.42 rad` (~81.3°) on `onObjectChange`
- **WHEN** the handler runs
- **THEN** `updateRotation(90)` is called

#### Scenario: Rotation that overflows zone is allowed
- **GIVEN** focused zone `z1` is `3x3` and selected instance `p1` has footprint `halfW=0.5, halfD=2.0` (already 4 deep)
- **WHEN** the user presses R (rotation 0 → 90, footprint becomes `halfW=2.0, halfD=0.5` — 4 wide)
- **THEN** `p1.rotation === 90`
- **AND** no error toast / no rotation-blocked dialog appears
- **AND** the next frame's clamp will pin position so the rotated footprint center is at `cx = 0` (zone center) but the asset visually overflows zone east + west walls

### Requirement: Delete SHALL be reachable via keyboard and Properties panel button

Pressing `Delete` or `Backspace` while `selectedInstanceId !== null` SHALL call `deleteSelected()`, which removes the instance from `instances` and sets `selectedInstanceId === null`.

`StudioProperties` SHALL render a Delete button as the bottom row of the Asset section (visible only when `selectedInstanceId !== null`). The button SHALL be styled as a destructive secondary action (red text, no fill). Clicking it SHALL call `deleteSelected()` — the same store action — without a confirm dialog.

Deletion SHALL set `dirty === true`. The hierarchy level after deletion SHALL pop to Zone if the user was at Asset level via instance selection (now `selectedInstanceId === null`), preserving `selectedZoneId` and `isEditingZone`.

#### Scenario: Delete key removes instance and clears selection
- **GIVEN** `selectedInstanceId === 'p1'`
- **WHEN** the user presses Delete
- **THEN** `instances` no longer contains `p1`
- **AND** `selectedInstanceId === null`
- **AND** `dirty === true`

#### Scenario: Backspace key behaves identically to Delete
- **GIVEN** `selectedInstanceId === 'p1'`
- **WHEN** the user presses Backspace
- **THEN** the same outcome as the Delete key scenario

#### Scenario: Properties panel Delete button calls deleteSelected
- **GIVEN** `selectedInstanceId === 'p1'` and the Properties panel renders the Delete button
- **WHEN** the user clicks the button
- **THEN** `instances` no longer contains `p1`
- **AND** `selectedInstanceId === null`
- **AND** no confirm dialog appeared

#### Scenario: Delete with no selection is a no-op
- **GIVEN** `selectedInstanceId === null`
- **WHEN** the user presses Delete
- **THEN** `instances` is unchanged
- **AND** `dirty` is unchanged

#### Scenario: Delete in zone-edit pops Asset level via instance to Zone
- **GIVEN** `isEditingZone === true && selectedZoneId === 'z1' && selectedInstanceId === 'p1'`
- **WHEN** the user presses Delete
- **THEN** `selectedInstanceId === null && selectedZoneId === 'z1' && isEditingZone === true`
- **AND** the resolved hierarchy level is `'asset'` (because `isEditingZone === true` still resolves to `'asset'` per D1) — Delete only clears the instance pointer, not the edit-zone flag

### Requirement: Ghost validity SHALL surface three concrete invalid reasons

`StudioGhost`'s placement validation SHALL return `{ blocked: boolean, reasons: PlacementInvalidReason[] }` where `PlacementInvalidReason = 'overlap' | 'outside-zone' | 'category-not-allowed'`. `blocked === reasons.length > 0`.

The reasons SHALL be computed as follows:

- `'overlap'` — fires whenever the ghost's rotated world footprint overlaps any existing instance's rotated world footprint (existing logic, unchanged).
- `'outside-zone'` — fires only when `isEditingZone === true && focusedZoneId !== null` AND the ghost's footprint center is outside the focused zone's AABB minus half its rotated footprint (i.e., the footprint visibly crosses a zone wall).
- `'category-not-allowed'` — fires only when `isEditingZone === true && focusedZoneId !== null` AND the focused zone's `allowedCategories` is non-empty AND `placingPrefab.category` is not in that set.

Plot-bounds clamping (existing `Math.max(-halfW, Math.min(halfW, x))`) SHALL be preserved as a silent visual clamp — it SHALL NOT contribute a reason.

When `blocked === true`, the ghost mesh material, ring color, footprint plane color, and footprint wireframe color SHALL all render in the blocked color (existing red — `STUDIO_COLORS.ghostBlocked`). When `blocked === false`, all four render in the valid color (existing green — `STUDIO_COLORS.ghostValid`). The size-label `<Html>` overlay SHALL render the first reason's human-readable text when blocked (priority order: `outside-zone` → `category-not-allowed` → `overlap`), and revert to the size string (`{w}x{d}`) when valid.

The reason-text strings SHALL be:

- `'outside-zone'` → `Outside ${zone.label}`
- `'category-not-allowed'` → `Not allowed in ${zone.label}`
- `'overlap'` → `Overlapping`

Click placement on the ghost floor SHALL early-return when `blocked === true` regardless of which reasons fire.

#### Scenario: Ghost over empty zone area renders valid
- **GIVEN** `isEditingZone === true && focusedZoneId === 'z1'` and ghost at `(0, 0, 0)` inside `z1` with no overlap and `placingPrefab.category` in `z1.allowedCategories`
- **WHEN** the cursor moves
- **THEN** `blocked === false && reasons.length === 0`
- **AND** the ghost renders green
- **AND** the size label reads `${w}x${d}`

#### Scenario: Ghost over existing prefab renders blocked with overlap reason
- **GIVEN** ghost at `(2, 0, 2)` directly over an existing instance `p1`
- **WHEN** the cursor moves
- **THEN** `blocked === true && reasons.includes('overlap')`
- **AND** the ghost renders red
- **AND** the size label reads `Overlapping`

#### Scenario: Ghost outside focused zone in edit mode renders blocked with outside-zone reason
- **GIVEN** `isEditingZone === true && focusedZoneId === 'z1'` and ghost cursor at `(20, 0, 0)` outside `z1`'s AABB
- **WHEN** the cursor moves
- **THEN** `blocked === true && reasons.includes('outside-zone')`
- **AND** the size label reads `Outside ${z1.label}`

#### Scenario: Ghost with disallowed category renders blocked with category reason
- **GIVEN** `isEditingZone === true && focusedZoneId === 'z1' && z1.allowedCategories === ['workspace']`
- **AND** `placingPrefab.category === 'collaboration'`
- **WHEN** the cursor is inside `z1` with no overlap
- **THEN** `blocked === true && reasons.includes('category-not-allowed')`
- **AND** the size label reads `Not allowed in ${z1.label}`

#### Scenario: Ghost outside zone-edit mode does not surface zone reasons
- **GIVEN** `isEditingZone === false` (placement happening at Plot or Zone level, not in edit mode)
- **WHEN** the cursor moves over a zone the prefab category isn't allowed in
- **THEN** `reasons` does NOT contain `'category-not-allowed'` or `'outside-zone'`
- **AND** validity reduces to overlap-only (existing behavior preserved)

#### Scenario: Multiple reasons fire — priority displays outside-zone first
- **GIVEN** ghost is outside `z1` AND overlapping with `p1`
- **WHEN** the size label renders
- **THEN** the displayed reason text is `Outside ${z1.label}` (priority highest)

#### Scenario: Click placement is blocked when any reason fires
- **GIVEN** `blocked === true` (any reason)
- **WHEN** the user clicks the placement floor
- **THEN** `placeInstance` is NOT called
- **AND** `instances` is unchanged

### Requirement: Ghost SHALL clamp visual position to focused zone AABB in zone-edit mode

When `isEditingZone === true && focusedZoneId !== null`, after computing the snapped + plot-clamped cursor position, `StudioGhost` SHALL further clamp the ghost's `groupRef.current.position` to the focused zone's AABB minus the rotated footprint half-extents (same formula as `clampFootprintToRect` in the move contract).

The underlying `blocked` state SHALL be computed BEFORE the visual clamp — so the user still sees a red ghost when they push the cursor outside the zone, but the ghost mesh stays pinned to the zone edge instead of teleporting away. Clicking SHALL still no-op because `blocked === true`.

When `isEditingZone === false`, no zone-clamp SHALL be applied (ghost follows cursor freely within plot bounds).

#### Scenario: Ghost cursor outside zone visually clamps to zone edge
- **GIVEN** `isEditingZone === true && focusedZoneId === 'z1'` with `z1` at `(cx=0, cz=0, w=10, d=10)`
- **AND** ghost footprint half-extents `(halfW=1.0, halfD=1.0)` after padding
- **WHEN** the cursor moves to world `(20, 0, 0)`
- **THEN** the ghost group position is `(4.0, 0, 0)` (clamped: `5 - 1 = 4`)
- **AND** `blocked === true && reasons.includes('outside-zone')`
- **AND** the ghost still renders red

#### Scenario: Ghost cursor inside zone is not clamped
- **GIVEN** ghost cursor at `(2, 0, 2)` inside zone bounds
- **WHEN** the cursor moves
- **THEN** the ghost group position is `(2, 0, 2)` (no clamp)

#### Scenario: Plot-level placement does not clamp to any zone
- **GIVEN** `isEditingZone === false` and the cursor is over a zone
- **WHEN** the cursor moves outside the zone
- **THEN** the ghost group position follows the cursor freely (only plot-bounds clamp applies, existing behavior)

### Requirement: Pure spatial helpers SHALL be added to prefab-spatial.ts without store coupling

The following pure functions SHALL be added to `packages/ui-office/src/lib/prefab-spatial.ts`:

```ts
export function clampFootprintToRect(
  footprint: WorldFootprint,
  rect: { cx: number; cz: number; halfW: number; halfD: number },
): { cx: number; cz: number };

export function footprintInsideRect(
  footprint: WorldFootprint,
  rect: { cx: number; cz: number; halfW: number; halfD: number },
): boolean;
```

`clampFootprintToRect` SHALL clamp the footprint's `cx`/`cz` so the rotated footprint stays inside `rect`'s AABB, returning the clamped center as `{cx, cz}`. `footprintInsideRect` SHALL return `true` iff the footprint lies fully inside `rect`'s AABB (strict-or-equal at edges; touching counts as inside).

Both functions SHALL be allocation-free in the hot path (return plain object literals; no Vector3 / Three.js dependency).

A `zoneToFootprintRect(zone)` adapter SHALL bridge the existing `{cx, cz, w, d}` zone shape to the half-extent shape used here, so consumers do not hand-divide `w/2` / `d/2` at every call site.

#### Scenario: clampFootprintToRect pulls cx into east-edge bound
- **GIVEN** `footprint = {cx: 8, cz: 0, halfW: 1, halfD: 1}` and `rect = {cx: 0, cz: 0, halfW: 5, halfD: 5}`
- **WHEN** `clampFootprintToRect(footprint, rect)` runs
- **THEN** the result is `{cx: 4, cz: 0}` (`5 - 1 = 4`)

#### Scenario: clampFootprintToRect leaves inside footprint untouched
- **GIVEN** `footprint = {cx: 2, cz: -1, halfW: 1, halfD: 1}` and `rect = {cx: 0, cz: 0, halfW: 5, halfD: 5}`
- **WHEN** `clampFootprintToRect(footprint, rect)` runs
- **THEN** the result is `{cx: 2, cz: -1}`

#### Scenario: footprintInsideRect returns true at flush-edge alignment
- **GIVEN** `footprint = {cx: 4, cz: 0, halfW: 1, halfD: 1}` and `rect = {cx: 0, cz: 0, halfW: 5, halfD: 5}`
- **WHEN** `footprintInsideRect(footprint, rect)` runs
- **THEN** the result is `true`

#### Scenario: footprintInsideRect returns false when even slightly outside
- **GIVEN** `footprint = {cx: 4.01, cz: 0, halfW: 1, halfD: 1}` and `rect = {cx: 0, cz: 0, halfW: 5, halfD: 5}`
- **WHEN** `footprintInsideRect(footprint, rect)` runs
- **THEN** the result is `false`
