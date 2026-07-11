use serde::Deserialize;
use serde_json::{Map, Value};
use sqlx::{
    query::Query,
    raw_sql,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Column, Row, Sqlite, SqlitePool, TypeInfo, ValueRef,
};
use std::{str::FromStr, time::Duration};
use tauri::{Manager, Runtime};

const LOCAL_SCHEMA_SQL: &str = include_str!("../../../../packages/db-local/src/schema.sql");

/// Schema version stamped into `PRAGMA user_version`.
///
/// Offisim is prelaunch with no historical data contract. `schema.sql` is the
/// only supported local database shape: fresh databases apply it directly and
/// are stamped with this baseline version.
///
/// Any existing local database with another version is a disposable dev artifact:
/// delete it and let the app rebuild from the current baseline.
const LOCAL_SCHEMA_VERSION: i64 = 2;

pub struct OffisimDbState {
    pool: SqlitePool,
}

pub async fn init_offisim_db_state<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    crate::local_paths::purge_legacy_app_storage(app)?;
    let db_url = offisim_db_url()?;
    let options = SqliteConnectOptions::from_str(&db_url)
        .map_err(|err| format!("parse offisim.db URL: {err}"))?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .min_connections(1)
        .max_connections(4)
        .connect_with(options)
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

#[tauri::command]
pub async fn local_db_execute<R: Runtime>(
    app: tauri::AppHandle<R>,
    sql: String,
    params: Vec<Value>,
) -> Result<u64, String> {
    let pool = get_offisim_pool(&app)?;
    execute_statement(&pool, &sql, params).await
}

#[tauri::command]
pub async fn local_db_select<R: Runtime>(
    app: tauri::AppHandle<R>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let pool = get_offisim_pool(&app)?;
    select_rows(&pool, &sql, params).await
}

async fn execute_statement(
    pool: &SqlitePool,
    sql: &str,
    params: Vec<Value>,
) -> Result<u64, String> {
    validate_statement_sql(sql)?;
    let mut query = sqlx::query(sql);
    for param in params {
        query = bind_json_param(query, param)?;
    }
    query
        .execute(pool)
        .await
        .map(|result| result.rows_affected())
        .map_err(|err| format!("execute local db statement: {err}"))
}

async fn select_rows(
    pool: &SqlitePool,
    sql: &str,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    validate_statement_sql(sql)?;
    let mut query = sqlx::query(sql);
    for param in params {
        query = bind_json_param(query, param)?;
    }
    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|err| format!("select local db rows: {err}"))?;
    rows.iter()
        .map(|row| {
            let mut values = Map::new();
            for (index, column) in row.columns().iter().enumerate() {
                values.insert(
                    column.name().to_string(),
                    sqlite_value(row, index, column.type_info().name())?,
                );
            }
            Ok(Value::Object(values))
        })
        .collect()
}

fn sqlite_value(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
    type_name: &str,
) -> Result<Value, String> {
    let raw = row
        .try_get_raw(index)
        .map_err(|err| format!("read local db column {index}: {err}"))?;
    if raw.is_null() {
        return Ok(Value::Null);
    }
    match type_name {
        "INTEGER" => row
            .try_get::<i64, _>(index)
            .map(Value::from)
            .map_err(|err| format!("decode integer column {index}: {err}")),
        "REAL" => row
            .try_get::<f64, _>(index)
            .map(Value::from)
            .map_err(|err| format!("decode real column {index}: {err}")),
        "BLOB" => row
            .try_get::<Vec<u8>, _>(index)
            .map(|bytes| Value::Array(bytes.into_iter().map(Value::from).collect()))
            .map_err(|err| format!("decode blob column {index}: {err}")),
        _ => row
            .try_get::<String, _>(index)
            .map(Value::from)
            .map_err(|err| format!("decode text column {index}: {err}")),
    }
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

fn offisim_db_url() -> Result<String, String> {
    crate::local_paths::offisim_sqlite_url()
}

async fn apply_schema(pool: &SqlitePool) -> Result<(), String> {
    ensure_schema(pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL).await
}

/// Fresh-baseline schema bootstrap:
/// - fresh database → apply the end-state baseline atomically, stamp `latest`
/// - `user_version == 0` but tables exist → refuse: an unstamped non-empty
///   database is an unrecognized local artifact, not a supported shape to adopt
/// - `user_version == latest` → no-op
/// - any other `user_version` → refuse and ask for local reset
async fn ensure_schema(pool: &SqlitePool, latest: i64, baseline_sql: &str) -> Result<(), String> {
    let version = read_user_version(pool).await?;
    if version == latest {
        return Ok(());
    }
    if version > 0 {
        return Err(format!(
            "offisim.db user_version {version} is not supported by this prelaunch build \
             (expected {latest}); delete the local database to rebuild the current baseline"
        ));
    }

    if is_empty_database(pool).await? {
        apply_sql_and_stamp(pool, baseline_sql, latest, "offisim schema bootstrap").await?;
        return Ok(());
    }
    Err(
        "offisim.db has tables but no user_version stamp; this prelaunch build only \
         supports a fresh baseline — delete the local database to rebuild"
            .to_string(),
    )
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

    #[tokio::test]
    async fn renderer_sql_boundary_rejects_non_allowlisted_statement() {
        let pool = memory_pool().await;
        raw_sql("CREATE TABLE guarded (id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        let err = execute_statement(&pool, "DROP TABLE guarded", Vec::new())
            .await
            .unwrap_err();
        assert!(err.contains("not in allowlist"), "got {err}");
        let exists: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'guarded'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(exists, 1, "rejected SQL must not execute");
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
        ensure_schema(&pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL)
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
        ensure_schema(&pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL)
            .await
            .expect("idempotent re-run");
    }

    #[tokio::test]
    async fn unstamped_database_with_tables_is_refused() {
        let pool = memory_pool().await;
        raw_sql("CREATE TABLE companies (company_id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        let err = ensure_schema(&pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL)
            .await
            .unwrap_err();
        assert!(err.contains("no user_version stamp"), "got: {err}");
    }

    #[tokio::test]
    async fn unsupported_local_database_version_is_rejected() {
        let pool = memory_pool().await;
        raw_sql("CREATE TABLE companies (company_id TEXT PRIMARY KEY); PRAGMA user_version = 12")
            .execute(&pool)
            .await
            .unwrap();
        let err = ensure_schema(&pool, LOCAL_SCHEMA_VERSION, LOCAL_SCHEMA_SQL)
            .await
            .unwrap_err();
        assert!(err.contains("not supported"), "got: {err}");
    }
}
