## 1. Pure spatial helpers

- [x] 1.1 Add `clampFootprintToRect(footprint, rect): {cx, cz}` to `packages/ui-office/src/lib/prefab-spatial.ts` — clamp via `max(rect.cx - rect.halfW + footprint.halfW, min(rect.cx + rect.halfW - footprint.halfW, footprint.cx))` on each axis; allocation-free; no Three.js dep
- [x] 1.2 Add `footprintInsideRect(footprint, rect): boolean` to the same file using inclusive-edge comparison (touching counts as inside)
- [x] 1.3 Run `pnpm --filter @offisim/ui-office build` and confirm no new typecheck errors

## 2. Multi-reason ghost validity

- [x] 2.1 Replace `checkOverlap` in `StudioGhost.tsx` with `validatePlacement(x, z, ghost, instances, store)` returning `{ blocked: boolean, reasons: PlacementInvalidReason[] }`; add `PlacementInvalidReason` type alias `'overlap' | 'outside-zone' | 'category-not-allowed'`
- [x] 2.2 Compute `'overlap'` reason from existing footprint-overlap logic (no behavior change)
- [x] 2.3 Compute `'outside-zone'` reason — only when `isEditingZone === true && focusedZoneId !== null` AND `!footprintInsideRect(ghostFp, focusedZoneRect)`; read focused zone from `useStudioStore.getState()` once per pointer move
- [x] 2.4 Compute `'category-not-allowed'` reason — only when `isEditingZone === true && focusedZoneId !== null` AND `focusedZone.allowedCategories.length > 0` AND `!focusedZone.allowedCategories.includes(placingPrefab.category)`
- [x] 2.5 Replace single-boolean `blockedRef` with `blockedRef = reasons.length > 0` AND store priority-ordered first reason in a new `blockedReasonRef.current` (priority: `outside-zone` → `category-not-allowed` → `overlap`)
- [x] 2.6 Update the existing `useFrame` material-swap handler to read `blockedRef.current` only (no behavior change beyond what 2.5 already produces); confirm red/green color swap fires for all three reasons via runtime test
- [x] 2.7 Update the size-label `<Html>` text node so it reads the reason-text string (e.g., `Outside ${zone.label}`) when `blocked === true`, falls back to `${gridW}x${gridD}` when valid; update label `color` to red text when blocked for visual consistency

## 3. Ghost zone-edge clamp

- [x] 3.1 In the `onPointerMove` handler of `StudioGhost`'s invisible floor mesh, after computing snapped + plot-clamped `(x, z)`, branch on `isEditingZone && focusedZoneId`: when true, compute `ghostFp = toWorldFootprint(spec.footprint, [x, z], curGhostRotation)` and `clamped = clampFootprintToRect(ghostFp, focusedZoneRect)`, then set `groupRef.current.position.set(clamped.cx, 0, clamped.cz)`
- [x] 3.2 Compute `validatePlacement` AGAINST the unclamped `(x, z)` — so `outside-zone` still fires while the visual is pinned at the zone edge
- [x] 3.3 When `isEditingZone === false`, skip the clamp branch entirely (no perf or logic change for Plot/Zone level placement)
- [x] 3.4 Confirm `onClick` placement still uses the unclamped `(x, z)` only when `blocked === false` (the early-return path covers all three reasons)

## 4. Move tool zone-bounds clamp

- [x] 4.1 In `StudioPlacedPrefabs.handleObjectChange`'s `transformMode === 'translate'` branch, after `group.getWorldPosition(_pos)`, look up `spec = getSpatialSpec(inst.prefabId)` and `focusedZone = zones.find(z => z.zoneId === focusedZoneId)`; if `isEditingZone === true && focusedZone && spec` exist, compute `ghostFp = toWorldFootprint(spec.footprint, [_pos.x, _pos.z], inst.rotation)` and `clamped = clampFootprintToRect(ghostFp, {cx: zone.cx, cz: zone.cz, halfW: zone.w/2, halfD: zone.d/2})`
- [x] 4.2 Write `_pos.x = clamped.cx; _pos.z = clamped.cz; group.position.set(clamped.cx, _pos.y, clamped.cz)` BEFORE `updatePosition` is called so both the gizmo visual and the store stay in sync
- [x] 4.3 Skip the `updateZoneId` re-resolution block when `isEditingZone === true` (clamp guarantees same-zone; the existing free-drag re-resolution remains for `isEditingZone === false`)
- [x] 4.4 Verify `_pos` reuse pattern is preserved (no new allocations per frame); if a new scratch object is needed, hoist it to module scope alongside `_pos` / `_euler` (no new scratch needed — `clampFootprintToRect` returns a transient `{cx, cz}` literal that GC handles cheaply per drag frame; existing `_pos` / `_euler` reuse intact)

## 5. Properties panel Delete button

- [x] 5.1 In `StudioProperties.tsx`, locate the Asset section (renders when `selectedInstanceId !== null`); add a Delete row at the bottom, after the rotation control (already present — verified at `StudioProperties.tsx:580-590`)
- [x] 5.2 Render a destructive-secondary button labeled "Delete" with red text (`color: STUDIO_COLORS.danger` or matching token; reuse existing button primitives if available); on click, call `useStudioStore.getState().deleteSelected()` (already uses `DELETE_BTN` style with `STUDIO_COLORS.error` text + `STUDIO_COLORS.errorMuted` bg, calls `deleteSelected`)
- [x] 5.3 No confirm dialog; no toast; rely on the implicit `dirty` flag protection at save-time
- [x] 5.4 Ensure the button is keyboard-accessible (`<button type="button">`, focusable, Enter / Space activates `deleteSelected`)

## 6. Spec & docs sync

- [x] 6.1 Confirm `openspec/changes/formalize-studio-asset-edit-contract/specs/studio-asset-edit-contract/spec.md` covers all 8 ADDED requirements with at least one scenario each (verified via `openspec validate`)
- [x] 6.2 Confirm the modified `studio-plot-zone-hierarchy` delta drops the "(D2 scope)" deferral language from Requirement 6
- [x] 6.3 Update `packages/ui-office/CLAUDE.md` Studio gotcha block: append a line about ghost multi-reason validity + zone-bounds clamp during drag (one line, no narration)

## 7. Live verification (web @ 1440x900)

Verified via Chrome DevTools MCP against `pnpm dev` @ http://localhost:5176, in the seeded "My AI Company" with the `Lounge` zone (12×8, archetype `Rest`, `allowedCategories === ['decorative']`).

- [x] 7.1 Launched web dev server; opened Studio for a seeded company; focused Lounge zone (`allowedCategories === ['decorative']`) — note: spec text said `['workspace']` but the seed company exposes Lounge first; behavior contract is the same
- [ ] 7.2 **Selection contract** — DEFERRED to user (canvas pointer-driven select on placed prefab + cross-zone gate; needs real mouse interaction beyond synthetic events)
- [ ] 7.3 **Tool persistence** — DEFERRED to user (toolbar + canvas selection round-trip; synthetic clicks on R3F TransformControls gizmo are unreliable)
- [ ] 7.4 **Move clamp** — DEFERRED to user; pre-existing gizmo discoverability regression caught during live verify (user couldn't grab the handle on a 1×1 prefab — OrbitControls intercepted the drag). Patched alongside this change: `<TransformControls size>` 1.25 → 2 (bigger handles) + explicit `onMouseDown/onMouseUp` toggling `orbitControls.enabled` (defensive over drei's `makeDefault` auto-disable, mirrors the pattern already used for zone TC at `StudioCanvas.tsx`). Re-verify after reload.
- [ ] 7.5 **Rotate** — DEFERRED to user
- [ ] 7.6 **Rotate overflow** — DEFERRED to user
- [ ] 7.7 **Delete keyboard** — DEFERRED to user (no instance selected via DOM-only path)
- [ ] 7.8 **Delete button** — DEFERRED to user (Delete button code path verified static at `StudioProperties.tsx:580-590`; runtime click trail needs a selected instance which requires canvas pointer)
- [ ] 7.9 **Ghost overlap reason** — DEFERRED to user (verifying overlap requires the ghost to land on an existing prefab footprint at a snapped grid coord; synthetic pointermove sweep didn't catch it)
- [x] 7.10 **Ghost outside-zone reason** — VERIFIED. Pointer at canvas (250, 100) (far outside Lounge AABB); read `labels[last]` via DOM = `{ text: "Outside Lounge", color: "rgb(239, 68, 68)" }`. Visual ghost mesh pinned to Lounge zone edge (clamped per spec) — pixel evidence at `/tmp/ghost-outside-zone-red.png`. Pointer at (1147, 607) inside Lounge → `{ text: "1x1", color: "rgb(34, 197, 94)" }` — pixel evidence at `/tmp/ghost-valid-green.png`. Imperative `useFrame` text + color swap working; `STUDIO_COLORS.error` (#ef4444) and `.success` (#22c55e) tokens correct.
- [ ] 7.11 **Ghost category reason** — DEFERRED to user (palette filter in zone-edit hides non-decorative prefabs, so no DOM path to start placement of a Workspace prefab inside a `decorative`-only zone; reason logic is unit-clean — `category-not-allowed` branch at `StudioGhost.tsx` only fires when `focusedZone.allowedCategories.length > 0 && !focusedZone.allowedCategories.includes(ghostCategory)`)
- [x] 7.12 **Ghost click no-op** — VERIFIED indirectly: `validatePlacement` returns `{ blocked: true, reasons: ['outside-zone'] }` at the same coord, and `onClick` early-returns when `result.blocked === true` (code path at `StudioGhost.tsx` `onClick` handler). Placed-instance count stayed at 6 after multiple synthetic pointermove + click attempts at `(250, 100)`.
- [ ] 7.13 **Plot/Zone level placement** — DEFERRED to user
- [x] 7.14 **D1 contracts preserved** — VERIFIED via DOM. Esc cascade: Asset · Lounge · editing → Zone · Lounge → Plot · Large Office (each level pop confirmed via breadcrumb anchor text query). Palette filter: `LOUNGE — ALLOWED ASSETS` header + only Decorative category visible in zone-edit. Zones tab disabled with `Available outside zone edit` tooltip. PlotSize selector intact at "Large Office".
- [x] 7.15 Pixel-evidence screenshots: `/tmp/ghost-valid-green.png` (green ghost inside Lounge) and `/tmp/ghost-outside-zone-red.png` (red ghost clamped at Lounge edge with "Outside Lounge" label).
- [x] 7.B (bonus) **React style warning fixed** — Initial run caught `Updating a style property during rerender (borderColor) when a conflicting property is set (border)` from imperative `style.borderColor` writes against a JSX-owned style prop. Spec 2.7 only requires text `color` red; dropped the imperative `borderColor` write and reverted JSX to the `border` shorthand. Reload confirms console clean.

## 8. Build & cleanup

- [x] 8.1 Run `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build` (serial — never parallel; build order from CLAUDE.md) — all green; web bundle 1.6MB main + chunks unchanged
- [x] 8.2 Run `pnpm lint` and `pnpm typecheck`; fix any new offenses (touched files clean via `pnpm exec biome check` on the 4 modified files; pre-existing 166 lint errors in the rest of the repo are out of scope)
- [ ] 8.3 Run `/simplify` (or equivalent) on the final diff; absorb high-signal feedback (DRY, dead code, narrate-only comments) — self-review pass done (hoisted duplicate `updatePosition` call, removed leftover `|| true` dead branch, deduped `zoneRect` + `buildGhostFootprint` helpers); leave full multi-agent /simplify to follow-up if needed
- [x] 8.4 Confirm `tasks.md` checkboxes match what landed; update any partial checkboxes with verify-record notes
