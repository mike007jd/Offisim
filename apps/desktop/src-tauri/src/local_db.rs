use sqlx::{raw_sql, sqlite::SqlitePoolOptions, SqlitePool};
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

fn offisim_db_url<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<String, String> {
    let mut db_path = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("resolve app config dir: {err}"))?;
    db_path.push("offisim.db");
    Ok(format!("sqlite:{}", db_path.to_string_lossy()))
}

async fn apply_schema(pool: &SqlitePool) -> Result<(), String> {
    raw_sql(LOCAL_SCHEMA_SQL)
        .execute(pool)
        .await
        .map_err(|err| format!("apply offisim schema: {err}"))?;
    Ok(())
}
