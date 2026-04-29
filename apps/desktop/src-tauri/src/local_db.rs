use tauri::{Manager, Runtime};

pub async fn open_offisim_pool<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<sqlx::SqlitePool, String> {
    let mut db_path = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("resolve app config dir: {err}"))?;
    db_path.push("offisim.db");
    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    sqlx::SqlitePool::connect(&db_url)
        .await
        .map_err(|err| format!("open offisim.db: {err}"))
}
