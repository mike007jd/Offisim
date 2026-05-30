use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::Row;
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
/// Hard cap on the trusted Claude lane sidecar's stdout/stderr. Mirrors the
/// bounded-I/O discipline in `builtin_tools.rs`: the lane fails closed instead
/// of buffering an unbounded child stream into the desktop process.
const MAX_SIDECAR_OUTPUT_BYTES: u64 = 16 * 1024 * 1024;

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
    provider_profile_id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    employee_id: Option<String>,
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

#[derive(Debug)]
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

fn dev_workspace_root() -> Option<PathBuf> {
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

async fn project_workspace_root<R: tauri::Runtime>(
    app: &AppHandle<R>,
    project_id: Option<&str>,
) -> Result<PathBuf, HostError> {
    let project_id = project_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            HostError::Request(
                "projectId is required for trusted Claude lane workspace binding.".into(),
            )
        })?;
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|err| HostError::HostUnavailable(format!("open offisim.db failed: {err}")))?;
    let row = sqlx::query(
        r#"
        SELECT workspace_root
        FROM projects
        WHERE project_id = ?
          AND workspace_root IS NOT NULL
          AND trim(workspace_root) <> ''
        "#,
    )
    .bind(project_id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| HostError::Request(format!("project workspace lookup failed: {err}")))?
    .ok_or_else(|| {
        HostError::Request("No workspace_root is bound for the trusted Claude project.".into())
    })?;
    let raw: String = row
        .try_get("workspace_root")
        .map_err(|err| HostError::Request(format!("decode workspace_root: {err}")))?;
    PathBuf::from(raw)
        .canonicalize()
        .map_err(|err| HostError::Request(format!("Resolve project workspace: {err}")))
}

fn default_host_cwd(workspace_root: &Path) -> PathBuf {
    workspace_root.to_path_buf()
}

fn resolved_request_cwd(
    requested: Option<&str>,
    workspace_root: &Path,
) -> Result<PathBuf, HostError> {
    let root = workspace_root;
    let cwd = if let Some(cwd) = requested.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then_some(trimmed)
    }) {
        PathBuf::from(cwd)
    } else {
        default_host_cwd(root)
    };
    let canonical = cwd
        .canonicalize()
        .map_err(|err| HostError::Request(format!("Resolve trusted Claude cwd: {err}")))?;
    if !canonical.starts_with(root) {
        return Err(HostError::Request(
            "Trusted Claude cwd is outside the bound project workspace.".into(),
        ));
    }
    Ok(canonical)
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

fn append_sidecar_audit<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: &ClaudeAgentExecuteRequest,
    cwd: &Path,
    status: &str,
) {
    let Some(dir) = app.path().app_local_data_dir().ok() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("trusted-sidecar-audit.jsonl");
    let event = serde_json::json!({
        "status": status,
        "requestId": req.request_id,
        "projectId": req.project_id,
        "employeeId": req.employee_id,
        "cwd": cwd.to_string_lossy(),
        "providerProfileId": req.provider_profile_id,
        "executionLane": "claude-agent-sdk",
        "credentialBytesRecorded": false,
        "atUnixMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{event}");
    }
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
    let provider_profile = req
        .provider_profile_id
        .as_deref()
        .map(runtime_secrets::resolve_runtime_provider_profile)
        .transpose()
        .map_err(HostError::Request)?;
    let secret = if credential_mode == ClaudeCredentialMode::ApiKey {
        Some(
            runtime_secrets::read_provider_secret(
                provider_profile
                    .as_ref()
                    .map(|profile| profile.secret_ref.as_str()),
            )
            .map_err(HostError::Request)?
            .ok_or(HostError::NoCredential)?,
        )
    } else {
        None
    };
    let workspace_root = project_workspace_root(app, req.project_id.as_deref()).await?;
    let cwd = resolved_request_cwd(req.cwd.as_deref(), &workspace_root)?;
    append_sidecar_audit(app, &req, &cwd, "started");
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref())?;
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
            Some(&workspace_root),
            secret.as_deref(),
            provider_profile
                .as_ref()
                .map(|profile| profile.base_url.as_str()),
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
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| HostError::Spawn("Trusted Claude lane host is missing stdout".into()))?;
    let stderr = child
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
        // Read one byte past the cap so an exhausted limiter signals overflow
        // rather than silently truncating the sidecar envelope.
        stdout
            .take(MAX_SIDECAR_OUTPUT_BYTES + 1)
            .read_to_end(&mut bytes)
            .await
            .map(|_| bytes)
            .map_err(|e| format!("Read trusted host stdout: {e}"))
    });
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr
            .take(MAX_SIDECAR_OUTPUT_BYTES + 1)
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

    let cap = usize::try_from(MAX_SIDECAR_OUTPUT_BYTES).unwrap_or(usize::MAX);
    if stdout_bytes.len() > cap || stderr_bytes.len() > cap {
        kill_child(&mut child).await;
        return Err(HostError::Protocol(format!(
            "Trusted Claude lane host exceeded the {cap}-byte output cap.",
        )));
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-claude-sidecar-{label}-{suffix}"));
        std::fs::create_dir_all(&root).expect("create temp project root");
        root.canonicalize().expect("canonical temp project root")
    }

    #[test]
    fn trusted_claude_cwd_defaults_to_project_workspace() {
        let root = temp_project_root("default");
        let cwd = resolved_request_cwd(None, &root).expect("resolve default cwd");
        assert_eq!(cwd, root);
    }

    #[test]
    fn trusted_claude_cwd_rejects_outside_project_workspace() {
        let root = temp_project_root("root");
        let outside = temp_project_root("outside");
        let err = resolved_request_cwd(Some(outside.to_string_lossy().as_ref()), &root)
            .expect_err("outside cwd should fail");
        assert!(matches!(err, HostError::Request(message) if message.contains("outside")));
    }
}
