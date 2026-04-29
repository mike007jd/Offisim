use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, Runtime};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCard {
    id: String,
    project_id: String,
    company_id: String,
    title: String,
    note: String,
    state: String,
    origin: String,
    created_by_employee_id: Option<String>,
    assigned_employee_id: Option<String>,
    parent_card_id: Option<String>,
    blocked_reason: Option<String>,
    task_run_id: Option<String>,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKanbanCardInput {
    project_id: String,
    id: Option<String>,
    title: String,
    note: Option<String>,
    state: Option<String>,
    origin: String,
    created_by_employee_id: Option<String>,
    assigned_employee_id: Option<String>,
    parent_card_id: Option<String>,
    blocked_reason: Option<String>,
    task_run_id: Option<String>,
    sort_order: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KanbanUpdatePayload {
    op: String,
    card: KanbanCard,
}

fn validate_state(state: &str) -> Result<(), String> {
    match state {
        "todo" | "doing" | "blocked" | "review" | "done" => Ok(()),
        _ => Err(format!("invalid kanban state: {state}")),
    }
}

fn is_allowed_transition(current: &str, next: &str) -> bool {
    if current == next {
        return true;
    }
    matches!(
        (current, next),
        ("todo", "doing")
            | ("todo", "blocked")
            | ("todo", "review")
            | ("todo", "done")
            | ("doing", "todo")
            | ("doing", "blocked")
            | ("doing", "review")
            | ("doing", "done")
            | ("blocked", "todo")
            | ("blocked", "doing")
            | ("blocked", "review")
            | ("review", "doing")
            | ("review", "blocked")
            | ("review", "done")
    )
}

fn validate_origin(origin: &str) -> Result<(), String> {
    match origin {
        "pm-planner" | "employee" | "manager" | "human" => Ok(()),
        _ => Err(format!("invalid kanban origin: {origin}")),
    }
}

fn generate_card_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let mut bytes = [0_u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("card-{timestamp:x}-{:x}", u64::from_le_bytes(bytes))
}

fn decode_card(row: sqlx::sqlite::SqliteRow) -> Result<KanbanCard, String> {
    Ok(KanbanCard {
        id: row
            .try_get("id")
            .map_err(|err| format!("decode id: {err}"))?,
        project_id: row
            .try_get("project_id")
            .map_err(|err| format!("decode project_id: {err}"))?,
        company_id: row
            .try_get("company_id")
            .map_err(|err| format!("decode company_id: {err}"))?,
        title: row
            .try_get("title")
            .map_err(|err| format!("decode title: {err}"))?,
        note: row
            .try_get("note")
            .map_err(|err| format!("decode note: {err}"))?,
        state: row
            .try_get("state")
            .map_err(|err| format!("decode state: {err}"))?,
        origin: row
            .try_get("origin")
            .map_err(|err| format!("decode origin: {err}"))?,
        created_by_employee_id: row
            .try_get("created_by_employee_id")
            .map_err(|err| format!("decode created_by_employee_id: {err}"))?,
        assigned_employee_id: row
            .try_get("assigned_employee_id")
            .map_err(|err| format!("decode assigned_employee_id: {err}"))?,
        parent_card_id: row
            .try_get("parent_card_id")
            .map_err(|err| format!("decode parent_card_id: {err}"))?,
        blocked_reason: row
            .try_get("blocked_reason")
            .map_err(|err| format!("decode blocked_reason: {err}"))?,
        task_run_id: row
            .try_get("task_run_id")
            .map_err(|err| format!("decode task_run_id: {err}"))?,
        sort_order: row
            .try_get("sort_order")
            .map_err(|err| format!("decode sort_order: {err}"))?,
        created_at: row
            .try_get("created_at")
            .map_err(|err| format!("decode created_at: {err}"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| format!("decode updated_at: {err}"))?,
    })
}

async fn open_pool<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<sqlx::SqlitePool, String> {
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

async fn fetch_card(pool: &sqlx::SqlitePool, id: &str) -> Result<Option<KanbanCard>, String> {
    let row = sqlx::query(
        r#"
        SELECT id, project_id, company_id, title, note, state, origin,
               created_by_employee_id, assigned_employee_id, parent_card_id,
               blocked_reason, task_run_id, sort_order, created_at, updated_at
        FROM kanban_cards
        WHERE id = ?
        LIMIT 1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|err| format!("select kanban card: {err}"))?;

    row.map(decode_card).transpose()
}

fn emit_kanban_update<R: Runtime>(app: &tauri::AppHandle<R>, op: &str, card: &KanbanCard) {
    let payload = KanbanUpdatePayload {
        op: op.to_string(),
        card: card.clone(),
    };
    let event_name = format!("kanban://updates/{}", card.project_id);
    let _ = app.emit(&event_name, &payload);
}

#[tauri::command]
pub async fn list_kanban_cards<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<Vec<KanbanCard>, String> {
    let pool = open_pool(&app).await?;
    let rows = sqlx::query(
        r#"
        SELECT id, project_id, company_id, title, note, state, origin,
               created_by_employee_id, assigned_employee_id, parent_card_id,
               blocked_reason, task_run_id, sort_order, created_at, updated_at
        FROM kanban_cards
        WHERE project_id = ?
        ORDER BY sort_order ASC, created_at ASC
        "#,
    )
    .bind(&project_id)
    .fetch_all(&pool)
    .await
    .map_err(|err| format!("list kanban cards: {err}"))?;
    pool.close().await;
    rows.into_iter().map(decode_card).collect()
}

#[tauri::command]
pub async fn create_kanban_card<R: Runtime>(
    app: tauri::AppHandle<R>,
    input: CreateKanbanCardInput,
) -> Result<KanbanCard, String> {
    validate_origin(&input.origin)?;
    let state = input.state.unwrap_or_else(|| "todo".to_string());
    validate_state(&state)?;
    let id = input.id.unwrap_or_else(generate_card_id);
    let pool = open_pool(&app).await?;
    let company_id: Option<String> = sqlx::query_scalar(
        r#"
        SELECT company_id
        FROM projects
        WHERE project_id = ?
        LIMIT 1
        "#,
    )
    .bind(&input.project_id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| format!("resolve project company: {err}"))?;
    let company_id = company_id.ok_or_else(|| "project not found".to_string())?;

    sqlx::query(
        r#"
        INSERT INTO kanban_cards (
            id, project_id, company_id, title, note, state, origin,
            created_by_employee_id, assigned_employee_id, parent_card_id,
            blocked_reason, task_run_id, sort_order, created_at, updated_at
        )
        VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            strftime('%Y-%m-%dT%H:%M:%fZ','now')
        )
        "#,
    )
    .bind(&id)
    .bind(&input.project_id)
    .bind(&company_id)
    .bind(input.title.trim())
    .bind(input.note.unwrap_or_default())
    .bind(&state)
    .bind(&input.origin)
    .bind(input.created_by_employee_id)
    .bind(input.assigned_employee_id)
    .bind(input.parent_card_id)
    .bind(input.blocked_reason)
    .bind(input.task_run_id)
    .bind(input.sort_order.unwrap_or(0))
    .execute(&pool)
    .await
    .map_err(|err| format!("insert kanban card: {err}"))?;

    let card = fetch_card(&pool, &id)
        .await?
        .ok_or_else(|| "created kanban card not found".to_string())?;
    pool.close().await;
    emit_kanban_update(&app, "created", &card);
    Ok(card)
}

#[tauri::command]
pub async fn transition_kanban_card<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    next: String,
    reason: Option<String>,
) -> Result<Option<KanbanCard>, String> {
    validate_state(&next)?;
    let pool = open_pool(&app).await?;
    let current: Option<String> =
        sqlx::query_scalar("SELECT state FROM kanban_cards WHERE id = ? LIMIT 1")
            .bind(&id)
            .fetch_optional(&pool)
            .await
            .map_err(|err| format!("select kanban current state: {err}"))?;
    let Some(current) = current else {
        pool.close().await;
        return Ok(None);
    };
    if !is_allowed_transition(&current, &next) {
        pool.close().await;
        return Err(format!("invalid kanban transition: {current} -> {next}"));
    }
    sqlx::query(
        r#"
        UPDATE kanban_cards
        SET state = ?, blocked_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?
        "#,
    )
    .bind(&next)
    .bind(reason)
    .bind(&id)
    .execute(&pool)
    .await
    .map_err(|err| format!("transition kanban card: {err}"))?;

    let card = fetch_card(&pool, &id).await?;
    pool.close().await;
    if let Some(card) = &card {
        emit_kanban_update(&app, "transitioned", card);
    }
    Ok(card)
}

#[tauri::command]
pub async fn count_kanban_for_employee<R: Runtime>(
    app: tauri::AppHandle<R>,
    employee_id: String,
) -> Result<i64, String> {
    let pool = open_pool(&app).await?;
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM kanban_cards
        WHERE assigned_employee_id = ? AND state <> 'done'
        "#,
    )
    .bind(&employee_id)
    .fetch_one(&pool)
    .await
    .map_err(|err| format!("count employee kanban cards: {err}"))?;
    pool.close().await;
    Ok(count)
}
