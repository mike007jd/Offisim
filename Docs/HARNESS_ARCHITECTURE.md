# Harness Architecture — The pi Agent-Loop Kernel

> Source of truth for how Offisim desktop chat executes work. This describes the
> **pi kernel** that replaced the deleted LangGraph orchestration in the P6
> cut-over. If anything here disagrees with the code, the code wins — start at
> `packages/core/src/pi-bridge/` and `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`.

## 1. Overview

The pi kernel runs every Offisim worker as a **turn-based agent loop** (a model
that emits tool calls until it stops) instead of a static `StateGraph`. One AI
worker = one pi agent. There is no graph, no node table, no `MAX_TOOL_ROUNDS`
super-step counter, and no deliverable-intent guessing.

**Why it replaced LangGraph — the "fake execution" disease.** Under the graph,
boss/manager nodes routed work by *describing* what an employee would do, and on
compat models (z.ai glm, MiniMax) the model frequently **fabricated tool results
instead of producing them** — it wrote "the developer ran `ls` and found three
files" without any tool ever executing. The graph could not tell a real result
from a hallucinated one because "delegation" was prose, not a mechanism.

The pi kernel makes delegation a **real tool call**. The boss is a pure
orchestrator whose only tool is `delegate`; calling it spins up a genuine
employee sub-agent that runs genuine tools through the audited executor. The
boss may only report a result *after* the `delegate` tool result comes back
(enforced by a hard tool-discipline system prompt, see §3). Deliverables are the
same shape of fix: a worker produces one only by calling `submit_deliverable` —
a conversational reply is never mistaken for an artifact.

## 2. Package Layout

Three packages, two vendored (forked) and one integration layer:

| Package | Role |
|---|---|
| `@offisim/pi-ai` (`packages/pi-ai`) | Model transport. `streamSimple(model, context, options)` is the streaming entry point. Two retained APIs — `anthropic-messages` and `openai-completions` — plus the message/content types (`AssistantMessage`, `ToolResultMessage`, `TSchema`). It validates raw JSON Schema natively (`coerceWithJsonSchema`). |
| `@offisim/pi-agent` (`packages/pi-agent`) | The agent loop. `Agent` owns a transcript + `streamFn` + `transformContext`; `.prompt()` / `.continue()` / `.waitForIdle()` / `.abort()` drive it; `.subscribe()` yields `AgentEvent`s. Types: `AgentMessage`, `AgentTool`, `AgentToolResult`, `StreamFn`, `ThinkingLevel`. |
| `pi-bridge` (`packages/core/src/pi-bridge`) | The Offisim integration layer (this doc's subject). Adapts Offisim repos/tools/budget/events onto the pi loop. |

`@offisim/pi-ai` does **not** use pi's generated model catalog — models come from
Offisim runtime provider profiles (z.ai Coding Plan / MiniMax), and **credentials
are never put into pi-ai**. `createPiStreamFn` injects a transport `fetch` plus a
placeholder key (`TAURI_MANAGED_API_KEY = 'offisim-tauri-managed'`); the real
secret is attached inside the Rust `llm_fetch` command and never crosses the JS
boundary (`pi-bridge/pi-stream.ts`).

### Bridge files (`packages/core/src/pi-bridge/`, barrel `index.ts`)

| File | Responsibility |
|---|---|
| `pi-orchestration-service.ts` | The kernel. `PiOrchestrationService` — `execute` / `resume` / `abortThread`, per-thread serialization, `ensureThreadRow`, the boss system prompt, tool assembly, the runaway round guard, and recursive `delegate` → sub-agent. |
| `pi-agent-registry.ts` | `PiAgentRegistry` — run-level set of active agents keyed by thread, for whole-team abort. Replaces the graph's single `AbortController` per thread now that N agents run per thread. |
| `pi-stream.ts` | `createPiStreamFn` — wraps `streamSimple` with the credential-isolated transport `fetch` (the credential seam). |
| `pi-model.ts` | `buildPiModel` / `laneToPiApi` — maps an Offisim resolved model + provider lane onto a pi `Model<Api>`. `anthropic` → `anthropic-messages`; everything else → `openai-completions` (with a `MINIMAX_COMPAT` pin, since pi's compat auto-detect has no MiniMax branch). Cost is zeroed — Offisim budgets by token count. |
| `pi-tool-adapter.ts` | `toolDefsToAgentTools` / `toolDefToAgentTool` — wrap each Offisim `ToolDef` as a pi `AgentTool` that routes through the `ToolExecutor` (the `AuditingToolExecutor` in production). A failed `ToolCallResponse` is thrown so the loop encodes it as a tool-result message (pi's "throw on failure" contract). Carries `PiToolContext` (thread/company/employee identity). |
| `pi-delegate-tool.ts` | `createDelegateTool` — the `delegate` virtual tool. For a LOCAL employee it calls back into `runLocalEmployee` (recurses into `runWorker`); for an EXTERNAL (A2A) employee it builds an `A2APeer` and `sendAndWait`. `executionMode: 'parallel'` lets the boss delegate to several employees in one turn. |
| `pi-deliverable-tool.ts` | `createSubmitDeliverableTool` — the `submit_deliverable` virtual tool (employee turns only). Emits `deliverableCreated` with contributor brand fields (`employeeBrandFields`) byte-compatible with the old `mapPayloadToRow`; `DeliverablePersistenceService` writes the row. |
| `pi-event-bridge.ts` | `createPiEventListener` — stamps company/thread/employee identity onto pi `AgentEvent`s before emitting `llm.stream.chunk` (content + reasoning channels). Does **not** emit tool telemetry — `AuditingToolExecutor` already does, so re-emitting would double-count. |
| `pi-budget.ts` | `createBudgetTransform` — wires `ConversationBudgetService` into pi's `transformContext` hook (runs before each LLM call). Never throws: on failure it passes the transcript through unchanged. |
| `pi-message-convert.ts` | `piToLlmMessage(s)` / `llmToPiMessage(s)` — converts between pi content-block messages and Offisim's flat `LlmMessage`, so the unchanged budget service runs on the flat shape and the pruned result is mapped back by tail-alignment (preserving thinking signatures). |
| `pi-message-store.ts` | `PiMessageStore` — per-message persistence to `pi_messages` and `patchDanglingToolCalls` (the resume repair patch). |

## 3. Execution Flow — one turn

A direct-chat or boss turn runs as follows
(`desktop-agent-runtime.ts` `execute()` → `pi-orchestration-service.ts`):

1. **`DesktopAgentRuntimeImpl.execute()`** resolves a bound project
   (`ensureProjectBoundForRun`, so file/shell tools have a `workspace_root`),
   builds the `RunScope` (`<projectId>::<threadId>::<employeeId?>`), and calls
   `PiOrchestrationService.execute()`.
2. **`execute()` → `withThreadLock(threadId, …)`** serializes per thread.
   Replaces the graph's implicit single-stream serialization now that N agents
   can share a thread.
3. **`runTurn` → `runWorker`** resolves the worker kind: `employeeId` present →
   `'employee'`; absent → `'boss'`. It builds the system prompt, resolves the
   model (`ModelResolver` → `buildPiModel`), assembles tools, and constructs the
   budget `transformContext`.
4. **`ensureThreadRow(params)`** — only for the top-level turn (not sub-agents).
   pi reuses `graph_threads` as the thread/session registry. The row **must**
   exist before any audited tool runs because
   `mcp_audit_log.thread_id REFERENCES graph_threads(thread_id)`; without it every
   tool-audit insert (e.g. a delegated sub-agent's `bash`) silently fails the FK.
   `updateStatus` is a bare `UPDATE` that no-ops on a missing row, so a fresh pi
   thread is `create()`d here with `entry_mode` `boss_chat` / `direct_chat`.
5. **Boss agent.** The boss system prompt is a hard tool-discipline orchestrator
   prompt: *use real work → call `delegate`; you may state an employee did
   something ONLY AFTER its `delegate` result is in this conversation; inventing a
   result is strictly forbidden.* The roster (enabled employees only) is injected
   by id. The boss gets **only** the `delegate` tool — no bash/write/MCP — because
   it has no `employeeId` and any direct executor call would mis-attribute the
   audit row.
6. **`delegate` tool → employee sub-agent.** When the boss calls `delegate`
   (`pi-delegate-tool.ts`), a LOCAL employee runs through a fresh `runWorker` under
   the **same thread** (so whole-team abort reaches it) with the boss's tool-call
   signal as `parentSignal`. An EXTERNAL employee goes over A2A. The sub-agent's
   output reaches the user only via the boss's summary.
7. **Real tools, audited.** The employee gets the full audited tool set: builtin
   `read_file` / `write_file` / `bash` / `glob` / `grep` plus any registered stdio
   MCP server, deduped and routed through `AuditingToolExecutor`. The
   `CompositeToolExecutor` dispatches builtins by name and falls through to
   `McpToolExecutor` for MCP tools.
8. **`submit_deliverable`** (employee only) emits `deliverableCreated`; the boss
   never gets this tool.
9. **Completion.** `agent.waitForIdle()`, then `extractFinalAssistantText` walks
   the transcript backwards for the last assistant text. The top-level turn
   updates `graph_threads.status`; `finalText` returns up to the desktop runtime.

**Runaway round guard**: a `turn_end` counter aborts the agent at
`DEFAULT_MAX_TOOL_ROUNDS = 200`. This replaces the graph's `MAX_TOOL_ROUNDS` /
recursion-limit, which vanished with the graph. The model is expected to stop
long before this.

## 4. Persistence

**`pi_messages`** (`schema.sql`) is the per-message transcript: one row per pi
message (`message_id`, `thread_id`, `company_id`, `employee_id`, `seq`, `role`,
`message_json`, `created_at`, `UNIQUE(thread_id, seq)`). pi-agent has no serialize
API — `AgentContext.messages` is plain data — so the transcript is persisted
message-by-message (`PiMessageStore.append`, finer than the old super-step
checkpoint) and tools are re-attached on load. The table is **standalone** (no FK
to `graph_threads`) so pi threads survive independent of the legacy thread
lifecycle.

- **Multi-turn memory.** A top-level turn rehydrates its transcript via
  `messageStore.loadTranscript(threadId)` and seeds the agent's `messages`. Every
  finished message persists through the event bridge's `onMessageEnd` →
  `persistMessage`. **Delegated sub-agents do not persist**
  (`if (params.parentSignal) return`) — their internal messages must not
  interleave into the boss thread's history.
- **Resume.** `resume()` loads the transcript; if the last message is an assistant
  message the turn already completed → returns `null` (honest "nothing to
  resume"). Otherwise it continues as the worker that owned the thread
  (`threadOwnerEmployeeId`) with `continueRun: true`, calling `agent.continue()`
  instead of `agent.prompt()`.
- **Dangling-toolCall patch** (`patchDanglingToolCalls`, `pi-message-store.ts`).
  pi throws if the transcript ends with an unanswered `toolCall` (e.g. a crash
  mid-tool). On load a synthetic `toolResult` (`isError: true`) is inserted
  immediately after each dangling call, preserving `tool_use → tool_result` order
  so the ResumeBar never crashes on restart.

**`graph_threads`** (`schema.sql`) is retained as the thread/session registry:
status reads, the ResumeBar, and crucially the audit FK target. pi does not own a
new thread table — it reuses this one via `ensureThreadRow`.

## 5. Tool Execution + Audit

Every tool call — builtin and MCP — routes through the retained
`AuditingToolExecutor` (assembled in `desktop-agent-runtime.ts`), which wraps the
`CompositeToolExecutor`. Each call lands in `mcp_audit_log` attributed to the
**executing employee** (`PiToolContext.employeeId` threaded into the executor's
`execute()` request). This is what makes delegation auditable: a delegated
employee's `bash` is recorded under *that* employee, not the boss. The bash tool's
own shell classifier still gates destructive commands; the Rust sandbox
(`builtin_tools.rs`, 8 MB read/write caps, `workspace_root` jail) is unchanged.

**Virtual tools** (`delegate`, `submit_deliverable`) carry their own `execute` and
do **not** route through the executor's builtin/MCP dispatch — they are
orchestration-internal, matching pi's agent-as-tool model.

## 6. The Record/Replay Gate

`scripts/harness-pi-loop.mjs` is the deterministic test contract that replaced the
graph-coupled `harness:contract` / `replay` / `deterministic` gates. It drives the
real `PiOrchestrationService` with a **faux `StreamFn`** (scripted turns keyed by
boss-vs-employee via the system prompt, no real provider) and in-memory repos, and
asserts the kernel's load-bearing invariants:

- **direct chat** — final text matches, no tools called for a plain reply.
- **multi-round tools** — `bash` executes via the recording executor, attributed
  to the employee, and the final reply reports the real tool output.
- **explicit deliverable** — `submit_deliverable` emits `deliverable.created` with
  a title and contributor brand fields.
- **boss → delegate → employee sub-agent → tool (the headline mechanism)** — the
  boss's `delegate` call really spins up the employee sub-agent, the sub-agent
  really runs `bash`, the audit row is attributed to the **delegated** employee
  (not the boss), and the boss summary reflects the real result. This is the
  direct proof the "fake execution" disease is dead.
- **multi-turn memory** — two turns persist four `pi_messages` rows, contiguous
  `seq`, owner stamped.
- **resume** — an interrupted thread (user message, no assistant reply) resumes to
  a continuation; resuming a completed thread is a clean `null` no-op.
- **regression guard** — a deliberately-wrong expectation that MUST be flagged,
  proving the harness actually catches regressions.

Pure Node, no app, no network — run it as the pi-kernel CI gate (wired into
`pnpm validate` as `harness:pi-loop`).

## 7. What Was Removed

The P6 cut-over erased the entire graph orchestration:

- **`packages/core/src/graph/`** — the LangGraph `StateGraph`, nodes
  (boss / manager / step-dispatcher / employee / boss-summary / meeting), and
  routing.
- **`packages/core/src/agents/`** — `task-tool-intent` (relocated to `engine/`),
  `completion-verifier(-evidence)`, `employee-completion`, `boss-node`,
  `pm-planner`, and the intent-guessing chain the `submit_deliverable` tool
  replaced. (`employee-builder` → `pi-bridge/`; `skill-install-tools` → `skills/`.)
- **`@langchain` / LangGraph dependencies** — gone from `packages/core/package.json`
  (now `@offisim/pi-ai` + `@offisim/pi-agent` workspace deps only).
- **The checkpoint tables** — `checkpoints`, `writes`, `graph_checkpoints` no
  longer exist in `schema.sql`. The `TauriCheckpointSaver` / `SqliteSaver`
  super-step checkpoint is replaced by per-message `pi_messages` persistence.
- **`yolo-master`** as a runtime kernel — the agent-loop concept is now the *only*
  kernel, so a separate "yolo" lane is meaningless. (The `yolo_master` *role slug*
  was also dropped from company templates.)
- The single-shot direct-provider completion that predated the graph — the pi loop
  is now the **only** chat path on desktop.

---

**Anchors:** kernel `packages/core/src/pi-bridge/pi-orchestration-service.ts`;
desktop assembly `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`;
gate `scripts/harness-pi-loop.mjs`; schema `packages/db-local/src/schema.sql`
(`graph_threads`, `pi_messages`).
