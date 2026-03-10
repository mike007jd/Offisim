# Mega-Phase A: Core Execution Loop — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the core execution loop: Boss → Manager → PM (task DAG) → Employee (multi-step, real MCP tools) → Meeting → Boss Summary.

**Architecture:** Extend the existing LangGraph main graph with PM planner + step dispatcher nodes, wire MCP client into ToolExecutor, and integrate the existing meeting subgraph. All changes follow the current RuntimeContext injection pattern.

**Tech Stack:** LangGraph.js, `@modelcontextprotocol/sdk`, PixiJS + GSAP (renderer), React (UI)

**Baseline:** 296 tests (install-core 137, core 127, renderer 24, web 8). Tag: `phase-6.0-install-system`

---

## Track Layout & Conflict Avoidance

```
Bootstrap (Task 1-2): sequential — new types + state fields
  ↓
Track 1 (Task 3-7):  PM node + step_dispatcher + graph wiring
Track 2 (Task 8-11): MCP client + employee multi-round tools
Track 3 (Task 12-14): Meeting wiring + MeetingRoomEntity
Track 4 (Task 15-17): UI — PlanProgressPanel + MCP config
  ↓
Integration (Task 18): final wiring + full validation
```

**File ownership per track:**

| Track | Owns (create/primary modify) | Reads only |
|-------|------------------------------|------------|
| 1 | `core/src/agents/pm-planner-node.ts`, `core/src/agents/step-dispatcher-node.ts`, `core/src/graph/main-graph.ts` (PM/step edges), `core/src/graph/state.ts` (plan fields) | manager-node.ts, employee-node.ts |
| 2 | `core/src/mcp/` (new dir), `core/src/agents/employee-node.ts` (tool loop only) | tool-executor.ts |
| 3 | `core/src/graph/main-graph.ts` (meeting edges only — AFTER Track 1), `renderer/src/entities/meeting-room-entity.ts` | meeting-subgraph.ts |
| 4 | `apps/web/src/components/plan/`, `apps/web/src/components/settings/McpConfigPanel.tsx` | hooks, events |

**CRITICAL GIT RULE for all agents:** Do NOT run `git reset --hard`, `git checkout .`, or any destructive git command. Only `git add` + `git commit`.

---

### Task 1: Bootstrap — shared-types extensions

**Files:**
- Modify: `packages/shared-types/src/events.ts`
- Modify: `packages/shared-types/src/states.ts`
- Modify: `packages/shared-types/src/index.ts`

**Step 1: Add new event payloads to shared-types**

Add to `packages/shared-types/src/events.ts` after the `LlmStreamChunkPayload` block:

```typescript
// --- Mega-Phase A: Plan & MCP Events ---

export interface PlanCreatedPayload {
  readonly planId: string;
  readonly threadId: string;
  readonly steps: ReadonlyArray<{
    readonly stepIndex: number;
    readonly description: string;
    readonly taskCount: number;
  }>;
}

export interface PlanStepStartedPayload {
  readonly planId: string;
  readonly stepIndex: number;
  readonly taskCount: number;
}

export interface PlanStepCompletedPayload {
  readonly planId: string;
  readonly stepIndex: number;
  readonly outputCount: number;
}

export interface PlanCompletedPayload {
  readonly planId: string;
  readonly totalSteps: number;
}

export interface McpServerConnectedPayload {
  readonly serverName: string;
  readonly toolCount: number;
}

export interface McpToolCalledPayload {
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId: string;
}
```

Add to `EventFamily` union:
```typescript
  | 'plan.created'
  | 'plan.step.started'
  | 'plan.step.completed'
  | 'plan.completed'
  | 'mcp.server.connected'
  | 'mcp.tool.called'
```

Add `'plan'` to `RuntimeEntityType`:
```typescript
export type RuntimeEntityType = 'employee' | 'task' | 'meeting' | 'install' | 'report' | 'llm' | 'graph' | 'plan' | 'mcp';
```

**Step 2: Add 'planned' to TaskState**

In `packages/shared-types/src/states.ts`, add `'planned'` to TaskState (before `'created'`):
```typescript
export type TaskState =
  | 'planned'   // NEW — PM has planned but not yet dispatched
  | 'created'
  | 'routed'
  ...
```

**Step 3: Export new types from index**

In `packages/shared-types/src/index.ts`, ensure all new payload types are exported.

**Step 4: Build shared-types**

Run: `pnpm --filter @aics/shared-types build`
Expected: clean build, no errors

**Step 5: Commit**

```bash
git add packages/shared-types/
git commit -m "feat(shared-types): add plan and MCP event payloads for Mega-Phase A"
```

---

### Task 2: Bootstrap — graph state & event factories

**Files:**
- Modify: `packages/core/src/graph/state.ts`
- Modify: `packages/core/src/events/event-factories.ts`
- Modify: `packages/core/src/agents/manager-node.ts` (output change)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/unit/plan-event-factories.test.ts`

**Step 1: Add plan types and state fields to graph state**

In `packages/core/src/graph/state.ts`, add above the `AicsGraphAnnotation`:

```typescript
export interface PlanTask {
  taskType: string;
  employeeId: string;
  description: string;
  dependsOnStepOutput: boolean;
  taskRunId?: string;  // filled by PM when creating task_runs
}

export interface PlanStep {
  stepIndex: number;
  description: string;
  tasks: PlanTask[];
}

export interface TaskPlan {
  planId: string;
  threadId: string;
  companyId: string;
  steps: PlanStep[];
  summary: string;
}

export interface ManagerDirective {
  intent: string;
  recommendedEmployees: string[];
  constraints?: string;
}

export interface StepTaskOutput {
  employeeId: string;
  employeeName: string;
  content: string;
  taskRunId: string;
}

export interface StepResult {
  stepIndex: number;
  outputs: StepTaskOutput[];
}
```

Add new fields to `AicsGraphAnnotation`:

```typescript
  // Manager → PM directive
  managerDirective: Annotation<ManagerDirective | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // PM plan
  taskPlan: Annotation<TaskPlan | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  currentStepIndex: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  stepResults: Annotation<StepResult[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentStepOutputs: Annotation<StepTaskOutput[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
```

**Step 2: Add plan event factories**

In `packages/core/src/events/event-factories.ts`, add:

```typescript
import type {
  PlanCreatedPayload,
  PlanStepStartedPayload,
  PlanStepCompletedPayload,
  PlanCompletedPayload,
  McpServerConnectedPayload,
  McpToolCalledPayload,
} from '@aics/shared-types';

export function planCreated(
  companyId: string,
  planId: string,
  threadId: string,
  steps: PlanCreatedPayload['steps'],
): RuntimeEvent<PlanCreatedPayload> {
  return {
    type: 'plan.created',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, threadId, steps },
  };
}

export function planStepStarted(
  companyId: string,
  planId: string,
  stepIndex: number,
  taskCount: number,
  threadId?: string,
): RuntimeEvent<PlanStepStartedPayload> {
  return {
    type: 'plan.step.started',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, stepIndex, taskCount },
  };
}

export function planStepCompleted(
  companyId: string,
  planId: string,
  stepIndex: number,
  outputCount: number,
  threadId?: string,
): RuntimeEvent<PlanStepCompletedPayload> {
  return {
    type: 'plan.step.completed',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, stepIndex, outputCount },
  };
}

export function planCompleted(
  companyId: string,
  planId: string,
  totalSteps: number,
  threadId?: string,
): RuntimeEvent<PlanCompletedPayload> {
  return {
    type: 'plan.completed',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, totalSteps },
  };
}

export function mcpServerConnected(
  companyId: string,
  serverName: string,
  toolCount: number,
): RuntimeEvent<McpServerConnectedPayload> {
  return {
    type: 'mcp.server.connected',
    entityId: serverName,
    entityType: 'mcp',
    companyId,
    timestamp: Date.now(),
    payload: { serverName, toolCount },
  };
}

export function mcpToolCalled(
  companyId: string,
  serverName: string,
  toolName: string,
  employeeId: string,
  threadId?: string,
): RuntimeEvent<McpToolCalledPayload> {
  return {
    type: 'mcp.tool.called',
    entityId: `${serverName}/${toolName}`,
    entityType: 'mcp',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { serverName, toolName, employeeId },
  };
}
```

**Step 3: Modify manager-node.ts to output managerDirective**

Change `managerNode` to return `managerDirective` instead of `pendingAssignments`. Keep the LLM call and employee lookup, but instead of creating taskRuns and handoffs, output:

```typescript
return {
  managerDirective: {
    intent: userContent,
    recommendedEmployees: decision.assignments.map(a => a.employeeId),
    constraints: undefined,
  },
  // Also keep pendingAssignments populated as a fallback
  // for backward compat during transition
  pendingAssignments: pendingAssignments,
};
```

Note: During the transition, manager still creates pendingAssignments so existing tests don't break. PM node will eventually take over this responsibility. The fallback is removed in Task 5 when graph wiring is updated.

**Step 4: Write event factory tests**

Create `packages/core/src/__tests__/unit/plan-event-factories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { planCreated, planStepStarted, planStepCompleted, planCompleted, mcpServerConnected, mcpToolCalled } from '../../events/event-factories.js';

describe('plan event factories', () => {
  it('planCreated', () => {
    const e = planCreated('co1', 'plan-1', 'th-1', [{ stepIndex: 0, description: 'research', taskCount: 2 }]);
    expect(e.type).toBe('plan.created');
    expect(e.entityType).toBe('plan');
    expect(e.payload.planId).toBe('plan-1');
    expect(e.payload.steps).toHaveLength(1);
  });

  it('planStepStarted', () => {
    const e = planStepStarted('co1', 'plan-1', 0, 3);
    expect(e.type).toBe('plan.step.started');
    expect(e.payload.stepIndex).toBe(0);
    expect(e.payload.taskCount).toBe(3);
  });

  it('planStepCompleted', () => {
    const e = planStepCompleted('co1', 'plan-1', 0, 2);
    expect(e.type).toBe('plan.step.completed');
    expect(e.payload.outputCount).toBe(2);
  });

  it('planCompleted', () => {
    const e = planCompleted('co1', 'plan-1', 3);
    expect(e.type).toBe('plan.completed');
    expect(e.payload.totalSteps).toBe(3);
  });

  it('mcpServerConnected', () => {
    const e = mcpServerConnected('co1', 'fs-server', 5);
    expect(e.type).toBe('mcp.server.connected');
    expect(e.entityType).toBe('mcp');
    expect(e.payload.toolCount).toBe(5);
  });

  it('mcpToolCalled', () => {
    const e = mcpToolCalled('co1', 'fs-server', 'read_file', 'emp-1');
    expect(e.type).toBe('mcp.tool.called');
    expect(e.payload.serverName).toBe('fs-server');
  });
});
```

**Step 5: Update core/src/index.ts exports**

Add new exports for plan types and event factories.

**Step 6: Run tests + typecheck**

Run: `pnpm --filter @aics/core test && pnpm --filter @aics/core typecheck`
Expected: All tests pass including new event factory tests

**Step 7: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add plan/MCP state fields, event factories, manager directive output"
```

---

### Task 3: PM Planner Node (Track 1)

**Files:**
- Create: `packages/core/src/agents/pm-planner-node.ts`
- Test: `packages/core/src/__tests__/unit/pm-planner-node.test.ts`

**Step 1: Write PM planner node tests**

Test cases:
1. Generates a multi-step plan from manager directive
2. Creates taskRun records for each planned task (status: 'planned')
3. Emits planCreated event
4. Falls back to single-step plan when LLM response is unparseable
5. Returns empty plan (trivial) when directive has no recommended employees

**Step 2: Implement pm-planner-node.ts**

Key logic:
- Read `state.managerDirective`
- Fetch employee details from repos
- `recordedLlmCall()` with `PM_SYSTEM_PROMPT` asking for JSON `TaskPlan`
- Parse JSON response, validate structure
- Create `taskRun` records (status: `'planned'`) for each task
- Emit `planCreated` event
- Return `{ taskPlan, currentStepIndex: 0, stepResults: [], currentStepOutputs: [] }`

PM_SYSTEM_PROMPT:
```
You are the PM AI — responsible for breaking down work into structured execution plans.

Given the user's intent and available employees with their capabilities, create a step-by-step plan.

Respond with JSON only:
{
  "summary": "one sentence describing the overall plan",
  "steps": [
    {
      "stepIndex": 0,
      "description": "what this step accomplishes",
      "tasks": [
        {
          "taskType": "research" | "writing" | "analysis" | "review" | "code" | "general",
          "employeeId": "<employee_id>",
          "description": "specific instruction for the employee",
          "dependsOnStepOutput": false
        }
      ]
    }
  ]
}

Rules:
- Steps execute sequentially (step 0 finishes before step 1 starts)
- Tasks within a step execute in parallel
- Set dependsOnStepOutput: true when a task needs results from the previous step
- Assign tasks to the most appropriate employee
- Keep plans practical: 1-4 steps for most requests
```

**Step 3: Run tests**

Run: `pnpm --filter @aics/core test`
Expected: PM planner tests pass

**Step 4: Commit**

```bash
git add packages/core/src/agents/pm-planner-node.ts packages/core/src/__tests__/unit/pm-planner-node.test.ts
git commit -m "feat(core): add PM planner node with task DAG generation"
```

---

### Task 4: Step Dispatcher Node (Track 1)

**Files:**
- Create: `packages/core/src/agents/step-dispatcher-node.ts`
- Test: `packages/core/src/__tests__/unit/step-dispatcher-node.test.ts`

**Step 1: Write step dispatcher tests**

Test cases:
1. Dispatches first step tasks as pendingAssignments
2. Injects previousStepOutput when dependsOnStepOutput is true
3. Emits planStepStarted event
4. Updates taskRun status from 'planned' to 'queued'
5. Emits planStepCompleted + advances currentStepIndex on re-entry
6. Emits planCompleted when all steps are done

**Step 2: Implement step-dispatcher-node.ts**

Key logic:
```
stepDispatcherNode(state, config):
  plan = state.taskPlan
  stepIdx = state.currentStepIndex

  // If re-entering after a step completed, first finalize the previous step
  if (state.currentStepOutputs.length > 0 && stepIdx > 0) {
    // currentStepOutputs were collected by employee completions
    // They belong to the previous step (stepIdx - 1 was the last dispatched)
    // This is handled by the reducer — stepResults already has them
  }

  step = plan.steps[stepIdx]
  pendingAssignments = []

  for task in step.tasks:
    inputJson = { description: task.description, taskRunId: task.taskRunId }
    if task.dependsOnStepOutput && stepIdx > 0:
      inputJson.previousStepOutput = state.stepResults[stepIdx - 1]

    repos.taskRuns.updateStatus(task.taskRunId, 'queued')
    emit taskStateChanged('planned', 'queued')

    pendingAssignments.push({ taskType, employeeId, inputJson })

  emit planStepStarted(planId, stepIdx, step.tasks.length)

  return { pendingAssignments, currentStepOutputs: [] }
```

**Step 3: Run tests**

**Step 4: Commit**

```bash
git add packages/core/src/agents/step-dispatcher-node.ts packages/core/src/__tests__/unit/step-dispatcher-node.test.ts
git commit -m "feat(core): add step dispatcher node for plan execution"
```

---

### Task 5: Graph Wiring — PM + Step Dispatcher (Track 1)

**Files:**
- Modify: `packages/core/src/graph/main-graph.ts`
- Modify: `packages/core/src/agents/employee-node.ts` (append step output)
- Test: `packages/core/src/__tests__/integration/pm-flow.test.ts`

**Step 1: Write PM flow integration test**

Test the full path: boss → manager → pm_planner → step_dispatcher → employee(loop) → boss_summary.
Use MockLlmGateway with canned responses for each node.

Test cases:
1. Single-step plan: boss delegates → manager → PM creates 1-step plan → step_dispatcher → employee → boss_summary
2. Multi-step plan: PM creates 2-step plan → step 1 employees → step 2 employees (with previous output) → boss_summary
3. Trivial plan (empty steps): PM → directly to boss_summary
4. Events emitted in correct order: plan.created → plan.step.started → task.state.changed → plan.step.completed → plan.completed

**Step 2: Modify employee-node.ts to collect step outputs**

After employee completes (before the final return), append to `currentStepOutputs`:

```typescript
const stepOutput: StepTaskOutput = {
  employeeId: employee.employee_id,
  employeeName: employee.name,
  content: llmResponse.content,
  taskRunId: taskRunId ?? '',
};

return {
  currentEmployeeId: employee.employee_id,
  currentTaskRunId: taskRunId ?? null,
  pendingAssignments: remaining,
  currentStepOutputs: [...state.currentStepOutputs, stepOutput],
  messages: [new AIMessage({ content: `[${employee.name}]: ${llmResponse.content}` })],
};
```

**Step 3: Update main-graph.ts routing**

```typescript
// New imports
import { pmPlannerNode } from '../agents/pm-planner-node.js';
import { stepDispatcherNode } from '../agents/step-dispatcher-node.js';

// New routing functions
function routeFromPm(state: AicsGraphState): string {
  if (!state.taskPlan || state.taskPlan.steps.length === 0) {
    return 'boss_summary';
  }
  return 'step_dispatcher';
}

function routeFromEmployee(state: AicsGraphState): string {
  if (state.interruptReason) return 'error_handler';
  if (state.pendingAssignments.length > 0) return 'employee';

  // Step complete — check if more steps in plan
  if (state.taskPlan && state.currentStepIndex + 1 < state.taskPlan.steps.length) {
    // Need to: 1) save step results, 2) advance index, 3) go to dispatcher
    return 'step_advance';  // new intermediate node
  }

  return 'boss_summary';
}

// Graph changes:
.addNode('pm_planner', (state, config) => pmPlannerNode(state, config))
.addNode('step_dispatcher', (state, config) => stepDispatcherNode(state, config))
.addNode('step_advance', (state, _config) => ({
  stepResults: [...state.stepResults, {
    stepIndex: state.currentStepIndex,
    outputs: state.currentStepOutputs,
  }],
  currentStepIndex: state.currentStepIndex + 1,
  currentStepOutputs: [],
}))

// Edges:
.addEdge('manager', 'pm_planner')           // was: manager → employee
.addConditionalEdges('pm_planner', routeFromPm, ['step_dispatcher', 'boss_summary'])
.addEdge('step_dispatcher', 'employee')
.addConditionalEdges('employee', routeFromEmployee, ['employee', 'step_advance', 'boss_summary', 'error_handler'])
.addEdge('step_advance', 'step_dispatcher')
```

**Step 4: Remove manager's pendingAssignments output**

In manager-node.ts, remove the pendingAssignments creation. Manager now only outputs `managerDirective`.

**Step 5: Run tests**

Run: `pnpm --filter @aics/core test`
Expected: All tests pass (existing + new PM flow integration)

**Step 6: Typecheck + build**

Run: `pnpm turbo run typecheck build --filter @aics/core`

**Step 7: Commit**

```bash
git add packages/core/
git commit -m "feat(core): wire PM planner + step dispatcher into main graph"
```

---

### Task 6: Update existing tests for new graph flow (Track 1)

**Files:**
- Modify: `packages/core/src/__tests__/unit/manager-node.test.ts`
- Modify: `packages/core/src/__tests__/integration/boss-chat-flow.test.ts`
- Modify: any other tests that depend on manager → employee direct flow

**Step 1: Update manager tests**

Manager now outputs `managerDirective` instead of (or in addition to) `pendingAssignments`. Update assertions accordingly.

**Step 2: Update boss-chat-flow integration tests**

The end-to-end flow now goes through PM. Update MockLlmGateway canned responses to include PM's response.

**Step 3: Run full core test suite**

Run: `pnpm --filter @aics/core test`
Expected: All 127+ tests pass

**Step 4: Commit**

```bash
git add packages/core/
git commit -m "test(core): update existing tests for PM planner graph flow"
```

---

### Task 7: Manager node test for directive output (Track 1)

**Files:**
- Test: `packages/core/src/__tests__/unit/manager-node.test.ts` (additional assertions)

Verify manager outputs `managerDirective` with correct structure. This is a quick addition to existing tests.

**Step 1: Add directive assertions to existing manager tests**

**Step 2: Run + commit**

---

### Task 8: MCP Client Core (Track 2)

**Files:**
- Create: `packages/core/src/mcp/mcp-client.ts`
- Create: `packages/core/src/mcp/mcp-tool-executor.ts`
- Create: `packages/core/src/mcp/types.ts`
- Test: `packages/core/src/__tests__/unit/mcp-tool-executor.test.ts`

**Step 1: Add @modelcontextprotocol/sdk dependency**

Run: `pnpm --filter @aics/core add @modelcontextprotocol/sdk`

**Step 2: Create MCP types**

```typescript
// packages/core/src/mcp/types.ts
export interface McpServerConfig {
  readonly name: string;
  readonly transport: 'stdio' | 'sse';
  readonly command?: string;
  readonly args?: string[];
  readonly url?: string;
  readonly env?: Record<string, string>;
}

export interface McpConnection {
  readonly config: McpServerConfig;
  readonly tools: ReadonlyArray<{ name: string; description: string; inputSchema: unknown }>;
  close(): Promise<void>;
}
```

**Step 3: Write MCP tool executor tests**

Test with a mock MCP server (in-process SSE or stub):
1. `addServer` registers a connection and lists tools
2. `listAvailable` returns tools from all connected servers
3. `execute` dispatches to correct server and returns result
4. `execute` returns error response for unknown tool
5. `dispose` closes all connections
6. Events emitted: mcpServerConnected, mcpToolCalled

**Step 4: Implement McpToolExecutor**

Uses `@modelcontextprotocol/sdk` Client. For testing, we'll use a mock transport rather than real stdio/SSE.

**Step 5: Run tests + commit**

```bash
git add packages/core/src/mcp/
git commit -m "feat(core): add MCP client and McpToolExecutor"
```

---

### Task 9: Employee Multi-round Tool Loop (Track 2)

**Files:**
- Modify: `packages/core/src/agents/employee-node.ts` (lines 70-92: tool call section)
- Test: `packages/core/src/__tests__/unit/employee-node.test.ts` (add multi-round test)

**Step 1: Write multi-round tool test**

Mock LLM returns toolCalls on first call, then toolCalls again on follow-up, then final content. Verify employee loops up to MAX_TOOL_ROUNDS (5).

**Step 2: Implement multi-round loop in employee-node.ts**

Replace the single-round tool section (lines 70-92) with:

```typescript
const MAX_TOOL_ROUNDS = 5;
let round = 0;

while (llmResponse.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
  round++;
  const toolResults = [];
  for (const toolCall of llmResponse.toolCalls) {
    const result = await toolExecutor.execute({
      toolCallId: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
    toolResults.push({ callId: toolCall.id, name: toolCall.name, result });
  }

  // Follow-up LLM call with tool results
  llmResponse = await recordedLlmCall(runtimeCtx, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: taskDescription },
      { role: 'assistant', content: `I called tools: ${toolResults.map(t => t.name).join(', ')}` },
      { role: 'user', content: `Tool results:\n${JSON.stringify(toolResults.map(t => ({ tool: t.name, result: t.result })))}` },
    ],
    model: resolved.model,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  }, { nodeName: 'employee', provider: resolved.provider, model: resolved.model, taskRunId });
}
```

**Step 3: Run tests + commit**

```bash
git add packages/core/src/agents/employee-node.ts packages/core/src/__tests__/unit/employee-node.test.ts
git commit -m "feat(core): add multi-round tool calling to employee node (max 5 rounds)"
```

---

### Task 10: Wire McpToolExecutor into RuntimeContext (Track 2)

**Files:**
- Modify: `packages/core/src/index.ts` (add MCP exports)
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx` (replace MockToolExecutor)
- Modify: `apps/web/src/lib/tauri-runtime.ts` (add MCP setup)

**Step 1: Export MCP from core index**

Add to `packages/core/src/index.ts`:
```typescript
export { McpToolExecutor } from './mcp/mcp-tool-executor.js';
export type { McpServerConfig, McpConnection } from './mcp/types.js';
```

**Step 2: Wire into AicsRuntimeProvider**

In browser mode, create McpToolExecutor (SSE only). In Tauri mode, create McpToolExecutor (stdio + SSE via Tauri shell).

For 1.0 MVP: Start with an empty McpToolExecutor (no servers configured by default). The MCP config panel (Task 16) lets users add servers.

**Step 3: Run web build + tests**

**Step 4: Commit**

---

### Task 11: MCP integration test (Track 2)

**Files:**
- Test: `packages/core/src/__tests__/integration/mcp-tool-flow.test.ts`

Test employee node using McpToolExecutor with a mock MCP transport. Verify the full cycle: employee calls LLM → LLM requests tool → McpToolExecutor dispatches → result returned → employee produces final answer.

**Commit after tests pass.**

---

### Task 12: Wire Meeting into Main Graph (Track 3)

**Files:**
- Modify: `packages/core/src/graph/main-graph.ts` (meeting edges)
- Test: `packages/core/src/__tests__/integration/meeting-flow.test.ts` (update for new wiring)

**IMPORTANT: Execute AFTER Task 5 (PM graph wiring) is committed to main.**

**Step 1: Add meeting nodes to main graph**

```typescript
import { meetingStartNode, participantTurnNode, meetingTurnCheck, meetingEndNode } from './meeting-subgraph.js';

// In buildAicsGraph:
.addNode('meeting_start', (state, config) => meetingStartNode(state, config))
.addNode('participant_turn', (state, config) => participantTurnNode(state, config))
.addNode('meeting_end', (state, config) => meetingEndNode(state, config))

// Update routeFromBoss:
case 'start_meeting': return 'meeting_start';

// Meeting edges:
.addEdge('meeting_start', 'participant_turn')
.addConditionalEdges('participant_turn', meetingTurnCheck, ['participant_turn', 'meeting_end'])
.addEdge('meeting_end', 'boss_summary')
```

**Step 2: Update meeting integration test**

Existing `meeting-flow.test.ts` tests the meeting nodes in isolation. Add a test that goes through the full graph: boss (decides meeting) → meeting_start → turns → meeting_end → boss_summary.

**Step 3: Run tests + commit**

```bash
git add packages/core/src/graph/main-graph.ts packages/core/src/__tests__/
git commit -m "feat(core): wire meeting subgraph into main graph"
```

---

### Task 13: MeetingRoomEntity (Track 3)

**Files:**
- Create: `packages/renderer/src/entities/meeting-room-entity.ts`
- Modify: `packages/renderer/src/core/scene-manager.ts` (add meeting room support)
- Test: `packages/renderer/src/__tests__/meeting-room-entity.test.ts`

**Step 1: Write MeetingRoomEntity tests**

Test cases:
1. Creates meeting room container at correct position
2. Shows/hides on meeting state events
3. Employees move to meeting room when meeting starts
4. Employees return to desks when meeting ends
5. Destroyed properly on scene cleanup

**Step 2: Implement MeetingRoomEntity**

A PixiJS Container with:
- Table visual (rectangle + chairs)
- Participant avatars (circles around table)
- GSAP entrance/exit animation
- Subscribes to `meeting.state.changed` events

**Step 3: Add to SceneManager**

Add `meetingRoom` entity to SceneManager. On `meeting.state.changed → 'active'`, show the meeting room and animate employees to it. On `'ended'`, hide and animate employees back.

**Step 4: Run renderer tests + commit**

```bash
git add packages/renderer/
git commit -m "feat(renderer): add MeetingRoomEntity with employee animation"
```

---

### Task 14: Renderer bubble enhancement (Track 3)

**Files:**
- Modify: `packages/renderer/src/entities/employee-entity.ts` (show tool name in bubble)

When `mcp.tool.called` event fires, show the tool name in the employee's task bubble. Small addition to existing EmployeeEntity.

**Commit after implementation.**

---

### Task 15: PlanProgressPanel UI (Track 4)

**Files:**
- Create: `apps/web/src/components/plan/PlanProgressPanel.tsx`
- Create: `apps/web/src/hooks/usePlanProgress.ts`
- Modify: `apps/web/src/App.tsx` (add panel)

**Step 1: Create usePlanProgress hook**

Subscribe to `plan.*` events via EventBus. Track:
- Current plan (or null)
- Steps with status (pending/active/completed)
- Current step index

**Step 2: Create PlanProgressPanel**

Renders step list with:
- Step description
- Status indicator (dot: gray/blue/green)
- Employee avatars assigned to each step
- Active step highlighted

**Step 3: Wire into App.tsx**

Add PlanProgressPanel to the layout, visible when a plan is active.

**Step 4: Run web build + commit**

---

### Task 16: MCP Config Panel (Track 4)

**Files:**
- Create: `apps/web/src/components/settings/McpConfigPanel.tsx`
- Modify: `apps/web/src/components/settings/` (add to settings)

A simple panel for adding/removing MCP server configs:
- Server name
- Transport: stdio | sse
- Command / URL
- Connect / disconnect buttons

Stores configs in localStorage. On connect, calls `mcpToolExecutor.addServer()`.

**Commit after implementation.**

---

### Task 17: Web typecheck + build verification (Track 4)

**Files:** All apps/web changes

Run: `pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build`
Fix any type errors from Tracks 1-3 type changes propagating to web.

**Commit fixes if needed.**

---

### Task 18: Integration — Final Wiring + Full Validation

**Files:** Cross-cutting

**Step 1: Full test suite**

Run: `pnpm --filter @aics/install-core test && pnpm --filter @aics/core test && pnpm --filter @aics/renderer test && pnpm --filter @aics/web test`

Expected: All packages pass. Target: 350+ total tests.

**Step 2: Full typecheck**

Run: `pnpm turbo run typecheck`
Expected: All packages pass.

**Step 3: Full build**

Run: `pnpm turbo run build`
Expected: All packages build.

**Step 4: Tag**

```bash
git tag mega-phase-a-core-loop
```

**Step 5: Update memory**

Update MEMORY.md with Mega-Phase A status.

---

## Handoff

After Task 18, produce the standard handoff block per CLAUDE.md:
1. What was completed
2. Current repo health
3. What should happen next (Mega-Phase B)
4. Starter prompt for next session
