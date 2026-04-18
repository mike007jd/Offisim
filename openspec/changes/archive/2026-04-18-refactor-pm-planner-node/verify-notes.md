# Live verify notes — refactor-pm-planner-node

Date: 2026-04-18
Env: repo HEAD `a32b2736` + this change applied on top

## Static gates

- `pm-planner-node.ts` NBNC = 67 ≤ 150 ✓
- `pm-planner/*.ts` = exactly 6 files (preflight / prompt-assembly / plan-parser / sop-matching / plan-persistence / plan-review-gate) ✓
- Cross-sibling imports in `pm-planner/*.ts` = 0 (grep `from '\./(preflight|prompt-assembly|plan-parser|sop-matching|plan-persistence|plan-review-gate)` → 0 matches per file) ✓
- `PM_SYSTEM_PROMPT\s*=` match inside `agents/**/*.ts` → single match in `pm-planner/prompt-assembly.ts` ✓
- Public exports preserved: `PM_SYSTEM_PROMPT`, `LlmPlanStep`, `parsePmPlan`, `matchSopTemplate`, `findEmployeeForRole`, `sopBatchesToLlmPlan`, `tryBuildSopPlan`, `pmPlannerNode` ✓
- `main-graph.ts` import line `import { pmPlannerNode } from '../agents/pm-planner-node.js';` unchanged ✓
- Shared types live in `agents/pm-planner-types.ts` (parent dir, not counted as sibling) — avoids cross-sibling import ban

## Build + typecheck

- `pnpm --filter @offisim/shared-types build` ✓
- `pnpm --filter @offisim/core build` ✓
- `pnpm --filter @offisim/ui-core build` ✓
- `pnpm --filter @offisim/ui-office build` ✓
- `pnpm --filter @offisim/web build` ✓ (bundle size unchanged vs baseline)
- `pnpm typecheck` 26/26 ✓

## Live runtime

Cleared stale vite optimized-deps (`apps/web/node_modules/.vite`, stale since `dd205c60` split-events) and restarted `pnpm --filter @offisim/web dev --force`. Fresh page on `localhost:5176`: 0 console errors, `__OFFISIM_DEBUG__.eventBus` available, provider `MiniMax-M2.7-highspeed`, 8 seeded employees.

### 11.1 LLM plan path ✅

Prompt: *"Build a small snake game: plan it as a multi-step project across research, design, implementation, and QA — coordinate across the team."*

Captured event sequence:
```
graph.node.entered(boss) → llm.call.started(boss) → llm.call.completed(boss, 6.1s)
graph.node.exited(boss) → graph.node.entered(manager)
llm.call.started(manager) → llm.call.completed(manager, 20.2s)
graph.node.exited(manager) → graph.node.entered(pm_planner)
llm.call.started(pm_planner) → llm.call.completed(pm_planner, 20.6s)
plan.created
graph.node.exited(pm_planner) → graph.node.entered(step_dispatcher)
task.state.changed × 2 → plan.step.started → employee node ...
```

`plan.created` payload (captured via `bus.on('plan.')`):
- `planId`, `threadId`, `sopTemplateId: undefined` (LLM path), `summary: "Build a small snake game through coordinated phases: research, UX/UI design, implementation, and QA testing across the full team."`, `steps: 4`
- Step 0 "research / scope" → Sophie Park (research, 195 chars), Ryan Torres (analysis, 226 chars)
- Step 1 "UX + visual design" → Zara Okafor (analysis, 222 chars), Jamie Reeves (writing, 235 chars)
- Step 2 "development" → Alex Chen (code, 228 chars)
- Step 3 "testing" → Ryan Torres (review, 263 chars), Sophie Park (analysis, 185 chars)
- Every task has `taskRunId` truthy, `taskType`, `employeeId === assigneeId`, `assigneeName` populated, `assigneeKind: 'employee'` — byte-identical to pre-refactor event-factory shape.

Post-plan pipeline progressed normally: `step_dispatcher → employee (LLM call) → memory_reflection → step_advance → plan.step.completed → step_dispatcher → employee step 1`. No regression in dispatch, state updates, or handoff.

### 11.2 SOP path (partial) ⚠

No SOP templates seeded in the default company → `tryBuildSopPlan` returned null and fell through to LLM plan (explicit evidence: `llm.call.started(pm_planner)` fires). The sibling was exercised via the fallthrough path; full SOP match verification needs a seeded SOP template whose name appears in the user intent — parked for backlog rather than live-seed SOPs here.

### 11.3 Plan review gate ⚠

Switched interaction mode to `Human` and sent a second planning prompt. The previous snake-game plan was still executing inside the same thread, so the new message appended to the ongoing turn and did not open a new `pm_planner` round. No `interaction.requested` event captured during the window. The gate code path is statically present (`prep.interactionMode === 'human_in_loop' && !approvedToExecute` check in `plan-review-gate.ts`) and unchanged from the pre-refactor inline block; a cleaner test needs a fresh thread once the prior plan settles. Marked optional and deferred.

Byte-identical invariants (observable state, event payload shape) are preserved by construction:

- `preflight` matches the original directive / reviewed-decision / valid-employee / valid-department filtering sequence; empty-result short-circuit returns the same `{ taskPlan: null, currentStepIndex: 0, stepResults: [], currentStepOutputs: [] }` shape
- `tryBuildExplicitSopPlan` mirrors the inline explicit-SOP branch (treats catch as fall-through to substring match)
- `tryBuildSopPlan` signature + body preserved
- `parsePmPlan` body preserved
- LLM call in `prompt-assembly.generatePmLlmContent` uses the same messages shape, same system prompt, same experience-section injection, same `recordedLlmCall` options (`nodeName: 'pm_planner'`, provider / model / temperature / maxTokens / signal)
- `buildLlmPlanFallback` produces the same fallback single-step plan as the original inline fallback
- `persistLlmPlanAsTaskPlan` emits `planCreated` with the same step / task mapping and `sopTemplateId` forwarding
- `persistDepartmentPlan` emits the same `planCreated` payload shape for external departments (`assigneeKind: 'department'`, `employeeId: undefined` in event payload) and same `appendAgentEvent` `{ targetKind: 'department' }` trailer
- `awaitPlanReview` preserves `interactionService.rememberPlanReviewPayload` + `interactionService.request` options (title / prompt / options / recommendation / `allowFreeformResponse: true` / `requestedByNode: 'pm_planner'` / `context.type: 'plan_review'`) and throws `PLAN_REVIEW_REQUIRED` only when `mode === 'human_in_loop' && !approvedToExecute`

## Observable behavior diff

- None intended. Pipeline branching order preserved: preflight → department short-circuit → (reviewedPlan | explicit SOP | substring SOP) → LLM plan (+ parse fallback) → plan-review-gate → persist.
