use tauri::{ipc::Channel, AppHandle};

use super::manager;
use super::types::{
    CodexAgentEnhanceRequest, CodexAgentExecuteRequest, CodexAgentHostEvent,
    CodexAgentHostResponse, CodexAgentStatusResponse, CodexRunStreamSnapshot,
};

#[tauri::command]
pub async fn codex_agent_execute(
    app: AppHandle,
    req: CodexAgentExecuteRequest,
    on_event: Channel<CodexAgentHostEvent>,
) -> Result<CodexAgentHostResponse, String> {
    manager::execute_impl(app, req, on_event, false).await
}

#[tauri::command]
pub async fn codex_agent_resume(
    app: AppHandle,
    req: CodexAgentExecuteRequest,
    on_event: Channel<CodexAgentHostEvent>,
) -> Result<CodexAgentHostResponse, String> {
    manager::execute_impl(app, req, on_event, true).await
}

#[tauri::command]
pub async fn codex_agent_enhance(
    app: AppHandle,
    req: CodexAgentEnhanceRequest,
    on_event: Channel<CodexAgentHostEvent>,
) -> Result<CodexAgentHostResponse, String> {
    manager::enhance_impl(app, req, on_event).await
}

#[tauri::command]
pub async fn codex_agent_abort(app: AppHandle, request_id: String) -> Result<(), String> {
    manager::abort_impl(app, request_id).await
}

#[tauri::command]
pub async fn codex_agent_answer(
    app: AppHandle,
    request_id: String,
    id: String,
    confirmed: Option<bool>,
    value: Option<String>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    manager::answer_impl(app, request_id, id, confirmed, value, cancelled).await
}

#[tauri::command]
pub fn codex_agent_stream_snapshot(
    app: AppHandle,
    request_id: String,
) -> Result<Option<CodexRunStreamSnapshot>, String> {
    manager::stream_snapshot_impl(app, request_id)
}

#[tauri::command]
pub fn codex_agent_release_stream(app: AppHandle, request_id: String) -> Result<(), String> {
    manager::release_stream_impl(app, request_id)
}

#[tauri::command]
pub fn codex_agent_reattach(
    app: AppHandle,
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<CodexAgentHostEvent>,
) -> Result<CodexRunStreamSnapshot, String> {
    manager::reattach_impl(app, request_id, after_cursor, on_event)
}

#[tauri::command]
pub async fn codex_agent_status(app: AppHandle) -> Result<CodexAgentStatusResponse, String> {
    manager::status_impl(app, true).await
}
