# Plan C: Core Runtime Gaps (HR Agent + Notification Center + Agency Lite)

> **For agentic workers:** Use superpowers:executing-plans to implement. Steps use checkbox syntax for tracking.
> **File ownership:** This plan touches `packages/core/src/agents/`, `packages/core/src/graph/`, `packages/core/src/templates/`, `packages/core/src/events/`, `packages/ui-office/src/components/notifications/` (new), `packages/ui-office/src/components/layout/`, `packages/shared-types/src/events.ts`. Does NOT touch apps/platform, apps/market, packages/renderer.

**Goal:** Fill the 3 largest PRD gaps in the runtime: HR Agent system node, Notification Center, and Agency Lite template.

**Tech Stack:** LangGraph.js, TypeScript, React 19, Tailwind CSS

---

## Task 1: HR Agent Node

**Files:**
- Create: `packages/core/src/agents/hr-node.ts`
- Modify: `packages/core/src/graph/main-graph.ts` (180 lines — add node + routing)
- Modify: `packages/core/src/graph/state.ts` (add hrDirective field)
- Modify: `packages/core/src/events/event-factories.ts` (add hr events)
- Modify: `packages/shared-types/src/events.ts` (add HR event payload types)
- Create: `packages/core/src/__tests__/hr-node.test.ts`

**Spec:**

PRD 2.4 requires HR to handle: 招聘、绩效追踪、岗位建议、入职管理、市场检索

HR Node responsibilities (1.0 scope — keep focused):
1. **Recruitment assessment**: When Manager routes a hiring intent, HR evaluates job requirements and suggests employee profiles
2. **Onboarding guidance**: When a new employee is installed/created, HR provides onboarding context
3. **Team composition advice**: When asked, HR analyzes current team and suggests gaps

HR Node placement in graph:
- Manager → HR (when `managerDirective.action === 'hire'` or `'assess_team'`)
- HR → Boss Summary (returns assessment result)
- HR does NOT execute tasks or call tools — it's an advisory node

Implementation pattern (follow existing node conventions from boss-node.ts):
```typescript
export async function hrNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) throw new GraphError('Missing runtimeCtx', 'hr');

  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'hr'));

  const { repos, modelResolver, eventBus } = runtimeCtx;
  const employees = await repos.employees.findByCompany(runtimeCtx.companyId);
  const resolved = modelResolver.resolve(null, 'hr');

  // Build HR-specific system prompt with team roster context
  // LLM call for assessment/recommendation
  // Return hrAssessment in state
}
```

Graph state addition:
```typescript
hrAssessment: Annotation<string | null>({ default: () => null, reducer: (_, v) => v }),
```

Routing in main-graph.ts:
- Add `routeFromManager()` case: when `managerDirective.action === 'hire'` → route to `'hr'`
- Add edge: `hr` → `boss_summary`

- [ ] Step 1: Add HrAssessment type and hrAssessment field to graph state
- [ ] Step 2: Add HR event types to shared-types/events.ts
- [ ] Step 3: Add HR event factory functions (hrAssessmentStarted, hrAssessmentCompleted, hrRecommendation)
- [ ] Step 4: Implement hr-node.ts following existing node pattern
- [ ] Step 5: Register HR node in main-graph.ts with routing from Manager
- [ ] Step 6: Tests: HR node receives hire intent → returns assessment; HR node receives team query → returns analysis
- [ ] Step 7: Commit

---

## Task 2: Notification System

**Files:**
- Create: `packages/ui-office/src/components/notifications/NotificationCenter.tsx`
- Create: `packages/ui-office/src/components/notifications/NotificationCard.tsx`
- Create: `packages/ui-office/src/hooks/useNotifications.ts`
- Modify: `packages/ui-office/src/components/layout/AppLayout.tsx` (integrate notification bell)
- Modify: `packages/ui-office/src/index.ts` (export new components)
- Modify: `packages/core/src/events/event-factories.ts` (add notification factories)
- Modify: `packages/shared-types/src/events.ts` (add notification payload types)

**Spec:**

PRD 2.6 requires: "本地事件 + 市场通知统一呈现"

Notification vs EventLog distinction:
- EventLog = debug tool showing ALL internal events (for developers)
- NotificationCenter = user-facing tool showing actionable/important notifications

Notification types:
```typescript
export interface NotificationPayload {
  notificationId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  source: 'runtime' | 'market' | 'install' | 'hr';
  actionUrl?: string;      // optional deep link
  employeeId?: string;     // optional association
  dismissable: boolean;
  timestamp: number;
}
```

Event mapping rules (which runtime events generate user notifications):
- `employee.state.changed` to 'blocked' or 'failed' → warning notification
- `install.installed` → success notification ("Employee X installed successfully")
- `install.failed` → error notification
- `plan.completed` → success notification
- `error.occurred` with severity 'high' → error notification
- HR assessment completed → info notification

useNotifications hook:
- Subscribe to `notification.` prefix on EventBus
- Maintain notification queue (max 50, FIFO eviction)
- Track read/unread state
- Expose: `notifications`, `unreadCount`, `markRead(id)`, `dismiss(id)`, `clearAll()`

NotificationCenter UI:
- Bell icon in header with unread badge count
- Dropdown panel (not full-page overlay) showing recent notifications
- Each NotificationCard: level icon + title + message + timestamp + dismiss button
- Click notification → if has employeeId, emit `ui.employee.focused` event
- "Clear all" button at bottom

- [ ] Step 1: Add NotificationPayload type to shared-types/events.ts
- [ ] Step 2: Add notification event factories (notificationCreated, notificationDismissed)
- [ ] Step 3: Add notification emission to key existing event handlers in event-factories.ts
- [ ] Step 4: Create useNotifications hook
- [ ] Step 5: Create NotificationCard component
- [ ] Step 6: Create NotificationCenter dropdown component
- [ ] Step 7: Integrate notification bell icon into AppLayout header
- [ ] Step 8: Export from ui-office barrel
- [ ] Step 9: Commit

---

## Task 3: Agency Lite Template

**Files:**
- Create: `packages/core/src/templates/agency-lite.ts`
- Modify: `packages/core/src/templates/index.ts` (register template)
- Create: `packages/core/src/__tests__/agency-lite-template.test.ts`

**Spec:**

PRD 4.2: Agency Lite — 客户沟通、交付、模板化 SOP. Target: 自由职业者/小型工作室.

Follow existing template pattern (reference: content-studio.ts, 153 lines):

Team composition (4-5 employees):
1. **Client Manager** (role_slug: 'manager') — client communication, project scoping, status updates
2. **Project Coordinator** (role_slug: 'pm') — task breakdown, timeline management, deliverable tracking
3. **Creative Lead** (role_slug: 'designer') — visual design, brand guidelines, creative direction
4. **Developer** (role_slug: 'developer') — implementation, code delivery, technical solutions
5. **QA Reviewer** (role_slug: 'reviewer') — quality assurance, deliverable review, client-ready polishing

Each employee needs:
- `persona_json`: JSON with personality, expertise areas, communication style, and `characterConfig` for puppet rendering (skinColor, hairColor, hairStyle, clothingColor, bodyType, gender)
- `config_json`: JSON with LLM temperature (0.6-0.8 for agency work), max_tokens
- Distinct character appearances for visual diversity

SOPs to include:
1. "Client Brief Intake" — structured client requirement gathering
2. "Deliverable Review" — quality check before client handoff

Layout preset: `'agency'` (3 zones: CLIENT, CREATIVE, DELIVERY)

- [ ] Step 1: Create agency-lite.ts with 5 employees + 2 SOPs
- [ ] Step 2: Register in templates/index.ts
- [ ] Step 3: Test: template loads correctly, all employees have valid configs
- [ ] Step 4: Commit

---

## Verification

- [ ] `pnpm run build` passes for packages/core, packages/shared-types, packages/ui-office
- [ ] `pnpm run typecheck` passes for all modified packages
- [ ] `pnpm run test` passes for packages/core (existing 373+ tests + new HR/template tests)
- [ ] HR node integrates into graph without breaking existing routing
- [ ] Notification bell shows in AppLayout header
- [ ] Agency Lite template appears in template list alongside existing 3 templates
