## MODIFIED Requirements

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
