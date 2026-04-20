## ADDED Requirements

### Requirement: Desktop migrations SQL files cover every drizzle-defined table

For every `sqliteTable('<name>', ...)` declaration in `packages/db-local/src/schema.ts`, the desktop-side embedded migrations set (the sum of SQL files in `Docs/03_migrations/offisim_migrations_local_v0.1/` referenced by `apps/desktop/src-tauri/src/lib.rs:fn migrations()`) SHALL contain at least one `CREATE TABLE` statement creating `<name>` with a shape that is byte-equivalent to the drizzle definition (same column names, SQL types, NOT NULL / DEFAULT / PRIMARY KEY / FK cascade attributes, and composite indexes). Temporary rename-helper tables (conventionally `<name>_new`) are allowed and not counted against parity as long as the final committed `<name>` matches drizzle. The purpose is to prevent desktop-only schema drift of the kind that caused `node_summaries` / `compact_summaries` to silently not exist on Tauri through v32.

#### Scenario: Every schema.ts sqliteTable has a desktop CREATE TABLE

- **WHEN** auditing `schema.ts`'s `sqliteTable(...)` declarations against `grep -rh 'CREATE TABLE' Docs/03_migrations/offisim_migrations_local_v0.1/*.sql`
- **THEN** every table name from the schema SHALL appear in at least one `CREATE TABLE` in the migrations set
- **AND** the column list and constraints SHALL be byte-equivalent to the drizzle definition

#### Scenario: New table added to schema.ts requires new desktop migration

- **WHEN** a future change adds a new `sqliteTable('new_table', ...)` declaration to `schema.ts`
- **THEN** the same change (or a coordinated sibling change before archive) SHALL add a new versioned SQL migration file (e.g. `034_new_table.sql`) and extend `apps/desktop/src-tauri/src/lib.rs:fn migrations()` with the corresponding `Migration { version: 34, ... include_str!(...) }` entry
- **AND** the change's archive-gate spec-consistency check SHALL fail if either the SQL file or the `lib.rs` entry is missing

#### Scenario: LangGraph-internal tables are excluded from parity

- **WHEN** auditing parity
- **THEN** `checkpoints` / `writes` / `graph_checkpoints` tables that are owned by `langgraph-checkpoint-sqlite` (or the self-maintained `apps/web/src/lib/tauri-checkpoint.ts` fork) SHALL NOT be required in `schema.ts` — they are LangGraph-internal persistence, not Offisim application schema
- **AND** their desktop migration entries (currently v6 `006_langgraph_checkpoints.sql`) SHALL continue to stand independently

### Requirement: `node_summaries` and `compact_summaries` exist on desktop

Desktop Tauri runtime SHALL have `node_summaries` and `compact_summaries` tables available at application start. These tables persist `NodeContextMiddleware` summaries + `ConversationBudget` summarization checkpoints. Absence of either table causes middleware `before()` to throw SQLite `no such table` errors that the middleware chain catches as warnings — the LLM call proceeds but the agent prompt's context-pack + conversation-summary budgets (default 1000 + 700 chars) are both empty, degrading agent quality and potentially triggering downstream state-mutation errors (observed symptom in T2.3 live verify: `Attempted to assign to readonly property.`).

#### Scenario: Migration v33 creates both tables on existing DB

- **WHEN** a user with an existing desktop DB that was created before v33 upgrades to a build containing migration v33
- **THEN** Tauri plugin-sql (wrapping sqlx `migrate!()`) SHALL apply v33 on app start, creating both `node_summaries` and `compact_summaries`
- **AND** `SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('node_summaries','compact_summaries')` SHALL return 2

**Note on migration tracking** — `tauri-plugin-sql` is backed by sqlx `SqlitePool::migrate()` which maintains its own `_sqlx_migrations` table and does NOT write SQLite's `PRAGMA user_version`. Validating `user_version=33` against a real user DB is the wrong oracle and SHALL NOT be used as the archive-gate check; the authoritative signals are (a) `_sqlx_migrations` table contains a row for version 33, or (b) the target tables + indexes exist with the shape specified in the next scenario. The latter is what live-verify reports should capture.

#### Scenario: Tables match drizzle shape exactly

- **WHEN** `node_summaries` is created
- **THEN** its column list and types SHALL match the drizzle definition at `schema.ts` L595: `summary_id TEXT PRIMARY KEY`, `thread_id TEXT NOT NULL REFERENCES graph_threads ON DELETE CASCADE`, `company_id TEXT NOT NULL REFERENCES companies ON DELETE CASCADE`, `node_name TEXT NOT NULL`, `employee_id TEXT`, `step_index INTEGER`, `summary_text TEXT NOT NULL`, `decisions_json TEXT NOT NULL`, `files_touched_json TEXT NOT NULL`, `tools_used_json TEXT NOT NULL`, `input_token_count INTEGER NOT NULL DEFAULT 0`, `output_token_count INTEGER NOT NULL DEFAULT 0`, `message_count INTEGER NOT NULL DEFAULT 0`, `duration_ms INTEGER NOT NULL DEFAULT 0`, `created_at TEXT NOT NULL`
- **AND** two indexes SHALL exist: `idx_node_summaries_thread_created(thread_id, created_at)` and `idx_node_summaries_thread_node(thread_id, node_name, created_at)`

- **WHEN** `compact_summaries` is created
- **THEN** its column list and types SHALL match the drizzle definition at `schema.ts` L624: `compact_id TEXT PRIMARY KEY`, `thread_id TEXT NOT NULL REFERENCES graph_threads ON DELETE CASCADE`, `company_id TEXT NOT NULL REFERENCES companies ON DELETE CASCADE`, `compact_kind TEXT NOT NULL`, `summary_source TEXT NOT NULL`, `summary_text TEXT NOT NULL`, `pre_compact_message_count INTEGER NOT NULL DEFAULT 0`, `pre_compact_token_count INTEGER NOT NULL DEFAULT 0`, `messages_compacted INTEGER NOT NULL DEFAULT 0`, `failure_streak INTEGER NOT NULL DEFAULT 0`, `created_at TEXT NOT NULL`
- **AND** two indexes SHALL exist: `idx_compact_summaries_thread_created(thread_id, created_at)` and `idx_compact_summaries_thread_kind(thread_id, compact_kind, created_at)`

#### Scenario: Middleware no longer warns about missing tables

- **WHEN** a desktop app with v33 applied runs a chat turn that exercises summarization + node-context middleware
- **THEN** the middleware `before()` hooks SHALL NOT throw SQLite "no such table" errors
- **AND** DevTools Console SHALL NOT show `Middleware "summarization" before() failed — skipping` or `Middleware "node-context" before() failed — skipping`
