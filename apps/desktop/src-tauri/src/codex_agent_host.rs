use std::collections::HashMap;
use std::path::PathBuf;
use std::process::ExitStatus;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, path::BaseDirectory, AppHandle, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const ENV_WHITELIST: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "TERM",
    "SHELL",
    "TMPDIR",
    "LC_ALL",
    "LC_CTYPE",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "REQUESTS_CA_BUNDLE",
    "CODEX_HOME",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
];
const BUNDLED_SIDECAR_RESOURCE_PATH: &str = "resources/codex-agent-host.mjs";

static IN_FLIGHT: Lazy<Mutex<HashMap<String, CancellationToken>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn register_token(id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    IN_FLIGHT
        .lock()
        .expect("codex_agent_host in_flight poisoned")
        .insert(id.to_string(), token.clone());
    token
}

fn clear_token(id: &str) {
    IN_FLIGHT
        .lock()
        .expect("codex_agent_host in_flight poisoned")
        .remove(id);
}

fn pluck_token(id: &str) -> Option<CancellationToken> {
    IN_FLIGHT
        .lock()
        .expect("codex_agent_host in_flight poisoned")
        .remove(id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAgentExecuteRequest {
    request_id: String,
    request: serde_json::Value,
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CodexAgentHostEvent {
    Result { response: serde_json::Value },
    Error { code: String, message: String },
}

#[derive(Debug, Deserialize)]
struct SidecarEnvelope {
    ok: bool,
    #[serde(default)]
    response: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<SidecarError>,
}

#[derive(Debug, Deserialize)]
struct SidecarError {
    #[serde(default)]
    code: Option<String>,
    message: String,
}

enum HostError {
    Aborted,
    HostUnavailable(String),
    Spawn(String),
    Request(String),
    Protocol(String),
    Upstream {
        code: Option<String>,
        message: String,
    },
}

impl HostError {
    fn into_code_message(self) -> (String, String) {
        match self {
            Self::Aborted => ("aborted".into(), "Codex lane request aborted".into()),
            Self::HostUnavailable(message) => ("host-unavailable".into(), message),
            Self::Spawn(message) => ("spawn".into(), message),
            Self::Request(message) => ("request".into(), message),
            Self::Protocol(message) => ("protocol".into(), message),
            Self::Upstream { code, message } => {
                (code.unwrap_or_else(|| "upstream".into()), message)
            }
        }
    }
}

fn workspace_root() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("OFFISIM_WORKSPACE_ROOT") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .ok()
        .filter(|candidate| candidate.exists())
}

fn default_host_cwd(workspace_root: Option<&PathBuf>) -> Result<PathBuf, HostError> {
    if let Some(workspace_root) = workspace_root {
        return Ok(workspace_root.clone());
    }

    if let Ok(home) = std::env::var("HOME") {
        let candidate = PathBuf::from(home);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        if current_dir.exists() {
            return Ok(current_dir);
        }
    }

    Err(HostError::HostUnavailable(
        "Unable to resolve a working directory for the trusted Codex lane host.".into(),
    ))
}

fn sidecar_script_path<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_root: Option<&PathBuf>,
) -> Result<PathBuf, HostError> {
    let bundled_path = app
        .path()
        .resolve(BUNDLED_SIDECAR_RESOURCE_PATH, BaseDirectory::Resource)
        .ok();
    if let Some(path) = bundled_path.as_ref().filter(|path| path.exists()) {
        return Ok(path.clone());
    }

    if let Some(workspace_root) = workspace_root {
        let dev_path = workspace_root.join("scripts/tauri-codex-agent-host.mjs");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_hint = bundled_path
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<unresolved resource path>".into());
    Err(HostError::HostUnavailable(format!(
        "Trusted Codex lane host script not found in bundled resources ({bundled_hint}) or the local workspace checkout.",
    )))
}

fn resolved_request_cwd(
    requested: Option<&str>,
    workspace_root: Option<&PathBuf>,
) -> Result<PathBuf, HostError> {
    if let Some(cwd) = requested.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then_some(trimmed)
    }) {
        return Ok(PathBuf::from(cwd));
    }

    default_host_cwd(workspace_root)
}

fn build_env(workspace_root: Option<&PathBuf>) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in ENV_WHITELIST {
        if let Ok(value) = std::env::var(key) {
            env.insert((*key).to_string(), value);
        }
    }

    if let Some(workspace_root) = workspace_root {
        env.insert(
            "OFFISIM_WORKSPACE_ROOT".into(),
            workspace_root.to_string_lossy().to_string(),
        );
    }

    if let Ok(path) = std::env::var("OFFISIM_CODEX_EXECUTABLE") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            env.insert("OFFISIM_CODEX_EXECUTABLE".into(), trimmed.to_string());
        }
    }

    env
}

async fn kill_child(child: &mut Child) {
    let _ = child.kill().await;
}

fn take_child_pipe<T>(pipe: Option<T>, missing_message: &str) -> Result<T, HostError> {
    pipe.ok_or_else(|| HostError::Spawn(missing_message.into()))
}

async fn write_payload_to_sidecar(
    mut stdin: tokio::process::ChildStdin,
    payload_json: &[u8],
) -> Result<(), HostError> {
    stdin
        .write_all(payload_json)
        .await
        .map_err(|e| HostError::Request(format!("Write trusted host payload: {e}")))?;
    stdin
        .shutdown()
        .await
        .map_err(|e| HostError::Request(format!("Close trusted host stdin: {e}")))?;
    drop(stdin);
    Ok(())
}

fn spawn_read_task<R>(mut reader: R, label: &'static str) -> JoinHandle<Result<Vec<u8>, String>>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .await
            .map(|_| bytes)
            .map_err(|e| format!("Read trusted host {label}: {e}"))
    })
}

async fn join_read_task(
    task: JoinHandle<Result<Vec<u8>, String>>,
    label: &str,
) -> Result<Vec<u8>, HostError> {
    task.await
        .map_err(|e| HostError::Request(format!("Join trusted host {label} task: {e}")))?
        .map_err(HostError::Request)
}

fn parse_sidecar_response(
    status: ExitStatus,
    stdout_bytes: Vec<u8>,
    stderr_bytes: Vec<u8>,
) -> Result<serde_json::Value, HostError> {
    let stdout_text = String::from_utf8(stdout_bytes)
        .map_err(|e| HostError::Protocol(format!("Trusted host stdout was not UTF-8: {e}")))?;
    let stderr_text = String::from_utf8_lossy(&stderr_bytes).trim().to_string();

    let envelope: SidecarEnvelope = serde_json::from_str(&stdout_text).map_err(|e| {
        HostError::Protocol(format!(
            "Trusted host returned invalid JSON: {e}. stderr: {}",
            if stderr_text.is_empty() {
                "(empty)".into()
            } else {
                stderr_text.clone()
            }
        ))
    })?;

    if !status.success() || !envelope.ok {
        if let Some(error) = envelope.error {
            let mut message = error.message;
            if !stderr_text.is_empty() {
                message = format!("{message} (stderr: {stderr_text})");
            }
            return Err(HostError::Upstream {
                code: error.code,
                message,
            });
        }

        return Err(HostError::Upstream {
            code: Some("upstream".into()),
            message: if stderr_text.is_empty() {
                format!("Trusted Codex lane host exited with status {status}")
            } else {
                format!("Trusted Codex lane host failed: {stderr_text}")
            },
        });
    }

    envelope.response.ok_or_else(|| {
        HostError::Protocol("Trusted host response omitted the final LLM payload.".into())
    })
}

async fn do_execute<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: CodexAgentExecuteRequest,
    on_event: &Channel<CodexAgentHostEvent>,
    token: CancellationToken,
) -> Result<(), HostError> {
    let workspace_root = workspace_root();
    let cwd = resolved_request_cwd(req.cwd.as_deref(), workspace_root.as_ref())?;
    let script_path = sidecar_script_path(app, workspace_root.as_ref())?;
    let node_executable =
        std::env::var("OFFISIM_NODE_EXECUTABLE").unwrap_or_else(|_| "node".to_string());
    let payload = serde_json::json!({
        "request": req.request,
        "cwd": cwd.to_string_lossy().to_string(),
    });

    let mut command = Command::new(&node_executable);
    command
        .arg(&script_path)
        .current_dir(&cwd)
        .env_clear()
        .envs(build_env(workspace_root.as_ref()))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        HostError::Spawn(format!(
            "Failed to spawn trusted Codex lane host via `{}`: {}",
            node_executable, e
        ))
    })?;

    let stdin = take_child_pipe(
        child.stdin.take(),
        "Trusted Codex lane host is missing stdin",
    )?;
    let stdout = take_child_pipe(
        child.stdout.take(),
        "Trusted Codex lane host is missing stdout",
    )?;
    let stderr = take_child_pipe(
        child.stderr.take(),
        "Trusted Codex lane host is missing stderr",
    )?;

    let payload_json = serde_json::to_vec(&payload)
        .map_err(|e| HostError::Request(format!("Serialize trusted host payload: {e}")))?;
    write_payload_to_sidecar(stdin, &payload_json).await?;

    let stdout_task = spawn_read_task(stdout, "stdout");
    let stderr_task = spawn_read_task(stderr, "stderr");

    let status = tokio::select! {
        _ = token.cancelled() => {
            kill_child(&mut child).await;
            return Err(HostError::Aborted);
        }
        status = child.wait() => status.map_err(|e| HostError::Request(format!("Wait for trusted host process: {e}")))?,
    };

    let stdout_bytes = join_read_task(stdout_task, "stdout").await?;
    let stderr_bytes = join_read_task(stderr_task, "stderr").await?;
    let response = parse_sidecar_response(status, stdout_bytes, stderr_bytes)?;

    on_event
        .send(CodexAgentHostEvent::Result { response })
        .map_err(|e| HostError::Request(format!("Send trusted host result: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn codex_agent_execute(
    app: AppHandle,
    req: CodexAgentExecuteRequest,
    on_event: Channel<CodexAgentHostEvent>,
) -> Result<(), String> {
    let request_id = req.request_id.clone();
    let token = register_token(&request_id);
    let result = do_execute(&app, req, &on_event, token.clone()).await;
    clear_token(&request_id);

    match result {
        Ok(()) => Ok(()),
        Err(HostError::Aborted) => Ok(()),
        Err(error) => {
            let (code, message) = error.into_code_message();
            let _ = on_event.send(CodexAgentHostEvent::Error {
                code: code.clone(),
                message: message.clone(),
            });
            Err(format!("{code}: {message}"))
        }
    }
}

#[tauri::command]
pub fn codex_agent_abort(request_id: String) -> Result<(), String> {
    if let Some(token) = pluck_token(&request_id) {
        token.cancel();
    }
    Ok(())
}
