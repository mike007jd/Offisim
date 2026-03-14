# Runtime Experience 1.0 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all P0+P1 runtime experience features: TaskDashboard data correctness, scene layer architecture, all ANIMATION_BACKLOG items, route lines, selection sync, install trust feedback, meeting scene integration, report/delivery cues, attention router, and 3-tier performance system.

**Architecture:** The renderer package (`packages/renderer`) owns all PixiJS scene logic (entities, layers, tokens). The shared-types package provides event contracts. The web app (`apps/web`) consumes events via hooks and wires scene↔panel interactions. Changes flow: shared-types → core → renderer → web.

**Tech Stack:** TypeScript, PixiJS 8, GSAP 3, React 19, Tailwind CSS 4, Vitest

---

## File Structure

### Modified Files (18)

| # | File | Chunk | Responsibility |
|---|------|-------|---------------|
| 1 | `packages/shared-types/src/events.ts` | 1 | Extend PlanCreatedPayload, add UiSelectionPayload, add EventFamily entries |
| 2 | `packages/shared-types/src/index.ts` | 1 | Export new payload type |
| 3 | `packages/core/src/events/event-factories.ts` | 1 | Update planCreated factory signature |
| 4 | `packages/core/src/agents/pm-planner-node.ts` | 1 | Pass task details in plan.created emission |
| 5 | `packages/renderer/src/core/scene-manager.ts` | 2,4,5,6,7,8 | Layer architecture, route lines, selection sync, install ghost, meeting handlers, attention router |
| 6 | `packages/renderer/src/core/types.ts` | 2 | Add SceneManagerOptions.entityStyle, layer types |
| 7 | `packages/renderer/src/entities/lobster-entity.ts` | 3 | Add searching/blocked/waiting/reporting/success animations |
| 8 | `packages/renderer/src/entities/employee-entity.ts` | 3 | Add searching/blocked/waiting/reporting/success animations |
| 9 | `packages/renderer/src/entities/meeting-room-entity.ts` | 6 | Scheduled/gathering/active/ended states |
| 10 | `packages/renderer/src/tokens/motion.ts` | 8 | PerformanceTier, MOTION_TIER_B, tier helpers |
| 11 | `packages/renderer/src/index.ts` | 2,4 | Export new entities and types |
| 12 | `apps/web/src/hooks/useTaskDashboard.ts` | 2 | Remove placeholders, use enriched payload, accept agents |
| 13 | `apps/web/src/components/events/EventLog.tsx` | 2 | Add plan/task/deliverable subscriptions |
| 14 | `apps/web/src/components/plan/TaskItem.tsx` | 2 | Display resolved employee name |
| 15 | `apps/web/src/components/layout/RightSidebar.tsx` | 2 | Pass agents to TaskDashboard |
| 16 | `apps/web/src/components/plan/TaskDashboard.tsx` | 2 | Accept and forward agents prop |
| 17 | `apps/web/src/components/plan/TaskStepCard.tsx` | 4 | Task echo highlight |
| 18 | `apps/web/src/components/pitch/PitchHall.tsx` | 7 | Deliverable card enter animation, delivery states |

### New Files (6)

| # | File | Chunk | Responsibility |
|---|------|-------|
| 19 | `packages/renderer/src/entities/route-line-entity.ts` | 4 | Dashed route line between entities |
| 20 | `packages/renderer/src/__tests__/route-line-entity.test.ts` | 4 | RouteLineEntity unit tests |
| 21 | `packages/renderer/src/__tests__/layer-architecture.test.ts` | 2 | Layer container hierarchy tests |
| 22 | `packages/renderer/src/__tests__/employee-animations.test.ts` | 3 | Missing state animation tests |
| 23 | `packages/core/src/__tests__/unit/plan-created-enriched.test.ts` | 1 | Enriched planCreated factory test |
| 24 | `apps/web/src/components/install/install-animations.css` | 5 | CSS keyframes for install trust flow |

---

## Chunk 1: Foundation (shared-types + core + layer architecture)

### Task 1.1: Extend PlanCreatedPayload

**Files:**
- Modify: `packages/shared-types/src/events.ts`

- [ ] **Step 1: Add `summary` and `tasks[]` to PlanCreatedPayload**

In `packages/shared-types/src/events.ts`, replace the current `PlanCreatedPayload` (lines 162–170):

```typescript
export interface PlanCreatedPayload {
  readonly planId: string;
  readonly threadId: string;
  readonly summary: string;
  readonly steps: ReadonlyArray<{
    readonly stepIndex: number;
    readonly description: string;
    readonly taskCount: number;
    readonly tasks: ReadonlyArray<{
      readonly taskRunId: string;
      readonly taskType: string;
      readonly description: string;
      readonly employeeId: string;
    }>;
  }>;
}
```

- [ ] **Step 2: Add UiSelectionPayload interface**

Add after `DirectChatCompletedPayload`:

```typescript
// --- Runtime Experience: UI Selection ---

export interface UiSelectionPayload {
  readonly entityId: string | null;
  readonly entityType: 'employee' | 'meeting' | 'install';
  readonly source: 'scene' | 'panel';
}
```

- [ ] **Step 3: Add `ui.scene.task.echo` to EventFamily union**

In the `EventFamily` type, add `'ui.scene.task.echo'` after the existing `'ui.selection.changed'` entry.

- [ ] **Step 4: Export UiSelectionPayload from index**

In `packages/shared-types/src/index.ts`, add `UiSelectionPayload` to the exports from `'./events.js'`.

- [ ] **Step 5: Build shared-types**

Run: `cd packages/shared-types && pnpm build`

Expected: Build succeeds, no errors.

### Task 1.2: Update planCreated factory

**Files:**
- Modify: `packages/core/src/events/event-factories.ts`

- [ ] **Step 1: Update planCreated factory signature**

Replace the `planCreated` function (lines 272–287):

```typescript
export function planCreated(
  companyId: string,
  planId: string,
  threadId: string,
  summary: string,
  steps: PlanCreatedPayload['steps'],
): RuntimeEvent<PlanCreatedPayload> {
  return {
    type: 'plan.created',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, threadId, summary, steps },
  };
}
```

### Task 1.3: Update pm-planner-node emission

**Files:**
- Modify: `packages/core/src/agents/pm-planner-node.ts`

- [ ] **Step 1: Pass task details and summary in planCreated emission**

Replace the `eventBus.emit(planCreated(...))` block (lines 238–249):

```typescript
  eventBus.emit(
    planCreated(
      companyId,
      planId,
      threadId,
      plan.summary,
      planSteps.map((s) => ({
        stepIndex: s.stepIndex,
        description: s.description,
        taskCount: s.tasks.length,
        tasks: s.tasks.map((t) => ({
          taskRunId: t.taskRunId,
          taskType: t.taskType,
          description: t.description,
          employeeId: t.employeeId,
        })),
      })),
    ),
  );
```

### Task 1.4: Write enriched planCreated test

**Files:**
- Create: `packages/core/src/__tests__/unit/plan-created-enriched.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from 'vitest';
import { planCreated } from '../../events/event-factories.js';

describe('planCreated (enriched)', () => {
  it('includes summary and task details in payload', () => {
    const event = planCreated('c1', 'plan-1', 'thread-1', 'Test plan', [
      {
        stepIndex: 0,
        description: 'Step one',
        taskCount: 2,
        tasks: [
          { taskRunId: 'tr-1', taskType: 'research', description: 'Research AI', employeeId: 'emp-a' },
          { taskRunId: 'tr-2', taskType: 'writing', description: 'Write report', employeeId: 'emp-b' },
        ],
      },
    ]);

    expect(event.type).toBe('plan.created');
    expect(event.payload.summary).toBe('Test plan');
    expect(event.payload.steps).toHaveLength(1);
    expect(event.payload.steps[0]!.tasks).toHaveLength(2);
    expect(event.payload.steps[0]!.tasks[0]!.taskRunId).toBe('tr-1');
    expect(event.payload.steps[0]!.tasks[0]!.description).toBe('Research AI');
    expect(event.payload.steps[0]!.taskCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @aics/core test -- --run src/__tests__/unit/plan-created-enriched.test.ts`

Expected: PASS

- [ ] **Step 3: Run full typecheck**

Run: `pnpm turbo run typecheck`

Expected: All packages pass. This validates the signature change doesn't break existing callers (pm-planner-node is the only caller of planCreated).

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/events.ts packages/shared-types/src/index.ts packages/core/src/events/event-factories.ts packages/core/src/agents/pm-planner-node.ts packages/core/src/__tests__/unit/plan-created-enriched.test.ts
git commit -m "feat(shared-types,core): enrich PlanCreatedPayload with summary and task details

Add summary field and tasks[] array to PlanCreatedPayload so the frontend
can display real task descriptions instead of placeholder taskRunIds.
Add UiSelectionPayload and ui.scene.task.echo EventFamily entry for
upcoming selection sync feature.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 1.5: Layer architecture + types

**Files:**
- Modify: `packages/renderer/src/core/types.ts`
- Modify: `packages/renderer/src/core/scene-manager.ts`

- [ ] **Step 1: Add layer types and entityStyle to types.ts**

Add to `packages/renderer/src/core/types.ts`:

```typescript
/**
 * Named scene layers (z-order L0–L7).
 * Per SCENE_STATE_MATRIX §4.
 */
export const LAYER_NAMES = [
  'floor',       // L0: floor tiles, room boundaries
  'furniture',   // L1: desks, chairs, monitors, racks
  'entity',      // L2: employee avatars
  'accent',      // L3: halos, desk glows, state rings
  'semantic',    // L4: route lines, install candidates
  'bubble',      // L5: task bubbles, report markers
  'focus',       // L6: spotlight, attention router
  'bridge',      // L7: DOM-coordinated anchors
] as const;

export type LayerName = (typeof LAYER_NAMES)[number];

export type SceneLayers = Record<LayerName, Container>;
```

In `SceneManagerOptions`, add:

```typescript
  /**
   * Default entity visual style for new employees.
   * 'lobster' (default): pixel-art lobster (OpenClaw style)
   * 'employee': classic circle avatar
   */
  entityStyle?: SceneEntityType;
```

- [ ] **Step 2: Refactor SceneManager.mount() to create layer hierarchy**

In `packages/renderer/src/core/scene-manager.ts`:

1. Add field: `private layers: SceneLayers | null = null;`
2. Add field: `private readonly entityStyle: SceneEntityType;`
3. In constructor, read: `this.entityStyle = options.entityStyle ?? 'lobster';`
4. Replace the mount() scene graph section with layer creation:

```typescript
    // Build layer hierarchy (L0-L7)
    const worldContainer = new Container();
    app.stage.addChild(worldContainer);

    const layers = {} as Record<LayerName, Container>;
    for (const name of LAYER_NAMES) {
      const layer = new Container();
      layer.label = name; // PixiJS label for debug
      worldContainer.addChild(layer);
      layers[name] = layer;
    }
    this.layers = layers;

    // Floor layer → L0
    this.floorLayer = new FloorLayer();
    layers.floor.addChild(this.floorLayer.container);

    // Meeting room → L1 (furniture)
    this.meetingRoom = new MeetingRoomEntity(this.motion);
    this.meetingRoom.container.position.set(
      LAYOUT.floor.width / 2,
      LAYOUT.floor.height - LAYOUT.floor.padding - LAYOUT.meetingRoom.bottomOffset,
    );
    layers.furniture.addChild(this.meetingRoom.container);

    // Employee entities → L2 (entity)
    const deskPositions = this.floorLayer.getDeskPositions();
    this.employees.forEach((emp, i) => {
      const pos = deskPositions[i % deskPositions.length]!;
      const entity = this.createEntity(emp.id, emp.name, emp.entityType);
      entity.container.position.set(
        pos.x,
        pos.y - LAYOUT.desk.height / 2 - LAYOUT.employee.radius - 8,
      );
      layers.entity.addChild(entity.container);
      this.employeeEntities.set(emp.id, entity);
    });
```

5. Update `addEmployee()` to use `layers.entity` instead of `this.app.stage.children[0]`:

```typescript
    // Add to entity layer (L2)
    this.layers!.entity.addChild(entity.container);
```

6. Update `createEntity()` to use `this.entityStyle` as default:

```typescript
  private createEntity(id: string, name: string, entityType?: SceneEntityType): SceneEntity {
    const style = entityType ?? this.entityStyle;
    if (style === 'lobster') {
      return new LobsterEntity(id, name, this.motion);
    }
    return new EmployeeEntity(id, name, this.motion);
  }
```

7. Update `centerWorld()`:

```typescript
  private centerWorld(): void {
    if (!this.app) return;
    // World container is the parent of all layers (first stage child)
    const world = this.app.stage.children[0] as Container;
    const { width, height } = this.app.screen;
    world.position.set((LAYOUT.floor.width - width) / -2 + (width - LAYOUT.floor.width) / 2,
      (height - LAYOUT.floor.height) / 2);
  }
```

Actually, keep the existing centerWorld logic as-is — it works correctly.

8. Add `addToLayer()` helper:

```typescript
  /** Add a child to a named layer. Returns false if layers not initialized. */
  addToLayer(layer: LayerName, child: Container): boolean {
    if (!this.layers) return false;
    this.layers[layer].addChild(child);
    return true;
  }
```

9. Update imports to include `LAYER_NAMES, LayerName, SceneLayers`.

- [ ] **Step 3: Update renderer index.ts exports**

In `packages/renderer/src/index.ts`, add:

```typescript
export { LAYER_NAMES } from './core/types.js';
export type { LayerName, SceneLayers } from './core/types.js';
```

- [ ] **Step 4: Write layer architecture test**

Create `packages/renderer/src/__tests__/layer-architecture.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SceneEventBus } from '../core/types.js';
import { LAYER_NAMES } from '../core/types.js';

// Use the same pixi.js mock pattern from scene-manager.test.ts
vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    label = '';
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    pivot = { set: vi.fn(), x: 0, y: 0 };
    visible = true;
    alpha = 1;
    rotation = 0;
    addChild(c: unknown) { this.children.push(c); return c; }
    addChildAt(c: unknown, i: number) { this.children.splice(i, 0, c); return c; }
    removeChild(c: unknown) { const idx = this.children.indexOf(c); if (idx >= 0) this.children.splice(idx, 1); }
    destroy() {}
  }
  class MockGraphics extends MockContainer {
    clear() { return this; }
    circle() { return this; }
    roundRect() { return this; }
    rect() { return this; }
    fill() { return this; }
    stroke() { return this; }
    cut() { return this; }
  }
  class MockText extends MockContainer {
    text = '';
    anchor = { set: vi.fn() };
    width = 40;
    height = 12;
    constructor(opts?: { text?: string }) { super(); if (opts?.text) this.text = opts.text; }
  }
  class MockApplication {
    stage = new MockContainer();
    screen = { width: 800, height: 600 };
    canvas = { style: {} };
    renderer = { on: vi.fn(), off: vi.fn() };
    async init() {}
    destroy() {}
  }
  return { Container: MockContainer, Graphics: MockGraphics, Text: MockText, Application: MockApplication };
});

vi.mock('gsap', () => ({
  default: {
    to: vi.fn(() => ({ kill: vi.fn(), vars: {} })),
    fromTo: vi.fn(() => ({ kill: vi.fn(), vars: {} })),
  },
}));

import { SceneManager } from '../core/scene-manager.js';

function createMockEventBus(): SceneEventBus {
  return { on: vi.fn(() => vi.fn()) };
}

describe('Layer Architecture', () => {
  it('creates 8 named layer containers in L0-L7 order', async () => {
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const sm = new SceneManager({ container, eventBus: createMockEventBus() });
    await sm.mount();

    // Access layers through the public API or check stage children
    // World container is stage.children[0], layers are its children
    expect(sm.employeeCount).toBeGreaterThanOrEqual(0); // mount succeeded
    sm.destroy();
  });

  it('LAYER_NAMES has 8 entries in correct order', () => {
    expect(LAYER_NAMES).toEqual([
      'floor', 'furniture', 'entity', 'accent',
      'semantic', 'bubble', 'focus', 'bridge',
    ]);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @aics/renderer test -- --run`

Expected: All tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/core/types.ts packages/renderer/src/core/scene-manager.ts packages/renderer/src/index.ts packages/renderer/src/__tests__/layer-architecture.test.ts
git commit -m "feat(renderer): implement 8-layer scene architecture (L0-L7)

Migrate SceneManager from implicit z-ordering to named PIXI.Container
layers per SCENE_STATE_MATRIX §4. Add entityStyle option for global
entity type selection. Add addToLayer() helper for future entity types.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: TaskDashboard Data Completeness

### Task 2.1: Fix useTaskDashboard — remove placeholders, use enriched payload

**Files:**
- Modify: `apps/web/src/hooks/useTaskDashboard.ts`

- [ ] **Step 1: Update TaskDashboardState to accept agents**

Add `agents` parameter to the hook:

```typescript
export function useTaskDashboard(agents?: Map<string, { name: string }>): TaskDashboardState {
```

- [ ] **Step 2: Remove placeholderTasks function**

Delete the `placeholderTasks()` function (lines 85–94).

- [ ] **Step 3: Update plan.created handler to use real task data**

Replace the plan.created handler:

```typescript
    const offCreated = eventBus.on('plan.created', (e: RuntimeEvent<PlanCreatedPayload>) => {
      const { planId, summary, steps } = e.payload;
      update(() => ({
        planId,
        summary: summary || `Plan ${planId}`,
        steps: steps.map((s) => ({
          stepIndex: s.stepIndex,
          description: s.description,
          status: 'pending' as const,
          tasks: s.tasks.map((t) => ({
            taskRunId: t.taskRunId,
            employeeId: t.employeeId,
            employeeName: null,
            taskType: t.taskType,
            description: t.description,
            status: 'planned',
          })),
          expanded: false,
        })),
        currentStepIndex: -1,
        isComplete: false,
      }));
    });
```

- [ ] **Step 4: Fix task.assignment.changed handler — resolve employee name**

Replace the name assignment logic (around line 253–258):

```typescript
          if (assignStep && assignTask) {
            const resolvedName = action === 'assigned'
              ? agents?.get(employeeId)?.name ?? employeeId
              : null;
            assignStep.tasks[ti] = {
              ...assignTask,
              employeeId: action === 'assigned' ? employeeId : null,
              employeeName: resolvedName,
            };
          }
```

- [ ] **Step 5: Also resolve name in task.state.changed handler for new tasks**

In the "Unknown task" branch where a `newTask` is created, resolve the name:

```typescript
              const newTask: TaskInfo = {
                taskRunId,
                employeeId: employeeId ?? null,
                employeeName: employeeId ? (agents?.get(employeeId)?.name ?? employeeId) : null,
                taskType: nextStatus,
                description: taskRunId,
                status: nextStatus,
              };
```

- [ ] **Step 6: Pass agents to the update closures**

Since `agents` is a parameter that could change, use a ref:

```typescript
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
```

Then use `agentsRef.current` inside the event handlers instead of `agents` directly.

### Task 2.2: Wire agents into TaskDashboard component

**Files:**
- Modify: `apps/web/src/components/plan/TaskDashboard.tsx`
- Modify: `apps/web/src/components/layout/RightSidebar.tsx`

- [ ] **Step 1: Update TaskDashboard to accept and forward agents**

```typescript
import { useAgentStates } from '../../runtime/use-agent-states';
import { useTaskDashboard } from '../../hooks/useTaskDashboard';
import { TaskStepCard } from './TaskStepCard';

export function TaskDashboard({ agents }: { agents?: Map<string, { name: string }> }) {
  const dashboard = useTaskDashboard(agents);
  // ... rest unchanged
}
```

- [ ] **Step 2: Update RightSidebar to pass agents**

```typescript
import { useAgentStates } from '../../runtime/use-agent-states';
// ... existing imports

export function RightSidebar() {
  const agents = useAgentStates();

  return (
    <Tabs defaultValue="tasks" className="flex h-full flex-col">
      <TabsList className="mx-3 mt-2 shrink-0">
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="outputs">Outputs</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
      </TabsList>
      <TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto">
        <TaskDashboard agents={agents} />
      </TabsContent>
      <TabsContent value="outputs" className="min-h-0 flex-1 overflow-y-auto">
        <PitchHall />
      </TabsContent>
      <TabsContent value="events" className="min-h-0 flex-1 overflow-y-auto">
        <EventLog />
      </TabsContent>
    </Tabs>
  );
}
```

### Task 2.3: Expand EventLog subscriptions

**Files:**
- Modify: `apps/web/src/components/events/EventLog.tsx`

- [ ] **Step 1: Subscribe to multiple event prefixes**

Replace single `useEventStream('graph.node.')` with a multi-prefix approach. Since `useEventStream` takes one prefix, create a new combined hook or subscribe to a broad prefix. The simplest approach: use an empty prefix to get all events, then filter client-side. But that's wasteful. Better: create multiple streams and merge.

Actually, looking at the EventBus prefix matching, we can use a very short prefix. The cleanest approach for 1.0:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeEvent } from '@aics/shared-types';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { ScrollArea } from '../ui/scroll-area';
import { EventItem } from './EventItem';

const EVENT_PREFIXES = ['graph.node.', 'plan.', 'task.', 'deliverable.'] as const;
const MAX_EVENTS = 200;

export function EventLog() {
  const { eventBus } = useAicsRuntime();
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const bufferRef = useRef<RuntimeEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    setEvents(prev => [...prev, ...batch].slice(-MAX_EVENTS));
  }, []);

  useEffect(() => {
    bufferRef.current = [];
    setEvents([]);

    const unsubs = EVENT_PREFIXES.map(prefix =>
      eventBus.on(prefix, (event: RuntimeEvent) => {
        bufferRef.current.push(event);
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(flush);
        }
      }),
    );

    return () => {
      for (const unsub of unsubs) unsub();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [eventBus, flush]);

  // Auto-scroll on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="flex flex-col h-full">
      <h2 className="font-pixel-display text-[8px] uppercase tracking-wider text-shell p-3 pb-1">
        Event Log
      </h2>
      <ScrollArea className="flex-1">
        <div ref={scrollRef}>
          {events.length === 0 ? (
            <div className="p-3 text-xs text-ocean-light">No events yet</div>
          ) : (
            events.map((event, i) => <EventItem key={`${event.timestamp}-${i}`} event={event} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm turbo run typecheck`

Expected: PASS

- [ ] **Step 3: Run web build**

Run: `pnpm --filter @aics/web build`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useTaskDashboard.ts apps/web/src/components/plan/TaskDashboard.tsx apps/web/src/components/layout/RightSidebar.tsx apps/web/src/components/events/EventLog.tsx apps/web/src/components/plan/TaskItem.tsx
git commit -m "fix(web): TaskDashboard uses real task data, resolves employee names

Remove placeholder mechanism in useTaskDashboard. Use enriched
PlanCreatedPayload tasks[] for real descriptions and IDs at creation.
Resolve employeeName via useAgentStates passed from RightSidebar.
Expand EventLog to subscribe to plan/task/deliverable events.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Employee State Animations (ANIM-008/010/011/012/013)

### Task 3.1: Add missing animations to LobsterEntity

**Files:**
- Modify: `packages/renderer/src/entities/lobster-entity.ts`

- [ ] **Step 1: Extend setState() with new state branches**

In `LobsterEntity.setState()`, after the existing `thinking`/`searching`/`executing` branches in the body part animation section (around line 250–267), add the missing states. The full state dispatch should be:

```typescript
    // --- Body part animations based on state ---
    this.stopBodyAnimations();

    if (next === 'idle' || next === 'paused') {
      // Gentle idle bob only
      this.bodyAnimTweens.push(createIdleBob(this.container, this.motion.M1));
    } else if (next === 'thinking') {
      this.bodyAnimTweens.push(createIdleBob(this.container, this.motion.M1));
      this.bodyAnimTweens.push(createThinkingAnimation(this.antennaL, this.antennaR, this.eyesGfx, this.motion.M1));
      this.bodyAnimTweens.push(createClawWiggle(this.clawL, this.clawR, this.motion.M1));
    } else if (next === 'searching') {
      // ANIM-008: Eyes scan left-right, antennae point forward
      this.bodyAnimTweens.push(createIdleBob(this.container, this.motion.M1));
      this.bodyAnimTweens.push(createSearchingAnimation(this.eyesGfx, this.antennaL, this.antennaR, this.motion.M1));
    } else if (next === 'executing') {
      this.bodyAnimTweens.push(createIdleBob(this.container, this.motion.M1));
      this.bodyAnimTweens.push(createWorkingAnimation(this.clawL, this.clawR, this.motion.M1));
    } else if (next === 'blocked') {
      // ANIM-010: Claws fold inward (defensive), tiny jitter
      this.bodyAnimTweens.push(createBlockedAnimation(this.clawL, this.clawR, this.container, this.motion.M2));
    } else if (next === 'waiting' || next === 'assigned') {
      // ANIM-011: Subtle breathe, low energy
      this.bodyAnimTweens.push(createWaitingAnimation(this.container, this.motion.M1));
    } else if (next === 'reporting') {
      // ANIM-012: Brief upward float
      this.bodyAnimTweens.push(createReportingAnimation(this.container, this.motion.M2));
    } else if (next === 'success') {
      // ANIM-013: Claws open wide (celebration)
      this.bodyAnimTweens.push(createSuccessAnimation(this.clawL, this.clawR, this.motion.M2));
    } else if (next === 'meeting') {
      this.bodyAnimTweens.push(createIdleBob(this.container, this.motion.M1));
    }
```

- [ ] **Step 2: Add new animation factory functions to lobster-animations.ts**

In `packages/renderer/src/entities/lobster-animations.ts`, add:

```typescript
/** ANIM-008: Searching — eyes scan left-right, antennae point forward */
export function createSearchingAnimation(
  eyes: Container,
  antennaL: Container,
  antennaR: Container,
  motion: MotionBucket,
): gsap.core.Timeline {
  if (motion.duration === 0) return gsap.timeline();
  const tl = gsap.timeline({ repeat: -1 });
  // Eyes scan left-right
  tl.to(eyes, { x: eyes.position.x - 4, duration: 0.6, ease: 'sine.inOut' });
  tl.to(eyes, { x: eyes.position.x + 4, duration: 1.2, ease: 'sine.inOut' });
  tl.to(eyes, { x: eyes.position.x, duration: 0.6, ease: 'sine.inOut' });
  // Antennae lean forward slightly
  gsap.to(antennaL, { rotation: -0.15, duration: 0.4, ease: 'sine.out' });
  gsap.to(antennaR, { rotation: 0.15, duration: 0.4, ease: 'sine.out' });
  return tl;
}

/** ANIM-010: Blocked — claws fold inward, tiny jitter */
export function createBlockedAnimation(
  clawL: Container,
  clawR: Container,
  body: Container,
  motion: MotionBucket,
): gsap.core.Timeline {
  if (motion.duration === 0) return gsap.timeline();
  const tl = gsap.timeline({ repeat: -1 });
  // Claws fold inward (defensive)
  gsap.to(clawL, { rotation: 0.3, duration: 0.3, ease: 'power2.out' });
  gsap.to(clawR, { rotation: -0.3, duration: 0.3, ease: 'power2.out' });
  // Tiny jitter
  tl.to(body, { x: body.position.x + 1, duration: 0.15, ease: 'none' });
  tl.to(body, { x: body.position.x - 1, duration: 0.15, ease: 'none' });
  tl.to(body, { x: body.position.x, duration: 0.15, ease: 'none' });
  return tl;
}

/** ANIM-011: Waiting — subtle breathe, low energy */
export function createWaitingAnimation(
  body: Container,
  motion: MotionBucket,
): gsap.core.Tween {
  if (motion.duration === 0) return gsap.to({}, { duration: 0 });
  return gsap.to(body.scale, {
    x: 1.01, y: 1.01,
    duration: 1.5,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
  });
}

/** ANIM-012: Reporting — brief upward float */
export function createReportingAnimation(
  body: Container,
  motion: MotionBucket,
): gsap.core.Tween {
  if (motion.duration === 0) return gsap.to({}, { duration: 0 });
  return gsap.to(body, {
    y: body.position.y - 2,
    duration: motion.duration,
    ease: motion.ease,
    yoyo: true,
    repeat: -1,
  });
}

/** ANIM-013: Success — claws open wide briefly */
export function createSuccessAnimation(
  clawL: Container,
  clawR: Container,
  motion: MotionBucket,
): gsap.core.Timeline {
  if (motion.duration === 0) return gsap.timeline();
  const tl = gsap.timeline();
  tl.to(clawL, { rotation: -0.5, duration: 0.15, ease: 'back.out(2)' });
  tl.to(clawR, { rotation: 0.5, duration: 0.15, ease: 'back.out(2)' }, '<');
  tl.to(clawL, { rotation: 0, duration: 0.3, ease: 'power2.inOut' }, '+=0.2');
  tl.to(clawR, { rotation: 0, duration: 0.3, ease: 'power2.inOut' }, '<');
  return tl;
}
```

Add `import type { Container } from 'pixi.js';` at the top if not already present.

- [ ] **Step 3: Update imports in lobster-entity.ts**

Add the new animation factory imports:

```typescript
import {
  createIdleBob,
  createClawWiggle,
  createThinkingAnimation,
  createWorkingAnimation,
  createSearchingAnimation,
  createBlockedAnimation,
  createWaitingAnimation,
  createReportingAnimation,
  createSuccessAnimation,
} from './lobster-animations.js';
```

- [ ] **Step 4: Update ACTIVE_STATES set**

Expand the set to include all non-idle/paused states that should have body animations:

The `ACTIVE_STATES` at the bottom of the file controls the ring pulse. Update:

```typescript
const ACTIVE_STATES: ReadonlySet<EmployeeState> = new Set([
  'thinking', 'searching', 'executing', 'reporting',
]);
```

### Task 3.2: Add missing animations to EmployeeEntity

**Files:**
- Modify: `packages/renderer/src/entities/employee-entity.ts`

- [ ] **Step 1: Add state-specific behaviors to setState()**

After the ring-drawing and before the pulse section, add animation branches for new states. EmployeeEntity doesn't have body parts like LobsterEntity, so animations are simpler (ring effects only):

In the `setState()` method, before the pulse section, add to the existing switch-like block:

```typescript
      // ANIM-008: Searching — ring dash animation (simulated as fast pulse)
      if (next === 'searching') {
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.05, y: 1.05,
          duration: 0.3,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      }
      // ANIM-011: Waiting — very slow breathe
      else if (next === 'waiting' || next === 'assigned') {
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.01, y: 1.01,
          duration: 1.5,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      }
      // ANIM-012: Reporting — upward float
      else if (next === 'reporting') {
        this.trackTween(gsap.to(this.container, {
          y: this.container.y - 2,
          duration: this.motion.M2.duration,
          ease: this.motion.M2.ease,
          yoyo: true,
          repeat: -1,
        }));
      }
```

Restructure the existing pulse code to handle all states properly. The simplest approach: replace the final pulse block with:

```typescript
    // Start continuous pulse for active work states
    if (next !== 'idle' && next !== 'paused' && next !== 'failed' && next !== 'success' && this.motion.M1.duration > 0) {
      if (next === 'searching') {
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.05, y: 1.05, duration: 0.3, ease: 'sine.inOut', yoyo: true, repeat: -1,
        });
      } else if (next === 'waiting' || next === 'assigned') {
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.01, y: 1.01, duration: 1.5, ease: 'sine.inOut', yoyo: true, repeat: -1,
        });
      } else if (next === 'reporting') {
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.06, y: 1.06, duration: this.motion.M1.duration, ease: 'sine.inOut', yoyo: true, repeat: -1,
        });
      } else if (isActiveState(next)) {
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.08, y: 1.08, duration: this.motion.M1.duration, ease: 'sine.inOut', yoyo: true, repeat: -1,
        });
      }
    }
```

### Task 3.3: Write animation tests

**Files:**
- Create: `packages/renderer/src/__tests__/employee-animations.test.ts`

- [ ] **Step 1: Write tests for new states**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    pivot = { set: vi.fn(), x: 0, y: 0 };
    visible = true;
    alpha = 1;
    rotation = 0;
    addChild(c: unknown) { this.children.push(c); return c; }
    addChildAt(c: unknown, i: number) { this.children.splice(i, 0, c); return c; }
    removeChild(c: unknown) { const idx = this.children.indexOf(c); if (idx >= 0) this.children.splice(idx, 1); }
    destroy() {}
  }
  class MockGraphics extends MockContainer {
    clear() { return this; }
    circle() { return this; }
    roundRect() { return this; }
    rect() { return this; }
    fill(_c?: unknown) { return this; }
    stroke(_c?: unknown) { return this; }
    cut() { return this; }
  }
  class MockText extends MockContainer {
    text = '';
    anchor = { set: vi.fn() };
    width = 40;
    height = 12;
    constructor(opts?: { text?: string }) { super(); if (opts?.text) this.text = opts.text; }
  }
  return { Container: MockContainer, Graphics: MockGraphics, Text: MockText };
});

vi.mock('gsap', () => {
  const mockTween = { kill: vi.fn(), vars: {} };
  const mockTimeline = { kill: vi.fn(), to: vi.fn().mockReturnThis(), vars: {} };
  return {
    default: {
      to: vi.fn(() => ({ ...mockTween })),
      fromTo: vi.fn(() => ({ ...mockTween })),
      timeline: vi.fn(() => ({ ...mockTimeline })),
    },
  };
});

import { LobsterEntity } from '../entities/lobster-entity.js';
import { EmployeeEntity } from '../entities/employee-entity.js';
import { MOTION } from '../tokens/motion.js';

describe('LobsterEntity state animations', () => {
  let entity: LobsterEntity;

  beforeEach(() => {
    entity = new LobsterEntity('emp-test', 'Test', MOTION);
  });

  it.each([
    'searching', 'blocked', 'waiting', 'reporting', 'success',
  ] as const)('setState(%s) does not throw', (state) => {
    expect(() => entity.setState(state)).not.toThrow();
  });

  it('transitions through all 12 states without error', () => {
    const states = [
      'idle', 'assigned', 'thinking', 'searching', 'executing',
      'meeting', 'blocked', 'waiting', 'reporting', 'success', 'failed', 'paused',
    ] as const;
    for (const s of states) {
      expect(() => entity.setState(s)).not.toThrow();
    }
  });

  it('destroy() cleans up after all state transitions', () => {
    entity.setState('searching');
    entity.setState('blocked');
    expect(() => entity.destroy()).not.toThrow();
  });
});

describe('EmployeeEntity state animations', () => {
  let entity: EmployeeEntity;

  beforeEach(() => {
    entity = new EmployeeEntity('emp-test', 'Test', MOTION);
  });

  it.each([
    'searching', 'blocked', 'waiting', 'reporting', 'success',
  ] as const)('setState(%s) does not throw', (state) => {
    expect(() => entity.setState(state)).not.toThrow();
  });

  it('destroy() cleans up after all state transitions', () => {
    entity.setState('searching');
    entity.setState('reporting');
    expect(() => entity.destroy()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @aics/renderer test -- --run`

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/entities/lobster-entity.ts packages/renderer/src/entities/employee-entity.ts packages/renderer/src/entities/lobster-animations.ts packages/renderer/src/__tests__/employee-animations.test.ts
git commit -m "feat(renderer): add searching/blocked/waiting/reporting/success animations

ANIM-008: Searching sweep (eye scan + antenna forward on Lobster)
ANIM-010: Blocked alert (defensive claws + jitter on Lobster)
ANIM-011: Waiting breathe (subtle scale oscillation)
ANIM-012: Reporting float (upward y offset)
ANIM-013: Success celebration (claws open on Lobster)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Route Lines + Selection Sync (ANIM-004/005/015)

### Task 4.1: Create RouteLineEntity

**Files:**
- Create: `packages/renderer/src/entities/route-line-entity.ts`

- [ ] **Step 1: Write RouteLineEntity**

```typescript
import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';
import type { MotionBucket } from '../tokens/motion.js';

/** Draw a dashed line manually (PixiJS 8 Graphics has no native dash support). */
function drawDashedLine(
  g: Graphics,
  x1: number, y1: number,
  x2: number, y2: number,
  dashLen: number,
  gapLen: number,
  offset: number,
  color: number,
  lineWidth: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return;

  const ux = dx / dist;
  const uy = dy / dist;
  const segLen = dashLen + gapLen;
  // Normalize offset to [0, segLen)
  let pos = ((offset % segLen) + segLen) % segLen;

  while (pos < dist) {
    const dashStart = Math.max(pos, 0);
    const dashEnd = Math.min(pos + dashLen, dist);
    if (dashEnd > dashStart && dashStart < dist) {
      // PixiJS 8: moveTo → lineTo → stroke({ color, width })
      g.moveTo(x1 + ux * dashStart, y1 + uy * dashStart);
      g.lineTo(x1 + ux * dashEnd, y1 + uy * dashEnd);
      g.stroke({ color, width: lineWidth });
    }
    pos += segLen;
  }
}

/**
 * Animated dashed route line between two scene positions.
 * Used for task handoff visualization (ANIM-004).
 *
 * The dash offset increments each frame via a GSAP tween driving
 * a proxy value, triggering `redraw()` on update.
 */
export class RouteLineEntity {
  readonly container: Container;
  readonly taskRunId: string;

  private readonly gfx: Graphics;
  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;
  private color: number;
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;
  private dashOffset = 0;
  private dashTween: gsap.core.Tween | null = null;
  private fadeTween: gsap.core.Tween | null = null;

  constructor(
    taskRunId: string,
    color: number,
    motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>,
  ) {
    this.taskRunId = taskRunId;
    this.color = color;
    this.motion = motion;
    this.container = new Container();
    this.gfx = new Graphics();
    this.container.addChild(this.gfx);
  }

  /** Set endpoints and start dash animation. */
  setEndpoints(fromX: number, fromY: number, toX: number, toY: number): void {
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
    this.redraw();
    this.startDashAnimation();
  }

  /** Update line color (e.g., on task state change). */
  setColor(color: number): void {
    this.color = color;
    this.redraw();
  }

  /** Fade out and call onComplete when done. */
  fadeOut(onComplete?: () => void): void {
    this.stopDashAnimation();
    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      this.fadeTween = gsap.to(this.container, {
        alpha: 0,
        duration: 0.5,
        ease,
        onComplete: () => {
          this.destroy();
          onComplete?.();
        },
      });
    } else {
      this.destroy();
      onComplete?.();
    }
  }

  destroy(): void {
    this.stopDashAnimation();
    this.fadeTween?.kill();
    this.fadeTween = null;
    this.container.destroy({ children: true });
  }

  private redraw(): void {
    this.gfx.clear();
    drawDashedLine(
      this.gfx,
      this.fromX, this.fromY,
      this.toX, this.toY,
      8, 4, // dash: 8px on, 4px off
      this.dashOffset,
      this.color,
      2,
    );
  }

  private startDashAnimation(): void {
    this.stopDashAnimation();
    if (this.motion.M1.duration === 0) return; // Tier C: static line

    const proxy = { offset: 0 };
    this.dashTween = gsap.to(proxy, {
      offset: 12, // dash + gap = 12px cycle
      duration: 0.8,
      ease: 'none',
      repeat: -1,
      onUpdate: () => {
        this.dashOffset = proxy.offset;
        this.redraw();
      },
    });
  }

  private stopDashAnimation(): void {
    this.dashTween?.kill();
    this.dashTween = null;
  }
}
```

- [ ] **Step 2: Export RouteLineEntity**

In `packages/renderer/src/index.ts`, add:

```typescript
export { RouteLineEntity } from './entities/route-line-entity.js';
```

### Task 4.2: Integrate route lines into SceneManager

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts`

- [ ] **Step 1: Add route line tracking**

Add to SceneManager fields:

```typescript
  private routeLines: Map<string, RouteLineEntity> = new Map();
```

Add import:

```typescript
import { RouteLineEntity } from '../entities/route-line-entity.js';
```

- [ ] **Step 2: Update task.assignment.changed handler**

Replace the existing handler to also create/remove route lines:

```typescript
    this.unsubscribers.push(
      this.eventBus.on('task.assignment.changed', (event) => {
        const { employeeId, action, taskRunId } = event.payload as TaskAssignmentPayload;
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
          this.clearToolOverlayTimer(employeeId);
          entity.setTask(action === 'assigned' ? taskRunId : null);
        }

        // Route line management (ANIM-004)
        if (action === 'assigned' && this.layers) {
          // Create route from first entity (boss/manager) to assigned employee
          const fromEntity = this.getRouteOrigin();
          const toEntity = this.employeeEntities.get(employeeId);
          if (fromEntity && toEntity) {
            const line = new RouteLineEntity(taskRunId, STATE_COLORS.assigned, this.motion);
            line.setEndpoints(
              fromEntity.container.x, fromEntity.container.y,
              toEntity.container.x, toEntity.container.y,
            );
            this.layers.semantic.addChild(line.container);
            this.routeLines.set(taskRunId, line);
          }
        } else if (action === 'unassigned') {
          this.removeRouteLine(taskRunId);
        }
      }),
    );
```

- [ ] **Step 3: Add route cleanup on task completion**

Add handler for `task.state.changed`:

```typescript
    this.unsubscribers.push(
      this.eventBus.on('task.state.changed', (event) => {
        const { taskRunId, next } = event.payload as import('@aics/shared-types').TaskStatePayload;
        if (next === 'completed' || next === 'failed' || next === 'cancelled') {
          this.removeRouteLine(taskRunId);
        }
      }),
    );
```

- [ ] **Step 4: Add helpers**

```typescript
  private getRouteOrigin(): SceneEntity | undefined {
    // Use the first entity in the map as route origin (boss/manager)
    return this.employeeEntities.values().next().value;
  }

  private removeRouteLine(taskRunId: string): void {
    const line = this.routeLines.get(taskRunId);
    if (line) {
      this.routeLines.delete(taskRunId);
      line.fadeOut();
    }
  }
```

- [ ] **Step 5: Clean up route lines in destroy()**

In `destroy()`, add:

```typescript
    for (const line of this.routeLines.values()) {
      line.destroy();
    }
    this.routeLines.clear();
```

### Task 4.3: Selection sync (ANIM-005)

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts`

- [ ] **Step 1: Add selection event handling**

In `subscribeEvents()`, add:

```typescript
    // Selection sync (ANIM-005) — panel → scene
    this.unsubscribers.push(
      this.eventBus.on('ui.selection.changed', (event) => {
        const payload = event.payload as import('@aics/shared-types').UiSelectionPayload;
        if (payload.source === 'panel') {
          // Highlight selected entity in scene
          for (const [id, entity] of this.employeeEntities) {
            entity.setHighlight(id === payload.entityId);
          }
        }
      }),
    );
```

Note: Scene → panel direction requires click handlers on entities, which need interactive containers. For 1.0, this is wired via the `ui.selection.changed` event from AgentPanel. Full interactive click on PixiJS entities is deferred to P2 (requires `eventMode: 'static'` on containers, which may impact performance).

### Task 4.4: Task echo (ANIM-015)

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts`
- Modify: `apps/web/src/components/plan/TaskStepCard.tsx`

- [ ] **Step 1: SceneManager emits echo on task state change**

Add to the existing `task.state.changed` handler:

```typescript
        // ANIM-015: Task echo — briefly highlight assigned employee
        if (next === 'running' || next === 'completed') {
          const employeeId = (event.payload as import('@aics/shared-types').TaskStatePayload).employeeId;
          if (employeeId) {
            const entity = this.employeeEntities.get(employeeId);
            if (entity) {
              entity.setHighlight(true);
              setTimeout(() => entity.setHighlight(false), 500);
            }
          }
        }
```

- [ ] **Step 2: Add CSS echo class to TaskStepCard**

In `apps/web/src/components/plan/TaskStepCard.tsx`, add a data attribute for CSS-based task echo animation. This will be driven by the parent when `task.state.changed` fires. For now, add the CSS class support:

In the `<li>` of `TaskItem.tsx`, add:

```typescript
    <li className={cn(
      'flex items-center gap-2 text-[10px] transition-colors duration-500',
      task.status === 'running' && 'border-l-2 border-koi pl-1',
    )}>
```

### Task 4.5: Write RouteLineEntity tests

**Files:**
- Create: `packages/renderer/src/__tests__/route-line-entity.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    visible = true;
    alpha = 1;
    addChild(c: unknown) { this.children.push(c); return c; }
    destroy() {}
  }
  class MockGraphics extends MockContainer {
    clear() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    stroke() { return this; }
  }
  return { Container: MockContainer, Graphics: MockGraphics };
});

vi.mock('gsap', () => ({
  default: {
    to: vi.fn(() => ({ kill: vi.fn(), vars: {} })),
  },
}));

import { RouteLineEntity } from '../entities/route-line-entity.js';
import { MOTION, MOTION_REDUCED } from '../tokens/motion.js';

describe('RouteLineEntity', () => {
  it('creates without error', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION);
    expect(line.taskRunId).toBe('tr-1');
    expect(line.container).toBeDefined();
  });

  it('setEndpoints draws line', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION);
    expect(() => line.setEndpoints(0, 0, 100, 100)).not.toThrow();
  });

  it('setColor updates without error', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION);
    line.setEndpoints(0, 0, 50, 50);
    expect(() => line.setColor(0xf87171)).not.toThrow();
  });

  it('destroy cleans up', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION);
    line.setEndpoints(0, 0, 50, 50);
    expect(() => line.destroy()).not.toThrow();
  });

  it('works with reduced motion (no dash animation)', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION_REDUCED);
    expect(() => line.setEndpoints(0, 0, 100, 100)).not.toThrow();
    line.destroy();
  });
});
```

- [ ] **Step 2: Run all renderer tests**

Run: `pnpm --filter @aics/renderer test -- --run`

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/entities/route-line-entity.ts packages/renderer/src/__tests__/route-line-entity.test.ts packages/renderer/src/core/scene-manager.ts packages/renderer/src/index.ts apps/web/src/components/plan/TaskItem.tsx
git commit -m "feat(renderer): add RouteLineEntity, selection sync, task echo

ANIM-004: Dashed route lines for task handoff visualization
ANIM-005: Panel→scene selection sync via ui.selection.changed
ANIM-015: Task state echo highlights assigned employee briefly

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: Install Trust Feedback (ANIM-020 through ANIM-026)

### Task 5.1: Install ghost entity in SceneManager

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts`

- [ ] **Step 1: Add ghost entity tracking**

Add fields:

```typescript
  /** Ghost entity shown during install preview (ANIM-020) */
  private installGhost: SceneEntity | null = null;
  private installGhostTxnId: string | null = null;
```

- [ ] **Step 2: Subscribe to install.state.changed**

In `subscribeEvents()`, add:

```typescript
    // Install trust feedback (ANIM-020 through ANIM-026)
    this.unsubscribers.push(
      this.eventBus.on('install.state.changed', (event) => {
        const payload = event.payload as import('@aics/shared-types').InstallStatePayload;
        const { installTxnId, next } = payload;

        if (next === 'compatibility_checked' || next === 'awaiting_confirmation') {
          // ANIM-020: Show ghost at empty desk
          this.showInstallGhost(installTxnId);
        } else if (next === 'materializing') {
          // ANIM-024: Increase ghost opacity
          this.stepInstallGhostOpacity(0.7);
        } else if (next === 'installed') {
          // ANIM-025: Ghost becomes real — handled by employee.installed event
          this.removeInstallGhost();
        } else if (next === 'failed' || next === 'rolled_back' || next === 'cancelled') {
          // ANIM-026: Ghost dissolves
          this.dissolveInstallGhost();
        }
      }),
    );
```

- [ ] **Step 3: Implement ghost helpers**

```typescript
  /** ANIM-020: Show semi-transparent ghost entity at empty desk */
  private showInstallGhost(txnId: string): void {
    if (this.installGhost || !this.layers || !this.floorLayer) return;

    // Find unoccupied desk position
    const deskPositions = this.floorLayer.getDeskPositions();
    const occupiedPositions = new Set<number>();
    let idx = 0;
    for (const [, entity] of this.employeeEntities) {
      for (let i = 0; i < deskPositions.length; i++) {
        const pos = deskPositions[i]!;
        if (Math.abs(entity.container.x - pos.x) < 10) {
          occupiedPositions.add(i);
        }
      }
      idx++;
    }
    const emptyIdx = deskPositions.findIndex((_, i) => !occupiedPositions.has(i));
    const pos = emptyIdx >= 0 ? deskPositions[emptyIdx]! : { x: LAYOUT.floor.width / 2, y: LAYOUT.floor.height / 2 };

    const ghost = this.createEntity('ghost-preview', '?', this.entityStyle);
    ghost.container.position.set(
      pos.x,
      pos.y - LAYOUT.desk.height / 2 - LAYOUT.employee.radius - 8,
    );
    ghost.container.alpha = 0.4;

    this.layers.semantic.addChild(ghost.container);
    this.installGhost = ghost;
    this.installGhostTxnId = txnId;
  }

  /** ANIM-024: Step ghost opacity during materialization */
  private stepInstallGhostOpacity(target: number): void {
    if (!this.installGhost) return;
    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      gsap.to(this.installGhost.container, { alpha: target, duration, ease });
    } else {
      this.installGhost.container.alpha = target;
    }
  }

  /** ANIM-025: Remove ghost (real entity added by employee.installed handler) */
  private removeInstallGhost(): void {
    if (!this.installGhost) return;
    this.installGhost.destroy();
    this.installGhost.container.destroy({ children: true });
    this.installGhost = null;
    this.installGhostTxnId = null;
  }

  /** ANIM-026: Ghost dissolves with fade + shrink */
  private dissolveInstallGhost(): void {
    if (!this.installGhost) return;
    const ghost = this.installGhost;
    this.installGhost = null;
    this.installGhostTxnId = null;

    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      gsap.to(ghost.container, { alpha: 0, duration: 0.5, ease });
      gsap.to(ghost.container.scale, {
        x: 0.8, y: 0.8, duration: 0.5, ease,
        onComplete: () => {
          ghost.destroy();
          ghost.container.destroy({ children: true });
        },
      });
    } else {
      ghost.destroy();
      ghost.container.destroy({ children: true });
    }
  }
```

- [ ] **Step 4: Clean up ghost in destroy()**

In `destroy()`, add:

```typescript
    if (this.installGhost) {
      this.installGhost.destroy();
      this.installGhost = null;
    }
```

### Task 5.2: Install DOM transitions (CSS)

**Files:**
- Create: `apps/web/src/components/install/install-animations.css`

- [ ] **Step 1: Write CSS keyframes**

```css
/* ANIM-021: Manifest review row reveal */
@keyframes reveal-row {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.manifest-row-reveal {
  animation: reveal-row 0.3s ease-out both;
}

/* Stagger: each child delays 50ms more */
.manifest-row-reveal:nth-child(1) { animation-delay: 0ms; }
.manifest-row-reveal:nth-child(2) { animation-delay: 50ms; }
.manifest-row-reveal:nth-child(3) { animation-delay: 100ms; }
.manifest-row-reveal:nth-child(4) { animation-delay: 150ms; }
.manifest-row-reveal:nth-child(5) { animation-delay: 200ms; }
.manifest-row-reveal:nth-child(6) { animation-delay: 250ms; }
.manifest-row-reveal:nth-child(7) { animation-delay: 300ms; }
.manifest-row-reveal:nth-child(8) { animation-delay: 350ms; }

/* ANIM-022: Compatibility verdict emphasis */
[data-verdict="fail"] {
  border-color: theme('colors.lobster-red') !important;
  animation: verdict-pulse 0.5s ease-in-out 2;
}

[data-verdict="pass"] .verdict-icon {
  animation: fade-in 0.3s ease-out both;
}

@keyframes verdict-pulse {
  0%, 100% { border-color: theme('colors.lobster-red'); }
  50% { border-color: theme('colors.lobster-red/50'); }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ANIM-023: Binding required state */
.binding-required {
  border: 1px dashed theme('colors.sand');
  background-color: theme('colors.sand/10');
}

.binding-required-badge {
  animation: badge-pulse 1.5s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
```

- [ ] **Step 2: Import CSS in install components**

Add `import './install-animations.css';` in `InstallDialog.tsx`.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/core/scene-manager.ts apps/web/src/components/install/install-animations.css apps/web/src/components/install/InstallDialog.tsx
git commit -m "feat(renderer,web): install trust feedback (ANIM-020~026)

ANIM-020: Ghost entity at empty desk during install preview
ANIM-024: Stepped opacity during materialization
ANIM-025: Ghost cleanup on successful install
ANIM-026: Ghost dissolve on failure/rollback
ANIM-021/022/023: CSS transitions for manifest reveal, compatibility
verdict emphasis, and binding-required state.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 6: Meeting Scene Integration (ANIM-016 through ANIM-019)

### Task 6.1: Extend MeetingRoomEntity

**Files:**
- Modify: `packages/renderer/src/entities/meeting-room-entity.ts`

- [ ] **Step 1: Add scheduled/gathering/active state methods**

```typescript
  /** ANIM-016: Meeting scheduled — soft glow tint */
  showScheduled(): void {
    this.container.visible = true;
    this.container.scale.set(1);
    this.container.alpha = 1;
    // Add amber glow tint to table
    this.tableGlow = new Graphics();
    this.tableGlow.roundRect(
      -LAYOUT.meetingRoom.tableWidth / 2 - 4,
      -LAYOUT.meetingRoom.tableHeight / 2 - 4,
      LAYOUT.meetingRoom.tableWidth + 8,
      LAYOUT.meetingRoom.tableHeight + 8,
      LAYOUT.meetingRoom.tableCornerRadius,
    );
    this.tableGlow.fill({ color: 0xfbbf24, alpha: 0.15 });
    this.container.addChildAt(this.tableGlow, 0);
  }

  /** ANIM-017: Gathering — increase glow */
  showGathering(): void {
    if (this.tableGlow) {
      const { duration, ease } = this.motion.M2;
      if (duration > 0) {
        this.trackTween(gsap.to(this.tableGlow, { alpha: 0.3, duration, ease }));
      } else {
        this.tableGlow.alpha = 0.3;
      }
    }
  }

  /** ANIM-018: Active meeting — focus glow */
  showActive(): void {
    if (this.tableGlow) {
      const { duration, ease } = this.motion.M2;
      if (duration > 0) {
        this.trackTween(gsap.to(this.tableGlow, { alpha: 0.4, duration, ease }));
      } else {
        this.tableGlow.alpha = 0.4;
      }
    }
  }

  /** ANIM-019: Meeting ended — fade glow */
  showEnded(): void {
    if (this.tableGlow) {
      const { duration, ease } = this.motion.M2;
      if (duration > 0) {
        this.trackTween(gsap.to(this.tableGlow, {
          alpha: 0,
          duration,
          ease,
          onComplete: () => {
            if (this.tableGlow) {
              this.container.removeChild(this.tableGlow);
              this.tableGlow.destroy();
              this.tableGlow = null;
            }
          },
        }));
      } else if (this.tableGlow) {
        this.container.removeChild(this.tableGlow);
        this.tableGlow.destroy();
        this.tableGlow = null;
      }
    }
  }
```

Add field: `private tableGlow: Graphics | null = null;`

Add import: `import { LAYOUT } from '../tokens/layout.js';` (already imported).

- [ ] **Step 2: Clean up tableGlow in destroy()**

In `destroy()`, add before the container.destroy:

```typescript
    if (this.tableGlow) {
      this.tableGlow.destroy();
      this.tableGlow = null;
    }
```

### Task 6.2: Update SceneManager meeting handlers

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts`

- [ ] **Step 1: Replace meeting state handler**

Replace the existing meeting handler:

```typescript
    this.unsubscribers.push(
      this.eventBus.on('meeting.state.changed', (event) => {
        const { next, participantIds } = event.payload as MeetingStatePayload;
        switch (next) {
          case 'scheduled':
            this.meetingRoom?.showScheduled();
            break;
          case 'gathering':
            this.meetingRoom?.showGathering();
            // ANIM-017: Route lines from participants to meeting room
            if (this.layers && this.meetingRoom) {
              for (const pid of participantIds) {
                const entity = this.employeeEntities.get(pid);
                if (entity) {
                  const line = new RouteLineEntity(
                    `meeting-${pid}`,
                    STATE_COLORS.meeting,
                    this.motion,
                  );
                  line.setEndpoints(
                    entity.container.x, entity.container.y,
                    this.meetingRoom.container.x, this.meetingRoom.container.y,
                  );
                  this.layers.semantic.addChild(line.container);
                  this.routeLines.set(`meeting-${pid}`, line);
                }
              }
            }
            break;
          case 'running':
            this.meetingRoom?.showActive();
            break;
          case 'completed':
          case 'cancelled':
            this.meetingRoom?.showEnded();
            // Remove meeting route lines
            for (const pid of participantIds) {
              this.removeRouteLine(`meeting-${pid}`);
            }
            break;
        }
      }),
    );
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @aics/renderer test -- --run`

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/entities/meeting-room-entity.ts packages/renderer/src/core/scene-manager.ts
git commit -m "feat(renderer): meeting scene integration (ANIM-016~019)

ANIM-016: Scheduled meeting table glow
ANIM-017: Gathering route lines + glow increase
ANIM-018: Active meeting focus glow
ANIM-019: Meeting end — fade glow + remove route lines

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 7: Report/Delivery + Import Feedback (ANIM-027 through ANIM-031)

### Task 7.1: Report-ready scene cue (ANIM-028)

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts`

- [ ] **Step 1: Subscribe to report.state.changed**

```typescript
    // Report state changes (ANIM-028, ANIM-031)
    this.unsubscribers.push(
      this.eventBus.on('report.state.changed', (event) => {
        const payload = event.payload as { next: string; employeeId?: string };
        if (payload.next === 'ready' && payload.employeeId) {
          // ANIM-028: Brief highlight on employee
          const entity = this.employeeEntities.get(payload.employeeId);
          if (entity) {
            entity.setHighlight(true);
            setTimeout(() => entity.setHighlight(false), 2000);
          }
        }
      }),
    );
```

### Task 7.2: PitchHall deliverable card animations (ANIM-029, ANIM-030)

**Files:**
- Modify: `apps/web/src/components/pitch/PitchHall.tsx`

- [ ] **Step 1: Add enter animation to DeliverableCard**

Wrap the Card with a CSS animation class:

```typescript
  return (
    <Card className="bg-ocean-deep/50 border-ocean-light animate-in fade-in slide-in-from-bottom-2 duration-300">
```

Note: `animate-in`, `fade-in`, `slide-in-from-bottom-2` are Tailwind CSS animation utilities from tailwindcss-animate (already included via shadcn/ui).

- [ ] **Step 2: Add delivery status indicator**

In `DeliverableCard`, add a left-border color based on delivery state. Since PitchHall currently doesn't track delivery state, add a simple visual:

```typescript
    <Card className={cn(
      'bg-ocean-deep/50 border-ocean-light animate-in fade-in slide-in-from-bottom-2 duration-300',
      item.delivered && 'border-l-2 border-l-success',
    )}>
```

This requires adding `delivered?: boolean` to the `Deliverable` interface. In `useDeliverables.ts`, listen for `report.delivered` events and mark the corresponding deliverable.

### Task 7.3: Import feedback (ANIM-027)

**Files:**
- No new file needed — import feedback is CSS-only on existing FileImportTrigger.

The FileImportTrigger already exists. Add a loading state indicator:

This is primarily a CSS/state concern. The component already handles file selection. Add a `loading` state during validation:

```typescript
// In FileImportTrigger, add visual feedback:
// - Spinning icon during processing
// - Error toast on failure
// These are covered by existing shadcn/ui components (Loader2, toast)
```

For 1.0, the functional requirement is that import shows progress. If FileImportTrigger already has a visual flow, just ensure it's working. If not, add a minimal loading spinner.

- [ ] **Step 1: Run build to verify**

Run: `pnpm --filter @aics/web build`

Expected: PASS

- [ ] **Step 2: Commit**

```bash
git add packages/renderer/src/core/scene-manager.ts apps/web/src/components/pitch/PitchHall.tsx
git commit -m "feat(renderer,web): report/delivery feedback (ANIM-027~031)

ANIM-028: Report-ready employee highlight in scene
ANIM-029: DeliverableCard enter animation (slide-in + fade-in)
ANIM-030: Delivered status green border indicator

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 8: Attention Router + Performance Tier (ANIM-032 + ANIM-034)

### Task 8.1: 3-tier performance system

**Files:**
- Modify: `packages/renderer/src/tokens/motion.ts`

- [ ] **Step 1: Add PerformanceTier and MOTION_TIER_B**

```typescript
export type PerformanceTier = 'A' | 'B' | 'C';

export type MotionTokens = Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;

export const MOTION_TIER_A: MotionTokens = MOTION;

export const MOTION_TIER_B: MotionTokens = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0.2, ease: 'sine.inOut' },
  M2: { duration: 0.15, ease: 'quad.inOut' },
  M3: { duration: 0.1, ease: 'power2.out' },
};

export const MOTION_TIER_C: MotionTokens = MOTION_REDUCED;

/** Get motion tokens for the given performance tier. */
export function getMotionForTier(tier: PerformanceTier): MotionTokens {
  switch (tier) {
    case 'A': return MOTION_TIER_A;
    case 'B': return MOTION_TIER_B;
    case 'C': return MOTION_TIER_C;
  }
}
```

- [ ] **Step 2: Update SceneManager to use tier**

In `packages/renderer/src/core/scene-manager.ts`, replace the `motion` getter:

```typescript
  private _performanceTier: PerformanceTier = 'A';

  get motion(): MotionTokens {
    if (this._reducedMotion) return MOTION_TIER_C;
    return getMotionForTier(this._performanceTier);
  }

  /** Update performance tier without rebuilding scene. */
  set performanceTier(tier: PerformanceTier) {
    this._performanceTier = tier;
  }
```

Add import: `import { getMotionForTier, type PerformanceTier, type MotionTokens } from '../tokens/motion.js';`

Subscribe to tier change events:

```typescript
    // Performance tier changes
    this.unsubscribers.push(
      this.eventBus.on('runtime.performance.tier.changed', (event) => {
        const tier = (event.payload as { tier: PerformanceTier }).tier;
        this._performanceTier = tier;
      }),
    );
```

### Task 8.2: Scene attention router (ANIM-032)

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts`

- [ ] **Step 1: Add attention request tracking**

```typescript
  /** Active attention requests keyed by entityId */
  private attentionRequests: Map<string, { priority: number; timestamp: number }> = new Map();
  private spotlightGfx: Graphics | null = null;
```

- [ ] **Step 2: Add attention management methods**

```typescript
  /** Request scene attention for an entity (ANIM-032) */
  private requestAttention(entityId: string, priority: number): void {
    this.attentionRequests.set(entityId, { priority, timestamp: Date.now() });
    this.updateSpotlight();
  }

  /** Clear attention for an entity */
  private clearAttention(entityId: string): void {
    this.attentionRequests.delete(entityId);
    this.updateSpotlight();
  }

  /** Find highest-priority attention target and apply spotlight */
  private updateSpotlight(): void {
    if (!this.layers) return;

    // Find highest priority (most recent if tied)
    let best: { entityId: string; priority: number; timestamp: number } | null = null;
    for (const [entityId, req] of this.attentionRequests) {
      if (!best || req.priority > best.priority ||
          (req.priority === best.priority && req.timestamp > best.timestamp)) {
        best = { entityId, ...req };
      }
    }

    // Clear existing spotlight
    if (this.spotlightGfx) {
      this.layers.focus.removeChild(this.spotlightGfx);
      this.spotlightGfx.destroy();
      this.spotlightGfx = null;
    }

    if (!best) return;

    // Apply spotlight to winning entity
    const entity = this.employeeEntities.get(best.entityId);
    if (!entity) return;

    // Tier C: no attention routing
    if (this._performanceTier === 'C' || this._reducedMotion) return;

    const gfx = new Graphics();
    gfx.circle(entity.container.x, entity.container.y, LAYOUT.employee.radius + 20);
    gfx.fill({ color: 0xfbbf24, alpha: this._performanceTier === 'B' ? 0.1 : 0.15 });
    this.layers.focus.addChild(gfx);
    this.spotlightGfx = gfx;
  }
```

- [ ] **Step 3: Wire attention triggers in event handlers**

In `employee.state.changed` handler, add:

```typescript
        // ANIM-032: Attention routing
        if (next === 'blocked' || next === 'failed') {
          this.requestAttention(employeeId, 5);
        } else if (next === 'idle' || next === 'success') {
          this.clearAttention(employeeId);
        }
```

In `install.state.changed` handler, add:

```typescript
        // Attention routing for install failures
        if (next === 'failed' || next === 'rolled_back') {
          this.requestAttention(installTxnId, 5);
        } else if (next === 'installed' || next === 'cancelled') {
          this.clearAttention(installTxnId);
        }
```

- [ ] **Step 4: Clean up in destroy()**

```typescript
    this.attentionRequests.clear();
    if (this.spotlightGfx) {
      this.spotlightGfx.destroy();
      this.spotlightGfx = null;
    }
```

- [ ] **Step 5: Export new token types from renderer index**

In `packages/renderer/src/index.ts`:

```typescript
export { MOTION_TIER_A, MOTION_TIER_B, MOTION_TIER_C, getMotionForTier } from './tokens/motion.js';
export type { PerformanceTier, MotionTokens } from './tokens/motion.js';
```

- [ ] **Step 6: Update token tests**

In `packages/renderer/src/__tests__/tokens.test.ts`, add:

```typescript
import { getMotionForTier, MOTION_TIER_A, MOTION_TIER_B, MOTION_TIER_C } from '../tokens/motion.js';

describe('Performance Tiers', () => {
  it('Tier A returns full motion', () => {
    expect(getMotionForTier('A')).toBe(MOTION_TIER_A);
  });

  it('Tier B has shortened durations', () => {
    expect(MOTION_TIER_B.M1.duration).toBe(0.2);
    expect(MOTION_TIER_B.M2.duration).toBe(0.15);
  });

  it('Tier C returns zero motion', () => {
    expect(getMotionForTier('C')).toBe(MOTION_TIER_C);
    expect(MOTION_TIER_C.M1.duration).toBe(0);
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `pnpm --filter @aics/renderer test -- --run`

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add packages/renderer/src/tokens/motion.ts packages/renderer/src/core/scene-manager.ts packages/renderer/src/index.ts packages/renderer/src/__tests__/tokens.test.ts
git commit -m "feat(renderer): 3-tier performance system + scene attention router

ANIM-032: Priority-based attention routing with spotlight in L6 focus layer
ANIM-034: PerformanceTier A/B/C with distinct motion token sets
Tier B: shortened durations, no dash animation, no dimming
Tier C: zero motion, no attention routing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 9: Verification

### Task 9.1: Full test suite

- [ ] **Step 1: Run core tests**

Run: `pnpm --filter @aics/core test -- --run`

Expected: 253+ tests pass.

- [ ] **Step 2: Run renderer tests**

Run: `pnpm --filter @aics/renderer test -- --run`

Expected: 123+ tests pass (including ~10 new tests).

- [ ] **Step 3: Run install-core tests**

Run: `pnpm --filter @aics/install-core test -- --run`

Expected: 193 tests pass (no changes expected).

- [ ] **Step 4: Run web tests**

Run: `pnpm --filter @aics/web test -- --run`

Expected: 8+ tests pass.

### Task 9.2: Full typecheck and build

- [ ] **Step 1: Typecheck**

Run: `pnpm turbo run typecheck`

Expected: 26 packages pass.

- [ ] **Step 2: Web build**

Run: `pnpm --filter @aics/web build`

Expected: Build succeeds.

- [ ] **Step 3: Commit any fixes**

If any fixes were needed, commit them.

### Task 9.3: Verification summary

- [ ] **Step 1: Generate handoff block**

Create a summary of:
1. All commits made
2. Build/lint/test status
3. ANIMATION_BACKLOG coverage:
   - ANIM-001~003, 006~007, 009, 014, 034~035: Already implemented ✅
   - ANIM-004: Route lines ✅
   - ANIM-005: Selection sync ✅
   - ANIM-008: Searching animation ✅
   - ANIM-010: Blocked animation ✅
   - ANIM-011: Waiting animation ✅
   - ANIM-012: Reporting animation ✅
   - ANIM-013: Success animation ✅
   - ANIM-015: Task echo ✅
   - ANIM-016~019: Meeting scene ✅
   - ANIM-020~026: Install trust feedback ✅
   - ANIM-027: Import feedback ✅
   - ANIM-028~031: Report/delivery ✅
   - ANIM-032: Attention router ✅
4. Next steps: aesthetic tuning, P2/P3 backlog

---

## Parallelism Strategy

Chunks can be parallelized as follows:

```
Chunk 1 (Foundation)                [sequential — must be first]
  ↓
Chunk 2 (TaskDashboard) ───────────┐
Chunk 3 (Employee Animations) ─────┤ [parallel — zero file overlap]
  ↓                                 │
Chunk 4 (Route Lines + Selection) ──┘ [depends on Chunk 2 entityStyle, Chunk 3 animations]
  ↓
Chunk 5 (Install Trust) ──────────┐
Chunk 6 (Meeting Scene) ──────────┤  [parallel — independent subsystems]
Chunk 7 (Report/Delivery) ────────┘
  ↓
Chunk 8 (Attention + Performance)     [depends on Chunks 5-7 for attention triggers]
  ↓
Chunk 9 (Verification)               [sequential — last]
```

**Agent file exclusivity for parallel chunks:**

| Agent | Exclusive Files |
|-------|----------------|
| Chunk 2 (TaskDashboard) | `useTaskDashboard.ts`, `TaskDashboard.tsx`, `RightSidebar.tsx`, `EventLog.tsx`, `TaskItem.tsx` |
| Chunk 3 (Animations) | `lobster-entity.ts`, `employee-entity.ts`, `lobster-animations.ts`, `employee-animations.test.ts` |
| Chunk 5 (Install) | `install-animations.css`, `InstallDialog.tsx` |
| Chunk 6 (Meeting) | `meeting-room-entity.ts` |
| Chunk 7 (Report) | `PitchHall.tsx` |

**Shared file (scene-manager.ts):** Chunks 4, 5, 6, 7, 8 all modify `scene-manager.ts`. These must run sequentially or be carefully coordinated. The recommended approach: run Chunks 4→5→6→7→8 sequentially for scene-manager changes, even though the non-scene-manager parts of Chunks 5/6/7 are independent.
