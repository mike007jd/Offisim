# Inert Storage Ledger (legacy orchestration residue)

Status: informational ledger — **not an action list**. The local storage shape is
the current prelaunch SQLite baseline; see `storage-consistency-contracts.md`
and `apps/desktop/CLAUDE.md` -> Local SQLite. Removing any table/column requires
a deliberate baseline cleanup plus matching code/docs/harness updates, not a
historical user-data migration. This file records which persisted structures are
**inert (or partially inert) in the shipping desktop app** after the LangGraph →
Pi/engine-neutral kernel migration.

Checked at: **2026-07-21**.

## Why some rows still look “alive” in the warehouse

Core services that historically wrote orchestration tables
(`ConversationBudgetService`, `MemoryService` auto-memory,
`DeliverablePersistenceService`, the recorded-call LLM middleware,
`SummarizationMiddleware`) may still be **exported** from `@offisim/core` and
exist as repository/schema surface. **Warehouse export / schema presence is not a
production writer.** A table is production-live only when the shipping desktop app
instantiates and invokes a writer on a real run or user action. Legacy
`create`/`insert` methods with zero production callers remain WRITER-DEAD even
when the package still exports them.

Classification:

- **WRITER-DEAD** = schema present, no live production writer.
- **READER-DEAD** = written but never read by a product surface.
- **FULLY-INERT** = neither production writer nor product reader in the shipping app
  (retention / cascade `DELETE` is not a product reader).
- **LIVE** = production writer and/or product reader as noted per row.

## Local SQLite (`packages/db-local/src/schema.sql`)

| Table | State | Notes |
|-------|-------|-------|
| `graph_threads` | LIVE writer | Desktop runtime persists thread status via `threads.create` / `persistThreadRuntimeStatus` (`thread-runtime-status.ts`, mission/desktop-agent-runtime). Older “WRITER-DEAD / zero callers” claim is stale as of 2026-07-21. |
| `task_runs` | FULLY-INERT | `TaskRunRepository.create` zero callers; only memory-snapshot serialization references it. |
| `tool_calls` | FULLY-INERT | `ToolCallRepository.create` zero callers; col `review_state` unused. Pi tool activity surfaces via `agent_events`. |
| `handoff_events` | FULLY-INERT | Modeled LangGraph manager→employee handoffs; Pi delegation uses `agent_runs.parent_run_id`/`root_run_id`. |
| `meeting_sessions` | WRITER-DEAD + **LIVE reader** | Meeting-subgraph / production writer removed. Board `activity-data.ts` still SELECTs the table. Calendar remains honest-empty (no live writer). |
| `runtime_events` | WRITER-DEAD + **LIVE reader** | `EventRepository.insert` only called from unwired core services. Board `activity-data.ts` still SELECTs the table. |
| `recovery_knowledge` | FULLY-INERT | LangGraph recovery/replan learning store (symptom/cause/fix_strategy). |
| `file_history` | FULLY-INERT | LangGraph file-snapshot/resume store; cols `snapshot_id`/`backup_content`/`existed_before`. |
| `node_summaries` | WRITER-DEAD | `nodeSummaries.create` zero callers; readers live only inside the unwired budget/synopsis services. |
| `compact_summaries` | FULLY-INERT | `compactSummaries.create` is called only inside the unwired `SummarizationMiddleware`/`ConversationBudgetService`. |
| `memory_entries` | **LIVE** manual writer + **LIVE** reader | Personnel `personnel-data.ts` wires `memories.create` / `update` / `delete` / `findByOwner`. `MemoryService` automatic memory is still exported but **not** production-wired. |
| `active_thread_interactions` | FULLY-INERT | LangGraph in-flight interaction pointer; superseded by `interaction_history` (live, HITL ask-mode). |
| `llm_calls` | **FULLY-INERT** production table | Cost UI (`run-cost.ts`) reads only `agent_runs.usage_json`. Legacy `recordedLlmCall*` callers are not production-wired. Retention / cascade `DELETE` is not a product reader. |
| `deliverables` | **LIVE** writer + **LIVE** reader | `publish_artifact` → `artifact.created` → `AgentRunPersistence.persistArtifact` writes rows. Outputs / Preview / Computer and related surfaces read them. |

### Employees A2A / external-agent columns (lower confidence)

`employees.a2a_url` / `a2a_token` / `a2a_agent_id` / `agent_card_json` / `brand_key` /
`is_external` are read/written by the employees repo, but the external-A2A agent
feature itself appears inert end-to-end. Left intact — verify against the A2A roadmap
before any removal.

## Platform DB (`packages/db-platform`)

| Table | State | Notes |
|-------|-------|-------|
| `install_receipts` | writer-live, reader-thin | Has 1 insert site but no direct SELECT; read only indirectly via `user_library.install_receipt_id` FK. Likely intended as a write-mostly receipt log — confirm before treating as inert. |

## Live tables (for contrast — do NOT touch casually)

`companies`, `employees`, `projects`, `chat_threads`, `project_assignments`, `zones`,
`prefab_instances`, `agent_runs`, `agent_events`, `mcp_audit_log`, `interaction_history`,
`employee_versions`, `skills`, `model_cost_rates`, `settings`, `pi_messages`,
`deliverables`, `memory_entries` (manual Personnel path), `graph_threads`, and the
`install_*` family.

## Recommended follow-up (baseline schema cleanup)

> Direction history: `Docs/architecture/2026-06-25-truth-closure.md` (VM-001)
> decided Artifact reuse of `deliverables` and cost truth on `agent_runs.usage_json`.
> **VM-002** (Artifact writer) and **VM-003** (cost reader repoint) are **done** as of
> 2026-07-21; see the implementation follow-up banner on that ADR. Current inventory
> truth is this ledger; product/runtime direction is
> `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md`.

1. Decide per still-inert table: drop, or re-wire a deliberate production writer.
2. There is no longer a user-visible “LIVE reader / dead writer” symptom pair on
   `llm_calls` / `deliverables` — those gaps closed. Remaining WRITER-DEAD + LIVE
   reader rows (`meeting_sessions`, `runtime_events`) are Board activity SELECTs over
   empty writers, not cost/Outputs feature gaps.
3. Bundle removals into a deliberate baseline cleanup: update `schema.sql`,
   `schema.ts`, affected repositories, docs, and gates **together**. Do not add a
   prelaunch compatibility migration or migration debt.
