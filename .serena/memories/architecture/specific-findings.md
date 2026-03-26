# Specific Findings: Direct Answer to Your Questions

## Question 1: Does Boss Have a "Direct Reply" Fast Path?

**YES. Explicit confirmation:**

From `boss-node.ts`:
```typescript
const decision = parseBossDecision(llmResponse.content);
const route = decision ? mapActionToRoute(decision.action) : 'delegate_manager';
```

From test `boss-chat-flow.test.ts`:
```typescript
it('handles direct reply without delegation', async () => {
  gateway.pushResponse({
    content: JSON.stringify({
      action: 'direct_reply',
      reason: 'simple greeting',
      reply: 'Hello! How can I help?',
    }),
  });
  
  const result = await graph.invoke(...);
  expect(result.routeDecision).toBe('direct_reply');
});
```

**The Fast Path Works Like This:**
1. Boss LLM is called (`recordedLlmCall`)
2. LLM responds with `action: 'direct_reply'` + `reply: "answer text"`
3. `routeFromBoss()` sees `routeDecision='direct_reply'` → routes to `'boss_summary'`
4. `boss_summary` is an inline node that **does NOT call any LLM** — it just formats the message that Boss already generated
5. Graph ends at END

**Result**: Single LLM call, no Manager/PM/Employee involvement, instant response.

**However**, there's a nuance: Boss's system prompt explicitly instructs it to choose between actions:
```
- "direct_reply": for simple greetings, status questions, or things you can answer directly
- "delegate": for tasks requiring employee work
```

So the "fast path" exists but depends on Boss LLM deciding direct_reply is appropriate. It's not a pre-check optimization.

---

## Question 2: What's the Full List of routeDecision Values?

**Complete list from state.ts**:
```typescript
export interface AicsGraphState {
  routeDecision: Annotation<'direct_reply' | 'delegate_manager' | 'start_meeting' | null>
}
```

**All 4 values**:
1. `'direct_reply'` — Boss will reply directly, skip delegation
   - Set by: `bossNode` when LLM decides `action='direct_reply'`
   - Routes to: `'boss_summary'` (END)

2. `'delegate_manager'` — Boss delegates to Manager for assignment
   - Set by: `bossNode` when LLM decides `action='delegate'` OR `action='hire_or_assess'`
   - Routes to: `'manager'`

3. `'start_meeting'` — Boss initiates a team meeting
   - Set by: `bossNode` when LLM decides `action='meeting'`
   - Routes to: `'meeting_start'`

4. `null` — Initial state or error fallback
   - Default: `null` in annotation
   - If Boss fails: fallback to `'delegate_manager'`

**Routing Logic**:
```typescript
export function routeFromBoss(state: AicsGraphState): string {
  if (state.interruptReason) return 'error_handler';
  
  switch (state.routeDecision) {
    case 'direct_reply':
      return 'boss_summary';
    case 'delegate_manager':
      return 'manager';
    case 'start_meeting':
      return 'meeting_start';
    default:  // null or invalid
      return 'manager';  // safe default
  }
}
```

---

## Question 3: Where Are Cross-Cutting Concerns Handled?

### Message Pruning (最关键)

**Location**: `recordedLlmCall()` → `ConversationBudgetService.prepareRequest()`

**Call stack**:
```
recordedLlmCall(ctx, request, meta)
  ↓
const prunedRequest = await conversationBudgetService.prepareRequest(ctx, request)
  ↓
pruneLlmMessages(request.messages, options)  // 实际修剪
```

**Applied**: Before EVERY `gateway.chat()` call

**Test verification** from `boss-chat-flow.test.ts`:
```typescript
const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
expect(llmCalls.length).toBeGreaterThanOrEqual(4);  // boss + manager + pm + employee
```

Each call is independently pruned.

### Memory Injection

**Location**: `employeeNode()` before LLM call

**Code**:
```typescript
// In employeeNode() during systemPrompt building:
if (memoryService && taskDescription && (memoryPolicy?.injectionEnabled ?? true)) {
  const relevantMemories = await memoryService.getRelevantMemories(
    employee.employee_id,
    companyId,
    taskDescription,  // semantic search
    memoryPolicy?.maxFacts ?? 10
  );
  systemPrompt += formatMemoriesSection(relevantMemories);
}
```

**Timing**: Only in `employeeNode`, after employee is assigned, before LLM call

### Library Document Injection

**Location**: `employeeNode()` after memory injection

**Code**:
```typescript
if (taskDescription && repos.libraryDocuments) {
  const libraryService = new LibraryService(repos.libraryDocuments, eventBus);
  const { text, citations } = await libraryService.getRelevantSnippetsWithCitations(
    companyId,
    taskDescription
  );
  if (text) {
    citationMap = citations;
    systemPrompt += `\n\n## Relevant company documents\n${text}...`;
  }
}
```

### Workstation Tool Access Control (PRD 2.3)

**Location**: `employeeNode()` tool execution phase

**Two-stage check**:
```typescript
// Stage 1: Pre-resolve available tools (avoids N+1)
const mcpTools = workstationToolResolver
  ? await workstationToolResolver.resolveForEmployee(companyId, employee.employee_id)
  : await toolExecutor.listAvailable(companyId);
const allowedMcpToolNames = new Set(mcpTools.map((t) => t.name));

// Stage 2: When tool is called
if (workstationToolResolver && !allowedMcpToolNames.has(toolCall.name)) {
  return {
    success: false,
    error: `[WORKSTATION_ACCESS_DENIED] Employee '${employee.name}' is not assigned to a workstation with access to tool '${toolCall.name}'.`
  };
}
```

### Other Permission Checks

**Handoff limit**: `state.handoffCount < MAX_HANDOFF_COUNT` (3 max)
- Enforced in: `employeeNode()` before adding handoff_to tool

**Direct chat restriction**: No handoff in `entryMode='direct_chat'`
- Check: `state.entryMode !== 'direct_chat'`

**Message context limit**: `MAX_CONTEXT_MESSAGES = 20`
- Applied in: `employeeNode()` multi-round tool loop
- Purpose: Trim conversation history to last 20 messages to prevent unbounded growth

**Recovery retry limit**: `MAX_RECOVERY_RETRIES = 2`
- Applied in: `attemptLocalRecovery()` 

---

## Question 4: What's in the RuntimeContext Interface?

**Complete interface** from `runtime-context.ts`:

```typescript
export interface RuntimeContext {
  readonly repos: RuntimeRepositories;           // All DB access (employees, threads, tasks, etc.)
  readonly eventBus: EventBus;                   // Event publishing
  readonly llmGateway: LlmGateway;               // LLM provider
  readonly modelResolver: ModelResolver;         // Model selection per role
  readonly toolExecutor: ToolExecutor;           // MCP tool execution
  readonly companyId: string;                    // Current company scope
  readonly threadId: string;                     // Current thread scope
  readonly runtimePolicy?: RuntimePolicyConfig;  // Opt-in policy (memory, tool search, etc.)
  readonly memoryService?: MemoryService;        // Optional: memory CRUD + semantic search
  readonly workstationToolResolver?: WorkstationToolResolver;  // PRD 2.3: workstation-scoped tools
  readonly meetingInterruptBox: MeetingInterruptBox;  // Mutable: boss interrupts to meetings
}
```

**How it's created** (from OrchestrationService._executeInner):
```typescript
const config = {
  configurable: {
    thread_id: threadId,
    runtimeCtx: this.runtimeCtx,  // ← Passed here
    signal: input.signal,
  },
};

const stream = await this.graph.stream(fullInput, config);
```

**How nodes access it**:
```typescript
export async function employeeNode(state, config) {
  const runtimeCtx = getRuntime(config, 'employee');  // ← Extract from config
  // Now use runtimeCtx.repos, runtimeCtx.eventBus, etc.
}
```

---

## Question 5: What's the Full Graph Topology?

**Nodes that make LLM calls**:
1. `boss` ✓ (recordedLlmCall)
2. `manager` ✓ (recordedLlmCall, unless fast-path)
3. `pm_planner` ✓ (recordedLlmCall, unless SOP matches)
4. `employee` ✓ (recordedLlmCall × rounds + multi-round tools)
5. `hr` ✓ (recordedLlmCall, when hire/assess_team)
6. `pm_replan` ✓ (recordedLlmCall, if replan signal detected)
7. `boss_summary` ✗ (inline, formats existing messages)
8. `meeting_*` ✓ (participantTurnNode does recordedLlmCall per turn)

**Nodes that don't call LLM**:
9. `step_dispatcher` ✗ (inline state machine)
10. `step_advance` ✗ (inline state machine)
11. `error_handler` ✗ (routes to boss_summary)
12. `pm_heartbeat` ✗ (no-op, routes to END)
13. `employee_direct_setup` ✗ (inline, routes to employee)

**Conditional edges with routing functions**:
```
__start__ → routeFromStart → [boss, employee_direct_setup, meeting_*, pm_heartbeat]
boss → routeFromBoss → [manager, boss_summary, error_handler, meeting_start]
manager → routeFromManager → [pm_planner, hr]
pm_planner → routeFromPm → [step_dispatcher, boss_summary]
employee → routeFromEmployee → [employee (loop), step_advance, boss_summary, error_handler]
step_advance → routeFromStepAdvance → [step_dispatcher, pm_replan]
participant_turn → meetingTurnCheck → [participant_turn (loop), meeting_end, meeting_paused, meeting_inject]
```

---

## Question 6: What's the Exact Sequence for a Happy Path?

**Test case**: `boss-chat-flow.test.ts` → "routes user message through boss → manager → pm → dispatcher → employee → summary"

**Exact sequence**:
```
User Input: HumanMessage("Build me a website")
entryMode='boss_chat'

↓ graph.invoke(fullInput, config)
↓ routeFromStart() → 'boss'

[1] BOSS NODE (recordedLlmCall #1)
    Input: [System, User: "Build me a website"]
    LLM:   {"action": "delegate", "reason": "needs development work"}
    Output: routeDecision='delegate_manager'

↓ routeFromBoss() → 'manager'

[2] MANAGER NODE (recordedLlmCall #2)
    Input: [System: MANAGER_PROMPT + employees, User: "Build me a website"]
    LLM:   {"intent": "work", "assignments": [{"employeeId": "e-dev-1", ...}]}
    Output: managerDirective.recommendedEmployees=[e-dev-1]

↓ routeFromManager() → 'pm_planner'

[3] PM PLANNER NODE (recordedLlmCall #3)
    Input: [System: PM_PROMPT + employees, User: intent + constraints]
    LLM:   {"summary": "...", "steps": [{stepIndex:0, tasks:[{employeeId:"e-dev-1", ...}]}]}
    Output: taskPlan with 1 step, taskRunId created, pendingAssignments queued

↓ routeFromPm() → 'step_dispatcher'

[4] STEP DISPATCHER NODE (inline, NO LLM)
    - Finds first ready steps (step 0 has no dependencies)
    - Creates pendingAssignments: [{employeeId: "e-dev-1", inputJson: {...}}]

↓ Edge: 'employee'

[5] EMPLOYEE NODE (recordedLlmCall #4)
    - Pop pendingAssignments[0]
    - Build systemPrompt + memories + library docs
    - recordedLlmCall(messages=[system, user], tools=[...])
    - Multi-round tool loop (if tools called)
    - Output: "Here is the implementation code."
    - Task marked completed
    - Return remaining pendingAssignments (now empty)

↓ routeFromEmployee() → 'step_advance' (pendingAssignments empty)

[6] STEP ADVANCE NODE (inline, NO LLM)
    - Mark step 0 as completed
    - Emit planStepCompleted event
    - Clear currentStepOutputs
    - Return nextDisplayIndex (no more steps)

↓ routeFromStepAdvance() → 'step_dispatcher' (no replan signal)

[7] STEP DISPATCHER NODE (inline)
    - Find next ready steps (none left)
    - No more pendingAssignments

↓ Edge: 'employee'

[8] EMPLOYEE NODE
    - pendingAssignments is empty
    - Return immediately with completed=true

↓ routeFromEmployee() → 'boss_summary' (pendingAssignments empty)

[9] BOSS SUMMARY NODE (inline, NO LLM)
    - Format all accumulated messages
    - Return AicsGraphState

↓ Edge: END

Graph completes.
```

**Total LLM calls**: **4** (boss + manager + pm_planner + employee)

**Test verification**:
```typescript
const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
expect(llmCalls.length).toBeGreaterThanOrEqual(4);  // ✓ Confirmed
expect(llmCalls.every(c => c.input_tokens > 0)).toBe(true);  // ✓ All recorded
```

---

## Question 7: Message Accumulation Across Nodes?

**How messages flow through the graph**:

Each node can return `{ messages: [AIMessage(...)] }`, which are accumulated.

From `orchestration-service.ts`:
```typescript
// Merge node output, accumulating messages to match graph.invoke() behavior
const delta = nodeOutput as Partial<AicsGraphState>;
if (delta.messages) {
  finalState = {
    ...finalState,
    ...delta,
    messages: [...(finalState.messages ?? []), ...delta.messages],  // ← ACCUMULATE
  };
}
```

**What each node adds**:
- `boss`: AIMessage("[Boss]: [reply text]") or "[reason]" (internal)
- `manager`: Typically none (or internal directive text)
- `pm_planner`: Typically none
- `employee`: AIMessage("[EmployeeName]: [output]")
- `boss_summary`: AIMessage("[summary]") or final formatted response

**Result**: state.messages accumulates ALL outputs, like:
```
[
  HumanMessage("Build me a website"),
  AIMessage("[Boss]: Delegation decision..."),
  AIMessage("[Dev]: Here is the implementation..."),
  AIMessage("[Summary]: ...")
]
```

This is the **full conversation history** preserved in state.messages.

---

## Key Implementation Pattern: recordedLlmCall

All LLM calls follow this pattern:
```typescript
const response = await recordedLlmCall(
  runtimeCtx,
  {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ],
    model: resolved.model,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
    signal: getConfigSignal(config)
  },
  {
    nodeName: 'boss',  // or 'manager', 'employee', etc.
    provider: resolved.provider,
    model: resolved.model,
    taskRunId: taskRunId  // optional
  }
);
```

**What recordedLlmCall does**:
1. Generate llmCallId
2. Emit `llmCallStarted` event
3. **Apply message pruning** via ConversationBudgetService
4. Call `ctx.llmGateway.chat(prunedRequest)`
5. Record to `llmCalls` DB table
6. Emit `llmCallCompleted` and `llmUsageRecorded` events
7. Return response

**This is the ONLY way LLM calls should be made in the graph** (except ConversationBudgetService's own synopsis call).
