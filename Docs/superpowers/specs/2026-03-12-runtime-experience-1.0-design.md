# Runtime Experience 1.0 — Design Spec

> **Goal:** Complete all P0 + P1 runtime experience features so every GDD-defined state has functional visual feedback, the TaskDashboard shows real execution data, and the scene layer architecture supports all current and planned entity types.
>
> **Scope:** TaskDashboard fixes, EventLog expansion, Layer architecture, LobsterEntity enablement, all P0/P1 animations from ANIMATION_BACKLOG, meeting scene integration, install trust feedback, report/delivery feedback, selection sync.
>
> **Non-scope:** Market website, model provider UI, MCP permission enforcement UI, aesthetic polish (user will tune later), P2/P3 backlog items, ANIM-036/ANIM-037 (marketplace DOM polish — deferred to market launch).
>
> **Reference docs:**
> - `Docs/04_runtime_experience/AICS_RUNTIME_EXPERIENCE_GDD.md`
> - `Docs/04_runtime_experience/SCENE_STATE_MATRIX.md`
> - `Docs/04_runtime_experience/ANIMATION_BACKLOG.md`

---

## §1 TaskDashboard Data Completeness

### §1.1 Problem: PlanCreatedPayload lacks task details

`PlanCreatedPayload.steps[].taskCount` is a number. The frontend creates placeholder tasks with `description: taskRunId` (a random ID). Users see gibberish.

### §1.2 Solution: Enrich PlanCreatedPayload

Extend the payload to carry task details per step:

```typescript
// packages/shared-types/src/events.ts
export interface PlanCreatedPayload {
  readonly planId: string;
  readonly threadId: string;
  readonly summary: string;                    // NEW: plan summary from PM
  readonly steps: ReadonlyArray<{
    readonly stepIndex: number;
    readonly description: string;
    readonly taskCount: number;                 // keep for backward compat
    readonly tasks: ReadonlyArray<{             // NEW
      readonly taskRunId: string;
      readonly taskType: string;
      readonly description: string;
      readonly employeeId: string;
    }>;
  }>;
}
```

**Updated factory signature:**

```typescript
// packages/core/src/events/event-factories.ts
export function planCreated(
  companyId: string,
  planId: string,
  threadId: string,
  summary: string,                               // NEW
  steps: ReadonlyArray<{
    stepIndex: number;
    description: string;
    taskCount: number;
    tasks: ReadonlyArray<{                        // NEW
      taskRunId: string;
      taskType: string;
      description: string;
      employeeId: string;
    }>;
  }>,
): RuntimeEvent<PlanCreatedPayload>
```

**Core changes:**
- `packages/shared-types/src/events.ts` — extend `PlanCreatedPayload`
- `packages/core/src/events/event-factories.ts` — update `planCreated()` factory to accept `summary` and `steps[].tasks[]`
- `packages/core/src/agents/pm-planner-node.ts` — pass task details when emitting `plan.created` (data already exists as `PlanTask[]` in the node's local state, just not forwarded to the event)

**Web changes:**
- `apps/web/src/hooks/useTaskDashboard.ts` — remove `placeholderTasks()`, use real task data from event
- Initialize `TaskInfo` from payload tasks (taskRunId, description, taskType, employeeId all available at creation time)

### §1.3 Employee name resolution

`TaskInfo.employeeName` is set to `employeeId` (in the `task.assignment.changed` handler of useTaskDashboard). The event doesn't carry names.

**Solution:** `useTaskDashboard` accepts an `agents: Map<string, AgentState>` parameter (from `useAgentStates`). The hook resolves `employeeName` via `agents.get(employeeId)?.name` on every state update. `TaskItem.tsx` displays the resolved name.

**Wiring:** `RightSidebar.tsx` calls both hooks and passes `agents` into `TaskDashboard`.

### §1.4 EventLog expansion

`EventLog` currently only subscribes to `graph.node.*`.

**Add subscriptions:**
- `plan.*` — plan lifecycle events
- `task.*` — task state/assignment events
- `deliverable.*` — output creation

**Display:** Each event type gets an icon prefix (graph=⚙, plan=📋, task=▶, deliverable=📦). Payload summary formatted as one-liner.

---

## §2 Scene Layer Architecture

### §2.1 Current state

SceneManager adds children in mount order with implicit z-ordering. No named layers.

### §2.2 Target: 8-layer container hierarchy

Per SCENE_STATE_MATRIX §4:

```
L0: floorContainer      — floor tiles, room boundaries
L1: furnitureContainer   — desks, chairs, monitors, racks
L2: entityContainer      — employee avatars (LobsterEntity/EmployeeEntity)
L3: accentContainer      — halos, desk glows, state rings, progress arcs
L4: semanticContainer    — route lines, warning tags, install candidate highlights
L5: bubbleContainer      — task bubbles, speech, report markers
L6: focusContainer       — spotlight, route emphasis, high-priority pulse
L7: bridgeContainer      — install review anchors, onboarding callouts (DOM-coordinated)
```

**Implementation:**
- `SceneManager.mount()` creates `this.layers: Record<string, Container>` — 8 PIXI.Container instances added in L0→L7 order
- All existing `addChild` calls migrate to the correct layer
- New entity types (route lines, install candidates) target their designated layer
- `addToLayer(layerName, child)` utility method on SceneManager

**Entity → layer mapping:**

| Entity | Layer |
|--------|-------|
| FloorLayer (tiles, grid) | L0 floorContainer |
| Desk graphics, chair, monitor | L1 furnitureContainer |
| EmployeeEntity / LobsterEntity | L2 entityContainer |
| MeetingRoomEntity (table, room area) | L1 furnitureContainer |
| State rings, desk glows | L3 accentContainer |
| RouteLineEntity | L4 semanticContainer |
| Install ghost entity | L4 semanticContainer |
| Task bubbles, report badges | L5 bubbleContainer |
| Meeting focus glow, attention router | L6 focusContainer |
| DOM-coordinated anchors | L7 bridgeContainer |

### §2.3 Entity style switch

SceneManager constructor accepts `entityStyle: 'lobster' | 'employee'` (default `'lobster'`).

- `useScene` hook reads `localStorage.getItem('aics-entity-style')` and passes to SceneManager
- Settings panel adds a toggle (Lobster Pixel Art / Classic Circle)
- SceneManager's `addEmployee()` method branches on `entityStyle`

---

## §3 Employee State Animations (P0 + P1)

All animations target LobsterEntity and EmployeeEntity. Each entity's `setState(state)` method dispatches to the correct animation.

Animations use existing token infrastructure: `STATE_COLORS`, `MOTION` buckets, `MOTION_REDUCED` fallback.

### §3.1 Already implemented (no work needed)

| ANIM ID | State | Implementation |
|---------|-------|---------------|
| ANIM-001 | mount/unmount | Scale+fade enter/exit |
| ANIM-002 | state transition | Shared halo/ring transition |
| ANIM-003 | bubble lifecycle | Enter/update/exit on task bubble |
| ANIM-006 | idle | Idle bob + monitor glow variance |
| ANIM-007 | thinking | Cognitive pulse (antenna+eyes on Lobster) |
| ANIM-009 | executing | Strong desk energy ring + fast claw work |
| ANIM-014 | failed | Shake + destructive accent |
| ANIM-034 | perf tier | MOTION_REDUCED kill-switch |
| ANIM-035 | reduced motion | Global motion preset switch |

### §3.2 Missing P0 animations

**ANIM-008: Searching state sweep**
- LobsterEntity: Eyes scan left-right (x oscillation, period=1.2s), antennae point forward
- EmployeeEntity: Circle border dash-offset animation (scanning ring)
- Motion: M1-M2, Tier B: static magnifier icon only

**ANIM-010: Blocked state alert**
- Both: State ring color → `STATE_COLORS.blocked` (0xf87171), stalled vibration (tiny x/y jitter, amplitude=1px, period=0.3s)
- LobsterEntity: Claws fold inward (defensive pose)
- Motion: M2-M3, Tier B: static blocked badge, no jitter

**ANIM-012: Reporting transition**
- Both: Brief upward float (y-2px, 0.4s) + route emphasis toward delivery zone (if zone exists)
- State ring → `STATE_COLORS.reporting`
- Motion: M2, Tier B: static reporting icon

### §3.3 Missing P1 animations

**ANIM-011: Waiting / queued softness**
- Both: Low-energy grey tint overlay (alpha=0.3), softened glow, subtle breathe (scale 1.0→1.01, period=3s)
- Motion: M1, Tier B: static waiting dot

**ANIM-013: Success resolve**
- Both: Short positive burst (scale 1.0→1.08→1.0, 0.3s) + state ring flash green → settle
- LobsterEntity: Claws open wide briefly (celebration pose)
- Motion: M2-M3, Tier B: single accent pulse only

---

## §4 Route Lines and Handoff Cues (ANIM-004 + ANIM-015)

### §4.1 RouteLineEntity

New entity class in `packages/renderer/src/entities/RouteLineEntity.ts`.

**Visual:** Dashed line connecting two entity positions. Color matches task state.

**Technical approach:** PixiJS `Graphics` does not natively animate dash-offset. Use frame-by-frame redraw: each GSAP tick calls `graphics.clear()` then redraws the dashed line with an incremented offset parameter. The dash pattern (8px on, 4px off) is calculated manually in a `drawDashedLine(from, to, dashLen, gapLen, offset)` utility. This is lightweight — one `clear()+lineTo()` per frame for active lines. Tier B: skip dash animation, draw static dashed line. Tier C: no route lines.

**Lifecycle:**
- Created on `task.assignment.changed` (action=assigned) — line from assigner entity to assignee entity
- Updated position each frame (entities may move)
- Fade-out on task completion/failure (GSAP alpha 1→0, 0.5s, then destroy)
- Lives in L4 (semanticContainer)

**SceneManager integration:**
- `onTaskAssignmentChanged` handler: create RouteLineEntity between manager/PM and assigned employee
- Track active lines in `Map<taskRunId, RouteLineEntity>`
- Clean up on task state → completed/failed/cancelled

### §4.2 Task row ↔ world echo (ANIM-015, P1)

When `task.state.changed` fires:
- SceneManager briefly highlights the assigned employee (emphasis animation, 0.5s)
- DOM TaskItem briefly highlights (CSS class `task-echo`, yellow border flash, 0.5s)
- EventBus bridges: SceneManager emits `ui.scene.task.echo` → useTaskDashboard listens and applies highlight

---

## §5 Inspector ↔ Scene Selection Sync (ANIM-005)

### §5.1 Selection protocol

New event: `ui.selection.changed` with payload `{ entityId: string | null, source: 'scene' | 'panel' }`.

**Scene → Panel (click employee in scene):**
- SceneManager: employee entity click handler → emit `ui.selection.changed` (source='scene')
- `useAgentStates` / AgentPanel: listen → scroll to + highlight AgentCard

**Panel → Scene (click AgentCard):**
- AgentCard click → emit `ui.selection.changed` (source='panel')
- SceneManager: listen → call `highlightEntity(entityId)` (scale 1.1 + bright ring, GSAP)
- Auto-clear after 3s or on next selection

### §5.2 New shared-types

```typescript
export interface UiSelectionPayload {
  readonly entityId: string | null;
  readonly entityType: 'employee' | 'meeting' | 'install';
  readonly source: 'scene' | 'panel';
}
```

Note: `'ui.selection.changed'` already exists in the `EventFamily` type union in `events.ts`. Only the `UiSelectionPayload` interface needs to be added.

---

## §6 Install Trust Feedback (ANIM-020 through ANIM-026)

These are primarily DOM-side transitions on existing install components + scene placeholder.

### §6.1 Scene: Install candidate placeholder (ANIM-020)

When install preview opens (`install.previewing`):
- SceneManager creates a semi-transparent "ghost" employee entity at an empty desk position
- Ghost uses entityStyle but alpha=0.4, grayscale filter
- Lives in L4 (semanticContainer) — visually "not yet installed"
- Removed on install cancel or failure

**Empty desk detection:** `SceneManager` maintains a `DESK_POSITIONS` array (currently 4 positions in FloorLayer). Compare against `employeeEntities` keys to find unoccupied positions: `DESK_POSITIONS.filter(pos => !occupiedPositions.has(pos.id))`. Take the first available, or if all occupied, place ghost at a temporary offset position.

### §6.2 DOM: Staged reveal (ANIM-021, ANIM-022, ANIM-023)

Existing `InstallDialog` / `ManifestReview` / `SkillReview` components already render the data. Add CSS transitions:

- **ANIM-021 (manifest reveal):** Review rows animate in sequentially (staggered opacity+translateY, 50ms per row). CSS `@keyframes reveal-row`.
- **ANIM-022 (compatibility verdict):** Compatibility section gets `data-verdict="pass|fail|warn"` attribute. Fail state: red border pulse (CSS animation 2 cycles). Pass: green checkmark fade-in.
- **ANIM-023 (binding-required):** Binding section visually separated (dashed border, amber background). Pulsing "Action Required" badge when unresolved.

### §6.3 Bridge: Materialization + settle (ANIM-024, ANIM-025)

On `install.materializing`:
- Scene: Ghost entity gains stepped opacity (0.4 → 0.6 → 0.8 → 1.0) synced with install progress
- DOM: Progress stepper in InstallDialog

On `install.installed`:
- Scene: Ghost becomes real entity (remove grayscale filter, scale pop 1.0→1.1→1.0)
- Entity migrates from L4 to L2 (semanticContainer → entityContainer)
- DOM: Success banner with "Added to team" message

### §6.4 Failure + rollback (ANIM-026)

On `install.failed`:
- Scene: Ghost shakes briefly (ANIM-014 pattern) then fades out
- DOM: Error panel with cause + rollback status

On `install.rolled_back`:
- Scene: Ghost dissolves (alpha 1→0, scale 1→0.8, 0.5s)
- DOM: Rollback confirmation message

---

## §7 Meeting Scene Integration (ANIM-016 through ANIM-019, all P1)

### §7.1 Prerequisites

Meeting subgraph already exists in core. SceneManager already subscribes to `meeting.state.changed`. MeetingRoomEntity class exists but is minimal.

### §7.2 Meeting room readiness (ANIM-016)

On `meeting.scheduled`:
- MeetingRoomEntity: Table gains soft glow tint (amber, alpha=0.2)
- Room reservation badge appears above meeting area

### §7.3 Participant gather (ANIM-017)

On `meeting.gathering`:
- Route lines from gathering employees toward meeting room (reuse RouteLineEntity, color=meeting blue)
- Employee state rings change to meeting color

### §7.4 Active meeting cluster (ANIM-018)

On `meeting.active`:
- MeetingRoomEntity: Focus glow intensifies (alpha=0.4)
- Participants' state rings pulse in sync (shared GSAP timeline)
- Non-meeting employees' ambient motion reduces (visual focus on meeting)

### §7.5 Meeting disperse (ANIM-019)

On `meeting.ended`:
- Route lines fade out
- MeetingRoomEntity glow fades
- Participants return to previous state (employee.state.changed handles this)

---

## §8 Report and Delivery Feedback (ANIM-028 through ANIM-031, all P1)

### §8.1 Report-ready world cue (ANIM-028)

On `report.ready`:
- If a delivery zone exists in scene: zone highlight (glow pulse)
- If no zone: employee entity gets a document badge overlay (small icon above head)
- Lives in L5 (bubbleContainer)

### §8.2 Report card reveal (ANIM-029)

On `report.ready`:
- PitchHall's DeliverableCard animates in: translateY(20px)→0 + opacity 0→1, 0.3s ease-out
- No layout shift (card space pre-allocated or appended at end)

### §8.3 Delivery confirm settle (ANIM-030)

On `report.delivered`:
- Scene: Employee entity brief positive settle (same as success resolve)
- DOM: DeliverableCard gets subtle green left-border

### §8.4 Rejected report return (ANIM-031)

On `report.rejected`:
- Scene: Route line from report zone back to employee (red, indicating rework)
- DOM: DeliverableCard shows rejection reason + "Rework" badge

---

## §9 Import Feedback (ANIM-027, P1)

On file import via FileImportTrigger:
- Show progress indicator (spinning icon or progress bar) in import button area
- Validation results animate in (staggered, same as ANIM-021)
- Failure: Error toast with cause
- Success: Transition to install review flow

---

## §10 Scene Attention Router (ANIM-032, P1)

When a high-priority state exists (blocked employee, install failure, report review needed), the scene should draw user attention without a cinematic camera takeover.

**Implementation:**
- SceneManager maintains a priority queue of active "attention requests" keyed by `entityId`
- Each attention request has a `priority` (from SCENE_STATE_MATRIX §12: destructive=5, install=4, report=3, active=2, ambient=1)
- Only the highest-priority request gets the "dominant focus" treatment: a subtle spotlight glow (L6 focusContainer) centered on the entity, dimming other entities slightly (alpha 0.9)
- If multiple equal-priority requests exist, the most recent one wins
- Attention clears when the triggering state resolves (e.g., blocked → running)

**Triggers:**
- `employee.state.changed` to `blocked` or `failed` → priority 5
- `install.state.changed` to `failed` or `rolled_back` → priority 5
- `install.state.changed` to `awaiting_bindings` or `compatibility_checked` (fail) → priority 4
- `report.state.changed` to `ready` → priority 3
- All other active states → no attention request

**Tier B:** Spotlight only (no dimming). **Tier C:** No attention routing.

---

## §11 Performance Tier System Completion (renumbered from §10) (ANIM-034)

### §10.1 Current state

`MOTION_REDUCED` exists as a global toggle (all durations → 0). This is Tier C only.

### §10.2 Target: 3-tier system

```typescript
// packages/renderer/src/tokens/motion.ts
export type PerformanceTier = 'A' | 'B' | 'C';

export const MOTION_TIER_A = MOTION;           // existing full motion
export const MOTION_TIER_B: MotionTokens = {   // shortened durations
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0.2, ease: 'sine.inOut' },
  M2: { duration: 0.15, ease: 'quad.inOut' },
  M3: { duration: 0.1, ease: 'power2.out' },
};
export const MOTION_TIER_C = MOTION_REDUCED;   // existing zero motion
```

**Tier B behavior:**
- Route lines: fade only, no dash animation
- Ambient loops: limited (reduce to M0)
- Transitions: shortened but still present
- Bubbles: fade+scale only, no eased enter
- Install materialization: simplified step change

**Runtime detection:**
- `runtime.performance.tier.changed` event emitted by either:
  - **User setting** (manual toggle in Settings panel: Full/Reduced/Minimal) — persisted in localStorage
  - **FrameRateMonitor** (optional, can be added post-1.0): sample FPS every 2s over a 10s window. Downgrade threshold: avg < 24fps for 3 consecutive samples → Tier B. Avg < 15fps → Tier C. Upgrade threshold: avg > 45fps for 5 samples → upgrade one tier. Hysteresis prevents flapping.
- For 1.0: **user setting only** (manual tier selection). FrameRateMonitor is a future enhancement.
- SceneManager stores `currentTier` and passes to all entity animation calls
- Each animation function accepts `tier` parameter and selects appropriate token set

---

## §12 New Events Summary

New payload types added to `packages/shared-types/src/events.ts`:

| Type | Purpose |
|------|---------|
| `UiSelectionPayload` | Scene ↔ panel selection sync payload |

New EventFamily entries:

| Event | Notes |
|-------|-------|
| `ui.scene.task.echo` | Task row ↔ world highlight echo (add to EventFamily union) |

Note: `ui.selection.changed` already exists in EventFamily. No new entry needed.

Modified events:
| Event | Change |
|-------|--------|
| `plan.created` | `PlanCreatedPayload` gains `summary: string` and `steps[].tasks[]` with full task details |

**Report/delivery event clarification:** The EventFamily includes `report.state.changed`. The spec uses shorthand like `report.ready`, `report.delivered`, `report.rejected` — these are **not** separate event types. They are matched via EventBus prefix matching on `report.` or by checking the payload's state field (e.g., `payload.next === 'ready'`). Same pattern applies to `install.previewing`, `install.materializing`, etc. — all are states within `install.state.changed`.

All other animations are driven by **existing** events (`employee.state.changed`, `task.assignment.changed`, `meeting.state.changed`, `install.state.changed`, `report.state.changed`).

---

## §13 File Impact Summary

### shared-types
- `events.ts` — extend PlanCreatedPayload, add UiSelectionPayload, add 2 EventFamily entries

### core
- `events/event-factories.ts` — update planCreated factory
- `agents/pm-planner-node.ts` — pass task details in plan.created emission

### renderer
- `scene-manager.ts` — layer architecture, entity style switch, route line management, selection sync, install ghost, meeting scene handlers
- `entities/route-line-entity.ts` — NEW
- `entities/lobster-entity.ts` — add searching/blocked/waiting/reporting/success animations
- `entities/employee-entity.ts` — add searching/blocked/waiting/reporting/success animations
- `entities/meeting-room-entity.ts` — extend with scheduled/gathering/active/ended states
- `tokens/motion.ts` — add PerformanceTier, MOTION_TIER_B, tier selection helper

### web (apps/web)
- `hooks/useTaskDashboard.ts` — remove placeholder mechanism, accept agents param, use enriched payload
- `hooks/useEventLog.ts` or `components/events/EventLog.tsx` — add plan/task/deliverable subscriptions
- `components/plan/TaskItem.tsx` — display resolved employee name
- `components/plan/TaskStepCard.tsx` — task echo highlight class
- `components/layout/RightSidebar.tsx` — pass agents to TaskDashboard
- `components/agents/AgentPanel.tsx` — emit ui.selection.changed on card click
- `components/agents/AgentCard.tsx` — listen for selection highlight
- `components/install/InstallDialog.tsx` — add staged reveal CSS transitions
- `components/install/ManifestReview.tsx` — row stagger animation
- `components/install/SkillReview.tsx` — compatibility verdict emphasis
- `components/pitch/PitchHall.tsx` — deliverable card enter animation, delivery/rejection states
- `components/settings/` — entity style toggle
- CSS additions for transition animations (reveal-row, task-echo, verdict emphasis)

### Tests
- `packages/renderer/src/__tests__/` — RouteLineEntity tests, layer architecture tests, animation state tests
- `packages/core/src/__tests__/` — enriched planCreated factory test
- `apps/web/src/__tests__/` — useTaskDashboard with real task data test

---

## §14 Implementation Order

Recommended chunk sequence (respecting dependencies):

1. **Foundation** — shared-types events + core factory changes + layer architecture + entity style switch
2. **TaskDashboard** — enriched payload + placeholder removal + name resolution + EventLog expansion
3. **Employee animations** — all missing state animations on both entity types (ANIM-008/010/011/012/013)
4. **Route lines + selection sync** — RouteLineEntity + ANIM-005 bridge + task echo (ANIM-015)
5. **Install trust feedback** — ghost entity + DOM transitions (ANIM-020~026)
6. **Meeting scene** — MeetingRoomEntity extensions + gather/active/disperse (ANIM-016~019)
7. **Report/delivery + import** — PitchHall animations + report zone cues (ANIM-027~031)
8. **Attention router + performance tier** — scene attention routing (ANIM-032) + 3-tier system (ANIM-034)
9. **Verification** — full test suite + build + visual smoke test
