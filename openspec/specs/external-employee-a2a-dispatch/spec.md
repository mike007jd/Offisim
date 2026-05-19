# external-employee-a2a-dispatch Specification

## Purpose
Defines how external employees are represented and dispatched over A2A while preserving employee-semantic events, deliverables, and internal-employee behavior.
## Requirements
### Requirement: Employee schema carries external A2A dispatch fields

The `employees` table (**db-local SQLite only** — db-platform is marketplace schema and does not contain employees) and its `EmployeeRow` / `NewEmployee` / `EmployeeUpdate` types SHALL carry six columns that together identify an external (A2A-backed) employee and its remote endpoint: `is_external` (boolean, NOT NULL, default false), `a2a_url` (text, nullable), `a2a_token` (text, nullable), `a2a_agent_id` (text, nullable), `brand_key` (text, nullable), `agent_card_json` (text, nullable, cached A2A agent card at last discovery).

Internal employees (`is_external = false`) SHALL leave all five external-related columns null. External employees (`is_external = true`) SHALL carry at minimum a non-null `a2a_url`; `a2a_token`, `a2a_agent_id`, `brand_key`, `agent_card_json` MAY be null at creation and filled later by discovery / configuration.

#### Scenario: Internal employee has no external fields set
- **WHEN** an internal employee is created via `repos.employees.create({ ...internal fields, is_external: false })`
- **THEN** the resulting `EmployeeRow` has `is_external === false` and `a2a_url === null` / `a2a_token === null` / `a2a_agent_id === null` / `brand_key === null` / `agent_card_json === null`

#### Scenario: External employee requires a2a_url
- **WHEN** an external employee is created via `repos.employees.create({ ..., is_external: true, a2a_url: 'http://peer.example:18800', brand_key: 'custom' })`
- **THEN** the resulting `EmployeeRow` has `is_external === true` and `a2a_url === 'http://peer.example:18800'`

#### Scenario: Three-backend parity
- **WHEN** the same external employee is created via each of the three repo implementations (drizzle sqlite, memory, tauri-sql)
- **THEN** the returned `EmployeeRow` is byte-identical across backends for all six new columns

### Requirement: External employees dispatch via A2AClient, not LLM adapters

When `employee-node` dequeues a `PendingAssignment` whose target `EmployeeRow.is_external === true`, it SHALL route execution to an A2A transport path that invokes `A2AClient.sendAndWait` against the employee's `a2a_url` (used as the base for well-known agent card discovery, with `a2a_token` as bearer auth and `a2a_agent_id` as the target agent identifier). The LLM adapter / tool-loop pipeline used for internal employees SHALL NOT be invoked.

When the same `employee-node` dequeues a `PendingAssignment` whose target is an internal employee (`is_external === false`), the pre-existing LLM adapter pipeline (prompt-assembly → turn-runner → tool-loop) SHALL remain unchanged in behavior.

#### Scenario: External employee dispatch hits A2AClient
- **WHEN** `employee-node` runs with an assignment for an external employee
- **THEN** `A2AClient.sendAndWait(assignment.inputJson.description, { agentId: a2a_agent_id })` is invoked against the employee's `a2a_url`
- **AND** no internal LLM execution adapter (`AnthropicAdapter` / `OpenAiAdapter` / `ClaudeAgentSdkAdapter` / `OpenAiAgentsSdkAdapter`) is called for this assignment

#### Scenario: Internal employee dispatch unchanged
- **WHEN** `employee-node` runs with an assignment for an internal employee after this change
- **THEN** the event sequence and output path are identical to pre-change behavior — `graph.node.entered(employee)` / `employee.state.changed(idle→executing)` / `task.state.changed(queued→running)` / `task.subtask.progress(running)` / LLM turn / deliverable emission all occur in the same order and with the same payloads

### Requirement: External dispatch preserves employee-semantic event and deliverable shape

External employee dispatch SHALL emit the same event shapes as internal dispatch, with `assigneeKind: 'employee'` on subtask progress and task-assignment events, and `sourceKind: 'employee'` on any resulting deliverable. The `'department'` literal SHALL NOT appear in any event produced by external dispatch.

Task run status flow SHALL mirror internal employees: `queued → running → (completed | failed)`. A2A terminal state `TASK_STATE_COMPLETED` maps to `completed`; `TASK_STATE_FAILED` / `TASK_STATE_CANCELED` / `TASK_STATE_REJECTED` / timeout map to `failed` with a structured error payload written to `task_runs.output_json` in the form `{ error: { code, message, source: 'a2a' } }` (where `code` is `a2a_failed` / `a2a_canceled` / `a2a_rejected` / `a2a_transport` / `a2a_unconfigured`).

#### Scenario: Subtask progress events use employee assignee kind
- **WHEN** external dispatch emits `task.subtask.progress` events (running / done / failed)
- **THEN** every event's `assigneeKind` field is the literal `'employee'`, never `'department'`

#### Scenario: Deliverable sourceKind is employee
- **WHEN** an external employee's A2A task returns an artifact and a deliverable is emitted
- **THEN** the deliverable's `sources[0].sourceKind` field is the literal `'employee'`, never `'department'`

#### Scenario: A2A failure writes structured error
- **WHEN** `A2AClient.sendAndWait` throws or returns a task with terminal state `TASK_STATE_FAILED` / `TASK_STATE_CANCELED` / `TASK_STATE_REJECTED`, or the call times out, or the employee lacks `a2a_url`
- **THEN** the task run is updated to status `'failed'` with `output_json = JSON.stringify({ error: { code: <string>, message: <string>, source: 'a2a' } })`
- **AND** `task.state.changed(queued→failed)` and `task.subtask.progress(...,'failed')` are emitted with `assigneeKind: 'employee'`

### Requirement: External-department abstraction is removed from runtime and exports

The following symbols and files SHALL NOT exist after this change (zero grep matches in `packages/` and `apps/`, excluding `openspec/changes/archive/`): `ExternalDepartmentDefinition`, `ExternalDepartmentSeed`, `ExternalDepartmentStatus`, `ExternalDepartmentAvailability`, `ExternalDepartmentAuthState`, `defineExternalDepartments`, `matchExternalDepartments`, `formatExternalDepartmentCatalog`, `loadExternalDepartments`, `RuntimeContext.externalDepartments`, `departmentDispatcherNode`, `department_dispatcher` (graph node id), `routeFromDepartmentDispatcher`, `persistDepartmentOnlyPlan`, `recommendedDepartmentIds`.

The union members `assigneeKind: 'department'` (on `PendingAssignment` / `PlanTaskStep` / task events) and `sourceKind: 'department'` (on deliverables / step outputs) SHALL be removed from `packages/shared-types` and all consumers; the unions collapse to `'employee'` literal or the field is dropped where only one value remains.

The files `packages/core/src/a2a/external-departments.ts`, `packages/core/src/agents/department-dispatcher-node.ts`, and `apps/desktop/renderer/src/lib/external-departments.ts` SHALL be deleted.

The manager-node system prompt SHALL NOT contain the `"Available external departments"` section; external employees (if any) appear in the "Available employees" list with a trailing `[external:<brandKey>]` annotation.

#### Scenario: No external-department symbol survives
- **WHEN** `grep -rE 'ExternalDepartment|matchExternalDepartments|defineExternalDepartments|formatExternalDepartmentCatalog|loadExternalDepartments|departmentDispatcherNode|department_dispatcher|routeFromDepartmentDispatcher|persistDepartmentOnlyPlan|recommendedDepartmentIds' packages/ apps/ --include='*.ts' --include='*.tsx'` is run after this change
- **THEN** zero matches are returned (openspec archive directories are excluded from search)

#### Scenario: No 'department' literal in assignee/source kind unions
- **WHEN** `grep -rE "(assigneeKind|sourceKind)\s*[:=]\s*['\"]department['\"]" packages/ apps/ --include='*.ts' --include='*.tsx'` is run after this change
- **THEN** zero matches are returned

#### Scenario: Deleted files do not exist
- **WHEN** checking filesystem after this change
- **THEN** `packages/core/src/a2a/external-departments.ts`, `packages/core/src/agents/department-dispatcher-node.ts`, `apps/desktop/renderer/src/lib/external-departments.ts` all return ENOENT

### Requirement: A2A protocol layer is rewritten to v1.0

The protocol files `packages/core/src/a2a/a2a-client.ts`, `packages/core/src/a2a/a2a-server.ts`, and `packages/core/src/a2a/a2a-types.ts` SHALL be rewritten to implement **A2A Protocol v1.0** (https://a2a-protocol.org/latest/specification, verified via Context7 `/websites/a2a-protocol` on 2026-04-18). The previous v0.3.0 implementation SHALL be replaced in full, with no backwards-compatibility shim retained — Offisim is in prerelease and per `prelaunch_drop_dirty_data` there are no deployed v0.3.0 peers to preserve.

Specifically, the v1.0 implementation MUST:
1. **Agent Card**: expose `supportedInterfaces: Array<{ url, protocolBinding, protocolVersion }>` (replacing the v0.3 flat `url` + `preferredTransport`); carry `capabilities: { streaming?, pushNotifications?, stateTransitionHistory?, extendedAgentCard? }`; support optional `securitySchemes` / `security` / `defaultInputModes` / `defaultOutputModes` / `provider` / `iconUrl` / `version` / `documentationUrl` / `skills` / `signatures`.
2. **Endpoint discovery**: `A2AClient` SHALL fetch `{peer.url}/.well-known/agent-card.json` lazily on first RPC call, then resolve the RPC endpoint from `agentCard.supportedInterfaces[]` by selecting the first entry whose `protocolBinding === 'JSONRPC'`. The resolved endpoint and agent card SHALL be cached per client instance.
3. **JSON-RPC method names**: `SendMessage`, `GetTask`, `CancelTask`, `GetExtendedAgentCard` (PascalCase, replacing v0.3 `message/send` / `tasks/get`). `SendStreamingMessage` / `SubscribeToTask` / `ListTasks` are not required by this change but MAY be added later.
4. **Task state enum**: `'TASK_STATE_SUBMITTED' | 'TASK_STATE_WORKING' | 'TASK_STATE_INPUT_REQUIRED' | 'TASK_STATE_COMPLETED' | 'TASK_STATE_CANCELED' | 'TASK_STATE_FAILED' | 'TASK_STATE_REJECTED' | 'TASK_STATE_AUTH_REQUIRED' | 'TASK_STATE_UNKNOWN'` (replacing v0.3 lowercase literals).
5. **Part structure**: unified `Part` with optional one-of fields `text` / `raw` (base64) / `url` / `data`, plus shared `mediaType` (replacing v0.3 `mimeType`) and `filename`. The v0.3 discriminated `A2ATextPart` / `A2AFilePart` / `A2ADataPart` interfaces SHALL NOT exist in the type exports.
6. **Message**: carry mandatory `messageId` (v1.0 requirement) plus optional `contextId` / `taskId` / `role` / `parts` / `metadata` / `extensions` / `referenceTaskIds`.
7. **SendMessage result**: one-of `{ task, message }` per v1.0 (replacing v0.3 return-Task-directly).

Exports from `packages/core/src/a2a/index.ts`, `packages/core/src/index.ts`, and `packages/core/src/browser.ts` SHALL reflect the v1.0 type set (`A2AAgentInterface`, `A2AAgentCapabilities`, `A2ASendMessageResult` added; `A2ATextPart` / `A2AFilePart` / `A2ADataPart` removed). External-department re-exports SHALL NOT exist.

#### Scenario: Agent card v1.0 shape
- **WHEN** `A2AClient.getAgentCard()` returns
- **THEN** the returned object has `supportedInterfaces` as a non-empty array, each entry has `url` / `protocolBinding` / `protocolVersion` fields
- **AND** the object does NOT carry a top-level `url` or `preferredTransport` field (v0.3 residuals)

#### Scenario: Endpoint resolved from agent card
- **WHEN** `A2AClient.sendMessage()` is invoked for the first time against a fresh client
- **THEN** the client first fetches `{peer.url}/.well-known/agent-card.json`
- **AND** resolves the JSONRPC endpoint by scanning `agentCard.supportedInterfaces` for `protocolBinding === 'JSONRPC'`
- **AND** subsequent calls reuse the cached endpoint without re-fetching the agent card

#### Scenario: PascalCase method names on the wire
- **WHEN** inspecting a JSON-RPC request body produced by `A2AClient`
- **THEN** the `method` field is one of `SendMessage` / `GetTask` / `CancelTask` / `GetExtendedAgentCard`
- **AND** the legacy `message/send` / `tasks/get` slashed forms are never used

#### Scenario: Task state enum on the wire
- **WHEN** inspecting a Task response from `A2AClient.getTask()` or `SendMessage`
- **THEN** the `status.state` is one of the nine `TASK_STATE_*` constants
- **AND** the legacy lowercase `completed` / `failed` / `canceled` / `submitted` / `working` / `input-required` values are never produced by the client or server

#### Scenario: Unified Part shape
- **WHEN** inspecting a Part within a Message or Artifact produced by `A2AClient` or `A2ARequestHandler`
- **THEN** the Part has at most one of `text` / `raw` / `url` / `data` set
- **AND** MIME type is communicated via `mediaType` (never `mimeType`)
- **AND** there is no discriminator `type` field on the Part

#### Scenario: SendMessage result is one-of
- **WHEN** `A2AClient.sendMessage()` resolves
- **THEN** the resolved value has shape `{ task?: A2ATask; message?: A2AMessage }` with exactly one field populated
- **AND** `A2AClient.sendAndWait()` wraps a message-only reply into a synthetic `TASK_STATE_COMPLETED` task so callers see a consistent `A2ATask`

#### Scenario: Message carries messageId
- **WHEN** `A2AClient.sendMessage()` emits a JSON-RPC request body
- **THEN** `params.message.messageId` is a non-empty string (generated via `generateId`)

#### Scenario: A2A barrel drops external-department re-exports
- **WHEN** reading `packages/core/src/a2a/index.ts` after this change
- **THEN** the file exports `A2AClient`, `A2ARequestHandler`, and all v1.0 `A2A*` types from `./a2a-*.js`, and exports nothing from `./external-departments.js` (that import line is removed)

### Requirement: External A2A peers must be CORS-compatible with browser origins

Any A2A peer whose `a2a_url` is reachable from the desktop renderer (`http://localhost:5176` in dev; the deployed SPA origin in prod) MUST respond to CORS preflight requests. Specifically, it MUST:
1. Respond to `OPTIONS` on every endpoint path with a 2xx status.
2. Include `Access-Control-Allow-Origin` matching the SPA origin (or `*` for public peers) on every response, including preflight.
3. Include `Access-Control-Allow-Methods: GET, POST, OPTIONS` on preflight responses.
4. Include `Access-Control-Allow-Headers: Authorization, Content-Type` on preflight responses.

Peers that omit CORS headers will cause `A2AClient.getAgentCard()` to fail with `TypeError: Failed to fetch`, which `employee-a2a-executor` maps to `task_runs.output_json = { error: { code: 'a2a_transport', ..., source: 'a2a' } }`. This is a peer configuration requirement, not a client bug.

The reference peer stub in `/tmp/offisim-a2a-peer.py` (skill-local, not checked in) demonstrates a compliant implementation. When Phase 3 ships the install UI, the official distributed peer / desktop-hosted peer MUST satisfy this requirement, or document explicit server-binding that bypasses CORS (e.g. desktop-local Tauri IPC).

#### Scenario: Peer returns CORS headers on preflight
- **WHEN** the desktop renderer browser sends `OPTIONS /.well-known/agent-card.json` with `Origin: http://localhost:5176` and `Access-Control-Request-Headers: authorization`
- **THEN** the peer responds with status 2xx and headers `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods` (including `GET`), `Access-Control-Allow-Headers` (including `authorization`)

#### Scenario: Peer returns CORS headers on actual responses
- **WHEN** the desktop renderer browser sends `GET /.well-known/agent-card.json` or `POST /a2a/<path> { method: 'SendMessage', ... }` with `Origin: http://localhost:5176`
- **THEN** every response (200 success, JSON-RPC error, 4xx/5xx) carries `Access-Control-Allow-Origin` matching the request origin
