# Architecture Takeaways — Offisim Streaming & Pipeline Patterns

> Nine patterns extracted from the Offisim codebase, organized by reuse priority.
> Each pattern lists where it lives, how it works, when to reuse it, and what anti-pattern it prevents.

---

## P0 — High-Value, Universally Applicable

### 1. SOP → Plan → DAG Dispatch

**One-liner**: Template workflows + DAG dependency dispatch, zero LLM cost for known patterns.

**Where it lives**:
- `core/src/services/sop-service.ts` — DAG validation, cycle detection (DFS), `getExecutionOrder()` → batches
- `core/src/agents/pm-planner-node.ts` — `matchSopTemplate()` + `sopBatchesToLlmPlan()`
- `core/src/agents/step-dispatcher-node.ts` — `isReady()` DAG-aware dispatch

**How it works**:
```
SOP layer (user-editable template, static DAG)
  → Plan layer (runtime repr; SOP match skips LLM; no-match falls back to LLM planning)
    → Dispatch layer (DAG-aware: implicit-sequential fallback + explicit dependsOnSteps)
```

Key code — `isReady()` in step-dispatcher:
```ts
if (isDagAnnotated) {
  const deps = step.dependsOnSteps ?? [];
  return deps.every(dep => completedSteps.has(dep));
}
// Implicit sequential fallback
return step.stepIndex === 0
  ? true
  : Array.from({length: step.stepIndex}, (_, i) => i).every(i => completedSteps.has(i));
```

**When to reuse**: Any multi-step AI workflow — document generation, code review pipelines, data processing chains. The SOP→Plan conversion eliminates LLM planning cost for repeated workflows.

**Anti-pattern it prevents**: Calling the LLM every time to plan a workflow that has a known, validated template.

---

### 2. rAF Batch Refresh

**One-liner**: High-frequency events batched via `requestAnimationFrame` before `setState`.

**Where it lives**:
- `ui-office/src/runtime/use-event-stream.ts` — generic hook
- `ui-office/src/runtime/use-runtime-activity-feed.ts` — consumes the pattern

**How it works**:
```ts
bufferRef.current.push(event);
if (rafRef.current === null) {
  rafRef.current = requestAnimationFrame(flush);
}
```

All events arriving in the same animation frame are batched into a single React state update.

**When to reuse**: Any streaming/real-time data scenario — chat, logs, monitoring, collaborative editing. More precise than `debounce` (aligns with browser render frame), cheaper than `throttle`.

**Anti-pattern it prevents**: Calling `setState` per chunk in LLM streaming (dozens per second), causing React render storms.

---

### 3. Dual Context Separation

**One-liner**: Stable values and volatile values in separate React Contexts to prevent re-render avalanche.

**Where it lives**:
- `ui-office/src/runtime/offisim-runtime-context.tsx` — defines `OffisimRuntimeContext` (stable) + `OffisimRuntimeStatusContext` (volatile)
- `apps/web/src/runtime/OffisimRuntimeProvider.tsx` — provides both

**How it works**:
```
StableContext  → repos, eventBus, sendMessage  (change: almost never)
StatusContext  → isRunning, version            (change: every second during execution)
```

Components needing only `isRunning` subscribe to StatusContext; components needing `repos` or `eventBus` subscribe to StableContext. Neither group triggers re-renders in the other.

**When to reuse**: Any React app with a global provider holding both stable references and frequently-changing status. Zero cost to implement (one extra `createContext`).

**Anti-pattern it prevents**: A single Context where changing `isRunning` forces every component consuming `repos` or `eventBus` to re-render.

---

## P1 — Valuable for AI/Streaming Systems

### 4. teeStream Split

**One-liner**: Single stream forked to UI rendering and persistent storage simultaneously.

**Where it lives**:
- `core/src/llm/stream-tee.ts` — `teeStream()` function

**How it works**:
```
Original AsyncIterable → teeStream() → (a) onChunk callback → real-time UI display
                                      → (b) accumulate fullContent + toolCalls + usage → final result
```

One traversal, two outputs. No need for two independent consumers racing on the same AsyncIterable.

**When to reuse**: Any LLM streaming integration, regardless of transport (SSE, WebSocket, in-process).

**Anti-pattern it prevents**: Buffering entire response before writing to DB (delays UI), or consuming the stream twice (race condition).

---

### 5. Bounded Replan (max 3x)

**One-liner**: AI self-correction with a hard ceiling to prevent infinite loops.

**Where it lives**:
- `core/src/agents/pm-replan-node.ts` — replan logic
- `core/src/graph/main-graph.ts` — `routeFromStepAdvance()` checks `replanCount < 3`

**How it works**:
```
Employee outputs [SIGNAL:REPLAN_NEEDED]
  → step_advance detects signal
  → pm_replan (LLM revises remaining steps; keeps completed steps intact)
  → step_dispatcher continues
  → Max 3 replans per execution
```

**When to reuse**: Any multi-agent system where agents can request plan changes. The pattern is: allow self-correction, but with a hard limit. Already-completed work is never rolled back.

**Anti-pattern it prevents**: Infinite replan loops where the AI keeps changing the plan without converging.

---

### 6. LLM Routing + Rule Fallback

**One-liner**: LLM classification backed by deterministic regex safety net.

**Where it lives**:
- `core/src/agents/boss-node.ts` — `BOSS_SYSTEM_PROMPT` (LLM layer) + `TASK_KEYWORDS` regex (heuristic layer)

**How it works**:
```
Layer 1: LLM classifies → action: delegate / direct_reply / meeting / ...
Layer 2: If LLM says "direct_reply" but message contains task verbs (build, create, fix, design...)
         → Override to "delegate_manager"
```

**When to reuse**: Any LLM routing system, especially with weaker/cheaper models that misclassify.

**Anti-pattern it prevents**: User says "write me a report" and the LLM incorrectly classifies it as a simple Q&A, returning a shallow direct reply instead of delegating to the work pipeline.

---

## P2 — Nice-to-Have, Context-Dependent

### 7. Burst Merge

**One-liner**: Activity feed coalesces rapid-fire events within a 3.5s window.

**Where it lives**:
- `ui-office/src/runtime/use-runtime-activity-feed.ts` — `pushEntry()` with `burstKey` matching

**How it works**:
```
Event: "Searched codebase" × 5 in 2 seconds
Display: "Searched codebase with 5 tools" (single entry)
```

Same-type events within `3_500ms` merge into one entry with a count badge. Feed capped at 6 entries (LIFO).

**When to reuse**: Any activity/log/notification stream UI — CI/CD pipelines, audit logs, notification centers.

**Anti-pattern it prevents**: Wall of identical log lines flooding the UI when an agent runs multiple tools in rapid succession.

---

### 8. Deterministic Fast Path

**One-liner**: Skip LLM when the answer is certain.

**Where it lives**:
- `core/src/agents/manager-node.ts` — single-employee shortcut

**How it works**:
```ts
if (assignableEmployees.length === 1 && !isHireOrAssess) {
  return directAssignment; // Zero LLM cost
}
```

**When to reuse**: Any multi-agent routing where some paths have deterministic answers. Each skipped LLM call saves money and latency.

**Anti-pattern it prevents**: Paying for an LLM call to "decide" when there's only one possible choice.

---

### 9. Fixed UI / Flexible Backend

**One-liner**: Simple user-facing stages wrapping complex execution topology.

**Where it lives**:
- `ui-office/src/hooks/usePipelineStage.ts` — `nodeToPipelineStage()` maps 17+ nodes to 5 stages
- `ui-office/src/components/chat/PipelineProgress.tsx` — renders the 5-stage bar

**How it works**:
```
Backend: 17-node LangGraph with DAG dispatch, replan loops, meeting subgraphs, error recovery
UI: Boss → Manager → PM → Employee → Summary (5 fixed stages)

All execution complexity collapses into "executing" stage.
```

**When to reuse**: Any complex AI pipeline where users need progress indication. The user's mental model is "thinking → doing → done", not the execution DAG topology.

**Anti-pattern it prevents**: Exposing internal execution complexity to the user, creating confusion and cognitive overload. A 15-step DAG progress bar is not more helpful than a 5-stage one — it's less.

---

## Closing Thought

> "用简单 UI 包装复杂后端" — This is not cutting corners, it is correct management of user cognitive load.
