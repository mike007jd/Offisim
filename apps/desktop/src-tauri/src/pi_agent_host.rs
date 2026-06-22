use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex as AsyncMutex;
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

/// Ask mode: live stdin writers for running Pi hosts, keyed by request id. While
/// a host pauses a tool awaiting the user's answer to a Pi extension-UI prompt,
/// `pi_agent_ui_response` looks the writer up here and writes a one-line response
/// back to the child's stdin. The entry is inserted when the run starts and
/// removed when it ends, which drops the last handle and closes the child's
/// stdin (EOF).
static PI_STDIN: Lazy<Mutex<HashMap<String, Arc<AsyncMutex<ChildStdin>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn pi_stdin_guard() -> std::sync::MutexGuard<'static, HashMap<String, Arc<AsyncMutex<ChildStdin>>>>
{
    PI_STDIN
        .lock()
        .unwrap_or_else(|_| panic!("pi_agent_host PI_STDIN poisoned"))
}

/// Wire-contract version negotiated with the bundled Node host via the `ready`
/// handshake. Must stay in lockstep with `PI_HOST_PROTOCOL_VERSION` in
/// scripts/pi-agent-host-wire.mjs; bump both when a line's required shape changes.
const PI_HOST_PROTOCOL_VERSION: u32 = 2;

/// Wire kinds the Rust bridge knows how to decode. A line with an unknown kind is
/// skipped (forward-compatible with newer hosts); a malformed line on a KNOWN kind
/// is surfaced as a protocol error rather than silently dropped.
const PI_KNOWN_WIRE_KINDS: &[&str] = &[
    "ready",
    "started",
    "messageDelta",
    "messageEnd",
    "tool",
    "uiRequest",
    "agentRun",
    "result",
    "error",
];

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
    /// Per-conversation permission mode (`plan` / `ask` / `auto` / `full`).
    /// Forwarded to the Node host, which turns it into Pi tool gating. Absent →
    /// host default.
    #[serde(default)]
    permission_mode: Option<String>,
    /// Per-conversation thinking level / reasoning effort (`off` / `minimal` /
    /// `low` / `medium` / `high` / `xhigh`). An opaque forwarded string — the
    /// Node host validates it and clamps it to the model's reasoning
    /// capabilities. Absent → host default.
    #[serde(default)]
    thinking_level: Option<String>,
    /// Employee persona forwarded as the Pi session's `appendSystemPrompt`. An
    /// opaque string the renderer builds from the saved employee profile; the
    /// host hands it to the resource loader. Absent → Pi uses its base prompt.
    #[serde(default)]
    system_prompt_append: Option<String>,
    /// Root run id for this user turn (the renderer's controller attemptId). The
    /// delegation supervisor stamps every child `agentRun` event with it so the
    /// renderer can graft children under the root. Absent → no delegation scope.
    #[serde(default)]
    root_run_id: Option<String>,
    /// Company roster (opaque, forwarded verbatim): each employee the root agent
    /// may delegate to, with persona / model / access / tools. Built renderer-side
    /// from `employees.findByCompany`; Rust does not interpret it.
    #[serde(default)]
    roster: Option<serde_json::Value>,
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
    reasoning: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    session_file: Option<String>,
    #[serde(default)]
    model: Option<PiModelSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
    UiRequest {
        id: String,
        method: String,
        title: String,
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        options: Option<Vec<String>>,
        #[serde(default)]
        placeholder: Option<String>,
        #[serde(default)]
        prefill: Option<String>,
    },
    AgentRun {
        thread_id: String,
        root_run_id: String,
        run_id: String,
        #[serde(default)]
        parent_run_id: Option<String>,
        #[serde(default)]
        employee_id: Option<String>,
        #[serde(default)]
        relation: Option<String>,
        #[serde(default)]
        work_kind: Option<String>,
        run_type: String,
        payload: serde_json::Value,
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
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum PiSidecarLine {
    Ready {
        protocol_version: u32,
    },
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
    UiRequest {
        id: String,
        method: String,
        title: String,
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        options: Option<Vec<String>>,
        #[serde(default)]
        placeholder: Option<String>,
        #[serde(default)]
        prefill: Option<String>,
    },
    AgentRun {
        thread_id: String,
        root_run_id: String,
        run_id: String,
        #[serde(default)]
        parent_run_id: Option<String>,
        #[serde(default)]
        employee_id: Option<String>,
        #[serde(default)]
        relation: Option<String>,
        #[serde(default)]
        work_kind: Option<String>,
        run_type: String,
        payload: serde_json::Value,
    },
    Result {
        response: serde_json::Value,
    },
    Error {
        code: String,
        message: String,
    },
}

impl PiSidecarLine {
    fn kind_name(&self) -> &'static str {
        match self {
            Self::Ready { .. } => "ready",
            Self::Started { .. } => "started",
            Self::MessageDelta { .. } => "messageDelta",
            Self::MessageEnd { .. } => "messageEnd",
            Self::Tool { .. } => "tool",
            Self::UiRequest { .. } => "uiRequest",
            Self::AgentRun { .. } => "agentRun",
            Self::Result { .. } => "result",
            Self::Error { .. } => "error",
        }
    }
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
        // `mode` is the host dispatch discriminator (execute vs status); the
        // permission mode rides under a distinct key so it cannot collide.
        "mode": "execute",
        "text": req.text,
        "cwd": cwd.to_string_lossy().to_string(),
        "sessionDir": session_dir.to_string_lossy().to_string(),
        "agentDir": app_pi_agent_dir(app).map(|path| path.to_string_lossy().to_string()),
        "model": req.model,
        "permissionMode": req.permission_mode,
        "thinkingLevel": req.thinking_level,
        "systemPromptAppend": req.system_prompt_append,
        // Delegation scope (Phase 1): the root run id + thread id let the host's
        // supervisor stamp child agentRun events, and the roster tells it which
        // employees the root agent may delegate to. All forwarded verbatim.
        "threadId": req.thread_id,
        "companyId": req.company_id,
        "rootRunId": req.root_run_id,
        "roster": req.roster,
    })
}

/// Write the execute/status payload as the FIRST newline-delimited line on the
/// child's stdin. The host reads this first line as its request; in Ask mode any
/// later lines are uiResponse records. stdin is left OPEN — the caller decides
/// whether to keep it (execute, for extension UI responses) or close it (status,
/// single-shot).
async fn write_payload(
    stdin: &mut ChildStdin,
    payload: &serde_json::Value,
) -> Result<(), HostError> {
    let mut payload_json = serde_json::to_vec(payload)
        .map_err(|err| HostError::Request(format!("Serialize Pi Agent payload: {err}")))?;
    payload_json.push(b'\n');
    stdin
        .write_all(&payload_json)
        .await
        .map_err(|err| HostError::Request(format!("Write Pi Agent payload: {err}")))?;
    stdin
        .flush()
        .await
        .map_err(|err| HostError::Request(format!("Flush Pi Agent payload: {err}")))?;
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
        // The handshake is consumed by the stream loop before this point; never forwarded.
        PiSidecarLine::Ready { .. } => Ok(None),
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
        PiSidecarLine::UiRequest {
            id,
            method,
            title,
            message,
            options,
            placeholder,
            prefill,
        } => {
            if let Some(on_event) = on_event {
                on_event
                    .send(PiAgentHostEvent::UiRequest {
                        id,
                        method,
                        title,
                        message,
                        options,
                        placeholder,
                        prefill,
                    })
                    .map_err(|err| HostError::Request(format!("Send Pi UI request: {err}")))?;
            }
            Ok(None)
        }
        PiSidecarLine::AgentRun {
            thread_id,
            root_run_id,
            run_id,
            parent_run_id,
            employee_id,
            relation,
            work_kind,
            run_type,
            payload,
        } => {
            if let Some(on_event) = on_event {
                on_event
                    .send(PiAgentHostEvent::AgentRun {
                        thread_id,
                        root_run_id,
                        run_id,
                        parent_run_id,
                        employee_id,
                        relation,
                        work_kind,
                        run_type,
                        payload,
                    })
                    .map_err(|err| HostError::Request(format!("Send Pi agent run event: {err}")))?;
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

/// Decode one JSONL line from the Pi host. Unknown wire kinds are skipped (so a
/// newer host that adds an event type does not abort the run), while a malformed
/// line on a KNOWN kind is surfaced as a protocol error instead of being lost.
fn decode_sidecar_line(raw: &str) -> Result<Option<PiSidecarLine>, HostError> {
    match serde_json::from_str::<PiSidecarLine>(raw) {
        Ok(line) => Ok(Some(line)),
        Err(strict_err) => {
            let kind = serde_json::from_str::<serde_json::Value>(raw)
                .ok()
                .and_then(|value| {
                    value
                        .get("kind")
                        .and_then(|kind| kind.as_str().map(str::to_owned))
                });
            match kind {
                Some(kind) if PI_KNOWN_WIRE_KINDS.contains(&kind.as_str()) => {
                    Err(HostError::Protocol(format!(
                        "Pi Agent host emitted a malformed \"{kind}\" line: {strict_err}; line: {raw}"
                    )))
                }
                Some(kind) => {
                    eprintln!(
                        "[pi-agent-host] skipping unknown wire kind \"{kind}\" (forward-compat); line: {raw}"
                    );
                    Ok(None)
                }
                None => Err(HostError::Protocol(format!(
                    "Pi Agent host returned invalid JSONL: {strict_err}; line: {raw}"
                ))),
            }
        }
    }
}

fn consume_ready_handshake(saw_ready: &mut bool, line: &PiSidecarLine) -> Result<bool, HostError> {
    if let PiSidecarLine::Ready { protocol_version } = line {
        if *protocol_version != PI_HOST_PROTOCOL_VERSION {
            return Err(HostError::Protocol(format!(
                "Pi Agent host protocol version {protocol_version} does not match runtime {PI_HOST_PROTOCOL_VERSION}; rebuild the bundled host (pnpm build:pi-agent-host)"
            )));
        }
        *saw_ready = true;
        return Ok(true);
    }
    if !*saw_ready {
        return Err(HostError::Protocol(format!(
            "Pi Agent host did not emit the required ready handshake before \"{}\"; rebuild the bundled host (pnpm build:pi-agent-host)",
            line.kind_name()
        )));
    }
    Ok(false)
}

/// Removes a request's live stdin writer from `PI_STDIN` on any exit path
/// (normal end, abort, error, panic), dropping the last handle → child EOF.
struct StdinGuard(Option<String>);

impl Drop for StdinGuard {
    fn drop(&mut self) {
        if let Some(id) = self.0.take() {
            pi_stdin_guard().remove(&id);
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
    register_stdin: Option<&str>,
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
    let mut stdin = child
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

    write_payload(&mut stdin, &payload).await?;
    // Execute runs keep stdin open as an extension UI response channel (Ask mode)
    // and register the writer; status runs are single-shot, so close stdin
    // immediately.
    let _stdin_guard = match register_stdin {
        Some(request_id) => {
            pi_stdin_guard().insert(request_id.to_string(), Arc::new(AsyncMutex::new(stdin)));
            StdinGuard(Some(request_id.to_string()))
        }
        None => {
            stdin
                .shutdown()
                .await
                .map_err(|err| HostError::Request(format!("Close Pi Agent stdin: {err}")))?;
            StdinGuard(None)
        }
    };
    let stderr_task = tokio::spawn(read_stderr(stderr));
    let mut lines = BufReader::new(stdout).lines();
    let mut final_response: Option<serde_json::Value> = None;
    let mut saw_ready = false;

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
                let Some(parsed) = decode_sidecar_line(trimmed)? else {
                    continue;
                };
                if consume_ready_handshake(&mut saw_ready, &parsed)? {
                    continue;
                }
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
) -> Result<PiAgentHostResponse, HostError> {
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
        Some(&req.request_id),
    )
    .await?;
    let response = parse_response(response)?;
    on_event
        .send(PiAgentHostEvent::Result {
            response: response.clone(),
        })
        .map_err(|err| HostError::Request(format!("Send Pi result event: {err}")))?;
    Ok(response)
}

#[tauri::command]
pub async fn pi_agent_execute(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    let request_id = req.request_id.clone();
    let token = IN_FLIGHT.register(&request_id);
    let result = do_execute(&app, req, &on_event, token.clone()).await;
    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(response) => Ok(response),
        Err(HostError::Aborted) => Ok(PiAgentHostResponse {
            text: String::new(),
            reasoning: None,
            session_id: None,
            session_file: None,
            model: None,
        }),
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

/// The renderer→host answer to a paused `uiRequest` (Ask mode). Mirrors Pi RPC's
/// `extension_ui_response`: `confirmed` answers a confirm, `value` answers a
/// select / input / editor, `cancelled` dismisses any of them. The field names
/// are pinned to camelCase by serde so the inbound channel stays in lockstep with
/// the host reader, the same way the outbound `PiSidecarLine` kinds are. Absent
/// fields are dropped so the host's `confirmed === true` / `cancelled` checks see
/// exactly what the renderer set.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiUiResponse {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    confirmed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancelled: Option<bool>,
}

/// Ask mode: deliver the user's answer to a paused Pi extension-UI prompt back to
/// the running host by writing a one-line response to its stdin. `request_id`
/// locates the run; `id` matches the host's `uiRequest`. A missing request id
/// means the run already ended (the answer is moot) — not an error.
#[tauri::command]
pub async fn pi_agent_ui_response(
    request_id: String,
    id: String,
    confirmed: Option<bool>,
    value: Option<String>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    let writer = pi_stdin_guard().get(&request_id).cloned();
    let Some(writer) = writer else {
        return Ok(());
    };
    let response = PiUiResponse {
        id,
        confirmed,
        value,
        cancelled,
    };
    let mut line = serde_json::to_string(&response)
        .map_err(|err| format!("Serialize Pi UI response: {err}"))?;
    line.push('\n');
    let mut stdin = writer.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|err| format!("Write Pi UI response: {err}"))?;
    stdin
        .flush()
        .await
        .map_err(|err| format!("Flush Pi UI response: {err}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pi_agent_open_config_folder(app: AppHandle) -> Result<(), String> {
    let dir = app_pi_agent_dir(&app)
        .ok_or_else(|| "Resolve Pi Agent config folder: home directory unavailable".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("Create Pi Agent config folder: {err}"))?;

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

    // Wire-contract guards. The Node host (scripts/tauri-pi-agent-host.entry.mjs) emits
    // camelCase keys and the renderer reads camelCase (desktop-agent-runtime.ts). The
    // `tag`/`rename_all` pair only renames variant tags, NOT struct-variant fields, so
    // without `rename_all_fields = "camelCase"` the required `tool_call_id`/`tool_name`
    // hard-fail decode on the first tool event (and optionals silently drop to None).
    // These round-trip tests are the gate that `harness:pi-agent-host` (status-only) lacked.
    #[test]
    fn pi_sidecar_tool_line_decodes_camel_case_wire() {
        let line = r#"{"kind":"tool","status":"started","toolCallId":"call_1","toolName":"bash","durationMs":12}"#;
        match serde_json::from_str::<PiSidecarLine>(line).expect("decode camelCase tool line") {
            PiSidecarLine::Tool {
                status,
                tool_call_id,
                tool_name,
                duration_ms,
                ..
            } => {
                assert_eq!(status, "started");
                assert_eq!(tool_call_id, "call_1");
                assert_eq!(tool_name, "bash");
                assert_eq!(duration_ms, Some(12));
            }
            other => panic!("expected Tool variant, got {other:?}"),
        }
    }

    #[test]
    fn pi_sidecar_started_line_decodes_camel_case_optionals() {
        let line = r#"{"kind":"started","sessionId":"s1","sessionFile":"/tmp/s1.json","modelFallbackMessage":"fell back"}"#;
        match serde_json::from_str::<PiSidecarLine>(line).expect("decode camelCase started line") {
            PiSidecarLine::Started {
                session_id,
                session_file,
                model_fallback_message,
                ..
            } => {
                assert_eq!(session_id.as_deref(), Some("s1"));
                assert_eq!(session_file.as_deref(), Some("/tmp/s1.json"));
                assert_eq!(model_fallback_message.as_deref(), Some("fell back"));
            }
            other => panic!("expected Started variant, got {other:?}"),
        }
    }

    #[test]
    fn pi_agent_host_event_serializes_camel_case_for_renderer() {
        let event = PiAgentHostEvent::Tool {
            status: "completed".into(),
            tool_call_id: "call_9".into(),
            tool_name: "write_file".into(),
            detail: None,
            duration_ms: Some(7),
        };
        let json = serde_json::to_string(&event).expect("serialize tool event");
        assert!(
            json.contains(r#""toolCallId":"call_9""#),
            "expected camelCase toolCallId, got: {json}"
        );
        assert!(
            json.contains(r#""toolName":"write_file""#),
            "expected camelCase toolName, got: {json}"
        );
        assert!(
            json.contains(r#""durationMs":7"#),
            "expected camelCase durationMs, got: {json}"
        );
        assert!(
            !json.contains("tool_call_id"),
            "snake_case key leaked to the renderer Channel: {json}"
        );
    }

    #[test]
    fn pi_sidecar_agent_run_line_round_trips_camel_case() {
        // Decode the neutral delegation envelope from camelCase wire, then
        // re-serialize the renderer-facing event and assert it stays camelCase
        // (incl. runType / rootRunId) with the opaque payload preserved.
        let line = r#"{"kind":"agentRun","threadId":"t1","rootRunId":"r1","runId":"c1","parentRunId":"r1","employeeId":"e1","relation":"delegate","workKind":"research","runType":"run.started","payload":{"objective":"scout","access":"read"}}"#;
        match serde_json::from_str::<PiSidecarLine>(line).expect("decode agentRun line") {
            PiSidecarLine::AgentRun {
                thread_id,
                root_run_id,
                run_id,
                relation,
                work_kind,
                run_type,
                payload,
                ..
            } => {
                assert_eq!(thread_id, "t1");
                assert_eq!(root_run_id, "r1");
                assert_eq!(run_id, "c1");
                assert_eq!(relation.as_deref(), Some("delegate"));
                assert_eq!(work_kind.as_deref(), Some("research"));
                assert_eq!(run_type, "run.started");
                assert_eq!(
                    payload.get("objective").and_then(|v| v.as_str()),
                    Some("scout")
                );
            }
            other => panic!("expected AgentRun variant, got {other:?}"),
        }

        let event = PiAgentHostEvent::AgentRun {
            thread_id: "t1".into(),
            root_run_id: "r1".into(),
            run_id: "c1".into(),
            parent_run_id: Some("r1".into()),
            employee_id: Some("e1".into()),
            relation: Some("delegate".into()),
            work_kind: Some("research".into()),
            run_type: "run.completed".into(),
            payload: serde_json::json!({ "status": "completed" }),
        };
        let json = serde_json::to_string(&event).expect("serialize agentRun event");
        assert!(
            json.contains(r#""rootRunId":"r1""#),
            "expected camelCase rootRunId, got: {json}"
        );
        assert!(
            json.contains(r#""workKind":"research""#),
            "expected camelCase workKind, got: {json}"
        );
        assert!(
            json.contains(r#""runType":"run.completed""#),
            "expected camelCase runType, got: {json}"
        );
        assert!(
            !json.contains("root_run_id") && !json.contains("run_type"),
            "snake_case key leaked to the renderer Channel: {json}"
        );
    }

    #[test]
    fn pi_ui_response_serializes_camel_case_for_host() {
        // The inbound response line the host reads must stay camelCase in lockstep
        // with `resolveUiResponse(JSON.parse(line))` in the host, and must DROP the
        // unset fields so the host's `confirmed === true` / `cancelled` checks see
        // exactly what the renderer set (a serialized `confirmed: null` would not
        // satisfy `=== true`, but an absent `value`/`cancelled` must stay absent).
        let line = serde_json::to_string(&PiUiResponse {
            id: "ui-1".into(),
            confirmed: Some(true),
            value: None,
            cancelled: None,
        })
        .expect("serialize ui response");
        assert!(
            line.contains(r#""id":"ui-1""#),
            "expected the request id, got: {line}"
        );
        assert!(
            line.contains(r#""confirmed":true"#),
            "expected confirmed flag, got: {line}"
        );
        assert!(
            !line.contains("value") && !line.contains("cancelled"),
            "unset response fields must be dropped, not serialized as null: {line}"
        );
    }

    #[test]
    fn pi_wire_fixture_decodes_across_languages() {
        // The SAME fixture is validated by scripts/check-pi-wire-contract.mjs on the
        // Node side, so the Node emitter and the Rust decoder cannot drift apart.
        let fixture_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../scripts/fixtures/pi-wire-contract.json"
        );
        let raw = std::fs::read_to_string(fixture_path)
            .unwrap_or_else(|err| panic!("read wire fixture {fixture_path}: {err}"));
        let lines: Vec<serde_json::Value> =
            serde_json::from_str(&raw).expect("fixture is a JSON array");
        assert!(!lines.is_empty(), "fixture must not be empty");

        let mut saw_ready = false;
        let mut saw_tool = false;
        for value in &lines {
            // Tie the Rust known-kinds list to the shared fixture. The JS gate proves the
            // fixture exercises every PI_WIRE_KINDS entry, so asserting each fixture kind is
            // in PI_KNOWN_WIRE_KINDS transitively catches Rust/Node kind-list drift (a kind
            // the Rust decoder would otherwise treat as unknown and silently skip).
            let kind = value
                .get("kind")
                .and_then(|kind| kind.as_str())
                .unwrap_or_else(|| panic!("fixture line missing a string kind: {value}"));
            assert!(
                PI_KNOWN_WIRE_KINDS.contains(&kind),
                "fixture kind \"{kind}\" is missing from PI_KNOWN_WIRE_KINDS (Rust and Node kind lists drifted)"
            );
            let decoded: PiSidecarLine = serde_json::from_value(value.clone())
                .unwrap_or_else(|err| panic!("decode fixture line {value}: {err}"));
            match decoded {
                PiSidecarLine::Ready { protocol_version } => {
                    saw_ready = true;
                    assert_eq!(
                        protocol_version, PI_HOST_PROTOCOL_VERSION,
                        "fixture ready handshake must match the runtime protocol version"
                    );
                }
                PiSidecarLine::Tool {
                    tool_call_id,
                    tool_name,
                    ..
                } => {
                    saw_tool = true;
                    assert!(!tool_call_id.is_empty());
                    assert!(!tool_name.is_empty());
                }
                _ => {}
            }
        }
        assert!(saw_ready, "fixture must exercise the ready handshake");
        assert!(saw_tool, "fixture must exercise a tool event");
    }

    #[test]
    fn decode_sidecar_line_skips_unknown_kind() {
        let line = r#"{"kind":"telemetry","foo":"bar"}"#;
        let decoded = decode_sidecar_line(line).expect("unknown kind is forward-compatible");
        assert!(
            decoded.is_none(),
            "unknown kind should be skipped, not decoded"
        );
    }

    #[test]
    fn decode_sidecar_line_surfaces_malformed_known_kind() {
        // A `tool` line missing the required toolName is a real contract break.
        let line = r#"{"kind":"tool","status":"started","toolCallId":"call_1"}"#;
        let err = decode_sidecar_line(line).expect_err("malformed known kind must error");
        assert!(matches!(err, HostError::Protocol(message) if message.contains("tool")));
    }

    #[test]
    fn decode_sidecar_line_validates_ready_handshake() {
        let line = format!(r#"{{"kind":"ready","protocolVersion":{PI_HOST_PROTOCOL_VERSION}}}"#);
        match decode_sidecar_line(&line)
            .expect("ready decodes")
            .expect("ready present")
        {
            PiSidecarLine::Ready { protocol_version } => {
                assert_eq!(protocol_version, PI_HOST_PROTOCOL_VERSION)
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn consume_ready_handshake_rejects_version_mismatch() {
        let mut saw_ready = false;
        let line = PiSidecarLine::Ready {
            protocol_version: PI_HOST_PROTOCOL_VERSION + 1,
        };
        let err = consume_ready_handshake(&mut saw_ready, &line)
            .expect_err("mismatched ready must error");
        assert!(
            matches!(err, HostError::Protocol(message) if message.contains("does not match runtime"))
        );
        assert!(!saw_ready);
    }

    #[test]
    fn consume_ready_handshake_requires_ready_before_business_event() {
        let mut saw_ready = false;
        let line: PiSidecarLine =
            serde_json::from_str(r#"{"kind":"result","response":{"ok":true,"text":"done"}}"#)
                .expect("decode result line");
        let err = consume_ready_handshake(&mut saw_ready, &line)
            .expect_err("business event before ready must error");
        assert!(
            matches!(err, HostError::Protocol(message) if message.contains("required ready handshake"))
        );
        assert!(!saw_ready);
    }

    #[test]
    fn pi_sidecar_line_kind_name_matches_wire_kind() {
        let line = r#"{"kind":"result","response":{"ok":true,"text":"done"}}"#;
        let decoded: PiSidecarLine = serde_json::from_str(line).expect("decode result line");
        assert_eq!(decoded.kind_name(), "result");
    }
}
