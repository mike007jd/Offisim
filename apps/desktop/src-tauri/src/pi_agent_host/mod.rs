mod bridge;
mod payload;
mod provider;
mod run;
mod stream;
mod types;
mod wire;
mod workspace_files;

pub(crate) use payload::app_pi_session_dir;
pub use stream::PiRunStreamSnapshot;
#[allow(unused_imports)]
pub use types::{
    AiRuntimeStatusResponse, PiAgentCollaborateRequest, PiAgentEnhanceRequest,
    PiAgentExecuteRequest, PiAgentHostEvent, PiAgentHostResponse, PiAgentModelsConfig,
    PiAgentPaths, PiAgentProviderAuthStatus, PiAgentProviderStatus, PiAgentStatusResponse,
    PiModelSummary,
};
pub(crate) use wire::PI_HOST_PROTOCOL_VERSION;

use bridge::{confirm_execution_impl, ui_response_impl};
use provider::{runtime_status_impl, status_impl};
use run::{abort_impl, collaborate_impl, enhance_impl, execute_impl, resume_impl};

use tauri::{ipc::Channel, AppHandle};

use crate::agent_host_runtime::AgentHostLane;

/// Terminal run events and their workspace read capability must expire together.
pub(crate) const PI_RUN_STREAM_TERMINAL_TTL_SECS: u64 = 30 * 60;

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
    app: AppHandle,
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiRunStreamSnapshot, String> {
    if stream::stream_snapshot(request_id.clone())?.is_none() {
        return Err(format!("No live Pi Agent stream for request {request_id}"));
    }
    match crate::task_workspace_binding::replay_workspace_bound_for_request(&app, &request_id) {
        Ok(Some(event)) => on_event
            .send(event)
            .map_err(|err| format!("Replay Pi Agent workspace binding: {err}"))?,
        Ok(None) => {}
        Err(error) => {
            // Capability replay is independently fail-closed. Result/error and
            // cursor replay must remain available for terminal reconciliation.
            eprintln!(
                "[pi-agent-host] skipped non-authoritative workspace replay for {request_id}: {error}"
            );
        }
    }
    stream::reattach_stream(request_id, after_cursor, on_event)
}

/// Agent-agnostic gateway command. Forwards verbatim to the Pi lane via
/// `execute_impl`; the Pi-specific types ride in the host/driver.
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
    resume_impl(app, req, on_event).await
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

/// Confirm the exact host-observed API execution target. Rust only writes this
/// ACK when requestId + prepareId + targetDigest match a preparation frame it
/// already received from the live sidecar.
#[tauri::command]
pub async fn agent_runtime_confirm_execution(
    request_id: String,
    prepare_id: String,
    target_digest: String,
) -> Result<(), String> {
    confirm_execution_impl(request_id, prepare_id, target_digest).await
}

/// Agent-agnostic gateway for an interaction answer. Forwards verbatim to
/// `ui_response_impl`.
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
pub async fn pi_agent_status(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
    status_impl(app).await
}

/// Engine-neutral runtime status. Native lanes are inspected concurrently and
/// merged without allowing one unavailable engine to hide the other.
#[tauri::command]
pub async fn agent_runtime_status(
    app: AppHandle,
    include_usage: Option<bool>,
) -> Result<AiRuntimeStatusResponse, String> {
    let (api, codex) = tokio::join!(
        runtime_status_impl(app.clone()),
        crate::codex_agent_host::status_impl(app, include_usage.unwrap_or(false))
    );
    let checked_at = crate::codex_agent_host::checked_at_now()
        .or_else(|_| {
            api.as_ref()
                .map(|status| status.checked_at.clone())
                .or_else(|_| codex.as_ref().map(|status| status.checked_at.clone()))
        })
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into());
    Ok(merge_runtime_status(api, codex, checked_at))
}

fn merge_runtime_status(
    api: Result<AiRuntimeStatusResponse, String>,
    codex: Result<crate::codex_agent_host::CodexAgentStatusResponse, String>,
    checked_at: String,
) -> AiRuntimeStatusResponse {
    let mut accounts = Vec::new();
    let mut models = Vec::new();
    let mut orchestration_engines = Vec::new();
    match api {
        Ok(api) => {
            accounts.extend(api.accounts);
            models.extend(api.models);
            orchestration_engines.extend(api.orchestration_engines);
        }
        Err(_) => accounts.push(api_unavailable_account()),
    }
    match codex {
        Ok(codex) => {
            if let Ok(engine) = serde_json::to_value(codex) {
                orchestration_engines.push(engine);
            } else {
                orchestration_engines.push(codex_unavailable_account());
            }
        }
        Err(_) => orchestration_engines.push(codex_unavailable_account()),
    }
    AiRuntimeStatusResponse {
        accounts,
        models,
        orchestration_engines,
        checked_at,
    }
}

fn api_unavailable_account() -> serde_json::Value {
    let unavailable = |reason: &str| {
        serde_json::json!({
            "status": "unavailable",
            "reason": reason,
        })
    };
    serde_json::json!({
        "engineId": "api",
        "accountId": "api-status-unavailable",
        "billingMode": "api",
        "displayName": "API accounts",
        "status": "unavailable",
        "statusReason": "API account status is unavailable.",
        "capabilities": {
            "execute": unavailable("API account status is unavailable."),
            "models": unavailable("API model status is unavailable."),
            "usage": unavailable("API usage status is unavailable."),
            "cost": unavailable("API cost status is unavailable."),
        },
        "usage": null,
    })
}

fn codex_unavailable_account() -> serde_json::Value {
    serde_json::json!({
        "engineId": "codex",
        "displayName": "Codex CLI",
        "state": "unavailable",
        "statusReason": "Codex CLI status is unavailable.",
        "loginCommand": "codex login",
        "docsUrl": "https://developers.openai.com/codex/auth",
        "checkedAt": "1970-01-01T00:00:00Z",
        "capabilities": {
            "stop": true,
            "steer": false,
            "resume": true,
            "permissionModes": ["plan", "ask", "auto", "full"],
            "interactions": { "approval": true, "userInput": true },
            "processEvents": { "reasoning": true, "toolCalls": true, "fileChanges": true },
        }
    })
}

#[cfg(test)]
mod tests;
