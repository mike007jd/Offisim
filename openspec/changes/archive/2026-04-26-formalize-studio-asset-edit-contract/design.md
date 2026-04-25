## Context

D1 (`studio-plot-zone-hierarchy`, archived 2026-04-26) shipped the Plot → Zone → Asset hierarchy as a pure derivation of `useStudioStore` state and explicitly carved out Asset-level interaction as D2 scope. Studio's prefab interaction code already exists across three files (`StudioCanvas.tsx`, `StudioPlacedPrefabs.tsx`, `StudioGhost.tsx`), works for the happy path, but has no formal contract — selection / move / rotate / delete logic is scattered across overlapping pointer handlers and a `StudioPage` keydown switch, and ghost validity collapses several distinct illegality reasons into one boolean.

The three concrete defects this change closes:

1. `StudioPlacedPrefabs.handleObjectChange` writes the world position back to the store without zone-bounds clamping. A user dragging in zone-edit mode can pull a prefab past the focused zone's edge; the visual escapes, the zone reassignment fires (`updateZoneId`), and the user is now editing across zones — which contradicts the D1 zone-edit invariant ("interaction restricted to focused zone only").
2. `StudioGhost.checkOverlap` flags only prefab-prefab AABB collision. Ghost stays green when the cursor is outside the focused zone, when the placing prefab's category is not in `zone.allowedCategories`, or when the cursor is past plot bounds. The user clicks, nothing happens, and there's no signal why.
3. R, Delete, Backspace, Escape keymap is in `StudioPage` keydown handler but not in any spec. A future refactor (or a different surface adopting the same pattern) has nothing to honor.

## Goals / Non-Goals

**Goals:**
- Spec the Asset-level interaction contract: which actions are accepted, under which `tool` × `isEditingZone` × `focusedZoneId` × selection state, and what happens to store fields after each action.
- Make ghost validity multi-reason (`overlap` / `outside-zone` / `category-not-allowed`) and ensure all reasons render the same red visual + block placement click.
- Clamp `TransformControls` translate to the focused zone's AABB on every `onObjectChange` frame so a selected prefab can never escape its zone in zone-edit mode.
- Add an explicit Delete affordance to the Properties panel's Asset section so the action isn't keyboard-only.

**Non-Goals:**
- 3D rendering changes (mesh / lighting / materials / animation) — B1 / GPT 5.5 art-pass scope.
- Drag-to-reassign-zone outside zone-edit mode — current behavior (`updateZoneId` fires after move) is preserved but unused inside zone-edit because clamping prevents crossing.
- Multi-select / box-select / copy-paste — out of scope; Studio remains single-select.
- Undo / Redo for asset operations — `dirty` flag remains the only safety net; `Ctrl+Z` is not added.
- New Zustand actions, new DB columns, new ipc events. All behavior derives from existing state via new pure helpers.
- Fancy rebound animation. Per-frame clamp at 60fps IS the rebound; no spring physics.

## Decisions

### D1: Multi-reason ghost validity vs. single boolean

**Choice:** Replace `checkOverlap` with `validatePlacement` returning `{ blocked: boolean, reasons: PlacementInvalidReason[] }` where `PlacementInvalidReason = 'overlap' | 'outside-zone' | 'category-not-allowed'`. The ghost continues to render a single red/green visual driven by `blocked`; `reasons` drives an optional 1-line tooltip text in the size-label `<Html>` overlay (e.g., `"Outside Workspace zone"`, `"Not allowed in Workspace"`, `"Overlapping desk"`). Click placement early-returns when `blocked === true` regardless of reasons.

**Why:** A single boolean was fine when there was one reason. With three reasons, users need to know *why* placement is blocked or they'll bounce around trying random spots. Surfacing reasons via tooltip (not a modal, not a toast) keeps the flow fast and discoverable.

**Alternatives considered:**
- Multiple ghost colors per reason — rejected; users won't memorize a color legend.
- Inline error text overlay full-width across the canvas — rejected; too noisy for a transient state.

### D2: Where to clamp during placed-instance drag

**Choice:** Clamp inside `handleObjectChange` in `StudioPlacedPrefabs.tsx` — read the focused zone from `useStudioStore.getState()`, compute `clampFootprintToRect(toWorldFootprint(spec.footprint, [_pos.x, _pos.z], inst.rotation), zone)`, write the clamped center back via `group.position.set(clamped.cx, _pos.y, clamped.cz)` AND via `updatePosition(selectedId, [clamped.cx, _pos.y, clamped.cz])`. Both writes are necessary: store write keeps the model consistent; group write keeps the gizmo visually pinned during the drag (TransformControls reads from the bound object and would otherwise lag the store by one frame).

**Why:** The clamp must happen in the same frame as the gizmo move so the user sees the prefab "rebound" into the zone every frame they drag past the edge. Doing it in a `useEffect` watching position would lag by one render and feel mushy.

**Alternatives considered:**
- Clamp only on `onMouseUp` (drag end) — rejected; user sees prefab outside zone for the entire drag, then it teleports back. Surprising and ugly.
- Disable TransformControls when cursor leaves zone — rejected; drei `TransformControls` doesn't expose pointer-bounded enable/disable cleanly, and toggling enabled mid-drag drops the gizmo.
- Add a Zustand action like `setSelectedPositionWithinZone` — rejected; couples the store to spatial knowledge it doesn't otherwise need. Pure helpers in `prefab-spatial.ts` keep store thin.

### D3: Rotation overflow when footprint exceeds zone after rotate

**Choice:** When the user rotates a selected prefab whose rotated footprint no longer fits inside the focused zone (e.g., a 1x4 prefab rotated 90° in a 3x3 zone), allow the rotation but clamp position to keep the footprint center as close to the zone center as the AABB permits. The asset will visually overflow zone bounds; we accept the overflow rather than block the rotation.

**Why:** Blocking rotation would surprise users (they pressed R, nothing happened, no feedback). The visual overflow is self-explanatory — user sees "doesn't fit" and either undoes the rotation or moves to a bigger zone.

**Alternatives considered:**
- Block rotation if footprint can't fit, with a toast — rejected; toast for a frequent action is noisy.
- Auto-shrink the prefab — rejected; prefabs have fixed semantic dimensions.

### D4: Delete affordance placement

**Choice:** Add a single Delete row in `StudioProperties` Asset section, immediately below the rotation control row, rendered as a destructive secondary button (red text, no fill). No confirm dialog. Delete via Backspace / Delete keys remains intact. Both paths call `useStudioStore.getState().deleteSelected()`.

**Why:** Keyboard-only delete has poor discoverability; users moving from a touch-first or mouse-only flow miss it. A confirm dialog is overkill — the action is reversible by re-placing a prefab from the palette, and `dirty` already protects against losing the whole edit.

**Alternatives considered:**
- Trash icon next to the prefab in the canvas — rejected; clutters 3D view.
- Right-click context menu — rejected; Studio doesn't have any other context menus, adding one for a single action is over-engineering.

### D5: Selection clearing on tool switch

**Choice:** Switching `tool` from `place` → anything else cancels placement (existing behavior) but does NOT clear `selectedInstanceId`. Switching between `select` / `move` / `rotate` does NOT clear `selectedInstanceId`. Only `Escape`, `clearSelection`-equivalent paths (clicking in empty canvas via `onPointerMissed`), `deleteSelected`, `unfocusZone`, and `loadZonesFromDb` clear it.

**Why:** Users frequently rotate-then-move-then-rotate the same prefab. Clearing selection on tool switch breaks the flow.

**Alternatives considered:**
- Clear selection on every tool switch for simplicity — rejected; degrades the most common workflow.

## Risks / Trade-offs

- **Per-frame clamp allocation risk** → Reuse the existing pre-allocated `_pos` / `_euler` in `StudioPlacedPrefabs`. Add `_clamped` Vector3 alongside. `clampFootprintToRect` returns a plain object; we read `.cx` / `.cz` and discard. Acceptable for <100 instances; if perf degrades, hoist to a stable scratch object.
- **Rotation overflow visible boundary cross** (D3) → Accepted trade-off. Spec scenario explicitly captures this.
- **Ghost reason tooltip in zone-edit but no zone selected** → Cannot happen by construction: zone-edit requires `focusedZoneId`. Spec asserts this as an invariant rather than handling it.
- **"Outside-zone" reason fires while ghost is over plot but no zone exists at that point** → In Plot level (no zone selected), the `outside-zone` reason SHALL NOT fire — that reason only applies in zone-edit mode. In Plot level, ghost validity reduces to overlap-only, matching current behavior. Spec captures this gate explicitly.
- **drei `TransformControls` quirk: `onObjectChange` fires before raycast settles on first frame** → Existing code already handles this via `_pos = group.getWorldPosition()`. No new exposure.

## Migration Plan

Single-PR rollout:
1. Add `clampFootprintToRect` + `footprintInsideRect` helpers to `prefab-spatial.ts` with unit-style sanity checks (compile-time only — no test runner).
2. Refactor `StudioGhost.checkOverlap` → `validatePlacement` returning `{ blocked, reasons }`. Update all call sites in the same file.
3. Wire ghost reason tooltip into the existing size-label `<Html>` overlay (replace `2x2` text with reason string when blocked, restore size text when valid).
4. Update `StudioPlacedPrefabs.handleObjectChange` to clamp inside zone-edit mode.
5. Add Delete button to `StudioProperties` Asset section.
6. Update D1 spec (`studio-plot-zone-hierarchy/spec.md`) Requirement 6 to drop the "(D2 scope)" deferral language.
7. Live verify checklist (Studio in web @ 1440x900 / 1280x800):
   - Place prefab inside zone → green ghost, click places.
   - Place prefab outside zone in edit mode → red ghost with "Outside <zone>" tooltip, click no-ops.
   - Place prefab whose category not in `allowedCategories` → red ghost with "Not allowed in <zone>" tooltip.
   - Place prefab on existing prefab → red ghost with "Overlapping" tooltip.
   - Drag selected prefab past zone edge → clamps every frame, doesn't escape.
   - Rotate 1x4 prefab in 3x3 zone → rotates, clamps to zone center, overflows visually (acceptable per D3).
   - Delete via key + Properties button → both clear selection.
   - Tool switch select↔move↔rotate keeps selection.
   - Escape at Asset level still pops to Zone (D1 contract preserved).

No rollback complexity — the changes are additive helpers + tightened call sites; reverting reverts cleanly.
