use serde::Deserialize;
use serde_json::Value;
use sqlx::{query::Query, raw_sql, sqlite::SqlitePoolOptions, Sqlite, SqlitePool};
use tauri::{Manager, Runtime};

const LOCAL_SCHEMA_SQL: &str = include_str!("../../../../packages/db-local/src/schema.sql");

/// Schema version stamped into `PRAGMA user_version`.
///
/// Offisim has not had a public release, so the local SQLite shape is a single
/// flattened public baseline (version 1) — there is no prelaunch upgrade history
/// to preserve. `schema.sql` always describes the LATEST end-state shape: fresh
/// databases apply it directly and are stamped with this version.
///
/// The FIRST post-launch schema change must (a) update `schema.sql` + `schema.ts`,
/// (b) bump this constant by 1, and (c) add a matching upgrade entry to
/// `MIGRATIONS` so released user databases have an upgrade path. Public migration
/// history starts only after the first public release baseline.
const LOCAL_SCHEMA_VERSION: i64 = 7;

/// Ordered upgrade chain for existing user databases: `(target_version, sql)`
/// where each entry upgrades `target_version - 1` → `target_version`. Each entry
/// runs in its own transaction together with the version stamp. SQL files live in
/// `packages/db-local/src/migrations/` (see the README there).
///
/// The v1 baseline ships whole in `schema.sql`. Each entry upgrades an existing
/// user database from `target_version - 1` to `target_version`.
const MIGRATIONS: &[(i64, &str)] = &[
    (
        2,
        include_str!("../../../../packages/db-local/src/migrations/0002_artifact_provenance.sql"),
    ),
    (
        3,
        include_str!("../../../../packages/db-local/src/migrations/0003_mission_core.sql"),
    ),
    (
        4,
        include_str!("../../../../packages/db-local/src/migrations/0004_collaboration.sql"),
    ),
    (
        5,
        include_str!("../../../../packages/db-local/src/migrations/0005_loop_core.sql"),
    ),
    (
        6,
        include_str!("../../../../packages/db-local/src/migrations/0006_collaboration_turns.sql"),
    ),
    (
        7,
        include_str!("../../../../packages/db-local/src/migrations/0007_agent_run_interrupted.sql"),
    ),
];

pub struct OffisimDbState {
    pool: SqlitePool,
}

pub async fn init_offisim_db_state<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let db_url = offisim_db_url(app)?;
    let pool = SqlitePoolOptions::new()
        .min_connections(1)
        .max_connections(4)
        .connect(&db_url)
        .await
        .map_err(|err| format!("open offisim.db: {err}"))?;
    apply_schema(&pool).await?;
    app.manage(OffisimDbState { pool });
    Ok(())
}

pub fn get_offisim_pool<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<SqlitePool, String> {
    app.try_state::<OffisimDbState>()
        .map(|state| state.pool.clone())
        .ok_or_else(|| "offisim db pool is not initialized".to_string())
}

#[derive(Debug, Deserialize)]
pub struct LocalDbTransactionStatement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

#[tauri::command]
pub async fn local_db_execute_transaction<R: Runtime>(
    app: tauri::AppHandle<R>,
    statements: Vec<LocalDbTransactionStatement>,
) -> Result<(), String> {
    if statements.is_empty() {
        return Ok(());
    }
    for (idx, statement) in statements.iter().enumerate() {
        validate_statement_sql(&statement.sql).map_err(|err| format!("statement[{idx}]: {err}"))?;
    }
    let pool = get_offisim_pool(&app)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|err| format!("begin local db transaction: {err}"))?;

    for statement in statements {
        let mut query = sqlx::query(&statement.sql);
        for param in statement.params {
            query = bind_json_param(query, param)?;
        }
        query
            .execute(&mut *tx)
            .await
            .map_err(|err| format!("execute local db transaction statement: {err}"))?;
    }

    tx.commit()
        .await
        .map_err(|err| format!("commit local db transaction: {err}"))?;
    Ok(())
}

// Renderer-facing SQL allowlist. Even though Drizzle generates only DML, this
// IPC entry would otherwise accept any string from the webview (XSS / second
// window / deep-link). Defence-in-depth: lexical keyword prefix + reject
// embedded `;` to block multi-statement payloads.
fn validate_statement_sql(sql: &str) -> Result<(), String> {
    let stripped = strip_leading_comments_and_whitespace(sql);
    if stripped.is_empty() {
        return Err("empty SQL statement".to_string());
    }

    let first_word: String = stripped
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .flat_map(|c| c.to_uppercase())
        .collect();

    const ALLOWED: &[&str] = &["INSERT", "UPDATE", "DELETE", "SELECT", "WITH"];
    if !ALLOWED.contains(&first_word.as_str()) {
        return Err(format!(
            "rejected SQL statement: leading keyword `{first_word}` not in allowlist \
             (INSERT|UPDATE|DELETE|SELECT|WITH)"
        ));
    }

    // Reject embedded `;` (multi-statement). sqlx prepares single statement, but
    // some compat backends parse top-level; tightening here avoids any surprise.
    let trimmed_trailing = sql.trim_end_matches(|c: char| c.is_whitespace() || c == ';');
    if trimmed_trailing.contains(';') {
        return Err("rejected SQL statement: multi-statement payload not allowed".to_string());
    }

    Ok(())
}

fn strip_leading_comments_and_whitespace(sql: &str) -> &str {
    let mut s = sql.trim_start();
    loop {
        if let Some(rest) = s.strip_prefix("--") {
            match rest.find('\n') {
                Some(nl) => s = rest[nl + 1..].trim_start(),
                None => return "",
            }
        } else if let Some(rest) = s.strip_prefix("/*") {
            match rest.find("*/") {
                Some(end) => s = rest[end + 2..].trim_start(),
                None => return "",
            }
        } else {
            return s;
        }
    }
}

fn bind_json_param<'q>(
    query: Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: Value,
) -> Result<Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>, String> {
    match value {
        Value::Null => Ok(query.bind(Option::<String>::None)),
        Value::Bool(value) => Ok(query.bind(if value { 1_i64 } else { 0_i64 })),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Ok(query.bind(value))
            } else if let Some(value) = value.as_f64() {
                Ok(query.bind(value))
            } else {
                Err("unsupported local db numeric parameter".to_string())
            }
        }
        Value::String(value) => Ok(query.bind(value)),
        Value::Array(_) | Value::Object(_) => Ok(query.bind(value.to_string())),
    }
}

fn offisim_db_url<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<String, String> {
    let mut db_path = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("resolve app config dir: {err}"))?;
    db_path.push("offisim.db");
    Ok(format!("sqlite:{}", db_path.to_string_lossy()))
}

async fn apply_schema(pool: &SqlitePool) -> Result<(), String> {
    ensure_schema(pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS).await
}

/// Versioned schema bootstrap:
/// - fresh database → apply the end-state baseline atomically, stamp `latest`
/// - `user_version == 0` but tables exist → refuse: prelaunch ships a single
///   flattened baseline, so an unstamped non-empty database is an unrecognized
///   local dev artifact (delete and rebuild), not a pre-public shape to adopt
/// - `user_version` in range → run pending migrations sequentially
/// - `user_version > latest` → refuse to open (downgraded app on newer data)
async fn ensure_schema(
    pool: &SqlitePool,
    latest: i64,
    baseline_sql: &str,
    migrations: &[(i64, &str)],
) -> Result<(), String> {
    let mut version = read_user_version(pool).await?;
    if version > latest {
        return Err(format!(
            "offisim.db user_version {version} is newer than this build supports ({latest}); \
             refusing to open a newer database with an older app"
        ));
    }

    if version == 0 {
        if is_empty_database(pool).await? {
            apply_sql_and_stamp(pool, baseline_sql, latest, "offisim schema bootstrap").await?;
            return Ok(());
        }
        // Prelaunch single-baseline: there is no pre-public SQLite shape to adopt.
        // A non-empty database with no user_version stamp is an unrecognized local
        // dev artifact — refuse rather than silently claim it matches the v1
        // baseline (it may predate tables that now ship in the baseline). Deleting
        // the local database rebuilds it cleanly.
        return Err(
            "offisim.db has tables but no user_version stamp; this build only \
             supports a fresh baseline — delete the local database to rebuild"
                .to_string(),
        );
    }

    for (target, sql) in migrations {
        if *target <= version {
            continue;
        }
        if *target != version + 1 {
            return Err(format!(
                "offisim.db migration chain has a gap: at version {version}, next entry targets {target}"
            ));
        }
        apply_sql_and_stamp(pool, sql, *target, &format!("offisim migration {target}")).await?;
        version = *target;
    }

    if version != latest {
        return Err(format!(
            "offisim.db migration chain is incomplete: reached version {version}, expected {latest}"
        ));
    }
    Ok(())
}

/// Run `sql` and stamp `PRAGMA user_version = version` in one transaction.
async fn apply_sql_and_stamp(
    pool: &SqlitePool,
    sql: &str,
    version: i64,
    context: &str,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|err| format!("begin {context}: {err}"))?;
    raw_sql(sql)
        .execute(&mut *tx)
        .await
        .map_err(|err| format!("apply {context}: {err}"))?;
    raw_sql(&format!("PRAGMA user_version = {version}"))
        .execute(&mut *tx)
        .await
        .map_err(|err| format!("stamp {context}: {err}"))?;
    tx.commit()
        .await
        .map_err(|err| format!("commit {context}: {err}"))?;
    Ok(())
}

async fn read_user_version(pool: &SqlitePool) -> Result<i64, String> {
    sqlx::query_scalar::<_, i64>("PRAGMA user_version")
        .fetch_one(pool)
        .await
        .map_err(|err| format!("read offisim.db user_version: {err}"))
}

async fn is_empty_database(pool: &SqlitePool) -> Result<bool, String> {
    let tables: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_one(pool)
    .await
    .map_err(|err| format!("inspect offisim.db tables: {err}"))?;
    Ok(tables == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_statement_sql_accepts_dml() {
        for sql in [
            "INSERT INTO companies (company_id) VALUES ('x')",
            "  UPDATE memories SET importance = $1 WHERE id = $2",
            "DELETE FROM llm_calls WHERE finished_at < $1",
            "SELECT * FROM employees",
            "WITH recent AS (SELECT * FROM chat_threads ORDER BY updated_at DESC LIMIT 50) \
             INSERT INTO archive SELECT * FROM recent",
            "insert into x values (1)",
            "-- guard\nUPDATE x SET y = 1",
            "/* block */\nDELETE FROM x",
        ] {
            validate_statement_sql(sql)
                .unwrap_or_else(|err| panic!("expected accept for {sql:?}: {err}"));
        }
    }

    #[test]
    fn validate_statement_sql_rejects_ddl_and_pragma() {
        for (sql, label) in [
            ("DROP TABLE companies", "DROP"),
            ("CREATE TABLE evil (id TEXT)", "CREATE"),
            ("ALTER TABLE x ADD COLUMN y TEXT", "ALTER"),
            ("ATTACH DATABASE '/etc/passwd' AS pw", "ATTACH"),
            ("PRAGMA writable_schema = ON", "PRAGMA"),
            ("REINDEX companies", "REINDEX"),
            ("VACUUM", "VACUUM"),
            ("drop table companies", "lowercase DROP"),
            ("  attach DATABASE 'x'", "leading-space ATTACH"),
            ("-- innocent\nDROP TABLE x", "comment-prefix DROP"),
            ("/* hi */ CREATE TABLE x (id TEXT)", "block-comment CREATE"),
            ("", "empty"),
            ("   ", "whitespace only"),
        ] {
            let err = validate_statement_sql(sql).unwrap_err();
            assert!(
                err.contains("rejected") || err.contains("empty"),
                "expected reject for {label} but got: {err}"
            );
        }
    }

    #[test]
    fn validate_statement_sql_rejects_multi_statement() {
        let err = validate_statement_sql("INSERT INTO x VALUES (1); DROP TABLE x").unwrap_err();
        assert!(err.contains("multi-statement"), "got {err}");
    }

    #[test]
    fn validate_statement_sql_allows_trailing_semicolon() {
        // Trailing `;` (with whitespace) should not be treated as multi-statement.
        validate_statement_sql("INSERT INTO x VALUES (1);").expect("trailing `;` should be ok");
        validate_statement_sql("INSERT INTO x VALUES (1) ;  \n")
            .expect("trailing `;` + whitespace should be ok");
    }

    // max_connections(1): each new connection to `sqlite::memory:` is a
    // separate database, so the pool must reuse a single connection.
    async fn memory_pool() -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite")
    }

    #[tokio::test]
    async fn fresh_database_bootstraps_baseline_and_stamps_latest_version() {
        let pool = memory_pool().await;
        ensure_schema(&pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .expect("fresh bootstrap");
        assert_eq!(
            read_user_version(&pool).await.unwrap(),
            LOCAL_SCHEMA_VERSION
        );
        let companies: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE name = 'companies'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(companies, 1, "baseline schema should create companies");
        // Re-running on an up-to-date database is a no-op.
        ensure_schema(&pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .expect("idempotent re-run");
    }

    /// Snapshot of the schema objects (tables + indexes) a database ends up with.
    /// Used to prove that the migration chain reaches the SAME end-state as a fresh
    /// `schema.sql` bootstrap — the 3-step ritual's "same end-state" invariant.
    async fn schema_object_signature(pool: &SqlitePool) -> Vec<(String, String)> {
        sqlx::query_as::<_, (String, String)>(
            "SELECT type, name FROM sqlite_master \
             WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' \
             ORDER BY type, name",
        )
        .fetch_all(pool)
        .await
        .expect("read sqlite_master signature")
    }

    #[tokio::test]
    async fn migration_0005_reaches_same_end_state_as_fresh_bootstrap() {
        // Fresh bootstrap from schema.sql → end-state signature at v5 (the latest).
        let fresh = memory_pool().await;
        ensure_schema(&fresh, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .expect("fresh bootstrap to v5");
        assert_eq!(
            read_user_version(&fresh).await.unwrap(),
            LOCAL_SCHEMA_VERSION
        );
        let fresh_sig = schema_object_signature(&fresh).await;

        // What this test PROVES (honest scope): the 0005 migration applied to a
        // v4-shaped database (the current schema minus exactly the loop objects)
        // reaches the same end-state as a fresh v5 bootstrap. 0005_loop_core is
        // additive-only (CREATE TABLE/INDEX IF NOT EXISTS on brand-new loop tables),
        // so it cannot collide with 0002–0004 — running it on top of the prior
        // shape is the entire risk surface this PR owns, and that is what we check.
        //
        // What it does NOT do: replay the FULL historical chain from a v1 baseline.
        // schema.sql is the flattened latest end-state; the old per-version baselines
        // are not preserved, and the historical ALTER-based migrations (e.g. 0002's
        // `ADD COLUMN run_id`) collide when replayed against the v5 end-state shape.
        // A true v1→0002→0003→0004→0005 replay is therefore infeasible here and is
        // intentionally not attempted.
        //
        // We construct the v4-shaped database by applying the end-state baseline,
        // DROPping exactly the objects 0005 introduces, and stamping v4. Then the
        // chain runs — only 0005_loop_core applies — and the result must be
        // byte-identical to a fresh v5 bootstrap.
        let migrated = memory_pool().await;
        apply_sql_and_stamp(&migrated, LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION, "seed v5 baseline")
            .await
            .expect("seed v5 baseline");
        let drop_loop_objects = "\
            DROP TABLE IF EXISTS loop_invocations;\n\
            DROP TABLE IF EXISTS loop_skill_bindings;\n\
            DROP TABLE IF EXISTS loop_revisions;\n\
            DROP TABLE IF EXISTS loop_definitions;";
        apply_sql_and_stamp(&migrated, drop_loop_objects, 4, "rewind to v4 (drop loop objects)")
            .await
            .expect("rewind to v4");
        assert_eq!(read_user_version(&migrated).await.unwrap(), 4);
        // Sanity: the loop tables are gone at v4.
        let v4_sig = schema_object_signature(&migrated).await;
        assert!(
            !v4_sig.iter().any(|(_, name)| name == "loop_definitions"),
            "loop tables must be absent at v4"
        );

        ensure_schema(&migrated, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .expect("upgrade v4 → v5 via 0005_loop_core");
        assert_eq!(
            read_user_version(&migrated).await.unwrap(),
            LOCAL_SCHEMA_VERSION
        );
        let migrated_sig = schema_object_signature(&migrated).await;

        assert_eq!(
            fresh_sig, migrated_sig,
            "0005 migration end-state must match fresh schema.sql bootstrap (loop tables incl.)"
        );
        // Spot-check the loop tables specifically landed in both paths.
        for name in [
            "loop_definitions",
            "loop_revisions",
            "loop_skill_bindings",
            "loop_invocations",
        ] {
            assert!(
                migrated_sig.contains(&("table".to_string(), name.to_string())),
                "v4→v5 migration missing {name}"
            );
            assert!(
                fresh_sig.contains(&("table".to_string(), name.to_string())),
                "fresh bootstrap missing {name}"
            );
        }
    }

    #[tokio::test]
    async fn migration_0006_reaches_same_end_state_as_fresh_bootstrap() {
        // Fresh bootstrap from schema.sql → end-state signature at v6 (the latest).
        let fresh = memory_pool().await;
        ensure_schema(&fresh, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .expect("fresh bootstrap to v6");
        assert_eq!(
            read_user_version(&fresh).await.unwrap(),
            LOCAL_SCHEMA_VERSION
        );
        let fresh_sig = schema_object_signature(&fresh).await;

        // Same honest scope as the 0005 test: 0006_collaboration_turns is
        // additive-only (one new table + one new index, CREATE ... IF NOT EXISTS),
        // so we construct the v5-shaped database by seeding the end-state baseline,
        // DROPping exactly the objects 0006 introduces, stamping v5, then running
        // the chain — only 0006 applies — and asserting byte-identical end-state.
        let migrated = memory_pool().await;
        apply_sql_and_stamp(&migrated, LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION, "seed v6 baseline")
            .await
            .expect("seed v6 baseline");
        let drop_turns_objects = "DROP TABLE IF EXISTS collaboration_turns;";
        apply_sql_and_stamp(&migrated, drop_turns_objects, 5, "rewind to v5 (drop turns objects)")
            .await
            .expect("rewind to v5");
        assert_eq!(read_user_version(&migrated).await.unwrap(), 5);
        let v5_sig = schema_object_signature(&migrated).await;
        assert!(
            !v5_sig.iter().any(|(_, name)| name == "collaboration_turns"),
            "collaboration_turns must be absent at v5"
        );

        ensure_schema(&migrated, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .expect("upgrade v5 → v6 via 0006_collaboration_turns");
        assert_eq!(
            read_user_version(&migrated).await.unwrap(),
            LOCAL_SCHEMA_VERSION
        );
        let migrated_sig = schema_object_signature(&migrated).await;

        assert_eq!(
            fresh_sig, migrated_sig,
            "0006 migration end-state must match fresh schema.sql bootstrap (collaboration_turns incl.)"
        );
        assert!(
            migrated_sig.contains(&("table".to_string(), "collaboration_turns".to_string())),
            "v5→v6 migration missing collaboration_turns"
        );
        assert!(
            fresh_sig.contains(&("table".to_string(), "collaboration_turns".to_string())),
            "fresh bootstrap missing collaboration_turns"
        );
    }

    #[tokio::test]
    async fn migration_0007_rebuilds_agent_runs_with_interrupted_and_session_file() {
        // Fresh bootstrap from schema.sql → end-state signature at v7 (the latest).
        let fresh = memory_pool().await;
        ensure_schema(&fresh, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .expect("fresh bootstrap to v7");
        assert_eq!(
            read_user_version(&fresh).await.unwrap(),
            LOCAL_SCHEMA_VERSION
        );
        let fresh_sig = schema_object_signature(&fresh).await;

        // 0007 is a CHECK-constraint change (adds `interrupted`) + a new
        // `session_file` column — a full table REBUILD, not an additive ALTER.
        // Construct a v6-shaped database: seed the end-state baseline, then DROP and
        // recreate `agent_runs` in its v6 shape (old CHECK, no `session_file`), seed
        // a company + a root run + a child run that self-references the root (the
        // self-FK the rebuild must carry through), and stamp v6.
        let migrated = memory_pool().await;
        apply_sql_and_stamp(&migrated, LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION, "seed v7 baseline")
            .await
            .expect("seed v7 baseline");
        let rewind_to_v6 = "\
            PRAGMA defer_foreign_keys = ON;\n\
            DROP TABLE agent_runs;\n\
            CREATE TABLE agent_runs (\n\
              run_id              TEXT PRIMARY KEY,\n\
              thread_id           TEXT NOT NULL,\n\
              company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,\n\
              parent_run_id       TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,\n\
              root_run_id         TEXT NOT NULL,\n\
              employee_id         TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,\n\
              relation            TEXT,\n\
              objective           TEXT,\n\
              access              TEXT,\n\
              status              TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),\n\
              usage_json          TEXT,\n\
              result_summary_json TEXT,\n\
              started_at          TEXT NOT NULL,\n\
              finished_at         TEXT\n\
            );\n\
            CREATE INDEX idx_agent_runs_thread ON agent_runs(thread_id);\n\
            CREATE INDEX idx_agent_runs_root ON agent_runs(root_run_id);\n\
            CREATE INDEX idx_agent_runs_parent ON agent_runs(parent_run_id);\n\
            INSERT INTO companies (company_id, name, status, created_at, updated_at)\n\
              VALUES ('co1', 'Co', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');\n\
            INSERT INTO agent_runs (run_id, thread_id, company_id, root_run_id, status, started_at)\n\
              VALUES ('root1', 't1', 'co1', 'root1', 'running', '2026-01-01T00:00:00Z');\n\
            INSERT INTO agent_runs (run_id, thread_id, company_id, parent_run_id, root_run_id, status, started_at)\n\
              VALUES ('child1', 't1', 'co1', 'root1', 'root1', 'completed', '2026-01-02T00:00:00Z');";
        apply_sql_and_stamp(&migrated, rewind_to_v6, 6, "rewind agent_runs to v6 shape")
            .await
            .expect("rewind to v6");
        assert_eq!(read_user_version(&migrated).await.unwrap(), 6);

        // Run the chain — only 0007 applies — rebuilding agent_runs.
        ensure_schema(&migrated, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .expect("upgrade v6 → v7 via 0007_agent_run_interrupted");
        assert_eq!(
            read_user_version(&migrated).await.unwrap(),
            LOCAL_SCHEMA_VERSION
        );

        // End-state object signature matches a fresh bootstrap.
        let migrated_sig = schema_object_signature(&migrated).await;
        assert_eq!(
            fresh_sig, migrated_sig,
            "0007 migration end-state must match fresh schema.sql bootstrap"
        );

        // Both rows survived the rebuild, including the self-referencing child.
        let run_count: i64 = sqlx::query_scalar("SELECT count(*) FROM agent_runs")
            .fetch_one(&migrated)
            .await
            .unwrap();
        assert_eq!(run_count, 2, "both runs must survive the rebuild");
        let child_parent: Option<String> =
            sqlx::query_scalar("SELECT parent_run_id FROM agent_runs WHERE run_id = 'child1'")
                .fetch_one(&migrated)
                .await
                .unwrap();
        assert_eq!(
            child_parent.as_deref(),
            Some("root1"),
            "self-referential parent_run_id must be preserved across the rebuild"
        );

        // `session_file` is a NEW column, NULL for migrated rows.
        let session_file: Option<String> =
            sqlx::query_scalar("SELECT session_file FROM agent_runs WHERE run_id = 'root1'")
                .fetch_one(&migrated)
                .await
                .unwrap();
        assert_eq!(session_file, None, "session_file must exist and default NULL");

        // `interrupted` is now an accepted status (the whole point of the rebuild).
        sqlx::query("UPDATE agent_runs SET status = 'interrupted' WHERE run_id = 'root1'")
            .execute(&migrated)
            .await
            .expect("interrupted must now be an accepted status after 0007");
        let root_status: String =
            sqlx::query_scalar("SELECT status FROM agent_runs WHERE run_id = 'root1'")
                .fetch_one(&migrated)
                .await
                .unwrap();
        assert_eq!(root_status, "interrupted");
    }

    #[tokio::test]
    async fn unstamped_database_with_tables_is_refused() {
        let pool = memory_pool().await;
        // Prelaunch ships a single flattened baseline: a non-empty database with no
        // user_version stamp is an unrecognized local dev artifact, not a
        // pre-public shape to adopt. Refuse rather than claim it is a clean v1.
        raw_sql("CREATE TABLE companies (company_id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        let err = ensure_schema(&pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .unwrap_err();
        assert!(err.contains("no user_version stamp"), "got: {err}");
    }

    #[tokio::test]
    async fn migration_chain_gap_is_rejected() {
        let pool = memory_pool().await;
        raw_sql("CREATE TABLE companies (company_id TEXT PRIMARY KEY); PRAGMA user_version = 1")
            .execute(&pool)
            .await
            .unwrap();
        let err = ensure_schema(&pool, 3, "", &[(3, "SELECT 1")])
            .await
            .unwrap_err();
        assert!(err.contains("gap"), "got: {err}");
    }

    #[tokio::test]
    async fn incomplete_migration_chain_is_rejected() {
        let pool = memory_pool().await;
        raw_sql("CREATE TABLE companies (company_id TEXT PRIMARY KEY); PRAGMA user_version = 1")
            .execute(&pool)
            .await
            .unwrap();
        let err = ensure_schema(&pool, 2, "", &[]).await.unwrap_err();
        assert!(err.contains("incomplete"), "got: {err}");
    }

    #[tokio::test]
    async fn newer_database_is_refused_by_older_app() {
        let pool = memory_pool().await;
        raw_sql("PRAGMA user_version = 99")
            .execute(&pool)
            .await
            .unwrap();
        let err = ensure_schema(&pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL, MIGRATIONS)
            .await
            .unwrap_err();
        assert!(err.contains("newer"), "got: {err}");
    }
}
