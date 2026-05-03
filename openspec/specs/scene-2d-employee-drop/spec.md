# scene-2d-employee-drop Specification

## Purpose

Define the 2D office canvas employee→zone drop pipeline as a single, runtime-parity contract: a 3-state pointer phase machine for click-vs-drag disambiguation, a strict three-condition conjunction for drop emission, a live (non-stale) `dropTargetZoneIds` derivation, and a render-layer invariant that honors explicit `workstationId` even while the employee is idle. Also covers the dev-vs-release behavior parity guarantee and the diagnostic ring buffer + JSON export required to keep release-app drop regressions debuggable without asking users to instrument their own runtime.

## Requirements

### Requirement: 2D canvas employee drag has a 3-state pointer phase machine

The 2D office canvas SHALL run employee drag through exactly three phases: `idle`, `pending`, `active`. Phase transitions SHALL be: `idle → pending` on PointerDown that hits an employee node; `pending → active` on PointerMove whose cumulative screen-space delta from the PointerDown origin reaches `DRAG_THRESHOLD`; `pending → idle` on PointerUp without crossing `DRAG_THRESHOLD` (treated as a click); `active → idle` on PointerUp, PointerLeave, or `Escape` keypress (treated as drag end / cancel). No additional phase MAY be introduced. Phase MAY NOT skip from `idle` directly to `active`; the `pending` phase guards the click-vs-drag distinction.

#### Scenario: PointerDown on employee enters pending phase
- **WHEN** the user PointerDowns on an employee node inside the 2D canvas
- **THEN** the pointer phase machine SHALL transition `idle → pending` and record the PointerDown screen coordinates as the drag origin

#### Scenario: PointerUp before threshold treats as click, no drop
- **WHEN** the user PointerDowns on an employee node and PointerUps before the cumulative screen-space delta reaches `DRAG_THRESHOLD`
- **THEN** the pointer phase machine SHALL transition `pending → idle` and the click handler SHALL fire (`onEmployeeClick`)
- **AND** no `employee.workstation.drop-requested` event SHALL be emitted

#### Scenario: PointerMove past threshold enters active phase
- **WHEN** the user PointerDowns on an employee node and the cumulative screen-space delta from the PointerDown origin reaches `DRAG_THRESHOLD`
- **THEN** the pointer phase machine SHALL transition `pending → active` and a drag ghost SHALL be written to `interactionRef.current.drag` for the next render

#### Scenario: Escape during active drag cancels
- **WHEN** the user is in `active` drag phase and presses `Escape`
- **THEN** the pointer phase machine SHALL transition `active → idle`, `interactionRef.current.drag` SHALL be cleared, and no drop event SHALL be emitted

### Requirement: Drop event emits if and only if all three drop conditions hold simultaneously

On PointerUp inside `active` drag phase, the canvas SHALL emit `employee.workstation.drop-requested` if and only if **all three** of the following conditions hold simultaneously: (a) `hitTestZone(canvasX, canvasY)` returns `{ type: 'zone', zoneId }`, (b) `dropTargetZoneIds.includes(zoneId) === true`, (c) `zoneId !== dragEmployee.sourceZoneId`. If any one of the three fails, the drop SHALL be silently cancelled (`pending → idle` / `active → idle`) and no event SHALL be emitted. The conjunction SHALL be enforced as the single decision point in `useCanvasInteraction.onPointerUp`; no parallel decision path MAY emit drops outside this conjunction.

#### Scenario: Drop on valid different zone emits event
- **WHEN** the user is in `active` drag phase, PointerUps inside zone `Z2`, `Z2.deskSlots > 0`, and the dragged employee's source zone is `Z1`
- **THEN** the canvas SHALL invoke `onDropOnZone(employeeId, 'Z2')`, which SHALL emit one `employee.workstation.drop-requested` event with payload `{ employeeId, targetWorkstationId: 'Z2' }`

#### Scenario: Drop on source zone is silent
- **WHEN** the user is in `active` drag phase and PointerUps inside the same zone `Z1` that the dragged employee already occupies
- **THEN** no `employee.workstation.drop-requested` event SHALL be emitted

#### Scenario: Drop on zone with deskSlots ≤ 0 is silent
- **WHEN** the user is in `active` drag phase and PointerUps inside zone `Z3` with `Z3.deskSlots <= 0`
- **THEN** no `employee.workstation.drop-requested` event SHALL be emitted

#### Scenario: Drop on empty canvas is silent
- **WHEN** the user is in `active` drag phase and PointerUps at canvas coordinates that fall outside every zone's AABB
- **THEN** `hitTestZone` SHALL return `{ type: 'empty' }`, and no `employee.workstation.drop-requested` event SHALL be emitted

### Requirement: dropTargetZoneIds is derived from the live zone snapshot, not from a stale cache

`dropTargetZoneIds` SHALL be computed inside `useSceneSnapshot` as `zones.filter(z => z.deskSlots > 0).map(z => z.zoneId)` from the same `zones` array used by the renderer for the current frame. It SHALL update without explicit invalidation whenever `zones` changes (the React `useMemo` dependency tracks `zones`). The drop-decision conjunction in `useCanvasInteraction.onPointerUp` SHALL read this list from a stable ref / closure that reflects the latest snapshot, not a snapshot frozen at PointerDown.

#### Scenario: Newly hydrated zone with deskSlots > 0 is droppable on next frame
- **WHEN** a zone `Z4` finishes hydrating with `deskSlots = 4` between PointerDown (origin in zone `Z1`) and PointerUp (target in `Z4`)
- **THEN** PointerUp SHALL see `Z4` in `dropTargetZoneIds` and the drop SHALL emit (subject to source-zone and hit-zone conditions)

#### Scenario: Empty dropTargetZoneIds means no drop ever fires
- **WHEN** the active drag's `dropTargetZoneIds` is the empty array
- **THEN** PointerUp SHALL emit no drop event regardless of where the pointer lands

### Requirement: Render layer SHALL honor explicit workstation assignment regardless of idle state

The 2D and 3D scene render layers (`useSceneSnapshot.zoneEmployees` and `office3d-employees` employee placement) SHALL place an employee at the zone resolved from `agent.workstationId` whenever `workstationId` is non-null and resolves to a valid zone, **regardless of `agent.state`**. The existing `state === 'idle' → rest zone` shortcut MAY only apply when `agent.workstationId` is null / unset. This invariant guarantees that a successful `employee.workstation.drop-requested` event whose downstream persistence sets `workstation_id` results in a visibly relocated employee on the very next frame, even if the employee is still idle (no work assigned yet).

#### Scenario: Idle employee with workstationId renders at the assigned zone
- **WHEN** an employee has `state === 'idle'` and `workstationId === 'Z2'` (where `Z2.deskSlots > 0`)
- **THEN** the 2D `zoneEmployees` map and the 3D placement loop SHALL bucket that employee under `'Z2'`, not under the rest zone

#### Scenario: Idle employee without workstationId still falls back to rest
- **WHEN** an employee has `state === 'idle'` and `workstationId === null`
- **THEN** the render layers SHALL still place that employee at the rest zone (the original idle-default behavior is preserved for unassigned employees)

#### Scenario: Drop emit produces a visible move on the next frame
- **WHEN** an employee starts at `zone-rest` with `state === 'idle'`, the user drags them onto `zone-product` (`zone-product.deskSlots > 0`), and the resulting `employee.workstation.drop-requested` event causes `WorkstationAssignmentService` to persist `workstation_id = 'zone-product'`
- **THEN** the next render frame SHALL place the employee under `zone-product` (not back at `zone-rest`)

### Requirement: Release-app and dev-app behavior parity

The 2D canvas employee→zone drop pipeline SHALL behave identically when the same scene state is reproduced in the Tauri release `.app` and in `vite dev` browser dev mode. "Identically" means: same phase-machine transitions for the same PointerEvent stream, same `hitTestZone` outputs for the same canvas coordinates, same `dropTargetZoneIds` content for the same `zones` snapshot, and same emit-or-not decision for the same conjunction inputs. Differences in PointerEvent capture / release semantics across runtimes SHALL NOT make the pipeline diverge externally observable behavior.

#### Scenario: Same scene + same drag in dev and release both emit drop
- **WHEN** the same company / scene snapshot is loaded in `vite dev` (browser) and Tauri release `.app`, and the user drags an employee from zone `Z1` to zone `Z2` (with `Z2.deskSlots > 0`) in both
- **THEN** both runtimes SHALL emit one `employee.workstation.drop-requested` event with payload `{ employeeId, targetWorkstationId: 'Z2' }`

#### Scenario: Same scene + invalid drag in dev and release both silent
- **WHEN** the same company / scene snapshot is loaded in both runtimes, and the user drags an employee onto an empty canvas region
- **THEN** neither runtime emits a drop event

### Requirement: Release-app drop pipeline diagnostic snapshot is exportable as JSON

The 2D canvas drop pipeline SHALL maintain an in-memory ring buffer of the last 10 drag attempts. Each attempt entry SHALL include: `attemptId`, `startedAt` and `endedAt` epoch ms, the PointerEvent stream summary (`down`, last `move`, `up` with screen+canvas coordinates), the `hitTestZone` result at PointerUp, the `dropTargetZoneIds` array snapshot at PointerUp, the dragged `employeeId` (no name), the resolved `sourceZoneId`, the final phase-machine outcome (`click` / `drop-emitted` / `drop-suppressed-source-zone` / `drop-suppressed-not-droppable` / `drop-suppressed-empty` / `cancel-leave` / `cancel-escape`), and a boolean `emittedDropEvent`. The diagnostic SHALL be exposed via a single product-surface UI control labeled "Export 2D drop diagnostic" inside Settings → Runtime; clicking it SHALL serialize the ring buffer to JSON and prompt the user to save the file (Tauri save dialog) or download it (web Blob fallback). The diagnostic SHALL NOT include employee names or persona strings.

#### Scenario: Drag attempt records all fields
- **WHEN** the user performs a drag attempt that ends in `drop-emitted`
- **THEN** the ring buffer SHALL contain a new entry with all listed fields populated, `emittedDropEvent === true`, and `outcome === 'drop-emitted'`

#### Scenario: Cancelled drag still records
- **WHEN** the user starts a drag and presses `Escape` mid-drag
- **THEN** the ring buffer SHALL contain an entry with `outcome === 'cancel-escape'` and `emittedDropEvent === false`

#### Scenario: Ring buffer caps at 10
- **WHEN** the user performs 12 drag attempts in a session
- **THEN** the ring buffer SHALL contain exactly the most recent 10 entries; the 2 oldest SHALL have been evicted

#### Scenario: Export button produces JSON
- **WHEN** the user clicks "Export 2D drop diagnostic" in Settings → Runtime in the release `.app`
- **THEN** a JSON file SHALL be saved (Tauri) or downloaded (web) whose top-level shape is `{ version: 1, capturedAt: <epoch ms>, attempts: [<attempt>...] }`, parseable as JSON, with no employee names or persona fields present

#### Scenario: Empty ring buffer still exports valid JSON
- **WHEN** the user clicks "Export 2D drop diagnostic" before any drag attempt has occurred
- **THEN** a JSON file SHALL be saved with `attempts: []` and no error SHALL surface
