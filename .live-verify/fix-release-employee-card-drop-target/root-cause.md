# Root cause — fix-release-employee-card-drop-target

## Verdict

**Neither Candidate A / B / C as originally framed.** The drop pipeline is firing correctly in release `.app`. The regression is **downstream of drop emission, in the render layer**.

## Evidence (from diagnostic JSONs)

`dark-2d-attempt.json` + `light-2d-attempt.json` both show 2 attempts with:

| Field | Value |
|---|---|
| `outcome` | `drop-emitted` |
| `emittedDropEvent` | `true` |
| `sourceZoneId` | `…::zone-rest` |
| `hitResult.zoneId` | `…::zone-product` |
| `dropTargetZoneIdsAtUp` | `[zone-dev, zone-product, zone-art]` |
| `down` / `up` | recorded with valid canvas coords |

All three drop conditions (zone hit + droppable + different from source) hold. `WorkstationAssignmentService` is reached. `move: null` is just browser high-velocity move coalescing — not a regression.

## True root cause

In `packages/ui-office/src/components/scene/use-scene-snapshot.ts:76-78`:

```ts
for (const [empId, agent] of agents) {
  const zoneId = agent.state === 'idle' ? restId : resolveZone(agent);
  map.get(zoneId)?.push({ agent, seed: agent.avatarSeed, empId });
}
```

And mirrored in `packages/ui-office/src/components/scene/office3d-employees.tsx:80`:

```ts
const zoneId = agent.state === 'idle' ? restZoneId : resolveEmployeeSceneZoneId(agent, zones);
```

Both render layers **force any `state === 'idle'` employee into the rest zone, ignoring `workstationId`**. Drag flow:

1. User drags employee from rest → zone-product
2. `onDropOnZone` → `eventBus.emit('employee.workstation.drop-requested')` ✓
3. `useScene` → `WorkstationAssignmentService.assignToWorkstation` → `employees.update({ workstation_id: 'zone-product' })` ✓
4. `agents` Map updates with new `workstationId` ✓
5. **Render layer re-runs `zoneEmployees`**: agent is still `state === 'idle'` (no work assigned) → forced to rest zone, ignoring updated `workstationId`
6. Visual: employee snaps back to rest zone → looks like drop failed

## Why dev didn't appear broken

Same code path. The bug exists in both dev and release. Either:
- Bucket 2a verifier had non-idle employees in their test scene, or
- Different theme-token migration noise masked perception

Either way, the diagnostic JSON proves drop fires in release; the visual regression is the rendering shortcut.

## Fix path

Honor `workstationId` even when `state === 'idle'`. Drop the unconditional idle→rest shortcut. Only fall back to rest for idle employees **without** an explicit workstation assignment.

Change lines (both 2D and 3D paths):

```ts
const hasAssignment = !!agent.workstationId;
const zoneId =
  !hasAssignment && agent.state === 'idle' ? restId : resolveZone(agent);
```

Behavior delta:
- idle + workstationId set → render at workstation (was: rest)
- idle + workstationId null → render at rest (unchanged)
- non-idle → render at resolved zone (unchanged)

## Spec implication

`scene-2d-employee-drop` spec scenario "Drop on valid different zone emits event" already says drop SHALL emit. Spec doesn't directly mandate "employee SHALL visually relocate," but proposal/design's stated outcome is "员工真路由到新 workstation". Adding a Requirement that captures "render layer SHALL honor `workstationId` regardless of `state`" closes the contract gap that let this regress.
