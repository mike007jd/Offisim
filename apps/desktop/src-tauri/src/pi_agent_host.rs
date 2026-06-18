use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{
    append_sidecar_audit, dev_workspace_root, project_workspace_root, required_text,
    resolve_node_executable, resolved_request_cwd, sidecar_script_path, trusted_host_env,
    AgentHostLane, HostError, SidecarAudit,
};
use crate::in_flight::InFlightRegistry;
use crate::sidecar_stderr::sanitized_stderr;

const PI_LANE: AgentHostLane = AgentHostLane {
    name: "Pi Agent",
    execution_lane: "pi-agent",
    resource_path: "resources/pi-agent-host.mjs",
    dev_script_name: "scripts/tauri-pi-agent-host.entry.mjs",
    aborted_message: "Pi Agent request aborted",
};

static IN_FLIGHT: InFlightRegistry = InFlightRegistry::new("pi_agent_host");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentExecuteRequest {
    request_id: String,
    text: String,
    company_id: String,
    thread_id: String,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    employee_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    resume: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiModelSummary {
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    api: Option<String>,
    #[serde(default)]
    reasoning: Option<bool>,
    #[serde(default)]
    context_window: Option<u64>,
    #[serde(default)]
    max_tokens: Option<u64>,
    #[serde(default)]
    input: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentHostResponse {
    text: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    session_file: Option<String>,
    #[serde(default)]
    model: Option<PiModelSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PiAgentHostEvent {
    Started {
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        session_file: Option<String>,
        #[serde(default)]
        model: Option<PiModelSummary>,
        #[serde(default)]
        model_fallback_message: Option<String>,
    },
    MessageDelta {
        delta: String,
        #[serde(default)]
        channel: Option<String>,
    },
    MessageEnd {
        text: String,
        #[serde(default)]
        stop_reason: Option<String>,
        #[serde(default)]
        error_message: Option<String>,
    },
    Tool {
        status: String,
        tool_call_id: String,
        tool_name: String,
        #[serde(default)]
        detail: Option<String>,
        #[serde(default)]
        duration_ms: Option<u64>,
    },
    Result {
        response: PiAgentHostResponse,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentProviderAuthStatus {
    configured: bool,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentProviderStatus {
    provider: String,
    display_name: String,
    auth: PiAgentProviderAuthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentStatusResponse {
    ok: bool,
    #[serde(default)]
    auth_providers: Vec<String>,
    #[serde(default)]
    provider_status: Vec<PiAgentProviderStatus>,
    #[serde(default)]
    available_models: Vec<PiModelSummary>,
    #[serde(default)]
    all_model_count: u64,
    #[serde(default)]
    paths: Option<PiAgentPaths>,
    #[serde(default)]
    models_config: Option<PiAgentModelsConfig>,
    #[serde(default)]
    checked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentPaths {
    #[serde(default)]
    agent_dir: Option<String>,
    #[serde(default)]
    auth_path: Option<String>,
    #[serde(default)]
    models_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentModelsConfig {
    #[serde(default)]
    path: Option<String>,
    exists: bool,
    #[serde(default)]
    provider_count: u64,
    #[serde(default)]
    model_count: u64,
    #[serde(default)]
    override_count: u64,
    #[serde(default)]
    providers: Vec<String>,
    #[serde(default)]
    parse_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PiSidecarLine {
    Started {
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        session_file: Option<String>,
        #[serde(default)]
        model: Option<PiModelSummary>,
        #[serde(default)]
        model_fallback_message: Option<String>,
    },
    MessageDelta {
        delta: String,
        #[serde(default)]
        channel: Option<String>,
    },
    MessageEnd {
        text: String,
        #[serde(default)]
        stop_reason: Option<String>,
        #[serde(default)]
        error_message: Option<String>,
    },
    Tool {
        status: String,
        tool_call_id: String,
        tool_name: String,
        #[serde(default)]
        detail: Option<String>,
        #[serde(default)]
        duration_ms: Option<u64>,
    },
    Result {
        response: serde_json::Value,
    },
    Error {
        code: String,
        message: String,
    },
}

fn pi_env(workspace_root: Option<&PathBuf>) -> HashMap<String, String> {
    trusted_host_env(workspace_root, &[], "OFFISIM_PI_AGENT_HOST")
}

fn app_pi_session_dir<R: tauri::Runtime>(
    app: &AppHandle<R>,
    thread_id: &str,
) -> Result<PathBuf, HostError> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|err| HostError::HostUnavailable(format!("resolve app local data dir: {err}")))?;
    let safe_thread_id = thread_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    Ok(base.join("pi-agent-sessions").join(safe_thread_id))
}

fn app_pi_agent_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .home_dir()
        .ok()
        .map(|home| home.join(".pi/agent"))
}

fn sidecar_payload<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: &PiAgentExecuteRequest,
    cwd: &Path,
    session_dir: &Path,
) -> serde_json::Value {
    serde_json::json!({
        "mode": "execute",
        "text": req.text,
        "cwd": cwd.to_string_lossy().to_string(),
        "sessionDir": session_dir.to_string_lossy().to_string(),
        "agentDir": app_pi_agent_dir(app).map(|path| path.to_string_lossy().to_string()),
        "model": req.model,
        "resume": req.resume,
    })
}

async fn write_payload(
    mut stdin: tokio::process::ChildStdin,
    payload: &serde_json::Value,
) -> Result<(), HostError> {
    let payload_json = serde_json::to_vec(payload)
        .map_err(|err| HostError::Request(format!("Serialize Pi Agent payload: {err}")))?;
    stdin
        .write_all(&payload_json)
        .await
        .map_err(|err| HostError::Request(format!("Write Pi Agent payload: {err}")))?;
    stdin
        .shutdown()
        .await
        .map_err(|err| HostError::Request(format!("Close Pi Agent stdin: {err}")))?;
    Ok(())
}

async fn kill_child(child: &mut Child) {
    let _ = child.kill().await;
}

async fn read_stderr(mut stderr: tokio::process::ChildStderr) -> Vec<u8> {
    let mut bytes = Vec::new();
    let _ = stderr.read_to_end(&mut bytes).await;
    bytes
}

fn parse_response(value: serde_json::Value) -> Result<PiAgentHostResponse, HostError> {
    serde_json::from_value(value)
        .map_err(|err| HostError::Protocol(format!("Decode Pi Agent response: {err}")))
}

fn parse_status(value: serde_json::Value) -> Result<PiAgentStatusResponse, HostError> {
    serde_json::from_value(value)
        .map_err(|err| HostError::Protocol(format!("Decode Pi Agent status: {err}")))
}

fn send_sidecar_event(
    on_event: Option<&Channel<PiAgentHostEvent>>,
    line: PiSidecarLine,
) -> Result<Option<serde_json::Value>, HostError> {
    match line {
        PiSidecarLine::Started {
            session_id,
            session_file,
            model,
            model_fallback_message,
        } => {
            if let Some(on_event) = on_event {
                on_event
                    .send(PiAgentHostEvent::Started {
                        session_id,
                        session_file,
                        model,
                        model_fallback_message,
                    })
                    .map_err(|err| HostError::Request(format!("Send Pi start event: {err}")))?;
            }
            Ok(None)
        }
        PiSidecarLine::MessageDelta { delta, channel } => {
            if let Some(on_event) = on_event {
                on_event
                    .send(PiAgentHostEvent::MessageDelta { delta, channel })
                    .map_err(|err| HostError::Request(format!("Send Pi message delta: {err}")))?;
            }
            Ok(None)
        }
        PiSidecarLine::MessageEnd {
            text,
            stop_reason,
            error_message,
        } => {
            if let Some(on_event) = on_event {
                on_event
                    .send(PiAgentHostEvent::MessageEnd {
                        text,
                        stop_reason,
                        error_message,
                    })
                    .map_err(|err| HostError::Request(format!("Send Pi message end: {err}")))?;
            }
            Ok(None)
        }
        PiSidecarLine::Tool {
            status,
            tool_call_id,
            tool_name,
            detail,
            duration_ms,
        } => {
            if let Some(on_event) = on_event {
                on_event
                    .send(PiAgentHostEvent::Tool {
                        status,
                        tool_call_id,
                        tool_name,
                        detail,
                        duration_ms,
                    })
                    .map_err(|err| HostError::Request(format!("Send Pi tool event: {err}")))?;
            }
            Ok(None)
        }
        PiSidecarLine::Result { response } => Ok(Some(response)),
        PiSidecarLine::Error { code, message } => {
            if let Some(on_event) = on_event {
                let _ = on_event.send(PiAgentHostEvent::Error {
                    code: code.clone(),
                    message: message.clone(),
                });
            }
            Err(HostError::Upstream {
                code: Some(code),
                message,
            })
        }
    }
}

async fn run_pi_sidecar_jsonl(
    script_path: &Path,
    cwd: &Path,
    env: HashMap<String, String>,
    payload: serde_json::Value,
    token: CancellationToken,
    on_event: Option<&Channel<PiAgentHostEvent>>,
) -> Result<serde_json::Value, HostError> {
    let node_executable = resolve_node_executable(script_path);
    let mut command = Command::new(&node_executable);
    command
        .arg(script_path)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|err| {
        HostError::Spawn(format!(
            "Failed to spawn Pi Agent host via `{}`: {}",
            node_executable.display(),
            err
        ))
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| HostError::Spawn("Pi Agent host is missing stdin".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| HostError::Spawn("Pi Agent host is missing stdout".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| HostError::Spawn("Pi Agent host is missing stderr".into()))?;

    write_payload(stdin, &payload).await?;
    let stderr_task = tokio::spawn(read_stderr(stderr));
    let mut lines = BufReader::new(stdout).lines();
    let mut final_response: Option<serde_json::Value> = None;

    loop {
        tokio::select! {
            _ = token.cancelled() => {
                kill_child(&mut child).await;
                return Err(HostError::Aborted);
            }
            next_line = lines.next_line() => {
                let Some(line) = next_line.map_err(|err| HostError::Request(format!("Read Pi Agent stdout: {err}")))? else {
                    break;
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let parsed: PiSidecarLine = serde_json::from_str(trimmed).map_err(|err| {
                    HostError::Protocol(format!("Pi Agent host returned invalid JSONL: {err}; line: {trimmed}"))
                })?;
                if let Some(response) = send_sidecar_event(on_event, parsed)? {
                    final_response = Some(response);
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|err| HostError::Request(format!("Wait for Pi Agent host process: {err}")))?;
    let stderr_bytes = stderr_task
        .await
        .map_err(|err| HostError::Request(format!("Join Pi Agent stderr task: {err}")))?;
    if !status.success() && final_response.is_none() {
        let stderr_text = sanitized_stderr(&stderr_bytes);
        return Err(HostError::Upstream {
            code: Some("upstream".into()),
            message: stderr_text
                .as_deref()
                .map(|stderr| format!("Pi Agent host failed: {stderr}"))
                .unwrap_or_else(|| format!("Pi Agent host exited with status {status}")),
        });
    }

    final_response.ok_or_else(|| {
        HostError::Protocol("Pi Agent host did not emit a final result event.".into())
    })
}

async fn do_execute<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: PiAgentExecuteRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
) -> Result<(), HostError> {
    let company_id = required_text(Some(&req.company_id), "companyId", PI_LANE)?;
    let thread_id = required_text(Some(&req.thread_id), "threadId", PI_LANE)?;
    let workspace_root =
        project_workspace_root(app, Some(company_id), req.project_id.as_deref(), PI_LANE).await?;
    let cwd = resolved_request_cwd(req.cwd.as_deref(), &workspace_root, PI_LANE)?;
    let session_dir = app_pi_session_dir(app, thread_id)?;
    append_sidecar_audit(
        app,
        PI_LANE,
        SidecarAudit {
            request_id: &req.request_id,
            project_id: req.project_id.as_deref(),
            employee_id: req.employee_id.as_deref(),
            provider_profile_id: None,
            credential_recorded: false,
        },
        &cwd,
        "started",
    );

    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), PI_LANE)?;
    let payload = sidecar_payload(app, &req, &cwd, &session_dir);
    let response = run_pi_sidecar_jsonl(
        &script_path,
        &cwd,
        pi_env(Some(&workspace_root)),
        payload,
        token,
        Some(on_event),
    )
    .await?;
    let response = parse_response(response)?;
    on_event
        .send(PiAgentHostEvent::Result { response })
        .map_err(|err| HostError::Request(format!("Send Pi result event: {err}")))?;
    Ok(())
}

#[tauri::command]
pub async fn pi_agent_execute(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<(), String> {
    let request_id = req.request_id.clone();
    let token = IN_FLIGHT.register(&request_id);
    let result = do_execute(&app, req, &on_event, token.clone()).await;
    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(()) => Ok(()),
        Err(HostError::Aborted) => Ok(()),
        Err(error) => {
            let (code, message) = error.into_code_message(PI_LANE);
            let _ = on_event.send(PiAgentHostEvent::Error {
                code: code.clone(),
                message: message.clone(),
            });
            Err(format!("{code}: {message}"))
        }
    }
}

#[tauri::command]
pub fn pi_agent_abort(request_id: String) -> Result<(), String> {
    if let Some(token) = IN_FLIGHT.pluck(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn pi_agent_open_config_folder(app: AppHandle) -> Result<(), String> {
    let dir = app_pi_agent_dir(&app)
        .ok_or_else(|| "Resolve Pi Agent config folder: home directory unavailable".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Create Pi Agent config folder: {err}"))?;

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&dir);
        cmd
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&dir);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(&dir);
        cmd
    };

    let status = command
        .status()
        .await
        .map_err(|err| format!("Open Pi Agent config folder: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Open Pi Agent config folder exited with {status}"))
    }
}

#[tauri::command]
pub async fn pi_agent_status(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
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
        &script_path,
        &cwd,
        pi_env(None),
        payload,
        CancellationToken::new(),
        None,
    )
    .await
    .map_err(|err| err.into_code_message(PI_LANE).1)?;
    parse_status(response).map_err(|err| err.into_code_message(PI_LANE).1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-pi-agent-{label}-{suffix}"));
        std::fs::create_dir_all(&root).expect("create temp project root");
        root.canonicalize().expect("canonical temp project root")
    }

    #[test]
    fn pi_cwd_defaults_to_project_workspace() {
        let root = temp_project_root("default");
        let cwd = resolved_request_cwd(None, &root, PI_LANE).expect("resolve default cwd");
        assert_eq!(cwd, root);
    }

    #[test]
    fn pi_cwd_rejects_outside_project_workspace() {
        let root = temp_project_root("root");
        let outside = temp_project_root("outside");
        let err = resolved_request_cwd(Some(outside.to_string_lossy().as_ref()), &root, PI_LANE)
            .expect_err("outside cwd should fail");
        assert!(matches!(err, HostError::Request(message) if message.contains("outside")));
    }
}
