# Inert Storage Ledger (legacy orchestration residue)

Status: informational ledger — **not an action list**. The 1.0 storage contracts are
frozen (single-baseline SQLite schema; see `storage-consistency-contracts.md` and
`apps/desktop/CLAUDE.md` → Local SQLite). Removing any table/column requires a real
migration and is intentionally deferred. This file records, as of the 2026-06-24
hygiene pass, which persisted structures are **inert in the shipping desktop app**
after the LangGraph → Pi kernel migration.

## Why these are inert

The core services that used to write the orchestration tables
(`ConversationBudgetService`, `MemoryService`, `DeliverablePersistenceService`, the
recorded-call LLM middleware, `SummarizationMiddleware`) are still exported from
`@offisim/core` but are **never instantiated/wired into `apps/desktop`** (the live Pi
runtime). The corresponding legacy repository `create`/`insert` methods therefore have
zero callers. The shipping live-orchestration table is `agent_runs` (+ `agent_events`),
written by `desktop-agent-runtime`.

Classification: **WRITER-DEAD** = schema present, no live writer. **READER-DEAD** =
written but never read. **FULLY-INERT** = neither writer nor reader in the shipping app.

## Local SQLite (`packages/db-local/src/schema.sql`)

| Table | State | Notes |
|-------|-------|-------|
| `graph_threads` | WRITER-DEAD | `ThreadRepository.create` has zero callers. `updateProject` backfill removed in this pass. |
| `task_runs` | FULLY-INERT | `TaskRunRepository.create` zero callers; only memory-snapshot serialization references it. |
| `tool_calls` | FULLY-INERT | `ToolCallRepository.create` zero callers; col `review_state` unused. Pi tool activity surfaces via `agent_events`. |
| `mcp_audit_log` | FULLY-INERT | `McpAuditRepository.create` zero callers; col `approved_by` unused. |
| `handoff_events` | FULLY-INERT | Modeled LangGraph manager→employee handoffs; Pi delegation uses `agent_runs.parent_run_id`/`root_run_id`. |
| `meeting_sessions` | FULLY-INERT | Meeting-subgraph removed; the Rust `sessions.rs` reader/writer commands were deleted in this pass. Calendar surface is honest-empty. |
| `runtime_events` | FULLY-INERT | `EventRepository.insert` only called from unwired core services. |
| `recovery_knowledge` | FULLY-INERT | LangGraph recovery/replan learning store (symptom/cause/fix_strategy). |
| `file_history` | FULLY-INERT | LangGraph file-snapshot/resume store; cols `snapshot_id`/`backup_content`/`existed_before`. |
| `node_summaries` | WRITER-DEAD | `nodeSummaries.create` zero callers; readers live only inside the unwired budget/synopsis services. |
| `compact_summaries` | FULLY-INERT | `compactSummaries.create` is called only inside the unwired `SummarizationMiddleware`/`ConversationBudgetService`. |
| `memory_entries` | WRITER-DEAD | `MemoryService` unwired; cols `reinforcement_count`/`last_reinforced_at`/`access_count`/`dedupe_key`. |
| `active_thread_interactions` | FULLY-INERT | LangGraph in-flight interaction pointer; superseded by `interaction_history` (live, HITL ask-mode). |
| `llm_calls` | WRITER-DEAD, **LIVE reader** | ⚠️ `run-cost.ts` SELECTs it (joined with `model_cost_rates`) for the cost rollup shown in the UI, but no live writer exists → UI shows an empty/zero rollup. Feature gap, not dead code. |
| `deliverables` | WRITER-DEAD, **LIVE reader** | ⚠️ `queries.ts` lists it for the Activity/Outputs UI, but `DeliverablePersistenceService` is unwired → no live writer. Cols `thread_id` vs `chat_thread_id` divergence. Feature gap. |

### Employees A2A / external-agent columns (lower confidence)

`employees.a2a_url` / `a2a_token` / `a2a_agent_id` / `agent_card_json` / `brand_key` /
`is_external` are read/written by the employees repo, but the external-A2A agent
feature itself appears inert end-to-end. Left intact — verify against the A2A roadmap
before any removal.

## Platform DB (`packages/db-platform`)

| Table | State | Notes |
|-------|-------|-------|
| `install_receipts` | writer-live, reader-thin | Has 1 insert site but no direct SELECT; read only indirectly via `user_library.install_receipt_id` FK. Likely intended as a write-mostly receipt log — confirm before treating as inert. |

## Live tables (for contrast — do NOT touch)

`companies`, `employees`, `projects`, `chat_threads`, `project_assignments`, `zones`,
`prefab_instances`, `agent_runs`, `agent_events`, `interaction_history`,
`employee_versions`, `skills`, `model_cost_rates`, `settings`, `pi_messages`, and the
`install_*` family.

## Recommended follow-up (post-launch, behind a migration)

> Direction now set by `Docs/architecture/2026-06-25-truth-closure.md` (VM-001):
> `deliverables` → reuse-and-fix as the Artifact store, live writer in **VM-002**;
> cost rollup → repoint off `llm_calls` to aggregated `agent_runs.usage_json` in
> **VM-003** (the legacy `llm_calls` writer is **not** revived).

1. Decide per table: drop, or re-wire its writer (e.g. `deliverables` / `llm_calls` if
   the Activity/Outputs and cost-rollup surfaces are meant to populate).
2. The two LIVE-reader / dead-writer tables (`llm_calls`, `deliverables`) are the only
   user-visible symptoms — they render empty surfaces today. Prioritize those.
3. Bundle removals into the first post-1.0 migration (`packages/db-local/src/migrations/NNNN_*.sql`)
   per the three-step schema-change rule in `apps/desktop/CLAUDE.md`.
