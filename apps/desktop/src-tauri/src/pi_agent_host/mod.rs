mod bridge;
mod payload;
mod provider;
mod run;
mod stream;
mod types;
mod wire;

pub use stream::PiRunStreamSnapshot;
#[allow(unused_imports)]
pub use types::{
    PiAgentCollaborateRequest, PiAgentEnhanceRequest, PiAgentExecuteRequest, PiAgentHostEvent,
    PiAgentHostResponse, PiAgentModelsConfig, PiAgentPaths, PiAgentProviderAuthStatus,
    PiAgentProviderConfigInput, PiAgentProviderConfigStatus, PiAgentProviderModelConfig,
    PiAgentProviderStatus, PiAgentProviderTemplate, PiAgentStatusResponse, PiModelSummary,
};

use bridge::ui_response_impl;
use provider::status_impl;
use run::{abort_impl, collaborate_impl, enhance_impl, execute_impl};

use tauri::{ipc::Channel, AppHandle};

use crate::agent_host_runtime::AgentHostLane;

const PI_LANE: AgentHostLane = AgentHostLane {
    name: "Pi Agent",
    execution_lane: "pi-agent",
    resource_path: "resources/pi-agent-host.mjs",
    dev_script_name: "scripts/tauri-pi-agent-host.entry.mjs",
    aborted_message: "Pi Agent request aborted",
};

#[tauri::command]
pub fn agent_runtime_stream_snapshot(
    request_id: String,
) -> Result<Option<PiRunStreamSnapshot>, String> {
    stream::stream_snapshot(request_id)
}

#[tauri::command]
pub fn agent_runtime_release_stream(request_id: String) -> Result<(), String> {
    stream::release_stream(request_id)
}

#[tauri::command]
pub fn agent_runtime_reattach(
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiRunStreamSnapshot, String> {
    stream::reattach_stream(request_id, after_cursor, on_event)
}

#[tauri::command]
pub async fn pi_agent_execute(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_impl(app, req, on_event).await
}

/// Agent-agnostic gateway command. Forwards verbatim to the Pi lane via
/// `execute_impl` — the renderer's runtime-neutral DesktopAgentRuntime calls this
/// instead of `pi_agent_execute`; the Pi-specific types ride in the host/driver.
#[tauri::command]
pub async fn agent_runtime_execute(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_impl(app, req, on_event).await
}

/// Agent-agnostic gateway command for Prompt Enhance (PR-06). A DEDICATED,
/// isolated one-shot — never the work path. Forwards to `enhance_impl`, which runs
/// the Pi host with no project workspace, no tools, and no persistence. The
/// renderer's enhance transport calls this instead of `agent_runtime_execute`.
#[tauri::command]
pub async fn agent_runtime_enhance(
    app: AppHandle,
    req: PiAgentEnhanceRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    enhance_impl(app, req, on_event).await
}

/// Agent-agnostic gateway command for the Collaboration capability profile (PR-03).
/// The HOST-ENFORCED no-tools / no-workspace / no-persistence STREAMING path for
/// daily company chat. Forwards to `collaborate_impl`, which runs the Pi host with
/// a neutral cwd, zero tools, and no extension factories. The renderer's
/// collaboration transport calls this instead of `agent_runtime_execute`, so a
/// collaboration reply NEVER takes the work execute path (no project bind, no
/// agent_runs / mission persistence, no Office dramaturgy projection).
#[tauri::command]
pub async fn agent_runtime_collaborate(
    app: AppHandle,
    req: PiAgentCollaborateRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    collaborate_impl(app, req, on_event).await
}

/// Agent-agnostic durable-resume gateway. Pi resumes by re-entering the same
/// thread/session directory; the Node host's SessionManager continues the recent
/// session automatically when the same sessionDir is supplied.
#[tauri::command]
pub async fn agent_runtime_resume(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_impl(app, req, on_event).await
}

#[tauri::command]
pub fn pi_agent_abort(request_id: String) -> Result<(), String> {
    abort_impl(request_id)
}

/// Agent-agnostic gateway abort. Forwards verbatim to `abort_impl`.
#[tauri::command]
pub fn agent_runtime_abort(request_id: String) -> Result<(), String> {
    abort_impl(request_id)
}

#[tauri::command]
pub async fn agent_runtime_control(
    request_id: String,
    action: String,
    run_id: String,
) -> Result<(), String> {
    bridge::control_impl(request_id, action, run_id).await
}

#[tauri::command]
pub async fn pi_agent_ui_response(
    request_id: String,
    id: String,
    confirmed: Option<bool>,
    value: Option<String>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    ui_response_impl(request_id, id, confirmed, value, cancelled).await
}

/// Agent-agnostic gateway: the generic name for an interaction answer. Forwards
/// verbatim to `ui_response_impl` — the runtime-neutral DesktopAgentRuntime calls
/// this instead of `pi_agent_ui_response`.
#[tauri::command]
pub async fn agent_runtime_answer(
    request_id: String,
    id: String,
    confirmed: Option<bool>,
    value: Option<String>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    ui_response_impl(request_id, id, confirmed, value, cancelled).await
}

#[tauri::command]
pub async fn pi_agent_open_config_folder(app: AppHandle) -> Result<(), String> {
    provider::open_config_folder(app).await
}

#[tauri::command]
pub async fn pi_agent_save_provider(
    app: AppHandle,
    config: PiAgentProviderConfigInput,
) -> Result<PiAgentStatusResponse, String> {
    provider::save_provider(app, config).await
}

#[tauri::command]
pub async fn pi_agent_status(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
    status_impl(app).await
}

/// Agent-agnostic gateway status. Forwards verbatim to `status_impl`.
#[tauri::command]
pub async fn agent_runtime_status(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
    status_impl(app).await
}

#[cfg(test)]
mod tests;
