# Mega-Phase A: Core Execution Loop — Design Document

**Date**: 2026-03-10
**Scope**: PM task DAG, MCP tool execution, meeting integration
**Prerequisite**: Phase 6 (install system) complete — tag `phase-6.0-install-system`
**Test baseline**: 296 tests (install-core 137, core 127, renderer 24, web 8)

## Goal

Complete the core execution loop so AICS can fulfill the PRD's primary acceptance criterion:

> "能够从一句自然语言指令走到正式产出下载"

After this phase, the flow is: Boss decides → Manager routes → PM plans (task DAG) → Employees execute (with real tools via MCP) → Meetings for collaboration → Boss summarizes.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PM node position | Manager → PM → Employee (3-layer) | PRD mandates separate Manager/PM roles |
| DAG model | Linear steps + parallel groups | Sufficient for most workflows, avoids full DAG complexity |
| MCP scope | Minimal viable (real client, no Rack/Slot) | Unblock real tool use first, permissions later |
| Meeting scope | Wire into main graph + renderer feedback | Code exists, just needs integration |
| Architecture | Extend main graph (Approach A) | Minimal new abstractions, YAGNI, reuses LangGraph patterns |

## 1. New Graph Topology

### Current

```
Boss → [route] → Manager → Employee(loop) → Boss Summary
                                   ↘ Error Handler
```

### New

```
__START__ → boss → [routeFromBoss]
                     ├── 'direct_reply'      → boss_summary → __END__
                     ├── 'delegate_manager'  → manager
                     ├── 'start_meeting'     → meeting_start ──┐
                     └── (interruptReason)   → error_handler   │
                                                                │
manager → pm_planner                                           │
                                                                │
pm_planner → [routeFromPm]                                    │
               ├── has steps → step_dispatcher                 │
               └── trivial   → boss_summary                   │
                                                                │
step_dispatcher → employee(loop) → [routeFromEmployee]        │
                                    ├── more tasks in step → employee
                                    ├── step done, more steps → step_dispatcher
                                    ├── all steps done → boss_summary
                                    └── interruptReason → error_handler
                                                                │
meeting_start → participant_turn(loop) → [meetingTurnCheck]   │
                                          ├── more → participant_turn
                                          └── done → meeting_end
meeting_end → boss_summary                                     │
                                                                │
boss_summary → __END__                                         │
error_handler → __END__                                        │
```

### Node Changes

| Node | Status | Responsibility |
|------|--------|----------------|
| `boss` | Unchanged | Decision routing (add `start_meeting` target) |
| `manager` | **Modified** | Output `managerDirective` instead of `pendingAssignments` |
| `pm_planner` | **New** | Generate `TaskPlan { steps: PlanStep[] }` from directive |
| `step_dispatcher` | **New** | Pop current step, fill `pendingAssignments`, advance index |
| `employee` | Unchanged | Execute tasks, consume `pendingAssignments` |
| `meeting_start` | **Wired** | Existing code, add to main graph |
| `participant_turn` | **Wired** | Existing code |
| `meeting_end` | **Wired** | Existing code |
| `boss_summary` | Unchanged | Aggregate results |
| `error_handler` | Unchanged | Graceful termination |

## 2. TaskPlan Data Model

```typescript
interface TaskPlan {
  planId: string;
  threadId: string;
  companyId: string;
  steps: PlanStep[];
  summary: string;
}

interface PlanStep {
  stepIndex: number;
  description: string;
  tasks: PlanTask[];
}

interface PlanTask {
  taskType: string;
  employeeId: string;
  description: string;
  dependsOnStepOutput: boolean;
}
```

### New Graph State Fields

```typescript
// Added to AicsGraphAnnotation:

managerDirective: {
  intent: string;
  recommendedEmployees: string[];
  constraints?: string;
} | null;

taskPlan: TaskPlan | null;
currentStepIndex: number;            // 0-based
stepResults: StepResult[];           // completed step outputs
currentStepOutputs: StepTaskOutput[]; // accumulator for current step

interface StepResult {
  stepIndex: number;
  outputs: StepTaskOutput[];
}

interface StepTaskOutput {
  employeeId: string;
  employeeName: string;
  content: string;
  taskRunId: string;
}
```

## 3. PM Node Logic

```
pm_planner(state, config):
  1. Read state.managerDirective (intent + recommended employees)
  2. Fetch employee details from repos (role, skills via persona_json)
  3. recordedLlmCall() with PM_SYSTEM_PROMPT:
     - Input: user intent + employee capabilities
     - Output: JSON TaskPlan
  4. Create taskRun records for each task (status: 'planned')
  5. Emit plan.created event
  6. Return { taskPlan, currentStepIndex: 0, stepResults: [] }
```

PM does not execute. step_dispatcher handles advancement.

## 4. Step Dispatcher Logic

```
step_dispatcher(state, config):
  1. step = state.taskPlan.steps[state.currentStepIndex]
  2. For each task in step.tasks:
     - Build inputJson (inject previousStepOutput if dependsOnStepOutput)
     - Push to pendingAssignments
     - Update taskRun: planned → queued
     - Emit taskStateChanged
  3. Emit plan.step.started
  4. Return { pendingAssignments, currentStepOutputs: [] }
```

### routeFromEmployee (modified)

```
routeFromEmployee(state):
  if interruptReason → 'error_handler'
  if pendingAssignments.length > 0 → 'employee'

  // Current step complete
  if currentStepIndex + 1 < taskPlan.steps.length:
    // Merge currentStepOutputs into stepResults, advance index
    return 'step_dispatcher'
  else:
    return 'boss_summary'
```

Employee node itself is unchanged — it still pops from pendingAssignments.

## 5. MCP Tool Execution

### McpToolExecutor

Replace MockToolExecutor with a real MCP client using `@modelcontextprotocol/sdk`.

```typescript
class McpToolExecutor implements ToolExecutor {
  addServer(config: McpServerConfig): Promise<void>;
  listAvailable(companyId: string): Promise<ToolDef[]>;
  execute(call: ToolCallRequest): Promise<ToolCallResponse>;
  dispose(): Promise<void>;
}

interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;    // stdio
  args?: string[];     // stdio
  url?: string;        // sse
}
```

### Environment Support

| Environment | stdio | SSE |
|-------------|-------|-----|
| Desktop (Tauri) | ✅ via shell plugin | ✅ |
| Web (Browser) | ❌ no process spawn | ✅ |

### Employee Multi-round Tool Loop

Current: LLM → tools → follow-up LLM → done

New: LLM → tools → follow-up LLM → (if more tools) → tools → LLM → ... (max 5 rounds)

## 6. Meeting Integration

Wire existing meeting subgraph code into the main graph as direct nodes (not nested subgraph, to avoid state-passing complexity):

- `meeting_start`: Creates meeting session, collects participants
- `participant_turn`: Each participant speaks via LLM, loop
- `meeting_end`: Summarize transcript, update status

### Renderer Feedback

New `MeetingRoomEntity` in packages/renderer:
- When `meeting.state.changed → 'active'`: show meeting room visual
- Participating employees animate from desk to meeting room
- On meeting end: employees return to desks

## 7. New Event Types

| Event | Payload | Trigger |
|-------|---------|---------|
| `plan.created` | `{ planId, threadId, steps: StepSummary[] }` | PM generates plan |
| `plan.step.started` | `{ planId, stepIndex, taskCount }` | step_dispatcher begins step |
| `plan.step.completed` | `{ planId, stepIndex, outputs[] }` | All tasks in step done |
| `plan.completed` | `{ planId, totalSteps }` | All steps done |
| `mcp.server.connected` | `{ serverName, toolCount }` | MCP server connected |
| `mcp.tool.called` | `{ serverName, toolName, employeeId }` | Tool invoked |

## 8. UI Updates

| Component | Location | Purpose |
|-----------|----------|---------|
| `PlanProgressPanel` | `apps/web/src/components/plan/` | Step progress visualization |
| Bubble enhancement | `packages/renderer` EmployeeEntity | Show current tool name |
| `MeetingRoomEntity` | `packages/renderer/src/entities/` | Meeting room visual |
| MCP config panel | `apps/web/src/components/settings/` | Add/remove MCP servers |

## 9. Parallel Track Strategy

```
Bootstrap (sequential first):
  shared-types + graph state extensions + event types

Then parallel:
  Track 1: PM node + step_dispatcher + graph wiring + tests
  Track 2: McpToolExecutor + employee multi-round + tests
  Track 3: Meeting wiring + MeetingRoomEntity + tests
  Track 4: UI — PlanProgressPanel + MCP config + bubble enhancement
```

File overlap analysis:
- Track 1 touches: core/src/agents/, core/src/graph/, shared-types
- Track 2 touches: core/src/mcp/ (new dir), core/src/agents/employee-node.ts
- Track 3 touches: core/src/graph/main-graph.ts, renderer/src/
- Track 4 touches: apps/web/src/components/

**Conflict points**: main-graph.ts (Track 1 + Track 3), employee-node.ts (Track 1 + Track 2)
**Resolution**: Bootstrap defines all new state fields + node stubs first. Track 1 implements PM/step_dispatcher. Track 3 adds meeting edges after Track 1's graph changes land. Track 2's employee-node change (multi-round tools) is isolated to the tool-call section of the node.

## 10. Not In Scope

- Rack/Slot/Workstation permission model (future Phase 8)
- Plan persistence to DB (YAGNI for 1.0, plan lives in graph state)
- Plan pause/resume/cancel (post-1.0)
- New meeting types beyond brainstorm (existing code is sufficient)
- Pitch Hall / Library / output download (Mega-Phase B)
