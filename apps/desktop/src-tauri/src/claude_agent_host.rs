use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, path::BaseDirectory, AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

use crate::runtime_secrets;
use crate::sidecar_stderr::sanitized_stderr;

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
];
const BUNDLED_SIDECAR_RESOURCE_PATH: &str = "resources/claude-agent-host.mjs";

static IN_FLIGHT: Lazy<Mutex<HashMap<String, CancellationToken>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn register_token(id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    IN_FLIGHT
        .lock()
        .expect("claude_agent_host in_flight poisoned")
        .insert(id.to_string(), token.clone());
    token
}

fn clear_token(id: &str) {
    IN_FLIGHT
        .lock()
        .expect("claude_agent_host in_flight poisoned")
        .remove(id);
}

fn pluck_token(id: &str) -> Option<CancellationToken> {
    IN_FLIGHT
        .lock()
        .expect("claude_agent_host in_flight poisoned")
        .remove(id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAgentExecuteRequest {
    request_id: String,
    request: serde_json::Value,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    credential_mode: Option<ClaudeCredentialMode>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ClaudeCredentialMode {
    ApiKey,
    LocalAuth,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ClaudeAgentHostEvent {
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
    NoCredential,
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
            Self::Aborted => ("aborted".into(), "Claude lane request aborted".into()),
            Self::NoCredential => (
                "no-credential".into(),
                "No provider credential stored on this device.".into(),
            ),
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
        "Unable to resolve a working directory for the trusted Claude lane host.".into(),
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
        let dev_path = workspace_root.join("scripts/tauri-claude-agent-host.mjs");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_hint = bundled_path
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<unresolved resource path>".into());
    Err(HostError::HostUnavailable(format!(
        "Trusted Claude lane host script not found in bundled resources ({bundled_hint}) or the local workspace checkout.",
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

fn build_env(
    workspace_root: Option<&PathBuf>,
    secret: Option<&str>,
    base_url: Option<&str>,
) -> HashMap<String, String> {
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

    if let Ok(path) = std::env::var("OFFISIM_CLAUDE_CODE_EXECUTABLE") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            env.insert("OFFISIM_CLAUDE_CODE_EXECUTABLE".into(), trimmed.to_string());
        }
    }

    if let Some(secret) = secret {
        if let Some(base_url) = base_url.and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        }) {
            env.insert("ANTHROPIC_BASE_URL".into(), base_url.to_string());
            env.insert("ANTHROPIC_AUTH_TOKEN".into(), secret.to_string());
        } else {
            env.insert("ANTHROPIC_API_KEY".into(), secret.to_string());
        }
    }

    env
}

async fn kill_child(child: &mut Child) {
    let _ = child.kill().await;
}

async fn do_execute<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: ClaudeAgentExecuteRequest,
    on_event: &Channel<ClaudeAgentHostEvent>,
    token: CancellationToken,
) -> Result<(), HostError> {
    let credential_mode = req.credential_mode.unwrap_or(ClaudeCredentialMode::ApiKey);
    let secret = if credential_mode == ClaudeCredentialMode::ApiKey {
        Some(
            runtime_secrets::read_secret_raw()
                .map_err(HostError::Request)?
                .ok_or(HostError::NoCredential)?,
        )
    } else {
        None
    };
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
        .arg(script_path)
        .current_dir(&cwd)
        .env_clear()
        .envs(build_env(
            workspace_root.as_ref(),
            secret.as_deref(),
            req.base_url.as_deref(),
        ))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        HostError::Spawn(format!(
            "Failed to spawn trusted Claude lane host via `{}`: {}",
            node_executable, e
        ))
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| HostError::Spawn("Trusted Claude lane host is missing stdin".into()))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| HostError::Spawn("Trusted Claude lane host is missing stdout".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| HostError::Spawn("Trusted Claude lane host is missing stderr".into()))?;

    let payload_json = serde_json::to_vec(&payload)
        .map_err(|e| HostError::Request(format!("Serialize trusted host payload: {e}")))?;
    stdin
        .write_all(&payload_json)
        .await
        .map_err(|e| HostError::Request(format!("Write trusted host payload: {e}")))?;
    stdin
        .shutdown()
        .await
        .map_err(|e| HostError::Request(format!("Close trusted host stdin: {e}")))?;

    let stdout_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stdout
            .read_to_end(&mut bytes)
            .await
            .map(|_| bytes)
            .map_err(|e| format!("Read trusted host stdout: {e}"))
    });
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr
            .read_to_end(&mut bytes)
            .await
            .map(|_| bytes)
            .map_err(|e| format!("Read trusted host stderr: {e}"))
    });

    let status = tokio::select! {
        _ = token.cancelled() => {
            kill_child(&mut child).await;
            return Err(HostError::Aborted);
        }
        status = child.wait() => status.map_err(|e| HostError::Request(format!("Wait for trusted host process: {e}")))?,
    };

    let stdout_bytes = stdout_task
        .await
        .map_err(|e| HostError::Request(format!("Join trusted host stdout task: {e}")))?
        .map_err(HostError::Request)?;
    let stderr_bytes = stderr_task
        .await
        .map_err(|e| HostError::Request(format!("Join trusted host stderr task: {e}")))?
        .map_err(HostError::Request)?;

    let stdout_text = String::from_utf8(stdout_bytes)
        .map_err(|e| HostError::Protocol(format!("Trusted host stdout was not UTF-8: {e}")))?;
    let stderr_text = sanitized_stderr(&stderr_bytes);

    let envelope: SidecarEnvelope = serde_json::from_str(&stdout_text).map_err(|e| {
        HostError::Protocol(format!(
            "Trusted host returned invalid JSON: {e}. stderr: {}",
            if let Some(stderr) = stderr_text.as_deref() {
                stderr.to_string()
            } else {
                "(empty)".into()
            }
        ))
    })?;

    if !status.success() || !envelope.ok {
        if let Some(error) = envelope.error {
            let mut message = error.message;
            if let Some(stderr) = stderr_text.as_deref() {
                message = format!("{message} (stderr: {stderr})");
            }
            return Err(HostError::Upstream {
                code: error.code,
                message,
            });
        }

        return Err(HostError::Upstream {
            code: Some("upstream".into()),
            message: stderr_text
                .as_deref()
                .map(|stderr| format!("Trusted Claude lane host failed: {stderr}"))
                .unwrap_or_else(|| format!("Trusted Claude lane host exited with status {status}")),
        });
    }

    let response = envelope.response.ok_or_else(|| {
        HostError::Protocol("Trusted host response omitted the final LLM payload.".into())
    })?;

    on_event
        .send(ClaudeAgentHostEvent::Result { response })
        .map_err(|e| HostError::Request(format!("Send trusted host result: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn claude_agent_execute(
    app: AppHandle,
    req: ClaudeAgentExecuteRequest,
    on_event: Channel<ClaudeAgentHostEvent>,
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
            let _ = on_event.send(ClaudeAgentHostEvent::Error {
                code: code.clone(),
                message: message.clone(),
            });
            Err(format!("{code}: {message}"))
        }
    }
}

#[tauri::command]
pub fn claude_agent_abort(request_id: String) -> Result<(), String> {
    if let Some(token) = pluck_token(&request_id) {
        token.cancel();
    }
    Ok(())
}
