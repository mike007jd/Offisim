use serde::Serialize;
use sqlx::Row;
use tauri::Runtime;

use crate::local_db::open_offisim_pool;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    id: String,
    mode: String,
    status: String,
    topic: String,
    updated_at: String,
}

fn validate_mode(mode: &str) -> Result<(), String> {
    match mode {
        "boss_proxy" | "human_in_loop" | "direct_to_employee" | "yolo" => Ok(()),
        _ => Err(format!("invalid interaction mode: {mode}")),
    }
}

fn decode_session(row: sqlx::sqlite::SqliteRow) -> Result<SessionSnapshot, String> {
    Ok(SessionSnapshot {
        id: row
            .try_get("meeting_id")
            .map_err(|err| format!("decode meeting_id: {err}"))?,
        mode: row
            .try_get("interaction_mode")
            .map_err(|err| format!("decode interaction_mode: {err}"))?,
        status: row
            .try_get("status")
            .map_err(|err| format!("decode status: {err}"))?,
        topic: row
            .try_get("topic")
            .map_err(|err| format!("decode topic: {err}"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| format!("decode updated_at: {err}"))?,
    })
}

#[tauri::command]
pub async fn get_session<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<Option<SessionSnapshot>, String> {
    let pool = open_offisim_pool(&app).await?;
    let row = sqlx::query(
        r#"
        SELECT meeting_id, interaction_mode, status, topic, updated_at
        FROM meeting_sessions
        WHERE meeting_id = ?
        LIMIT 1
        "#,
    )
    .bind(&id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| format!("select session: {err}"))?;
    pool.close().await;

    row.map(decode_session).transpose()
}

#[tauri::command]
pub async fn set_session_mode<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    mode: String,
) -> Result<Option<SessionSnapshot>, String> {
    validate_mode(&mode)?;
    let pool = open_offisim_pool(&app).await?;
    sqlx::query(
        r#"
        UPDATE meeting_sessions
        SET interaction_mode = ?, updated_at = datetime('now')
        WHERE meeting_id = ?
        "#,
    )
    .bind(&mode)
    .bind(&id)
    .execute(&pool)
    .await
    .map_err(|err| format!("update session mode: {err}"))?;

    let row = sqlx::query(
        r#"
        SELECT meeting_id, interaction_mode, status, topic, updated_at
        FROM meeting_sessions
        WHERE meeting_id = ?
        LIMIT 1
        "#,
    )
    .bind(&id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| format!("select session: {err}"))?;
    pool.close().await;

    row.map(decode_session).transpose()
}
