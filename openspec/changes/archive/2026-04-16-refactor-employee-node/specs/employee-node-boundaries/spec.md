## ADDED Requirements

### Requirement: employee-node.ts is a thin orchestration barrel

`packages/core/src/agents/employee-node.ts` SHALL contain no more than 200 non-blank, non-comment lines. It SHALL only: (a) import from single-responsibility `employee-*.ts` sibling modules, (b) re-export the public symbols `employeeNode` and `extractUsedCitations`, (c) declare the `employeeNode` function body which acts as the control-flow orchestrator — preflight → prompt → tool-kit → turn-runner → tool-loop (with handoff early return) → completion / error-finalize. Inline helper functions, skill prompt-section formatters, tool definition builders, `runEmployeeTurn` closure body, tool-call result dispatcher bodies, and completion side-effect emission sequences SHALL NOT live in this file.

#### Scenario: Barrel size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/employee-node.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 200

#### Scenario: No inline helper bodies
- **WHEN** grepping `employee-node.ts` for function declarations matching `^function parseRuntimeSkillConfig` / `^function normalizeSkillText` / `^function taskHasSkillMismatch` / `^function formatSkillCatalogSection` / `^function formatSkillInstructionsSection` / `^function buildSkillActivationTool`
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

System prompt composition (employee prompt, skill catalog section, skill instructions section when `toolSearchEnabled=false`, memory section injection via `formatMemoriesSection`, library documents section with numbered citations via `LibraryService.getRelevantSnippetsWithCitations`, scratchpad section) and the skill-config helpers (`parseRuntimeSkillConfig`, `normalizeSkillText`, `taskHasSkillMismatch`, `formatSkillCatalogSection`, `formatSkillInstructionsSection`) SHALL live in `packages/core/src/agents/employee-prompt-assembly.ts`. The module SHALL return a value containing `{ systemPrompt, citationMap, runtimeSkill }`.

#### Scenario: Memory section only when enabled
- **WHEN** `memoryService` is absent OR `taskDescription` is empty OR `memoryPolicy.injectionEnabled === false`
- **THEN** no memory section is appended to `systemPrompt` — matching pre-refactor guard

#### Scenario: Library citations survive errors
- **WHEN** `LibraryService.getRelevantSnippetsWithCitations` throws
- **THEN** `citationMap` is `[]` and `systemPrompt` has no library section — prompt assembly does NOT throw

#### Scenario: Skill instructions gated by toolSearchEnabled
- **WHEN** `runtimeSkill` is non-null AND `runtimePolicy.toolSearch.enabled === true`
- **THEN** only the skill catalog section is appended; full instructions are NOT inlined (they become an on-demand `activate_skill_context` tool call)

### Requirement: Tool kit assembly is a standalone module

Tool list construction (memory virtual tools via `buildMemoryTools()`, skill activation tool via `buildSkillActivationTool()`, `handoff_to` tool gated on `!isDirectChatTask && handoffCount < MAX_HANDOFF_COUNT && colleagues.length > 0`, workstation-scoped MCP tools via `workstationToolResolver.resolveForEmployee` OR fallback `toolExecutor.listAvailable`) and the constant `SKILL_TOOL_NAME = 'activate_skill_context'` SHALL live in `packages/core/src/agents/employee-tool-kit.ts`. The module SHALL return `{ virtualTools, mcpTools, allTools, allowedMcpToolNames }`.

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

`MAX_HANDOFF_COUNT` / `MAX_CONTEXT_MESSAGES` / `TASK_TYPE_HANDOFF_CONTINUATION` / `SKILL_TOOL_NAME` / `MAX_TOOL_ROUNDS` SHALL each be declared exactly once in the `packages/core/src/agents/employee-*.ts` cluster. The values SHALL be: `MAX_HANDOFF_COUNT=3`, `MAX_CONTEXT_MESSAGES=20`, `TASK_TYPE_HANDOFF_CONTINUATION='handoff_continuation'`, `SKILL_TOOL_NAME='activate_skill_context'`, `MAX_TOOL_ROUNDS=5`.

#### Scenario: No duplicate declarations
- **WHEN** grepping `packages/core/src/agents/employee-` for `^const MAX_HANDOFF_COUNT` or `^const MAX_CONTEXT_MESSAGES` or `^const TASK_TYPE_HANDOFF_CONTINUATION` or `^const SKILL_TOOL_NAME` or `^const MAX_TOOL_ROUNDS`
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

For identical input (same `OffisimGraphState`, same RuntimeContext, same provider / model, same task description), the user-visible behavior SHALL be byte-identical before and after the refactor across event sequence, event payload keys, `conversationHistory` shape per round, `Partial<OffisimGraphState>` return fields, and `Command` goto / update payload for handoff.

#### Scenario: Normal task event sequence
- **WHEN** a normal task (`buildSomething` with no handoff, no recovery) is executed
- **THEN** the EventBus emits the same ordered sequence of `graph.node.entered` + `employee.state.changed` + `task.state.changed` + `task.subtask.progress` + `llm.stream.chunk*` + `task.assignment.changed` + optional `deliverable.created` as pre-refactor, verifiable by a pre/post Playwright live capture

#### Scenario: Handoff Command payload preserved
- **WHEN** a handoff_to tool call fires
- **THEN** the returned `Command({ goto: 'employee', update })` has `update.pendingAssignments[0]` equal to `{ taskType: 'handoff_continuation', employeeId: args.targetEmployeeId, inputJson: { description: args.remainingWork, priorWork: args.completedWork, handoffReason: args.reason, taskRunId: newTaskRunId } }`, `update.handoffCount = state.handoffCount + 1`, and `update.currentStepOutputs` appends `{ employeeId, employeeName, sourceKind: 'employee', roleSlug, content: args.completedWork, taskRunId }` — byte-identical to pre-refactor

#### Scenario: Citation extraction unchanged
- **WHEN** `extractUsedCitations(responseText, citationMap)` is called with the same inputs pre-refactor and post-refactor
- **THEN** the returned array of `CitationRef` is equal (same indices, same order preserved from `citationMap`)
