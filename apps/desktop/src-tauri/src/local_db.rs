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

#[cfg(test)]
mod tests {
    use super::*;

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
}
