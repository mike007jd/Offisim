# P2 Deep Collaboration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add meeting action-item extraction, explicit employee handoff via Command pattern, and 3-layer agent memory (employee/team/company) with self-managed tools.

**Architecture:** Three independent subsystems built on shared event types and graph state additions. Phase 0 lays foundation (events, state, status fix). A (meeting actions) and B (handoff) develop in parallel on different files. C (memory) builds on B's employee-node tool injection changes.

**Tech Stack:** LangGraph `Command` class, Zod dynamic schemas, SQLite FTS5 with LIKE fallback, prompt-based JSON extraction (no `withStructuredOutput` — AICS uses own LlmGateway).

---

## Chunk 0: Foundation (shared-types + graph state + status fix)

### Task 0.1: Add new event types to shared-types

**Files:**
- Modify: `packages/shared-types/src/events.ts` (lines 25-54 for EventFamily, append new payload interfaces after line 251)
- Modify: `packages/shared-types/src/index.ts` (lines 24-53 for exports)

- [ ] **Step 1: Add 5 new EventFamily entries**

In `packages/shared-types/src/events.ts`, add to the `EventFamily` union type (after line 54):

```typescript
// After existing entries in EventFamily union:
  | 'meeting.action.created'
  | 'handoff.initiated'
  | 'handoff.completed'
  | 'memory.created'
  | 'memory.accessed'
```

- [ ] **Step 2: Add 5 new payload interfaces**

Append after `DirectChatCompletedPayload` (after line 251):

```typescript
export interface MeetingActionCreatedPayload {
  meetingId: string;
  actionItemId: string;
  description: string;
  assigneeEmployeeId: string;
  priority: 'high' | 'medium' | 'low';
  dependsOn: string[];
}

export interface HandoffInitiatedPayload {
  handoffId: string;
  threadId: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  reason: string;
  taskRunId: string;
}

export interface HandoffCompletedPayload {
  handoffId: string;
  toEmployeeId: string;
  taskRunId: string;
}

export interface MemoryCreatedPayload {
  memoryId: string;
  employeeId: string;
  scope: 'employee' | 'team' | 'company';
  category: 'experience' | 'decision' | 'knowledge' | 'preference';
  contentPreview: string;
}

export interface MemoryAccessedPayload {
  memoryId: string;
  employeeId: string;
  query: string;
}
```

- [ ] **Step 3: Export new interfaces from index.ts**

Add to `packages/shared-types/src/index.ts` export block:

```typescript
export type {
  MeetingActionCreatedPayload,
  HandoffInitiatedPayload,
  HandoffCompletedPayload,
  MemoryCreatedPayload,
  MemoryAccessedPayload,
} from './events.js';
```

- [ ] **Step 4: Build shared-types and verify**

Run: `pnpm --filter @aics/shared-types build`
Expected: Success, no type errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/events.ts packages/shared-types/src/index.ts
git commit -m "feat(shared-types): add P2 event types — meeting actions, handoff, memory"
```

### Task 0.2: Add event factory functions

**Files:**
- Modify: `packages/core/src/events/event-factories.ts` (append after line 531)
- Modify: `packages/core/src/index.ts` (add exports)

- [ ] **Step 1: Write test for new factories**

Create test cases in `packages/core/src/__tests__/unit/event-factories.test.ts` (append to existing file):

```typescript
describe('P2 event factories', () => {
  it('meetingActionCreated produces correct event', () => {
    const e = meetingActionCreated('co-1', 'mtg-1', 'tr-1', 'Implement auth', 'emp-bob', 'high', ['tr-0']);
    expect(e.type).toBe('meeting.action.created');
    expect(e.entityType).toBe('task');
    expect(e.payload.meetingId).toBe('mtg-1');
    expect(e.payload.assigneeEmployeeId).toBe('emp-bob');
    expect(e.payload.dependsOn).toEqual(['tr-0']);
  });

  it('handoffInitiated produces correct event', () => {
    const e = handoffInitiated('co-1', 'ho-1', 'th-1', 'emp-a', 'emp-b', 'needs expertise', 'tr-1');
    expect(e.type).toBe('handoff.initiated');
    expect(e.payload.fromEmployeeId).toBe('emp-a');
    expect(e.payload.toEmployeeId).toBe('emp-b');
  });

  it('handoffCompleted produces correct event', () => {
    const e = handoffCompleted('co-1', 'ho-1', 'emp-b', 'tr-1', 'th-1');
    expect(e.type).toBe('handoff.completed');
    expect(e.payload.toEmployeeId).toBe('emp-b');
  });

  it('memoryCreated produces correct event', () => {
    const e = memoryCreated('co-1', 'mem-1', 'emp-bob', 'employee', 'experience', 'JWT is better', 'th-1');
    expect(e.type).toBe('memory.created');
    expect(e.payload.scope).toBe('employee');
  });

  it('memoryAccessed produces correct event', () => {
    const e = memoryAccessed('co-1', 'mem-1', 'emp-bob', 'auth patterns', 'th-1');
    expect(e.type).toBe('memory.accessed');
    expect(e.payload.query).toBe('auth patterns');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aics/core test -- --run -t "P2 event factories"`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement 5 factory functions**

Append to `packages/core/src/events/event-factories.ts` (after last function ~line 531):

```typescript
export function meetingActionCreated(
  companyId: string,
  meetingId: string,
  actionItemId: string,
  description: string,
  assigneeEmployeeId: string,
  priority: 'high' | 'medium' | 'low',
  dependsOn: string[],
): RuntimeEvent<MeetingActionCreatedPayload> {
  return {
    type: 'meeting.action.created',
    entityId: actionItemId,
    entityType: 'task',
    companyId,
    threadId: '',
    timestamp: Date.now(),
    payload: { meetingId, actionItemId, description, assigneeEmployeeId, priority, dependsOn },
  };
}

export function handoffInitiated(
  companyId: string,
  handoffId: string,
  threadId: string,
  fromEmployeeId: string,
  toEmployeeId: string,
  reason: string,
  taskRunId: string,
): RuntimeEvent<HandoffInitiatedPayload> {
  return {
    type: 'handoff.initiated',
    entityId: handoffId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { handoffId, threadId, fromEmployeeId, toEmployeeId, reason, taskRunId },
  };
}

export function handoffCompleted(
  companyId: string,
  handoffId: string,
  toEmployeeId: string,
  taskRunId: string,
  threadId: string,
): RuntimeEvent<HandoffCompletedPayload> {
  return {
    type: 'handoff.completed',
    entityId: handoffId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { handoffId, toEmployeeId, taskRunId },
  };
}

export function memoryCreated(
  companyId: string,
  memoryId: string,
  employeeId: string,
  scope: 'employee' | 'team' | 'company',
  category: 'experience' | 'decision' | 'knowledge' | 'preference',
  contentPreview: string,
  threadId: string,
): RuntimeEvent<MemoryCreatedPayload> {
  return {
    type: 'memory.created',
    entityId: memoryId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { memoryId, employeeId, scope, category, contentPreview },
  };
}

export function memoryAccessed(
  companyId: string,
  memoryId: string,
  employeeId: string,
  query: string,
  threadId: string,
): RuntimeEvent<MemoryAccessedPayload> {
  return {
    type: 'memory.accessed',
    entityId: memoryId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { memoryId, employeeId, query },
  };
}
```

- [ ] **Step 4: Export from core index.ts**

Add to `packages/core/src/index.ts` event-factories export section (~line 95-124):

```typescript
export {
  meetingActionCreated,
  handoffInitiated,
  handoffCompleted,
  memoryCreated,
  memoryAccessed,
} from './events/event-factories.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @aics/core test -- --run -t "P2 event factories"`
Expected: PASS (5 new tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/events/event-factories.ts packages/core/src/index.ts packages/core/src/__tests__/unit/event-factories.test.ts
git commit -m "feat(core): add P2 event factories — meeting actions, handoff, memory"
```

### Task 0.3: Add graph state fields

**Files:**
- Modify: `packages/core/src/graph/state.ts` (after line 130, before the closing of AicsGraphAnnotation)

- [ ] **Step 1: Add `handoffCount` and `meetingActionItems` to AicsGraphAnnotation**

In `packages/core/src/graph/state.ts`, add after `currentStepOutputs` field (after line 130):

```typescript
  // P2: Handoff guard rail counter (last-write-wins, only employeeNode writes this)
  handoffCount: Annotation<number>({
    default: () => 0,
    reducer: (_, b) => b,  // explicit last-write-wins
  }),

  // P2: Meeting action items populated by meetingEndNode, read by bossSummaryNode
  meetingActionItems: Annotation<MeetingActionItem[]>({
    default: () => [],
    reducer: (_, b) => b,
  }),
```

Also add the `MeetingActionItem` type before `AicsGraphAnnotation`:

```typescript
export interface MeetingActionItem {
  taskRunId: string;
  description: string;
  assigneeEmployeeId: string;
  assigneeName: string;
  priority: 'high' | 'medium' | 'low';
  dependsOn: string[];
}
```

- [ ] **Step 2: Build core and verify types**

Run: `pnpm --filter @aics/core build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/graph/state.ts
git commit -m "feat(core): add handoffCount + meetingActionItems to graph state"
```

### Task 0.4: Fix status constraint mismatches

**Files:**
- Modify: `packages/core/src/graph/meeting-subgraph.ts` (~line 63 and ~line 245)
- Modify: `packages/core/src/agents/employee-node.ts` (~line 58-63)

- [ ] **Step 1: Find and fix meeting status values**

In `packages/core/src/graph/meeting-subgraph.ts`:
- Replace `'active'` with `'running'` (where meeting status is set)
- Replace `'ended'` with `'completed'` (where meeting status is updated)

- [ ] **Step 2: Find and fix task_runs status values**

In `packages/core/src/agents/employee-node.ts`:
- Replace `'active'` with `'running'` in `updateStatus()` calls (task run status)

Also check `packages/core/src/agents/pm-planner-node.ts` and `step-dispatcher-node.ts` for any `'active'` status usage.

- [ ] **Step 3: Run all tests to verify no regressions**

Run: `pnpm --filter @aics/core test`
Expected: All 177+ tests pass (some tests may use 'active'/'ended' in mock assertions — fix those too)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/graph/meeting-subgraph.ts packages/core/src/agents/employee-node.ts
git commit -m "fix(core): align status values to DB constraints — active→running, ended→completed"
```

### Task 0.5: Full validation

- [ ] **Step 1: Run typecheck + all tests + build**

```bash
pnpm turbo run typecheck
pnpm --filter @aics/core test
pnpm --filter @aics/web test
pnpm --filter @aics/web build
```

Expected: All pass. If failures, fix before proceeding.

- [ ] **Step 2: Tag Phase 0**

```bash
git tag phase-2.0-p2-foundation
```

---

## Chunk A: Meeting Action-Item Extraction

**Depends on:** Chunk 0 complete
**Parallel with:** Chunk B

### Task A.1: meetingEndNode structured extraction

**Files:**
- Modify: `packages/core/src/graph/meeting-subgraph.ts` (meetingEndNode function, ~lines 214-255)

- [ ] **Step 1: Write failing test for action item extraction**

Create `packages/core/src/__tests__/unit/meeting-action-extraction.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { meetingEndNode } from '../../graph/meeting-subgraph.js';
import { createTestRuntime } from '../helpers/test-runtime.js';
import { MockLlmGateway } from '../helpers/mock-llm-gateway.js';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { AicsGraphState } from '../../graph/state.js';

describe('meetingEndNode action item extraction', () => {
  it('extracts action items from meeting transcript', async () => {
    const { runtime, mockLlm } = createTestRuntime();

    // Seed employees
    await runtime.repos.employees.create({
      employee_id: 'emp-bob', company_id: 'co-1', name: 'Bob',
      role_slug: 'developer', enabled: true,
    });
    await runtime.repos.employees.create({
      employee_id: 'emp-alice', company_id: 'co-1', name: 'Alice',
      role_slug: 'tester', enabled: true,
    });

    // Create meeting record
    await runtime.repos.meetings.create({
      meeting_id: 'mtg-1', company_id: 'co-1', thread_id: 'th-1',
      topic: 'Sprint planning', status: 'running',
    });

    // Mock LLM returns structured JSON
    mockLlm.pushResponse(JSON.stringify({
      summary: 'Team agreed on auth module priority.',
      actionItems: [
        { description: 'Implement JWT auth', assigneeId: 'emp-bob', priority: 'high', dependsOnIndex: [] },
        { description: 'Write auth tests', assigneeId: 'emp-alice', priority: 'medium', dependsOnIndex: [0] },
      ],
      decisions: ['Use JWT over sessions'],
    }));

    const state: Partial<AicsGraphState> = {
      threadId: 'th-1',
      companyId: 'co-1',
      meetingId: 'mtg-1',
      messages: [
        new HumanMessage('Let us plan the sprint'),
        new AIMessage('[Bob]: I can handle auth implementation'),
        new AIMessage('[Alice]: I will write the tests after Bob is done'),
      ],
      pendingAssignments: [],
      meetingActionItems: [],
    };

    const result = await meetingEndNode(state as AicsGraphState, {
      configurable: { runtimeCtx: runtime },
    });

    // Verify action items in state
    expect(result.meetingActionItems).toHaveLength(2);
    expect(result.meetingActionItems![0].assigneeEmployeeId).toBe('emp-bob');
    expect(result.meetingActionItems![0].priority).toBe('high');
    expect(result.meetingActionItems![1].dependsOn).toHaveLength(1);

    // Verify TaskRuns created
    const taskRuns = await runtime.repos.taskRuns.findByThread('th-1');
    const meetingActions = taskRuns.filter(t => t.task_type === 'meeting_action');
    expect(meetingActions).toHaveLength(2);
    expect(meetingActions[0].status).toBe('queued');
  });

  it('falls back gracefully when LLM returns invalid JSON', async () => {
    const { runtime, mockLlm } = createTestRuntime();
    await runtime.repos.meetings.create({
      meeting_id: 'mtg-2', company_id: 'co-1', thread_id: 'th-2',
      topic: 'Retro', status: 'running',
    });

    mockLlm.pushResponse('This is not JSON at all');

    const state: Partial<AicsGraphState> = {
      threadId: 'th-2', companyId: 'co-1', meetingId: 'mtg-2',
      messages: [new HumanMessage('Retro time')],
      pendingAssignments: [], meetingActionItems: [],
    };

    const result = await meetingEndNode(state as AicsGraphState, {
      configurable: { runtimeCtx: runtime },
    });

    // Should not crash, meetingActionItems empty
    expect(result.meetingActionItems).toEqual([]);
    // Meeting status should still be updated
    const meeting = await runtime.repos.meetings.findById('mtg-2');
    expect(meeting?.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aics/core test -- --run -t "meetingEndNode action item"`
Expected: FAIL

- [ ] **Step 3: Implement meetingEndNode extraction logic**

Modify `packages/core/src/graph/meeting-subgraph.ts` — replace the meetingEndNode function body. Key changes:
1. Query employees for dynamic Zod schema
2. Build extraction prompt with employee list
3. Call `runtimeCtx.llmGateway.chat()` with structured prompt
4. Parse JSON + validate with Zod, fallback to empty on failure
5. Create TaskRuns for each action item
6. Map `dependsOnIndex` to taskRunIds
7. Emit `meetingActionCreated` events
8. Return `meetingActionItems` in state update

The extraction prompt should list available employees with IDs and roles, and request JSON matching the `MeetingOutputSchema`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aics/core test -- --run -t "meetingEndNode action item"`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/graph/meeting-subgraph.ts packages/core/src/__tests__/unit/meeting-action-extraction.test.ts
git commit -m "feat(core): meeting action-item extraction in meetingEndNode"
```

### Task A.2: Boss summary reads meetingActionItems

**Files:**
- Modify: `packages/core/src/agents/boss-summary-node.ts` (~lines 80-98)

- [ ] **Step 1: Write failing test**

Add to existing `packages/core/src/__tests__/unit/boss-summary-node.test.ts` or create if not exists:

```typescript
it('includes meeting action items in summary when present', async () => {
  const { runtime, mockLlm } = createTestRuntime();
  mockLlm.pushResponse('Sprint planning complete.');

  const state: Partial<AicsGraphState> = {
    threadId: 'th-1', companyId: 'co-1',
    messages: [new HumanMessage('plan sprint'), new AIMessage('Meeting summary here')],
    currentStepOutputs: [],
    meetingActionItems: [
      { taskRunId: 'tr-1', description: 'Implement auth', assigneeEmployeeId: 'emp-bob', assigneeName: 'Bob', priority: 'high', dependsOn: [] },
      { taskRunId: 'tr-2', description: 'Write tests', assigneeEmployeeId: 'emp-alice', assigneeName: 'Alice', priority: 'medium', dependsOn: ['tr-1'] },
    ],
  };

  const result = await bossSummaryNode(state as AicsGraphState, {
    configurable: { runtimeCtx: runtime },
  });

  const lastMsg = result.messages?.[result.messages.length - 1];
  const content = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
  expect(content).toContain('action item');
  expect(content).toContain('Bob');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aics/core test -- --run -t "meeting action items in summary"`
Expected: FAIL

- [ ] **Step 3: Implement — append action items text in bossSummaryNode**

In `packages/core/src/agents/boss-summary-node.ts`, after the LLM summary generation, check `state.meetingActionItems`. If non-empty, append a formatted section:

```typescript
// After LLM summary content is finalized:
if (state.meetingActionItems && state.meetingActionItems.length > 0) {
  const actionText = state.meetingActionItems
    .map(a => `- [${a.priority}] ${a.assigneeName} — ${a.description}`)
    .join('\n');
  finalContent += `\n\n**Action items (${state.meetingActionItems.length}):**\n${actionText}`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @aics/core test`
Expected: All pass including new test

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/boss-summary-node.ts packages/core/src/__tests__/unit/boss-summary-node.test.ts
git commit -m "feat(core): boss summary includes meeting action items"
```

### Task A.3: Integration test — full meeting → action items flow

**Files:**
- Modify: `packages/core/src/__tests__/integration/meeting-flow.test.ts` (add new test case)

- [ ] **Step 1: Add integration test**

Append to existing meeting-flow.test.ts:

```typescript
it('meeting produces action items that appear in boss summary', async () => {
  // Setup: company with 2 employees, mock LLM sequence:
  // 1. boss: routeDecision = 'start_meeting'
  // 2. meetingStart: creates meeting
  // 3. participant turns (2 rounds)
  // 4. meetingEnd: extracts action items JSON
  // 5. bossSummary: includes action items text
  // Verify: TaskRuns created, events emitted, summary contains action text
});
```

- [ ] **Step 2: Run and verify**

Run: `pnpm --filter @aics/core test -- --run -t "meeting produces action items"`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/integration/meeting-flow.test.ts
git commit -m "test(core): integration test for meeting action-item extraction"
```

---

## Chunk B: Explicit Handoff via Command Pattern

**Depends on:** Chunk 0 complete
**Parallel with:** Chunk A

### Task B.1: Handoff tool definition + detection in employee-node

**Files:**
- Modify: `packages/core/src/agents/employee-node.ts`

- [ ] **Step 1: Write failing test for handoff tool call**

Create `packages/core/src/__tests__/unit/employee-handoff.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { employeeNode } from '../../agents/employee-node.js';
import { createTestRuntime } from '../helpers/test-runtime.js';
import { HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import type { AicsGraphState } from '../../graph/state.js';

describe('employee handoff', () => {
  it('returns Command when LLM calls handoff_to tool', async () => {
    const { runtime, mockLlm } = createTestRuntime();

    // Seed two employees
    await runtime.repos.employees.create({
      employee_id: 'emp-a', company_id: 'co-1', name: 'Alice',
      role_slug: 'developer', enabled: true,
    });
    await runtime.repos.employees.create({
      employee_id: 'emp-b', company_id: 'co-1', name: 'Bob',
      role_slug: 'designer', enabled: true,
    });

    // Create task run
    await runtime.repos.taskRuns.create({
      task_run_id: 'tr-1', thread_id: 'th-1', employee_id: 'emp-a',
      task_type: 'coding', status: 'queued',
      input_json: JSON.stringify({ description: 'Build UI' }),
    });

    // Mock LLM returns tool call for handoff_to
    mockLlm.pushResponse({
      content: '',
      toolCalls: [{
        id: 'tc-1',
        name: 'handoff_to',
        args: {
          targetEmployeeId: 'emp-b',
          reason: 'This needs design expertise',
          completedWork: 'I set up the component skeleton',
          remainingWork: 'Design the visual layout',
        },
      }],
    });

    const state: Partial<AicsGraphState> = {
      threadId: 'th-1', companyId: 'co-1', entryMode: 'boss_chat',
      messages: [new HumanMessage('Build the settings page')],
      pendingAssignments: [{
        taskType: 'coding',
        employeeId: 'emp-a',
        inputJson: { description: 'Build UI', taskRunId: 'tr-1' },
      }],
      handoffCount: 0,
      currentStepOutputs: [],
    };

    const result = await employeeNode(state as AicsGraphState, {
      configurable: { runtimeCtx: runtime },
    });

    // Should return Command, not plain state
    expect(result).toBeInstanceOf(Command);
    // Verify handoff_events table was written
    const handoffs = await runtime.repos.handoffs.findByThread('th-1');
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].to_employee_id).toBe('emp-b');
  });

  it('does not inject handoff_to in direct_chat mode', async () => {
    const { runtime, mockLlm } = createTestRuntime();

    await runtime.repos.employees.create({
      employee_id: 'emp-a', company_id: 'co-1', name: 'Alice',
      role_slug: 'developer', enabled: true,
    });

    mockLlm.pushResponse('Here is my answer');

    const state: Partial<AicsGraphState> = {
      threadId: 'th-1', companyId: 'co-1', entryMode: 'direct_chat',
      messages: [new HumanMessage('Hello')],
      pendingAssignments: [{
        taskType: 'direct_chat',
        employeeId: 'emp-a',
        inputJson: { description: 'Hello', taskRunId: 'tr-dc-1' },
      }],
      handoffCount: 0,
      currentStepOutputs: [],
    };

    await employeeNode(state as AicsGraphState, {
      configurable: { runtimeCtx: runtime },
    });

    // Verify the LLM was NOT given handoff_to tool
    const lastCall = mockLlm.getLastCallArgs();
    const toolNames = (lastCall?.tools ?? []).map((t: any) => t.name);
    expect(toolNames).not.toContain('handoff_to');
  });

  it('blocks handoff when handoffCount >= 3', async () => {
    const { runtime, mockLlm } = createTestRuntime();

    await runtime.repos.employees.create({
      employee_id: 'emp-a', company_id: 'co-1', name: 'Alice',
      role_slug: 'developer', enabled: true,
    });
    await runtime.repos.employees.create({
      employee_id: 'emp-b', company_id: 'co-1', name: 'Bob',
      role_slug: 'designer', enabled: true,
    });

    mockLlm.pushResponse('I will do the work myself');

    const state: Partial<AicsGraphState> = {
      threadId: 'th-1', companyId: 'co-1', entryMode: 'boss_chat',
      messages: [new HumanMessage('Do something')],
      pendingAssignments: [{
        taskType: 'coding',
        employeeId: 'emp-a',
        inputJson: { description: 'task', taskRunId: 'tr-1' },
      }],
      handoffCount: 3,  // already at max
      currentStepOutputs: [],
    };

    await employeeNode(state as AicsGraphState, {
      configurable: { runtimeCtx: runtime },
    });

    const lastCall = mockLlm.getLastCallArgs();
    const toolNames = (lastCall?.tools ?? []).map((t: any) => t.name);
    expect(toolNames).not.toContain('handoff_to');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aics/core test -- --run -t "employee handoff"`
Expected: FAIL

- [ ] **Step 3: Implement handoff logic in employee-node**

Modify `packages/core/src/agents/employee-node.ts`:

1. Change return type to `Promise<Partial<AicsGraphState> | Command>`
2. Import `Command` from `@langchain/langgraph`
3. Before the LLM call, build the virtual tools array:
   - Query colleagues (employees in same company, excluding current)
   - If `entryMode !== 'direct_chat'` AND `handoffCount < 3` AND `colleagues.length > 0`: add `handoff_to` tool spec
   - Combine with MCP tools from `toolExecutor.listAvailable()`
4. Pass `tools` to `recordedLlmCall` (the `LlmRequest.tools` field already exists in gateway.ts)
5. In the tool-calling loop, check if tool call name is `handoff_to`:
   - If yes: create handoff_events record, emit handoffInitiated event, create new TaskRun for receiving employee, return `new Command({ goto: 'employee', update: { pendingAssignments: [...], handoffCount: state.handoffCount + 1 } })`
   - If no: delegate to toolExecutor as before

- [ ] **Step 4: Update MockLlmGateway if needed**

Ensure `MockLlmGateway` can return `toolCalls` in responses. Check `packages/core/src/__tests__/helpers/mock-llm-gateway.ts` — if `pushResponse` doesn't support toolCalls, add a `pushToolCallResponse(content, toolCalls)` method.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @aics/core test -- --run -t "employee handoff"`
Expected: PASS (3 tests)

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `pnpm --filter @aics/core test`
Expected: All existing tests still pass (employeeNode return type widened but plain objects still valid)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agents/employee-node.ts packages/core/src/__tests__/unit/employee-handoff.test.ts
git commit -m "feat(core): employee handoff via Command pattern + handoff_to tool"
```

### Task B.2: Integration test — handoff end-to-end

**Files:**
- Create: `packages/core/src/__tests__/integration/handoff-flow.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, expect, it } from 'vitest';
import { buildAicsGraph } from '../../graph/main-graph.js';
import { createTestRuntime } from '../helpers/test-runtime.js';
import { HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

describe('handoff integration', () => {
  it('employee A hands off to employee B who completes the task', async () => {
    const { runtime, mockLlm } = createTestRuntime();

    // Seed: boss, manager, pm + 2 employees
    // ... seed data ...

    // Mock LLM sequence:
    // 1. boss → delegate_manager
    // 2. manager → assigns emp-a
    // 3. pm → 1-step plan
    // 4. step_dispatcher → assigns emp-a
    // 5. emp-a → calls handoff_to(emp-b)
    // 6. emp-b → completes task
    // 7. boss_summary → final output

    const graph = buildAicsGraph();
    const compiled = graph.compile({ checkpointer: new MemorySaver() });

    const result = await compiled.invoke(
      { messages: [new HumanMessage('Design the logo')], companyId: 'co-1', threadId: 'th-1', entryMode: 'boss_chat' },
      { configurable: { thread_id: 'th-1', runtimeCtx: runtime } },
    );

    // Verify: handoff event emitted, both employees have task runs
    const handoffs = await runtime.repos.handoffs.findByThread('th-1');
    expect(handoffs).toHaveLength(1);

    const events = runtime.eventBus.getEmitted('handoff.initiated');
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and iterate until passing**
- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/integration/handoff-flow.test.ts
git commit -m "test(core): integration test for employee handoff flow"
```

---

## Chunk C: 3-Layer Agent Memory

**Depends on:** Chunk 0 + Chunk B (employee-node tool injection mechanism)

### Task C.1: Database migration + Drizzle schema

**Files:**
- Create: `packages/db-local/src/migrations/005_memory_system.sql`
- Modify: `packages/db-local/src/schema.ts` (add memoryEntries table definition)

- [ ] **Step 1: Create migration file**

```sql
-- 005_memory_system.sql
CREATE TABLE memory_entries (
  memory_id         TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  scope             TEXT NOT NULL CHECK(scope IN ('employee', 'team', 'company')),
  owner_id          TEXT NOT NULL,
  category          TEXT NOT NULL CHECK(category IN ('experience', 'decision', 'knowledge', 'preference')),
  content           TEXT NOT NULL,
  importance        REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
  source_thread_id  TEXT,
  source_task_run_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  access_count      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_memory_scope_owner ON memory_entries(scope, owner_id);
CREATE INDEX idx_memory_company ON memory_entries(company_id);
CREATE INDEX idx_memory_importance ON memory_entries(importance DESC);
```

Note: FTS5 virtual table + triggers are created at runtime via probe (see Task C.2).

- [ ] **Step 2: Add Drizzle schema**

In `packages/db-local/src/schema.ts`, add after existing table definitions:

```typescript
export const memoryEntries = sqliteTable('memory_entries', {
  memory_id: text('memory_id').primaryKey(),
  company_id: text('company_id').notNull(),
  scope: text('scope').notNull(),  // 'employee' | 'team' | 'company'
  owner_id: text('owner_id').notNull(),
  category: text('category').notNull(),  // 'experience' | 'decision' | 'knowledge' | 'preference'
  content: text('content').notNull(),
  importance: real('importance').notNull().default(0.5),
  source_thread_id: text('source_thread_id'),
  source_task_run_id: text('source_task_run_id'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  accessed_at: text('accessed_at').notNull().default(sql`(datetime('now'))`),
  access_count: integer('access_count').notNull().default(0),
});
```

- [ ] **Step 3: Build db-local**

Run: `pnpm --filter @aics/db-local build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add packages/db-local/src/migrations/005_memory_system.sql packages/db-local/src/schema.ts
git commit -m "feat(db-local): add memory_entries table + migration 005"
```

### Task C.2: MemoryRepository interface + memory implementation

**Files:**
- Modify: `packages/core/src/runtime/repositories.ts` (add MemoryRepository interface + add to RuntimeRepositories)
- Create: `packages/core/src/repositories/memory-memory-repository.ts` (in-memory implementation)
- Create: `packages/core/src/__tests__/unit/memory-repository.test.ts`

- [ ] **Step 1: Write failing tests for MemoryRepository**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryMemoryRepository } from '../../repositories/memory-memory-repository.js';

describe('InMemoryMemoryRepository', () => {
  let repo: InMemoryMemoryRepository;

  beforeEach(() => {
    repo = new InMemoryMemoryRepository();
  });

  it('creates and finds a memory entry', async () => {
    await repo.create({
      memory_id: 'mem-1', company_id: 'co-1', scope: 'employee',
      owner_id: 'emp-bob', category: 'experience',
      content: 'JWT tokens work better than sessions for auth',
      importance: 0.8,
    });
    const found = await repo.findById('mem-1');
    expect(found).not.toBeNull();
    expect(found!.content).toContain('JWT');
    expect(found!.importance).toBe(0.8);
  });

  it('searches by keyword (LIKE fallback)', async () => {
    await repo.create({
      memory_id: 'mem-1', company_id: 'co-1', scope: 'employee',
      owner_id: 'emp-bob', category: 'experience',
      content: 'JWT tokens work better than sessions',
      importance: 0.8,
    });
    await repo.create({
      memory_id: 'mem-2', company_id: 'co-1', scope: 'team',
      owner_id: 'co-1', category: 'decision',
      content: 'We decided to use PostgreSQL',
      importance: 0.6,
    });

    const results = await repo.search('JWT', { companyId: 'co-1' });
    expect(results).toHaveLength(1);
    expect(results[0].memory_id).toBe('mem-1');
  });

  it('filters by scope and owner', async () => {
    await repo.create({ memory_id: 'mem-1', company_id: 'co-1', scope: 'employee', owner_id: 'emp-bob', category: 'experience', content: 'Bob memory', importance: 0.5 });
    await repo.create({ memory_id: 'mem-2', company_id: 'co-1', scope: 'employee', owner_id: 'emp-alice', category: 'experience', content: 'Alice memory', importance: 0.5 });

    const results = await repo.search('memory', { companyId: 'co-1', scope: 'employee', ownerId: 'emp-bob' });
    expect(results).toHaveLength(1);
    expect(results[0].owner_id).toBe('emp-bob');
  });

  it('touchAccess increments access_count', async () => {
    await repo.create({ memory_id: 'mem-1', company_id: 'co-1', scope: 'employee', owner_id: 'emp-bob', category: 'knowledge', content: 'test', importance: 0.5 });
    await repo.touchAccess('mem-1');
    await repo.touchAccess('mem-1');
    const found = await repo.findById('mem-1');
    expect(found!.access_count).toBe(2);
  });

  it('deletes a memory entry', async () => {
    await repo.create({ memory_id: 'mem-1', company_id: 'co-1', scope: 'employee', owner_id: 'emp-bob', category: 'preference', content: 'test', importance: 0.3 });
    await repo.delete('mem-1');
    const found = await repo.findById('mem-1');
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — fail**
- [ ] **Step 3: Add MemoryRepository interface to repositories.ts**

```typescript
export interface MemoryRepository {
  create(entry: MemoryEntryCreate): Promise<MemoryEntry>;
  findById(memoryId: string): Promise<MemoryEntry | null>;
  search(query: string, opts: { scope?: string; ownerId?: string; companyId: string; limit?: number }): Promise<MemoryEntry[]>;
  update(memoryId: string, patch: Partial<MemoryEntryUpdate>): Promise<void>;
  delete(memoryId: string): Promise<void>;
  findByOwner(ownerId: string, opts?: { category?: string; limit?: number }): Promise<MemoryEntry[]>;
  touchAccess(memoryId: string): Promise<void>;
}
```

Add `memories: MemoryRepository` to `RuntimeRepositories` interface.

- [ ] **Step 4: Implement InMemoryMemoryRepository**
- [ ] **Step 5: Run tests — pass**
- [ ] **Step 6: Commit**

```bash
git add packages/core/src/runtime/repositories.ts packages/core/src/repositories/memory-memory-repository.ts packages/core/src/__tests__/unit/memory-repository.test.ts
git commit -m "feat(core): MemoryRepository interface + in-memory implementation"
```

### Task C.3: MemoryService (retrieval + reflection)

**Files:**
- Create: `packages/core/src/services/memory-service.ts`
- Create: `packages/core/src/__tests__/unit/memory-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('MemoryService', () => {
  it('getRelevantMemories merges employee + team + company memories', async () => {
    // Setup: create memories in all 3 scopes
    // Call getRelevantMemories
    // Verify: returns mixed results, sorted by importance * recency
  });

  it('reflectAndRemember creates memory from LLM extraction', async () => {
    // Setup: mock LLM returns JSON with memory to store
    // Call reflectAndRemember
    // Verify: memory_entries created via repo
  });

  it('reflectAndRemember skips when opts.skip is true', async () => {
    // Should not call LLM at all
  });
});
```

- [ ] **Step 2: Run — fail**
- [ ] **Step 3: Implement MemoryService**

Key methods:
- `getRelevantMemories()`: queries 3 scopes, merges, ranks by keyword match + importance + recency
- `reflectAndRemember()`: prompt-based JSON extraction (same pattern as meetingEndNode), creates entries

- [ ] **Step 4: Run — pass**
- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/memory-service.ts packages/core/src/__tests__/unit/memory-service.test.ts
git commit -m "feat(core): MemoryService — retrieval + reflection"
```

### Task C.4: Memory tools in employee-node

**Files:**
- Modify: `packages/core/src/agents/employee-node.ts` (extend virtual tools array)
- Modify: `packages/core/src/runtime/runtime-context.ts` (add memoryService)

- [ ] **Step 1: Write failing test**

Create `packages/core/src/__tests__/unit/employee-memory-tools.test.ts`:

```typescript
describe('employee memory tools', () => {
  it('injects remember/recall/forget tools alongside handoff_to', async () => {
    // Verify LLM receives all virtual tools
  });

  it('remember tool call creates memory entry', async () => {
    // Mock LLM calls remember tool
    // Verify memory created in repo
  });

  it('recall tool call searches and returns memories', async () => {
    // Pre-create memories, mock LLM calls recall
    // Verify search results returned as tool response
  });

  it('injects relevant memories into system prompt', async () => {
    // Pre-create memories for employee
    // Run employeeNode
    // Verify system prompt contains "## Your memories" section
  });
});
```

- [ ] **Step 2: Run — fail**
- [ ] **Step 3: Implement**

In `packages/core/src/agents/employee-node.ts`:
1. Add `memoryService` access from `runtimeCtx`
2. Before LLM call: `memoryService.getRelevantMemories()` → inject into system prompt
3. Add `remember`, `recall`, `forget` tool specs to `allTools` array
4. In tool-calling loop: detect memory tool calls, dispatch to MemoryService/MemoryRepository
5. After task completion: call `memoryService.reflectAndRemember()` (skip for direct_chat/handoff_continuation)

In `packages/core/src/runtime/runtime-context.ts`:
1. Add `memoryService: MemoryService` to RuntimeContext interface

- [ ] **Step 4: Update createTestRuntime helper**

Ensure test runtime includes `memoryService` (wrapping `InMemoryMemoryRepository`).

- [ ] **Step 5: Run — pass**
- [ ] **Step 6: Run full suite**

Run: `pnpm --filter @aics/core test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agents/employee-node.ts packages/core/src/runtime/runtime-context.ts packages/core/src/__tests__/unit/employee-memory-tools.test.ts
git commit -m "feat(core): memory tools (remember/recall/forget) in employee-node"
```

### Task C.5: Integration test — memory persistence across tasks

**Files:**
- Create: `packages/core/src/__tests__/integration/memory-flow.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
describe('memory integration', () => {
  it('employee remembers something in task 1, recalls it in task 2', async () => {
    // Run 1: employee calls remember('JWT is better', 'experience')
    // Run 2: same employee gets new task, memories injected in prompt
    // Verify: system prompt includes previous memory
  });
});
```

- [ ] **Step 2: Run and iterate**
- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/integration/memory-flow.test.ts
git commit -m "test(core): integration test for memory persistence across tasks"
```

### Task C.6: Final validation

- [ ] **Step 1: Full test suite**

```bash
pnpm turbo run typecheck
pnpm --filter @aics/core test
pnpm --filter @aics/web test
pnpm --filter @aics/web build
```

- [ ] **Step 2: Tag P2**

```bash
git tag phase-2.0-p2-deep-collaboration
git push && git push --tags
```

---

## Summary

| Chunk | Tasks | Tests | Parallel? |
|-------|-------|-------|-----------|
| 0: Foundation | 5 tasks | ~7 | Sequential (first) |
| A: Meeting actions | 3 tasks | ~5 | Parallel with B |
| B: Handoff | 2 tasks | ~5 | Parallel with A |
| C: Memory | 6 tasks | ~10 | After B |

**Total: 16 tasks, ~27 new tests, ~6 new files, ~9 modified files.**

**Merge order: 0 → (A ∥ B) → C → validation**
