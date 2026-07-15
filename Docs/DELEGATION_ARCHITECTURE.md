# Offisim Multi-Agent Delegation Architecture

> Status: **Phases 1–4 implemented** (delegation, worktree review, and project-gated
> loop-until-green). This document is the architectural source of truth for the
> delegation epic. It records the child-execution decision, the neutral wire
> contract, persistence shape, host-policy limits, and the exact active Pi pin.
>
> Plan of record: `~/.claude/plans/gpt-5-5-pro-golden-kite.md`.
> Original concurrency ruling verified against `0.79.8` on 2026-06-21; active
> architecture reverified against the actually installed exact
> `@earendil-works/pi-coding-agent@0.80.7` on 2026-07-15 AEST. The npm registry
> reported `0.80.7` as `latest` on that recheck.

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

The original `scripts/pi-delegation-smoke.mjs` decision record ran against
installed `0.79.8` and passed all structural checks **plus the live concurrency
check** on 2026-06-21:

| Check | Result |
|---|---|
| A — SDK surface present | ✅ 10 required symbols, version 0.79.8 |
| B — shared registries build | ✅ 981 catalog models |
| C — two concurrent in-process sessions are isolated | ✅ distinct sessionIds, independent `messages` arrays, per-instance `prompt`/`subscribe`/`dispose`/`abort` |
| D — per-session subscriptions independent | ✅ distinct unsubscribe closures |
| E — **live** concurrent isolation | ✅ two concurrent prompts returned `ALPHA` / `BETA` with zero cross-contamination (z.ai `glm-4.5-air`) |

That table is historical evidence, not the active pin. On 2026-07-15 the same
smoke passed on exact `0.80.7`: 10 required exports, two isolated concurrent
sessions, independent subscriptions, and a live `ALPHA` / `BETA` isolation run.
The Pi registry contained 1065 models in that machine-local snapshot; the count
is diagnostic output, not an Offisim catalog or product contract.

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
const settingsManager = SettingsManager.create(cwd, agentDir, {
  projectTrusted: resolveHeadlessProjectTrust(cwd, agentDir),
})

createAgentSession({
  cwd,                                   // Phase 1: root cwd; later: child workspace
  agentDir,                              // shared
  authStorage, modelRegistry,           // shared (read-only, proven safe)
  sessionManager: SessionManager.inMemory(cwd),   // ephemeral, disk-free
  model,                                 // resolved from the child employee's config_json
  thinkingLevel,                         // child default
  tools,                                 // from child access band (read / write / review)
  resourceLoader: DefaultResourceLoader({
    cwd, agentDir, settingsManager,      // child cwd + Pi's canonical trust decision
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

### Root interaction capabilities shared with delegation

The root harness gained a small set of additive interaction surfaces on
2026-07-15/16. They
do not change the child-execution ruling and must not be reimplemented inside
`ChildAgentSupervisor`:

- **Real attachments:** parsed document/text content enters the prompt; PNG,
  JPEG, GIF, and WebP bytes enter Pi as native image content. Initial prompts,
  steering messages, and follow-ups can carry images.
- **Steer/follow-up:** while a root run is active, Offisim forwards explicit
  controls as Pi `offisim.control` custom messages using native
  `deliverAs: steer | followUp` semantics and waits for `session.waitForIdle()`.
  Correlated host admission and custom-message consumption prevent false
  acknowledgements and replay only accepted-but-unconsumed intent. The consumed
  ledger is hydrated from the exact Pi session's active JSONL branch after a host
  crash, so matching ids remain exactly-once across both renderer reattach and
  sidecar restart; a payload fingerprint rejects conflicting reuse. Pi owns
  delivery and ordering.
- **Lifecycle:** protocol v8 projects Pi's queue counts, compaction, automatic
  retry, settled, and context-usage events. Offisim renders these facts but owns
  none of those policies.
- **Blocking extension UI:** Pi `confirm`, `select`, `input`, and `editor`
  requests share one correlated FIFO request/answer channel. Host cancellation
  clears the corresponding desktop interaction. Other TUI-only UI methods remain
  no-ops in the headless host.
- **Reload adoption:** a new renderer claims surviving root hosts and their
  streams before interrupted-run recovery; active UI, queue counts, and
  non-pending control outcomes are resurfaced without creating another Pi
  session.
- **Durable Resume:** the conversation controller owns continuation of the same
  durable root under the same run id, with a replacement host and a new assistant
  message. A recorded Pi JSONL is opened exactly; only a row with no recorded
  session file gets a fresh replay of the objective, attachments, and unconsumed
  controls. Invalid recorded paths fail closed.
- **Project trust:** root and child worktrees use Pi's canonical project trust
  store and cwd-bound settings. Unknown worktrees with executable resources are
  not silently trusted.
- **Utility isolation:** Enhance and collaboration use in-memory Pi sessions with
  project resource discovery disabled; collaboration registers only its explicit
  read profile tools.

The deterministic project verification/repair loop below is an Offisim product
policy around delegated write acceptance. It is not a replacement for Pi's
provider retry, compaction, tool loop, or prompt queue.

### Project-gated write loop (P4)

Each project may store an explicit verification command, attempt cap, and optional
token cap. An empty command means the historical single-pass behavior. With a
command configured, a write child stays in the same lease worktree and repeats:

`child prompt → verifyCall → Rust bash_execute sandbox → repair prompt`

The shared bounded-loop primitive owns attempt-cap, identical-failure-signature,
and token-budget decisions for both Mission and delegate paths. Verification is
green only when the sandboxed command actually exits 0. Failure, stuck, attempt
cap, budget exhaustion, and sandbox infrastructure errors emit terminal truth;
only a green child proceeds to lease `pending_review`. Progress remains an
additive `workspace.lease.snapshot` in `agent_events`, not a second event store.

---

## 3. Current architecture

```
Root Pi Host Process (Rust-spawned, still single-shot)
├─ Root Pi Session                    ← cognition + loop + tools + delegation decision
├─ Offisim Permission Gate Extension  ← existing (plan/ask/auto/full)
├─ Offisim Delegation Extension       ← registers the `delegate` tool
└─ ChildAgentSupervisor (Node)        ← child session lifecycle + limits + event re-stamping
   ├─ Child Run A / employeeId X
   ├─ Child Run B / employeeId Y   (parallel)
   └─ Child Run C                  (controlled recursion, Phase 2)

Neutral event AgentRunEvent { threadId, rootRunId, runId, parentRunId?, employeeId?, relation?, type, payload }
   → Node host stdout (single `agentRun` wire kind)
   → Rust wire (PiAgentHostEvent::AgentRun, protocol v8)
   → renderer Channel onmessage → runtimeEventBus (neutral `agent.run.*`)
   → run-tree projection → chat (RunActivityStrip) + office (employee run states)

Persistence: agent_runs table (run tree) + agent_events (tool/telemetry and
workspace lease snapshots). MCP-specific tool audit is separate and persists to
mcp_audit_log; it is not a delegation/run-tree state sink.
```

### Component responsibilities

| Component | Owns | Current implementation |
|---|---|---|
| Root Pi Session | the user conversation, delegation decision | existing path |
| Delegation Extension | `delegate` tool registration + arg validation | `scripts/pi-delegation-extension.mjs` |
| ChildAgentSupervisor | child build / run / collect / re-stamp / limits / abort cascade | `scripts/pi-child-supervisor.mjs` |
| Rust bridge | spawn/cancel root, ordered stream replay, live control, reattach, and UI responses | `apps/desktop/src-tauri/src/pi_agent_host/` |
| Renderer runtime | translate wire → neutral bus events | desktop runtime seam |
| Run-tree projection | rebuild the run tree from events + `agent_runs` | renderer projection |

---

## 4. Neutral contract: `AgentRunEvent`

The canonical contract is `packages/shared-types/src/events/agent-run.ts`; this
document intentionally does not duplicate its evolving type definitions. It
**reuses** `RunScope`'s runId generation
(`packages/shared-types/src/run-scope.ts`) — no new id minter.
This vocabulary is **agent-agnostic**: no `pi_agent_*` term crosses into the
renderer or the Rust wire semantic layer (global constraint #1).

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

The root agent keeps its established stream (`started` / `messageDelta` / `tool`
/ `messageEnd` / `uiRequest` / `lifecycle` / `result` / `error`). Its `runId`
**is** the controller `attemptId` and serves as the `rootRunId`. The v8 lifecycle
kind is additive and does not move root events into the child `agentRun` envelope.

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
- **Protocol version**: `PI_HOST_PROTOCOL_VERSION = 8`. The current contract
  includes the additive `lifecycle` envelope plus the existing Computer,
  worktree, and verification calls. The wire convention bumps only when the
  negotiated contract requires it; optional `AgentRunEvent` payload growth stays
  additive.

The renderer's Channel `onmessage` (`apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`)
translates an `agentRun` line into a neutral `agent.run.*` bus event tagged with the
scope fields; the new run-tree projection consumes it. No `pi_agent_*` term enters
the renderer semantic layer.

---

## 6. Persistence: `agent_runs` table

`agent_runs` is part of the current local SQLite end-state schema and ships in
`schema.sql`. Fresh databases apply that baseline directly and are stamped with
the current `LOCAL_SCHEMA_VERSION` (truth source: `local_db.rs`); older
local/dev databases are disposable and are
deleted/rebuilt rather than upgraded. `schema.sql` is the authority (Rust
`include_str!`); `schema.ts` (Drizzle) must stay in lockstep, per
`packages/db-local/src/migrations/README.md`.

```sql
-- agent_runs — multi-agent delegation run tree (part of the current end-state schema).
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
| `maxParallelPerDelegation` | n/a (single) | 4 | tree-wide active-agent lease; a parent suspends its lease while awaiting descendants and reacquires it afterward, so recursive delegation cannot exceed the cap or deadlock descendants |
| `maxTotalChildren` | 1 | 16 | global counter per root run — the tree-wide cap |
| wall-clock timeout / child | — | 5 min | `AbortController` + timer |
| token / cost budget | — | reuse `ConversationBudgetService` | budget check before each child |
| per-child output cap | 50 KB | **8 KB** | supervisor truncates the structured summary, **announces** the drop |
| combined tool-result cap | — | **24 KB** | combined parallel result truncated + announced |
| parallel write safety | — | reject | parallel + any `write` task is rejected (children share one cwd); run write as `single` or sequence it |
| abort propagation | root only | whole subtree | root cancel → host kills all descendants |

Mission Loop overrides map directly onto the Pi host limits: recursion depth,
tree-wide active agents, total delegated agents, token budget, and wall-clock
budget. The host clamps overrides to its configured ceilings; a wall-clock
expiry returns immediately even when a runtime has not registered yet or abort
delivery fails.

**No silent caps**: hitting any cap (dropped concurrency, truncated output, budget
hit, depth block) must `log` / emit an event — never silently truncate.

---

## 8. Pi version policy: exact **0.80.7**

The June 2026 decision to hold `0.79.8` while the delegation epic landed remains
historically valid: it isolated an SDK upgrade from orchestration work. That
upgrade was subsequently completed. As checked on 2026-07-15 AEST, both the
root manifest and lockfile resolve exact `0.80.7`, npm marks `0.80.7` as
`latest`, and the delegation smoke passes on the installed build.

Future Pi changes remain separate, exact-pin changes with registry/changelog,
bundle, harness, and release-app verification. Delegation does not create an
independent Pi version lane.

Re-run the proof any time: `node scripts/pi-delegation-smoke.mjs` (exit 0 ⇒ viable;
exit 1 ⇒ fall back to subprocess per §2).

---

## 9. Out of scope (later epics)

- Agent autonomously creating a new **top-level thread** (spawns a top-level
  conversation; different UX from a child run).
- **Detached background agents** (`spawn_agents` / `await_agents`) — v1 `delegate()`
  awaits results synchronously; the async handle is already in place for later.
- **Handoff mode** (a specialist takes over the user conversation) — not present
  in the current relation contract; a future implementation must extend that
  contract explicitly.
- **Full Pi TUI/RPC surface** — the headless host implements only the four
  blocking UI requests and the live controls the desktop needs.
- **An Offisim tool loop, provider retry/compaction policy, model catalog, or
  full Pi session-tree/fork browser** — these remain Pi-owned and are not part
  of delegation.
