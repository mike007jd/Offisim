## Why

D1 (`studio-plot-zone-hierarchy`) explicitly carved out the Asset-level interaction surface as D2 scope: "Prefab instance selection / drag / rotation / deletion behavior inside zone edit" and "Illegal-placement ghost coloring or rebound logic" both remain implicit in code today. The current implementation works for the happy path but has three gaps that hurt the "you always know where you are, what's legal, what changed" feel D1 set up:

1. **No zone-bounds enforcement during instance drag.** `StudioPlacedPrefabs` `TransformControls` lets a selected prefab fly past the focused zone's edge during translate; `handleObjectChange` only re-resolves zone assignment after the fact. There's no clamp to zone bounds, no rebound, and no visual signal that the drag is straying out of bounds.
2. **Ghost validity is a single boolean over a single reason.** `StudioGhost.checkOverlap` only flags prefab-prefab AABB collision. Ghost stays green even when (a) the cursor is outside the focused zone in zone-edit mode, (b) the placing prefab's category is not in the active zone's `allowedCategories`, or (c) the cursor is outside plot bounds (currently silently clamped — no red feedback). Users learn placement is illegal only by seeing the click do nothing.
3. **Selection / move / rotate / delete contracts are scattered.** Gating logic lives in three files (`StudioCanvas.ZoneFloor.onPointerDown`, `StudioPlacedPrefabs.handleClick`, `StudioPage` keydown handler) with overlapping `tool === 'select' | 'move' | 'rotate'` + `isEditingZone` + `focusedZoneId` checks. None of it is spec'd, so future refactors have nothing to honor.

This change formalizes the implicit contract and closes the three gaps so D2 can be archived with the same hygiene as D1.

## What Changes

- **Selection contract** — Specify the gate for prefab selection: requires zone-edit mode, requires `instance.zoneId === focusedZoneId`, accepted under `tool ∈ {select, move, rotate}`. Pointer-missed inside the canvas clears `selectedInstanceId` only (preserves `selectedZoneId` when a zone is focused, matching D1 behavior). Tool switch from `place` cancels placement but does NOT clear `selectedInstanceId`.
- **Move contract** — `TransformControls` translate clamps the dragged prefab's footprint to the focused zone's AABB on every `onObjectChange` frame. If the user drags past an edge, the gizmo snaps back into the zone every frame (no rebound animation needed — clamping IS the rebound at 60fps). Zone reassignment via `updateZoneId` only fires when the prefab actually crosses to a new zone (which can't happen in zone-edit mode because clamping prevents it; preserved for selection-only drag outside edit mode if reachable).
- **Rotate contract** — R key rotates the selected instance 90° clockwise via `rotateSelected()` when no ghost is active and no zone is selected solo. Gizmo `rotate` mode snaps to the nearest 90° on `onObjectChange`. Snap precedence: gizmo writes back to store via `updateRotation(snapped)`. Both paths yield the same store state.
- **Delete contract** — Delete / Backspace key calls `deleteSelected()`, which removes the instance and clears `selectedInstanceId`. The Properties panel SHALL render an explicit Delete button at the bottom of the Asset section that calls the same action; no separate confirm dialog (the action is immediate and reversible only via re-place; this matches D1's "no surprise dialogs" stance).
- **Ghost validity is multi-reason** — `StudioGhost` SHALL surface three concrete invalid reasons: `overlap` (existing — prefab-prefab footprint overlap), `outside-zone` (NEW — in zone-edit mode the ghost cursor is outside the focused zone's AABB), `category-not-allowed` (NEW — placing prefab's `category` is not in `focusedZone.allowedCategories` and `allowedCategories` is non-empty). Plot-bounds clamping is preserved as silent clamp (NOT a validity failure). The ghost ring + footprint plane + wire color SHALL render red whenever any reason is active. Click placement SHALL early-return when any reason is active.
- **Edge rebound for ghost** — When the cursor moves outside the focused zone in zone-edit mode, the ghost SHALL clamp its footprint center to the zone AABB minus half the rotated footprint (so the visible footprint stays inside the zone). Clamping is visual only — the underlying invalid state remains red so the user gets the "you can't put it here" message; clicking still no-ops.
- **No new store actions, no new DB columns.** All behavior derives from existing `useStudioStore` actions + new pure helpers in `prefab-spatial.ts` and `StudioGhost`.

## Capabilities

### New Capabilities
- `studio-asset-edit-contract`: Captures the formalized Asset-level interaction surface — selection gate, drag-clamp-to-zone, rotation snap, deletion path, multi-reason ghost validity, and the edge-rebound clamp during placement and during selected-instance drag.

### Modified Capabilities
- `studio-plot-zone-hierarchy`: Closes the D2 carve-out by removing the "(D2 scope)" deferral language from Requirement 6 and pointing to the new capability.

## Impact

- **Code touched**:
  - `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx` — `handleObjectChange` adds zone-bounds clamp; selection-callback gate moves to a shared helper.
  - `packages/ui-office/src/components/studio/StudioGhost.tsx` — `checkOverlap` becomes `validatePlacement` returning `{ blocked: boolean, reasons: ('overlap'|'outside-zone'|'category-not-allowed')[] }`; pointer-move clamps cursor to focused zone AABB when in edit mode.
  - `packages/ui-office/src/components/studio/StudioPage.tsx` — keydown handler unchanged in shape but spec'd; comment block updated.
  - `packages/ui-office/src/components/studio/StudioProperties.tsx` — Asset section gains a Delete button row.
  - `packages/ui-office/src/lib/prefab-spatial.ts` — adds `clampFootprintToRect(footprint, zoneRect)` and `footprintInsideRect(footprint, zoneRect)` pure helpers (no allocations in hot path; reuse existing `WorldFootprint` shape).
- **Specs touched**: 1 new (`studio-asset-edit-contract`), 1 modified delta (`studio-plot-zone-hierarchy` closes Requirement 6 carve-out).
- **No DB migrations.** No schema changes in `db-local` / `db-platform`. No new Zustand actions. No new ipc / events.
- **No protocol-ledger row** affected (Studio is internal UI; no upstream protocol).
- **Risk surface**: `TransformControls` clamping done inside `onObjectChange` runs at drag-frame rate — must avoid per-frame allocations (re-use the existing `_pos` / `_euler` pre-allocations). Edge case: rotating an asset whose footprint exceeds zone AABB after rotation (e.g., 2x6 prefab rotated 90° in a 3x3 zone) — clamp will pin the asset against the zone wall and visually overlap the boundary; spec must accept this since blocking rotation would be more surprising than visible overflow. Live verify must hit this case.
