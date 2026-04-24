## MODIFIED Requirements

### Requirement: employee-node.ts is a thin orchestration barrel

`packages/core/src/agents/employee-node.ts` SHALL contain no more than 200 non-blank, non-comment lines. It SHALL only: (a) import from single-responsibility `employee-*.ts` sibling modules, (b) re-export the public symbols `employeeNode` and `extractUsedCitations`, (c) declare the `employeeNode` function body which acts as the control-flow orchestrator — preflight → prompt → tool-kit → turn-runner → tool-loop (with handoff early return) → completion / error-finalize. Inline helper functions, skill prompt-section formatters, tool definition builders, `runEmployeeTurn` closure body, tool-call result dispatcher bodies, and completion side-effect emission sequences SHALL NOT live in this file.

#### Scenario: Barrel size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/employee-node.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 200

#### Scenario: No inline helper bodies
- **WHEN** grepping `employee-node.ts` for function declarations matching `^function truncateDescription` / `^function formatAvailableSkillsSection` / `^function assembleToolKit` / `^function buildTurnRunner` / `^function finalizeEmployeeFailure`
- **THEN** zero matches exist — these bodies live in the new sibling modules

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

Tool list construction (memory virtual tools via `buildMemoryTools()`, skill-mutation tools via `buildSkillInstallTools()` when `skillStagingManager` and `skillLoader` are present, `handoff_to` tool gated on `!isDirectChatTask && handoffCount < MAX_HANDOFF_COUNT && colleagues.length > 0`, workstation-scoped MCP tools via `workstationToolResolver.resolveForEmployee` OR fallback `toolExecutor.listAvailable`) SHALL live in `packages/core/src/agents/employee-tool-kit.ts`. The module SHALL return `{ virtualTools, mcpTools, allTools, allowedMcpToolNames }`.

#### Scenario: Skill-mutation tools are gated by runtime capability
- **WHEN** `runtimeCtx.skillStagingManager` and `runtimeCtx.skillLoader` are both present
- **THEN** the tool kit includes the skill install/fork/edit tool family produced by `buildSkillInstallTools()`
- **AND** no `activate_skill_context` tool is added

#### Scenario: Handoff tool gating
- **WHEN** the task is `direct_chat` OR the assignment is a `handoff_continuation` OR `state.handoffCount >= MAX_HANDOFF_COUNT` OR the employee has no colleagues
- **THEN** `handoff_to` is NOT added to `virtualTools` — matching pre-refactor

#### Scenario: Workstation fallback
- **WHEN** `runtimeCtx.workstationToolResolver` is undefined
- **THEN** the module falls back to `toolExecutor.listAvailable(companyId)` for MCP tools — same as pre-refactor behavior for system agents

### Requirement: Constants have a single owner

`MAX_HANDOFF_COUNT` / `MAX_CONTEXT_MESSAGES` / `TASK_TYPE_HANDOFF_CONTINUATION` / `MAX_TOOL_ROUNDS` SHALL each be declared exactly once in the `packages/core/src/agents/employee-*.ts` cluster. The values SHALL be: `MAX_HANDOFF_COUNT=3`, `MAX_CONTEXT_MESSAGES=20`, `TASK_TYPE_HANDOFF_CONTINUATION='handoff_continuation'`, `MAX_TOOL_ROUNDS=5`.

#### Scenario: No duplicate declarations
- **WHEN** grepping `packages/core/src/agents/employee-` for `^const MAX_HANDOFF_COUNT` or `^const MAX_CONTEXT_MESSAGES` or `^const TASK_TYPE_HANDOFF_CONTINUATION` or `^const MAX_TOOL_ROUNDS`
- **THEN** exactly one match per constant exists
