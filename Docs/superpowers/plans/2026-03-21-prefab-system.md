# Prefab System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a stateful, bindable office element system where every furniture piece maps to an AI concept through 6 semantic categories, event-driven state machines, and GraphicsContext-swapping rendering.

**Architecture:** Three-layer model — PrefabDefinition (static registry) → PrefabInstance (SQLite persistence) → PrefabRuntime (in-memory state + PixiJS rendering). State machines per semantic category drive visual feedback through event routing. Existing furniture.ts draw functions are refactored into parameterized render templates that produce GraphicsContext objects per state.

**Tech Stack:** TypeScript, PixiJS 8 (GraphicsContext API), GSAP 3, Vitest, Drizzle ORM (SQLite), pnpm monorepo

**Spec:** `Docs/superpowers/specs/2026-03-21-prefab-system-design.md`

---

## File Map

```
packages/shared-types/src/
  prefab.ts               ← NEW: SemanticCategory, PrefabDefinition, PrefabInstanceRow, PrefabBinding, etc.
  states.ts               ← MODIFY: add PrefabState type aliases per category
  events.ts               ← MODIFY: add knowledge.* event families + payloads
  index.ts                ← MODIFY: re-export new types

packages/renderer/src/
  prefab/
    state-machines.ts     ← NEW: category state enums, transition tables, canTransition()
    render-templates.ts   ← NEW: template registry, RenderTemplateFn, registerTemplate()
    builtin-catalog.ts    ← NEW: all built-in PrefabDefinition objects (25+)
    default-zone-layouts.ts ← NEW: default prefab placements per zone type
    prefab-runtime.ts     ← NEW: PrefabRuntime class (Container, GraphicsContext swapping, GSAP)
    prefab-event-router.ts ← NEW: binding → event subscription routing
    index.ts              ← NEW: barrel export
  shapes/
    furniture.ts          ← MODIFY: refactor draw*() to also produce GraphicsContext
  core/
    scene-entity-manager.ts ← MODIFY: add prefabRuntimes map + router
    scene-event-handler.ts  ← MODIFY: add prefabEventRouter.routeEvent() call
    types.ts              ← MODIFY: add PrefabSeed interface
  layers/
    floor-layer.ts        ← MODIFY: use prefab instances instead of hardcoded furniture
  index.ts                ← MODIFY: re-export prefab module
  __tests__/
    prefab-state-machines.test.ts    ← NEW
    prefab-render-templates.test.ts  ← NEW
    prefab-builtin-catalog.test.ts   ← NEW
    prefab-runtime.test.ts           ← NEW
    prefab-event-router.test.ts      ← NEW

packages/core/src/
  repos/
    prefab-instance-repository.ts    ← NEW: interface
  runtime/
    memory-prefab-repository.ts      ← NEW: in-memory impl for tests
    repositories.ts                  ← MODIFY: add PrefabInstanceRow
  services/
    prefab-service.ts                ← NEW: CRUD + binding management
    company-template-service.ts      ← MODIFY: add prefab layout materialization

packages/db-local/src/
  migrations/
    009_prefab_instances.sql         ← NEW: CREATE TABLE + seed migration

packages/asset-schema/src/
  manifest.types.ts                  ← MODIFY: add 'prefab' to AssetKind
```

---

## Task 1: Shared Types — Prefab Type Definitions

**Files:**
- Create: `packages/shared-types/src/prefab.ts`
- Modify: `packages/shared-types/src/states.ts`
- Modify: `packages/shared-types/src/events.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Create `prefab.ts` with all type definitions**

```typescript
// packages/shared-types/src/prefab.ts

// ── Semantic Categories ─────────────────────────────────────────
export type SemanticCategory =
  | 'workspace'
  | 'compute'
  | 'knowledge'
  | 'collaboration'
  | 'infrastructure'
  | 'decorative';

// ── Binding Slot Types ──────────────────────────────────────────
export type PrefabBindingSlotType =
  | 'agent-context'
  | 'model-endpoint'
  | 'rack-provider'
  | 'knowledge-source'
  | 'meeting-session'
  | 'handoff-route';

export interface PrefabBindingSlotDef {
  readonly name: string;
  readonly type: PrefabBindingSlotType;
  readonly required: boolean;
}

// ── Render Template Reference ───────────────────────────────────
export interface RenderTemplate2D {
  readonly template: string;
  readonly params: Readonly<Record<string, unknown>>;
}

// ── Composite Child ─────────────────────────────────────────────
export interface PrefabChildDef {
  readonly render2D: RenderTemplate2D;
  readonly offset: readonly [number, number];
}

// ── Prefab Definition ───────────────────────────────────────────
export interface PrefabDefinition {
  readonly prefabId: string;
  readonly name: string;
  readonly description: string;
  readonly category: SemanticCategory;
  readonly gridSize: readonly [number, number];
  readonly composite: boolean;
  readonly children?: readonly PrefabChildDef[];
  readonly render2D?: RenderTemplate2D;
  readonly bindingSlots: readonly PrefabBindingSlotDef[];
  readonly sourcePackageId?: string | null;
}

// ── Prefab Instance (DB row) ────────────────────────────────────
export interface PrefabInstanceRow {
  readonly instance_id: string;
  readonly company_id: string;
  readonly prefab_id: string;
  readonly zone_id: string;
  readonly position_x: number;
  readonly position_y: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly bindings_json: string | null;
  readonly config_json: string | null;
  readonly enabled: number;
  readonly created_at: string;
  readonly updated_at: string;
}

// ── Deserialized Binding ────────────────────────────────────────
export interface PrefabBinding {
  readonly slotName: string;
  readonly resourceRef: string;
  readonly label?: string;
}
```

- [ ] **Step 2: Add prefab state types to `states.ts`**

Append after the existing `RuntimeEntityType`:

```typescript
// ── Prefab State Types (per semantic category) ──────────────────

export type WorkspacePrefabState = 'empty' | 'occupied' | 'working' | 'thinking' | 'searching' | 'blocked' | 'idle';
export type ComputePrefabState = 'offline' | 'idle' | 'processing' | 'overloaded' | 'error';
export type KnowledgePrefabState = 'empty' | 'stocked' | 'indexing' | 'ready' | 'searching' | 'error';
export type CollaborationPrefabState = 'empty' | 'scheduled' | 'gathering' | 'active' | 'paused' | 'ended';
export type InfrastructurePrefabState = 'disconnected' | 'idle' | 'transmitting' | 'congested' | 'error';

export type PrefabState =
  | WorkspacePrefabState
  | ComputePrefabState
  | KnowledgePrefabState
  | CollaborationPrefabState
  | InfrastructurePrefabState;
```

Also add `'prefab'` to `RuntimeEntityType`:

```typescript
export type RuntimeEntityType =
  | 'employee' | 'task' | 'meeting' | 'install' | 'report'
  | 'llm' | 'graph' | 'plan' | 'mcp' | 'company'
  | 'prefab';
```

- [ ] **Step 3: Add knowledge event families and payloads to `events.ts`**

Add to `EventFamily` union:

```typescript
  | 'knowledge.index.started'
  | 'knowledge.index.completed'
  | 'knowledge.index.failed'
  | 'knowledge.search.started'
  | 'knowledge.search.completed'
  | 'prefab.state.changed'
```

Add payload interfaces at end of file:

```typescript
// ── Knowledge Events ──────────────────────────────────────────
export interface KnowledgeIndexStartedPayload {
  readonly knowledgeBaseRef: string;
  readonly documentCount: number;
}
export interface KnowledgeIndexCompletedPayload {
  readonly knowledgeBaseRef: string;
  readonly indexedCount: number;
  readonly durationMs: number;
}
export interface KnowledgeIndexFailedPayload {
  readonly knowledgeBaseRef: string;
  readonly error: string;
}
export interface KnowledgeSearchStartedPayload {
  readonly knowledgeBaseRef: string;
  readonly query: string;
  readonly employeeId: string;
}
export interface KnowledgeSearchCompletedPayload {
  readonly knowledgeBaseRef: string;
  readonly resultCount: number;
  readonly employeeId: string;
  readonly durationMs: number;
}

// ── Prefab Events ──────────────────────────────────────────────
export interface PrefabStateChangedPayload {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly category: string;
  readonly prev: string;
  readonly next: string;
}
```

- [ ] **Step 4: Update `index.ts` to re-export new types**

Add re-exports for all new types from `prefab.ts`, new state types, and new event payloads.

- [ ] **Step 5: Build shared-types and verify**

Run: `cd packages/shared-types && pnpm build`
Expected: clean build, no errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/
git commit -m "feat(shared-types): add prefab type definitions, state types, knowledge events"
```

---

## Task 2: Renderer — Prefab State Machines

Pure logic, no PixiJS dependency. Highly testable.

**Files:**
- Create: `packages/renderer/src/prefab/state-machines.ts`
- Test: `packages/renderer/src/__tests__/prefab-state-machines.test.ts`

- [ ] **Step 1: Write failing tests for state machine transitions**

```typescript
// packages/renderer/src/__tests__/prefab-state-machines.test.ts
import { describe, it, expect } from 'vitest';
import {
  canTransition,
  getInitialState,
  getAllStates,
  inferWorkspaceState,
  WORKSPACE_TRANSITIONS,
  COMPUTE_TRANSITIONS,
  KNOWLEDGE_TRANSITIONS,
  COLLABORATION_TRANSITIONS,
  INFRASTRUCTURE_TRANSITIONS,
} from '../prefab/state-machines.js';
import type { EmployeeState, MeetingState } from '@aics/shared-types';

describe('prefab state machines', () => {
  describe('getInitialState', () => {
    it('workspace → empty', () => expect(getInitialState('workspace')).toBe('empty'));
    it('compute → offline', () => expect(getInitialState('compute')).toBe('offline'));
    it('knowledge → empty', () => expect(getInitialState('knowledge')).toBe('empty'));
    it('collaboration → empty', () => expect(getInitialState('collaboration')).toBe('empty'));
    it('infrastructure → disconnected', () => expect(getInitialState('infrastructure')).toBe('disconnected'));
    it('decorative → null', () => expect(getInitialState('decorative')).toBeNull());
  });

  describe('canTransition', () => {
    it('workspace: empty → occupied ✓', () => {
      expect(canTransition('workspace', 'empty', 'occupied')).toBe(true);
    });
    it('workspace: empty → working ✗', () => {
      expect(canTransition('workspace', 'empty', 'working')).toBe(false);
    });
    it('compute: idle → processing ✓', () => {
      expect(canTransition('compute', 'idle', 'processing')).toBe(true);
    });
    it('compute: offline → processing ✗', () => {
      expect(canTransition('compute', 'offline', 'processing')).toBe(false);
    });
    it('decorative: always false', () => {
      expect(canTransition('decorative', 'any', 'other')).toBe(false);
    });
  });

  describe('getAllStates', () => {
    it('workspace has 7 states', () => expect(getAllStates('workspace')).toHaveLength(7));
    it('compute has 5 states', () => expect(getAllStates('compute')).toHaveLength(5));
    it('knowledge has 6 states', () => expect(getAllStates('knowledge')).toHaveLength(6));
    it('collaboration has 6 states', () => expect(getAllStates('collaboration')).toHaveLength(6));
    it('infrastructure has 5 states', () => expect(getAllStates('infrastructure')).toHaveLength(5));
    it('decorative has 0 states', () => expect(getAllStates('decorative')).toHaveLength(0));
  });

  describe('inferWorkspaceState', () => {
    const cases: [EmployeeState, string][] = [
      ['idle', 'idle'],
      ['assigned', 'occupied'],
      ['thinking', 'thinking'],
      ['searching', 'searching'],
      ['executing', 'working'],
      ['meeting', 'idle'],
      ['blocked', 'blocked'],
      ['waiting', 'occupied'],
      ['reporting', 'working'],
      ['success', 'idle'],
      ['failed', 'blocked'],
      ['paused', 'idle'],
    ];
    for (const [input, expected] of cases) {
      it(`${input} → ${expected}`, () => {
        expect(inferWorkspaceState(input)).toBe(expected);
      });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/renderer && pnpm vitest run src/__tests__/prefab-state-machines.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement state machines**

```typescript
// packages/renderer/src/prefab/state-machines.ts
import type { EmployeeState, SemanticCategory } from '@aics/shared-types';

// ── Transition tables: Map<fromState, Set<toState>> ─────────────

export const WORKSPACE_TRANSITIONS: Record<string, readonly string[]> = {
  empty:     ['occupied'],
  occupied:  ['working', 'thinking', 'searching', 'blocked', 'idle'],
  working:   ['thinking', 'searching', 'blocked', 'idle', 'occupied'],
  thinking:  ['working', 'searching', 'blocked', 'idle', 'occupied'],
  searching: ['working', 'thinking', 'blocked', 'idle', 'occupied'],
  blocked:   ['working', 'thinking', 'searching', 'idle', 'occupied'],
  idle:      ['working', 'thinking', 'searching', 'blocked', 'occupied', 'empty'],
};

export const COMPUTE_TRANSITIONS: Record<string, readonly string[]> = {
  offline:    ['idle'],
  idle:       ['processing', 'error', 'offline'],
  processing: ['idle', 'overloaded', 'error'],
  overloaded: ['processing', 'idle', 'error'],
  error:      ['idle', 'offline'],
};

export const KNOWLEDGE_TRANSITIONS: Record<string, readonly string[]> = {
  empty:     ['stocked'],
  stocked:   ['indexing', 'empty'],
  indexing:  ['ready', 'error'],
  ready:     ['searching', 'indexing', 'stocked'],
  searching: ['ready'],
  error:     ['stocked', 'empty'],
};

export const COLLABORATION_TRANSITIONS: Record<string, readonly string[]> = {
  empty:     ['scheduled'],
  scheduled: ['gathering', 'empty'],
  gathering: ['active', 'empty'],
  active:    ['paused', 'ended'],
  paused:    ['active', 'ended'],
  ended:     ['empty'],
};

export const INFRASTRUCTURE_TRANSITIONS: Record<string, readonly string[]> = {
  disconnected: ['idle'],
  idle:         ['transmitting', 'error', 'disconnected'],
  transmitting: ['idle', 'congested', 'error'],
  congested:    ['transmitting', 'idle', 'error'],
  error:        ['idle', 'disconnected'],
};

const CATEGORY_TABLES: Record<string, Record<string, readonly string[]>> = {
  workspace: WORKSPACE_TRANSITIONS,
  compute: COMPUTE_TRANSITIONS,
  knowledge: KNOWLEDGE_TRANSITIONS,
  collaboration: COLLABORATION_TRANSITIONS,
  infrastructure: INFRASTRUCTURE_TRANSITIONS,
};

const INITIAL_STATES: Record<string, string> = {
  workspace: 'empty',
  compute: 'offline',
  knowledge: 'empty',
  collaboration: 'empty',
  infrastructure: 'disconnected',
};

export function getInitialState(category: SemanticCategory): string | null {
  return INITIAL_STATES[category] ?? null;
}

export function getAllStates(category: SemanticCategory): string[] {
  const table = CATEGORY_TABLES[category];
  return table ? Object.keys(table) : [];
}

export function canTransition(category: SemanticCategory, from: string, to: string): boolean {
  const table = CATEGORY_TABLES[category];
  if (!table) return false;
  const allowed = table[from];
  return allowed ? allowed.includes(to) : false;
}

// ── EmployeeState → WorkspacePrefabState mapping ────────────────

const EMPLOYEE_TO_WORKSPACE: Record<EmployeeState, string> = {
  idle:      'idle',
  assigned:  'occupied',
  thinking:  'thinking',
  searching: 'searching',
  executing: 'working',
  meeting:   'idle',
  blocked:   'blocked',
  waiting:   'occupied',
  reporting: 'working',
  success:   'idle',
  failed:    'blocked',
  paused:    'idle',
};

export function inferWorkspaceState(employeeState: EmployeeState): string {
  return EMPLOYEE_TO_WORKSPACE[employeeState];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/renderer && pnpm vitest run src/__tests__/prefab-state-machines.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/prefab/state-machines.ts packages/renderer/src/__tests__/prefab-state-machines.test.ts
git commit -m "feat(renderer): add prefab state machines with transition validation"
```

---

## Task 3: Renderer — Render Template Registry

Refactor existing `furniture.ts` functions into the GraphicsContext template pattern.

**Files:**
- Create: `packages/renderer/src/prefab/render-templates.ts`
- Modify: `packages/renderer/src/shapes/furniture.ts` (keep existing functions, add context variants)
- Test: `packages/renderer/src/__tests__/prefab-render-templates.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/renderer/src/__tests__/prefab-render-templates.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock pixi.js before import (same pattern as scene-manager.test.ts)
vi.mock('pixi.js', () => {
  const instructions: unknown[] = [];
  class MockGraphicsContext {
    instructions = instructions;
    roundRect() { instructions.push('roundRect'); return this; }
    rect() { instructions.push('rect'); return this; }
    circle() { instructions.push('circle'); return this; }
    ellipse() { instructions.push('ellipse'); return this; }
    fill() { instructions.push('fill'); return this; }
    stroke() { instructions.push('stroke'); return this; }
  }
  class MockGraphics {
    context: unknown = null;
  }
  class MockContainer {
    children: unknown[] = [];
    x = 0; y = 0;
    addChild(c: unknown) { this.children.push(c); return c; }
  }
  return { GraphicsContext: MockGraphicsContext, Graphics: MockGraphics, Container: MockContainer };
});

import { getTemplate, registerTemplate, getAllTemplateNames, buildStateContexts } from '../prefab/render-templates.js';

describe('render template registry', () => {
  it('registers and retrieves a template', () => {
    const fn = (params: Record<string, unknown>, state: string) => new (await import('pixi.js')).GraphicsContext();
    registerTemplate('test-template', fn);
    expect(getTemplate('test-template')).toBe(fn);
  });

  it('returns undefined for unknown template', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('built-in templates include desk, monitor, chair, server-rack, bookshelf', () => {
    const names = getAllTemplateNames();
    expect(names).toContain('desk');
    expect(names).toContain('monitor');
    expect(names).toContain('chair');
    expect(names).toContain('server-rack');
    expect(names).toContain('bookshelf');
    expect(names).toContain('meeting-table');
    expect(names).toContain('sofa');
    expect(names).toContain('plant');
    expect(names).toContain('network-switch');
  });

  it('buildStateContexts returns a context per state', () => {
    const states = ['idle', 'processing', 'error'];
    const fn = getTemplate('server-rack')!;
    const contexts = buildStateContexts(fn, {}, states);
    expect(contexts.size).toBe(3);
    expect(contexts.has('idle')).toBe(true);
    expect(contexts.has('processing')).toBe(true);
    expect(contexts.has('error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `cd packages/renderer && pnpm vitest run src/__tests__/prefab-render-templates.test.ts`

- [ ] **Step 3: Implement render-templates.ts**

Create `packages/renderer/src/prefab/render-templates.ts` with:
- `RenderTemplateFn` type: `(params: Record<string, unknown>, state: string) => GraphicsContext`
- Template registry (`Map<string, RenderTemplateFn>`)
- `registerTemplate()`, `getTemplate()`, `getAllTemplateNames()`
- `buildStateContexts(fn, params, states)` helper
- All built-in templates refactored from `furniture.ts` draw functions — each template function creates a `GraphicsContext`, calls the same draw primitives (roundRect, circle, fill, etc.), and returns the context.
- State-aware rendering: templates that support states (server-rack, monitor, bookshelf, etc.) vary colors/shapes based on the `state` parameter. Templates that don't care about state (desk, chair, plant) ignore it.

Key: keep existing `furniture.ts` `draw*()` functions unchanged (they're used by FloorLayer until Task 11 refactors it). New template functions can call into them or duplicate the logic on GraphicsContext.

- [ ] **Step 4: Run tests — expect pass**

Run: `cd packages/renderer && pnpm vitest run src/__tests__/prefab-render-templates.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/prefab/render-templates.ts packages/renderer/src/__tests__/prefab-render-templates.test.ts
git commit -m "feat(renderer): add render template registry with GraphicsContext pattern"
```

---

## Task 4: Renderer — Built-in Prefab Catalog

**Files:**
- Create: `packages/renderer/src/prefab/builtin-catalog.ts`
- Create: `packages/renderer/src/prefab/default-zone-layouts.ts`
- Test: `packages/renderer/src/__tests__/prefab-builtin-catalog.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/renderer/src/__tests__/prefab-builtin-catalog.test.ts
import { describe, it, expect } from 'vitest';
import { getBuiltinPrefab, getAllBuiltinPrefabs } from '../prefab/builtin-catalog.js';
import { getDefaultZoneLayout } from '../prefab/default-zone-layouts.js';

describe('builtin prefab catalog', () => {
  it('has at least 25 built-in prefabs', () => {
    expect(getAllBuiltinPrefabs().length).toBeGreaterThanOrEqual(25);
  });

  it('workstation-standard is composite with 3 children', () => {
    const ws = getBuiltinPrefab('workstation-standard');
    expect(ws).toBeDefined();
    expect(ws!.composite).toBe(true);
    expect(ws!.children).toHaveLength(3);
    expect(ws!.category).toBe('workspace');
  });

  it('server-rack-2u is atomic with rack-provider binding', () => {
    const sr = getBuiltinPrefab('server-rack-2u');
    expect(sr).toBeDefined();
    expect(sr!.composite).toBe(false);
    expect(sr!.render2D).toBeDefined();
    expect(sr!.bindingSlots.some(s => s.type === 'rack-provider')).toBe(true);
  });

  it('plant-small is decorative with no bindings', () => {
    const p = getBuiltinPrefab('plant-small');
    expect(p).toBeDefined();
    expect(p!.category).toBe('decorative');
    expect(p!.bindingSlots).toHaveLength(0);
  });

  it('every category has at least one prefab', () => {
    const all = getAllBuiltinPrefabs();
    const categories = new Set(all.map(p => p.category));
    expect(categories.has('workspace')).toBe(true);
    expect(categories.has('compute')).toBe(true);
    expect(categories.has('knowledge')).toBe(true);
    expect(categories.has('collaboration')).toBe(true);
    expect(categories.has('infrastructure')).toBe(true);
    expect(categories.has('decorative')).toBe(true);
  });

  it('composite prefabs have no render2D, atomic prefabs have no children', () => {
    for (const p of getAllBuiltinPrefabs()) {
      if (p.composite) {
        expect(p.render2D).toBeUndefined();
        expect(p.children!.length).toBeGreaterThan(0);
      } else {
        expect(p.render2D).toBeDefined();
        expect(p.children).toBeUndefined();
      }
    }
  });
});

describe('default zone layouts', () => {
  it('department zone gets N workstations + 1 plant', () => {
    const layout = getDefaultZoneLayout('department', 5);
    const ws = layout.filter(p => p.prefabId === 'workstation-standard');
    const plants = layout.filter(p => p.prefabId === 'plant-small');
    expect(ws).toHaveLength(5);
    expect(plants).toHaveLength(1);
  });

  it('library zone gets bookshelves + reading table + plant', () => {
    const layout = getDefaultZoneLayout('library');
    expect(layout.some(p => p.prefabId === 'bookshelf-double')).toBe(true);
    expect(layout.some(p => p.prefabId === 'reading-table')).toBe(true);
    expect(layout.some(p => p.prefabId === 'plant-large')).toBe(true);
  });

  it('server_room zone gets server racks + cable tray + switch', () => {
    const layout = getDefaultZoneLayout('server_room', 3);
    const racks = layout.filter(p => p.prefabId === 'server-rack-2u');
    expect(racks).toHaveLength(3);
    expect(layout.some(p => p.prefabId === 'cable-tray')).toBe(true);
    expect(layout.some(p => p.prefabId === 'network-switch')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Implement `builtin-catalog.ts`**

Define all 25+ PrefabDefinition objects per spec §10. Use `Object.freeze()` on each definition.

- [ ] **Step 4: Implement `default-zone-layouts.ts`**

`getDefaultZoneLayout(zoneType, count?)` returns an array of `{ prefabId, position?, rotation? }` per spec §14.

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/prefab/builtin-catalog.ts packages/renderer/src/prefab/default-zone-layouts.ts packages/renderer/src/__tests__/prefab-builtin-catalog.test.ts
git commit -m "feat(renderer): add built-in prefab catalog (25+ definitions) and default zone layouts"
```

---

## Task 5: Renderer — PrefabRuntime Class

The runtime object that manages a single prefab instance in the scene.

**Files:**
- Create: `packages/renderer/src/prefab/prefab-runtime.ts`
- Test: `packages/renderer/src/__tests__/prefab-runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Test that PrefabRuntime:
1. Creates a Container in the correct layer
2. Pre-builds GraphicsContext for all states at construction
3. `setState()` swaps `graphics.context` (not clear+redraw)
4. `setState()` rejects invalid transitions
5. `destroy()` cleans up tweens and unsubscribes events
6. Composite prefabs create child Graphics at correct offsets
7. Decorative prefabs have no state machine (setState is no-op)

Use the same `vi.mock('pixi.js')` pattern from scene-manager.test.ts.

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Implement PrefabRuntime**

Key implementation details:
- Constructor: takes `PrefabDefinition`, `params`, `category`, calls `buildStateContexts()` for each child or self
- `setState(next)`: validate via `canTransition()`, swap context, apply GSAP `overwrite: 'auto'` tween
- `bindToResource(slotName, resourceRef)`: stores binding, notifies router
- `destroy()`: `gsap.killTweensOf(container)`, unsubscribe events, `container.destroy()`
- For composite: create child `Graphics` at offsets, each with own stateContexts

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/prefab/prefab-runtime.ts packages/renderer/src/__tests__/prefab-runtime.test.ts
git commit -m "feat(renderer): add PrefabRuntime with GraphicsContext swapping and GSAP state transitions"
```

---

## Task 6: Renderer — PrefabEventRouter

Routes RuntimeEvents to PrefabRuntime instances based on their bindings.

**Files:**
- Create: `packages/renderer/src/prefab/prefab-event-router.ts`
- Test: `packages/renderer/src/__tests__/prefab-event-router.test.ts`

- [ ] **Step 1: Write failing tests**

Test that PrefabEventRouter:
1. Registers a binding and routes matching events to the correct runtime
2. Unregisters a binding and stops routing
3. Routes `employee.state.changed` to workspace prefabs via employeeId
4. Routes `llm.call.started` to compute prefabs via provider+model → rackId lookup
5. Routes `meeting.state.changed` to collaboration prefabs via meetingId
6. Routes `knowledge.index.started` to knowledge prefabs via knowledgeBaseRef
7. Routes `handoff.initiated` to infrastructure prefabs via fromEmployeeId+toEmployeeId
8. Does NOT route events to unrelated prefabs
9. Handles multiple prefabs bound to the same resource

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Implement PrefabEventRouter**

Key implementation:
- `bindingIndex: Map<resourceRef, Set<instanceId>>`
- `runtimes: Map<instanceId, PrefabRuntime>`
- `providerRackIndex: Map<provider:model, rackId>` (built from rack.bound events)
- `routeEvent(event)`: extract resourceRef based on event type (see spec §7.2 extraction rules table), look up bound instances, call `inferState()` per category, call `runtime.setState()`
- `inferState(category, event)`: per-category logic translating event to prefab state

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/prefab/prefab-event-router.ts packages/renderer/src/__tests__/prefab-event-router.test.ts
git commit -m "feat(renderer): add PrefabEventRouter with binding-driven event routing"
```

---

## Task 7: Core — PrefabInstance Repository

**Files:**
- Create: `packages/core/src/repos/prefab-instance-repository.ts`
- Create: `packages/core/src/runtime/memory-prefab-repository.ts`
- Modify: `packages/core/src/runtime/repositories.ts` — add PrefabInstanceRow re-export

- [ ] **Step 1: Create repository interface**

```typescript
// packages/core/src/repos/prefab-instance-repository.ts
import type { PrefabInstanceRow } from '@aics/shared-types';

export interface PrefabInstanceRepository {
  create(instance: PrefabInstanceRow): Promise<PrefabInstanceRow>;
  findById(instanceId: string): Promise<PrefabInstanceRow | null>;
  findByCompanyAndZone(companyId: string, zoneId: string): Promise<PrefabInstanceRow[]>;
  findByCompany(companyId: string): Promise<PrefabInstanceRow[]>;
  update(instanceId: string, fields: Partial<Pick<PrefabInstanceRow, 'position_x' | 'position_y' | 'rotation' | 'bindings_json' | 'config_json' | 'enabled'>>): Promise<void>;
  delete(instanceId: string): Promise<void>;
  deleteByCompany(companyId: string): Promise<void>;
}
```

- [ ] **Step 2: Implement memory repository**

Follow the same `Map<id, row>` pattern as `memory-install-repos.ts`. Include `createMemoryPrefabRepository()` factory.

- [ ] **Step 3: Write tests for memory repo**

Test CRUD operations, zone filtering, company deletion.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/repos/prefab-instance-repository.ts packages/core/src/runtime/memory-prefab-repository.ts
git commit -m "feat(core): add PrefabInstanceRepository interface and memory implementation"
```

---

## Task 8: DB — Migration 009_prefab_instances

**Files:**
- Create: `packages/db-local/src/migrations/009_prefab_instances.sql`
- Modify: `Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql`

- [ ] **Step 1: Create migration SQL**

```sql
-- 009_prefab_instances.sql
-- Prefab System: office elements as stateful, bindable AI-concept entities

CREATE TABLE IF NOT EXISTS prefab_instances (
  instance_id   TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  prefab_id     TEXT NOT NULL,
  zone_id       TEXT NOT NULL,
  position_x    REAL NOT NULL DEFAULT 0,
  position_y    REAL NOT NULL DEFAULT 0,
  rotation      INTEGER NOT NULL DEFAULT 0,
  bindings_json TEXT,
  config_json   TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prefab_instances_company
  ON prefab_instances(company_id);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_zone
  ON prefab_instances(company_id, zone_id);

-- Seed: migrate existing workstations to workspace prefab instances
INSERT INTO prefab_instances (instance_id, company_id, prefab_id, zone_id, position_x, position_y, rotation, bindings_json, config_json, enabled, created_at, updated_at)
SELECT
  workstation_id,
  company_id,
  'workstation-standard',
  'zone-' || room_type,
  COALESCE(json_extract(position_json, '$.x'), 0),
  COALESCE(json_extract(position_json, '$.y'), 0),
  0,
  NULL,
  NULL,
  1,
  created_at,
  updated_at
FROM workstations;
```

- [ ] **Step 2: Update contract schema doc**

Append the `prefab_instances` table definition to `Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql`.

- [ ] **Step 3: Commit**

```bash
git add packages/db-local/src/migrations/009_prefab_instances.sql Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql
git commit -m "feat(db-local): add migration 009 — prefab_instances table with workstation seed"
```

---

## Task 9: Core — PrefabService

CRUD operations + binding management for prefab instances.

**Files:**
- Create: `packages/core/src/services/prefab-service.ts`
- Test: `packages/core/src/__tests__/prefab-service.test.ts`

- [ ] **Step 1: Write failing tests**

Test that PrefabService:
1. `createInstance()` creates a PrefabInstanceRow and emits event
2. `bindResource()` updates bindings_json and emits event
3. `unbindResource()` removes binding and emits event
4. `getInstancesByZone()` returns filtered list
5. `deleteInstance()` removes and emits event
6. `materializeDefaultLayout()` creates correct prefab instances per zone type

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Implement PrefabService**

Depends on: `PrefabInstanceRepository`, `EventBus`, `getBuiltinPrefab()`, `getDefaultZoneLayout()`.

Key methods:
- `createInstance(companyId, prefabId, zoneId, options?)` → validates prefab exists, creates row, emits `prefab.state.changed`
- `bindResource(instanceId, slotName, resourceRef)` → validates slot type, updates bindings_json
- `materializeDefaultLayout(companyId, zoneId, zoneType, count?)` → calls `getDefaultZoneLayout()`, creates instances

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/prefab-service.ts packages/core/src/__tests__/prefab-service.test.ts
git commit -m "feat(core): add PrefabService with CRUD, binding management, and default layout materialization"
```

---

## Task 10: Renderer — SceneEntityManager + EventHandler Integration

Wire prefab system into the existing scene management pipeline.

**Files:**
- Modify: `packages/renderer/src/core/scene-entity-manager.ts`
- Modify: `packages/renderer/src/core/scene-event-handler.ts`
- Modify: `packages/renderer/src/core/types.ts`
- Create: `packages/renderer/src/prefab/index.ts` (barrel export)
- Modify: `packages/renderer/src/index.ts`

- [ ] **Step 1: Add PrefabSeed to types.ts**

```typescript
// Add to packages/renderer/src/core/types.ts
export interface PrefabSeed {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly category: SemanticCategory;
  readonly zoneId: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly bindings?: readonly PrefabBinding[];
  readonly configOverrides?: Record<string, unknown>;
}
```

Add `prefabs?: PrefabSeed[]` to `SceneManagerOptions`.

- [ ] **Step 2: Add prefabRuntimes to SceneEntityManager**

Add fields:
```typescript
prefabRuntimes: Map<string, PrefabRuntime> = new Map();
prefabEventRouter: PrefabEventRouter = new PrefabEventRouter();
```

Add methods:
```typescript
addPrefabInstance(seed: PrefabSeed): PrefabRuntime;
removePrefabInstance(instanceId: string): void;
```

- [ ] **Step 3: Add routeEvent() call to SceneEventHandler**

In the main event handler function, after existing event routing logic, add:
```typescript
this.delegate.prefabEventRouter?.routeEvent(event);
```

- [ ] **Step 4: Create barrel export**

```typescript
// packages/renderer/src/prefab/index.ts
export { PrefabRuntime } from './prefab-runtime.js';
export { PrefabEventRouter } from './prefab-event-router.js';
export { getBuiltinPrefab, getAllBuiltinPrefabs } from './builtin-catalog.js';
export { getDefaultZoneLayout } from './default-zone-layouts.js';
export { canTransition, getInitialState, getAllStates, inferWorkspaceState } from './state-machines.js';
export { getTemplate, registerTemplate, buildStateContexts } from './render-templates.js';
```

- [ ] **Step 5: Update main index.ts re-exports**

- [ ] **Step 6: Run full renderer test suite**

Run: `cd packages/renderer && pnpm test`
Expected: ALL existing tests still pass + new tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/
git commit -m "feat(renderer): integrate prefab system into SceneEntityManager and EventHandler"
```

---

## Task 11: Renderer — FloorLayer Prefab Rendering

Replace hardcoded zone furniture with prefab-driven rendering.

**Files:**
- Modify: `packages/renderer/src/layers/floor-layer.ts`

- [ ] **Step 1: Add prefab rendering path to FloorLayer**

Add a `renderPrefabs(prefabSeeds: PrefabSeed[], layers: SceneLayers)` method that:
1. For each PrefabSeed, looks up the PrefabDefinition from catalog
2. Creates a PrefabRuntime for each
3. Places the runtime's container at the correct position in the furniture layer

Keep the existing zone-type furniture rendering as fallback when no PrefabSeeds are provided (backward compatibility).

- [ ] **Step 2: Run existing zone-layout-engine tests**

Run: `cd packages/renderer && pnpm vitest run src/__tests__/zone-layout-engine.test.ts`
Expected: ALL PASS (no regression)

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/layers/floor-layer.ts
git commit -m "feat(renderer): add prefab-driven rendering path to FloorLayer"
```

---

## Task 12: Core — CompanyTemplateService Extension

Add prefab layout to company template materialization.

**Files:**
- Modify: `packages/core/src/services/company-template-service.ts`
- Modify: `packages/core/src/templates/index.ts` (add prefabLayout to templates)

- [ ] **Step 1: Add `prefabLayout` to each built-in CompanyTemplate**

Each template gets a `prefabLayout` field mapping zone IDs to prefab placements. Use the `getDefaultZoneLayout()` function for simplicity — templates just specify zone types and counts.

- [ ] **Step 2: Modify `materializeTemplate()` to create prefab instances**

After creating employees and SOPs, call `PrefabService.materializeDefaultLayout()` for each zone. Auto-bind workspace prefabs to created employees by role_slug → zone matching.

- [ ] **Step 3: Run existing template tests**

Verify no regression in company creation flow.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/company-template-service.ts packages/core/src/templates/
git commit -m "feat(core): extend CompanyTemplateService with prefab layout materialization"
```

---

## Task 13: Asset Schema — Add 'prefab' to AssetKind

**Files:**
- Modify: `packages/asset-schema/src/manifest.types.ts`
- Modify: `Docs/02_contracts_and_schemas/aics_manifest.schema.json`

- [ ] **Step 1: Add 'prefab' to AssetKind**

```typescript
export type AssetKind =
  | 'employee' | 'skill' | 'sop' | 'company_template' | 'office_layout' | 'bundle'
  | 'prefab';
```

- [ ] **Step 2: Update JSON Schema**

Add `"prefab"` to the `enum` array for `package.kind` and `assets[].kind`.

- [ ] **Step 3: Run asset-schema tests**

Run: `cd packages/asset-schema && pnpm test`

- [ ] **Step 4: Commit**

```bash
git add packages/asset-schema/src/manifest.types.ts Docs/02_contracts_and_schemas/aics_manifest.schema.json
git commit -m "feat(asset-schema): add 'prefab' to AssetKind for marketplace packages"
```

---

## Task 14: Typecheck + Full Test Suite

**Files:** None — validation only

- [ ] **Step 1: Build shared-types (dependency for all packages)**

Run: `cd packages/shared-types && pnpm build`

- [ ] **Step 2: Run full monorepo typecheck**

Run: `pnpm -r typecheck`
Expected: 28/28 packages pass

- [ ] **Step 3: Run full test suite**

Run: `pnpm -r test`
Expected: all 1114+ tests pass, 0 failures

- [ ] **Step 4: Fix any issues found**

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git commit -m "fix: resolve typecheck and test issues from prefab system integration"
```

---

## Dependency Graph

```
Task 1 (shared-types)
  ├──→ Task 2 (state machines)
  ├──→ Task 3 (render templates)
  ├──→ Task 7 (repo interface)
  └──→ Task 13 (asset-schema)

Task 2 + Task 3
  └──→ Task 4 (catalog + zone layouts)
       └──→ Task 5 (PrefabRuntime)
            └──→ Task 6 (EventRouter)
                 └──→ Task 10 (SceneManager integration)
                      └──→ Task 11 (FloorLayer)

Task 7
  └──→ Task 8 (migration)
       └──→ Task 9 (PrefabService)
            └──→ Task 12 (CompanyTemplate extension)

Task 10 + Task 12 + Task 13
  └──→ Task 14 (full validation)
```

**Parallelizable groups:**
- Group A: Tasks 1 → 2+3 → 4 → 5 → 6 (renderer chain)
- Group B: Tasks 1 → 7 → 8 → 9 (core/persistence chain)
- Group C: Task 13 (asset-schema, independent after Task 1)
- Groups merge at Task 10 (integration) → 11 → 12 → 14
