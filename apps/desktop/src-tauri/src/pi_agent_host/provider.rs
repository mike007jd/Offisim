use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{dev_workspace_root, sidecar_script_path};

use super::payload::{app_pi_agent_dir, pi_env};
use super::run::{run_pi_sidecar_jsonl, PiSidecarRun};
use super::types::{AiRuntimeStatusResponse, PiAgentStatusResponse};
use super::wire::parse_status;
use super::PI_LANE;

/// Adapter diagnostics used only by the legacy diagnostic command and provider
/// inspection. Product surfaces must call `runtime_status_impl`, which strips paths,
/// provider configuration, and credential-source details at this boundary.
pub(super) async fn status_impl(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(&app, dev_root.as_ref(), PI_LANE)
        .map_err(|err| err.into_code_message(PI_LANE).1)?;
    let cwd = dev_root
        .clone()
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let payload = serde_json::json!({
        "mode": "status",
        "agentDir": app_pi_agent_dir(&app).map(|path| path.to_string_lossy().to_string()),
    });
    let response = run_pi_sidecar_jsonl(
        &app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_binding: None,
            env: pi_env(None),
            payload,
            token: CancellationToken::new(),
            on_event: None,
            register_stdin: None,
            stream_request_id: None,
        },
    )
    .await
    .map_err(|err| err.into_code_message(PI_LANE).1)?;
    parse_status(response).map_err(|err| err.into_code_message(PI_LANE).1)
}

pub(super) async fn runtime_status_impl(app: AppHandle) -> Result<AiRuntimeStatusResponse, String> {
    status_impl(app)
        .await?
        .runtime_status
        .ok_or_else(|| "Agent runtime returned no safe account catalog.".to_string())
}
