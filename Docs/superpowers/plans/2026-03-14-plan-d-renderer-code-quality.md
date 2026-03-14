# Plan D: Renderer Quality + Code Health

> **For agentic workers:** Use superpowers:executing-plans to implement. Steps use checkbox syntax for tracking.
> **File ownership:** This plan touches `packages/renderer/src/`, `apps/market/src/app/` (loading.tsx files only + next.config.ts), `packages/core/src/services/logger.ts` (new), and scattered console.* replacements in core. Does NOT touch apps/platform, packages/doc-engine, packages/core/src/graph/, packages/core/src/templates/, or packages/ui-office/src/components/notifications/.

**Goal:** Fix GSAP memory leak risks, split the oversized SceneManager, add Next.js streaming/caching, and unify core logging.

**Tech Stack:** PixiJS 8, GSAP 3, Next.js 15, TypeScript

---

## Task 1: GSAP Tween Lifecycle Fix

**Files:**
- Modify: `packages/renderer/src/puppet/base-puppet.ts` (368 lines, focus lines 300-308)
- Modify: `packages/renderer/src/core/scene-manager.ts` (lines 318-346 — untracked tweens)
- Modify: `packages/renderer/src/interaction/interaction-controller.ts` (line 357 — snapBack tween)

**Spec:**

Problem 1: `trackTween()` (base-puppet.ts:300-308) monkey-patches `tw.vars.onComplete` after tween creation. GSAP recommends using `eventCallback()` or passing onComplete at creation time.

Fix trackTween:
```typescript
protected trackTween(tw: gsap.core.Tween): void {
  this.activeTweens.push(tw);
  tw.eventCallback('onComplete', () => {
    const idx = this.activeTweens.indexOf(tw);
    if (idx >= 0) this.activeTweens.splice(idx, 1);
  });
}
```

Problem 2: SceneManager creates tweens without storing references (lines 318-325, 340-346). If entity is destroyed mid-tween, the tween continues targeting a destroyed container.

Fix: Add `private managedTweens: gsap.core.Tween[] = []` to SceneManager. Track all tweens created in addEmployee/removeEmployee/moveEntity. Kill all in destroy().

Problem 3: InteractionController.snapBack() (line 357) creates untracked tween.

Fix: Store snapBack tween reference, kill on next drag start or destroy.

Problem 4: BasePuppet.flashHighlight() (lines 261-281) creates a timeline that bypasses trackTween.

Fix: Track the flash timeline in activeTweens, kill in destroy().

- [ ] Step 1: Fix trackTween() to use eventCallback instead of vars.onComplete mutation
- [ ] Step 2: Add managedTweens tracking to SceneManager for entity lifecycle tweens
- [ ] Step 3: Fix snapBack tween tracking in InteractionController
- [ ] Step 4: Fix flashHighlight timeline tracking in BasePuppet
- [ ] Step 5: Add tests verifying tweens are killed on destroy()
- [ ] Step 6: Commit

---

## Task 2: SceneManager Decomposition

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts` (1185 lines → ~400 lines)
- Create: `packages/renderer/src/core/scene-event-handler.ts`
- Create: `packages/renderer/src/core/scene-entity-manager.ts`
- Create: `packages/renderer/src/core/scene-visual-feedback.ts`

**Spec:**

Current SceneManager handles 5+ concerns in one 1185-line file. Split into focused managers:

**SceneManager** (stays as orchestrator, ~400 lines):
- mount()/destroy() lifecycle
- Public API surface (addEmployee, removeEmployee, setState, etc.)
- Delegates to sub-managers
- Holds the PixiJS Application reference

**SceneEntityManager** (new, ~250 lines):
- Employee entity creation/removal
- Entity position management
- rebuildLayout() and zone occupancy tracking
- Occupancy Map (`Map<workstationId, employeeId>`) replacing the current O(n²) position matching (lines 776-802)

**SceneEventHandler** (new, ~300 lines):
- The entire `subscribeEvents()` method (lines 816-1068)
- EventBus subscription management
- Event-to-scene action mapping

**SceneVisualFeedback** (new, ~150 lines):
- Spotlight system (lines 1068-1173)
- Attention system
- Install ghost management
- Route line management

Integration pattern:
```typescript
class SceneManager {
  private entityManager: SceneEntityManager;
  private eventHandler: SceneEventHandler;
  private visualFeedback: SceneVisualFeedback;

  constructor(app, eventBus, ...) {
    this.entityManager = new SceneEntityManager(app, this.floorLayer);
    this.eventHandler = new SceneEventHandler(eventBus, this);
    this.visualFeedback = new SceneVisualFeedback(app);
  }
}
```

Each sub-manager must:
- Accept dependencies via constructor (no global state)
- Have its own destroy() method
- Not import from the parent SceneManager (avoid circular deps — use an interface/callback pattern)

- [ ] Step 1: Extract SceneEntityManager with occupancy Map
- [ ] Step 2: Extract SceneEventHandler with all event subscriptions
- [ ] Step 3: Extract SceneVisualFeedback with spotlight/attention/ghost
- [ ] Step 4: Refactor SceneManager to delegate to sub-managers
- [ ] Step 5: Update all imports across renderer package
- [ ] Step 6: Run existing renderer tests (273+) — all must pass
- [ ] Step 7: Commit

---

## Task 3: STATE_TO_ANIM Mapping Completeness

**Files:**
- Modify: `packages/renderer/src/tokens/state-feedback-matrix.ts` (142 lines)
- Modify: `packages/renderer/src/puppet/types.ts` (92 lines — PuppetAnimState enum)

**Spec:**

All 14 PuppetAnimState animations ARE implemented in EmployeePuppet/LobsterPuppet. The gap is in `STATE_TO_ANIM` mapping — some runtime EmployeeState values may not map to animation states.

Verify and ensure complete mapping:
- Every `EmployeeState` value in shared-types must map to a `PuppetAnimState` in STATE_TO_ANIM
- Verify `EMPLOYEE_STATE_SIGNALS` covers all states with appropriate visual signals
- Add any missing mappings with sensible defaults

- [ ] Step 1: Audit STATE_TO_ANIM for completeness against EmployeeState enum
- [ ] Step 2: Add any missing mappings
- [ ] Step 3: Verify EMPLOYEE_STATE_SIGNALS covers all states
- [ ] Step 4: Commit

---

## Task 4: Next.js ISR + Streaming Loading States

**Files:**
- Modify: `apps/market/next.config.ts` (9 lines)
- Create: `apps/market/src/app/loading.tsx`
- Create: `apps/market/src/app/search/loading.tsx`
- Create: `apps/market/src/app/listing/[slug]/loading.tsx`
- Create: `apps/market/src/app/creator/[handle]/loading.tsx`
- Create: `apps/market/src/app/dashboard/loading.tsx`
- Modify: `apps/market/src/app/page.tsx` (add revalidate export)
- Modify: `apps/market/src/app/search/page.tsx` (add revalidate export)

**Spec:**

ISR strategy:
- Homepage (`/`): `export const revalidate = 60` (revalidate every 60 seconds)
- Search (`/search`): `export const dynamic = 'force-dynamic'` (always fresh, user query dependent)
- Listing detail: `export const revalidate = 300` (5 min cache, listings don't change fast)
- Creator page: `export const revalidate = 300`
- Dashboard: no ISR (authenticated, always dynamic)

Loading.tsx pattern (use Tailwind skeleton animations):
```tsx
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      <div className="h-8 w-48 rounded bg-gray-200" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 rounded-lg bg-gray-200" />
        ))}
      </div>
    </div>
  );
}
```

Each loading.tsx should match the layout structure of its corresponding page (skeleton cards for listings, skeleton profile for creator, etc.)

- [ ] Step 1: Add revalidate exports to homepage and listing/creator pages
- [ ] Step 2: Create loading.tsx for root (skeleton listing grid)
- [ ] Step 3: Create loading.tsx for search (skeleton results + filters)
- [ ] Step 4: Create loading.tsx for listing detail (skeleton detail page)
- [ ] Step 5: Create loading.tsx for creator profile
- [ ] Step 6: Create loading.tsx for dashboard
- [ ] Step 7: Commit

---

## Task 5: Core Unified Logging

**Files:**
- Create: `packages/core/src/services/logger.ts`
- Modify: `packages/core/src/services/memory-service.ts` (lines 168, 195)
- Modify: `packages/core/src/events/event-bus.ts` (line 32)
- Modify: `packages/core/src/agents/employee-node.ts` (line 417)
- Modify: `packages/core/src/llm/recorded-call.ts` (lines 55, 103, 152, 200)
- Modify: `packages/core/src/llm/stream-tee.ts` (line 21)
- Modify: `packages/core/src/graph/meeting-subgraph.ts` (lines 298, 308, 360)
- Modify: `packages/core/src/mcp/auditing-tool-executor.ts` (line 53)
- Modify: `packages/core/src/index.ts` (export Logger)

**Spec:**

Create a lightweight, structured Logger (no external dependencies):

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  category: string;        // 'llm', 'event-bus', 'memory', 'mcp', 'meeting'
  message: string;
  error?: unknown;
  context?: Record<string, unknown>;  // companyId, employeeId, threadId, etc.
  timestamp: number;
}

export class Logger {
  constructor(private category: string) {}

  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

// Global log handler (replaceable for testing/production)
export function setLogHandler(handler: (entry: LogEntry) => void): void;
```

Default handler: `console[level](JSON.stringify(entry))` — structured JSON for log aggregators.

Replace all 12 console.error/console.warn calls across 8 files:
- Each file creates `const logger = new Logger('category')` at module level
- Replace `console.error('msg', err)` → `logger.error('msg', err, { contextId })`

- [ ] Step 1: Create Logger class and setLogHandler
- [ ] Step 2: Replace console calls in recorded-call.ts (4 locations)
- [ ] Step 3: Replace console calls in meeting-subgraph.ts (3 locations)
- [ ] Step 4: Replace console calls in memory-service.ts, event-bus.ts, employee-node.ts, stream-tee.ts, auditing-tool-executor.ts
- [ ] Step 5: Export Logger from packages/core barrel
- [ ] Step 6: Tests for Logger (default handler, custom handler, structured output)
- [ ] Step 7: Commit

---

## Verification

- [ ] All renderer tests pass (273+)
- [ ] All core tests pass (373+)
- [ ] `pnpm run typecheck` passes for renderer, core, market
- [ ] `pnpm run build` passes for renderer, core, market
- [ ] Market pages show loading skeletons during data fetch
- [ ] SceneManager file is under 450 lines
- [ ] No untracked GSAP tweens remain in renderer
