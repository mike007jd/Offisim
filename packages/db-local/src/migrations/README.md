# Local SQLite Migrations

Offisim has not had a public release, so the local database (`offisim.db`) ships
as a **single flattened public baseline** (version 1). There is no prelaunch
upgrade history to preserve — the whole end-state shape lives in `../schema.sql`
and fresh installs bootstrap straight from it, stamped via `PRAGMA user_version`.

Public migration history starts only **after** the first public release baseline.

The runner lives in `apps/desktop/src-tauri/src/local_db.rs` (`ensure_schema`):
it reads `PRAGMA user_version`, applies any pending entries sequentially (each in
its own transaction together with the version stamp), and refuses to open a
database whose version is newer than the build.

## Adding the first post-launch migration

1. Update `../schema.sql` **and** `../schema.ts` to the new end-state shape.
2. Create `NNNN_<short-name>.sql` here, where `NNNN` is the new version
   (zero-padded, starts at `0002`). The file must upgrade version `NNNN - 1`
   to `NNNN`. Plain SQL, multiple statements allowed; no `BEGIN`/`COMMIT`
   (the runner wraps each migration in a transaction).
3. In `apps/desktop/src-tauri/src/local_db.rs`, bump `LOCAL_SCHEMA_VERSION`
   and append `(NNNN, include_str!(...))` to `MIGRATIONS`.
4. Gate: `cargo test` in `apps/desktop/src-tauri` (the `local_db` tests assert
   chain continuity), plus a manual upgrade check against a copy of a real
   pre-upgrade `offisim.db`.

Versions must be consecutive — the runner rejects gaps and incomplete chains
at startup rather than running a partial upgrade.

## Ledger

`LOCAL_SCHEMA_VERSION` is currently `12` (`apps/desktop/src-tauri/src/local_db.rs`).

| File | Version | Scope | Adds |
|------|---------|-------|------|
| `0002_artifact_provenance.sql` | v2 | Artifacts | Artifact provenance columns |
| `0003_mission_core.sql` | v3 | Missions | Mission core tables |
| `0004_collaboration.sql` | v4 | Connect | `collaboration_threads`, `collaboration_thread_members`, `collaboration_messages`, `collaboration_read_state` |
| `0005_loop_core.sql` | v5 | Loops | `loop_definitions`, `loop_revisions` (immutable), `loop_skill_bindings`, `loop_invocations` |
| `0006_collaboration_turns.sql` | v6 | Connect | `collaboration_turns` (AI-reply lifecycle ledger) |
| `0007_agent_run_interrupted.sql` | v7 | Pi Agent recovery | `agent_runs.status='interrupted'`, `agent_runs.session_file` |
| `0008_mcp_tool_grants.sql` | v8 | MCP live scope | `mcp_tool_grants`, drops graph-thread FK from MCP audit/approval ledgers |
| `0009_collaboration_profile.sql` | v9 | Connect | Company collaboration profile fields |
| `0010_agent_run_context.sql` | v10 | Pi Agent runtime | `agent_runs.context_json` |
| `0011_mcp_audit_approval_status.sql` | v11 | MCP approvals | MCP audit/approval status backfill |
| `0012_mcp_tool_grant_risk.sql` | v12 | MCP live scope | Tool-grant risk classification |

`0004` / `0005` / `0006` are the Connect + Loops additive migrations. `0007` /
`0008` / `0011` rebuild existing tables because SQLite cannot alter CHECK/FK
constraints in place. Every file's end-state matches `../schema.sql` exactly.
The collaboration tables are company-scoped (no `project_id`, no `agent_runs`
linkage) and stay separate from project `chat_threads`; see
`Docs/architecture/2026-06-26-collaboration-domain-boundary.md` and
`Docs/architecture/2026-06-26-loop-domain-mission-adapter.md`.
