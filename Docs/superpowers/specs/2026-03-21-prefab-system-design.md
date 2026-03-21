# Prefab System Design Spec

**Date:** 2026-03-21
**Status:** Reviewed (R1 fixes applied)
**Scope:** packages/shared-types, packages/renderer, packages/core, packages/db-local, packages/asset-schema

---

## 1. Problem Statement

Offisim's core value proposition is making AI concepts intuitive through office metaphor. Currently:

- Furniture drawing is hardcoded in `packages/renderer/src/shapes/furniture.ts` (10 stateless `draw*()` functions)
- `FloorLayer` decides which furniture goes where based on zone type — no user customization
- Furniture has zero runtime state — a server rack cannot show "processing"
- Zone furniture composition is fixed — library always gets bookshelf + reading table + plant
- No SDK interface for marketplace creators to contribute new office elements
- The Rack/Slot system (MCP bindings) exists separately from furniture — a server rack in the scene has no connection to a `racks` DB row

The Prefab system makes every office element a **first-class, stateful, bindable entity** that maps to a real AI concept.

---

## 2. Core Abstraction: Three Layers

```
PrefabDefinition  (static, in registry)
  "What am I?" — type, size, render template, binding interface, state machine

PrefabInstance  (persisted, in DB)
  "Where am I?" — position, rotation, zone, bindings, user overrides

PrefabRuntime  (transient, in memory)
  "What am I doing right now?" — current state, event subscriptions, visual feedback
```

---

## 3. Semantic Categories

Every prefab belongs to exactly one semantic category. The category:
1. Constrains which AI resources can be bound to it
2. Determines the state machine that drives visual feedback
3. Preserves the office-as-AI-metaphor (a bookshelf always means "knowledge")

| Category | Office Metaphor | AI Concept | Bindable Resources |
|----------|----------------|------------|-------------------|
| `workspace` | Desk + monitor + chair | Agent execution context | Employee (agent), model profile |
| `compute` | Server rack, GPU tower | LLM endpoint, MCP server | Rack (provider), model endpoint |
| `knowledge` | Bookshelf, filing cabinet, whiteboard | RAG source, doc store, prompt library | Knowledge base ref, vector store |
| `collaboration` | Meeting table, sofa area | Multi-agent protocol, handoff | Meeting session, handoff route |
| `infrastructure` | Network switch, cable tray, patch panel | Event routing, task queue, data pipeline | EventBus routes, handoff chains |
| `decorative` | Plant, coffee table, water cooler | None — pure cosmetic | None (no binding slots) |

**`decorative` has no state machine and no binding slots.** It exists to allow non-functional furniture that makes the office feel lived-in. Decorative prefabs are always in a static visual state.

---

## 4. State Machines Per Category

Each category defines a state enum and valid transitions. The state machine is category-level, not prefab-level — all `knowledge` prefabs share the same state machine regardless of whether they're a bookshelf or filing cabinet.

### 4.1 workspace

```
States: empty | occupied | working | thinking | searching | blocked | idle

 empty ──→ occupied ──→ working ──→ thinking
                │          │            │
                │          ↓            ↓
                │       searching    blocked
                │          │            │
                ↓          ↓            ↓
              idle ←───────┴────────────┘
```

| State | Visual | Trigger Event |
|-------|--------|---------------|
| `empty` | Gray tint, monitor off, chair pushed in | No agent bound |
| `occupied` | Normal colors, monitor standby blue | Agent bound, idle |
| `working` | Monitor green, keyboard flicker | `employee.state.changed → executing` |
| `thinking` | Monitor pulse, thought bubble | `employee.state.changed → thinking` |
| `searching` | Monitor scan-line animation | `employee.state.changed → searching` |
| `blocked` | Monitor red border, warning light | `employee.state.changed → blocked / failed` |
| `idle` | Normal colors, monitor standby | `employee.state.changed → idle / success / paused` |

**Full EmployeeState → workspace state mapping:**

| EmployeeState | Workspace State | Rationale |
|---|---|---|
| `idle` | `idle` | Agent waiting |
| `assigned` | `occupied` | Task queued, not yet executing |
| `thinking` | `thinking` | LLM call in progress |
| `searching` | `searching` | RAG/tool search |
| `executing` | `working` | Active tool/action execution |
| `meeting` | `idle` | Agent is at meeting table, workspace vacant |
| `blocked` | `blocked` | Awaiting dependency |
| `waiting` | `occupied` | Polling, low activity |
| `reporting` | `working` | Summarizing (still active work) |
| `success` | `idle` | Task done, return to standby |
| `failed` | `blocked` | Error state, needs attention |
| `paused` | `idle` | Manually paused |

**Event binding:** Listens to `employee.state.changed` for the bound agent's `employeeId`.

### 4.2 compute

```
States: offline | idle | processing | overloaded | error

 offline ──→ idle ──→ processing ──→ overloaded
                         │                │
                         ↓                ↓
                       error ←────────────┘
```

| State | Visual | Trigger Event |
|-------|--------|---------------|
| `offline` | All dark, no indicators | Rack status = 'unbound' |
| `idle` | Green breathing LED, slow fan rotation | Rack bound, no active calls |
| `processing` | Blue rapid blink, fast fan, heat shimmer | `llm.call.started` on bound rack |
| `overloaded` | Red rapid blink, steam particles | Concurrent calls > threshold |
| `error` | Red steady, X icon | `error.occurred` with bound rack |

**Event binding:** Listens to `llm.call.started`, `llm.call.completed`, `rack.bound`, `rack.unbound` for the bound `rackId`.

### 4.3 knowledge

```
States: empty | stocked | indexing | ready | searching | error

 empty ──→ stocked ──→ indexing ──→ ready ──→ searching ──→ ready
                          │
                          ↓
                        error
```

| State | Visual | Trigger Event |
|-------|--------|---------------|
| `empty` | Empty shelves, gray | No knowledge source bound |
| `stocked` | Books present but dim (unindexed) | Source bound, not yet indexed |
| `indexing` | Books light up one by one (scan animation) | `knowledge.index.started` |
| `ready` | All books lit, soft green glow | `knowledge.index.completed` |
| `searching` | Book pulled out + light beam scan | `knowledge.search.started` |
| `error` | Red warning, books scattered | `knowledge.index.failed` |

**Event binding:** Listens to `knowledge.*` events for the bound knowledge base ref. (New event family — see §8.)

### 4.4 collaboration

```
States: empty | scheduled | gathering | active | paused | ended

 empty ──→ scheduled ──→ gathering ──→ active ──→ ended
                                        │
                                        ↓
                                      paused ──→ active
```

| State | Visual | Trigger Event |
|-------|--------|---------------|
| `empty` | Clean table, chairs pushed in | No meeting bound |
| `scheduled` | Agenda cards appear on table | `meeting.state.changed → scheduled` |
| `gathering` | Chairs pull out one by one | `meeting.state.changed → gathering` |
| `active` | Table glow ring, center holographic projection | `meeting.state.changed → running` |
| `paused` | Glow dims | `meeting.state.changed → paused` |
| `ended` | Chairs push back, summary document floats up | `meeting.state.changed → completed` |

**Event binding:** Listens to `meeting.state.changed` for the bound `meetingId` or zone's meeting sessions.

### 4.5 infrastructure

```
States: disconnected | idle | transmitting | congested | error

 disconnected ──→ idle ──→ transmitting ──→ congested
                              │                 │
                              ↓                 ↓
                            error ←─────────────┘
```

| State | Visual | Trigger Event |
|-------|--------|---------------|
| `disconnected` | Dashed line, gray | No route bound |
| `idle` | Solid line, dim | Route exists, no traffic |
| `transmitting` | Flowing particles (data packet animation) | `handoff.initiated` on bound route |
| `congested` | Particles pile up, red | Multiple concurrent handoffs |
| `error` | Line fracture animation | `error.occurred` on bound route |

**Event binding:** Listens to `handoff.initiated`, `handoff.completed` for bound routing paths.

---

## 5. PrefabDefinition Schema

```typescript
// packages/shared-types/src/prefab.ts

type SemanticCategory =
  | 'workspace'
  | 'compute'
  | 'knowledge'
  | 'collaboration'
  | 'infrastructure'
  | 'decorative';

/** Binding slot declaration — what AI resources this prefab can connect to */
interface PrefabBindingSlotDef {
  /** Slot name, unique within the prefab (e.g. "agent", "model", "source") */
  readonly name: string;
  /** What kind of resource fills this slot */
  readonly type:
    | 'agent-context'     // workspace: binds to an employee
    | 'model-endpoint'    // workspace/compute: binds to a model profile
    | 'rack-provider'     // compute: binds to a rack
    | 'knowledge-source'  // knowledge: binds to a knowledge base reference
    | 'meeting-session'   // collaboration: binds to meeting sessions in this zone
    | 'handoff-route';    // infrastructure: binds to an agent-to-agent route
  /** Whether binding is required for the prefab to function */
  readonly required: boolean;
}

/** Render template reference + parameters */
interface RenderTemplate2D {
  /** Template name — must match a registered template in the renderer */
  readonly template: string;
  /** Template-specific parameters (colors, styles, sizes, etc.) */
  readonly params: Readonly<Record<string, unknown>>;
}

/** Child definition for composite prefabs */
interface PrefabChildDef {
  /** Render template for this child piece */
  readonly render2D: RenderTemplate2D;
  /** Offset from parent origin [dx, dy] in pixels */
  readonly offset: readonly [number, number];
}

/** Complete prefab definition */
interface PrefabDefinition {
  /** Unique identifier (e.g. "workstation-standard", "server-rack-2u") */
  readonly prefabId: string;
  /** Display name */
  readonly name: string;
  /** Human-readable description of the AI concept this represents */
  readonly description: string;
  /** Semantic category — determines state machine and binding constraints */
  readonly category: SemanticCategory;

  // ── Sizing ──
  /** Grid size [width, height] in grid units (1 unit ≈ 80px) */
  readonly gridSize: readonly [number, number];

  // ── Composition ──
  /** Whether this is a composite (multi-part) prefab */
  readonly composite: boolean;
  /** Child pieces and their relative positions (composite only) */
  readonly children?: readonly PrefabChildDef[];
  /** Render template for atomic (non-composite) prefabs */
  readonly render2D?: RenderTemplate2D;

  // ── AI Binding ──
  /** Declarative binding slots */
  readonly bindingSlots: readonly PrefabBindingSlotDef[];

  // ── Marketplace ──
  /** Package ID if this prefab came from marketplace (null = built-in) */
  readonly sourcePackageId?: string | null;
}
```

---

## 6. PrefabInstance (Persistence)

### 6.1 New DB Table

```sql
-- Migration: add_prefab_instances

CREATE TABLE IF NOT EXISTS prefab_instances (
  instance_id   TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  prefab_id     TEXT NOT NULL,           -- FK conceptual → PrefabDefinition.prefabId
  zone_id       TEXT NOT NULL,           -- Stable zone key (convention: "zone-dev", "zone-product", "zone-art", "zone-library", "zone-rest", "zone-meeting", "zone-server")
  position_x    REAL NOT NULL DEFAULT 0, -- X position within zone (pixels)
  position_y    REAL NOT NULL DEFAULT 0, -- Y position within zone (pixels)
  rotation      INTEGER NOT NULL DEFAULT 0, -- 0, 90, 180, 270
  bindings_json TEXT,                    -- Serialized binding values
  config_json   TEXT,                    -- User override params (colors, label, etc.)
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prefab_instances_company
  ON prefab_instances(company_id);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_zone
  ON prefab_instances(company_id, zone_id);
```

**Zone ID Convention:** Zones are NOT a DB table — they are a runtime concept computed by `zone-layout-engine.ts`. The `zone_id` column uses stable convention keys that match `ZoneConfig.zoneId` from `departments.ts`:

| zone_id | Zone Type | Source |
|---------|-----------|--------|
| `zone-dev` | department (dev) | `RD_COMPANY_ZONES[0].zoneId` |
| `zone-product` | department (product) | `RD_COMPANY_ZONES[1].zoneId` |
| `zone-art` | department (art) | `RD_COMPANY_ZONES[2].zoneId` |
| `zone-library` | library | `RD_COMPANY_ZONES[3].zoneId` |
| `zone-rest` | rest_area | `RD_COMPANY_ZONES[4].zoneId` |
| `zone-meeting` | meeting_room | `RD_COMPANY_ZONES[5].zoneId` |
| `zone-server` | server_room | `RD_COMPANY_ZONES[6].zoneId` |

These keys are stable because they are derived from department IDs (which are config, not computed). If a company adds custom departments, the convention extends: `zone-{departmentId}`. No FK constraint needed — validation is application-level.

### 6.2 TypeScript Type

```typescript
// packages/shared-types/src/prefab.ts

interface PrefabInstanceRow {
  readonly instance_id: string;
  readonly company_id: string;
  readonly prefab_id: string;
  readonly zone_id: string;
  readonly position_x: number;
  readonly position_y: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly bindings_json: string | null;
  readonly config_json: string | null;
  readonly enabled: number; // 0 | 1
  readonly created_at: string;
  readonly updated_at: string;
}

/** Deserialized binding value */
interface PrefabBinding {
  /** Matches PrefabBindingSlotDef.name */
  readonly slotName: string;
  /** Reference to the bound resource (employeeId, rackId, knowledgeBaseRef, etc.) */
  readonly resourceRef: string;
  /** Human-readable label for display */
  readonly label?: string;
}
```

### 6.3 Relationship to Existing `workstations` Table

**workstations becomes a derived concept**, not a separate entity:

- A workspace-category PrefabInstance with an `agent-context` binding **is** a workstation
- The `workstation_id` field on `employees` will reference `prefab_instances.instance_id` for workspace prefabs
- Existing `workstations` table remains for backward compatibility during migration, but new code reads from `prefab_instances`
- `workstation_racks` M:N table maps to compute-category prefabs' `rack-provider` bindings

Migration strategy: write a migration that creates `prefab_instances` rows from existing `workstations` rows, then update FK references.

---

## 7. PrefabRuntime (In-Memory)

```typescript
// packages/renderer/src/prefab/prefab-runtime.ts
// NOTE: This is a CLASS (not a shared-types interface) — it lives in renderer
// because it depends on PixiJS Container and GSAP.

class PrefabRuntime {
  readonly instanceId: string;
  readonly definition: PrefabDefinition;
  readonly container: Container;          // PixiJS container (placed in L1 furniture layer)

  /** Current state from the category's state machine */
  currentState: string;

  /** Active event subscriptions (unsubscribe functions) */
  eventUnsubscribers: Array<() => void>;

  /** Transition to a new state — triggers re-render with state-aware template */
  setState(next: string): void;

  /** Update or clear a binding at runtime */
  bindToResource(slotName: string, resourceRef: string): void;
  unbindResource(slotName: string): void;

  /** Clean up: kill tweens, unsubscribe events, remove container */
  destroy(): void;
}
```

### 7.1 State-Aware Rendering

The render template receives the current state as a parameter. Each template function has the signature:

```typescript
/**
 * A render template function builds a GraphicsContext (NOT a Graphics object).
 * Called ONCE per state at creation time, not on every state change.
 */
type RenderTemplateFn = (
  params: Record<string, unknown>,
  state: string,
) => GraphicsContext;
```

### 7.1.1 GraphicsContext Swapping (Critical Performance Pattern)

**PixiJS 8 official guidance: "Do not clear and rebuild graphics every frame."**
The correct pattern is **GraphicsContext swapping** — pre-build contexts, swap on state change.

**At creation time:**
```typescript
// PrefabRuntime constructor pre-renders all states
const stateContexts = new Map<string, GraphicsContext>();
for (const state of stateMachine.allStates) {
  stateContexts.set(state, templateFn(params, state));
}
graphics.context = stateContexts.get(initialState)!;
```

**On `setState()` call:**
```typescript
setState(next: string): void {
  if (!stateMachine.canTransition(this.currentState, next)) return;
  this.currentState = next;
  // Context swap — "a very cheap operation" (PixiJS docs)
  this.graphics.context = this.stateContexts.get(next)!;
  // GSAP handles animated overlays (tint, alpha, transform)
  // Use overwrite: "auto" to kill only conflicting property tweens
  gsap.to(this.container, { alpha: 1, overwrite: 'auto' });
}
```

**GSAP animations** (breathing LEDs, fan spin, heat shimmer) are applied to the Container's `alpha`, `tint`, `scale`, `rotation` — properties PixiJS explicitly says are cheap to update. They never touch Graphics content.

### 7.1.2 Composite Rendering

For composite prefabs, `PrefabRuntime` creates a parent `Container`. Each child gets its own `Graphics` object, each with its own set of pre-built `GraphicsContext` per state. The parent container is placed in L1 (furniture layer).

```
PrefabRuntime.container (Container, placed in L1)
  ├── child[0].graphics (Graphics at offset [0, 0])
  │     └── stateContexts: { idle: ctx, working: ctx, ... }  → desk
  ├── child[1].graphics (Graphics at offset [0, -12])
  │     └── stateContexts: { idle: ctx, working: ctx, ... }  → monitor
  └── child[2].graphics (Graphics at offset [0, 14])
        └── stateContexts: { idle: ctx, working: ctx, ... }  → chair
```

State drives all children as a unit — `setState('working')` swaps context on every child.

### 7.1.3 Large Office Performance Fallback

PixiJS docs: "Using 100s of complex graphics objects can be slow — use sprites instead."

When prefab count exceeds a threshold (default: 40), apply automatic texture caching:
- **Decorative prefabs** (no state changes): convert to Sprite via `renderer.generateTexture(graphics)` after initial render. Destroy the Graphics to free GPU memory.
- **Stateful prefabs**: keep as Graphics (they need context swapping).
- This is transparent to the rest of the system — PrefabRuntime.container still works the same way.

### 7.1.4 Instance Override Merge Semantics

`PrefabInstance.config_json` stores user overrides for the definition's template params. Merge strategy:

- **Shallow merge**: `{ ...definition.render2D.params, ...instance.configOverrides }`
- Arrays are replaced, not concatenated
- `null` value in override explicitly removes a param (falls back to template default)
- Applied at PrefabRuntime creation time, before GraphicsContext pre-building

**Validation rules:**
- If `composite === true`: `children` must be non-empty array, `render2D` must be undefined
- If `composite === false`: `render2D` must be present, `children` must be undefined
- Validated at registration time by `PrefabRegistry` and at install time by `asset-schema`

### 7.2 PrefabEventRouter

Routes RuntimeEvent instances to PrefabRuntime instances based on their bindings.

```typescript
// packages/renderer/src/prefab/prefab-event-router.ts

class PrefabEventRouter {
  /** Map: resourceRef → Set<instanceId> */
  private bindingIndex: Map<string, Set<string>>;

  /** Map: instanceId → PrefabRuntime */
  private runtimes: Map<string, PrefabRuntime>;

  /** Category → event prefix mapping (which events each category listens to) */
  private static CATEGORY_EVENT_PREFIXES: Record<SemanticCategory, string[]> = {
    workspace:      ['employee.state.changed'],
    compute:        ['llm.call.started', 'llm.call.completed', 'rack.bound', 'rack.unbound', 'error.occurred'],
    knowledge:      ['knowledge.index.started', 'knowledge.index.completed', 'knowledge.index.failed',
                     'knowledge.search.started', 'knowledge.search.completed'],
    collaboration:  ['meeting.state.changed'],
    infrastructure: ['handoff.initiated', 'handoff.completed', 'error.occurred'],
  };

  /** Register a binding: when events mention resourceRef, route to instanceId */
  registerBinding(instanceId: string, resourceRef: string): void;

  /** Unregister a binding */
  unregisterBinding(instanceId: string, resourceRef: string): void;

  /** Called by SceneEventHandler for every RuntimeEvent.
   *  Matches event entityId/payload fields against the binding index,
   *  then calls setState() on matched PrefabRuntime instances. */
  routeEvent(event: RuntimeEvent): void;

  /** State inference logic per category — translates events to prefab states */
  private inferState(category: SemanticCategory, event: RuntimeEvent): string | null;
}
```

**Event-to-resourceRef extraction rules** (how `routeEvent()` finds the bound resource from each event):

| Event Type | Extract resourceRef From | Matches Binding Type |
|---|---|---|
| `employee.state.changed` | `(payload as EmployeeStatePayload).employeeId` | `agent-context` |
| `llm.call.started` | `event.entityId` (= llmCallId) — **requires lookup**: `llmCallId → rackId` via in-memory call tracking | `rack-provider` |
| `llm.call.completed` | Same lookup as above | `rack-provider` |
| `rack.bound` | `(payload as RackBoundPayload).rackId` | `rack-provider` |
| `rack.unbound` | `(payload as RackUnboundPayload).rackId` | `rack-provider` |
| `knowledge.index.*` | `(payload as KnowledgeIndex*Payload).knowledgeBaseRef` | `knowledge-source` |
| `knowledge.search.*` | `(payload as KnowledgeSearch*Payload).knowledgeBaseRef` | `knowledge-source` |
| `meeting.state.changed` | `(payload as MeetingStatePayload).meetingId` | `meeting-session` |
| `handoff.initiated` | `(payload as HandoffInitiatedPayload).fromEmployeeId + toEmployeeId` | `handoff-route` |
| `handoff.completed` | `(payload as HandoffCompletedPayload).toEmployeeId` | `handoff-route` |
| `error.occurred` | `event.entityId` — context-dependent | varies |

**Note:** `LlmCallStartedPayload` currently lacks `rackId`. The router must maintain an in-memory `Map<provider+model, rackId>` built from `rack.bound` events, and use `LlmCallStartedPayload.provider + .model` to look up the rack. This is imperfect but avoids requiring a schema change to `LlmCallStartedPayload`. If the provider+model lookup causes false matches, we can add `rackId` to the payload in a future event schema update.

**Integration point:** `SceneEventHandler` already subscribes to all runtime events. Add one call to `prefabEventRouter.routeEvent(event)` in the main handler.

---

## 8. New Event Families

The knowledge category requires events that don't exist yet. Add to `shared-types/events.ts`:

```typescript
// New event families
| 'knowledge.index.started'
| 'knowledge.index.completed'
| 'knowledge.index.failed'
| 'knowledge.search.started'
| 'knowledge.search.completed'

// New payloads
interface KnowledgeIndexStartedPayload {
  readonly knowledgeBaseRef: string;
  readonly documentCount: number;
}

interface KnowledgeIndexCompletedPayload {
  readonly knowledgeBaseRef: string;
  readonly indexedCount: number;
  readonly durationMs: number;
}

interface KnowledgeIndexFailedPayload {
  readonly knowledgeBaseRef: string;
  readonly error: string;
}

interface KnowledgeSearchStartedPayload {
  readonly knowledgeBaseRef: string;
  readonly query: string;
  readonly employeeId: string;
}

interface KnowledgeSearchCompletedPayload {
  readonly knowledgeBaseRef: string;
  readonly resultCount: number;
  readonly employeeId: string;
  readonly durationMs: number;
}
```

---

## 9. Render Template Registry

### 9.1 Architecture

Templates are TypeScript functions registered in core. Prefab definitions reference templates by name.

```typescript
// packages/renderer/src/prefab/render-templates.ts

/** Template registry — keyed by template name */
const RENDER_TEMPLATES = new Map<string, RenderTemplateFn>();

function registerTemplate(name: string, fn: RenderTemplateFn): void {
  RENDER_TEMPLATES.set(name, fn);
}

function getTemplate(name: string): RenderTemplateFn | undefined {
  return RENDER_TEMPLATES.get(name);
}
```

### 9.2 Built-in Templates

Refactored from existing `furniture.ts` draw functions, now with **state awareness**:

```typescript
// All existing draw functions become templates with state param:

// workspace
registerTemplate('desk',       renderDesk);       // from drawDesk
registerTemplate('monitor',    renderMonitor);     // from drawMonitor — state: off/standby/active/error
registerTemplate('chair',      renderChair);       // from drawChair — state: pushed-in/pulled-out

// compute
registerTemplate('server-rack', renderServerRack); // from drawServerRack — state drives LED colors + fan speed
registerTemplate('gpu-tower',   renderGpuTower);   // new: wider server with GPU indicator

// knowledge
registerTemplate('bookshelf',   renderBookshelf);  // from drawBookshelf — state drives book glow + scan animation
registerTemplate('filing-cabinet', renderFilingCabinet); // new: shorter, wider, drawer animation
registerTemplate('whiteboard',  renderWhiteboard);  // new: flat panel with content indicator

// collaboration
registerTemplate('meeting-table', renderMeetingTable); // derived from MeetingRoomEntity
registerTemplate('sofa',        renderSofa);         // from drawSofa
registerTemplate('standing-table', renderStandingTable); // new: tall narrow table

// infrastructure
registerTemplate('network-switch', renderNetworkSwitch); // new: small flat box with port LEDs
registerTemplate('cable-tray',    renderCableTray);     // new: horizontal run with data flow particles
registerTemplate('patch-panel',   renderPatchPanel);    // new: wall-mount panel with connection indicators

// decorative (category: 'decorative' — no state machine, no bindings)
registerTemplate('plant',         renderPlant);         // from drawPlant
registerTemplate('coffee-table',  renderCoffeeTable);   // from drawCoffeeTable
registerTemplate('vending-machine', renderVendingMachine); // from drawVendingMachine
registerTemplate('reading-table', renderReadingTable);   // from drawReadingTable
```

### 9.3 State-Aware Rendering Example (GraphicsContext Pattern)

```typescript
import { GraphicsContext } from 'pixi.js';

/**
 * Template function: returns a GraphicsContext for a given state.
 * Called once per state at PrefabRuntime creation time.
 * NOT called on every state change — context swapping handles that.
 */
function renderServerRack(
  params: Record<string, unknown>,
  state: string,
): GraphicsContext {
  const w = (params.width as number) ?? 20;
  const h = (params.height as number) ?? 36;
  const color = (params.color as number) ?? 0x2a2a3a;

  const ctx = new GraphicsContext();

  // Cabinet body
  ctx.roundRect(-w / 2, -h / 2, w, h, 2);
  ctx.fill(color);

  // Front panel
  ctx.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 1);
  ctx.fill(0x1a1a2e);

  // Status LEDs — color depends on state (baked into the context)
  const ledColor = {
    offline:    0x333333,
    idle:       0x22c55e,  // green
    processing: 0x3b82f6,  // blue
    overloaded: 0xef4444,  // red
    error:      0xef4444,
  }[state] ?? 0x333333;

  const unitCount = 5;
  const unitGap = (h - 8) / (unitCount + 1);
  for (let i = 1; i <= unitCount; i++) {
    const uy = -h / 2 + 4 + unitGap * i;
    ctx.rect(-w / 2 + 3, uy, w - 6, 1);
    ctx.fill(0x333355);
    ctx.circle(w / 2 - 5, uy - unitGap / 2, 1.5);
    ctx.fill(ledColor);
  }

  // Ventilation — color baked into context per state
  for (let i = 0; i < 3; i++) {
    ctx.rect(-w / 2 + 4 + i * 5, h / 2 - 6, 3, 3);
    ctx.fill(state === 'overloaded' ? 0xef4444 : 0x333355);
  }

  return ctx;
}
```

**Key performance properties:**
- Each `GraphicsContext` is created once and reused on every state swap
- A server rack with 5 states = 5 pre-built contexts (~negligible memory for simple geometry)
- `graphics.context = stateContexts.get(next)!` is O(1) and GPU-friendly
- GSAP animations (breathing, spin, shimmer) operate on Container transform/alpha/tint — never on Graphics content
- Use `overwrite: "auto"` on all GSAP state-transition tweens to kill only conflicting properties

---

## 10. Built-in Prefab Catalog

Core ships with these standard prefab definitions:

### workspace

| prefabId | Name | Grid | Composite | Children |
|----------|------|------|-----------|----------|
| `workstation-standard` | Standard Workstation | 2x2 | yes | desk + monitor + chair |
| `workstation-compact` | Compact Workstation | 1x2 | yes | small-desk + laptop |
| `workstation-dual` | Dual Monitor Workstation | 2x2 | yes | desk + 2x monitor + chair |

### compute

| prefabId | Name | Grid | Composite | Binding Slots |
|----------|------|------|-----------|---------------|
| `server-rack-2u` | 2U Server Rack | 1x2 | no | rack-provider (required) |
| `server-rack-4u` | 4U Server Rack | 1x3 | no | rack-provider (required) |
| `gpu-cluster` | GPU Cluster | 3x2 | yes | rack-provider (required), model-endpoint |

### knowledge

| prefabId | Name | Grid | Composite | Binding Slots |
|----------|------|------|-----------|---------------|
| `bookshelf-single` | Single Bookshelf | 1x2 | no | knowledge-source (required) |
| `bookshelf-double` | Double Bookshelf | 2x2 | no | knowledge-source (required) |
| `filing-cabinet` | Filing Cabinet | 1x1 | no | knowledge-source (required) |
| `whiteboard` | Whiteboard | 2x1 | no | knowledge-source |

### collaboration

| prefabId | Name | Grid | Composite | Binding Slots |
|----------|------|------|-----------|---------------|
| `meeting-table-4` | Small Meeting Table | 3x3 | yes | meeting-session |
| `meeting-table-8` | Large Meeting Table | 4x4 | yes | meeting-session |
| `sofa-set` | Lounge Area | 3x2 | yes | meeting-session |
| `standing-table` | Standing Table | 1x1 | no | meeting-session |

### infrastructure

| prefabId | Name | Grid | Composite | Binding Slots |
|----------|------|------|-----------|---------------|
| `network-switch` | Network Switch | 1x1 | no | handoff-route (required) |
| `cable-tray` | Cable Tray | 4x1 | no | handoff-route |
| `patch-panel` | Patch Panel | 2x1 | no | handoff-route (required) |

### decorative (category: 'decorative')

| prefabId | Name | Grid | Notes |
|----------|------|------|-------|
| `plant-small` | Small Plant | 1x1 | Pure cosmetic |
| `plant-large` | Large Plant | 1x2 | Pure cosmetic |
| `coffee-table` | Coffee Table | 1x1 | Pure cosmetic |
| `vending-machine` | Vending Machine | 1x2 | Pure cosmetic |
| `water-cooler` | Water Cooler | 1x1 | Pure cosmetic |
| `reading-table` | Reading Table | 2x1 | Library decoration, no AI binding |
| `chair-standalone` | Standalone Chair | 1x1 | For library/rest reading areas |

---

## 11. Integration with Existing Systems

### 11.1 FloorLayer Refactoring

Current: `FloorLayer` hardcodes furniture per zone type:
```
department → desk + monitor + chair per workstation
library → bookshelves + reading table + plant
rest_area → sofa + coffee table + vending machine + plant
meeting → meeting table + chairs
server → server racks + cable tray + status panel
```

New: `FloorLayer` reads `PrefabInstance[]` for each zone and renders them via templates:
```
for each PrefabInstance in zone:
  template = getTemplate(instance.prefab.render2D.template)
  template(graphics, params, runtime.currentState)
```

Zone-type-specific hardcoded furniture is replaced by **default prefab layouts** — each zone type has a default set of PrefabInstances auto-created when the zone is first set up.

### 11.2 SceneEntityManager Extension

Add alongside existing `employeeEntities` map:

```typescript
class SceneEntityManager {
  // existing
  employeeEntities: Map<string, SceneEntity>;
  occupancy: Map<string, string>;

  // new
  prefabRuntimes: Map<string, PrefabRuntime>;
  prefabEventRouter: PrefabEventRouter;

  addPrefabInstance(instance: PrefabInstanceRow, definition: PrefabDefinition): PrefabRuntime;
  removePrefabInstance(instanceId: string): void;
  getPrefabRuntime(instanceId: string): PrefabRuntime | undefined;
}
```

### 11.3 Zone Layout Engine Update

`computeFloorPlan()` currently generates desk grid positions. With prefabs:

1. Department zones still compute desk grids — but each desk position maps to a workspace PrefabInstance
2. Utility zones (library, rest, meeting, server) use their default prefab layouts
3. Custom prefab placements are stored as explicit positions in `prefab_instances`
4. `rebuildLayout()` re-positions prefabs that are set to "auto-layout" (no explicit position)

### 11.4 Rack/Slot Unification

Current `racks` and `slots` tables become the backing data for compute-category prefabs:

- A `server-rack-2u` PrefabInstance with `rack-provider` binding references a `racks.rack_id`
- The visual server rack and the logical rack are now the same entity
- `workstation_racks` M:N table is replaced by: workspace prefab's zone → compute prefabs in same zone → their rack bindings

### 11.5 Workspace ↔ Employee Binding

Current: `employees.workstation_id` → `workstations.workstation_id`
New: `employees.workstation_id` → `prefab_instances.instance_id` (for workspace-category prefabs)

The workspace PrefabInstance's `agent-context` binding slot holds the `employeeId`. This creates a bidirectional link:
- Employee knows their workspace: `employees.workstation_id`
- Workspace knows its agent: `prefab_instances.bindings_json[agent-context]`

---

## 12. SDK Interface for Marketplace

### 12.1 Prefab Package Kind

Add `'prefab'` to `AssetKind` (defined in `packages/asset-schema/src/manifest.types.ts`):

```typescript
// Current:
type AssetKind = 'employee' | 'skill' | 'sop' | 'company_template' | 'office_layout' | 'bundle';
// New:
type AssetKind = 'employee' | 'skill' | 'sop' | 'company_template' | 'office_layout' | 'bundle' | 'prefab';
```

**Files that need the new `'prefab'` value:**
1. `packages/asset-schema/src/manifest.types.ts` — `AssetKind` union
2. `packages/db-local/src/migrations/` — new migration to ALTER CHECK constraint on `installed_packages.package_kind`
3. `packages/db-platform/src/migrations/` — new migration for platform registry schema
4. `Docs/02_contracts_and_schemas/aics_manifest.schema.json` — JSON Schema `enum`
5. `packages/install-core/` — materializer must handle `'prefab'` kind

### 12.2 Prefab Manifest

A marketplace prefab package contains:

```jsonc
{
  "$schema": "https://offisim.dev/schemas/aics-manifest.json",
  "id": "fancy-ergonomic-desk",
  "version": "1.0.0",
  "kind": "prefab",
  "name": "Ergonomic Standing Desk",
  "description": "Height-adjustable workspace with integrated cable management",
  "prefab": {
    "category": "workspace",
    "gridSize": [2, 2],
    "composite": true,
    "children": [
      { "template": "desk", "offset": [0, 0], "params": { "width": 60, "height": 32, "color": "0x8b6914" } },
      { "template": "monitor", "offset": [0, -14], "params": {} },
      { "template": "chair", "offset": [0, 16], "params": { "style": "ergonomic" } }
    ],
    "bindingSlots": [
      { "name": "agent", "type": "agent-context", "required": true }
    ]
  }
}
```

### 12.3 Constraints

- Marketplace prefabs can only reference **existing registered templates**
- No arbitrary code execution — pure JSON manifest
- New visual styles (new templates) require a PR to core
- Template params are validated against template schema
- Category determines which binding types are valid — cross-category bindings are rejected

---

## 13. Company Template Integration

Current `CompanyTemplate` defines employees and SOPs. Extend with prefab layout:

```typescript
interface CompanyTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  employees: CompanyTemplateEmployee[];
  sops: SopDefinition[];
  layoutPreset: string;

  // NEW: default prefab instances for each zone
  prefabLayout?: CompanyTemplatePrefabLayout;
}

interface CompanyTemplatePrefabLayout {
  /** Zone ID → list of prefab placements */
  zones: Record<string, CompanyTemplatePrefabPlacement[]>;
}

interface CompanyTemplatePrefabPlacement {
  prefabId: string;
  position?: [number, number]; // explicit position, or null for auto-layout
  rotation?: 0 | 90 | 180 | 270;
  configOverrides?: Record<string, unknown>;
}
```

When `materializeTemplate()` runs, it:
1. Creates employees (existing)
2. Creates SOPs (existing)
3. **Creates PrefabInstances** from the template's prefabLayout
4. Auto-binds workspace prefabs to created employees (by role_slug zone matching)

---

## 14. Default Zone Prefab Layouts

When a zone is created without a template layout, apply sensible defaults:

### Department zones (per workstation count N)
- N × `workstation-standard` (auto-laid-out in grid)
- 1 × `plant-small` (corner decoration)

### Library
- 2 × `bookshelf-double` (top row, knowledge category)
- 1 × `reading-table` + `chair-standalone` (center, decorative)
- 1 × `plant-large` (corner, decorative)

### Rest Area
- 1 × `sofa-set`
- 1 × `coffee-table`
- 1 × `vending-machine`
- 1 × `plant-small`

### Meeting Room
- 1 × `meeting-table-4` or `meeting-table-8` (based on company size)
- 1 × `whiteboard`

### Server Room
- N × `server-rack-2u` (based on configured racks)
- 1 × `cable-tray`
- 1 × `network-switch`

---

## 15. File Structure

```
packages/shared-types/src/
  prefab.ts                    — PrefabDefinition, PrefabInstanceRow, SemanticCategory, etc.
  states.ts                    — Add PrefabState type aliases per category
  events.ts                    — Add knowledge.* event families

packages/renderer/src/
  prefab/
    prefab-runtime.ts          — PrefabRuntime class
    prefab-event-router.ts     — PrefabEventRouter
    prefab-renderer.ts         — Creates/manages PrefabRuntime from PrefabInstance data
    render-templates.ts        — Template registry + all built-in templates
    state-machines.ts          — Category state machine definitions + transition validation
    builtin-catalog.ts         — All built-in PrefabDefinition objects
    default-zone-layouts.ts    — Default prefab placements per zone type
  shapes/
    furniture.ts               — KEPT as low-level draw primitives, called by templates
  core/
    scene-entity-manager.ts    — Add prefabRuntimes map + router integration
    scene-event-handler.ts     — Add routeEvent() call

packages/core/src/
  runtime/repositories.ts      — Add PrefabInstanceRepository
  services/
    prefab-service.ts          — CRUD for PrefabInstances, binding management
    company-template-service.ts — Extend materializeTemplate() with prefab layout

packages/db-local/
  migrations/
    NNNN_add_prefab_instances.ts — New table + migration from workstations

packages/asset-schema/
  src/
    manifest-schema.ts         — Add 'prefab' kind to manifest validation
```

---

## 16. Migration Strategy

### SQLite FK Constraint Reality

SQLite does not support `ALTER TABLE ... DROP/ADD CONSTRAINT`. Changing `employees.workstation_id`'s FK target from `workstations` to `prefab_instances` would require recreating the `employees` table (new table → copy data → drop old → rename). This is high-risk and touches every FK that references `employees`.

**Pragmatic approach: dual-write coexistence.**

### Migration Steps

1. **Create `prefab_instances` table** (new migration)
2. **Populate from existing data:**
   - For each `workstations` row: create a `prefab_instances` row with `prefab_id = 'workstation-standard'`, using the `workstation_id` as `instance_id` (same ID, zero disruption)
   - For each `racks` row: create a `prefab_instances` row with `prefab_id = 'server-rack-2u'`
   - Set `bindings_json` from existing FK relationships
3. **Keep `workstations` table and `employees.workstation_id` FK unchanged**
   - `employees.workstation_id` continues to reference `workstations(workstation_id)`
   - Workspace-category `prefab_instances.instance_id` uses the SAME value as `workstations.workstation_id`
   - This means both tables are queryable with the same ID — no FK change needed
4. **New code reads from `prefab_instances`**, old code still works via `workstations`
5. **Generate default zone prefab layouts** for utility zones (library, rest, meeting, server)
6. **Future cleanup (post-1.0):** Once all read paths use `prefab_instances`, drop `workstations` table via full table rebuild migration

---

## 17. Out of Scope (1.0 boundaries)

- 3D rendering (Prefab schema supports it via future `render3D` field, but 1.0 is 2D only)
- Prefab marketplace search/discovery UI (uses existing marketplace infrastructure)
- Animated state transitions with particle systems (1.0 uses simple color/opacity transitions; particles are 1.1)
- User-created custom templates (1.0 only core-registered templates)
- Prefab drag-and-drop placement editor (1.0 uses auto-layout; explicit placement editor is next phase)
