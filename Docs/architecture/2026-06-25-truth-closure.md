# Truth Closure: run / artifact / cost / evaluation source-of-truth

> **Partially superseded (2026-07-16):** retained for run/artifact/evaluation
> decision history. Its single Pi-run and aggregated-token Cost assumptions are
> not current: API Cost and subscription-native Usage are separate contracts.
> Use [Engine-neutral AI Accounts](./2026-07-13-engine-neutral-ai-accounts.md).

> **Implementation follow-up (2026-07-21):** **VM-002** (Artifact live writer on
> `deliverables` via `publish_artifact` → `artifact.created` →
> `AgentRunPersistence.persistArtifact`) and **VM-003** (cost panel reads
> `agent_runs.usage_json` only; `llm_calls` is a FULLY-INERT production table) are
> **complete**. The body below keeps the 2026-06-25 decision history and must not
> be rewritten as if those gaps were still open. **Current storage/runtime truth**
> is [inert-storage-ledger.md](../contracts/inert-storage-ledger.md) plus
> [Engine-neutral AI Accounts](./2026-07-13-engine-neutral-ai-accounts.md).

Checked at: 2026-06-25 NZST; updated 2026-06-29 NZST for MCP audit/runtime;
implementation follow-up noted 2026-07-21 NZST.
Status: accepted (Milestone M0, slice VM-001)
Supersedes the conflicting acceptance assertions corrected below. Historical note:
as of VM-001 acceptance this ADR did **not** yet change runtime code or storage
schema (those landed later in VM-002 / VM-003 — implemented/merged in current
source; see follow-up above).

## Why

Verified Missions (PRD `Offisim_Verified_Missions_PRD_v1.0`) must build on tables
that are actually written on a live run. Today several user-visible surfaces read
from legacy LangGraph-era tables that have **no live writer**, and several QA /
feature docs still assert those dead tables receive data. This ADR fixes the
*facts*: it names the single source of truth for each product concept, points every
user-visible surface at a live writer (or declares an honest gap with a fix owner),
and removes the doc assertions that contradict reality.

The authoritative inventory of inert tables is `Docs/contracts/inert-storage-ledger.md`
(verified accurate, zero drift, as of the 2026-06-24 hygiene pass). This ADR does not
duplicate it; it decides *direction* per surface.

## Decisions

### D1 — Run truth = `agent_runs` + `agent_events`; MCP audit truth = `mcp_audit_log`

The only live run-truth tables are `agent_runs` (root + child run tree) and
`agent_events`. They are written by `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`
(via `agent-runs.ts` / `agent-events.ts` Tauri repos) on every real Pi run.
Delegation/run-tree is modeled by `agent_runs.parent_run_id` / `root_run_id`.
Already stated in `Docs/DELEGATION_ARCHITECTURE.md` and the inert ledger; ratified here.

MCP tool-call audit is now live in `mcp_audit_log`, written by the Pi MCP bridge
projection. Approval semantics are explicit: read-only calls persist
`approval_status='not_required'`, approved writes persist `human_approved`, and denied
writes persist `human_denied` without invoking the MCP server.

`run.completed` from a runtime is **not** Mission completion. (PRD §0, §14.2 rule 7.)

### D2 — Artifact truth = reuse-and-fix `deliverables`, Artifact-semantic API

Resolves PRD §34 Q1. Offisim **reuses** the existing `deliverables` table as the
artifact store rather than adding a parallel `artifacts` table, but the product API,
events, and UI must speak **Artifact** semantics (PRD §17.6). The current table lacks
`content_hash`, `version`, and `mission_id` / `attempt_id` / `run_id` provenance
columns; a forward migration adds them in **VM-002**, which also wires the first live
writer (`publish_artifact` first-party Pi bridge tool). Until VM-002 ships, the
Outputs surface (`ConvOutputs`) is an honest empty (live reader, no live writer).

We do **not** revive the unwired `DeliverablePersistenceService` /
`deliverable.created` event path; the writer is the new bridge tool.

### D3 — Cost truth = aggregated `agent_runs.usage_json`

The live cost/usage source is `agent_runs.usage_json`, populated by
`desktop-agent-runtime.ts` on `run.completed/failed/cancelled` and rolled up
child→root (`reconcileRoot`, ~`desktop-agent-runtime.ts:522-563`). The cost panel's
current dependency on `llm_calls` is a reader-with-dead-writer dead link; **VM-003**
repoints `run-cost.ts` to aggregate `agent_runs.usage_json` and stops reading
`llm_calls`. We do **not** revive the legacy `recordedLlmCall` / `llm_calls` writer
(PRD §21.2). Provider-reported cost may be absent; the UI must show *unavailable*,
never a fake `$0.00`.

Known gap VM-003 must also close: today `reconcileRoot` only sums *child* usage and
explicitly skips the root's own run (`desktop-agent-runtime.ts:538`), so a **solo
(non-delegation) run leaves the root `usage_json` null** — the root Pi session's own
token usage is not forwarded on the wire. VM-003 must wire the root session usage onto
the run-completed payload and into `usage_json`, not merely repoint the reader.

A unified `runtime_usage_events` / per-request `llm_calls` table is only revisited if
per-provider-request diagnostics become a real product need (PRD §21.2) — out of scope
for M0.

### D4 — Evaluation truth = `mission_evaluation` (schema in MS-001, writer in M2)

Mission criterion verdicts live in the `mission_evaluation` table owned by the Evaluator
service (PRD §17.4, §20). The schema landed in MS-001 (migration 0003, alongside the rest
of the Mission core data layer); it has no live writer/reader yet — the EvaluatorRegistry +
MissionService wire it in M2. Declared here so no surface is later wired to a self-graded
agent claim.
Deterministic evaluator verdict — never the root agent's "I'm done" — decides PASS
(PRD §5, App-A D-003).

### D5 — Inert tables stay inert; no doc may assert data in them

The LangGraph-era tables enumerated below (the inert ledger's full local-SQLite list,
minus the two writer-dead/live-reader feature gaps `llm_calls` and `deliverables`
handled by D2/D3) remain schema-frozen with no live writer until a deliberate
baseline schema cleanup/removal plan.
No QA scenario, feature spec, or release gate may assert that any of them
(`tool_calls`, `meeting_sessions`,
`handoff_events`, `task_runs`, `runtime_events`, `recovery_knowledge`, `file_history`,
`compact_summaries`, `node_summaries`, `memory_entries`, `active_thread_interactions`,
`graph_threads`) receives data on a live run.

## Surface → live-writer truth map

| User-visible surface | Reads | Live writer today | Verdict |
|---|---|---|---|
| Chat transcript / run telemetry | `agent_runs`, `agent_events`, `pi_messages` | `desktop-agent-runtime.ts`, `pi-messages` repo | **LIVE** |
| Run tree / delegation (RunActivityStrip, office states) | `agent_runs` (parent/root) | `desktop-agent-runtime.ts` | **LIVE** |
| Activity feed | `agent_events`, `mcp_audit_log` (+ `interaction_history`) | `desktop-agent-runtime.ts`, Pi MCP bridge projection, permissions repo | **LIVE** |
| Approvals (Ask mode HITL) | `interaction_history` | `permissions` repo | **LIVE** |
| Token / cost panel | currently `llm_calls` → **repoint to** `agent_runs.usage_json` | `desktop-agent-runtime.ts` (usage_json) | **GAP → VM-003** |
| Outputs / deliverables | `deliverables` | none yet → `publish_artifact` | **GAP → VM-002** |
| Calendar (Workspace app) | `meeting_sessions` | none (subgraph removed) | **HONEST-EMPTY** (no roadmap writer in M0) |

Every surface either has a live writer or is an explicitly-owned gap (VM-002 / VM-003)
or an honest-empty by design (Calendar). No surface silently depends on an inert table
without this ADR naming the resolution.

## Conflicts corrected by this ADR

1. `Docs/test-loops/codex-functional-test-loop.md` **M6** — now distinguishes live
   MCP audit (`mcp_audit_log`) from the still-dead `llm_calls` cost table.
2. `Docs/test-loops/codex-functional-test-loop.md` **coverage map** — Calendar marked
   as data-covered by S1; corrected to honest-empty.
3. `Docs/test-loops/codex-functional-test-loop.md` **"Deliberately NOT a scenario"** —
   claimed boss→employee delegation "does not exist in the current Pi runtime (removed
   with LangGraph)". **Stale and false**: delegation is live (`createChildSupervisor`
   wired at `scripts/tauri-pi-agent-host.entry.mjs:557`, `delegate` tool registered).
   Corrected to: delegation exists but is deliberately excluded from the deterministic
   auto-loop (non-deterministic fan-out), not absent.
4. `Docs/FEATURES.md` — Calendar listed as a current Workspace App; clarified as
   honest-empty (`meeting_sessions` inert).
5. `Docs/FEATURES.md` — Activity "mirrors … tool audit rows"; corrected to mirror
   `agent_events` and MCP-specific `mcp_audit_log` (Pi tool activity does not use inert
   `tool_calls`).
6. `Docs/DELEGATION_ARCHITECTURE.md` — persistence line referenced `mcp_audit_log`;
   corrected to reserve `mcp_audit_log` for MCP tool audit, not delegation/run-tree state.

## PRD §34 open decisions settled here

- **Q1 (deliverables → Artifact vs new table):** reuse-and-fix `deliverables`,
  Artifact-semantic API. See D2.
- Q2 (generic Tauri command cutover vs shim), Q3 (Pi 0.80.2 upgrade timing), Q4–Q9:
  out of VM-001 scope; deferred to their owning slices (RD-003, VM-004, M2+).

## Consequences

- VM-002 must add the artifact-provenance columns + `publish_artifact` writer and flip
  the Outputs surface live.
- VM-003 must repoint the cost reader to `agent_runs.usage_json` and render
  *unavailable* when provider cost is missing.
- VM-005's runner asserts these surfaces against their live writers (not inert tables).
- The inert ledger remains the inventory; this ADR is the directional decision record.
