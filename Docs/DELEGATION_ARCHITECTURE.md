# Offisim Multi-Agent Delegation Architecture

> Status: **Phase 0 ratified** (truth check + child-mechanism decision, no behavior
> change). This document is the architectural source of truth for the delegation
> epic (Phases 1–5). It records the child-execution decision, the neutral wire
> contract, the persistence shape, the host-policy limits, and the reason we stay
> on the pinned Pi version.
>
> Plan of record: `~/.claude/plans/gpt-5-5-pro-golden-kite.md`.
> Verified against the actually-installed `@earendil-works/pi-coding-agent@0.79.8`
> on 2026-06-21.

---

## 1. Architecture ruling (adopted)

Offisim moves off the flat "one session = one Pi agent" model to a **hybrid**:

> **Pi owns cognition + execution + the root agent's autonomous decision of when /
> to-whom to delegate. Offisim owns who may participate, where they run, how
> they're constrained, how runs are recorded, and how the user sees and controls
> them.**

Default orchestration paradigm = **manager-as-tools**: the root Pi agent always
holds the user conversation; children do bounded work; the root agent synthesizes
the final answer. Fixed flows (research → plan → implement → review) are a **Pi
Skill / prompt template** that guides the root agent to call the delegation tool —
we do **not** rebuild a graph engine. Code enforces only the genuinely
deterministic constraints (maxDepth / maxParallelPerDelegation / maxTotalChildren /
timeout / budget / abort propagation / output cap).

---

## 2. Child-execution decision: **in-process concurrent `createAgentSession`**

### Decision

The `ChildAgentSupervisor` builds children **in-process** by calling
`createAgentSession` again inside the existing Node host process. Rust owns only
the **root** host process; the whole child lifecycle lives inside the Node host.
Aborting the root (Rust `CancellationToken`) tears down the host process and with
it every child.

### Why (live-proven, not assumed)

`scripts/pi-delegation-smoke.mjs` runs against the installed 0.79.8 and passed all
structural checks **plus the live concurrency check** on 2026-06-21:

| Check | Result |
|---|---|
| A — SDK surface present | ✅ 10 required symbols, version 0.79.8 |
| B — shared registries build | ✅ 981 catalog models |
| C — two concurrent in-process sessions are isolated | ✅ distinct sessionIds, independent `messages` arrays, per-instance `prompt`/`subscribe`/`dispose`/`abort` |
| D — per-session subscriptions independent | ✅ distinct unsubscribe closures |
| E — **live** concurrent isolation | ✅ two concurrent prompts returned `ALPHA` / `BETA` with zero cross-contamination (z.ai `glm-4.5-air`) |

Structural evidence backing the decision:

- `AgentSession` is a class whose every collaborator (`agent`, `sessionManager`,
  `settingsManager`, `_modelRegistry`, `_toolRegistry`, `_cwd`, `_eventListeners`)
  is an **instance field**, not a module singleton.
- No `process.chdir` / module-level mutable singleton in `agent-session.js` /
  `sdk.js`; `cwd` is a per-call option, so sibling sessions rooted at different
  directories cannot stomp each other.
- `SessionManager.inMemory(cwd)` gives each child an ephemeral, disk-free session.
- `authStorage` + `modelRegistry` are read-only at run time and safe to share
  across siblings (they are already shared between status + execute today).

### Why not the official subprocess example

The official subagent example
(`node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts`)
spawns a separate `pi` **process** per child. It does so because it runs as a
third-party **TUI extension** with no programmatic access to `createAgentSession` —
its only route to an isolated agent is to shell out to the `pi` CLI binary. The
Offisim host is different: it imports the SDK directly and already holds
`authStorage` + `modelRegistry`. In-process is simpler, lower-overhead, and reuses
the host's existing permission-gate / persona / event-stream machinery. The
bundled host also does not ship a `pi` CLI binary, so the subprocess path would
require shipping or locating one — extra surface we avoid.

### Fallback (documented, not taken)

If a future Pi release makes in-process concurrency unreliable, mirror the official
example: the supervisor `child_process.spawn`s a child variant of the same host
entry; the child's JSONL is re-stamped (runId / parentRunId / relation) by the
supervisor and forwarded on the root stdout stream. Even then, **child lifecycle
stays inside the Node host** and Rust still owns only the root process — so the
wire contract and renderer projection below are unaffected by the choice.

### How a child is constructed (Phase 1+)

```
createAgentSession({
  cwd,                                   // Phase 1: root cwd; later: child workspace
  agentDir,                              // shared
  authStorage, modelRegistry,           // shared (read-only, proven safe)
  sessionManager: SessionManager.inMemory(cwd),   // ephemeral, disk-free
  model,                                 // resolved from the child employee's config_json
  thinkingLevel,                         // child default
  tools,                                 // from child access band (read / write / review)
  resourceLoader: DefaultResourceLoader({
    extensionFactories: [
      permissionGate,                    // reuse host gate
      delegateToolFactory,               // Phase 2: recursion (depth-gated)
    ],
    appendSystemPrompt: [childPersona],  // from employee persona_json
  }),
})
```

Abort: `childSession.abort()` plus the supervisor's `AbortController`; the parent
`AbortSignal` cascades to every descendant.

---

## 3. Target architecture (post-landing)

```
Root Pi Host Process (Rust-spawned, still single-shot)
├─ Root Pi Session                    ← cognition + loop + tools + delegation decision
├─ Offisim Permission Gate Extension  ← existing (plan/ask/auto/full)
├─ Offisim Delegation Extension       ← NEW: registers the `delegate` tool
└─ ChildAgentSupervisor (Node)        ← NEW: child session lifecycle + limits + event re-stamping
   ├─ Child Run A / employeeId X
   ├─ Child Run B / employeeId Y   (parallel)
   └─ Child Run C                  (controlled recursion, Phase 2)

Neutral event AgentRunEvent { threadId, rootRunId, runId, parentRunId?, employeeId?, relation?, type, payload }
   → Node host stdout (single `agentRun` wire kind)
   → Rust wire (PiAgentHostEvent::AgentRun, protocol v4)
   → renderer Channel onmessage → runtimeEventBus (neutral `agent.run.*`)
   → run-tree projection → chat (RunActivityStrip) + office (employee run states)

Persistence: agent_runs table (run tree) + agent_events (tool/telemetry).
Note: mcp_audit_log is a legacy LangGraph-era table and is inert — not a delegation
persistence sink (see Docs/contracts/inert-storage-ledger.md).
```

### Component responsibilities

| Component | Owns | New / existing |
|---|---|---|
| Root Pi Session | the user conversation, delegation decision | existing path |
| Delegation Extension | `delegate` tool registration + arg validation | NEW (`scripts/pi-delegation-extension.mjs`) |
| ChildAgentSupervisor | child build / run / collect / re-stamp / limits / abort cascade | NEW (`scripts/pi-child-supervisor.mjs`) |
| Rust bridge | spawn root, stream stdout, cancel root, write uiResponse | existing + 1 wire variant |
| Renderer runtime | translate wire → neutral bus events | existing seam, extended |
| Run-tree projection | rebuild the run tree from events + `agent_runs` | NEW (renderer) |

---

## 4. Neutral contract: `AgentRunEvent` (Phase 1 draft)

Lands in `packages/shared-types/src/events/agent-run.ts`. **Reuses** `RunScope`'s
runId generation (`packages/shared-types/src/run-scope.ts`) — no new id minter.
This vocabulary is **agent-agnostic**: no `pi_agent_*` term crosses into the
renderer or the Rust wire semantic layer (global constraint #1).

```ts
// `parallel` is NOT a relation — fan-out is DelegateExecutionMode ('single' |
// 'parallel'). Relation is parent-child semantics only.
export type AgentRunRelation = 'delegate' | 'review';

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentRunEventType =
  | 'run.started'
  | 'run.delta'        // child token stream (content | reasoning)
  | 'tool.started'
  | 'tool.completed'   // includes failed (carries status)
  | 'artifact.created'
  | 'approval.requested'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

/** Scope fields ride on every event — the run-tree is rebuilt purely from these. */
export interface AgentRunScopeFields {
  readonly threadId: string;
  readonly rootRunId: string;       // the controller attemptId of the user turn
  readonly runId: string;           // this run's id (RunScope-minted)
  readonly parentRunId?: string;    // omitted for the root
  readonly employeeId?: string;     // stable identity executing this run
  readonly relation?: AgentRunRelation;
  readonly workKind?: WorkKind;     // semantic kind of work (delegate-stamped)
}

export interface AgentRunEvent extends AgentRunScopeFields {
  readonly type: AgentRunEventType;
  readonly payload: AgentRunPayload;
}

/** Discriminated by AgentRunEvent.type (kept small; extended per phase). */
export type AgentRunPayload =
  | { objective: string; access: AgentRunAccess }            // run.started
  | { channel: 'content' | 'reasoning'; delta: string }      // run.delta
  | { toolCallId: string; toolName: string; detail?: string } // tool.started
  | { toolCallId: string; toolName: string; status: 'completed' | 'failed'; detail?: string; durationMs?: number } // tool.completed
  | { title: string; ref?: string }                          // artifact.created
  | { uiRequestId: string; title: string; message?: string } // approval.requested
  | { status: AgentRunStatus; summary?: string; usage?: AgentRunUsage } // run.completed | failed | cancelled
  | Record<string, never>;

export type AgentRunAccess = 'read' | 'write' | 'review';

export interface AgentRunUsage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly cost?: number;
  readonly turns?: number;
}

/** Persisted run record (mirrors the agent_runs row). */
export interface AgentRunRecord extends AgentRunScopeFields {
  readonly companyId: string;
  readonly objective: string;
  readonly access: AgentRunAccess;
  readonly status: AgentRunStatus;
  readonly usage?: AgentRunUsage;
  readonly resultSummary?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
}
```

### Minimal delegation interface (v1)

```ts
delegate({
  tasks: [{ employeeId, objective, access: 'read' | 'write' | 'review',
            workKind?, relation? }],
  executionMode: 'single' | 'parallel',
})
```

The supervisor holds an async handle per child (`runId / events / result / abort()`).
Future detached background agents only need to expose `spawn_agents` / `await_agents`
on top — they do not overturn this layer. Specialist takeover (transferring the
user conversation) is a later epic; until it is implemented, `handoff` is NOT an
`AgentRunRelation` value — it was removed from the `delegate` tool schema so the
model is not offered a relation the runtime can't honor.

---

## 5. Wire transport decision: **one neutral `agentRun` envelope kind**

The root agent keeps its existing event stream unchanged (`started` / `messageDelta`
/ `tool` / `messageEnd` / `result` / `error`). Its `runId` **is** the controller
`attemptId` and serves as the `rootRunId`. We do **not** churn the root path.

**Children** flow through a single new wire kind, `agentRun`, whose payload is the
neutral `AgentRunEvent` envelope. One extensible kind (rather than a kind per event
type) keeps the wire stable as Phases 2–4 add event types, and keeps the contract
agent-agnostic.

- **Node**: `agentRunLine(event)` in `scripts/pi-agent-host-wire.mjs`; add
  `'agentRun'` to `PI_WIRE_KINDS`.
- **Rust**: add `AgentRun { thread_id, root_run_id, run_id, parent_run_id?,
  employee_id?, relation?, r#type, payload }` to both `PiAgentHostEvent` and
  `PiSidecarLine` (keep `tag="kind"`, `rename_all="camelCase"`,
  `rename_all_fields="camelCase"`). `payload` decodes to `serde_json::Value`
  (opaque, like `result.response`), so the wire stays stable while payloads grow.
- **Fixture**: add ≥1 `agentRun` line to `scripts/fixtures/pi-wire-contract.json`.
- **Gate**: the `agentRun` spec (required: `threadId`, `rootRunId`, `runId`,
  `runType`, `payload`; allowed: + `parentRunId`, `employeeId`, `relation`,
  `workKind`) in `scripts/check-pi-wire-contract.mjs`, plus a cargo round-trip test.
- **Protocol version**: `PI_HOST_PROTOCOL_VERSION = 4`. `workKind` was added as an
  optional-additive field (no required-shape change), so it did NOT bump the
  version — the wire convention bumps only when a line's *required* shape changes.

The renderer's Channel `onmessage` (`apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`)
translates an `agentRun` line into a neutral `agent.run.*` bus event tagged with the
scope fields; the new run-tree projection consumes it. No `pi_agent_*` term enters
the renderer semantic layer.

---

## 6. Persistence: `agent_runs` table

Part of the flattened prelaunch baseline: `agent_runs` ships whole in
`schema.sql` (`LOCAL_SCHEMA_VERSION = 1`, empty `MIGRATIONS`). `schema.sql` is the
authority (Rust `include_str!`); `schema.ts` (Drizzle) must stay in lockstep, per
`packages/db-local/src/migrations/README.md`. The first post-launch schema change
adds the first real migration.

```sql
-- agent_runs — multi-agent delegation run tree (part of the v1 baseline).
-- thread_id is plain TEXT (no FK): the desktop chat path uses chat_threads and
-- never creates a graph_threads row, so a graph_threads FK would silently reject
-- every insert. Matches agent_events; cleaned up via company FK cascade +
-- explicit per-thread deletes in local-data-deletion.
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id              TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  parent_run_id       TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
  root_run_id         TEXT NOT NULL,
  employee_id         TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  relation            TEXT,
  objective           TEXT,
  access              TEXT,
  status              TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
  usage_json          TEXT,
  result_summary_json TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_root ON agent_runs(root_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);
```

`AgentRunsRepository` follows the existing repository pattern (interface in
`packages/core/src/runtime/repositories.ts`; Drizzle + memory + Tauri backends in
sync). The root run + each child run write a row; subtree usage rolls up into the
root's `usage_json` at finalize (Phase 2). Persistence is serialized on a
per-runtime promise chain so a child's row is created before its terminal update.
`thread_id` is plain TEXT (no `graph_threads` FK) — see the DDL note above.

Roster delivery: the renderer builds the company roster (each employee's resolved
persona via `buildDelegationContext` over `EmployeeRepository.findByCompany`) and
forwards it in the execute request; Rust passes it through verbatim in
`sidecar_payload` (thin pipe). The supervisor builds children locally from it.

---

## 7. Host policy — deterministic limits (defined here, enforced Phase 2)

| Limit | Phase 1 | Phase 2 default | Enforced by |
|---|---|---|---|
| `maxDepth` | 1 (no recursion) | 2 | supervisor depth counter; over → tool `block` + reason |
| `maxParallelPerDelegation` | n/a (single) | 4 | **per parallel fan-out** (`mapWithConcurrencyLimit`), not a global blocking semaphore — a parent awaiting children must not hold a slot a child needs (deadlock). Tree-wide instantaneous concurrency is bounded by `maxTotalChildren`. |
| `maxTotalChildren` | 1 | 16 | global counter per root run — the tree-wide cap |
| wall-clock timeout / child | — | 5 min | `AbortController` + timer |
| token / cost budget | — | reuse `ConversationBudgetService` | budget check before each child |
| per-child output cap | 50 KB | **8 KB** | supervisor truncates the structured summary, **announces** the drop |
| combined tool-result cap | — | **24 KB** | combined parallel result truncated + announced |
| parallel write safety | — | reject | parallel + any `write` task is rejected (children share one cwd); run write as `single` or sequence it |
| abort propagation | root only | whole subtree | root cancel → host kills all descendants |

**No silent caps**: hitting any cap (dropped concurrency, truncated output, budget
hit, depth block) must `log` / emit an event — never silently truncate.

---

## 8. Pi version policy: stay on **0.79.8**

The smoke proved every required API is present and that in-process concurrency
**live-works** on the pinned 0.79.8. Upstream main is 0.79.9, but the delegation
seam holds at 0.79.8 and 0.79.9 offers no needed delta. Per global constraint #2
("don't refactor while upgrading Pi"), the entire epic stays on 0.79.8; a Pi
upgrade is a separate, later effort.

Re-run the proof any time: `node scripts/pi-delegation-smoke.mjs` (exit 0 ⇒ viable;
exit 1 ⇒ fall back to subprocess per §2).

---

## 9. Out of scope (later epics)

- Agent autonomously creating a new **top-level thread** (spawns a top-level
  conversation; different UX from a child run).
- **Detached background agents** (`spawn_agents` / `await_agents`) — v1 `delegate()`
  awaits results synchronously; the async handle is already in place for later.
- **Handoff mode** (a specialist takes over the user conversation) — reserved
  `AgentRunRelation` value only.
- **Full Pi RPC Extension UI Protocol** — the host stays single-shot; trigger =
  host becomes long-lived OR a second mid-run UI scenario appears.
- **Pi 0.79.8 → 0.79.9 upgrade** — out for the whole epic.
```
