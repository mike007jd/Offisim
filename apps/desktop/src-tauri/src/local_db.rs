use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{
    query::Query,
    raw_sql,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Column, Row, Sqlite, SqlitePool, TypeInfo, ValueRef,
};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    str::FromStr,
    time::Duration,
};
use tauri::{Manager, Runtime};

const LOCAL_SCHEMA_SQL: &str = include_str!("../../../../packages/db-local/src/schema.sql");

/// Schema version stamped into `PRAGMA user_version`.
///
/// Offisim is prelaunch with no historical data contract. `schema.sql` is the
/// only supported local database shape: fresh databases apply it directly and
/// are stamped with this baseline version.
///
/// Any existing local database with another version is a disposable dev artifact.
/// Startup preserves one overwrite-only `.stale` backup, then rebuilds the
/// current baseline automatically.
const LOCAL_SCHEMA_VERSION: i64 = 17;

pub struct OffisimDbState {
    pool: SqlitePool,
}

pub async fn init_offisim_db_state<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    crate::local_paths::purge_legacy_app_storage(app)?;
    let db_path = crate::local_paths::offisim_storage_path("offisim.db")?;
    let db_url = offisim_db_url()?;
    let pool = open_offisim_database(&db_url).await?;
    let pool = apply_schema(pool, &db_path, &db_url).await?;
    app.manage(OffisimDbState { pool });
    Ok(())
}

async fn open_offisim_database(db_url: &str) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::from_str(&db_url)
        .map_err(|err| format!("parse offisim.db URL: {err}"))?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    SqlitePoolOptions::new()
        .min_connections(1)
        .max_connections(4)
        .connect_with(options)
        .await
        .map_err(|err| format!("open offisim.db: {err}"))
}

pub fn get_offisim_pool<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<SqlitePool, String> {
    app.try_state::<OffisimDbState>()
        .map(|state| state.pool.clone())
        .ok_or_else(|| "offisim db pool is not initialized".to_string())
}

#[cfg(test)]
pub(crate) fn install_test_offisim_pool<R: Runtime>(app: &tauri::AppHandle<R>, pool: SqlitePool) {
    app.manage(OffisimDbState { pool });
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchResult {
    category: String,
    entity_id: String,
    company_id: Option<String>,
    company_name: Option<String>,
    project_id: Option<String>,
    project_name: Option<String>,
    thread_id: Option<String>,
    message_id: Option<String>,
    title: String,
    snippet: String,
    path: Option<String>,
    updated_at: Option<String>,
}

/// Local-only global search. The renderer supplies text, never SQL or a path;
/// tokenization and the fixed query remain on the trusted Rust side.
#[tauri::command]
pub async fn global_search<R: Runtime>(
    app: tauri::AppHandle<R>,
    query: String,
) -> Result<Vec<GlobalSearchResult>, String> {
    let pool = get_offisim_pool(&app)?;
    search_global_index(&pool, &query).await
}

fn global_search_match_query(input: &str) -> Result<Option<String>, String> {
    if input.chars().count() > 200 {
        return Err("global search query exceeds 200 characters".to_string());
    }

    let mut tokens = Vec::new();
    let mut token = String::new();
    for ch in input.trim().chars() {
        if ch.is_alphanumeric() || ch == '_' {
            token.push(ch);
        } else if !token.is_empty() {
            tokens.push(std::mem::take(&mut token));
        }
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    if tokens.is_empty() {
        return Ok(None);
    }

    Ok(Some(
        tokens
            .into_iter()
            .take(12)
            .map(|token| format!("\"{token}\"*"))
            .collect::<Vec<_>>()
            .join(" AND "),
    ))
}

async fn search_global_index(
    pool: &SqlitePool,
    input: &str,
) -> Result<Vec<GlobalSearchResult>, String> {
    let Some(match_query) = global_search_match_query(input)? else {
        return Ok(Vec::new());
    };
    let rows = sqlx::query(
        r#"
        SELECT
          search.category,
          search.entity_id,
          NULLIF(search.company_id, '') AS company_id,
          company.name AS company_name,
          NULLIF(search.project_id, '') AS project_id,
          project.name AS project_name,
          NULLIF(search.thread_id, '') AS thread_id,
          NULLIF(search.message_id, '') AS message_id,
          COALESCE(
            NULLIF(search.title, ''),
            NULLIF(thread.title, ''),
            NULLIF(search.path, ''),
            search.entity_id
          ) AS result_title,
          CASE
            WHEN length(trim(search.content)) > 0
              THEN snippet(global_search_fts, 7, '[', ']', ' … ', 18)
            WHEN length(trim(search.path)) > 0
              THEN highlight(global_search_fts, 8, '[', ']')
            ELSE highlight(global_search_fts, 6, '[', ']')
          END AS result_snippet,
          NULLIF(search.path, '') AS result_path,
          NULLIF(search.updated_at, '') AS updated_at
        FROM global_search_fts AS search
        LEFT JOIN companies AS company ON company.company_id = search.company_id
        LEFT JOIN projects AS project ON project.project_id = search.project_id
        LEFT JOIN chat_threads AS thread ON thread.thread_id = search.thread_id
        WHERE global_search_fts MATCH ?1
        ORDER BY bm25(global_search_fts, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 5.0, 2.0, 4.0, 0.0),
                 search.updated_at DESC
        LIMIT 60
        "#,
    )
    .bind(match_query)
    .fetch_all(pool)
    .await
    .map_err(|err| format!("query global search index: {err}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(GlobalSearchResult {
                category: row
                    .try_get("category")
                    .map_err(|err| format!("decode global search category: {err}"))?,
                entity_id: row
                    .try_get("entity_id")
                    .map_err(|err| format!("decode global search entity id: {err}"))?,
                company_id: row
                    .try_get("company_id")
                    .map_err(|err| format!("decode global search company id: {err}"))?,
                company_name: row
                    .try_get("company_name")
                    .map_err(|err| format!("decode global search company name: {err}"))?,
                project_id: row
                    .try_get("project_id")
                    .map_err(|err| format!("decode global search project id: {err}"))?,
                project_name: row
                    .try_get("project_name")
                    .map_err(|err| format!("decode global search project name: {err}"))?,
                thread_id: row
                    .try_get("thread_id")
                    .map_err(|err| format!("decode global search thread id: {err}"))?,
                message_id: row
                    .try_get("message_id")
                    .map_err(|err| format!("decode global search message id: {err}"))?,
                title: row
                    .try_get("result_title")
                    .map_err(|err| format!("decode global search title: {err}"))?,
                snippet: row
                    .try_get("result_snippet")
                    .map_err(|err| format!("decode global search snippet: {err}"))?,
                path: row
                    .try_get("result_path")
                    .map_err(|err| format!("decode global search path: {err}"))?,
                updated_at: row
                    .try_get("updated_at")
                    .map_err(|err| format!("decode global search timestamp: {err}"))?,
            })
        })
        .collect()
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
                values.insert(column.name().to_string(), sqlite_value(row, index)?);
            }
            Ok(Value::Object(values))
        })
        .collect()
}

fn sqlite_value(row: &sqlx::sqlite::SqliteRow, index: usize) -> Result<Value, String> {
    let raw = row
        .try_get_raw(index)
        .map_err(|err| format!("read local db column {index}: {err}"))?;
    if raw.is_null() {
        return Ok(Value::Null);
    }
    // Decode by the runtime value type, not the column decltype: expression
    // columns (count(*), max(...), literals) have no decltype in SQLite, and
    // any column may hold any type under SQLite's dynamic typing.
    let type_name = raw.type_info().name().to_string();
    match type_name.as_str() {
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

    const BACKEND_AUTHORITY_TABLES: &[&str] = &[
        "project_workspace_authority",
        "task_workspace_binding_history",
        "task_workspace_lease_history",
        "workspace_checkpoints",
        "workspace_checkpoint_rollbacks",
    ];
    let identifiers = sql_identifier_tokens(sql)?;
    for identifier in &identifiers {
        if BACKEND_AUTHORITY_TABLES
            .iter()
            .any(|protected| identifier.eq_ignore_ascii_case(protected))
        {
            return Err(
                "rejected SQL statement: backend workspace authority tables are not available through generic local DB commands"
                    .into(),
            );
        }
    }

    // Project identity and its folder define native filesystem authority. The
    // renderer may read/delete Project catalog rows, but every INSERT/UPDATE is
    // routed through dedicated commands that consume a native-picker claim and
    // atomically maintain the protected authority record. For WITH statements,
    // reject conservatively when a mutating token and `projects` co-occur.
    let mutates = matches!(first_word.as_str(), "INSERT" | "UPDATE")
        || (first_word == "WITH"
            && identifiers.iter().any(|token| {
                token.eq_ignore_ascii_case("INSERT")
                    || token.eq_ignore_ascii_case("UPDATE")
                    || token.eq_ignore_ascii_case("REPLACE")
            }));
    if mutates
        && identifiers
            .iter()
            .any(|identifier| identifier.eq_ignore_ascii_case("projects"))
    {
        return Err(
            "rejected SQL statement: Project creation and updates require dedicated backend commands"
                .into(),
        );
    }

    // Reject embedded `;` (multi-statement). sqlx prepares single statement, but
    // some compat backends parse top-level; tightening here avoids any surprise.
    let trimmed_trailing = sql.trim_end_matches(|c: char| c.is_whitespace() || c == ';');
    if trimmed_trailing.contains(';') {
        return Err("rejected SQL statement: multi-statement payload not allowed".to_string());
    }

    Ok(())
}

/// Extract SQLite identifier-like tokens while ignoring comments. SQLite's
/// compatibility parser accepts single-quoted table names in identifier
/// positions, so decoded single-quoted values are included conservatively too.
/// This intentionally rejects a literal that is exactly a protected table name
/// rather than allowing the same bytes to bypass the authority boundary.
fn sql_identifier_tokens(sql: &str) -> Result<Vec<String>, String> {
    let bytes = sql.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            0 => return Err("rejected SQL statement: NUL byte not allowed".into()),
            b'-' if bytes.get(index + 1) == Some(&b'-') => {
                index += 2;
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index += 2;
                let mut closed = false;
                while index + 1 < bytes.len() {
                    if bytes[index] == b'*' && bytes[index + 1] == b'/' {
                        index += 2;
                        closed = true;
                        break;
                    }
                    index += 1;
                }
                if !closed {
                    return Err("rejected SQL statement: unterminated block comment".into());
                }
            }
            b'\'' => {
                index += 1;
                let mut token = Vec::new();
                let mut closed = false;
                while index < bytes.len() {
                    if bytes[index] == b'\'' {
                        if bytes.get(index + 1) == Some(&b'\'') {
                            token.push(b'\'');
                            index += 2;
                        } else {
                            index += 1;
                            closed = true;
                            break;
                        }
                    } else {
                        token.push(bytes[index]);
                        index += 1;
                    }
                }
                if !closed {
                    return Err("rejected SQL statement: unterminated string literal".into());
                }
                tokens.push(String::from_utf8_lossy(&token).into_owned());
            }
            b'"' | b'`' => {
                let delimiter = bytes[index];
                index += 1;
                let mut token = Vec::new();
                let mut closed = false;
                while index < bytes.len() {
                    if bytes[index] == delimiter {
                        if bytes.get(index + 1) == Some(&delimiter) {
                            token.push(delimiter);
                            index += 2;
                        } else {
                            index += 1;
                            closed = true;
                            break;
                        }
                    } else {
                        token.push(bytes[index]);
                        index += 1;
                    }
                }
                if !closed {
                    return Err("rejected SQL statement: unterminated quoted identifier".into());
                }
                tokens.push(String::from_utf8_lossy(&token).into_owned());
            }
            b'[' => {
                index += 1;
                let mut token = Vec::new();
                let mut closed = false;
                while index < bytes.len() {
                    if bytes[index] == b']' {
                        if bytes.get(index + 1) == Some(&b']') {
                            token.push(b']');
                            index += 2;
                        } else {
                            index += 1;
                            closed = true;
                            break;
                        }
                    } else {
                        token.push(bytes[index]);
                        index += 1;
                    }
                }
                if !closed {
                    return Err("rejected SQL statement: unterminated bracket identifier".into());
                }
                tokens.push(String::from_utf8_lossy(&token).into_owned());
            }
            byte if byte.is_ascii_alphabetic() || byte == b'_' => {
                let start = index;
                index += 1;
                while index < bytes.len()
                    && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'_' | b'$'))
                {
                    index += 1;
                }
                tokens.push(String::from_utf8_lossy(&bytes[start..index]).into_owned());
            }
            _ => index += 1,
        }
    }
    Ok(tokens)
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

async fn apply_schema(
    pool: SqlitePool,
    db_path: &Path,
    db_url: &str,
) -> Result<SqlitePool, String> {
    ensure_schema(
        pool,
        db_path,
        db_url,
        LOCAL_SCHEMA_VERSION,
        LOCAL_SCHEMA_SQL,
    )
    .await
}

/// Fresh-baseline schema bootstrap:
/// - fresh database → apply the end-state baseline atomically, stamp `latest`
/// - `user_version == latest` → no-op
/// - `user_version == 0` with tables, or any other version → move the disposable
///   database and its WAL/SHM sidecars to one overwrite-only `.stale` backup,
///   then bootstrap the current baseline
async fn ensure_schema(
    pool: SqlitePool,
    db_path: &Path,
    db_url: &str,
    latest: i64,
    baseline_sql: &str,
) -> Result<SqlitePool, String> {
    let version = read_user_version(&pool).await?;
    if version == latest {
        return Ok(pool);
    }

    if version == 0 && is_empty_database(&pool).await? {
        apply_sql_and_stamp(&pool, baseline_sql, latest, "offisim schema bootstrap").await?;
        return Ok(pool);
    }

    let reason = if version == 0 {
        "database has tables but no user_version stamp".to_string()
    } else {
        format!("database user_version is {version}, expected {latest}")
    };

    pool.close().await;
    let stale_path = replace_stale_database_backup(db_path)?;
    let fresh_pool = open_offisim_database(db_url).await?;
    apply_sql_and_stamp(
        &fresh_pool,
        baseline_sql,
        latest,
        "offisim schema bootstrap after prelaunch reset",
    )
    .await?;
    eprintln!(
        "[local_db] prelaunch reset: {reason}; moved disposable local database to {} and rebuilt baseline v{latest}",
        stale_path.display()
    );
    Ok(fresh_pool)
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn replace_stale_database_backup(db_path: &Path) -> Result<PathBuf, String> {
    let paths = [
        (db_path.to_path_buf(), path_with_suffix(db_path, ".stale")),
        (
            path_with_suffix(db_path, "-wal"),
            path_with_suffix(db_path, ".stale-wal"),
        ),
        (
            path_with_suffix(db_path, "-shm"),
            path_with_suffix(db_path, ".stale-shm"),
        ),
    ];

    for (_, backup) in &paths {
        match fs::remove_file(backup) {
            Ok(()) => {}
            Err(err) if err.kind() == ErrorKind::NotFound => {}
            Err(err) => {
                return Err(format!(
                    "replace stale offisim.db backup {}: {err}",
                    backup.display()
                ))
            }
        }
    }

    for (index, (source, backup)) in paths.iter().enumerate() {
        match fs::rename(source, backup) {
            Ok(()) => {}
            Err(err) if index > 0 && err.kind() == ErrorKind::NotFound => {}
            Err(err) => {
                return Err(format!(
                    "move stale offisim.db artifact {} to {}: {err}",
                    source.display(),
                    backup.display()
                ))
            }
        }
    }

    Ok(paths[0].1.clone())
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
    fn generic_sql_rejects_backend_workspace_authority_tables() {
        for sql in [
            "SELECT * FROM task_workspace_binding_history",
            "insert into TASK_WORKSPACE_LEASE_HISTORY (lease_id) values ('x')",
            "UPDATE \"task_workspace_binding_history\" SET status = 'active'",
            "DELETE FROM [task_workspace_lease_history]",
            "WITH forged AS (SELECT * FROM `task_workspace_binding_history`) SELECT * FROM forged",
            "WITH forged AS (SELECT 1) UPDATE /* scope */ main.task_workspace_lease_history SET status = 'active'",
            "-- leading comment\nSELECT * FROM Main.\"TASK_WORKSPACE_BINDING_HISTORY\"",
            "SELECT * FROM 'PrOjEcT_WoRkSpAcE_AuThOrItY'",
            "UPDATE 'task_workspace_binding_history' SET status = 'active'",
        ] {
            let error = validate_statement_sql(sql)
                .expect_err("generic SQL must not reach backend authority tables");
            assert!(error.contains("backend workspace authority tables"), "{sql}: {error}");
        }
    }

    #[test]
    fn authority_table_names_inside_comments_or_literals_are_not_misparsed() {
        for sql in [
            "SELECT 'task_workspace_binding_history is protected' AS harmless",
            "SELECT 1 /* task_workspace_lease_history */",
            "SELECT 1 -- task_workspace_binding_history",
        ] {
            validate_statement_sql(sql)
                .unwrap_or_else(|error| panic!("harmless token rejected for {sql:?}: {error}"));
        }
    }

    #[test]
    fn generic_sql_rejects_every_project_identity_mutation_shape() {
        for sql in [
            "INSERT INTO projects (project_id) VALUES ('forged')",
            "uPdAtE main.\"PrOjEcTs\" SET workspace_root = '/Users/u/.ssh'",
            "WITH source AS (SELECT '/Users/u/.ssh' AS root) UPDATE [projects] SET workspace_root = (SELECT root FROM source)",
            "WITH source AS (SELECT 1) RePlAcE INTO main.`PrOjEcTs` (project_id) SELECT 'forged' FROM source",
            "WITH source AS (SELECT 1) INSERT OR REPLACE INTO projects (project_id) SELECT 'forged' FROM source",
            "uPdAtE 'PrOjEcTs' SET workspace_root = '/Users/u/.ssh'",
            "WITH source AS (SELECT 1) UPDATE main.'PROJECTS' SET workspace_root = '/forged'",
        ] {
            let error = validate_statement_sql(sql)
                .expect_err("generic SQL must not mutate Project authority catalog rows");
            assert!(error.contains("dedicated backend commands"), "{sql}: {error}");
        }
        validate_statement_sql("SELECT * FROM projects").expect("Project reads remain available");
        validate_statement_sql("DELETE FROM projects WHERE project_id = 'closed'")
            .expect("Project deletion remains available for deep-delete transactions");
    }

    #[tokio::test]
    async fn rejected_with_replace_cannot_change_project_catalog() {
        let pool = memory_pool().await;
        raw_sql("CREATE TABLE projects (project_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL); INSERT INTO projects VALUES ('project-1', '/safe/project')")
            .execute(&pool)
            .await
            .unwrap();
        let error = execute_statement(
            &pool,
            "WITH forged AS (SELECT '/Users/u/.ssh' AS root) RePlAcE INTO main.\"PrOjEcTs\" (project_id, workspace_root) SELECT 'project-1', root FROM forged",
            Vec::new(),
        )
        .await
        .expect_err("WITH REPLACE must be rejected before SQLite execution");
        assert!(error.contains("dedicated backend commands"), "{error}");
        let root: String = sqlx::query_scalar(
            "SELECT workspace_root FROM projects WHERE project_id = 'project-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(root, "/safe/project");
    }

    #[tokio::test]
    async fn single_quoted_identifier_compatibility_cannot_bypass_authority_boundary() {
        let pool = memory_pool().await;
        raw_sql(
            r#"
            CREATE TABLE projects (project_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL);
            INSERT INTO projects VALUES ('project-1', '/safe/project');
            CREATE TABLE project_workspace_authority (project_id TEXT PRIMARY KEY, canonical_root TEXT NOT NULL);
            INSERT INTO project_workspace_authority VALUES ('project-1', '/safe/project');
            CREATE TABLE task_workspace_binding_history (binding_id TEXT PRIMARY KEY, status TEXT NOT NULL);
            INSERT INTO task_workspace_binding_history VALUES ('binding-1', 'active');
            CREATE TABLE task_workspace_lease_history (lease_id TEXT PRIMARY KEY, status TEXT NOT NULL);
            INSERT INTO task_workspace_lease_history VALUES ('lease-1', 'active');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        for sql in [
            "UPDATE 'PrOjEcTs' SET workspace_root = '/forged' WHERE project_id = 'project-1'",
            "UPDATE 'PROJECT_WORKSPACE_AUTHORITY' SET canonical_root = '/forged' WHERE project_id = 'project-1'",
            "DELETE FROM 'task_workspace_binding_history' WHERE binding_id = 'binding-1'",
            "UPDATE 'TaSk_WoRkSpAcE_LeAsE_HiStOrY' SET status = 'discarded' WHERE lease_id = 'lease-1'",
        ] {
            let error = execute_statement(&pool, sql, Vec::new())
                .await
                .expect_err("single-quoted authority mutation must be rejected");
            assert!(
                error.contains("dedicated backend commands")
                    || error.contains("backend workspace authority tables"),
                "{sql}: {error}"
            );
        }
        for sql in [
            "SELECT * FROM 'project_workspace_authority'",
            "SELECT * FROM 'TASK_WORKSPACE_BINDING_HISTORY'",
            "SELECT * FROM 'task_workspace_lease_history'",
        ] {
            select_rows(&pool, sql, Vec::new())
                .await
                .expect_err("single-quoted protected SELECT must be rejected");
        }

        let project_root: String = sqlx::query_scalar(
            "SELECT workspace_root FROM projects WHERE project_id = 'project-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let authority_root: String = sqlx::query_scalar(
            "SELECT canonical_root FROM project_workspace_authority WHERE project_id = 'project-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let binding_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM task_workspace_binding_history")
                .fetch_one(&pool)
                .await
                .unwrap();
        let lease_status: String = sqlx::query_scalar(
            "SELECT status FROM task_workspace_lease_history WHERE lease_id = 'lease-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(project_root, "/safe/project");
        assert_eq!(authority_root, "/safe/project");
        assert_eq!(binding_count, 1);
        assert_eq!(lease_status, "active");
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

    #[tokio::test]
    async fn select_rows_decodes_aggregate_expression_columns() {
        let pool = memory_pool().await;
        raw_sql("CREATE TABLE employees (id TEXT PRIMARY KEY, company_id TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        execute_statement(
            &pool,
            "INSERT INTO employees (id, company_id) VALUES ($1, $2)",
            vec![serde_json::json!("e1"), serde_json::json!("c1")],
        )
        .await
        .unwrap();
        let rows = select_rows(
            &pool,
            "select count(*) from \"employees\" where \"employees\".\"company_id\" = $1",
            vec![serde_json::json!("c1")],
        )
        .await
        .expect("aggregate select must decode");
        assert_eq!(rows.len(), 1);
        let row = rows[0].as_object().expect("row object");
        assert_eq!(row.values().next().and_then(Value::as_i64), Some(1));
    }

    #[tokio::test]
    async fn select_rows_preserves_projection_column_order() {
        let pool = memory_pool().await;
        raw_sql("CREATE TABLE companies (company_id TEXT PRIMARY KEY, name TEXT, created_at TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        execute_statement(
            &pool,
            "INSERT INTO companies (company_id, name, created_at) VALUES ($1, $2, $3)",
            vec![
                serde_json::json!("c1"),
                serde_json::json!("P0 Verify Co"),
                serde_json::json!("2026-07-11"),
            ],
        )
        .await
        .unwrap();
        let rows = select_rows(
            &pool,
            "SELECT name, created_at, company_id FROM companies",
            Vec::new(),
        )
        .await
        .unwrap();
        // The renderer reconstructs positional columns from key order; it must
        // follow the SELECT projection, not alphabetical ordering.
        let keys: Vec<&str> = rows[0]
            .as_object()
            .expect("row object")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["name", "created_at", "company_id"]);
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
        let pool = ensure_schema(
            pool,
            Path::new("unused-memory-database"),
            "sqlite::memory:",
            LOCAL_SCHEMA_VERSION,
            LOCAL_SCHEMA_SQL,
        )
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
        ensure_schema(
            pool,
            Path::new("unused-memory-database"),
            "sqlite::memory:",
            LOCAL_SCHEMA_VERSION,
            LOCAL_SCHEMA_SQL,
        )
        .await
        .expect("idempotent re-run");
    }

    #[test]
    fn global_search_query_is_tokenized_not_executed_as_fts_syntax() {
        assert_eq!(
            global_search_match_query("createAgentSession repo/path.ts").unwrap(),
            Some("\"createAgentSession\"* AND \"repo\"* AND \"path\"* AND \"ts\"*".into())
        );
        assert_eq!(global_search_match_query("  ---  ").unwrap(), None);
        assert!(global_search_match_query(&"x".repeat(201)).is_err());
    }

    #[tokio::test]
    async fn global_search_indexes_visible_conversations_cards_and_output_metadata() {
        let pool = memory_pool().await;
        let pool = ensure_schema(
            pool,
            Path::new("unused-memory-database"),
            "sqlite::memory:",
            LOCAL_SCHEMA_VERSION,
            LOCAL_SCHEMA_SQL,
        )
        .await
        .expect("fresh bootstrap");

        raw_sql(
            r#"
            INSERT INTO companies (
              company_id, name, status, created_at, updated_at
            ) VALUES ('company-search', 'Search Co', 'active', '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z');
            INSERT INTO projects (
              project_id, company_id, name, status, workspace_root, created_at, updated_at
            ) VALUES (
              'project-search', 'company-search', 'Search Project', 'active', '/tmp/search-project',
              '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z'
            );
            INSERT INTO chat_threads (
              thread_id, project_id, title, created_at, updated_at
            ) VALUES (
              'thread-search', 'project-search', 'Renderer indexing discussion',
              '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z'
            );
            INSERT INTO agent_events (
              event_id, project_id, thread_id, company_id, agent_name, event_type,
              payload_json, created_at
            ) VALUES (
              'event-search', 'project-search', 'thread-search', 'company-search', 'boss',
              'direct_chat.message',
              '{"message":{"id":"message-search","body":"Discuss createAgentSession ownership"}}',
              '2026-07-17T00:01:00Z'
            );
            INSERT INTO pi_messages (
              message_id, thread_id, company_id, employee_id, seq, role, message_json, created_at
            ) VALUES (
              'pi-message-search', 'thread-search', 'company-search', NULL, 0, 'assistant',
              '{"content":"Pi kernel checkpoint needle"}', '2026-07-17T00:02:00Z'
            );
            INSERT INTO agent_runs (
              run_id, thread_id, company_id, project_id, parent_run_id, root_run_id,
              employee_id, relation, work_kind, objective, access, failure_kind, status,
              usage_json, result_summary_json, session_file, runtime_context_json,
              started_at, finished_at
            ) VALUES (
              'run-search', 'thread-search', 'company-search', 'project-search', NULL,
              'run-search', NULL, NULL, 'implementation', 'Build searchable request cards',
              'write', NULL, 'completed', NULL, NULL, NULL, NULL,
              '2026-07-17T00:03:00Z', '2026-07-17T00:04:00Z'
            );
            INSERT INTO deliverables (
              deliverable_id, company_id, thread_id, chat_thread_id, title, content, kind,
              file_name, mime_type, contributors_json, created_at
            ) VALUES (
              'deliverable-search', 'company-search', 'thread-search', 'thread-search',
              'Search evidence manifest', 'hiddenDiffNeedle must not be indexed', 'document',
              'reports/global-search-manifest.md', 'text/markdown', '[]',
              '2026-07-17T00:05:00Z'
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("seed searchable rows");

        let conversations = search_global_index(&pool, "createAgentSession")
            .await
            .expect("search conversation");
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0].category, "conversation");
        assert_eq!(
            conversations[0].message_id.as_deref(),
            Some("message-search")
        );

        let pi_messages = search_global_index(&pool, "checkpoint needle")
            .await
            .expect("search Pi transcript");
        assert_eq!(pi_messages.len(), 1);
        assert_eq!(
            pi_messages[0].message_id.as_deref(),
            Some("pi-message-search")
        );

        let cards = search_global_index(&pool, "searchable request")
            .await
            .expect("search request card");
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].category, "card");
        assert_eq!(cards[0].entity_id, "run-search");

        let outputs = search_global_index(&pool, "global search manifest")
            .await
            .expect("search output metadata");
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].category, "output");
        assert_eq!(outputs[0].entity_id, "deliverable-search");
        assert_eq!(
            outputs[0].path.as_deref(),
            Some("reports/global-search-manifest.md")
        );
        assert!(
            search_global_index(&pool, "hiddenDiffNeedle")
                .await
                .expect("search excluded output body")
                .is_empty(),
            "deliverable bodies and full diffs must stay out of the first-version index"
        );

        sqlx::query(
            "UPDATE agent_events SET payload_json = ?1, created_at = ?2 WHERE event_id = ?3",
        )
        .bind("{\"message\":{\"id\":\"message-search\",\"body\":\"UpdatedMessageNeedle\"}}")
        .bind("2026-07-17T00:06:00Z")
        .bind("event-search")
        .execute(&pool)
        .await
        .expect("update conversation projection");
        assert!(search_global_index(&pool, "createAgentSession")
            .await
            .expect("search removed text")
            .is_empty());
        assert_eq!(
            search_global_index(&pool, "UpdatedMessageNeedle")
                .await
                .expect("search updated text")
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn unstamped_database_with_tables_is_reset() {
        let fixture = file_database_fixture("unstamped-reset");
        let db_url = sqlite_url(&fixture.db_path);
        let pool = open_offisim_database(&db_url).await.unwrap();
        raw_sql("CREATE TABLE legacy_only (id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        let pool = ensure_schema(
            pool,
            &fixture.db_path,
            &db_url,
            LOCAL_SCHEMA_VERSION,
            LOCAL_SCHEMA_SQL,
        )
        .await
        .expect("reset unstamped database");

        assert_current_baseline(&pool).await;
        assert!(!table_exists(&pool, "legacy_only").await);
        let backup = path_with_suffix(&fixture.db_path, ".stale");
        assert!(backup.is_file(), "stale database backup should exist");
        let backup_pool = open_read_only_database(&backup).await;
        assert_eq!(read_user_version(&backup_pool).await.unwrap(), 0);
        assert!(table_exists(&backup_pool, "legacy_only").await);
    }

    #[tokio::test]
    async fn unsupported_local_database_version_is_reset() {
        let fixture = file_database_fixture("version-reset");
        let db_url = sqlite_url(&fixture.db_path);
        let pool = open_offisim_database(&db_url).await.unwrap();
        let unsupported = 6;
        raw_sql(&format!(
            "CREATE TABLE legacy_only (id TEXT PRIMARY KEY); PRAGMA user_version = {unsupported}"
        ))
        .execute(&pool)
        .await
        .unwrap();
        let pool = ensure_schema(
            pool,
            &fixture.db_path,
            &db_url,
            LOCAL_SCHEMA_VERSION,
            LOCAL_SCHEMA_SQL,
        )
        .await
        .expect("reset old-version database");

        assert_current_baseline(&pool).await;
        assert!(!table_exists(&pool, "legacy_only").await);
        let backup = path_with_suffix(&fixture.db_path, ".stale");
        assert!(backup.is_file(), "stale database backup should exist");
        let backup_pool = open_read_only_database(&backup).await;
        assert_eq!(read_user_version(&backup_pool).await.unwrap(), unsupported);
        assert!(table_exists(&backup_pool, "legacy_only").await);
    }

    struct FileDatabaseFixture {
        root: PathBuf,
        db_path: PathBuf,
    }

    impl Drop for FileDatabaseFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn file_database_fixture(label: &str) -> FileDatabaseFixture {
        let root = std::env::temp_dir().join(format!(
            "offisim-local-db-{label}-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(&root).expect("create local db fixture directory");
        FileDatabaseFixture {
            db_path: root.join("offisim.db"),
            root,
        }
    }

    fn sqlite_url(path: &Path) -> String {
        format!("sqlite://{}?mode=rwc", path.to_string_lossy())
    }

    async fn open_read_only_database(path: &Path) -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&format!("sqlite://{}?mode=ro", path.to_string_lossy()))
            .await
            .expect("open stale database backup")
    }

    async fn table_exists(pool: &SqlitePool, table: &str) -> bool {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(pool)
        .await
        .unwrap()
            == 1
    }

    async fn assert_current_baseline(pool: &SqlitePool) {
        assert_eq!(read_user_version(pool).await.unwrap(), LOCAL_SCHEMA_VERSION);
        assert!(table_exists(pool, "companies").await);
    }
}
