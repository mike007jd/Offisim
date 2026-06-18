use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitStatus;

use serde::Deserialize;
use sqlx::Row;
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::sidecar_stderr::sanitized_stderr;

const TRUSTED_HOST_ENV_WHITELIST: &[&str] = &[
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

const BUNDLED_NODE_RELATIVE_TO_RESOURCES: &str = "node/bin/node";

#[derive(Debug, Clone, Copy)]
pub(crate) struct AgentHostLane {
    pub(crate) name: &'static str,
    pub(crate) execution_lane: &'static str,
    pub(crate) resource_path: &'static str,
    pub(crate) dev_script_name: &'static str,
    pub(crate) aborted_message: &'static str,
    pub(crate) no_credential_message: &'static str,
    pub(crate) output_cap_bytes: Option<u64>,
}

pub(crate) struct SidecarAudit<'a> {
    pub(crate) request_id: &'a str,
    pub(crate) project_id: Option<&'a str>,
    pub(crate) employee_id: Option<&'a str>,
    pub(crate) provider_profile_id: Option<&'a str>,
    pub(crate) credential_recorded: bool,
}

#[derive(Debug)]
pub(crate) enum HostError {
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
    pub(crate) fn into_code_message(self, lane: AgentHostLane) -> (String, String) {
        match self {
            Self::Aborted => ("aborted".into(), lane.aborted_message.into()),
            Self::NoCredential => ("no-credential".into(), lane.no_credential_message.into()),
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

pub(crate) fn required_text<'a>(
    value: Option<&'a String>,
    field_name: &str,
    lane: AgentHostLane,
) -> Result<&'a str, HostError> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            HostError::Request(format!(
                "{field_name} is required for trusted {} lane requests.",
                lane.name
            ))
        })
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

pub(crate) fn dev_workspace_root() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }

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

pub(crate) async fn project_workspace_root<R: tauri::Runtime>(
    app: &AppHandle<R>,
    company_id: Option<&str>,
    project_id: Option<&str>,
    lane: AgentHostLane,
) -> Result<PathBuf, HostError> {
    let company_id = company_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            HostError::Request(format!(
                "companyId is required for trusted {} lane workspace binding.",
                lane.name
            ))
        })?;
    let project_id = project_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            HostError::Request(format!(
                "projectId is required for trusted {} lane workspace binding.",
                lane.name
            ))
        })?;
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|err| HostError::HostUnavailable(format!("open offisim.db failed: {err}")))?;
    let row = sqlx::query(
        r#"
        SELECT workspace_root
        FROM projects
        WHERE project_id = ?
          AND company_id = ?
          AND workspace_root IS NOT NULL
          AND trim(workspace_root) <> ''
        "#,
    )
    .bind(project_id)
    .bind(company_id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| HostError::Request(format!("project workspace lookup failed: {err}")))?
    .ok_or_else(|| {
        HostError::Request(format!(
            "No workspace_root is bound for the trusted {} project.",
            lane.name
        ))
    })?;
    let raw: String = row
        .try_get("workspace_root")
        .map_err(|err| HostError::Request(format!("decode workspace_root: {err}")))?;
    resolve_host_workspace_root(raw)
}

fn resolve_host_workspace_root(raw: String) -> Result<PathBuf, HostError> {
    crate::local_paths::resolve_project_workspace_root_path(raw).map_err(HostError::Request)
}

pub(crate) fn default_host_cwd(workspace_root: &Path) -> PathBuf {
    workspace_root.to_path_buf()
}

pub(crate) fn resolved_request_cwd(
    requested: Option<&str>,
    workspace_root: &Path,
    lane: AgentHostLane,
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
        .map_err(|err| HostError::Request(format!("Resolve trusted {} cwd: {err}", lane.name)))?;
    if !canonical.starts_with(root) {
        return Err(HostError::Request(format!(
            "Trusted {} cwd is outside the bound project workspace.",
            lane.name
        )));
    }
    Ok(canonical)
}

pub(crate) fn sidecar_script_path<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_root: Option<&PathBuf>,
    lane: AgentHostLane,
) -> Result<PathBuf, HostError> {
    let bundled_path = app
        .path()
        .resolve(lane.resource_path, BaseDirectory::Resource)
        .ok();
    if let Some(path) = bundled_path.as_ref().filter(|path| path.exists()) {
        return Ok(path.clone());
    }

    if let Some(workspace_root) = workspace_root {
        let dev_path = workspace_root.join(lane.dev_script_name);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_hint = bundled_path
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<unresolved resource path>".into());
    Err(HostError::HostUnavailable(format!(
        "Trusted {} lane host script not found in bundled resources ({bundled_hint}).",
        lane.name
    )))
}

pub(crate) fn base_env(
    env_whitelist: &[&str],
    workspace_root: Option<&PathBuf>,
) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in env_whitelist {
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

    env
}

pub(crate) fn trusted_host_env(
    workspace_root: Option<&PathBuf>,
    extra_allowlist: &[&str],
    executable_env_name: &str,
) -> HashMap<String, String> {
    let mut allowlist = TRUSTED_HOST_ENV_WHITELIST.to_vec();
    allowlist.extend_from_slice(extra_allowlist);
    let mut env = base_env(&allowlist, workspace_root);

    if let Ok(path) = std::env::var(executable_env_name) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            env.insert(executable_env_name.into(), trimmed.to_string());
        }
    }

    env
}

pub(crate) fn append_sidecar_audit<R: tauri::Runtime>(
    app: &AppHandle<R>,
    lane: AgentHostLane,
    audit: SidecarAudit<'_>,
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
        "requestId": audit.request_id,
        "projectId": audit.project_id,
        "employeeId": audit.employee_id,
        "cwd": cwd.to_string_lossy(),
        "providerProfileId": audit.provider_profile_id,
        "executionLane": lane.execution_lane,
        "credentialBytesRecorded": audit.credential_recorded,
        "atUnixMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{event}");
    }
}

fn executable_path(candidate: PathBuf) -> Option<PathBuf> {
    candidate.is_file().then_some(candidate)
}

fn node_binary_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn path_node_executable() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(node_binary_name()))
        .find_map(executable_path)
}

fn common_node_executable() -> Option<PathBuf> {
    [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find_map(executable_path)
}

fn bundled_node_executable(script_path: &Path) -> Option<PathBuf> {
    script_path
        .parent()
        .map(|resources_dir| resources_dir.join(BUNDLED_NODE_RELATIVE_TO_RESOURCES))
        .and_then(executable_path)
}

fn resolve_node_executable(script_path: &Path) -> PathBuf {
    if let Some(path) = std::env::var_os("OFFISIM_NODE_EXECUTABLE")
        .map(PathBuf::from)
        .and_then(executable_path)
    {
        return path;
    }
    if let Some(path) = bundled_node_executable(script_path) {
        return path;
    }
    if let Some(path) = path_node_executable() {
        return path;
    }
    common_node_executable().unwrap_or_else(|| PathBuf::from(node_binary_name()))
}

pub(crate) async fn run_sidecar_json(
    lane: AgentHostLane,
    script_path: &Path,
    cwd: &Path,
    env: HashMap<String, String>,
    payload: serde_json::Value,
    token: CancellationToken,
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

    let mut child = command.spawn().map_err(|e| {
        HostError::Spawn(format!(
            "Failed to spawn trusted {} lane host via `{}`: {}",
            lane.name,
            node_executable.display(),
            e
        ))
    })?;

    let stdin = take_child_pipe(
        child.stdin.take(),
        &format!("Trusted {} lane host is missing stdin", lane.name),
    )?;
    let stdout = take_child_pipe(
        child.stdout.take(),
        &format!("Trusted {} lane host is missing stdout", lane.name),
    )?;
    let stderr = take_child_pipe(
        child.stderr.take(),
        &format!("Trusted {} lane host is missing stderr", lane.name),
    )?;

    let payload_json = serde_json::to_vec(&payload)
        .map_err(|e| HostError::Request(format!("Serialize trusted host payload: {e}")))?;
    write_payload_to_sidecar(stdin, &payload_json).await?;

    let stdout_task = spawn_read_task(stdout, "stdout", lane.output_cap_bytes);
    let stderr_task = spawn_read_task(stderr, "stderr", lane.output_cap_bytes);

    let status = tokio::select! {
        _ = token.cancelled() => {
            kill_child(&mut child).await;
            return Err(HostError::Aborted);
        }
        status = child.wait() => status.map_err(|e| HostError::Request(format!("Wait for trusted host process: {e}")))?,
    };

    let stdout_output = join_read_task(stdout_task, "stdout").await?;
    let stderr_output = join_read_task(stderr_task, "stderr").await?;
    if let Some(max_bytes) = lane.output_cap_bytes {
        let cap = usize::try_from(max_bytes).unwrap_or(usize::MAX);
        if stdout_output.exceeded_cap || stderr_output.exceeded_cap {
            return Err(HostError::Protocol(format!(
                "Trusted {} lane host exceeded the {cap}-byte output cap.",
                lane.name
            )));
        }
    }

    parse_sidecar_response(lane, status, stdout_output.bytes, stderr_output.bytes)
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

struct ReadOutput {
    bytes: Vec<u8>,
    exceeded_cap: bool,
}

fn spawn_read_task<R>(
    mut reader: R,
    label: &'static str,
    output_cap_bytes: Option<u64>,
) -> JoinHandle<Result<ReadOutput, String>>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut bytes = Vec::new();
        match output_cap_bytes {
            Some(max_bytes) => read_with_cap(reader, label, max_bytes).await,
            None => reader
                .read_to_end(&mut bytes)
                .await
                .map(|_| ReadOutput {
                    bytes,
                    exceeded_cap: false,
                })
                .map_err(|e| format!("Read trusted host {label}: {e}")),
        }
    })
}

async fn read_with_cap<R>(
    mut reader: R,
    label: &'static str,
    max_bytes: u64,
) -> Result<ReadOutput, String>
where
    R: AsyncRead + Unpin,
{
    let cap = usize::try_from(max_bytes).unwrap_or(usize::MAX);
    let mut bytes = Vec::new();
    let mut exceeded_cap = false;
    let mut chunk = vec![0_u8; 8192];

    loop {
        let read = reader
            .read(&mut chunk)
            .await
            .map_err(|e| format!("Read trusted host {label}: {e}"))?;
        if read == 0 {
            break;
        }

        if bytes.len() < cap {
            let available = cap - bytes.len();
            let retained = available.min(read);
            bytes.extend_from_slice(&chunk[..retained]);
            if retained < read {
                exceeded_cap = true;
            }
        } else {
            exceeded_cap = true;
        }
    }

    Ok(ReadOutput {
        bytes,
        exceeded_cap,
    })
}

async fn join_read_task(
    task: JoinHandle<Result<ReadOutput, String>>,
    label: &str,
) -> Result<ReadOutput, HostError> {
    task.await
        .map_err(|e| HostError::Request(format!("Join trusted host {label} task: {e}")))?
        .map_err(HostError::Request)
}

fn parse_sidecar_response(
    lane: AgentHostLane,
    status: ExitStatus,
    stdout_bytes: Vec<u8>,
    stderr_bytes: Vec<u8>,
) -> Result<serde_json::Value, HostError> {
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
                .map(|stderr| format!("Trusted {} lane host failed: {stderr}", lane.name))
                .unwrap_or_else(|| {
                    format!(
                        "Trusted {} lane host exited with status {status}",
                        lane.name
                    )
                }),
        });
    }

    envelope.response.ok_or_else(|| {
        HostError::Protocol("Trusted host response omitted the final LLM payload.".into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    async fn capped_reader_retains_cap_and_marks_exceeded() {
        let input: &[u8] = b"abcdef";

        let output = read_with_cap(input, "stdout", 4)
            .await
            .expect("reader succeeds");

        assert_eq!(output.bytes, b"abcd");
        assert!(output.exceeded_cap);
    }

    #[tokio::test]
    async fn capped_reader_does_not_mark_exact_cap_as_exceeded() {
        let input: &[u8] = b"abcd";

        let output = read_with_cap(input, "stdout", 4)
            .await
            .expect("reader succeeds");

        assert_eq!(output.bytes, b"abcd");
        assert!(!output.exceeded_cap);
    }

    #[test]
    fn host_workspace_root_rejects_overbroad_raw_path() {
        let err = resolve_host_workspace_root("/tmp".to_string()).unwrap_err();
        match err {
            HostError::Request(message) => {
                assert_eq!(message, crate::local_paths::OVERBROAD_WORKSPACE_ROOT_ERROR);
            }
            other => panic!("expected request error, got {other:?}"),
        }
    }

    #[test]
    fn bundled_node_is_resolved_next_to_bundled_sidecar() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-node-runtime-{suffix}"));
        let node = root.join(BUNDLED_NODE_RELATIVE_TO_RESOURCES);
        std::fs::create_dir_all(node.parent().expect("node parent")).expect("create node dir");
        std::fs::write(&node, b"node").expect("write node marker");

        let script = root.join("claude-agent-host.mjs");
        assert_eq!(bundled_node_executable(&script), Some(node));

        let _ = std::fs::remove_dir_all(root);
    }
}
