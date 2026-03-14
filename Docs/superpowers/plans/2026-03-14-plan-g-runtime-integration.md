# Plan G: Runtime Integration (HR Route Trigger + Notification Bridge)

> **File ownership:** `packages/core/src/agents/`, `packages/core/src/services/`, `packages/core/src/events/`. Does NOT touch apps/market, apps/platform, packages/renderer, packages/ui-market.

**Goal:** Wire up two Wave 1 features that have infrastructure but lack integration: HR Agent routing and Notification event bridging.

---

## Task 1: HR Route Trigger in Boss/Manager Nodes

**Files:**
- Modify: `packages/core/src/agents/boss-node.ts` (add hire/team intent detection)
- Modify: `packages/core/src/agents/manager-node.ts` (add HR routing logic)
- Create: `packages/core/src/__tests__/unit/hr-routing.test.ts`

**Spec:**
Current state: HR node exists but Manager never routes to it because no intent detection for hiring-related requests.

Fix:
- In `bossNode`: Add 'hire' and 'assess_team' to the LLM routing prompt as valid intents
  - When boss says things like "我需要一个新的设计师" / "团队现在缺什么" / "帮我招人" → route decision should include HR path
  - Add to the system prompt's route options: `hire_or_assess: route to HR for recruitment/team assessment`
- In `managerNode`: When receiving a hire/assess intent from boss
  - Set `managerDirective.constraints` to 'hire' or 'assess_team'
  - This triggers existing `routeFromManager()` in main-graph.ts to route to HR node

Key constraint: Don't change the graph topology — the routing edges already exist. Only need to ensure boss/manager nodes actually produce the directive values that trigger HR routing.

- [ ] Step 1: Update boss-node system prompt to include hire/assess route option
- [ ] Step 2: Add hire intent parsing in boss-node response handler
- [ ] Step 3: Update manager-node to set constraints='hire'|'assess_team' for HR-bound requests
- [ ] Step 4: Tests: boss recognizes hiring intent → manager routes to HR
- [ ] Step 5: Commit

---

## Task 2: Notification Event Bridge

**Files:**
- Create: `packages/core/src/services/notification-bridge.ts`
- Modify: `packages/core/src/index.ts` (export)
- Create: `packages/core/src/__tests__/unit/notification-bridge.test.ts`

**Spec:**
Current state: NotificationCenter UI exists (useNotifications hook subscribes to `notification.` events), and `notificationCreated()` factory exists. But no code converts runtime events into notifications.

Create `NotificationBridge` service:
```typescript
export class NotificationBridge {
  constructor(private eventBus: EventBus) {}

  activate(): void {
    // Subscribe to runtime events and emit notification events
  }

  deactivate(): void {
    // Unsubscribe all
  }
}
```

Event mapping rules:
| Runtime Event | → Notification | Level | Title |
|---|---|---|---|
| `employee.state.changed` → 'blocked' | warning | "Employee {name} is blocked" |
| `employee.state.changed` → 'failed' | error | "Employee {name} failed" |
| `install.installed` | success | "Asset installed successfully" |
| `install.failed` | error | "Installation failed: {reason}" |
| `plan.completed` | success | "Task plan completed" |
| `error.occurred` (severity=high) | error | "Runtime error: {message}" |
| `hr.assessment.completed` | info | "HR assessment ready" |

Each mapping:
1. Listen for the source event
2. Extract relevant info from payload
3. Call `notificationCreated()` factory
4. Emit the notification event

The bridge should be activated during runtime initialization (in OrchestrationService or wherever the EventBus is set up).

- [ ] Step 1: Create NotificationBridge with event mappings
- [ ] Step 2: Add activation hook (can be called from OrchestrationService or app init)
- [ ] Step 3: Tests: emit source event → verify notification event is emitted
- [ ] Step 4: Export from core barrel
- [ ] Step 5: Commit

---

## Verification
- [ ] `pnpm run test --filter @aics/core` (all 389+ tests pass)
- [ ] `pnpm run typecheck --filter @aics/core`
- [ ] `pnpm run build --filter @aics/core`
