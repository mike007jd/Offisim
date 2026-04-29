# long-running-runtime Specification

## Purpose

Defines long-running graph execution invariants for Offisim employee work, especially completion truth, blocked work propagation, stale checkpoint isolation, and deterministic harness coverage.
## Requirements
### Requirement: Boss summary SHALL NOT mark empty or blocked work as completed

Boss summary SHALL mark a thread completed only when the active plan has terminal success for all steps. Empty employee outputs, pending steps, blocked steps, or stale checkpoint state SHALL keep the thread non-completed and expose an actionable interruption reason.

#### Scenario: Empty stale plan output is not completed

- **WHEN** boss summary receives no employee output while the active plan still has pending or blocked work
- **THEN** the thread remains non-completed
- **AND** the final response does not use the fallback `Task processing complete.` copy.

#### Scenario: Idle thread with no plan is not fake-completed

- **WHEN** boss summary runs without an executable plan and without employee output
- **THEN** it reports that no executable work was completed
- **AND** it does not mutate thread status to completed.

### Requirement: Blocked steps SHALL remain separate from completed steps

Step advancement SHALL treat completed and blocked task runs as different terminal states. A blocked task run SHALL add its step index to `blockedStepIndices`, SHALL NOT add that index to `completedStepIndices`, and SHALL route to boss summary only after all plan steps are terminal.

#### Scenario: Mixed completed and blocked batch

- **WHEN** one dispatched step has completed task runs and another dispatched step has blocked task runs
- **THEN** the completed step appears only in `completedStepIndices`
- **AND** the blocked step appears only in `blockedStepIndices`
- **AND** boss summary does not report all work as successful.

### Requirement: Plan-scoped graph state SHALL reset before new execution plans

Planner, preflight short-circuit, direct assignment, and YOLO assignment paths SHALL clear stale plan-scoped state before starting a new execution plan or direct employee turn.

The reset SHALL include prior pending assignments, dispatched step indices, completed step indices, blocked step indices, step results, current step outputs, recent tool results, current employee/task-run ids, interrupt reason, and completion flag.

#### Scenario: New plan cannot inherit stale dispatch state

- **WHEN** a previous checkpoint contains completed or dispatched step indices
- **AND** PM planner creates a new plan
- **THEN** the new execution starts with empty blocked/completed/dispatch state
- **AND** completion requires fresh employee work and evidence.

### Requirement: Employee completion SHALL block when taskRunId is missing

Employee success finalization SHALL default to blocked when no `taskRunId` is available, unless a caller explicitly uses an internal skip-verification path.

#### Scenario: Missing taskRunId does not return hardcoded ok

- **WHEN** employee completion is called without `taskRunId`
- **THEN** it records a blocked completion reason
- **AND** it does not emit hardcoded success.

### Requirement: Heartbeat SHALL surface verifier-blocked work

PM heartbeat SHALL classify blocked task runs as needing attention and include the blocked reason in its event payload.

#### Scenario: Verifier-blocked task appears in heartbeat

- **WHEN** a task run is blocked by completion verification
- **THEN** heartbeat reports that the plan needs attention
- **AND** the payload includes `verifier-blocked`.

### Requirement: micro-compact pass runs before full-compact

`packages/core/src/services/conversation-budget/micro-compact.ts` SHALL export a pure function `microCompactMessages(messages, opts)` that replaces oversize tool-result message contents with a head + truncation marker + tail snippet. The function SHALL preserve the most recent N tool results in full (default N = 1). The function SHALL NOT mutate input messages — it returns a new array.

`ConversationBudgetService.prepareRequest` SHALL invoke `microCompactMessages` before any LLM-based full-compact pass. If the micro-compact pass alone brings token estimate under the soft budget, the service SHALL skip the full-compact pass and persist `compactBaseline.kind === 'micro'`.

#### Scenario: Oversize tool result is truncated with marker
- **WHEN** a `role: 'tool'` message has `content.length > maxToolResultBytes` and is not in the `preserveLastN` window
- **THEN** the returned message has the same `tool_call_id`, and content equals `head[:snippetBytes] + '\n\n[microcompacted ${origBytes} bytes]\n\n' + tail[-snippetBytes:]`

#### Scenario: Most recent tool result is preserved
- **WHEN** `preserveLastN: 1` and there are 5 large tool results
- **THEN** only the last tool result keeps full content; the previous 4 are all truncated

#### Scenario: Small tool results are not modified
- **WHEN** all tool result contents fit under `maxToolResultBytes`
- **THEN** `microCompactMessages` returns `compacted: false` and the message array is identity-equal element-wise

#### Scenario: micro pass alone brings tokens under budget
- **WHEN** `prepareRequest` runs micro-compact and the post-micro token estimate is below the soft budget threshold
- **THEN** the service does not invoke the full-compact LLM call, and the persisted baseline has `kind === 'micro'`

#### Scenario: Barrel size invariant preserved
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/services/conversation-budget-service.ts` runs after this change
- **THEN** the count remains ≤ 180 (matching `conversation-budget-service-boundaries` spec)

### Requirement: rolling journal pins anchor user objective and writes per-N-turn synopsis

`packages/core/src/services/conversation-budget/rolling-journal.ts` SHALL export a `RollingJournal` class with `observeTurn(messages)`, `anchorText()`, `currentTurn()`. The anchor SHALL be set on first `observeTurn` to the content of the first `role: 'user'` message and SHALL NOT change in subsequent turns. The journal SHALL invoke its `summarize → write` callback every `everyNTurns` (default 8).

`packages/core/src/agents/employee-prompt-assembly.ts` SHALL prepend the anchor as a `role: 'system'` message wrapped in `<anchor>...</anchor>` tags so that downstream micro-compact never targets it.

#### Scenario: Anchor locks on first turn
- **WHEN** `observeTurn` is called the first time with messages containing user content `"goal A"`, then a subsequent turn contains user content `"goal B"`
- **THEN** `anchorText()` returns `"goal A"` after both calls

#### Scenario: Per-N-turn write fires
- **WHEN** `everyNTurns: 5` and `observeTurn` has been called 12 times
- **THEN** the `write` callback has been invoked exactly 2 times (at turn 5 and turn 10)

#### Scenario: Anchor injected into prompt is not micro-compacted
- **WHEN** `employee-prompt-assembly.ts` builds the LLM request
- **THEN** the request contains a `role: 'system'` message whose content matches `<anchor>(.+)</anchor>` and whose content is identical to `rollingJournal.anchorText()`

#### Scenario: Long sessions retain anchor visibility
- **WHEN** `yolo-80-turn-multi-file-refactor.json` harness scenario runs
- **THEN** the LLM request at turn 80 still contains the anchor system message verbatim

### Requirement: forkSubContext returns only summary, not transcript

`packages/core/src/a2a/fork-sub-context.ts` SHALL export `forkSubContext(input): Promise<ForkSubContextResult>`. The child runner receives a fresh message list of length 1 (the `subTask` user message). The result SHALL contain `summary: string` and SHALL NOT contain a `transcript` field on the public type.

`A2AClient.fork(peer, subTask)` SHALL be a thin wrapper around `forkSubContext` whose `runChild` performs the A2A `sendMessage` and joins all `text` parts of the final `agent`-role message into the summary.

#### Scenario: Parent transcript is not polluted
- **WHEN** parent has 50 messages and `forkSubContext({ subTask: 'find FIXME' })` is called
- **THEN** the child runner observes a fresh message list of length 1, content `"find FIXME"`

#### Scenario: Result type does not expose transcript
- **WHEN** TypeScript compiles a caller that destructures the result
- **THEN** `result.transcript` is a type error; only `result.summary` and optional `result.childTokensUsed` are accessible

### Requirement: completion-verifier blocks done without evidence

`packages/core/src/runtime/hook-registry.ts` `HookEvent` union SHALL include `'task.completion.verifying'` with payload `TaskCompletionVerifyingPayload` containing `recentToolResults`, `allow()`, `block(reason)`.

`packages/core/src/agents/employee-completion.ts` SHALL emit this hook before transitioning a task to `'completed'`. If no hook handler invokes `allow()` or the default `verifyCompletion` returns `ok: false`, the task SHALL transition to `'review'` and an `appendAgentEvent({ kind: 'completion-blocked', reason })` SHALL fire.

`packages/core/src/runtime/completion-verifier.ts` SHALL export `verifyCompletion(input, opts)` returning `ok: true` only if at least one entry in the last `windowSize` (default 12) `recentToolResults` is `success === true` and `toolName` is in `evidenceTools` (default `['pnpm-test', 'pnpm-typecheck', 'pnpm-lint', 'harness-contract']`).

`packages/core/src/agents/employee-tool-round.ts` SHALL push `{ toolName, success, bytes }` into `state.recentToolResults` (ring buffer of size 32) after every tool invocation.

#### Scenario: Empty evidence blocks completion
- **WHEN** an employee declares completion but `recentToolResults` contains no successful evidence-tool invocation
- **THEN** the task transitions to `'review'` and an event with `kind: 'completion-blocked'` is appended

#### Scenario: Successful pnpm-test allows completion
- **WHEN** `recentToolResults` contains `{ toolName: 'pnpm-test', success: true, bytes: 200 }` within the last 12 entries
- **THEN** `verifyCompletion` returns `ok: true` and the task transitions to `'completed'`

#### Scenario: Failed evidence tool blocks
- **WHEN** the only evidence tool in window is `{ toolName: 'pnpm-test', success: false, ... }`
- **THEN** `verifyCompletion` returns `ok: false`

#### Scenario: Custom hook can override
- **WHEN** a registered hook on `task.completion.verifying` calls `allow()` (e.g., the project uses `cargo test` instead of pnpm)
- **THEN** the task transitions to `'completed'` regardless of default-hook verdict

### Requirement: ResumeCoordinator restores conversation from latest checkpoint

`packages/core/src/runtime/resume-coordinator.ts` SHALL export `ResumeCoordinator` with constructor `(saver: CheckpointSaver)` and method `resume(conversationId): Promise<{ state: OffisimGraphState; lastCheckpointTs: number } | null>`.

`packages/core/src/graph/checkpoint-saver.ts` `CheckpointSaver` SHALL expose `loadLatest(conversationId): Promise<{ state, lastCheckpointTs } | null>`.

`apps/platform/src/routes/resume.ts` SHALL implement `GET /api/conversations/:id/resume` returning SSE — the first event MUST be `event: resume.snapshot` with the JSON-stringified `{ state, lastCheckpointTs }`. After the snapshot, the route MUST hand off to the existing platform stream pump for ongoing turns.

`apps/desktop/src-tauri/` SHALL expose a `resume_conversation(id)` Tauri command returning the same `{ state, lastCheckpointTs }` shape.

#### Scenario: Unknown conversation returns null
- **WHEN** `coord.resume('unknown-id')` is called
- **THEN** the result is `null`

#### Scenario: Snapshot is the first SSE event
- **WHEN** a client connects to `/api/conversations/:id/resume` for an existing conversation
- **THEN** the first SSE event has `event: resume.snapshot` and `data` parses to `{ state, lastCheckpointTs }`

#### Scenario: Reconnect after offline preserves last assistant message
- **WHEN** the browser goes offline mid-turn, comes back, and `useResumeOnReconnect` triggers
- **THEN** the UI displays the last assistant text and current `taskState` from the snapshot, without losing scroll position

### Requirement: Long-running harness scenarios validate the runtime

The following scenarios SHALL exist in `packages/core/harness/scenarios/` and pass under `pnpm harness:contract` + `pnpm harness:replay`:

- `long-running-microcompact-triggers.json` — fixture with three 100KB tool results; invariant: post-prepare token count ≤ 80k and exactly 3 micro-compact markers present.
- `completion-verifier-blocks-without-evidence.json` — fixture where employee declares done with no evidence; invariant: final task state is `'review'`, `completion-blocked` event present.

The following scenario SHALL exist and pass under `pnpm harness:soak`:

- `yolo-80-turn-multi-file-refactor.json` — invariant: outcome `'completed'`, final non-system tokens < 120k, micro-compact pass count ≥ 3, rolling-journal write count ≥ 9.

#### Scenario: Soak run produces valid metrics
- **WHEN** `pnpm harness:soak` runs `yolo-80-turn-multi-file-refactor.json`
- **THEN** the trace records `microCompactPasses ≥ 3`, `rollingJournalWrites ≥ 9`, and ends with `outcome: 'completed'`
