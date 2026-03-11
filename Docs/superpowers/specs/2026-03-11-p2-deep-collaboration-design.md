# P2 Design: Deep Multi-Agent Collaboration

**Date**: 2026-03-11
**Status**: Draft
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
- **LangGraph** (Command pattern for handoffs, withStructuredOutput)
- **Instructor** (action-item schema with dependencies)

### Existing infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| Meeting subgraph | Working | 10-turn participant rotation, meetingEndNode produces summary |
| `handoff_events` table | Schema exists | Never written to; no graph logic |
| `meeting_sessions` table | Working | topic, status, summary_json |
| EventBus | 29 event types | Extensible via shared-types |
| LangGraph StateGraph | 10 nodes | Supports Command pattern natively |
| ToolExecutor | Working | MCP tool execution for employees |

---

## Subsystem A: Meeting Action-Item Extraction

### Goal

When a meeting ends, extract structured action items and decisions from the transcript, create TaskRuns, and present a summary to the user via boss_summary.

### Design

**Change scope**: `meetingEndNode` in `meeting-subgraph.ts`, new Zod schema, boss_summary output enhancement.

**Step 1 — Structured extraction in meetingEndNode**

After collecting all participant turns, call LLM with `withStructuredOutput`:

```typescript
const MeetingOutputSchema = z.object({
  summary: z.string().describe('Concise meeting summary'),
  actionItems: z.array(z.object({
    description: z.string(),
    assigneeId: z.enum(employeeIds),  // constrained to known employees
    priority: z.enum(['high', 'medium', 'low']),
    dependsOn: z.array(z.number()).default([]),  // indexes into this array
  })),
  decisions: z.array(z.string()).describe('Key decisions reached'),
});
```

The `employeeIds` enum is built dynamically from `runtimeCtx.repos.employees.findByCompany()` at node entry. This eliminates fuzzy matching.

**Step 2 — TaskRun creation**

For each action item:
- Create `TaskRun` with `task_type: 'meeting_action'`, `status: 'queued'`, `employee_id: assigneeId`
- Store `dependsOn` in `input_json` for future dependency-aware scheduling
- Emit `meeting.action.created` event

**Step 3 — Boss summary integration**

`meetingEndNode` returns action items metadata in state. `bossSummaryNode` incorporates them into the user-facing summary:

> "Meeting concluded. 3 action items created: [high] Bob — implement auth module, [medium] Alice — write tests, [low] Carol — update docs."

Action items are queued, not immediately executed. The user can trigger them via future task board (P3) or by asking boss "execute the meeting action items."

**Step 4 — New events**

```typescript
// shared-types/events.ts additions
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

- Unit: meetingEndNode with mock LLM returning structured output → verify TaskRun creation + events
- Unit: Zod schema validation with edge cases (empty action items, circular dependsOn)
- Integration: full meeting flow → meetingEnd → boss_summary includes action items

---

## Subsystem B: Explicit Handoff via Command Pattern

### Goal

Allow an employee to hand off work to another employee mid-execution, with structured context transfer (not chat history). Write to `handoff_events` table for audit trail.

### Design

**Change scope**: `employee-node.ts` enhanced, new handoff event types, `handoff_events` table populated.

**Approach: Command pattern inside employee_node**

Instead of adding a separate `handoff_check_node` (which adds graph topology complexity), use LangGraph's `Command` pattern. After task completion, the employee LLM can decide whether handoff is needed:

```typescript
// In employee-node.ts, after LLM response:
if (llmResponse includes handoff signal) {
  // Write handoff record
  await runtimeCtx.repos.handoffs.create({
    handoff_id: `ho-${Date.now()}`,
    thread_id: state.threadId,
    from_employee_id: currentEmployee.employee_id,
    to_employee_id: targetEmployeeId,
    reason: handoffReason,
    payload_json: JSON.stringify(handoffContext),  // structured, not chat
  });

  // Emit event
  runtimeCtx.eventBus.emit(handoffInitiated(...));

  // Return Command to re-enter employee node with new assignment
  return Command({
    goto: 'employee',
    update: {
      pendingAssignments: [{
        taskType: 'handoff_continuation',
        employeeId: targetEmployeeId,
        inputJson: {
          description: handoffContext.taskDescription,
          priorWork: handoffContext.completedOutput,  // artifact, not messages
          handoffReason,
          taskRunId: newTaskRunId,
        },
      }],
    },
  });
}
```

**Handoff detection mechanism**

Two approaches evaluated:

| Approach | Pro | Con |
|----------|-----|-----|
| LLM tool call (`handoff_to` tool) | Natural, LLM decides | Extra tool, prompt engineering |
| Post-hoc LLM check | Separate concern | Extra LLM call per task |

**Chosen: LLM tool call.** Add a `handoff_to` tool to the employee's available tools when multiple employees exist in the company. The tool schema:

```typescript
{
  name: 'handoff_to',
  description: 'Hand off this task to another employee who is better suited',
  parameters: {
    targetEmployeeId: z.enum(colleagueIds),
    reason: z.string(),
    completedWork: z.string().describe('Summary of what you have done so far'),
    remainingWork: z.string().describe('What the next employee should do'),
  }
}
```

This is an artifact-driven handoff (MetaGPT pattern): the receiving employee gets `completedWork` + `remainingWork`, not the full conversation history.

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

**Guard rails**

- Max 3 handoffs per graph run (prevent infinite delegation loops)
- Employee cannot hand off to themselves
- `handoff_to` tool only available when `pendingAssignments[0].taskType !== 'handoff_continuation'` (prevent chain handoff without work)

### What this does NOT do

- Does not implement swarm-style peer-to-peer handoff (AICS is hierarchical)
- Does not allow handoff during meetings (meeting participants are fixed per session)
- Does not add a separate handoff_check node (Command pattern handles it inline)

### Test plan

- Unit: employee-node with mock LLM calling `handoff_to` tool → verify Command return, handoff_events write, events emitted
- Unit: guard rails — self-handoff rejected, max 3 handoffs enforced, chain handoff blocked
- Integration: boss → manager → pm → employee A → handoff → employee B → boss_summary

---

## Subsystem C: 3-Layer Agent Memory

### Goal

Give employees persistent memory across sessions: personal experience, team knowledge, and company rules. Agent self-manages memory via tool calls (Letta/MemGPT pattern).

### Design

**Change scope**: new `memory_entries` table + FTS5, new MemoryRepository, memory tools injected into ToolExecutor, employee-node prompt enhancement.

### Layer 1: Database schema

```sql
-- New migration: 006_memory_system.sql

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

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
  content,
  content=memory_entries,
  content_rowid=rowid,
  tokenize='unicode61'
);

-- Triggers to keep FTS5 in sync
CREATE TRIGGER memory_fts_insert AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER memory_fts_delete AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER memory_fts_update AFTER UPDATE OF content ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO memory_entries_fts(rowid, content) VALUES (new.rowid, new.content);
END;
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
  }): Promise<MemoryEntry[]>;  // FTS5 MATCH query
  update(memoryId: string, patch: Partial<MemoryEntryUpdate>): Promise<void>;
  delete(memoryId: string): Promise<void>;
  findByOwner(ownerId: string, opts?: { category?: string; limit?: number }): Promise<MemoryEntry[]>;
  touchAccess(memoryId: string): Promise<void>;  // update accessed_at + access_count
}

// MemoryService wraps repository + adds business logic
class MemoryService {
  // Called before employee execution: retrieve relevant memories
  async getRelevantMemories(employeeId: string, companyId: string, taskContext: string): Promise<MemoryEntry[]> {
    // 1. Employee's own memories (scope: 'employee', owner: employeeId)
    // 2. Team memories (scope: 'team', owner: companyId)
    // 3. Company memories (scope: 'company', owner: companyId)
    // Merge, rank by FTS5 score * importance * recency, return top-K
  }

  // Called after employee execution: optional reflection pass
  async reflectAndRemember(employeeId: string, taskOutput: string, runtimeCtx: RuntimeContext): Promise<void> {
    // LLM decides: is there anything worth remembering?
    // If yes, creates memory_entries with appropriate scope/category
  }
}
```

### Layer 3: Memory tools for agents (Letta pattern)

Three tools injected into every employee's ToolExecutor:

```typescript
// remember: agent actively stores a memory
{
  name: 'remember',
  description: 'Store something important for future reference. Use for lessons learned, user preferences, project decisions, or useful patterns.',
  parameters: {
    content: z.string().describe('What to remember'),
    category: z.enum(['experience', 'decision', 'knowledge', 'preference']),
    scope: z.enum(['employee', 'team']).default('employee'),
    importance: z.number().min(0).max(1).default(0.5),
  }
}

// recall: agent actively searches memory
{
  name: 'recall',
  description: 'Search your memories for relevant past experiences, decisions, or knowledge.',
  parameters: {
    query: z.string().describe('What to search for'),
    scope: z.enum(['employee', 'team', 'company']).optional(),
  }
}

// forget: agent actively removes outdated memory
{
  name: 'forget',
  description: 'Remove a memory that is no longer accurate or relevant.',
  parameters: {
    memoryId: z.string(),
  }
}
```

### Memory injection flow

```
employee_node entry:
  1. MemoryService.getRelevantMemories(employeeId, companyId, taskDescription)
  2. Inject top-5 as system prompt section:
     "## Your memories\n- [experience] Last time I did auth, JWT worked better than sessions\n- ..."
  3. Add remember/recall/forget to available tools
  4. Employee executes task (may call remember/recall during execution)
  5. After task: MemoryService.reflectAndRemember() — one extra LLM call
     asking "Is there anything from this task worth remembering?"
```

### Memory scopes explained

| Scope | Owner | Visibility | Example |
|-------|-------|-----------|---------|
| `employee` | employee_id | Only this employee | "I prefer TypeScript over JavaScript" |
| `team` | company_id | All employees in company | "The auth module uses JWT, decided in meeting-123" |
| `company` | company_id | All employees + injected by default | "Code style: use functional components" |

Company-scope memories are seeded from SOP/configuration, not created by agents. Employee and team memories are created by agents via `remember` tool.

### What this does NOT do

- No vector embeddings (deferred; FTS5 is sufficient for P2, sqlite-vec for later)
- No Mem0-style dedup/conflict resolution (LLM overhead too high for MVP; simple FTS5 match to check for near-duplicates instead)
- No cross-company memory sharing
- No memory size limits (add garbage collection in P3 based on access_count + age)

### Test plan

- Unit: MemoryRepository CRUD + FTS5 search (Drizzle + in-memory SQLite)
- Unit: MemoryService.getRelevantMemories with mixed scopes
- Unit: Memory tools (remember/recall/forget) through ToolExecutor
- Integration: employee executes task → calls remember → next task for same employee → memories injected in prompt
- Edge: FTS5 with CJK text (Chinese task descriptions), empty memories, importance ranking

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
handoffCount: number;  // tracks handoffs per run, for guard rail
meetingActionItems: MeetingActionItem[];  // populated by meetingEndNode, read by bossSummaryNode
```

### Migration sequence

```
006_memory_system.sql  — memory_entries table + FTS5 + triggers + indexes
```

`handoff_events` table already exists (migration 003). No new migration needed for handoff.

---

## Parallel development strategy

Three subsystems have zero code dependencies on each other:

| Subsystem | Touches | Can start after |
|-----------|---------|-----------------|
| A: Meeting actions | meeting-subgraph.ts, boss-summary-node.ts, shared-types | shared-types events defined |
| B: Handoff | employee-node.ts, shared-types, handoff repo | shared-types events defined |
| C: Memory | NEW files (memory table, repo, service, tools), employee-node.ts | migration created |

**Merge order**: shared-types first (all 3 depend on new event types) → A and B in parallel → C last (touches employee-node which B also touches).

Actually: define shared-types events + graph state changes as Phase 0, then dispatch A/B/C as parallel agents.

---

## Estimated scope

| Subsystem | New files | Modified files | New tests | LLM calls added per run |
|-----------|-----------|---------------|-----------|------------------------|
| A: Meeting actions | 0 | 3 (meeting-subgraph, boss-summary, shared-types) | ~6 | +1 (structured extraction) |
| B: Handoff | 0 | 3 (employee-node, shared-types, event-factories) | ~8 | 0 (tool call, not extra LLM) |
| C: Memory | ~6 (migration, schema, repo, service, tools, memory repo tests) | 3 (employee-node, runtime-context, repositories) | ~12 | +1 (reflection after task) |
| Phase 0 | 0 | 3 (shared-types, state, event-factories) | ~2 | 0 |

**Total**: ~6 new files, ~6 modified files, ~28 new tests.
