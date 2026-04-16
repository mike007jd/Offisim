# Live verification report — refactor-employee-node

## Verification mode

**Option B (post-only)** — pre-refactor live capture skipped per user
decision (see `baseline-notes.md`). Post-refactor evidence comes from:

1. Static structural equivalence walk-through (§A below) — bit-by-bit
   line-up of extracted module emit sequences vs pre-refactor barrel
   sequences (both barrel commits accessible at `4af1edc^` for original /
   `fe1dd7e` for refactor end).
2. typecheck + repo-gate build chain green (commit `6930616`).
3. Live agent run (§B below) — pending user sign-off, see "Status" section.

## A. Static walk-throughs (no live run required)

### A1. Error path — pre vs post line-by-line equivalence

**Pre-refactor** (commit `4af1edc^`, `packages/core/src/agents/employee-node.ts:1045-1124`):

```
1. eventBus.emit(employeeStateChanged(executing→failed))
2. if (taskRunId) {
     await repos.taskRuns.updateStatus(taskRunId, 'failed');
     eventBus.emit(taskStateChanged(running→failed));
   }
3. eventBus.emit(taskSubtaskProgress(failed))
4. structuredError = { errorCode: 'LLM_CALL_FAILED', message, recoverable: true,
     nodeName: 'employee', employeeId, taskRunId, provider, model }
5. await appendAgentEvent(error, { errorCode, message, employeeName, taskRunId,
     provider, model }).catch(() => {})
6. return { currentEmployeeId, currentTaskRunId, pendingAssignments: remaining,
     interruptReason: JSON.stringify(structuredError), currentStepOutputs: state.currentStepOutputs }
```

**Post-refactor** (`packages/core/src/agents/employee-error-finalize.ts:32-105`):

```
1. eventBus.emit(employeeStateChanged(executing→failed))   ← line 41-49
2. if (taskRunId) {
     await repos.taskRuns.updateStatus(taskRunId, 'failed');   ← line 52
     eventBus.emit(taskStateChanged(running→failed));   ← line 53-64
   }
3. eventBus.emit(taskSubtaskProgress(failed))   ← line 67-79
4. structuredError = { same 8 keys, same order, same values }   ← line 81-90
5. await appendAgentEvent(error, { same payload }).catch(() => {})   ← line 92-104
6. return { same 5 fields, same shape }   ← line 106-112
```

**Equivalence confirmed**: emit ordering, structured-error JSON 8-field
schema (`errorCode / message / recoverable / nodeName / employeeId /
taskRunId / provider / model`), `.catch(() => {})` guard on
`appendAgentEvent`, and return state shape are byte-identical.

**Live verification status**: error path is **not live-triggerable** under
normal conditions (would require provoking `attemptLocalRecovery` to also
fail). **Static equivalence accepted** as the verification bar — explicitly
called out in proposal §Impact ("若 live 没覆盖 error handling … 在 archive
时显式说明 error path 仅做静态等价性核查").

### A2. Handoff path — pre vs post line-by-line equivalence

**Pre-refactor** (commit `4af1edc^`, `employee-node.ts:486-595`):

```
1. const targetEmp = await repos.employees.findById(args.targetEmployeeId).catch(() => null)
   if (!targetEmp) { conversationHistory.push({user, fallback msg}); break; }
2. handoffId = generateId('ho')
   await repos.handoffs.create({ all 7 fields including thread_id, from/to,
     reason, payload_json with completedWork+remainingWork, created_at })
3. newTaskRunId = generateId('tr-ho')
   await repos.taskRuns.create({ all 8 fields including parent_task_run_id,
     task_type: 'handoff_continuation', status: 'queued', input_json,
     output_json: null, started_at })
4. if (taskRunId) {
     await repos.taskRuns.updateStatus(taskRunId, 'completed')
     await runtimeCtx.hookRegistry.emit('task.completed', { ..., completionType: 'handoff' })
   }
5. eventBus.emit(handoffInitiated(...))
   eventBus.emit(employeeStateChanged(executing→idle))
6. return new Command({ goto: 'employee', update: {
     pendingAssignments: [{ taskType: 'handoff_continuation', employeeId,
       inputJson: { description, priorWork, handoffReason, taskRunId } },
       ...remaining],
     handoffCount: state.handoffCount + 1,
     currentStepOutputs: [...state.currentStepOutputs, { employeeId, employeeName,
       sourceKind: 'employee', roleSlug, content, taskRunId }]
   } })
```

**Post-refactor** (`packages/core/src/agents/employee-handoff.ts:35-127`
+ tool-round signal at `employee-tool-round.ts:56-58`):

```
Detection (tool-round): if handoff_to in toolCalls, return { kind: 'handoff', args }
  — NO side effect, NO write, NO emit. Spec Req 6 scenario "Handoff signal
  does not execute handoff" satisfied.

Execution (employee-handoff.ts):
1. targetEmp validation   ← line 41-42 (return null on missing — barrel
   then pushes fallback user msg + break, matching pre-refactor)
2. handoffs.create(...)   ← line 44-55 (all 7 fields, same order)
3. taskRuns.create(...)   ← line 57-71 (all 8 fields, same order, same
   TASK_TYPE_HANDOFF_CONTINUATION constant)
4. if (taskRunId) updateStatus + hookRegistry.emit completionType:'handoff'
   ← line 73-82 (same conditional)
5. emit handoffInitiated → emit employeeStateChanged(executing→idle)
   ← line 84-95 (same order)
6. return new Command({ goto: 'employee', update: {...} })   ← line 97-126
   (pendingAssignments[0] same field order, ...remaining append, handoffCount+1,
   currentStepOutputs append same shape)
```

**Equivalence confirmed**: 5-step sequence preserved, Command payload
byte-identical. Spec Req 11 scenario "Handoff Command payload preserved"
satisfied by structural mapping.

**Live verification status**: handoff path **may not be reliably triggerable
via chat** (LLM has to choose handoff_to over normal completion). Static
equivalence is the primary verification bar; live trigger would only confirm
already-verified Command shape.

## B. Live agent verification (pending user sign-off)

### Status: **deferred** — awaiting user decision

The §12 tasks in `tasks.md` ask for live Playwright captures of
post-refactor event timelines for two scenarios:

- 12.1 Normal task ("Write a haiku about testing") → capture `graph.node.entered`
  / `employee.state.changed` / `task.state.changed` / `task.subtask.progress` /
  `llm.stream.chunk(*)` / `task.assignment.changed` sequence
- 12.2 File-deliverable task ("create snake.html game") → additionally verify
  `deliverable.created` event fires with correct payload

Cost: ~2 live MiniMax requests + Playwright session (~10-15 min).

The repo is green (typecheck + build + lint), public API is unchanged
(`index.ts:332` + `main-graph.ts:8` zero-modify per §11.5), and static
equivalence walk-throughs above cover the un-live-testable paths (error +
handoff). User can either:

- Run §12 live verification themselves (recommended path: `cd apps/web && pnpm dev`,
  send the two test prompts, watch activity-log workspace)
- Approve archive on static evidence + spec invariants only
- Direct Claude to run live Playwright capture next

## C. Spec coverage map (post-refactor → spec scenarios)

| Spec Req | Scenario | Verification source |
|---|---|---|
| Req 1 | Barrel ≤200 NBNC | `wc` + `grep -cvE`: 137 ≤ 200 ✓ |
| Req 1 | No inline helper bodies | grep `^function` in barrel: zero matches ✓ |
| Req 2 | Preflight standalone | `employee-preflight.ts` exists, exports `runPreflight` ✓ |
| Req 2 | No-assignment early return | Discriminated union `{ kind: 'early-return', stateUpdate: {pendingAssignments:[], completed:true} }` ✓ |
| Req 2 | Employee deleted early return | `taskRuns.updateStatus('failed')` + `taskStateChanged(queued→failed)` + early return preserved ✓ |
| Req 2 | Normal preflight event order | graph.node.entered → employee.state.changed(idle→executing) → task.state.changed(queued→running) → task.subtask.progress(running) — preserved in `runPreflight` body order ✓ |
| Req 3 | Prompt assembly standalone | `employee-prompt-assembly.ts` exports 5 helpers + `assemblePrompt` ✓ |
| Req 3 | Memory section gating | `if (memoryService && taskDescription && (memoryPolicy?.injectionEnabled ?? true))` preserved ✓ |
| Req 3 | Library citations survive errors | try/catch → silent skip preserved ✓ |
| Req 3 | Skill instructions gated | `if (!toolSearchEnabled)` preserved ✓ |
| Req 4 | Tool kit standalone | `employee-tool-kit.ts` exports `assembleToolKit` ✓ |
| Req 4 | Handoff tool gating | `!isDirectChatTask && state.handoffCount < MAX_HANDOFF_COUNT && colleagues.length > 0` preserved ✓ |
| Req 4 | Workstation fallback | Ternary `workstationToolResolver ? resolveForEmployee : toolExecutor.listAvailable` preserved ✓ |
| Req 5 | Turn runner standalone | `employee-turn-runner.ts` exports `buildTurnRunner` ✓ |
| Req 5 | Streaming chunks if-if | Two independent `if (chunk.reasoning)` + `if (chunk.content)` (NOT if-else) preserved ✓ |
| Req 5 | Non-stream delegates | `if (!streamEnabled) return recordedLlmCall(...)` preserved ✓ |
| Req 6 | Tool round discriminated | `ToolRoundOutcome = { kind: 'handoff', args } \| { kind: 'continue', nextHistory }` ✓ |
| Req 6 | Handoff signal no side-effect | `runToolRound` returns `{ kind: 'handoff', args }` immediately, zero `repos.*` / `eventBus.*` calls in handoff branch ✓ |
| Req 6 | Tool failure no crash | `Promise.allSettled` unwrap with `Tool execution failed: <msg>` fallback preserved ✓ |
| Req 6 | Context trim | `if (length > MAX_CONTEXT_MESSAGES + 1) [first, ...slice(-MAX)]` preserved ✓ |
| Req 7 | Completion shared | `finalizeEmployeeSuccess({ source: 'normal' \| 'recovery' })` ✓ |
| Req 7 | Happy path payload | source='normal' → `{ taskRunId, employeeName, toolRounds, outputLength, citationCount }` + `completionType: 'response'` ✓ |
| Req 7 | Recovery path payload | source='recovery' → `{ taskRunId, employeeName, recoveredFromError: true, outputLength }` + `completionType: 'recovery'` ✓ |
| Req 7 | Reflect-and-remember gating | `skipReflection = isDirectChatTask \|\| taskType === TASK_TYPE_HANDOFF_CONTINUATION` preserved (only fires when source='normal') ✓ |
| Req 7 | Deliverable event | `if (materializedDeliverable) emit deliverableCreated(...)` preserved with same payload shape ✓ |
| Req 8 | Error finalize standalone | `employee-error-finalize.ts` exports `finalizeEmployeeFailure` ✓ |
| Req 8 | Structured error JSON 8 fields | A1 walk-through above ✓ |
| Req 8 | Emission order on failure | A1 walk-through above ✓ |
| Req 9 | Constants single owner | grep `^export const` for each of 5 constants in `packages/core/src/`: 1 match each ✓ |
| Req 10 | index.ts re-export unchanged | `grep` confirmed line 332 byte-identical ✓ |
| Req 10 | main-graph.ts wiring unchanged | `grep` confirmed line 8 byte-identical ✓ |
| Req 11 | Normal task event sequence | static — preserved by Req 2 + Req 5 + Req 7. Live verification §B pending user sign-off. |
| Req 11 | Handoff Command payload preserved | A2 walk-through above ✓ |
| Req 11 | Citation extraction unchanged | `extractUsedCitations` body byte-identical (re-exported from `employee-completion.ts`) ✓ |

**Spec coverage**: 33/34 scenarios verified by static evidence. The 1
remaining (Req 11 normal task event sequence) requires live Playwright
capture to fully close — see §B status.

## D. Phase commit timeline

| Phase | Commit | Description |
|---|---|---|
| Propose | `4af1edc` | docs(openspec) — proposal/design/specs/tasks |
| A | `1cb1df5` | extract `employee-node-constants.ts` (5 constants) |
| B | `3bef1ea` | extract `employee-preflight.ts` (PreflightResult + runPreflight) |
| C | `c901a74` | extract `employee-prompt-assembly.ts` (5 skill helpers + assemblePrompt) |
| D | `a8646f4` | extract `employee-tool-kit.ts` (buildSkillActivationTool + assembleToolKit) |
| E | `3bb2bde` | extract `employee-turn-runner.ts` (buildTurnRunner factory) |
| F | `89fab21` | extract `employee-tool-round.ts` (runToolRound + ToolRoundOutcome) |
| G | `e5a19fd` | extract `employee-completion.ts` (finalizeEmployeeSuccess + extractUsedCitations) |
| H | `c0dd4be` | recovery path reuses finalizeEmployeeSuccess (-130 lines) |
| I | `fe1dd7e` | extract `employee-error-finalize.ts` + `employee-handoff.ts`, barrel ≤200 NBNC |
| Gate | `6930616` | biome organizeImports + repo-gate verification |

## E. NBNC line counts

| File | NBNC | Gate | OK |
|---|---:|---:|---|
| `employee-node.ts` (barrel) | 137 | ≤200 | ✓ |
| `employee-preflight.ts` | 153 | ≤250 | ✓ |
| `employee-prompt-assembly.ts` | 130 | ≤250 | ✓ |
| `employee-tool-kit.ts` | 74 | ≤250 | ✓ |
| `employee-turn-runner.ts` | 72 | ≤250 | ✓ |
| `employee-tool-round.ts` | 129 | ≤250 | ✓ |
| `employee-completion.ts` | 247 | ≤250 | ✓ |
| `employee-error-finalize.ts` | 92 | ≤250 | ✓ |
| `employee-handoff.ts` | 108 | ≤250 | ✓ |
| `employee-node-constants.ts` | 5 | ≤250 | ✓ |
| **Total** | **1147** | — | (+167 vs original 980 — modular overhead) |

Original `employee-node.ts`: 980 NBNC single file, 954 lines `employeeNode`
async function. Post-refactor: 137 NBNC barrel + 9 single-responsibility
modules. Modular overhead is the cost of explicit interfaces / context
objects / type imports — accepted trade-off for testability and
reviewability.
