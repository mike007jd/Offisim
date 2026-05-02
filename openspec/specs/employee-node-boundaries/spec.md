# employee-node-boundaries Specification

## Purpose

`packages/core/src/agents/employee-node.ts` 的职责边界规范——它是 employee runtime 的 orchestration barrel（≤200 NBNC），控制流走 preflight → A2A branch → engine branch → provider prompt/tool-loop branch → completion / error-finalize。skill prompt formatters / tool definition builders / turn-runner 闭包体 / tool-call dispatcher / completion side-effect emission 序列 / error finalization / engine execution 分散到 sibling `employee-*.ts` 模块，barrel 只做 import + re-export + 调度。此 spec 在每次 employee runtime 变更时做契约边界检查，防止 barrel 膨胀回旧 monolith 形态。
## Requirements
### Requirement: employee-node.ts is a thin orchestration barrel

`packages/core/src/agents/employee-node.ts` SHALL contain no more than 200 non-blank, non-comment lines. It SHALL only: (a) import from single-responsibility `employee-*.ts` sibling modules, (b) re-export the public symbols `employeeNode` and `extractUsedCitations`, (c) declare the `employeeNode` function body which acts as the control-flow orchestrator — preflight → A2A branch → engine branch → prompt → tool-kit → turn-runner → tool-loop (with handoff early return) → completion / error-finalize. Inline helper functions, skill prompt-section formatters, tool definition builders, engine event mapping, `runEmployeeTurn` closure body, tool-call result dispatcher bodies, and completion side-effect emission sequences SHALL NOT live in this file.

#### Scenario: Barrel size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/employee-node.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 200

#### Scenario: No inline helper bodies
- **WHEN** grepping `employee-node.ts` for function declarations matching `^function truncateDescription` / `^function formatAvailableSkillsSection` / `^function assembleToolKit` / `^function buildTurnRunner` / `^function finalizeEmployeeFailure`
- **THEN** zero matches exist — these bodies live in the new sibling modules

### Requirement: Preflight is a standalone module

The preflight pipeline (unpack runtime context, pop the first pending assignment, load employee / company, emit initial `graph.node.entered` + `employee.state.changed` + `task.state.changed(queued→running)` + `task.subtask.progress(running)` events, derive `taskLabel` / `totalAssignments` / `completedSoFar` / `isDirectChatTask`) SHALL live in `packages/core/src/agents/employee-preflight.ts`. It SHALL export exactly one public function whose return type signals early-return when there is no assignment or the employee has been deleted mid-execution.

#### Scenario: No assignment returns early
- **WHEN** `state.pendingAssignments` is empty
- **THEN** the preflight module signals early return with `{ pendingAssignments: [], completed: true }` and no LLM call is made

#### Scenario: Employee deleted mid-execution
- **WHEN** `repos.employees.findById(assignment.employeeId)` returns null
- **THEN** the preflight module marks the task run `failed` (if `taskRunId` exists), emits `task.state.changed(queued→failed)`, and signals early return with `pendingAssignments: remaining` — same as pre-refactor

#### Scenario: Normal preflight event order
- **WHEN** preflight runs for a valid assignment with an existing employee
- **THEN** the event sequence is: `graph.node.entered(employee)` → `employee.state.changed(idle→executing)` → `task.state.changed(queued→running)` → `task.subtask.progress(running, {completedSoFar, totalAssignments})`, identical in order and payload to pre-refactor

### Requirement: Prompt assembly is a standalone module

System prompt composition (employee prompt, `## Available skills` section populated from `skillLoader.listSkillsForEmployee(...)`, `## Available coworkers` section, memory section injection via `formatMemoriesSection`, library documents section with numbered citations via `LibraryService.getRelevantSnippetsWithCitations`, scratchpad section) SHALL live in `packages/core/src/agents/employee-prompt-assembly.ts`. The module SHALL return a value containing `{ systemPrompt, citationMap }`.

#### Scenario: Memory section only when enabled
- **WHEN** `memoryService` is absent OR `taskDescription` is empty OR `memoryPolicy.injectionEnabled === false`
- **THEN** no memory section is appended to `systemPrompt` — matching pre-refactor guard

#### Scenario: Library citations survive errors
- **WHEN** `LibraryService.getRelevantSnippetsWithCitations` throws
- **THEN** `citationMap` is `[]` and `systemPrompt` has no library section — prompt assembly does NOT throw

#### Scenario: Skills are listed without runtimeSkill state
- **WHEN** `skillLoader.listSkillsForEmployee(...)` returns one or more skills
- **THEN** the prompt appends a `## Available skills` section with frontmatter-level metadata only
- **AND** the returned value remains `{ systemPrompt, citationMap }` with no `runtimeSkill` field

### Requirement: Tool kit assembly is a standalone module

Tool list construction (memory virtual tools via `buildMemoryTools()`, skill install/fork/edit tools via `buildSkillInstallTools()` when `skillStagingManager` and `skillLoader` are present, `handoff_to` tool gated on `!isDirectChatTask && handoffCount < MAX_HANDOFF_COUNT && colleagues.length > 0`, workstation-scoped MCP tools via `workstationToolResolver.resolveForEmployee` OR fallback `toolExecutor.listAvailable`) SHALL live in `packages/core/src/agents/employee-tool-kit.ts`. The module SHALL return `{ virtualTools, mcpTools, allTools, allowedMcpToolNames }`.

#### Scenario: Skill install/fork/edit tools are gated by runtime capability
- **WHEN** `runtimeCtx.skillStagingManager` and `runtimeCtx.skillLoader` are both present
- **THEN** the tool kit includes the tool family produced by `buildSkillInstallTools()`
- **AND** no `activate_skill_context` tool is added

#### Scenario: Handoff tool gating
- **WHEN** the task is `direct_chat` OR the assignment is a `handoff_continuation` OR `state.handoffCount >= MAX_HANDOFF_COUNT` OR the employee has no colleagues
- **THEN** `handoff_to` is NOT added to `virtualTools` — matching pre-refactor

#### Scenario: Workstation fallback
- **WHEN** `runtimeCtx.workstationToolResolver` is undefined
- **THEN** the module falls back to `toolExecutor.listAvailable(companyId)` for MCP tools — same as pre-refactor behavior for system agents

### Requirement: LLM turn runner is a standalone module

The `runEmployeeTurn` closure that wraps `recordedLlmCall` / `recordedLlmStream`, emits per-chunk `llm.stream.chunk` events (with `kind: 'content'` default and `kind: 'reasoning'` when the chunk carries reasoning), and returns a normalized `LlmResponse`, SHALL live in `packages/core/src/agents/employee-turn-runner.ts`. It SHALL export a factory `buildTurnRunner(...)` returning `(messages, meta) => Promise<LlmResponse>`.

#### Scenario: Streaming chunk events preserved
- **WHEN** an LLM chunk arrives with both `content` and `reasoning`
- **THEN** two separate `llm.stream.chunk` events are emitted — one with `kind: 'reasoning'`, then one with default kind — in that order, same as pre-refactor

#### Scenario: Non-stream path delegates to recordedLlmCall
- **WHEN** `streamEmployeeReplies === false`
- **THEN** the runner calls `recordedLlmCall(...)` and returns its result without any `llm.stream.chunk` emission

### Requirement: Tool round module returns a discriminated outcome

The multi-round tool-call loop body (handoff_to detection, parallel `Promise.allSettled` execution of memory / skill / workstation-guarded MCP tools, `WORKSTATION_ACCESS_DENIED` error short-circuit, assistant + tool-result history append, context trim when history exceeds `MAX_CONTEXT_MESSAGES + 1`) SHALL live in `packages/core/src/agents/employee-tool-round.ts`. It SHALL return a discriminated union `{ kind: 'handoff', args } | { kind: 'continue', nextHistory }`. The module SHALL NOT emit any Command or perform handoff side effects — those remain the orchestrator barrel's responsibility.

#### Scenario: Handoff signal does not execute handoff
- **WHEN** the LLM response contains a `handoff_to` tool call
- **THEN** `runToolRound` returns `{ kind: 'handoff', args: { targetEmployeeId, reason, completedWork, remainingWork } }` without writing any `handoffs` record, creating any TaskRun, or emitting `handoff.initiated`

#### Scenario: Tool failure does not crash the round
- **WHEN** one or more tool executions reject
- **THEN** `runToolRound` still returns `{ kind: 'continue', nextHistory }` where failed tools appear as `Tool execution failed: <message>` string content — matching pre-refactor `Promise.allSettled` unwrap

#### Scenario: Context trim applied
- **WHEN** `conversationHistory.length > MAX_CONTEXT_MESSAGES + 1`
- **THEN** `nextHistory` is `[firstMessage, ...conversationHistory.slice(-MAX_CONTEXT_MESSAGES)]` — keeps system message + last 20 messages, same as pre-refactor

### Requirement: Completion is a shared module used by both happy-path and recovery-path

Completion side effects (materialize file deliverable via `materializeFileDeliverableIfNeeded`, update task run status to `completed` with output JSON, emit `task.state.changed(running→completed)` + `task.assignment.changed(→unassigned)` + `task.subtask.progress(done)` + `employee.state.changed(executing→idle)`, call `memoryService.reflectAndRemember` when not direct-chat and not handoff-continuation, extract citations via `extractUsedCitations`, `appendAgentEvent(action)` with appropriate payload, `hookRegistry.emit('task.completed')` with correct `completionType`, scratchpad write, emit `deliverable.created` if materialized, return `Partial<OffisimGraphState>`) SHALL live in `packages/core/src/agents/employee-completion.ts`. The module SHALL expose `finalizeEmployeeSuccess(ctx)` accepting a `source: 'normal' | 'recovery'` discriminator and adjust the `appendAgentEvent` payload accordingly. `extractUsedCitations` SHALL also live here and be re-exported from the barrel.

#### Scenario: Happy path completion payload
- **WHEN** `finalizeEmployeeSuccess` is called with `source: 'normal'` and a materialized deliverable
- **THEN** `appendAgentEvent` payload contains `{ taskRunId, employeeName, toolRounds, outputLength, citationCount }` and `hookRegistry.emit('task.completed', { completionType: 'response' })` fires — same as pre-refactor happy path

#### Scenario: Recovery path completion payload
- **WHEN** `finalizeEmployeeSuccess` is called with `source: 'recovery'`
- **THEN** `appendAgentEvent` payload contains `{ taskRunId, employeeName, recoveredFromError: true, outputLength }` (no `toolRounds` / `citationCount`) and `hookRegistry.emit('task.completed', { completionType: 'recovery' })` fires — same as pre-refactor recovery branch

#### Scenario: Reflect-and-remember gating
- **WHEN** `assignment.taskType === 'direct_chat'` OR `assignment.taskType === 'handoff_continuation'`
- **THEN** `memoryService.reflectAndRemember` is called with `{ skip: true }`, preserving pre-refactor behavior

#### Scenario: Deliverable event
- **WHEN** the materialized deliverable has kind `file`
- **THEN** a `deliverable.created` event is emitted with `deliverableId` from `generateId('del')`, and the returned state update includes `artifact: { kind: 'file', fileName, mimeType, content }` in the last `currentStepOutputs` entry

### Requirement: Error finalization is a standalone module

Failure-path side effects (emit `employee.state.changed(executing→failed)` + `task.state.changed(running→failed)` + `task.subtask.progress(failed)`, update task run status to `failed`, build structured error JSON with `errorCode: 'LLM_CALL_FAILED' / recoverable: true / nodeName: 'employee' / employeeId / taskRunId / provider / model`, `appendAgentEvent(error)`, return state update with `interruptReason: JSON.stringify(structuredError)`) SHALL live in `packages/core/src/agents/employee-error-finalize.ts`.

#### Scenario: Structured error JSON schema preserved
- **WHEN** `finalizeEmployeeFailure` runs after recovery also failed
- **THEN** `interruptReason` parses to an object with exactly these keys: `errorCode`, `message`, `recoverable`, `nodeName`, `employeeId`, `taskRunId`, `provider`, `model` — same as pre-refactor schema parsed by `error-handler-node`

#### Scenario: Event emission order on failure
- **WHEN** both the LLM call and `attemptLocalRecovery` fail
- **THEN** events fire in order: `employee.state.changed(executing→failed)` → `task.state.changed(running→failed)` → `task.subtask.progress(failed)` → `appendAgentEvent(error)`, same as pre-refactor

### Requirement: Constants have a single owner

`MAX_HANDOFF_COUNT` / `MAX_CONTEXT_MESSAGES` / `TASK_TYPE_HANDOFF_CONTINUATION` / `MAX_TOOL_ROUNDS` SHALL each be declared exactly once in the `packages/core/src/agents/employee-*.ts` cluster. The values SHALL be: `MAX_HANDOFF_COUNT=3`, `MAX_CONTEXT_MESSAGES=20`, `TASK_TYPE_HANDOFF_CONTINUATION='handoff_continuation'`, `MAX_TOOL_ROUNDS=5`.

#### Scenario: No duplicate declarations
- **WHEN** grepping `packages/core/src/agents/employee-` for `^const MAX_HANDOFF_COUNT` or `^const MAX_CONTEXT_MESSAGES` or `^const TASK_TYPE_HANDOFF_CONTINUATION` or `^const MAX_TOOL_ROUNDS`
- **THEN** exactly one match per constant exists

### Requirement: Public API is preserved

The package public API SHALL remain unchanged: `packages/core/src/index.ts:332` continues to `export { employeeNode, extractUsedCitations } from './agents/employee-node.js'`, and the `employeeNode(state, config)` signature returns `Promise<Partial<OffisimGraphState> | Command>`. `packages/core/src/graph/main-graph.ts` call sites SHALL continue to import `employeeNode` from `../agents/employee-node.js` without modification.

#### Scenario: Index re-export unchanged
- **WHEN** a consumer does `import { employeeNode, extractUsedCitations } from '@offisim/core'`
- **THEN** both imports resolve with pre-refactor signatures

#### Scenario: main-graph wiring unchanged
- **WHEN** `main-graph.ts` invokes `employeeNode(state, config)`
- **THEN** the returned promise resolves to the same discriminated union `Partial<OffisimGraphState> | Command` as pre-refactor, with equivalent state fields or equivalent Command payload

### Requirement: Observable behavior is unchanged after refactor

For identical input (same `OffisimGraphState`, same RuntimeContext, same provider / model, same task description), the user-visible behavior SHALL be byte-identical before and after the refactor across event sequence, event payload keys, `conversationHistory` shape per round, `Partial<OffisimGraphState>` return fields, and `Command` goto / update payload for handoff — **except for the two additive fields `isExternal: boolean` and `brandKey: string | null` that this change adds to every `StepTaskOutput` (and therefore to `currentStepOutputs[]` entries pushed by handoff and to `DeliverableCreatedPayload.contributingEmployees[]`).**

The additive fields are required (non-optional) on the new `StepTaskOutput` shape; pre-change consumers SHALL receive them filled from the employee row's `is_external` / `brand_key`. The legacy four-field shape (`employeeId` / `employeeName` / `sourceKind` / `roleSlug`) remains exactly as before; nothing is renamed or removed.

#### Scenario: Normal task event sequence
- **WHEN** a normal task (`buildSomething` with no handoff, no recovery) is executed
- **THEN** the EventBus emits the same ordered sequence of `graph.node.entered` + `employee.state.changed` + `task.state.changed` + `task.subtask.progress` + `llm.stream.chunk*` + `task.assignment.changed` + optional `deliverable.created` as pre-refactor, verifiable by a pre/post Playwright live capture
- **AND** any emitted `deliverable.created` event carries `contributingEmployees[]` whose elements include the new `isExternal` + `brandKey` fields populated from the producing employee's row

#### Scenario: Handoff Command payload preserved (with additive fields)
- **WHEN** a handoff_to tool call fires
- **THEN** the returned `Command({ goto: 'employee', update })` has `update.pendingAssignments[0]` equal to `{ taskType: 'handoff_continuation', employeeId: args.targetEmployeeId, inputJson: { description: args.remainingWork, priorWork: args.completedWork, handoffReason: args.reason, taskRunId: newTaskRunId } }`, `update.handoffCount = state.handoffCount + 1`, and `update.currentStepOutputs` appends `{ employeeId, employeeName, sourceKind: 'employee', roleSlug, content: args.completedWork, taskRunId, isExternal, brandKey }` where `isExternal` and `brandKey` are derived from the handing-off employee's row (`is_external === 1` → `true`; `brand_key` passes through verbatim or `null`)
- **AND** all other fields are byte-identical to pre-refactor

#### Scenario: Citation extraction unchanged
- **WHEN** `extractUsedCitations(responseText, citationMap)` is called with the same inputs pre-refactor and post-refactor
- **THEN** the returned array of `CitationRef` is equal (same indices, same order preserved from `citationMap`)

### Requirement: employee-node routes by is_external flag, delegating external branch to sibling module

After this change, `packages/core/src/agents/employee-node.ts` SHALL branch on `employee.is_external` immediately after preflight load of the employee record: when `is_external === true`, the node SHALL delegate the remainder of dispatch to a single-responsibility sibling module `packages/core/src/agents/employee-a2a-executor.ts` (or equivalently-scoped module) that owns the A2A transport call, output extraction, event emission, and deliverable creation. When `is_external === false`, the node SHALL proceed down the pre-existing LLM adapter pipeline (prompt-assembly → turn-runner → tool-loop) unchanged.

The branch body SHALL NOT be inlined in `employee-node.ts`. The barrel SHALL remain within its `employee-node-boundaries` 200 NBNC limit.

#### Scenario: Barrel size gate holds after external branch added
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/employee-node.ts` is run after this change
- **THEN** the non-blank, non-comment line count is at most 200

#### Scenario: External branch body is not inlined
- **WHEN** grepping `packages/core/src/agents/employee-node.ts` for `A2AClient` / `sendAndWait` / `extractDepartmentOutput` / A2A task polling logic
- **THEN** zero matches exist on the call/logic (only possibly a type-only import forwarded to the sibling module)

#### Scenario: External branch module exists and is invoked
- **WHEN** `packages/core/src/agents/employee-a2a-executor.ts` exists and `employee-node.ts` imports it
- **THEN** the imported function is called from `employee-node.ts` inside the `is_external === true` branch

#### Scenario: Internal path byte-identical events
- **WHEN** running `employee-node` against an internal employee assignment before vs after this change
- **THEN** the emitted event sequence (`graph.node.entered` / `employee.state.changed` / `task.state.changed` / `task.subtask.progress` / LLM calls / deliverable creation) is identical in order and payload shape

### Requirement: employee-node routes engine mode after A2A and before provider prompt loop

After preflight, `employee-node.ts` SHALL route in this order: external employee A2A, employee runtime binding engine mode, default provider mode. The engine branch body SHALL live in `packages/core/src/agents/employee-engine-executor.ts`.

#### Scenario: Engine branch body is not inlined
- **WHEN** grepping `packages/core/src/agents/employee-node.ts` for `RuntimeActivityEvent` / `EngineAdapter.startRun` / `engine.proposal.created`
- **THEN** zero matches exist

#### Scenario: Provider path remains default
- **WHEN** a local employee has no `config_json.runtimeBinding` and the company policy has no `employeeRuntimeDefault`
- **THEN** `employee-node` proceeds through the existing prompt/tool-loop/finalize provider path

### Requirement: Boss system prompt SHALL include the active company's employee roster

The boss agent's system prompt assembly SHALL include the active company's employee roster (employee_id, name, role_slug, brand_key for external employees) whenever the active company has at least one employee in `repos.employees.findByCompany(activeCompanyId)`. The boss SHALL NOT respond `"no employee database access"` (or equivalent) when the data layer reports a non-empty roster.

The roster injection SHALL be re-derived on:
- Active company switch
- Employee created / dismissed / hard-deleted within the active company
- Boss runtime initialization (cold start)

#### Scenario: Boss recognizes employees that exist in the active company
- **WHEN** the active company has 3 employees (e.g., Alex Chen / Maya Lin / Marcus Johnson) AND the user in team chat asks `"who's on my team?"`
- **THEN** the boss reply lists at least the names that the left-rail employee list shows
- **AND** the boss does NOT reply with `"no employee database access"` or any synonym indicating empty roster

#### Scenario: Boss recognizes a specific employee referenced by name
- **WHEN** the active company has employee `Alex Chen` AND the user asks the boss `"is Alex Chen available?"`
- **THEN** the boss reply acknowledges Alex Chen as a known employee (not "no such employee")

#### Scenario: Empty roster does not trigger the regression event
- **WHEN** the active company has 0 employees AND the boss assembles its system prompt
- **THEN** the roster section is empty / absent
- **AND** no `boss.employee-context.empty` event fires (empty company is not a regression)

### Requirement: Boss employee-context regressions SHALL emit an observable runtime event

When the data layer reports a non-empty employee roster for the active company but the boss's assembled system prompt receives 0 employees, the runtime SHALL emit a `runtime_event` with `event_type='boss.employee-context.empty'` and payload `{ companyId, employeeCount, expectedAtLeast: 1 }`. This event distinguishes a true regression (DB has employees, prompt has zero) from a benign empty company.

The event SHALL fire at most once per `companyId` per session to avoid log spam.

#### Scenario: True regression fires the event
- **WHEN** `repos.employees.findByCompany(activeCompanyId)` returns 3 rows AND the boss prompt assembly receives 0 employees
- **THEN** a `boss.employee-context.empty` event is emitted with payload `{ companyId, employeeCount: 0, expectedAtLeast: 1 }`

#### Scenario: Benign empty company does NOT fire the event
- **WHEN** `repos.employees.findByCompany(activeCompanyId)` returns 0 rows AND the boss prompt assembly receives 0 employees
- **THEN** no `boss.employee-context.empty` event is emitted (empty roster matches DB state, not a regression)

### Requirement: Deliverable event carries contributor brand fields across all emit sites

When a materialized deliverable produces a `deliverable.created` event from any of the three emit sites (`boss-summary-node.emitDeliverable`, `employee-completion.ts` direct artifact emit, or `employee-a2a-executor.ts` direct artifact emit), the event payload's `contributingEmployees[]` SHALL include the new `isExternal` + `brandKey` fields for every contributor element, populated from the producing employee's row (`is_external` mapped to `boolean`; `brand_key` passing through verbatim or `null`).

#### Scenario: boss-summary multi-contributor emit carries fields
- **WHEN** the boss summary aggregates multiple `currentStepOutputs` into a single `deliverable.created`
- **THEN** every element in the emitted `contributingEmployees[]` carries `isExternal` + `brandKey` derived from the corresponding `StepTaskOutput`

#### Scenario: employee-completion direct artifact emit carries fields
- **WHEN** `employee-completion.ts` emits `deliverable.created` directly for a materialized artifact (bypassing boss-summary)
- **THEN** the single contributor element carries `isExternal` + `brandKey` derived from the producing employee's row

#### Scenario: employee-a2a-executor direct artifact emit carries fields
- **WHEN** `employee-a2a-executor.ts` emits `deliverable.created` directly for an external A2A artifact (bypassing boss-summary)
- **THEN** the single contributor element carries `isExternal: true` + `brandKey` from the external A2A employee's row (a registered brand key, or `null` for unknown / custom external)

