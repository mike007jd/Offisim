# Phase 2.0 — Core Runtime Engine Design

> Approved: 2026-03-07
> Scope: `packages/core`, `packages/shared-types` expansion, `packages/db-local` repository layer
> Approach: LangGraph.js native orchestration + Anthropic/OpenAI dual native adapters
> Not in scope: install pipeline, PixiJS scene, platform API, streaming

---

## 1. Architecture Layering

### Package responsibilities

| Package | Phase 2.0 role |
|---|---|
| `packages/core` | LangGraph graph, LLM adapters, agent nodes, event bus, repositories |
| `packages/shared-types` | Expand with event payload types + model profile types |
| `packages/db-local` | Schema already exists; core consumes via repository interfaces |

### Code lives in `packages/core/src/`

```
llm/        — LLM Gateway interface + provider adapters
agents/     — Graph node implementations (boss, manager, employee, error handler)
graph/      — StateGraph definition, meeting subgraph, checkpoint saver
events/     — EventBus interface + in-memory implementation + event factories
runtime/    — Repository interfaces + Drizzle/memory implementations + RuntimeContext
errors.ts   — Error class hierarchy
```

### Dependency direction

```
shared-types  (zero deps, pure types)
     ^
     |
  db-local    (drizzle-orm, better-sqlite3)
     ^
     |
    core      (@langchain/langgraph, @anthropic-ai/sdk, openai, shared-types, db-local)
```

---

## 2. LLM Gateway Layer

### Interface

```typescript
interface LlmGateway {
  chat(request: LlmRequest): Promise<LlmResponse>;
}

interface LlmRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];
}

interface LlmResponse {
  content: string;
  toolCalls: ToolCallResult[];
  usage: { inputTokens: number; outputTokens: number };
}
```

### Adapters

- **AnthropicAdapter** — wraps `@anthropic-ai/sdk`, maps request/response format
- **OpenAiAdapter** — wraps `openai` SDK, maps request/response format

Both implement `LlmGateway`. Both handle retries internally (429/5xx: exponential backoff, max 3 attempts).

### Model Resolver

Maps abstract profiles to concrete provider+model pairs.

Resolution chain:
1. `employee.config_json.preferred_model_profile`
2. fallback: `company.default_model_policy_json`
3. fallback: hardcoded default (`anthropic / claude-sonnet`)

### Phase 2.0 boundaries

- No streaming — `chat()` returns a complete `LlmResponse`
- No function calling routing through LangChain's ChatModel abstraction
- Streaming deferred to Phase 2.1

---

## 3. LangGraph Topology & Agent Roles

### Entry modes (aligned with `graph_threads.entry_mode`)

| `entry_mode` | Trigger | Initial node | Phase 2.0 |
|---|---|---|---|
| `boss_chat` | User input in UI | `boss` node | Implemented |
| `meeting` | User initiates meeting | `meeting_coordinator` | Implemented |
| `install_flow` | User triggers install | — | Placeholder only |
| `background_sync` | Background task | — | Placeholder only |

### Main graph topology

```
                    +----------+
         user msg → |   Boss   | ← sole human interaction entry
                    +----+-----+
                         | route_decision
               +---------+----------+
               v         v          v
          +--------+ +--------+ +----------+
          |Manager | |Meeting | |  Direct  |
          |(route) | |Subgraph| | Response |
          +---+----+ +--------+ +----------+
              | assign_employee
        +-----+------+
        v     v      v
   +--------+ ... +--------+
   |Employee|     |Employee|    (PM is a role_slug, not a hardcoded node)
   | Agent  |     | Agent  |
   +---+----+     +---+----+
       | result       |
       +------+-------+
              v
         +---------+
         | Review /| ← Manager reviews results
         | Handoff |
         +----+----+
              v
         +---------+
         |  Boss   | ← present to user / decide next step
         | Summary |
         +---------+
```

### Graph state

```typescript
interface AicsGraphState {
  threadId: string;
  companyId: string;
  entryMode: 'boss_chat' | 'meeting' | 'install_flow' | 'background_sync';
  messages: BaseMessage[];
  routeDecision: 'direct_reply' | 'delegate_manager' | 'start_meeting' | null;
  currentTaskRunId: string | null;
  currentEmployeeId: string | null;
  pendingAssignments: Array<{
    taskType: string;
    employeeId: string;
    inputJson: Record<string, unknown>;
  }>;
  completed: boolean;
  interruptReason: string | null;
}
```

### Key nodes

- **Boss Node** — receives user messages, parses intent, routes to manager/meeting/direct. Interrupt point for user input.
- **Manager Node** — evaluates complexity, selects employee, splits tasks via `parent_task_run_id`. Records `handoff_events`.
- **Employee Node** — driven by `role_slug` + `persona_json` + `config_json`. Executes LLM call, records `tool_calls` and `task_runs`.
- **Error Handler Node** — catches unrecoverable errors, writes failure state, injects friendly message for Boss Summary.

### Meeting subgraph

- Independent subgraph with turn control
- Creates `meeting_sessions` record
- Participants speak in turns (Employee -> Employee cycle)
- Produces `summary_json` on completion
- May generate new `task_runs` post-meeting
- Exit condition: fixed max turns (10) OR moderator LLM judges end, whichever comes first

### Checkpoint mapping

| LangGraph event | `checkpoint_kind` | Content |
|---|---|---|
| Node completion | `node_complete` | node name + serialized state |
| User interrupt | `interrupt` | full state snapshot |
| Meeting turn end | `meeting_turn` | current speaker + turn count |

Custom `CheckpointSaver` persists to `graph_checkpoints` table.

`graph_threads.status` lifecycle: `running` -> `interrupted` -> `running` -> `completed` / `failed`

### Handoff protocol

```
Boss -> Manager:    handoff(from=null, to=manager, reason="route_task")
Manager -> Employee: handoff(from=manager, to=employee_x, reason="assign_subtask")
Employee -> Manager: handoff(from=employee_x, to=manager, reason="task_complete")
Manager -> Boss:    handoff(from=manager, to=null, reason="all_subtasks_done")
```

`from_employee_id = null` = from Boss (user agent); `to_employee_id = null` = back to Boss.

### Interrupt points

1. **Boss Interrupt** — graph pauses at Boss Summary, awaiting next user message
2. **Confirmation Interrupt** — Employee requests confirmation before sensitive operations

Resume: restore state from `graph_checkpoints`, `graph_threads.status` = `interrupted` -> `running`.

### Phase 2.0 constraints

- One level of task splitting only (Manager -> N subtasks, no recursion)
- PM is a regular Employee with `role_slug = 'pm'`, not a hardcoded graph node

---

## 4. Event System & Runtime Events

### Architecture

```
LangGraph Nodes --emit--> EventBus --persist--> runtime_events (SQLite)
                              |
                              +--broadcast--> UI / Scene / Future consumers
```

### EventBus interface

```typescript
type EventHandler<T = unknown> = (event: RuntimeEvent<T>) => void;

interface EventBus {
  emit(event: RuntimeEvent): void;
  on(prefix: string, handler: EventHandler): () => void;
  once(prefix: string, handler: EventHandler): () => void;
  removeAll(): void;
}
```

Phase 2.0: in-memory EventEmitter implementation. No Redis/message queue.

### Event families and payload types

| EventFamily | Payload | Trigger |
|---|---|---|
| `employee.state.changed` | `{ employeeId, prev, next, taskRunId? }` | Employee state transition |
| `task.state.changed` | `{ taskRunId, prev, next, employeeId? }` | TaskRun state transition |
| `task.assignment.changed` | `{ taskRunId, employeeId, action }` | Manager assigns/unassigns |
| `meeting.state.changed` | `{ meetingId, prev, next, participantIds }` | Meeting state transition |
| `runtime.performance.tier.changed` | `{ prev, next }` | Not triggered in Phase 2.0 |

Each payload carries `prev` + `next` state values so consumers can determine transition direction without DB queries.

### Persistence

Events written to `runtime_events` table via `EventBus.emit()` internals.

Severity derivation:
- `*.failed` -> `error`
- `*.blocked` / `*.cancelled` -> `warn`
- everything else -> `info`

### RuntimeEvent extension

`shared-types` `RuntimeEvent` will be extended with `companyId` (required) and `threadId` (optional) fields for multi-company isolation and audit.

---

## 5. Repository Layer & Employee Building

### Repository pattern

`packages/core` does not write Drizzle queries directly. Repository interfaces isolate data access for testability and future storage backend flexibility.

### Repository interfaces

```typescript
interface ThreadRepository {
  create(thread: NewGraphThread): Promise<GraphThread>;
  findById(threadId: string): Promise<GraphThread | null>;
  updateStatus(threadId: string, status: string): Promise<void>;
}

interface TaskRunRepository {
  create(taskRun: NewTaskRun): Promise<TaskRun>;
  findById(taskRunId: string): Promise<TaskRun | null>;
  findByThread(threadId: string): Promise<TaskRun[]>;
  updateStatus(taskRunId: string, status: string, output?: unknown): Promise<void>;
}

interface EmployeeRepository {
  findById(employeeId: string): Promise<Employee | null>;
  findByCompany(companyId: string): Promise<Employee[]>;
  findByRole(companyId: string, roleSlug: string): Promise<Employee[]>;
}

interface ToolCallRepository {
  create(toolCall: NewToolCall): Promise<ToolCall>;
  updateResult(toolCallId: string, status: string, response: unknown): Promise<void>;
}

interface HandoffRepository {
  create(handoff: NewHandoffEvent): Promise<HandoffEvent>;
  findByThread(threadId: string): Promise<HandoffEvent[]>;
}

interface MeetingRepository {
  create(meeting: NewMeetingSession): Promise<MeetingSession>;
  findById(meetingId: string): Promise<MeetingSession | null>;
  updateStatus(meetingId: string, status: string, summary?: unknown): Promise<void>;
}

interface CheckpointRepository {
  save(checkpoint: NewGraphCheckpoint): Promise<void>;
  findLatest(threadId: string): Promise<GraphCheckpoint | null>;
  findBySeq(threadId: string, seq: number): Promise<GraphCheckpoint | null>;
}

interface RuntimeRepositories {
  threads: ThreadRepository;
  taskRuns: TaskRunRepository;
  employees: EmployeeRepository;
  toolCalls: ToolCallRepository;
  handoffs: HandoffRepository;
  meetings: MeetingRepository;
  checkpoints: CheckpointRepository;
}
```

Two implementations:
- `DrizzleRepositories` — production, backed by `db-local` schema
- `MemoryRepositories` — testing, in-memory maps

Event persistence is internal to `EventBus`, not exposed as a Repository (append-only audit, no update/delete).

### RuntimeContext

```typescript
interface RuntimeContext {
  repos: RuntimeRepositories;
  eventBus: EventBus;
  llmGateway: LlmGateway;
  modelResolver: ModelResolver;
  companyId: string;
  threadId: string;
}
```

Injected via `RunnableConfig.configurable`. No global singletons, no DI framework. Each graph invocation creates its own `RuntimeContext` for multi-company concurrency safety.

### Employee building

Employee LLM configuration assembled from:
1. Role template (from `role_slug`)
2. Persona overlay (from `persona_json`)
3. Company context (from `companies` table)
4. Current task context (from `task_runs.input_json`)

Model resolution: `employee.config_json.preferred_model_profile` -> fallback `company.default_model_policy_json` -> resolve to `{ provider, model, temperature, maxTokens }`.

`persona_json` parsing must be fault-tolerant (try-catch, degrade to empty object on parse failure).

### Tool execution (Phase 2.0 skeleton)

```typescript
interface ToolExecutor {
  execute(call: ToolCallRequest): Promise<ToolCallResult>;
  listAvailable(companyId: string): Promise<ToolDef[]>;
}
```

Phase 2.0: `MockToolExecutor` only. Real MCP/rack routing deferred to Phase 2.1. `tool_calls` table is written for audit purposes even with mock executor.

---

## 6. Testing Strategy & Error Handling

### Test pyramid

```
     Integration tests (~10-15)     ← full graph flow with mock LLM
   Unit tests (~40-60)              ← individual module logic
  Type checks (tsc --noEmit)        ← already exists
```

### Mock LLM

`MockLlmGateway` implements `LlmGateway`:
- `whenSystemContains(keyword, response)` — keyword-based matching
- `whenEmployeeRole(roleSlug, response)` — role-based matching
- `pushResponse(r1, r2, ...)` — sequential mode for precise control
- Default fallback returns generic response

### Unit test coverage

| Module | Focus | Est. count |
|---|---|---|
| LLM adapters | request/response mapping, error translation | 8-10 |
| ModelResolver | profile parsing, fallback chain, invalid input | 6-8 |
| EventBus | emit/on/once/removeAll, prefix matching | 6-8 |
| Employee builder | prompt assembly, persona fault tolerance | 6-8 |
| Drizzle repositories | CRUD correctness (in-memory SQLite) | 10-15 |
| CheckpointSaver | save/load, sequence increment, thread isolation | 4-6 |

### Integration test scenarios

1. **boss_chat full flow** — user message -> boss -> manager -> employee -> result. Verify DB persistence + event stream + handoff chain.
2. **interrupt and resume** — trigger interrupt, restore from checkpoint, verify completion.
3. **meeting subgraph** — multi-turn meeting, verify `meeting_sessions` + `summary_json`.

### Test helper

```typescript
function createTestRuntime() {
  // in-memory SQLite + Drizzle repos
  // MockLlmGateway + StaticModelResolver
  // InMemoryEventBus
  // Returns { graph, repos, eventBus, gateway, db }
}
```

### Error class hierarchy

```typescript
class AicsError extends Error {
  code: string;
  recoverable: boolean;
}
class LlmError extends AicsError { provider: string; statusCode?: number; }
class GraphError extends AicsError { nodeName: string; }
class DataError extends AicsError {}
```

### Error handling rules

| Error type | Handling | Graph state |
|---|---|---|
| LLM 429 (rate limit) | Auto retry 3x, exponential backoff | Node retry |
| LLM 5xx | Auto retry 2x | Node retry |
| LLM 4xx | Log error, task_run -> failed | Route to error node |
| Persona parse failure | Degrade to empty persona, continue | Normal |
| DB write failure | Throw DataError, graph terminates | thread -> failed |
| Node timeout (60s) | Cancel LLM call | task_run -> failed |

Retry logic lives in the adapter layer, not in graph nodes.

Error handler node: writes `task_runs.status = 'failed'`, emits `task.state.changed` (severity: error), injects friendly error message into messages for Boss Summary.

---

## 7. File Structure & Dependencies

### `packages/core/src/` directory

```
index.ts
llm/
  gateway.ts
  anthropic-adapter.ts
  openai-adapter.ts
  model-resolver.ts
  errors.ts
agents/
  boss-node.ts
  manager-node.ts
  employee-node.ts
  error-handler-node.ts
  employee-builder.ts
graph/
  main-graph.ts
  meeting-subgraph.ts
  state.ts
  checkpoint-saver.ts
events/
  event-bus.ts
  event-factories.ts
  event-persister.ts
runtime/
  repositories.ts
  drizzle-repositories.ts
  memory-repositories.ts
  runtime-context.ts
  tool-executor.ts
errors.ts
__tests__/
  helpers/
    mock-gateway.ts
    test-runtime.ts
    fixtures.ts
  unit/
    anthropic-adapter.test.ts
    openai-adapter.test.ts
    model-resolver.test.ts
    event-bus.test.ts
    employee-builder.test.ts
    checkpoint-saver.test.ts
    drizzle-repositories.test.ts
  integration/
    boss-chat-flow.test.ts
    interrupt-resume.test.ts
    meeting-flow.test.ts
```

### `packages/shared-types` additions

- `events.ts` — extend `RuntimeEvent` with `companyId`/`threadId`, add typed payload interfaces
- `models.ts` — new file: `LlmProvider`, `ModelProfile`, `ModelPolicyConfig`, `ResolvedModel`

### New dependencies

| Package | Dependency | Type |
|---|---|---|
| `packages/core` | `@langchain/langgraph` | prod |
| `packages/core` | `@langchain/core` | prod |
| `packages/core` | `@anthropic-ai/sdk` | prod |
| `packages/core` | `openai` | prod |
| `packages/core` | `better-sqlite3` | dev |
| `packages/core` | `@types/better-sqlite3` | dev |

Not added:
- `@langchain/anthropic` / `@langchain/openai` — custom adapters instead
- `zod` — AJV + TypeScript types sufficient
- `eventemitter3` — custom EventBus preferred for control

### Public API exports from `packages/core`

Types: `RuntimeContext`, `RuntimeRepositories`, `LlmGateway`, `LlmRequest`, `LlmResponse`, `EventBus`, `ToolExecutor`

Factories: `buildAicsGraph`, `createRuntimeContext`, `createDrizzleRepositories`, `AnthropicAdapter`, `OpenAiAdapter`, `ModelResolver`, `InMemoryEventBus`

Errors: `AicsError`, `LlmError`, `GraphError`, `DataError`

Internal implementation (graph state, node functions, repository implementations) is not exported.

---

## Design decisions log

| Decision | Rationale |
|---|---|
| LangGraph.js as orchestration kernel | ENGINEERING_RULES mandates it; native checkpoint/interrupt/subgraph support |
| Custom LLM adapters (not LangChain providers) | Thinner, no unnecessary LangChain abstraction layer |
| Anthropic + OpenAI dual native | User choice; covers majority of use cases |
| Repository pattern over direct Drizzle | Testability + future storage backend flexibility |
| In-memory EventBus | Single-process Tauri runtime; no need for message queue |
| No streaming in Phase 2.0 | Simplifies initial implementation; deferred to Phase 2.1 |
| One-level task splitting only | Avoids recursive complexity explosion |
| PM as Employee role, not hardcoded node | Maintains topology flexibility for user-installed PM packages |
| `@langchain/core` BaseMessage stays internal | shared-types must not depend on LangChain |
| Event payloads carry prev+next states | Consumers avoid DB queries for transition direction |
