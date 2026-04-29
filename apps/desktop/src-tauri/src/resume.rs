use serde::Serialize;
use serde_json::Value;
use sqlx::Row;
use tauri::Runtime;

use crate::local_db::get_offisim_pool;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeConversationSnapshot {
    conversation_id: String,
    checkpoint_id: String,
    checkpoint_ns: String,
    checkpoint_type: String,
    checkpoint: Value,
    metadata: Value,
    last_checkpoint_ts: Option<String>,
}

fn parse_json_text(raw: String) -> Value {
    serde_json::from_str(&raw).unwrap_or(Value::String(raw))
}

fn checkpoint_ts(checkpoint: &Value) -> Option<String> {
    checkpoint
        .get("ts")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

#[tauri::command]
pub async fn resume_conversation<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<Option<ResumeConversationSnapshot>, String> {
    let pool = get_offisim_pool(&app)?;

    let row = sqlx::query(
        r#"
        SELECT checkpoint_id, checkpoint_ns, type, checkpoint, metadata
        FROM checkpoints
        WHERE thread_id = ? AND checkpoint_ns = ''
        ORDER BY checkpoint_id DESC
        LIMIT 1
        "#,
    )
    .bind(&id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| format!("select latest checkpoint: {err}"))?;

    let Some(row) = row else {
        return Ok(None);
    };

    let checkpoint = parse_json_text(
        row.try_get::<String, _>("checkpoint")
            .map_err(|err| format!("decode checkpoint: {err}"))?,
    );
    let metadata = parse_json_text(
        row.try_get::<String, _>("metadata")
            .map_err(|err| format!("decode metadata: {err}"))?,
    );
    let last_checkpoint_ts = checkpoint_ts(&checkpoint);

    Ok(Some(ResumeConversationSnapshot {
        conversation_id: id,
        checkpoint_id: row
            .try_get("checkpoint_id")
            .map_err(|err| format!("decode checkpoint_id: {err}"))?,
        checkpoint_ns: row
            .try_get("checkpoint_ns")
            .map_err(|err| format!("decode checkpoint_ns: {err}"))?,
        checkpoint_type: row
            .try_get("type")
            .map_err(|err| format!("decode type: {err}"))?,
        checkpoint,
        metadata,
        last_checkpoint_ts,
    }))
}
