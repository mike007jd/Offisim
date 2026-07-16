use tauri::{ipc::Channel, AppHandle};

use super::{
    abort_impl, enhance_impl, execute_impl, reattach_impl, release_stream_impl, status_impl,
    stream_snapshot_impl, ClaudeAgentEnhanceRequest, ClaudeAgentExecuteRequest,
    ClaudeAgentStatusResponse,
};
use crate::pi_agent_host::{PiAgentHostEvent, PiAgentHostResponse, PiRunStreamSnapshot};

#[tauri::command]
pub async fn claude_agent_execute(
    app: AppHandle,
    req: ClaudeAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_impl(app, req, on_event, false).await
}

#[tauri::command]
pub async fn claude_agent_resume(
    app: AppHandle,
    req: ClaudeAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_impl(app, req, on_event, true).await
}

#[tauri::command]
pub async fn claude_agent_enhance(
    app: AppHandle,
    req: ClaudeAgentEnhanceRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    enhance_impl(app, req, on_event).await
}

#[tauri::command]
pub fn claude_agent_abort(request_id: String) -> Result<(), String> {
    abort_impl(request_id)
}

#[tauri::command]
pub async fn claude_agent_answer(
    request_id: String,
    id: String,
    confirmed: Option<bool>,
    value: Option<String>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    crate::pi_agent_host::bridge::ui_response_impl(request_id, id, confirmed, value, cancelled)
        .await
}

#[tauri::command]
pub fn claude_agent_stream_snapshot(
    request_id: String,
) -> Result<Option<PiRunStreamSnapshot>, String> {
    stream_snapshot_impl(request_id)
}

#[tauri::command]
pub fn claude_agent_release_stream(request_id: String) -> Result<(), String> {
    release_stream_impl(request_id)
}

#[tauri::command]
pub fn claude_agent_reattach(
    app: AppHandle,
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiRunStreamSnapshot, String> {
    reattach_impl(app, request_id, after_cursor, on_event)
}

#[tauri::command]
pub async fn claude_agent_status(app: AppHandle) -> Result<ClaudeAgentStatusResponse, String> {
    status_impl(app, true).await
}
