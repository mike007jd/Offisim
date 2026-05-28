use serde::Deserialize;
use serde_json::Value;
use sqlx::{query::Query, raw_sql, sqlite::SqlitePoolOptions, Row, Sqlite, SqlitePool};
use tauri::{Manager, Runtime};

const LOCAL_SCHEMA_SQL: &str = include_str!("../../../../packages/db-local/src/schema.sql");

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
        validate_statement_sql(&statement.sql)
            .map_err(|err| format!("statement[{idx}]: {err}"))?;
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
    apply_schema_compatibility(pool).await?;
    raw_sql(LOCAL_SCHEMA_SQL)
        .execute(pool)
        .await
        .map_err(|err| format!("apply offisim schema: {err}"))?;
    Ok(())
}

async fn apply_schema_compatibility(pool: &SqlitePool) -> Result<(), String> {
    ensure_task_runs_status_constraint(pool).await?;
    ensure_deliverables_chat_thread_id(pool).await?;
    ensure_chat_threads_employee_id(pool).await?;
    ensure_llm_call_cache_token_columns(pool).await?;

    let rows = sqlx::query("PRAGMA table_info(install_transactions)")
        .fetch_all(pool)
        .await
        .map_err(|err| format!("inspect install_transactions schema: {err}"))?;
    if rows.is_empty() {
        return Ok(());
    }

    let has_idempotency_key = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "idempotency_key")
            .unwrap_or(false)
    });
    if !has_idempotency_key {
        raw_sql("ALTER TABLE install_transactions ADD COLUMN idempotency_key TEXT")
            .execute(pool)
            .await
            .map_err(|err| format!("add install_transactions.idempotency_key: {err}"))?;
    }

    Ok(())
}

async fn ensure_chat_threads_employee_id(pool: &SqlitePool) -> Result<(), String> {
    let rows = sqlx::query("PRAGMA table_info(chat_threads)")
        .fetch_all(pool)
        .await
        .map_err(|err| format!("inspect chat_threads schema: {err}"))?;
    if rows.is_empty() {
        return Ok(());
    }
    let has_employee_id = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "employee_id")
            .unwrap_or(false)
    });
    if !has_employee_id {
        raw_sql("ALTER TABLE chat_threads ADD COLUMN employee_id TEXT")
            .execute(pool)
            .await
            .map_err(|err| format!("add chat_threads.employee_id: {err}"))?;
    }
    raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_chat_threads_project_employee
          ON chat_threads(project_id, employee_id)",
    )
    .execute(pool)
    .await
    .map_err(|err| format!("create chat_threads.project_employee index: {err}"))?;

    Ok(())
}

async fn ensure_llm_call_cache_token_columns(pool: &SqlitePool) -> Result<(), String> {
    let rows = sqlx::query("PRAGMA table_info(llm_calls)")
        .fetch_all(pool)
        .await
        .map_err(|err| format!("inspect llm_calls schema: {err}"))?;
    if rows.is_empty() {
        return Ok(());
    }
    let has_column = |name: &str| {
        rows.iter().any(|row| {
            row.try_get::<String, _>("name")
                .map(|column| column == name)
                .unwrap_or(false)
        })
    };
    if !has_column("cache_read_input_tokens") {
        raw_sql(
            "ALTER TABLE llm_calls ADD COLUMN cache_read_input_tokens INTEGER NOT NULL DEFAULT 0",
        )
        .execute(pool)
        .await
        .map_err(|err| format!("add llm_calls.cache_read_input_tokens: {err}"))?;
    }
    if !has_column("cache_creation_input_tokens") {
        raw_sql(
            "ALTER TABLE llm_calls ADD COLUMN cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0",
        )
        .execute(pool)
        .await
        .map_err(|err| format!("add llm_calls.cache_creation_input_tokens: {err}"))?;
    }
    Ok(())
}

async fn ensure_deliverables_chat_thread_id(pool: &SqlitePool) -> Result<(), String> {
    let rows = sqlx::query("PRAGMA table_info(deliverables)")
        .fetch_all(pool)
        .await
        .map_err(|err| format!("inspect deliverables schema: {err}"))?;
    if rows.is_empty() {
        return Ok(());
    }

    let has_chat_thread_id = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "chat_thread_id")
            .unwrap_or(false)
    });
    if !has_chat_thread_id {
        raw_sql("ALTER TABLE deliverables ADD COLUMN chat_thread_id TEXT")
            .execute(pool)
            .await
            .map_err(|err| format!("add deliverables.chat_thread_id: {err}"))?;
    }
    raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_deliverables_chat_thread_time
          ON deliverables(chat_thread_id, created_at DESC)",
    )
    .execute(pool)
    .await
    .map_err(|err| format!("create deliverables.chat_thread_id index: {err}"))?;

    Ok(())
}

async fn ensure_task_runs_status_constraint(pool: &SqlitePool) -> Result<(), String> {
    let row =
        sqlx::query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_runs'")
            .fetch_optional(pool)
            .await
            .map_err(|err| format!("inspect task_runs schema: {err}"))?;
    let Some(row) = row else {
        return Ok(());
    };

    let create_sql = row
        .try_get::<String, _>("sql")
        .map_err(|err| format!("read task_runs schema: {err}"))?;
    if create_sql.contains("'planned'") && create_sql.contains("'waiting_dependency'") {
        return Ok(());
    }

    let mut conn = pool
        .acquire()
        .await
        .map_err(|err| format!("acquire task_runs rebuild connection: {err}"))?;
    let foreign_keys_enabled = sqlx::query("PRAGMA foreign_keys")
        .fetch_one(&mut *conn)
        .await
        .and_then(|row| row.try_get::<i64, _>(0))
        .map(|value| value != 0)
        .map_err(|err| format!("inspect task_runs rebuild foreign key state: {err}"))?;

    raw_sql("PRAGMA foreign_keys=OFF")
        .execute(&mut *conn)
        .await
        .map_err(|err| format!("disable foreign keys for task_runs rebuild: {err}"))?;

    let rebuild_result = raw_sql(
        "
        BEGIN;
        CREATE TABLE task_runs_new (
          task_run_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
          employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
          parent_task_run_id TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
          task_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('planned', 'queued', 'running', 'waiting_dependency', 'waiting_human', 'blocked', 'completed', 'failed', 'cancelled')),
          input_json TEXT,
          output_json TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT
        );
        INSERT INTO task_runs_new (
          task_run_id,
          thread_id,
          employee_id,
          parent_task_run_id,
          task_type,
          status,
          input_json,
          output_json,
          started_at,
          finished_at
        )
        SELECT
          task_run_id,
          thread_id,
          employee_id,
          parent_task_run_id,
          task_type,
          status,
          input_json,
          output_json,
          started_at,
          finished_at
        FROM task_runs;
        DROP TABLE task_runs;
        ALTER TABLE task_runs_new RENAME TO task_runs;
        CREATE INDEX IF NOT EXISTS idx_task_runs_thread ON task_runs(thread_id);
        COMMIT;
        ",
    )
    .execute(&mut *conn)
    .await;

    if let Err(err) = rebuild_result {
        let _ = raw_sql("ROLLBACK").execute(&mut *conn).await;
        let restore_sql = if foreign_keys_enabled {
            "PRAGMA foreign_keys=ON"
        } else {
            "PRAGMA foreign_keys=OFF"
        };
        let _ = raw_sql(restore_sql).execute(&mut *conn).await;
        return Err(format!("rebuild task_runs status constraint: {err}"));
    }

    let restore_sql = if foreign_keys_enabled {
        "PRAGMA foreign_keys=ON"
    } else {
        "PRAGMA foreign_keys=OFF"
    };
    raw_sql(restore_sql)
        .execute(&mut *conn)
        .await
        .map_err(|err| format!("restore foreign keys after task_runs rebuild: {err}"))?;

    Ok(())
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

    #[tokio::test]
    async fn apply_schema_upgrades_existing_install_transactions_table() {
        let pool = SqlitePoolOptions::new()
            .min_connections(1)
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        raw_sql(
            "CREATE TABLE install_transactions (
              install_txn_id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL,
              source_type TEXT NOT NULL,
              state TEXT NOT NULL,
              actor_type TEXT NOT NULL DEFAULT 'user',
              started_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create legacy install_transactions table");

        apply_schema(&pool).await.expect("apply schema");

        let rows = sqlx::query("PRAGMA table_info(install_transactions)")
            .fetch_all(&pool)
            .await
            .expect("inspect schema");
        let has_idempotency_key = rows.iter().any(|row| {
            row.try_get::<String, _>("name")
                .map(|name| name == "idempotency_key")
                .unwrap_or(false)
        });
        assert!(has_idempotency_key);
    }

    #[tokio::test]
    async fn apply_schema_upgrades_existing_deliverables_chat_thread_scope() {
        let pool = SqlitePoolOptions::new()
            .min_connections(1)
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        raw_sql(
            "CREATE TABLE deliverables (
              deliverable_id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL,
              thread_id TEXT,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              kind TEXT,
              file_name TEXT,
              mime_type TEXT,
              contributors_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create legacy deliverables table");

        apply_schema(&pool).await.expect("apply schema");

        let rows = sqlx::query("PRAGMA table_info(deliverables)")
            .fetch_all(&pool)
            .await
            .expect("inspect schema");
        let has_chat_thread_id = rows.iter().any(|row| {
            row.try_get::<String, _>("name")
                .map(|name| name == "chat_thread_id")
                .unwrap_or(false)
        });
        assert!(has_chat_thread_id);

        let index = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_deliverables_chat_thread_time'",
        )
        .fetch_optional(&pool)
        .await
        .expect("inspect deliverables chat thread index");
        assert!(index.is_some());
    }

    #[tokio::test]
    async fn apply_schema_upgrades_legacy_task_runs_status_constraint() {
        let pool = SqlitePoolOptions::new()
            .min_connections(1)
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        raw_sql(
            "CREATE TABLE task_runs (
              task_run_id TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL,
              employee_id TEXT,
              parent_task_run_id TEXT,
              task_type TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_human', 'blocked', 'completed', 'failed', 'cancelled')),
              input_json TEXT,
              output_json TEXT,
              started_at TEXT NOT NULL,
              finished_at TEXT
            );
            INSERT INTO task_runs (
              task_run_id,
              thread_id,
              employee_id,
              parent_task_run_id,
              task_type,
              status,
              input_json,
              output_json,
              started_at,
              finished_at
            ) VALUES (
              'tr-legacy',
              'thread-legacy',
              NULL,
              NULL,
              'analysis',
              'queued',
              NULL,
              NULL,
              '2026-05-10T00:00:00Z',
              NULL
            );",
        )
        .execute(&pool)
        .await
        .expect("create legacy task_runs table");

        apply_schema(&pool).await.expect("apply schema");

        raw_sql(
            "INSERT INTO companies (
              company_id,
              name,
              status,
              workspace_root,
              description_json,
              created_at,
              updated_at
            ) VALUES (
              'company-legacy',
              'Legacy Co',
              'active',
              NULL,
              NULL,
              '2026-05-10T00:00:00Z',
              '2026-05-10T00:00:00Z'
            );
            INSERT INTO graph_threads (
              thread_id,
              company_id,
              entry_mode,
              root_task_id,
              status,
              project_id,
              created_at,
              updated_at
            ) VALUES (
              'thread-legacy',
              'company-legacy',
              'boss_chat',
              NULL,
              'running',
              NULL,
              '2026-05-10T00:00:00Z',
              '2026-05-10T00:00:00Z'
            );",
        )
        .execute(&pool)
        .await
        .expect("seed graph thread for foreign key check");

        raw_sql(
            "INSERT INTO task_runs (
              task_run_id,
              thread_id,
              employee_id,
              parent_task_run_id,
              task_type,
              status,
              input_json,
              output_json,
              started_at,
              finished_at
            ) VALUES (
              'tr-planned',
              'thread-legacy',
              NULL,
              NULL,
              'analysis',
              'planned',
              NULL,
              NULL,
              '2026-05-10T00:00:01Z',
              NULL
            );",
        )
        .execute(&pool)
        .await
        .expect("planned status should be accepted after compatibility rebuild");

        let rows = sqlx::query("SELECT task_run_id FROM task_runs ORDER BY task_run_id")
            .fetch_all(&pool)
            .await
            .expect("read task_runs");
        assert_eq!(rows.len(), 2);
    }
}
