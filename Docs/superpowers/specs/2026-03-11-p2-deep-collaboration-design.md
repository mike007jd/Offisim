# P2 Design: Deep Multi-Agent Collaboration

**Date**: 2026-03-11
**Status**: Final
**Scope**: Meeting action-item extraction, explicit handoff, 3-layer agent memory

---

## Context

P1 delivered direct chat, pitch hall, and structured errors. P2 deepens the multi-agent collaboration core — the product's primary differentiator. Three independent subsystems, connected through EventBus, can be developed in parallel.

### Research basis

Patterns drawn from five high-star frameworks:
- **MetaGPT** (artifact-driven handoff, no meetings needed)
- **CrewAI** (4-layer memory, delegation tools)
- **AutoGen** (GroupChat speaker selection)
- **ChatDev** (phase-based artifact passing, role-flip dehallucination)
- **Letta/MemGPT** (agent self-managed memory via tool calls)
- **Mem0** (LLM-driven dedup/conflict resolution)
- **LangGraph** (Command pattern for handoffs)
- **Instructor** (action-item schema with dependencies)

### Existing infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| Meeting subgraph | Working | 10-turn participant rotation, meetingEndNode produces summary |
| `handoff_events` table | Schema exists | Never written to; no graph logic |
| `meeting_sessions` table | Working | topic, status, summary_json |
| EventBus | 29 event types | Extensible via shared-types |
| LangGraph StateGraph | 10 nodes | `@langchain/langgraph@1.2.1` supports Command class |
| ToolExecutor | Working | MCP tool execution for employees |
| LlmGateway | `chat()` + `chatStream()` | No `withStructuredOutput` — must use prompt + Zod parse |

### Pre-P2 hotfix: status constraint mismatches

**Discovery**: The existing code uses status values not in the DB CHECK constraints:
- `meeting_sessions`: code uses `'active'`/`'ended'`, constraint allows `'running'`/`'completed'`
- `task_runs`: code uses `'active'`, constraint allows `'running'`

This has not caused issues because memory repositories bypass SQLite constraints, but **will fail in Tauri (real SQLite)**. Fix as Phase 0 prerequisite:

```sql
-- Option: align code to constraints (less migration work)
-- meeting-subgraph.ts: 'active' → 'running', 'ended' → 'completed'
-- employee-node.ts: 'active' → 'running'
-- Update shared-types if status types are defined there
```

---

## Subsystem A: Meeting Action-Item Extraction

### Goal

When a meeting ends, extract structured action items and decisions from the transcript, create TaskRuns, and present a summary to the user via boss_summary.

### Design

**Change scope**: `meetingEndNode` in `meeting-subgraph.ts`, new Zod schema, boss_summary output enhancement.

**Step 1 — Structured extraction in meetingEndNode**

AICS uses its own `LlmGateway` (not LangChain ChatModel), so `withStructuredOutput` is **not available**. Instead, use prompt-based JSON extraction + Zod validation:

```typescript
// 1. Build dynamic schema context (employee list is runtime data)
const employees = await runtimeCtx.repos.employees.findByCompany(state.companyId);
const employeeMap = Object.fromEntries(employees.map(e => [e.employee_id, e.name]));

// 2. System prompt instructs JSON output
const systemPrompt = `You are a meeting secretary. Extract action items from the transcript.
Respond with ONLY a JSON object matching this schema:
{
  "summary": "string — concise meeting summary",
  "actionItems": [{
    "description": "string",
    "assigneeId": "one of: ${employees.map(e => e.employee_id).join(', ')}",
    "priority": "high | medium | low",
    "dependsOnIndex": [number] // indexes of other items this depends on, or []
  }],
  "decisions": ["string — key decisions reached"]
}
Available employees: ${employees.map(e => `${e.employee_id} (${e.name}, ${e.role})`).join(', ')}`;

// 3. LLM call + Zod parse with fallback
const raw = await runtimeCtx.llmGateway.chat({ system: systemPrompt, messages: [...transcript] });
const parsed = MeetingOutputSchema.safeParse(JSON.parse(raw));
if (!parsed.success) {
  // Fallback: store raw summary, skip action items, log warning
}
```

The `MeetingOutputSchema` is built dynamically per invocation because `assigneeId` is constrained to known employee IDs:

```typescript
function buildMeetingOutputSchema(employeeIds: [string, ...string[]]) {
  return z.object({
    summary: z.string(),
    actionItems: z.array(z.object({
      description: z.string(),
      assigneeId: z.enum(employeeIds),
      priority: z.enum(['high', 'medium', 'low']),
      dependsOnIndex: z.array(z.number()).default([]),
    })),
    decisions: z.array(z.string()),
  });
}
```

Note: This is a **dynamic Zod schema** — must be constructed inside the node function, not as a module-level constant.

**Step 2 — TaskRun creation + index-to-ID mapping**

For each action item:
- Create `TaskRun` with `task_type: 'meeting_action'`, `status: 'queued'`, `employee_id: assigneeId`
- Map `dependsOnIndex` (array indexes) → `dependsOn` (taskRunIds) after all TaskRuns are created
- Store mapped `dependsOn` taskRunIds in `input_json`
- Emit `meeting.action.created` event per item

```typescript
// Create all TaskRuns first to get IDs
const taskRunIds: string[] = [];
for (const item of parsed.data.actionItems) {
  const taskRunId = `tr-ma-${Date.now()}-${taskRunIds.length}`;
  taskRunIds.push(taskRunId);
  await runtimeCtx.repos.taskRuns.create({
    task_run_id: taskRunId,
    thread_id: state.threadId,
    employee_id: item.assigneeId,
    task_type: 'meeting_action',
    status: 'queued',
    input_json: JSON.stringify({ description: item.description, priority: item.priority }),
    // dependsOn mapped below
  });
}
// Map indexes to IDs and update input_json
for (let i = 0; i < parsed.data.actionItems.length; i++) {
  const deps = parsed.data.actionItems[i].dependsOnIndex
    .filter(idx => idx >= 0 && idx < taskRunIds.length && idx !== i)
    .map(idx => taskRunIds[idx]);
  if (deps.length > 0) {
    // Update input_json to include dependsOn
    await runtimeCtx.repos.taskRuns.updateStatus(taskRunIds[i], 'queued'); // re-save with deps
  }
}
```

**Step 3 — Boss summary integration**

`meetingEndNode` populates `meetingActionItems` in graph state. `bossSummaryNode` reads this array and includes it in the user-facing summary. No changes to boss_summary's LLM call — just append action items as text to the final message.

**Step 4 — New events**

```typescript
EventFamily = 'meeting.action.created'
interface MeetingActionCreatedPayload {
  meetingId: string;
  actionItemId: string;  // = taskRunId
  description: string;
  assigneeEmployeeId: string;
  priority: 'high' | 'medium' | 'low';
  dependsOn: string[];  // taskRunIds of dependencies
}
```

### What this does NOT do

- Does not auto-execute action items (avoids execution time explosion from 5+ parallel tasks)
- Does not change meeting turn logic (speaker policy enhancement deferred)
- Does not add meeting types (standup/review/brainstorm deferred)

### Test plan

- Unit: meetingEndNode with mock LLM returning valid JSON → verify TaskRun creation + events
- Unit: Zod schema validation: empty action items, circular dependsOnIndex, invalid assigneeId
- Unit: JSON parse failure fallback — raw summary preserved, no crash
- Integration: full meeting flow → meetingEnd → boss_summary includes action items text

---

## Subsystem B: Explicit Handoff via Command Pattern

### Goal

Allow an employee to hand off work to another employee mid-execution, with structured context transfer (not chat history). Write to `handoff_events` table for audit trail.

### Design

**Change scope**: `employee-node.ts` enhanced, new handoff event types, `handoff_events` table populated.

**Approach: Command pattern inside employee_node**

Use LangGraph's `Command` class (`new Command(...)`, not `Command(...)`). When employee calls `handoff_to` tool, the node returns a Command instead of a plain state update.

**Return type change**: `employeeNode` signature changes from:
```typescript
Promise<Partial<AicsGraphState>>
```
to:
```typescript
Promise<Partial<AicsGraphState> | Command>
```

LangGraph v1.2.1 StateGraph nodes accept `Command` returns natively. When a node returns `Command`, **conditional edges are bypassed** — the Command's `goto` takes precedence over `routeFromEmployee`. This means `routeFromEmployee` is NOT called for handoff paths.

**Handoff detection via tool call**

Add `handoff_to` as a **virtual tool** (not MCP) to the employee's LLM request. This requires modifying how `employeeNode` constructs the LLM call:

```typescript
// Current: employeeNode calls recordedLlmCall without tools parameter
// Changed: inject handoff_to + MCP tools into the tools parameter

const mcpTools = await runtimeCtx.toolExecutor.listAvailable(state.companyId);
const colleagues = employees.filter(e => e.employee_id !== currentEmployee.employee_id);

const allTools = [
  ...mcpTools,
  ...(colleagues.length > 0 ? [{
    name: 'handoff_to',
    description: 'Hand off this task to another employee who is better suited.',
    parameters: {
      type: 'object',
      properties: {
        targetEmployeeId: {
          type: 'string',
          enum: colleagues.map(e => e.employee_id),
          description: `Available colleagues: ${colleagues.map(e => `${e.employee_id} (${e.name})`).join(', ')}`
        },
        reason: { type: 'string' },
        completedWork: { type: 'string', description: 'Summary of what you completed' },
        remainingWork: { type: 'string', description: 'What the next employee should do' },
      },
      required: ['targetEmployeeId', 'reason', 'completedWork', 'remainingWork'],
    },
  }] : []),
];
```

In the tool-calling loop, detect `handoff_to` and handle separately:

```typescript
if (toolCall.name === 'handoff_to') {
  const { targetEmployeeId, reason, completedWork, remainingWork } = toolCall.args;

  // Write handoff record
  await runtimeCtx.repos.handoffs.create({ ... });

  // Emit event
  runtimeCtx.eventBus.emit(handoffInitiated(...));

  // Return Command — bypasses routeFromEmployee
  return new Command({
    goto: 'employee',
    update: {
      pendingAssignments: [{
        taskType: 'handoff_continuation',
        employeeId: targetEmployeeId,
        inputJson: { description: remainingWork, priorWork: completedWork, handoffReason: reason },
      }],
      handoffCount: state.handoffCount + 1,
    },
  });
}

// MCP tools: delegate to toolExecutor as before
```

**Guard rails**

- Max 3 handoffs per graph run: check `state.handoffCount >= 3` before offering `handoff_to` tool
- Self-handoff: filtered out by `colleagues` list construction
- Chain handoff: `handoff_to` tool IS available for `handoff_continuation` tasks (the receiving employee may also decide to hand off — this is intentional, guarded by max count)

**Direct chat edge case**: When `entryMode === 'direct_chat'`, `handoff_to` tool is **NOT injected**. Direct chat is 1:1 between user and specific employee; handoff would violate user intent.

**New events**

```typescript
EventFamily = 'handoff.initiated'
interface HandoffInitiatedPayload {
  handoffId: string;
  threadId: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  reason: string;
  taskRunId: string;
}

EventFamily = 'handoff.completed'
interface HandoffCompletedPayload {
  handoffId: string;
  toEmployeeId: string;
  taskRunId: string;
}
```

### What this does NOT do

- Does not implement swarm-style peer-to-peer handoff (AICS is hierarchical)
- Does not allow handoff during meetings (meeting participants are fixed per session)
- Does not add a separate handoff_check node (Command pattern handles it inline)

### Test plan

- Unit: employee-node with mock LLM calling `handoff_to` tool → verify Command return, handoff_events write, events emitted
- Unit: guard rails — self-handoff not in tool list, max 3 handoffs enforced (tool removed), direct_chat has no handoff_to
- Unit: `routeFromEmployee` NOT called when Command is returned (verify via mock)
- Integration: boss → manager → pm → employee A → handoff → employee B → boss_summary

---

## Subsystem C: 3-Layer Agent Memory

### Goal

Give employees persistent memory across sessions: personal experience, team knowledge, and company rules. Agent self-manages memory via tool calls (Letta/MemGPT pattern).

### Design

**Change scope**: new `memory_entries` table + FTS5 (with LIKE fallback), new MemoryRepository, memory tools injected into employee-node, employee-node prompt enhancement.

### Layer 1: Database schema

```sql
-- New migration: 005_memory_system.sql
-- (Next available number after 001-004 in db-local/src/migrations/)

CREATE TABLE memory_entries (
  memory_id    TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id),
  scope        TEXT NOT NULL CHECK(scope IN ('employee', 'team', 'company')),
  owner_id     TEXT NOT NULL,  -- employee_id for 'employee' scope, company_id for others
  category     TEXT NOT NULL CHECK(category IN ('experience', 'decision', 'knowledge', 'preference')),
  content      TEXT NOT NULL,
  importance   REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
  source_thread_id  TEXT,  -- which thread created this memory
  source_task_run_id TEXT, -- which task run created this memory
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_memory_scope_owner ON memory_entries(scope, owner_id);
CREATE INDEX idx_memory_company ON memory_entries(company_id);
CREATE INDEX idx_memory_importance ON memory_entries(importance DESC);
```

**FTS5 — with graceful degradation**

FTS5 availability depends on SQLite compilation flags. `tauri-plugin-sql` uses `rusqlite` which may or may not include FTS5 (`SQLITE_ENABLE_FTS5`). Web browser (sql.js) typically includes it.

Strategy: **probe at startup, degrade to LIKE if unavailable**.

```typescript
// In migration runner or MemoryRepository init:
async function initFts5(db): Promise<boolean> {
  try {
    await db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
        content,
        content=memory_entries,
        content_rowid=rowid,
        tokenize='unicode61'
      );
      -- Note: rowid is SQLite's implicit integer rowid, not memory_id TEXT PK.
      -- TEXT PRIMARY KEY tables still have an implicit rowid.
    `);
    // Create sync triggers...
    return true;  // FTS5 available
  } catch {
    return false;  // Degrade to LIKE queries
  }
}
```

FTS5 sync triggers (only created if FTS5 probe succeeds):

```sql
CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE OF content ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO memory_entries_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

Fallback search when FTS5 unavailable:

```sql
-- FTS5: SELECT * FROM memory_entries_fts WHERE content MATCH ? ORDER BY rank
-- LIKE:  SELECT * FROM memory_entries WHERE content LIKE '%' || ? || '%' ORDER BY importance DESC
```

### Layer 2: MemoryRepository + MemoryService

```typescript
// MemoryRepository interface (in runtime/repositories.ts)
interface MemoryRepository {
  create(entry: MemoryEntryCreate): Promise<MemoryEntry>;
  findById(memoryId: string): Promise<MemoryEntry | null>;
  search(query: string, opts: {
    scope?: MemoryScope;
    ownerId?: string;
    companyId: string;
    limit?: number;
  }): Promise<MemoryEntry[]>;  // FTS5 MATCH or LIKE fallback
  update(memoryId: string, patch: Partial<MemoryEntryUpdate>): Promise<void>;
  delete(memoryId: string): Promise<void>;
  findByOwner(ownerId: string, opts?: { category?: string; limit?: number }): Promise<MemoryEntry[]>;
  touchAccess(memoryId: string): Promise<void>;  // update accessed_at + access_count
}

// MemoryService wraps repository + adds business logic
class MemoryService {
  constructor(private repo: MemoryRepository, private llmGateway: LlmGateway) {}

  // Called before employee execution: retrieve relevant memories
  async getRelevantMemories(employeeId: string, companyId: string, taskContext: string): Promise<MemoryEntry[]> {
    // 1. Employee's own memories (scope: 'employee', owner: employeeId)
    // 2. Team memories (scope: 'team', owner: companyId)
    // 3. Company memories (scope: 'company', owner: companyId)
    // Merge, rank by FTS5 score * importance * recency, return top-5
  }

  // Called after employee execution: optional reflection pass
  // Cost control: only for task_type !== 'direct_chat', configurable via flag
  async reflectAndRemember(
    employeeId: string,
    companyId: string,
    taskOutput: string,
    runtimeCtx: RuntimeContext,
    opts?: { skip?: boolean }
  ): Promise<void> {
    if (opts?.skip) return;
    // LLM call: "Based on this task output, is there anything worth remembering?"
    // If yes, creates memory_entries with appropriate scope/category
    // Uses prompt-based JSON extraction (same pattern as Subsystem A)
  }
}
```

**Reflection cost control**: `reflectAndRemember` adds 1 LLM call per task. To control costs:
- Skip for `direct_chat` tasks (short, conversational)
- Skip for `handoff_continuation` tasks (receiving employee hasn't done enough to reflect)
- Future: configurable in company settings

### Layer 3: Memory tools for agents (Letta pattern)

Three **virtual tools** (not MCP) injected into employee's LLM call alongside `handoff_to`:

```typescript
// remember: agent actively stores a memory
{
  name: 'remember',
  description: 'Store something important for future reference.',
  parameters: {
    content: { type: 'string', description: 'What to remember' },
    category: { type: 'string', enum: ['experience', 'decision', 'knowledge', 'preference'] },
    scope: { type: 'string', enum: ['employee', 'team'], default: 'employee' },
    importance: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
  }
}

// recall: agent actively searches memory
{
  name: 'recall',
  description: 'Search your memories for relevant past experiences.',
  parameters: {
    query: { type: 'string', description: 'What to search for' },
    scope: { type: 'string', enum: ['employee', 'team', 'company'] },
  }
}

// forget: agent actively removes outdated memory
{
  name: 'forget',
  description: 'Remove a memory that is no longer accurate or relevant.',
  parameters: {
    memoryId: { type: 'string' },
  }
}
```

These tools are handled in the same tool-calling loop as `handoff_to`, dispatched to `MemoryService` instead of `ToolExecutor`.

### Memory injection flow

```
employee_node entry:
  1. MemoryService.getRelevantMemories(employeeId, companyId, taskDescription)
  2. Inject top-5 as system prompt section:
     "## Your memories\n- [experience] Last time I did auth, JWT worked better than sessions\n- ..."
  3. Add remember/recall/forget to available tools (alongside handoff_to + MCP tools)
  4. Employee executes task (may call remember/recall during execution)
  5. After task completion (not handoff, not error):
     MemoryService.reflectAndRemember() — one LLM call
```

### Memory scopes explained

| Scope | Owner | Visibility | Example |
|-------|-------|-----------|---------|
| `employee` | employee_id | Only this employee | "I prefer TypeScript over JavaScript" |
| `team` | company_id | All employees in company | "The auth module uses JWT, decided in meeting-123" |
| `company` | company_id | All employees + injected by default | "Code style: use functional components" |

Company-scope memories are seeded from SOP/configuration, not created by agents. Employee and team memories are created by agents via `remember` tool.

### What this does NOT do

- No vector embeddings (deferred; FTS5/LIKE is sufficient for P2, sqlite-vec for later)
- No Mem0-style dedup/conflict resolution (simple near-duplicate check via FTS5 instead)
- No cross-company memory sharing
- No memory size limits (add garbage collection in P3 based on access_count + age)

### Test plan

- Unit: MemoryRepository CRUD + FTS5 search + LIKE fallback (both paths)
- Unit: MemoryService.getRelevantMemories with mixed scopes
- Unit: Memory tools (remember/recall/forget) in tool-calling loop
- Unit: FTS5 probe — success and failure paths
- Integration: employee executes task → calls remember → next task for same employee → memories injected in prompt
- Edge: CJK text search, empty memories, importance ranking, access_count increment

---

## Cross-Cutting Concerns

### New shared-types additions

```typescript
// events.ts
type EventFamily +=
  | 'meeting.action.created'
  | 'handoff.initiated'
  | 'handoff.completed'
  | 'memory.created'
  | 'memory.accessed'

// New payload interfaces (5 total, see subsystem details above)
```

### RuntimeContext changes

```typescript
interface RuntimeRepositories {
  // ... existing repos ...
  memories: MemoryRepository;  // NEW
}

interface RuntimeContext {
  // ... existing fields ...
  memoryService: MemoryService;  // NEW — wraps MemoryRepository + business logic
}
```

### Graph state changes

```typescript
// AicsGraphAnnotation additions:
handoffCount: Annotation<number>({   // default: 0, no reducer needed (last-write-wins is correct)
  default: () => 0,
}),
meetingActionItems: Annotation<MeetingActionItem[]>({
  default: () => [],
}),
```

`handoffCount` uses last-write-wins (default LangGraph behavior). This is correct because only `employeeNode` writes it, and Command updates are atomic.

### Migration sequence

```
005_memory_system.sql  — memory_entries table + indexes (FTS5 created at runtime via probe)
```

Additionally, Phase 0 includes a code-level fix aligning status values to existing DB constraints (no new migration — just fix code to use `'running'` instead of `'active'`, `'completed'` instead of `'ended'`).

---

## Parallel development strategy

| Subsystem | Touches | Can start after | Merge order |
|-----------|---------|-----------------|-------------|
| Phase 0: shared-types + state + status fix | shared-types, state.ts, meeting-subgraph.ts, employee-node.ts | nothing | **First** |
| A: Meeting actions | meeting-subgraph.ts, boss-summary-node.ts | Phase 0 | Second (parallel with B) |
| B: Handoff | employee-node.ts, event-factories.ts | Phase 0 | Second (parallel with A) |
| C: Memory | NEW files + employee-node.ts | Phase 0 + B merged | **Last** (depends on B's employee-node changes) |

A and B are truly parallel (touch different files except shared-types which is done in Phase 0). C must wait for B because both modify `employee-node.ts` — C builds on B's tool injection mechanism.

---

## Estimated scope

| Subsystem | New files | Modified files | New tests | LLM calls added per run |
|-----------|-----------|---------------|-----------|------------------------|
| Phase 0 | 0 | 4 (shared-types, state, meeting-subgraph, employee-node) | ~2 | 0 |
| A: Meeting actions | 0 | 3 (meeting-subgraph, boss-summary, event-factories) | ~6 | +1 (structured extraction) |
| B: Handoff | 0 | 3 (employee-node, event-factories, shared-types) | ~8 | 0 (tool call, not extra LLM) |
| C: Memory | ~6 (migration, drizzle schema, repo interface, memory repo, memory service, memory tools) | 3 (employee-node, runtime-context, repositories) | ~12 | +1 (reflection, skippable) |

**Total**: ~6 new files, ~9 modified files, ~28 new tests, +2 LLM calls per full run (1 skippable).
