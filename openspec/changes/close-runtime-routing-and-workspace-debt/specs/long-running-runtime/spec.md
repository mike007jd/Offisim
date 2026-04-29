## MODIFIED Requirements

### Requirement: completion-verifier blocks done without evidence

`packages/core/src/runtime/hook-registry.ts` `HookEvent` union SHALL include `'task.completion.verifying'` with payload `TaskCompletionVerifyingPayload` containing `recentToolResults`, `allow()`, `block(reason)`.

`packages/core/src/agents/employee-completion.ts` SHALL emit this hook before transitioning a task to `'completed'`. If no hook handler invokes `allow()` or the default `verifyCompletion` returns `ok: false`, the task SHALL transition to `'review'` and an `appendAgentEvent({ kind: 'completion-blocked', reason })` SHALL fire.

`packages/core/src/runtime/completion-verifier.ts` SHALL export `verifyCompletion(input, opts)` returning `ok: true` only if at least one entry in the last `windowSize` (default 12) `recentToolResults` is `success === true` and `toolName` is in `evidenceTools` (default `['pnpm-test', 'pnpm-typecheck', 'pnpm-lint', 'harness-contract']`).

`packages/core/src/agents/employee-completion.ts` SHALL derive the required evidence tools from `state.taskToolIntent` via `evidenceToolsForIntent(state.taskToolIntent)` (see `task-tool-intent` capability) — NOT from a parallel inline regex. If `state.taskToolIntent` is `null` (legacy path or unhandled entry point), the verifier SHALL fall back to a fresh `detectTaskToolIntent(taskDescription)` call so behavior is identical, but the SSOT call MUST be the same `task-tool-intent` module the routing nodes use. There SHALL be no second keyword vocabulary in the completion-verifier code path.

Plain SOP text-deliverable tasks that do not ask for verification evidence, local file work, or shell work SHALL NOT be blocked merely because no tool ran. The verifier MUST NOT force fake `read_file`, `bash`, or harness evidence into ordinary text handoff steps.

The evidence classifier SHALL recognize the same local-tool intent in Chinese user/task wording as in English wording, so Chinese file or shell requests cannot pass on a text-only claim. (This requirement is satisfied structurally because the `task-tool-intent` SSOT covers both languages — there is no separate classifier to keep in sync.)

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

#### Scenario: File task requires file evidence
- **WHEN** an employee declares completion for a task that asks to read or write a workspace file
- **THEN** completion requires a successful matching `read_file` or `write_file` tool result in the recent evidence window
- **AND** a text-only claim does not complete the task.

#### Scenario: Text SOP deliverable does not require fake tool evidence
- **WHEN** an employee completes an ordinary SOP text handoff step that does not request file, shell, or verification evidence
- **THEN** the task may complete without any tool result
- **AND** no harness or mock-content assertion is accepted as substitute evidence.

#### Scenario: Chinese file request requires file evidence
- **WHEN** an employee declares completion for a Chinese task that asks to read or write a workspace file
- **THEN** completion requires a successful matching file tool result
- **AND** a Chinese text-only claim does not complete the task.

#### Scenario: Routing-evidence parity is structural
- **WHEN** comparing the routing decision `state.taskToolIntent.requiresLocalTools` with the completion verifier's required `evidenceTools` for the same task description
- **THEN** if routing required local tools AND the gate selected an internal employee, the completion verifier requires at least one entry from the matching evidence-tool family (`read_file` for needsRead, `write_file` for needsWrite, `bash` for needsBash)
- **AND** there is no path where routing fires on a text and completion-verifier does not, or vice versa, due to vocabulary drift.

## ADDED Requirements

### Requirement: Long-running harness scenarios cover routing/evidence parity and reroute observability

The following scenarios SHALL exist in `packages/core/harness/scenarios/` and pass under `pnpm harness:contract`:

- `routing-rejects-bare-noun-prose.json` — fixture with user message `Please describe the workspace and file a bug if anything looks off.`; invariant: `state.taskToolIntent.requiresLocalTools === false` AND no `task.assignment.rerouted` event fires AND direct chat with an external A2A employee dispatches successfully.
- `routing-accepts-verb-object-imperative.json` — fixture with user message `Read README.md and quote the install section.`; invariant: `state.taskToolIntent.requiresLocalTools === true`, `needsRead: true`, AND completion-verifier requires `read_file` evidence for the resulting task.
- `manager-rerouted-event-fires.json` — fixture where the LLM's manager `decision.assignments` references an external A2A employee for a `read_file` task; invariant: `task.assignment.rerouted` event present with `source: 'manager'`, `reason: 'requires-local-tools'`, and the dispatched employee is the internal fallback.
- `sanitize-rebind-uses-recommended-order.json` — fixture where `sanitizePlanEmployees` encounters a missing employee and the plan has a `recommendedEmployees` ordering; invariant: the swap picks the first valid recommended employee (NOT iteration order), AND a `task.assignment.rerouted` event fires with `source: 'pm-planner'`, `reason: 'employee-not-found'`.

`packages/core/src/testing/invariant-assertions.ts` SHALL add `assertEventEmitted(trace, eventType, predicate?)` if no equivalent helper exists.

#### Scenario: Bare-noun fixture passes routing rejection
- **WHEN** running `pnpm harness:contract routing-rejects-bare-noun-prose.json`
- **THEN** the trace records `state.taskToolIntent.requiresLocalTools === false` AND zero `task.assignment.rerouted` events

#### Scenario: Manager reroute fixture asserts event payload
- **WHEN** running `pnpm harness:contract manager-rerouted-event-fires.json`
- **THEN** the trace contains exactly one `task.assignment.rerouted` event with the asserted source, reason, requestedEmployeeId, resolvedEmployeeId fields
