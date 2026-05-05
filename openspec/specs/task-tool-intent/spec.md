# task-tool-intent Specification

## Purpose
TBD - created by archiving change close-runtime-routing-and-workspace-debt. Update Purpose after archive.
## Requirements
### Requirement: `task-tool-intent` SSOT module owns local-tool-intent detection

`packages/core/src/agents/task-tool-intent.ts` SHALL be the single source of truth for deciding whether a free-text task description requires Offisim-local file, shell, or workspace tooling. It SHALL export:

- `interface TaskToolIntent { needsRead: boolean; needsWrite: boolean; needsBash: boolean; needsVerification: boolean; requiresLocalTools: boolean }`
- `function detectTaskToolIntent(text: string | null | undefined): TaskToolIntent`
- `function evidenceToolsForIntent(intent: TaskToolIntent): readonly string[]` — derives the completion-evidence tool list from the same intent record
- Named keyword sets: `LOCAL_TOOL_NAME_TOKENS`, `READ_VERB_OBJECT_PAIRS`, `WRITE_VERB_OBJECT_PAIRS`, `BASH_VERB_OBJECT_PAIRS`, `VERIFICATION_TOKENS`, plus `CHINESE_*` parallels — exported for harness fixtures and future audits

`requiresLocalTools` SHALL be `true` if any of `needsRead`, `needsWrite`, `needsBash`, or `needsVerification` is `true`. The function SHALL be deterministic and side-effect-free.

The module SHALL NOT import from `agents/*-node.ts` modules — it is a leaf in the agents import graph so callers can depend on it without cycle risk.

#### Scenario: Module exports the SSOT API
- **WHEN** importing from `packages/core/src/agents/task-tool-intent.ts`
- **THEN** `detectTaskToolIntent`, `evidenceToolsForIntent`, and the named keyword sets are all available; no `requiresLocalOffisimTools` (legacy alias) export exists

#### Scenario: Empty input returns no-intent record
- **WHEN** calling `detectTaskToolIntent(null)` or `detectTaskToolIntent('')` or `detectTaskToolIntent('   ')`
- **THEN** the result is `{ needsRead: false, needsWrite: false, needsBash: false, needsVerification: false, requiresLocalTools: false }`

#### Scenario: Pure function, no I/O
- **WHEN** calling `detectTaskToolIntent(sameInput)` twice in the same process
- **THEN** the two results are deeply equal; no module-level state changes between calls; no logger / event-bus / IO call is made

### Requirement: Routing trigger SHALL accept verb+object pairs and explicit tool tokens, NOT bare nouns

`detectTaskToolIntent` SHALL set `requiresLocalTools = true` when the input contains AT LEAST ONE of:
- A whole-word match (`\b...\b`) for any token in `LOCAL_TOOL_NAME_TOKENS = ['read_file', 'write_file', 'bash', 'pwd', 'ls', 'cat', 'pnpm', 'npm', 'cargo', 'timeout', 'sleep']`
- A verb+object pair from `READ_VERB_OBJECT_PAIRS` (e.g. `read file`, `read path`, `read workspace`, `read content`, `quote bytes`, `quote content`, `quote file`, `view file`, `inspect file`)
- A verb+object pair from `WRITE_VERB_OBJECT_PAIRS` (e.g. `write file`, `write path`, `create file`, `create scratch note`, `save file`, `append to file`)
- A verb+object pair from `BASH_VERB_OBJECT_PAIRS` (e.g. `run pwd`, `run ls`, `run pnpm`, `run npm`, `run cargo`, `run sleep`, `execute command`, `execute shell`, `execute bash`)
- A verification token from `VERIFICATION_TOKENS` (e.g. `verification evidence`, `running verification evidence`, `pnpm-test`, `pnpm-typecheck`, `pnpm-lint`, `harness-contract`)
- A Chinese imperative pattern from `CHINESE_READ_PATTERNS` / `CHINESE_WRITE_PATTERNS` / `CHINESE_BASH_PATTERNS` / `CHINESE_VERIFICATION_PATTERNS` (`读取`, `读回`, `写入`, `写回`, `创建.{0,8}文件`, `保存.{0,8}文件`, `运行.{0,8}(命令|脚本)`, `执行.{0,8}(命令|脚本)`, `查看.{0,40}(文件|工作区|readme)`, `引用.{0,40}(文件|内容)`, `验证证据`, `运行.{0,20}验证`, `执行.{0,20}验证`)

It SHALL NOT trigger on bare-noun matches alone — the following SHALL NOT set `requiresLocalTools = true`:
- `file` / `command` / `path` / `terminal` / `directory` / `folder` / `workspace` (English bare noun)
- `命令` / `文件` / `目录` / `终端` / `路径` (Chinese bare noun)
- Idiom phrases: `file a bug`, `command line interface`, `keep the path forward`, `describe the workspace`, `in the workspace`, `the file system`

#### Scenario: Bare English noun does not trigger
- **WHEN** calling `detectTaskToolIntent('Please describe the workspace and file a bug if anything looks off.')`
- **THEN** the result is `{ needsRead: false, needsWrite: false, needsBash: false, needsVerification: false, requiresLocalTools: false }`

#### Scenario: Bare Chinese noun does not trigger
- **WHEN** calling `detectTaskToolIntent('请描述一下当前的命令行界面和文件系统结构。')`
- **THEN** the result is `{ needsRead: false, needsWrite: false, needsBash: false, needsVerification: false, requiresLocalTools: false }`

#### Scenario: Verb+object English triggers read intent
- **WHEN** calling `detectTaskToolIntent('Read README.md and quote the install section.')`
- **THEN** the result has `needsRead: true` and `requiresLocalTools: true`

#### Scenario: Explicit tool token triggers
- **WHEN** calling `detectTaskToolIntent('Use read_file to fetch the manifest, then run pnpm typecheck.')`
- **THEN** the result has `needsRead: true`, `needsBash: true`, `requiresLocalTools: true`

#### Scenario: Chinese imperative triggers write intent
- **WHEN** calling `detectTaskToolIntent('请帮我创建一个新的 README 文件，写入项目说明。')`
- **THEN** the result has `needsWrite: true` and `requiresLocalTools: true`

#### Scenario: Verification phrase triggers verification intent
- **WHEN** calling `detectTaskToolIntent('Run verification evidence: pnpm-test then pnpm-typecheck.')`
- **THEN** the result has `needsVerification: true` and `requiresLocalTools: true`

### Requirement: `evidenceToolsForIntent` mirrors detected intent buckets

`evidenceToolsForIntent(intent)` SHALL return an array containing:
- `'read_file'` if `intent.needsRead` is `true`
- `'write_file'` if `intent.needsWrite` is `true`
- `'bash'` if `intent.needsBash` is `true`
- The default verification tool list (`pnpm-test`, `pnpm-typecheck`, `pnpm-lint`, `harness-contract`) if `intent.needsVerification` is `true`

The returned array SHALL be deduplicated and have stable order (`read_file`, `write_file`, `bash`, then verification tools in declaration order). An intent with no buckets set SHALL return `[]`.

#### Scenario: Empty intent returns empty list
- **WHEN** calling `evidenceToolsForIntent({ needsRead: false, needsWrite: false, needsBash: false, needsVerification: false, requiresLocalTools: false })`
- **THEN** the result is `[]`

#### Scenario: Read+bash intent returns matched tools
- **WHEN** calling `evidenceToolsForIntent({ needsRead: true, needsWrite: false, needsBash: true, needsVerification: false, requiresLocalTools: true })`
- **THEN** the result is `['read_file', 'bash']` in that exact order

#### Scenario: Verification intent returns full default tool list
- **WHEN** calling `evidenceToolsForIntent({ needsRead: false, needsWrite: false, needsBash: false, needsVerification: true, requiresLocalTools: true })`
- **THEN** the result contains `'pnpm-test'`, `'pnpm-typecheck'`, `'pnpm-lint'`, `'harness-contract'` in that order, and no other entries

### Requirement: `OffisimGraphState.taskToolIntent` carries the per-turn decision

`packages/core/src/graph/state.ts` `OffisimGraphState` SHALL include `taskToolIntent: TaskToolIntent | null`. The field SHALL be populated by the first node that processes the user message in a turn (boss-node for boss-proxy / human-in-loop; pm-planner preflight for direct-to-employee; yolo-master for yolo). Downstream consumers (manager-node, employee-direct-setup, employee-completion verifier) SHALL read this field rather than re-derive intent from text.

`createEmptyPlanScopedState()` SHALL include `taskToolIntent: null` so plan-scoped resets do not leak stale intent into the next plan.

`detectTaskToolIntent` SHALL be called at most once per turn per node-entry-point.

#### Scenario: Boss node populates intent on entry
- **WHEN** boss-node processes a user message that contains "read README"
- **THEN** the returned `Partial<OffisimGraphState>` includes `taskToolIntent` with `needsRead: true` and `requiresLocalTools: true`

#### Scenario: Manager node consumes precomputed intent
- **WHEN** manager-node runs after boss-node and `state.taskToolIntent.requiresLocalTools` is `true`
- **THEN** manager-node uses that field to gate routing; no second call to `detectTaskToolIntent` is made in the same turn

#### Scenario: Plan-scoped reset clears intent
- **WHEN** `createEmptyPlanScopedState()` is invoked
- **THEN** the returned state has `taskToolIntent: null`

### Requirement: Legacy `requiresLocalOffisimTools` and inline `evidenceToolsForTask` SHALL be removed

`packages/core/src/agents/local-tool-routing.ts` SHALL be deleted (or its `requiresLocalOffisimTools` and `LOCAL_TOOL_REQUEST_RE` exports removed). `packages/core/src/agents/employee-completion.ts` SHALL no longer contain an inline `evidenceToolsForTask` function — it SHALL call `evidenceToolsForIntent(state.taskToolIntent ?? detectTaskToolIntent(taskDescription))` instead.

The 4 pre-existing call sites (`boss-node.ts`, `manager-node.ts`, `pm-planner/preflight.ts`, `employee-direct-setup-node.ts`) SHALL no longer call `requiresLocalOffisimTools(text)` — they SHALL read `state.taskToolIntent.requiresLocalTools`.

`isLocalToolAssignableEmployee(employee)` SHALL move to `task-tool-intent.ts` (or to `agents/employee-routing-helpers.ts` if a sibling module is appropriate) — it does not depend on intent detection but is the only other export of the legacy file.

#### Scenario: Legacy regex export is gone
- **WHEN** grepping `packages/core/src/agents/**/*.ts` for `LOCAL_TOOL_REQUEST_RE` or `requiresLocalOffisimTools`
- **THEN** zero matches exist

#### Scenario: Inline evidenceToolsForTask is gone
- **WHEN** grepping `packages/core/src/agents/employee-completion.ts` for `function evidenceToolsForTask`
- **THEN** zero matches exist

#### Scenario: Routing call sites read state field
- **WHEN** grepping `packages/core/src/agents/{boss,manager,employee-direct-setup}-node.ts` and `packages/core/src/agents/pm-planner/preflight.ts` for `requiresLocalOffisimTools(`
- **THEN** zero matches exist; matches for `state.taskToolIntent` (or destructured equivalent) appear in their place

### Requirement: Manager rebind on `requires-local-tools` SHALL emit `task.assignment.rerouted`

The manager node SHALL emit `task.assignment.rerouted` when local-tool intent rejects an external employee.
This applies when the manager filters out a recommended external A2A
employee because the task's `taskToolIntent` requires local Offisim
tools. The event (per `shared-types/events/task.ts`) SHALL use
`source='manager'` and `reason='requires-local-tools'`. The emission
SHALL be mirrored to `logger.info`. The event SHALL be observable on
the release-session activity feed.

#### Scenario: External employee filtered out for local-tools intent

- **WHEN** the LLM picks an external A2A employee for a task
- **AND** the manager evaluates `taskToolIntent` and rejects the pick
  because the intent requires local tools
- **THEN** the runtime SHALL emit `task.assignment.rerouted` with
  `source='manager'`, `reason='requires-local-tools'`, the original
  external employee id, and the rebind target id
- **AND** the event SHALL appear on the activity feed in the
  release `.app` session

### Requirement: pm-planner sanitize-rebind SHALL emit `task.assignment.rerouted`

pm-planner sanitize-rebind SHALL emit `task.assignment.rerouted` when it swaps an employee.
This applies when `pm-planner/sanitize-rebind.ts` swaps a missing or
disabled employee. The event SHALL use `source='pm-planner'` and
`reason ∈ {'employee-not-found', 'employee-disabled',
'no-recommendation-fallback'}`. The event SHALL be observable on the
release-session activity feed.

#### Scenario: pm-planner rebinds missing employee

- **WHEN** pm-planner encounters an employee id in the plan that no
  longer exists in the active company's `employees` table
- **THEN** the runtime SHALL emit `task.assignment.rerouted` with
  `source='pm-planner'`, `reason='employee-not-found'`, the original
  employee id, and the rebind target id

#### Scenario: pm-planner rebinds disabled employee

- **WHEN** pm-planner encounters an employee id whose `is_enabled`
  flag is false
- **THEN** the runtime SHALL emit `task.assignment.rerouted` with
  `source='pm-planner'`, `reason='employee-disabled'`

### Requirement: Activity feed SHALL collapse 3+ same-(source, reason, taskRunId) rebind events

The activity feed SHALL collapse 3 or more `task.assignment.rerouted`
events sharing the same `(source, reason, taskRunId)` triple into a
single row with an `×N` badge indicating the count. Fewer than 3
SHALL render as individual rows.

#### Scenario: Three rebinds in same task run collapse

- **WHEN** the same `taskRunId` produces three `task.assignment.rerouted`
  events with the same `(source, reason)` tuple within the same run
- **THEN** the activity feed SHALL render a single row carrying an
  `×3` badge
- **AND** subsequent rebinds in the same run with the same tuple
  SHALL increment the badge, not produce new rows

#### Scenario: Two rebinds do not collapse

- **WHEN** two `task.assignment.rerouted` events fire with the same
  `(source, reason, taskRunId)` triple
- **THEN** they SHALL render as two individual rows

### Requirement: Reroute verification claims SHALL require runtime-event evidence

Employee completion SHALL require a real `task.assignment.rerouted`
runtime event in the same thread when the task description asks to
verify, prove, or report reroute/rebind behavior. A file
or shell tool call may prove local tool access, but it SHALL NOT prove
that rerouting happened. This prevents an employee from writing a
synthetic "reroute proof" file and marking the routing gate complete
without the manager or pm-planner actually emitting the routing event.

#### Scenario: Synthetic proof file does not satisfy reroute verification

- **WHEN** an employee task description asks to verify missing-employee
  or local-tool reroute behavior
- **AND** the employee writes a proof file or reads local files
- **BUT** no `task.assignment.rerouted` event exists for the thread
- **THEN** completion SHALL be blocked for human review
- **AND** the block reason SHALL name the missing runtime event

#### Scenario: Real reroute event satisfies the routing-evidence gate

- **WHEN** manager or pm-planner emits `task.assignment.rerouted` for
  the thread
- **AND** the task has the ordinary file/shell evidence required by
  its tool intent
- **THEN** the reroute verification claim MAY complete
