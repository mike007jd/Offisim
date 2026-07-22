# Local Storage Reachability Ledger

Status: current prelaunch baseline inventory. This is evidence, not permission to
delete a table in isolation. Any future cleanup must prove shipping reachability,
public-contract impact, dynamic access, and gate coverage together.

Checked at: **2026-07-23 NZST**.

## Baseline cleanup completed

The production-dead LangGraph/recorded-call residue below was removed atomically
from `schema.sql`, `schema.ts`, all repository backends, public barrels, memory
snapshots, deep-delete SQL, gates, and docs. Offisim is prelaunch, so this was a
fresh-baseline correction with a `LOCAL_SCHEMA_VERSION` bump, not a migration:

- `task_runs` — replaced by `agent_runs` plus mission/loop domain rows.
- `tool_calls` — live tool truth is `agent_events` and `mcp_audit_log`.
- `handoff_events` — delegation truth is `agent_runs.parent_run_id/root_run_id`.
- `recovery_knowledge` — obsolete LangGraph recovery learning store; Mission and
  workspace recovery remain intact.
- `file_history` — obsolete snapshot store; workspace checkpoints are authoritative.
- `llm_calls` — obsolete Offisim-owned request recorder; usage truth is
  `agent_runs.usage_json`, while subscription-native engines report tokens/duration
  without API-cost reconstruction.

Related dead columns (`mcp_audit_log.task_run_id` and
`memory_entries.source_task_run_id`) and the unconnected recorded-LLM/context-pack
surface were removed in the same baseline batch.

## Current nuanced rows

| Table | State | Evidence / contract |
|---|---|---|
| `graph_threads` | LIVE writer | Desktop persists thread status through `threads.create` and `persistThreadRuntimeStatus`. |
| `meeting_sessions` | WRITER-DEAD + LIVE reader | Board activity still selects it. Keep until the product removes or replaces that reader. |
| `runtime_events` | WRITER-DEAD + LIVE reader | Board activity still selects it. It is not safe to delete as an inert table. |
| `node_summaries` | PRODUCTION-UNWIRED + PUBLIC/GATE-LIVE | `ConversationBudgetService`, `SynopsisGenerator`, and summary-only `NodeContextMiddleware` still consume the repository; staged-compaction is part of validate. |
| `compact_summaries` | PRODUCTION-UNWIRED + PUBLIC/GATE-LIVE | `ConversationBudgetService` reads/writes its staged-compaction ledger, covered by `harness-staged-compaction`. |
| `memory_entries` | LIVE | Personnel manually creates, updates, deletes, and reads memories. The optional automatic `MemoryService` remains unwired to the desktop gateway. |
| `active_thread_interactions` | **LIVE** | `ConversationRunController` writes pending ask/HITL state, hydrates by company/thread, and clears it on resolution/dismissal; Mission reload also reads it. `interaction_history` stores resolved history and does not replace this pending pointer. |
| `deliverables` | LIVE | `publish_artifact` → `artifact.created` → `AgentRunPersistence.persistArtifact`; Outputs/Preview/Computer read it. |

The previous 2026-07-21 ledger incorrectly labeled
`active_thread_interactions` fully inert. Three independent reachability reviews
confirmed that production behavior had already been live since 2026-06-20; this
ledger corrects that error and the table remains in the baseline.

## Lower-confidence inventory

Employee external-agent columns (`a2a_url`, `a2a_token`, `a2a_agent_id`,
`agent_card_json`, `brand_key`, `is_external`) have repository readers/writers but
their end-to-end product ability is not yet proven. Keep until an explicit A2A
product decision and independent reachability audit.

Platform `install_receipts` is writer-live and indirectly referenced by
`user_library.install_receipt_id`; it is a write-mostly receipt log, not an inert
candidate.

## Cleanup rule

Current repo state and gates are authoritative. A schema row is removable only
when production calls, public consumers, dynamic SQL, configs/build variants,
harnesses, and historical intent all agree. Repository construction alone is not
life evidence; a public or validate-reachable capability is not dead merely because
the shipping desktop does not currently instantiate it.
