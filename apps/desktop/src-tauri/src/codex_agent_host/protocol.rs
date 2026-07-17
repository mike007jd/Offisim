use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex, Notify};

use crate::sidecar_stderr::{read_capped_line, MAX_SIDECAR_OUTPUT_BYTES};
use crate::task_workspace_binding::AuthorizedProcessCwd;

use super::manager::rfc3339_now;
use super::stream::{
    native_request_key, PendingInteraction, PendingInteractionKind, PendingUserInputQuestion,
    RunStream,
};
use super::types::CodexAgentHostEvent;

struct PendingRequest {
    method: String,
    sender: oneshot::Sender<Result<Value, String>>,
}

struct UserInputProjection {
    pending_questions: Vec<PendingUserInputQuestion>,
    questions: Vec<Value>,
    title: String,
    message: Option<String>,
    auto_resolution_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum StreamProjectionKind {
    AgentMessage { item_id: String },
    Reasoning,
    Plan,
    Tool { item_id: String, tool_name: String },
}

#[derive(Default)]
struct StreamTokenRedactor {
    pending: String,
    pending_credential_key: bool,
    redact_next_value: bool,
}

struct PendingStreamProjection {
    kind: StreamProjectionKind,
    redactor: StreamTokenRedactor,
}

impl StreamTokenRedactor {
    fn push(&mut self, delta: &str, codex_home: Option<&str>) -> String {
        self.pending.push_str(delta);
        let Some(flush_end) = self
            .pending
            .char_indices()
            .rev()
            .find(|(_, character)| character.is_whitespace())
            .map(|(index, character)| index + character.len_utf8())
        else {
            return String::new();
        };
        let complete = self.pending[..flush_end].to_string();
        self.pending.drain(..flush_end);
        self.project_complete_tokens(&complete, codex_home)
    }

    fn finish(mut self, codex_home: Option<&str>) -> String {
        let pending = std::mem::take(&mut self.pending);
        self.project_complete_tokens(&pending, codex_home)
    }

    fn project_complete_tokens(&mut self, value: &str, codex_home: Option<&str>) -> String {
        let mut projected = String::with_capacity(value.len());
        for segment in value.split_inclusive(char::is_whitespace) {
            let token_end = segment.find(char::is_whitespace).unwrap_or(segment.len());
            let (token, whitespace) = segment.split_at(token_end);
            projected.push_str(&self.project_token(token, codex_home));
            projected.push_str(whitespace);
        }
        projected
    }

    fn project_token(&mut self, token: &str, codex_home: Option<&str>) -> String {
        if token.is_empty() {
            return String::new();
        }

        if self.redact_next_value {
            if token_is_assignment_operator(token) {
                return token.to_string();
            }
            if token_is_bearer_marker(token) {
                // `Authorization: Bearer value` keeps the scheme readable while
                // retaining the sensitive-value state for the following token.
                return redact_sensitive_literals_with_home(token, codex_home);
            }
            self.redact_next_value = false;
            self.pending_credential_key = false;
            return "[secret-redacted]".into();
        }

        if self.pending_credential_key {
            self.pending_credential_key = false;
            if token_is_assignment_operator(token) {
                self.redact_next_value = true;
                return token.to_string();
            }
            if let Some(value) = leading_assignment_value(token) {
                if value.is_empty() {
                    self.redact_next_value = true;
                    return token.to_string();
                }
                if token_is_bearer_marker(value) {
                    self.redact_next_value = true;
                }
                return redact_assignment_value(token);
            }
        }

        if token_is_bearer_marker(token) {
            self.redact_next_value = true;
            return redact_sensitive_literals_with_home(token, codex_home);
        }

        if let Some(value) = inline_credential_assignment_value(token) {
            if value.is_empty() || token_is_bearer_marker(value) {
                self.redact_next_value = true;
            }
            return redact_sensitive_literals_with_home(token, codex_home);
        }

        if token_is_credential_key(token) {
            if token_ends_with_assignment_operator(token) {
                self.redact_next_value = true;
            } else {
                self.pending_credential_key = true;
            }
        }

        redact_sensitive_literals_with_home(token, codex_home)
    }
}

pub(super) const CODEX_APP_SERVER_VERSION: &str = "0.144.4";
pub(super) const CODEX_ADAPTER_ID: &str = "codex-app-server";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const NATIVE_THREAD_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(12);
const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_DETAIL_CHARS: usize = 4096;
const MIN_AUTO_RESOLUTION_MS: u64 = 60_000;
const MAX_AUTO_RESOLUTION_MS: u64 = 240_000;

pub(super) struct StartupCancellation {
    cancelled: AtomicBool,
    notify: Notify,
}

impl StartupCancellation {
    pub(super) fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }

    pub(super) fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::AcqRel) {
            self.notify.notify_waiters();
        }
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(super) async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        let notified = self.notify.notified();
        if self.is_cancelled() {
            return;
        }
        notified.await;
    }
}

#[derive(Debug, thiserror::Error)]
pub(super) enum CodexHostError {
    #[error("Codex CLI is unavailable.")]
    Unavailable,
    #[error("Codex CLI app-server could not start.")]
    Spawn,
    #[error("The Codex runtime protocol is incompatible with this Offisim build.")]
    Protocol,
    #[error("The Codex runtime did not respond in time.")]
    Timeout,
    #[error("{0}")]
    Request(String),
    #[error("Codex could not complete this request: {0}")]
    Upstream(String),
}

pub(super) struct CodexConnection {
    stdin: AsyncMutex<BufWriter<ChildStdin>>,
    child: AsyncMutex<Option<Child>>,
    pending: Mutex<HashMap<i64, PendingRequest>>,
    next_id: AtomicI64,
    alive: AtomicBool,
    process_group_id: Option<u32>,
    stream: Option<Arc<RunStream>>,
    workspace_root: Option<PathBuf>,
    codex_home_for_redaction: Mutex<Option<String>>,
    stream_projections: Mutex<HashMap<String, PendingStreamProjection>>,
}

impl CodexConnection {
    pub(super) async fn spawn(
        binary: &Path,
        process_cwd: Option<&AuthorizedProcessCwd>,
        fallback_cwd: &Path,
        stream: Option<Arc<RunStream>>,
        startup_cancellation: Option<&StartupCancellation>,
        isolated_home: Option<&Path>,
    ) -> Result<Arc<Self>, CodexHostError> {
        if startup_cancellation.is_some_and(StartupCancellation::is_cancelled) {
            return Err(CodexHostError::Request(
                "Codex request was stopped before native work started.".into(),
            ));
        }
        validate_binary(binary)?;
        let mut command = Command::new(binary);
        command.args(["app-server", "--stdio"]);
        if let Some(isolated_home) = isolated_home {
            configure_codex_process_env_with_home(
                &mut command,
                std::env::vars_os(),
                Some(isolated_home),
            )?;
        } else {
            configure_codex_process_env(&mut command, std::env::vars_os())?;
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        configure_process_group(&mut command);
        if let Some(process_cwd) = process_cwd {
            process_cwd
                .bind_command(&mut command)
                .map_err(|_| CodexHostError::Unavailable)?;
        } else {
            command.current_dir(fallback_cwd);
        }

        let mut child = command.spawn().map_err(|_| CodexHostError::Spawn)?;
        let process_group_id = child.id();
        let stdin = child.stdin.take().ok_or(CodexHostError::Spawn)?;
        let stdout = child.stdout.take().ok_or(CodexHostError::Spawn)?;
        let stderr = child.stderr.take().ok_or(CodexHostError::Spawn)?;
        let workspace_root = process_cwd.map(|scope| scope.cwd().to_path_buf());
        let connection = Arc::new(Self {
            stdin: AsyncMutex::new(BufWriter::new(stdin)),
            child: AsyncMutex::new(Some(child)),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicI64::new(1),
            alive: AtomicBool::new(true),
            process_group_id,
            stream,
            workspace_root,
            codex_home_for_redaction: Mutex::new(None),
            stream_projections: Mutex::new(HashMap::new()),
        });

        let stdout_connection = Arc::clone(&connection);
        tokio::spawn(async move {
            stdout_connection.read_stdout(stdout).await;
        });
        let stderr_connection = Arc::clone(&connection);
        tokio::spawn(async move {
            stderr_connection.drain_stderr(stderr).await;
        });

        let initialization = if let Some(cancellation) = startup_cancellation {
            tokio::select! {
                result = connection.initialize() => result,
                () = cancellation.cancelled() => Err(CodexHostError::Request(
                    "Codex request was stopped before native work started.".into(),
                )),
            }
        } else {
            connection.initialize().await
        };
        if let Err(error) = initialization {
            connection.terminate().await;
            return Err(error);
        }
        Ok(connection)
    }

    pub(super) fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    fn codex_home_for_redaction(&self) -> Option<String> {
        self.codex_home_for_redaction
            .lock()
            .unwrap_or_else(|_| panic!("codex home redaction mutex poisoned"))
            .clone()
    }

    fn project_stream_delta(
        &self,
        key: &str,
        kind: StreamProjectionKind,
        delta: &str,
    ) -> Result<Option<(StreamProjectionKind, String)>, CodexHostError> {
        let codex_home = self.codex_home_for_redaction();
        let mut projections = self
            .stream_projections
            .lock()
            .unwrap_or_else(|_| panic!("codex stream projection mutex poisoned"));
        let projection =
            projections
                .entry(key.to_string())
                .or_insert_with(|| PendingStreamProjection {
                    kind: kind.clone(),
                    redactor: StreamTokenRedactor::default(),
                });
        if projection.kind != kind {
            return Err(CodexHostError::Protocol);
        }
        let projected = projection.redactor.push(delta, codex_home.as_deref());
        Ok((!projected.is_empty()).then_some((kind, projected)))
    }

    fn finish_stream_projection(&self, key: &str) -> Option<(StreamProjectionKind, String)> {
        let codex_home = self.codex_home_for_redaction();
        let projection = self
            .stream_projections
            .lock()
            .unwrap_or_else(|_| panic!("codex stream projection mutex poisoned"))
            .remove(key)?;
        let projected = projection.redactor.finish(codex_home.as_deref());
        (!projected.is_empty()).then_some((projection.kind, projected))
    }

    fn finish_all_stream_projections(&self) -> Vec<(StreamProjectionKind, String)> {
        let codex_home = self.codex_home_for_redaction();
        let mut projections = std::mem::take(
            &mut *self
                .stream_projections
                .lock()
                .unwrap_or_else(|_| panic!("codex stream projection mutex poisoned")),
        )
        .into_iter()
        .collect::<Vec<_>>();
        projections.sort_by(|left, right| left.0.cmp(&right.0));
        projections
            .into_iter()
            .filter_map(|(_, projection)| {
                let projected = projection.redactor.finish(codex_home.as_deref());
                (!projected.is_empty()).then_some((projection.kind, projected))
            })
            .collect()
    }

    fn flush_item_stream_projection(
        &self,
        stream: &RunStream,
        item: &Map<String, Value>,
    ) -> Result<(), CodexHostError> {
        let item_type = required_string(item, "type")?;
        let item_id = required_string(item, "id")?;
        let key = match item_type {
            "agentMessage" => Some(format!("message:{item_id}")),
            "reasoning" => Some("reasoning".into()),
            "plan" => Some("plan".into()),
            "commandExecution" | "fileChange" | "mcpToolCall" => Some(format!("tool:{item_id}")),
            _ => None,
        };
        if let Some(projection) = key
            .as_deref()
            .and_then(|key| self.finish_stream_projection(key))
        {
            emit_stream_projection(stream, projection);
        }
        Ok(())
    }

    fn flush_all_stream_projections(&self, stream: &RunStream) {
        for projection in self.finish_all_stream_projections() {
            emit_stream_projection(stream, projection);
        }
    }

    async fn initialize(&self) -> Result<(), CodexHostError> {
        let result = self
            .request_with_timeout(
                "initialize",
                Some(json!({
                    "clientInfo": {
                        "name": "offisim",
                        "title": "Offisim",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {
                        "experimentalApi": true,
                        "requestAttestation": false,
                        "mcpServerOpenaiFormElicitation": false
                    }
                })),
                INITIALIZE_TIMEOUT,
            )
            .await?;
        let object = result.as_object().ok_or(CodexHostError::Protocol)?;
        required_string(object, "userAgent")?;
        let codex_home = required_string(object, "codexHome")?;
        required_string(object, "platformFamily")?;
        required_string(object, "platformOs")?;
        *self
            .codex_home_for_redaction
            .lock()
            .unwrap_or_else(|_| panic!("codex home redaction mutex poisoned")) =
            Some(codex_home.to_string());
        self.notify("initialized", json!({})).await
    }

    pub(super) async fn request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, CodexHostError> {
        self.request_with_timeout(method, Some(params), request_timeout(method))
            .await
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, CodexHostError> {
        if !self.is_alive() {
            return Err(CodexHostError::Unavailable);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|_| panic!("codex pending request mutex poisoned"))
            .insert(
                id,
                PendingRequest {
                    method: method.to_string(),
                    sender,
                },
            );
        let message = match params {
            Some(params) => json!({"method": method, "id": id, "params": params}),
            None => json!({"method": method, "id": id}),
        };
        if self.write_json(&message).await.is_err() {
            self.pending
                .lock()
                .unwrap_or_else(|_| panic!("codex pending request mutex poisoned"))
                .remove(&id);
            return Err(CodexHostError::Unavailable);
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(message))) => Err(CodexHostError::Upstream(message)),
            Ok(Err(_)) => Err(CodexHostError::Unavailable),
            Err(_) => {
                self.pending
                    .lock()
                    .unwrap_or_else(|_| panic!("codex pending request mutex poisoned"))
                    .remove(&id);
                Err(CodexHostError::Timeout)
            }
        }
    }

    pub(super) async fn notify(&self, method: &str, params: Value) -> Result<(), CodexHostError> {
        self.write_json(&json!({"method": method, "params": params}))
            .await
    }

    pub(super) async fn respond(&self, id: &Value, result: Value) -> Result<(), CodexHostError> {
        if !valid_request_id(id) {
            return Err(CodexHostError::Protocol);
        }
        self.write_json(&json!({"id": id, "result": result})).await
    }

    async fn respond_method_not_found(&self, id: &Value) -> Result<(), CodexHostError> {
        if !valid_request_id(id) {
            return Err(CodexHostError::Protocol);
        }
        self.write_json(&json!({
            "id": id,
            "error": {"code": -32601, "message": "Method not supported by this client"}
        }))
        .await
    }

    async fn write_json(&self, value: &Value) -> Result<(), CodexHostError> {
        let mut encoded = serde_json::to_vec(value).map_err(|_| CodexHostError::Protocol)?;
        if encoded.len() > MAX_SIDECAR_OUTPUT_BYTES {
            return Err(CodexHostError::Protocol);
        }
        encoded.push(b'\n');
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(&encoded)
            .await
            .map_err(|_| CodexHostError::Unavailable)?;
        stdin.flush().await.map_err(|_| CodexHostError::Unavailable)
    }

    async fn read_stdout(self: Arc<Self>, stdout: tokio::process::ChildStdout) {
        let mut reader = BufReader::new(stdout);
        loop {
            let line = match read_capped_line(&mut reader, MAX_SIDECAR_OUTPUT_BYTES).await {
                Ok(Some(line)) => line,
                Ok(None) => {
                    if !self.is_alive() {
                        break;
                    }
                    if self
                        .stream
                        .as_ref()
                        .is_some_and(|stream| stream.terminal_outcome().is_none())
                    {
                        self.fail_protocol("Codex runtime exited before the turn completed.");
                    } else {
                        self.fail_pending("Codex runtime closed its protocol stream.");
                    }
                    break;
                }
                Err(_) => {
                    if !self.is_alive() {
                        break;
                    }
                    self.fail_protocol("Codex runtime emitted an invalid protocol frame.");
                    break;
                }
            };
            if !self.is_alive() {
                break;
            }
            if line.iter().all(|byte| byte.is_ascii_whitespace()) {
                continue;
            }
            let value = match serde_json::from_slice::<Value>(&line) {
                Ok(Value::Object(object)) => Value::Object(object),
                _ => {
                    self.fail_protocol("Codex runtime emitted malformed JSONL.");
                    break;
                }
            };
            if let Err(error) = self.dispatch_message(value).await {
                if !self.is_alive() {
                    break;
                }
                self.fail_protocol(&error.to_string());
                break;
            }
        }
        self.alive.store(false, Ordering::Release);
    }

    async fn drain_stderr(self: Arc<Self>, stderr: tokio::process::ChildStderr) {
        let mut reader = BufReader::new(stderr);
        loop {
            match read_capped_line(&mut reader, MAX_SIDECAR_OUTPUT_BYTES).await {
                Ok(Some(_)) => {
                    // Deliberately discard raw stderr: native auth/session paths and
                    // upstream headers are not product diagnostics.
                }
                Ok(None) => break,
                Err(_) => {
                    self.fail_protocol("Codex runtime exceeded its diagnostic output limit.");
                    signal_process_group(self.process_group_id, libc::SIGKILL);
                    break;
                }
            }
        }
    }

    async fn dispatch_message(self: &Arc<Self>, value: Value) -> Result<(), CodexHostError> {
        let object = value.as_object().ok_or(CodexHostError::Protocol)?;
        let method = object.get("method").and_then(Value::as_str);
        let id = object.get("id");
        match (method, id) {
            (None, Some(id)) => self.dispatch_response(id, object),
            (Some(method), Some(id)) => self.dispatch_server_request(method, id, object).await,
            (Some(method), None) => self.dispatch_notification(method, object.get("params")),
            (None, None) => Err(CodexHostError::Protocol),
        }
    }

    fn dispatch_response(
        &self,
        id: &Value,
        object: &Map<String, Value>,
    ) -> Result<(), CodexHostError> {
        let id = id.as_i64().ok_or(CodexHostError::Protocol)?;
        let has_result = object.contains_key("result");
        let has_error = object.contains_key("error");
        if has_result == has_error {
            return Err(CodexHostError::Protocol);
        }
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|_| panic!("codex pending request mutex poisoned"))
            .remove(&id)
            .ok_or(CodexHostError::Protocol)?;
        let response: Result<Value, String> = if let Some(result) = object.get("result") {
            self.prime_stream_scope(&pending.method, result)?;
            Ok(result.clone())
        } else {
            let error = object
                .get("error")
                .and_then(Value::as_object)
                .ok_or(CodexHostError::Protocol)?;
            let code = error
                .get("code")
                .and_then(Value::as_i64)
                .ok_or(CodexHostError::Protocol)?;
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .ok_or(CodexHostError::Protocol)?;
            Err(format!(
                "{code}: {}",
                safe_message(message, self.codex_home_for_redaction().as_deref())
            ))
        };
        let _ = pending.sender.send(response);
        Ok(())
    }

    fn prime_stream_scope(&self, method: &str, result: &Value) -> Result<(), CodexHostError> {
        let Some(stream) = self.stream.as_ref() else {
            return Ok(());
        };
        let result = result.as_object().ok_or(CodexHostError::Protocol)?;
        match method {
            "thread/start" | "thread/resume" => {
                let thread = result
                    .get("thread")
                    .and_then(Value::as_object)
                    .ok_or(CodexHostError::Protocol)?;
                stream
                    .prime_native_thread(required_string(thread, "id")?)
                    .map_err(CodexHostError::Request)
            }
            "turn/start" => {
                let turn = result
                    .get("turn")
                    .and_then(Value::as_object)
                    .ok_or(CodexHostError::Protocol)?;
                stream
                    .prime_native_turn(required_string(turn, "id")?)
                    .map_err(CodexHostError::Request)
            }
            _ => Ok(()),
        }
    }

    async fn dispatch_server_request(
        self: &Arc<Self>,
        method: &str,
        id: &Value,
        object: &Map<String, Value>,
    ) -> Result<(), CodexHostError> {
        if !valid_request_id(id) {
            return Err(CodexHostError::Protocol);
        }
        if !matches!(
            method,
            "item/commandExecution/requestApproval"
                | "item/fileChange/requestApproval"
                | "item/permissions/requestApproval"
                | "item/tool/requestUserInput"
                | "mcpServer/elicitation/request"
                | "currentTime/read"
        ) {
            return self.respond_method_not_found(id).await;
        }
        let Some(stream) = self.stream.as_ref() else {
            if method == "currentTime/read" {
                return Err(CodexHostError::Protocol);
            }
            return self
                .respond(id, inactive_server_request_response(method))
                .await;
        };
        if stream.terminal_outcome().is_some() {
            if method == "currentTime/read" {
                return Err(CodexHostError::Protocol);
            }
            return self
                .respond(id, inactive_server_request_response(method))
                .await;
        }
        let params = object
            .get("params")
            .and_then(Value::as_object)
            .ok_or(CodexHostError::Protocol)?;
        if method == "item/tool/requestUserInput" {
            return self.dispatch_user_input_request(id, params, stream).await;
        }
        if method == "mcpServer/elicitation/request" {
            validate_mcp_elicitation_scope(params, stream)?;
            return self.respond(id, mcp_elicitation_cancel_response()).await;
        }
        if method == "currentTime/read" {
            validate_native_thread_scope(params, stream)?;
            return self.respond(id, current_time_response()?).await;
        }
        let kind = match method {
            "item/commandExecution/requestApproval" => PendingInteractionKind::Command,
            "item/fileChange/requestApproval" => PendingInteractionKind::FileChange,
            "item/permissions/requestApproval" => PendingInteractionKind::Permissions {
                requested_permissions: params
                    .get("permissions")
                    .cloned()
                    .ok_or(CodexHostError::Protocol)?,
            },
            _ => return self.respond_method_not_found(id).await,
        };
        let thread_id = required_string(params, "threadId")?.to_string();
        let turn_id = required_string(params, "turnId")?.to_string();
        let item_id = required_string(params, "itemId")?.to_string();
        params
            .get("startedAtMs")
            .and_then(Value::as_i64)
            .ok_or(CodexHostError::Protocol)?;
        validate_native_scope(stream, &thread_id, &turn_id)?;
        let approval_id = params
            .get("approvalId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let interaction_id = sha256_hex(
            format!(
                "{}\0{}\0{}\0{}\0{}",
                stream.snapshot().request_id,
                native_request_key(id),
                item_id,
                approval_id,
                method
            )
            .as_bytes(),
        );
        let codex_home = self.codex_home_for_redaction();
        let (title, message) = approval_copy(
            method,
            params,
            self.workspace_root.as_deref(),
            codex_home.as_deref(),
        );
        stream
            .insert_pending_interaction(
                interaction_id.clone(),
                native_request_key(id),
                PendingInteraction {
                    native_request_id: id.clone(),
                    kind,
                    thread_id,
                    turn_id,
                },
            )
            .map_err(CodexHostError::Request)?;
        stream.publish(CodexAgentHostEvent::UiRequest {
            id: interaction_id,
            method: "confirm".into(),
            title: title.clone(),
            message: message.clone(),
            params: Some(json!({
                "approvalKind": approval_kind(method),
                "title": title,
                "summary": message,
            })),
            options: None,
            placeholder: None,
            prefill: None,
        });
        Ok(())
    }

    async fn dispatch_user_input_request(
        self: &Arc<Self>,
        id: &Value,
        params: &Map<String, Value>,
        stream: &Arc<RunStream>,
    ) -> Result<(), CodexHostError> {
        let thread_id = required_string(params, "threadId")?.to_string();
        let turn_id = required_string(params, "turnId")?.to_string();
        let item_id = required_string(params, "itemId")?.to_string();
        validate_native_scope(stream, &thread_id, &turn_id)?;
        let codex_home = self.codex_home_for_redaction();
        let projection = match project_user_input_request(params, codex_home.as_deref()) {
            Ok(projection) => projection,
            Err(_) => {
                self.respond(id, json!({"answers": {}})).await?;
                return Ok(());
            }
        };
        let interaction_id = sha256_hex(
            format!(
                "{}\0{}\0{}\0item/tool/requestUserInput",
                stream.snapshot().request_id,
                native_request_key(id),
                item_id,
            )
            .as_bytes(),
        );
        stream
            .insert_pending_interaction(
                interaction_id.clone(),
                native_request_key(id),
                PendingInteraction {
                    native_request_id: id.clone(),
                    kind: PendingInteractionKind::UserInput {
                        questions: projection.pending_questions,
                    },
                    thread_id,
                    turn_id,
                },
            )
            .map_err(CodexHostError::Request)?;
        stream.publish(CodexAgentHostEvent::UiRequest {
            id: interaction_id.clone(),
            method: "requestUserInput".into(),
            title: projection.title,
            message: projection.message,
            params: Some(json!({
                "questions": projection.questions,
                "autoResolutionMs": projection.auto_resolution_ms,
            })),
            options: None,
            placeholder: None,
            prefill: None,
        });
        if let Some(timeout_ms) = projection.auto_resolution_ms {
            self.schedule_user_input_timeout(
                Arc::clone(stream),
                interaction_id,
                Duration::from_millis(timeout_ms),
            );
        }
        Ok(())
    }

    fn schedule_user_input_timeout(
        self: &Arc<Self>,
        stream: Arc<RunStream>,
        interaction_id: String,
        timeout: Duration,
    ) {
        let connection = Arc::downgrade(self);
        tokio::spawn(async move {
            tokio::time::sleep(timeout).await;
            let Some(interaction) = stream.take_pending_interaction(&interaction_id) else {
                return;
            };
            if !matches!(interaction.kind, PendingInteractionKind::UserInput { .. }) {
                return;
            }
            let Some(connection) = connection.upgrade() else {
                return;
            };
            if connection
                .respond(&interaction.native_request_id, json!({"answers": {}}))
                .await
                .is_err()
            {
                connection.fail_protocol("Codex user-input timeout response failed.");
                return;
            }
            stream.publish(CodexAgentHostEvent::UiRequestResolved {
                id: interaction_id,
                resolution: "timeout".into(),
            });
        });
    }

    fn dispatch_notification(
        &self,
        method: &str,
        params: Option<&Value>,
    ) -> Result<(), CodexHostError> {
        let Some(stream) = self.stream.as_ref() else {
            return Ok(());
        };
        if stream.terminal_outcome().is_some() {
            return Ok(());
        }
        let params = params
            .and_then(Value::as_object)
            .ok_or(CodexHostError::Protocol)?;
        match method {
            "item/started" | "item/completed" => {
                required_scope(params, stream)?;
                let timestamp_field = if method == "item/started" {
                    "startedAtMs"
                } else {
                    "completedAtMs"
                };
                params
                    .get(timestamp_field)
                    .and_then(Value::as_i64)
                    .ok_or(CodexHostError::Protocol)?;
                let item = params
                    .get("item")
                    .and_then(Value::as_object)
                    .ok_or(CodexHostError::Protocol)?;
                if method == "item/completed" {
                    self.flush_item_stream_projection(stream, item)?;
                }
                let codex_home = self.codex_home_for_redaction();
                project_item(
                    stream,
                    item,
                    method == "item/completed",
                    self.workspace_root.as_deref(),
                    codex_home.as_deref(),
                )?;
            }
            "item/agentMessage/delta" => {
                required_scope(params, stream)?;
                let item_id = required_string(params, "itemId")?;
                if let Some(projection) = self.project_stream_delta(
                    &format!("message:{item_id}"),
                    StreamProjectionKind::AgentMessage {
                        item_id: item_id.to_string(),
                    },
                    required_string(params, "delta")?,
                )? {
                    emit_stream_projection(stream, projection);
                }
            }
            "item/reasoning/summaryTextDelta" => {
                required_scope(params, stream)?;
                if let Some(projection) = self.project_stream_delta(
                    "reasoning",
                    StreamProjectionKind::Reasoning,
                    required_string(params, "delta")?,
                )? {
                    emit_stream_projection(stream, projection);
                }
            }
            "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" => {
                required_scope(params, stream)?;
                let item_id = required_string(params, "itemId")?;
                let delta = required_string(params, "delta")?;
                let tool_name = if method.contains("commandExecution") {
                    "bash"
                } else {
                    "file_change"
                };
                if let Some(projection) = self.project_stream_delta(
                    &format!("tool:{item_id}"),
                    StreamProjectionKind::Tool {
                        item_id: item_id.to_string(),
                        tool_name: tool_name.into(),
                    },
                    delta,
                )? {
                    emit_stream_projection(stream, projection);
                }
            }
            "item/mcpToolCall/progress" => {
                required_scope(params, stream)?;
                let item_id = required_string(params, "itemId")?;
                let message = required_string(params, "message")?;
                if let Some(projection) = self.project_stream_delta(
                    &format!("tool:{item_id}"),
                    StreamProjectionKind::Tool {
                        item_id: item_id.to_string(),
                        tool_name: "mcp".into(),
                    },
                    message,
                )? {
                    emit_stream_projection(stream, projection);
                }
            }
            "item/plan/delta" => {
                required_scope(params, stream)?;
                if let Some(projection) = self.project_stream_delta(
                    "plan",
                    StreamProjectionKind::Plan,
                    required_string(params, "delta")?,
                )? {
                    emit_stream_projection(stream, projection);
                }
            }
            "thread/tokenUsage/updated" => {
                let thread_id = required_string(params, "threadId")?;
                if stream.active_native_thread().as_deref() != Some(thread_id) {
                    return Err(CodexHostError::Protocol);
                }
                let turn_id = required_string(params, "turnId")?;
                if let Some((_, active_turn)) = stream.active_native_scope() {
                    if active_turn != turn_id {
                        return Err(CodexHostError::Protocol);
                    }
                }
                let native_usage = params.get("tokenUsage").ok_or(CodexHostError::Protocol)?;
                let usage = project_token_usage(native_usage)?;
                stream.set_usage(usage);
            }
            "model/rerouted" => {
                required_scope(params, stream)?;
                required_string(params, "fromModel")?;
                required_string(params, "toModel")?;
            }
            "serverRequest/resolved" => {
                let thread_id = required_string(params, "threadId")?;
                if stream.active_native_thread().as_deref() != Some(thread_id) {
                    return Err(CodexHostError::Protocol);
                }
                let request_id = params.get("requestId").ok_or(CodexHostError::Protocol)?;
                if !valid_request_id(request_id) {
                    return Err(CodexHostError::Protocol);
                }
                if let Some((interaction_id, _)) = stream.resolve_native_request(request_id) {
                    stream.publish(CodexAgentHostEvent::UiRequestResolved {
                        id: interaction_id,
                        resolution: "native".into(),
                    });
                }
            }
            "error" => {
                required_scope(params, stream)?;
                let will_retry = params
                    .get("willRetry")
                    .and_then(Value::as_bool)
                    .ok_or(CodexHostError::Protocol)?;
                let message = params
                    .get("error")
                    .and_then(Value::as_object)
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .map(|message| {
                        safe_message(message, self.codex_home_for_redaction().as_deref())
                    })
                    .unwrap_or_else(|| "Codex reported an upstream error.".into());
                stream.publish(CodexAgentHostEvent::MessageDelta {
                    delta: if will_retry {
                        format!("{message} Retrying…")
                    } else {
                        message
                    },
                    channel: Some("commentary".into()),
                });
            }
            "turn/completed" => {
                let turn = params
                    .get("turn")
                    .and_then(Value::as_object)
                    .ok_or(CodexHostError::Protocol)?;
                let turn_id = required_string(turn, "id")?;
                let (active_thread, active_turn) = stream
                    .active_native_scope()
                    .ok_or(CodexHostError::Protocol)?;
                if active_turn != turn_id {
                    return Err(CodexHostError::Protocol);
                }
                if let Some(thread_id) = params.get("threadId").and_then(Value::as_str) {
                    if thread_id != active_thread {
                        return Err(CodexHostError::Protocol);
                    }
                }
                self.flush_all_stream_projections(stream);
                match required_string(turn, "status")? {
                    "completed" => {
                        stream.finish_completed().ok_or(CodexHostError::Protocol)?;
                    }
                    "interrupted" => {
                        stream.finish_interrupted("Codex turn was interrupted.");
                    }
                    "failed" => {
                        let message = turn
                            .get("error")
                            .and_then(Value::as_object)
                            .and_then(|error| error.get("message"))
                            .and_then(Value::as_str)
                            .map(|message| {
                                safe_message(message, self.codex_home_for_redaction().as_deref())
                            })
                            .unwrap_or_else(|| "Codex turn failed.".into());
                        stream.finish_failed("codex_turn_failed", message);
                    }
                    _ => return Err(CodexHostError::Protocol),
                }
            }
            "turn/started"
            | "thread/started"
            | "thread/status/changed"
            | "turn/diff/updated"
            | "turn/plan/updated"
            | "thread/compacted"
            | "item/reasoning/summaryPartAdded"
            | "item/reasoning/textDelta"
            | "item/fileChange/patchUpdated"
            | "item/autoApprovalReview/started"
            | "item/autoApprovalReview/completed"
            | "model/verification"
            | "model/safetyBuffering/updated" => {
                // Known additive projections. Authoritative item/turn messages above
                // carry the product state, so these are intentionally not replayed.
            }
            _ => {
                // Unknown notifications are forward compatible; unknown requests are
                // rejected separately because they require an exact response schema.
            }
        }
        Ok(())
    }

    fn fail_protocol(&self, _diagnostic: &str) {
        self.alive.store(false, Ordering::Release);
        self.fail_pending("Codex runtime protocol failed.");
        if let Some(stream) = self.stream.as_ref() {
            self.flush_all_stream_projections(stream);
            stream.finish_failed(
                "codex_protocol_error",
                "The Codex runtime protocol became unavailable.",
            );
        }
        signal_process_group(self.process_group_id, libc::SIGKILL);
    }

    fn fail_pending(&self, message: &str) {
        let pending = std::mem::take(
            &mut *self
                .pending
                .lock()
                .unwrap_or_else(|_| panic!("codex pending request mutex poisoned")),
        );
        for (_, pending) in pending {
            let _ = pending.sender.send(Err(message.to_string()));
        }
    }

    pub(super) async fn terminate(&self) {
        let was_alive = self.alive.swap(false, Ordering::AcqRel);
        if let Some(stream) = self.stream.as_ref() {
            self.flush_all_stream_projections(stream);
        }
        if was_alive {
            signal_process_group(self.process_group_id, libc::SIGTERM);
        }
        let mut child = self.child.lock().await;
        let Some(mut child) = child.take() else {
            return;
        };
        let reaped = matches!(
            tokio::time::timeout(GRACEFUL_SHUTDOWN_TIMEOUT, child.wait()).await,
            Ok(Ok(_))
        );
        if !reaped {
            signal_process_group(self.process_group_id, libc::SIGKILL);
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        self.fail_pending("Codex runtime stopped.");
    }
}

fn request_timeout(method: &str) -> Duration {
    match method {
        // Starting or reopening a native thread loads the user's real Codex
        // instruction and plugin catalog. A cold profile can legitimately take
        // longer than the normal RPC budget; Stop still terminates the managed
        // child immediately instead of waiting for this deadline.
        "thread/start" | "thread/resume" => NATIVE_THREAD_REQUEST_TIMEOUT,
        _ => REQUEST_TIMEOUT,
    }
}

fn configure_codex_process_env<I>(
    command: &mut Command,
    environment: I,
) -> Result<(), CodexHostError>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    configure_codex_process_env_with_home(command, environment, None)
}

fn configure_codex_process_env_with_home<I>(
    command: &mut Command,
    environment: I,
    isolated_home: Option<&Path>,
) -> Result<(), CodexHostError>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let mut allowed = environment
        .into_iter()
        .filter(|(key, _)| codex_env_key_is_allowed(key))
        .collect::<Vec<_>>();
    let original_home = allowed
        .iter()
        .find(|(key, value)| key == OsStr::new("HOME") && !value.is_empty())
        .map(|(_, value)| PathBuf::from(value));
    let Some(original_home) = original_home else {
        return Err(CodexHostError::Unavailable);
    };
    if let Some(isolated_home) = isolated_home {
        if !allowed
            .iter()
            .any(|(key, value)| key == OsStr::new("CODEX_HOME") && !value.is_empty())
        {
            allowed.push((
                OsString::from("CODEX_HOME"),
                original_home.join(".codex").into_os_string(),
            ));
        }
        allowed.retain(|(key, _)| key != OsStr::new("HOME"));
        allowed.push((
            OsString::from("HOME"),
            isolated_home.as_os_str().to_os_string(),
        ));
    }
    command.env_clear();
    command.envs(allowed);
    Ok(())
}

fn codex_env_key_is_allowed(key: &OsStr) -> bool {
    let Some(key) = key.to_str() else {
        return false;
    };
    let upper = key.to_ascii_uppercase();
    if [
        "TOKEN",
        "SECRET",
        "COOKIE",
        "PASSWORD",
        "API_KEY",
        "APIKEY",
        "AUTHORIZATION",
        "CREDENTIAL",
    ]
    .iter()
    .any(|marker| upper.contains(marker))
    {
        return false;
    }
    matches!(
        upper.as_str(),
        "HOME"
            | "USER"
            | "PATH"
            | "TMPDIR"
            | "SHELL"
            | "LANG"
            | "CODEX_HOME"
            | "SSH_AUTH_SOCK"
            | "LC_ALL"
            | "LC_CTYPE"
            | "LC_NUMERIC"
            | "LC_TIME"
            | "LC_COLLATE"
            | "LC_MONETARY"
            | "LC_MESSAGES"
            | "LC_PAPER"
            | "LC_NAME"
            | "LC_ADDRESS"
            | "LC_TELEPHONE"
            | "LC_MEASUREMENT"
            | "LC_IDENTIFICATION"
    )
}

fn validate_binary(binary: &Path) -> Result<(), CodexHostError> {
    let metadata = std::fs::metadata(binary).map_err(|_| CodexHostError::Unavailable)?;
    if !metadata.is_file() {
        return Err(CodexHostError::Unavailable);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(CodexHostError::Unavailable);
        }
    }
    Ok(())
}

fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
}

#[cfg(unix)]
fn signal_process_group(process_group_id: Option<u32>, signal: i32) {
    if let Some(pid) = process_group_id {
        // SAFETY: every child is launched into a dedicated process group above.
        unsafe {
            libc::kill(-(pid as i32), signal);
        }
    }
}

#[cfg(not(unix))]
fn signal_process_group(_process_group_id: Option<u32>, _signal: i32) {}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
) -> Result<&'a str, CodexHostError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(CodexHostError::Protocol)
}

fn valid_request_id(value: &Value) -> bool {
    value.as_str().is_some() || value.as_i64().is_some()
}

fn required_scope(params: &Map<String, Value>, stream: &RunStream) -> Result<(), CodexHostError> {
    let thread_id = required_string(params, "threadId")?;
    let turn_id = required_string(params, "turnId")?;
    validate_native_scope(stream, thread_id, turn_id)
}

fn validate_native_scope(
    stream: &RunStream,
    thread_id: &str,
    turn_id: &str,
) -> Result<(), CodexHostError> {
    let (active_thread, active_turn) = stream
        .active_native_scope()
        .ok_or(CodexHostError::Protocol)?;
    if active_thread == thread_id && active_turn == turn_id {
        Ok(())
    } else {
        Err(CodexHostError::Protocol)
    }
}

fn validate_mcp_elicitation_scope(
    params: &Map<String, Value>,
    stream: &RunStream,
) -> Result<(), CodexHostError> {
    let thread_id = required_string(params, "threadId")?;
    if stream.active_native_thread().as_deref() != Some(thread_id) {
        return Err(CodexHostError::Protocol);
    }
    match params.get("turnId") {
        None | Some(Value::Null) => Ok(()),
        Some(Value::String(turn_id)) => {
            if stream
                .active_native_scope()
                .is_some_and(|(_, active_turn)| active_turn == *turn_id)
            {
                Ok(())
            } else {
                Err(CodexHostError::Protocol)
            }
        }
        Some(_) => Err(CodexHostError::Protocol),
    }
}

fn validate_native_thread_scope(
    params: &Map<String, Value>,
    stream: &RunStream,
) -> Result<(), CodexHostError> {
    let thread_id = required_string(params, "threadId")?;
    if stream.active_native_thread().as_deref() == Some(thread_id) {
        Ok(())
    } else {
        Err(CodexHostError::Protocol)
    }
}

fn project_user_input_request(
    params: &Map<String, Value>,
    codex_home: Option<&str>,
) -> Result<UserInputProjection, CodexHostError> {
    let questions = params
        .get("questions")
        .and_then(Value::as_array)
        .filter(|questions| !questions.is_empty() && questions.len() <= 3)
        .ok_or(CodexHostError::Protocol)?;
    let mut question_ids = HashSet::new();
    let mut pending_questions = Vec::with_capacity(questions.len());
    let mut projected_questions = Vec::with_capacity(questions.len());
    for question in questions {
        let question = question.as_object().ok_or(CodexHostError::Protocol)?;
        let id = required_string(question, "id")?;
        if !question_ids.insert(id.to_string()) {
            return Err(CodexHostError::Protocol);
        }
        let header = safe_prompt_text(required_string(question, "header")?, codex_home);
        let prompt = safe_prompt_text(required_string(question, "question")?, codex_home);
        let is_other = optional_bool(question, "isOther")?;
        let is_secret = optional_bool(question, "isSecret")?;
        let options = match question.get("options") {
            None | Some(Value::Null) => None,
            Some(Value::Array(options)) if !options.is_empty() && options.len() <= 3 => Some(
                options
                    .iter()
                    .map(|option| {
                        let option = option.as_object().ok_or(CodexHostError::Protocol)?;
                        Ok(json!({
                            "label": safe_prompt_text(required_string(option, "label")?, codex_home),
                            "description": safe_prompt_text(required_string(option, "description")?, codex_home),
                        }))
                    })
                    .collect::<Result<Vec<_>, CodexHostError>>()?,
            ),
            Some(_) => return Err(CodexHostError::Protocol),
        };
        pending_questions.push(PendingUserInputQuestion { id: id.to_string() });
        projected_questions.push(json!({
            "id": id,
            "header": header,
            "question": prompt,
            "isOther": is_other,
            "isSecret": is_secret,
            "options": options,
        }));
    }
    let auto_resolution_ms = match params.get("autoResolutionMs") {
        None | Some(Value::Null) => None,
        Some(Value::Number(value)) => value
            .as_u64()
            .filter(|value| (MIN_AUTO_RESOLUTION_MS..=MAX_AUTO_RESOLUTION_MS).contains(value))
            .ok_or(CodexHostError::Protocol)
            .map(Some)?,
        Some(_) => return Err(CodexHostError::Protocol),
    };
    let title = if projected_questions.len() == 1 {
        projected_questions[0]["header"]
            .as_str()
            .unwrap_or("Codex needs input")
            .to_string()
    } else {
        "Codex needs input".into()
    };
    let message = if projected_questions.len() == 1 {
        projected_questions[0]["question"]
            .as_str()
            .map(str::to_string)
    } else {
        Some(format!(
            "Answer {} questions to continue.",
            projected_questions.len()
        ))
    };
    Ok(UserInputProjection {
        pending_questions,
        questions: projected_questions,
        title,
        message,
        auto_resolution_ms,
    })
}

fn optional_bool(object: &Map<String, Value>, field: &str) -> Result<bool, CodexHostError> {
    match object.get(field) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(CodexHostError::Protocol),
    }
}

fn safe_prompt_text(value: &str, codex_home: Option<&str>) -> String {
    truncate(&redact_sensitive_literals_with_home(value, codex_home))
}

/// Model-authored text is a persisted product projection, not a trusted
/// diagnostic channel. Redact before both streaming and completed-item storage
/// so a model cannot echo a native token or Agent Home path into Offisim DB.
fn safe_model_text(value: &str, codex_home: Option<&str>) -> String {
    redact_sensitive_literals_with_home(value, codex_home)
}

fn mcp_elicitation_cancel_response() -> Value {
    json!({"action": "cancel", "content": null})
}

fn current_time_response() -> Result<Value, CodexHostError> {
    let current_time_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| CodexHostError::Unavailable)?
        .as_secs();
    Ok(json!({"currentTimeAt": current_time_at}))
}

fn inactive_server_request_response(method: &str) -> Value {
    match method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            json!({"decision": "cancel"})
        }
        "item/permissions/requestApproval" => json!({"permissions": {}, "scope": "turn"}),
        "item/tool/requestUserInput" => json!({"answers": {}}),
        "mcpServer/elicitation/request" => mcp_elicitation_cancel_response(),
        _ => unreachable!("caller filters unsupported server requests"),
    }
}

fn project_item(
    stream: &RunStream,
    item: &Map<String, Value>,
    completed: bool,
    workspace_root: Option<&Path>,
    codex_home: Option<&str>,
) -> Result<(), CodexHostError> {
    let item_type = required_string(item, "type")?;
    let item_id = required_string(item, "id")?;
    if item_type == "agentMessage" {
        let phase = item.get("phase").and_then(Value::as_str);
        stream.record_item_phase(item_id, phase);
        if completed {
            let text = safe_model_text(required_string(item, "text")?, codex_home);
            stream.set_completed_message(item_id, &text);
        }
        return Ok(());
    }
    if item_type == "reasoning" || item_type == "userMessage" || item_type == "hookPrompt" {
        return Ok(());
    }
    let (tool_name, detail, duration_ms, status) = match item_type {
        "commandExecution" => (
            "bash".to_string(),
            item.get("command")
                .and_then(Value::as_str)
                .map(|value| safe_command_detail(value, codex_home)),
            item.get("durationMs").and_then(Value::as_u64),
            item.get("status")
                .and_then(Value::as_str)
                .unwrap_or(if completed { "completed" } else { "inProgress" })
                .to_string(),
        ),
        "fileChange" => {
            let paths = item
                .get("changes")
                .and_then(Value::as_array)
                .map(|changes| {
                    changes
                        .iter()
                        .filter_map(|change| {
                            change.get("path").and_then(Value::as_str).and_then(|path| {
                                safe_workspace_path(path, workspace_root, codex_home)
                            })
                        })
                        .take(8)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .filter(|value| !value.is_empty());
            (
                "file_change".to_string(),
                paths,
                None,
                item.get("status")
                    .and_then(Value::as_str)
                    .unwrap_or(if completed { "completed" } else { "inProgress" })
                    .to_string(),
            )
        }
        "mcpToolCall" => {
            let server = item.get("server").and_then(Value::as_str).unwrap_or("MCP");
            let tool = item.get("tool").and_then(Value::as_str).unwrap_or("tool");
            (
                "mcp".to_string(),
                Some(safe_tool_delta(&format!("{server} · {tool}"), codex_home)),
                item.get("durationMs").and_then(Value::as_u64),
                item.get("status")
                    .and_then(Value::as_str)
                    .unwrap_or(if completed { "completed" } else { "inProgress" })
                    .to_string(),
            )
        }
        "dynamicToolCall" => (
            item.get("tool")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "dynamic_tool".into()),
            item.get("namespace")
                .and_then(Value::as_str)
                .map(|value| safe_tool_delta(value, codex_home)),
            item.get("durationMs").and_then(Value::as_u64),
            item.get("status")
                .and_then(Value::as_str)
                .unwrap_or(if completed { "completed" } else { "inProgress" })
                .to_string(),
        ),
        "webSearch" => (
            "web_search".to_string(),
            item.get("query")
                .and_then(Value::as_str)
                .map(|value| safe_tool_delta(value, codex_home)),
            None,
            if completed { "completed" } else { "inProgress" }.into(),
        ),
        "imageView" => (
            "image_view".to_string(),
            item.get("path")
                .and_then(Value::as_str)
                .and_then(|path| safe_workspace_path(path, workspace_root, codex_home)),
            None,
            if completed { "completed" } else { "inProgress" }.into(),
        ),
        "collabAgentToolCall" => (
            "delegate".to_string(),
            item.get("tool")
                .and_then(Value::as_str)
                .map(|value| safe_tool_delta(value, codex_home)),
            None,
            item.get("status")
                .and_then(Value::as_str)
                .unwrap_or(if completed { "completed" } else { "inProgress" })
                .to_string(),
        ),
        "subAgentActivity" => (
            "subagent".to_string(),
            item.get("kind")
                .and_then(Value::as_str)
                .map(|value| safe_tool_delta(value, codex_home)),
            None,
            if completed { "completed" } else { "inProgress" }.into(),
        ),
        "contextCompaction" => (
            "context_compaction".to_string(),
            None,
            None,
            if completed { "completed" } else { "inProgress" }.into(),
        ),
        "plan" => {
            if completed {
                let text = safe_model_text(required_string(item, "text")?, codex_home);
                stream.set_completed_plan(&text);
            }
            return Ok(());
        }
        "enteredReviewMode" | "exitedReviewMode" | "sleep" | "imageGeneration" => return Ok(()),
        _ => return Ok(()),
    };
    stream.publish(CodexAgentHostEvent::Tool {
        status: normalize_tool_status(&status, completed).into(),
        tool_call_id: item_id.to_string(),
        tool_name,
        detail,
        duration_ms,
    });
    Ok(())
}

fn normalize_tool_status(status: &str, completed: bool) -> &'static str {
    match status {
        "completed" => "completed",
        "failed" => "failed",
        "declined" | "cancelled" | "canceled" => "failed",
        _ if completed => "completed",
        _ => "started",
    }
}

fn approval_copy(
    method: &str,
    params: &Map<String, Value>,
    workspace_root: Option<&Path>,
    codex_home: Option<&str>,
) -> (String, Option<String>) {
    let reason = params
        .get("reason")
        .and_then(Value::as_str)
        .map(|value| safe_message(value, codex_home));
    match method {
        "item/commandExecution/requestApproval" => {
            let command = params
                .get("command")
                .and_then(Value::as_str)
                .map(|value| safe_command_detail(value, codex_home));
            ("Approve command?".into(), combine_detail(reason, command))
        }
        "item/fileChange/requestApproval" => (
            "Approve file changes?".into(),
            reason.or_else(|| Some("Codex requested permission to change Project files.".into())),
        ),
        "item/permissions/requestApproval" => {
            let cwd = params
                .get("cwd")
                .and_then(Value::as_str)
                .and_then(|path| safe_workspace_path(path, workspace_root, codex_home));
            (
                "Approve additional permissions?".into(),
                combine_detail(reason, cwd),
            )
        }
        _ => ("Approval needed".into(), reason),
    }
}

fn approval_kind(method: &str) -> &'static str {
    match method {
        "item/commandExecution/requestApproval" => "command",
        "item/fileChange/requestApproval" => "fileChange",
        "item/permissions/requestApproval" => "permissions",
        _ => "unknown",
    }
}

fn combine_detail(left: Option<String>, right: Option<String>) -> Option<String> {
    match (left, right) {
        (Some(left), Some(right)) => Some(format!("{left}\n\n{right}")),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn safe_workspace_path(
    raw: &str,
    workspace_root: Option<&Path>,
    codex_home: Option<&str>,
) -> Option<String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Some(safe_tool_delta(raw, codex_home));
    }
    let root = workspace_root?;
    path.strip_prefix(root)
        .ok()
        .map(|relative| format!("./{}", relative.display()))
        .map(|value| safe_tool_delta(&value, codex_home))
}

fn truncate(value: &str) -> String {
    let mut output = value.chars().take(MAX_DETAIL_CHARS).collect::<String>();
    if value.chars().count() > MAX_DETAIL_CHARS {
        output.push('…');
    }
    output
}

fn safe_message(value: &str, codex_home: Option<&str>) -> String {
    truncate(&redact_sensitive_literals_with_home(value, codex_home))
}

fn redact_sensitive_literals_with_home(value: &str, codex_home: Option<&str>) -> String {
    static URL_CREDENTIALS: OnceLock<Regex> = OnceLock::new();
    static SECRET_TOKEN: OnceLock<Regex> = OnceLock::new();
    static JWT_TOKEN: OnceLock<Regex> = OnceLock::new();
    static BEARER_TOKEN: OnceLock<Regex> = OnceLock::new();
    static CREDENTIAL_ASSIGNMENT: OnceLock<Regex> = OnceLock::new();
    static NATIVE_AGENT_HOME_PATH: OnceLock<Regex> = OnceLock::new();
    static CODEX_HOME_ASSIGNMENT: OnceLock<Regex> = OnceLock::new();
    let url_credentials = URL_CREDENTIALS.get_or_init(|| {
        Regex::new(r"(?i)\b([a-z][a-z0-9+.-]*://)([^/\s@]+)@").expect("static URL credential regex")
    });
    let secret_token = SECRET_TOKEN.get_or_init(|| {
        Regex::new(
            r"(?i)\b(?:sk-(?:proj-)?[a-z0-9_-]{6,}|github_pat_[a-z0-9_]{12,}|(?:ghp|gho|ghu|ghs|ghr)_[a-z0-9]{12,}|xox[baprs]-[a-z0-9-]{8,})\b",
        )
        .expect("static secret token regex")
    });
    let jwt_token = JWT_TOKEN.get_or_init(|| {
        Regex::new(r"\beyJ[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9_-]{4,}(?:\.[a-zA-Z0-9_-]{4,})?\b")
            .expect("static JWT regex")
    });
    let bearer_token = BEARER_TOKEN.get_or_init(|| {
        Regex::new(r"(?i)\b(Bearer\s+)[a-z0-9._~+/-]+=?").expect("static Bearer token regex")
    });
    let credential_assignment = CREDENTIAL_ASSIGNMENT.get_or_init(|| {
        Regex::new(
            r#"(?i)((?:["']?[a-z0-9_-]*(?:api[_-]?key|token|secret|password|cookie|authorization)[a-z0-9_-]*["']?)\s*[:=]\s*["']?)([^"',\s}\]]+)"#,
        )
        .expect("static credential assignment regex")
    });
    let native_agent_home_path = NATIVE_AGENT_HOME_PATH.get_or_init(|| {
        Regex::new(
            r#"(?i)(?:/Users/[^/\s\"'`]+|/home/[^/\s\"'`]+)[/\\]\.codex(?:[/\\][^\s\"'`<>]*)?"#,
        )
        .expect("static native Agent Home path regex")
    });
    let codex_home_assignment = CODEX_HOME_ASSIGNMENT.get_or_init(|| {
        Regex::new(r#"(?i)\b(CODEX_HOME\s*[:=]\s*[\"']?)([^\"',\s}\]]+)"#)
            .expect("static CODEX_HOME assignment regex")
    });
    let exact_home_redacted = codex_home.filter(|home| !home.is_empty()).map_or_else(
        || value.to_string(),
        |home| value.replace(home, "[native-agent-home-redacted]"),
    );
    let without_url_credentials =
        url_credentials.replace_all(&exact_home_redacted, "${1}[credentials-redacted]@");
    let without_bearer =
        bearer_token.replace_all(&without_url_credentials, "${1}[secret-redacted]");
    let without_jwt = jwt_token.replace_all(&without_bearer, "[secret-redacted]");
    let without_assignments =
        credential_assignment.replace_all(&without_jwt, "${1}[secret-redacted]");
    let without_codex_home =
        codex_home_assignment.replace_all(&without_assignments, "${1}[native-agent-home-redacted]");
    let without_native_agent_home =
        native_agent_home_path.replace_all(&without_codex_home, "[native-agent-home-redacted]");
    secret_token
        .replace_all(&without_native_agent_home, "[secret-redacted]")
        .into_owned()
}

fn safe_command_detail(value: &str, codex_home: Option<&str>) -> String {
    safe_message(value, codex_home)
}

fn safe_tool_delta(value: &str, codex_home: Option<&str>) -> String {
    safe_message(value, codex_home)
}

fn emit_stream_projection(stream: &RunStream, projection: (StreamProjectionKind, String)) {
    let (kind, delta) = projection;
    if delta.is_empty() {
        return;
    }
    match kind {
        StreamProjectionKind::AgentMessage { item_id } => {
            let phase = stream.append_message_delta(&item_id, &delta);
            stream.publish(CodexAgentHostEvent::MessageDelta {
                delta,
                channel: Some(if phase == "commentary" {
                    "commentary".into()
                } else {
                    "final".into()
                }),
            });
        }
        StreamProjectionKind::Reasoning => {
            stream.append_reasoning(&delta);
            stream.publish(CodexAgentHostEvent::MessageDelta {
                delta,
                channel: Some("reasoning".into()),
            });
        }
        StreamProjectionKind::Plan => {
            stream.append_plan_delta(&delta);
            stream.publish(CodexAgentHostEvent::MessageDelta {
                delta,
                channel: Some("plan".into()),
            });
        }
        StreamProjectionKind::Tool { item_id, tool_name } => {
            stream.publish(CodexAgentHostEvent::Tool {
                status: "running".into(),
                tool_call_id: item_id,
                tool_name,
                detail: Some(truncate(&delta)),
                duration_ms: None,
            });
        }
    }
}

fn token_is_bearer_marker(token: &str) -> bool {
    token
        .trim_matches(|character: char| !character.is_ascii_alphanumeric())
        .eq_ignore_ascii_case("bearer")
}

fn token_is_assignment_operator(token: &str) -> bool {
    matches!(
        token.trim_matches(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '"' | '\'' | '`' | '{' | '}' | '[' | ']' | '(' | ')'
                )
        }),
        ":" | "="
    )
}

fn token_ends_with_assignment_operator(token: &str) -> bool {
    token
        .trim_end_matches(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '"' | '\'' | '`' | '{' | '}' | '[' | ']' | '(' | ')'
                )
        })
        .ends_with([':', '='])
}

fn credential_key_has_marker(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "api_key",
        "api-key",
        "apikey",
        "token",
        "secret",
        "password",
        "cookie",
        "authorization",
        "credential",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn normalized_credential_key(token: &str) -> &str {
    token
        .trim_matches(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '"' | '\'' | '`' | '{' | '}' | '[' | ']' | '(' | ')' | ','
                )
        })
        .trim_end_matches([':', '='])
        .trim_end_matches(['"', '\'', '`'])
}

fn token_is_credential_key(token: &str) -> bool {
    let key = normalized_credential_key(token);
    !key.is_empty() && credential_key_has_marker(key)
}

fn inline_credential_assignment_value(token: &str) -> Option<&str> {
    let (index, _) = token
        .char_indices()
        .find(|(_, character)| matches!(character, ':' | '='))?;
    let key = &token[..index];
    if !token_is_credential_key(key) {
        return None;
    }
    Some(token[index + 1..].trim_start_matches(['"', '\'', '`']))
}

fn leading_assignment_value(token: &str) -> Option<&str> {
    let trimmed = token.trim_start_matches(|character: char| {
        character.is_whitespace() || matches!(character, '"' | '\'' | '`' | '{' | '[' | '(')
    });
    let mut characters = trimmed.char_indices();
    let (_, operator) = characters.next()?;
    if !matches!(operator, ':' | '=') {
        return None;
    }
    let value_start = operator.len_utf8();
    Some(trimmed[value_start..].trim_start_matches(['"', '\'', '`']))
}

fn redact_assignment_value(token: &str) -> String {
    let Some((index, operator)) = token
        .char_indices()
        .find(|(_, character)| matches!(character, ':' | '='))
    else {
        return "[secret-redacted]".into();
    };
    format!("{}[secret-redacted]", &token[..index + operator.len_utf8()])
}

fn validate_token_usage(value: &Value) -> Result<(), CodexHostError> {
    let object = value.as_object().ok_or(CodexHostError::Protocol)?;
    for scope in ["last", "total"] {
        let usage = object
            .get(scope)
            .and_then(Value::as_object)
            .ok_or(CodexHostError::Protocol)?;
        for field in [
            "inputTokens",
            "cachedInputTokens",
            "outputTokens",
            "reasoningOutputTokens",
            "totalTokens",
        ] {
            let count = usage
                .get(field)
                .and_then(Value::as_i64)
                .ok_or(CodexHostError::Protocol)?;
            if count < 0 {
                return Err(CodexHostError::Protocol);
            }
        }
    }
    Ok(())
}

fn project_token_usage(value: &Value) -> Result<Value, CodexHostError> {
    validate_token_usage(value)?;
    let last = value
        .get("last")
        .and_then(Value::as_object)
        .ok_or(CodexHostError::Protocol)?;
    let count = |field: &str| {
        last.get(field)
            .and_then(Value::as_i64)
            .ok_or(CodexHostError::Protocol)
    };
    let input = count("inputTokens")?;
    let cache_read = count("cachedInputTokens")?;
    let output = count("outputTokens")?;
    let reasoning = count("reasoningOutputTokens")?;
    let captured_at = rfc3339_now().map_err(|_| CodexHostError::Protocol)?;
    Ok(json!({
        "scope": {
            "kind": "subscription-run-diagnostic",
            "engineId": "codex",
            "accountId": "codex:local",
            "modelId": "engine-managed",
        },
        "input": input.saturating_sub(cache_read),
        "output": output,
        "cacheRead": cache_read,
        "reasoning": reasoning,
        "inputAccounting": "excludes-cache",
        "outputAccounting": "includes-reasoning",
        "usageSource": {
            "kind": "adapter",
            "capturedAt": captured_at,
            "reference": "codex app-server thread/tokenUsage/updated",
        },
        "cost": {
            "kind": "unavailable",
            "reason": "Subscription-included orchestration task; no API cost.",
        },
    }))
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_thread_requests_allow_real_codex_cold_start_time() {
        assert_eq!(request_timeout("turn/start"), Duration::from_secs(30));
        assert_eq!(request_timeout("thread/start"), Duration::from_secs(120));
        assert_eq!(request_timeout("thread/resume"), Duration::from_secs(120));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn spawned_codex_process_receives_only_subscription_safe_environment() {
        let mut command = Command::new("/usr/bin/env");
        configure_codex_process_env(
            &mut command,
            [
                (OsString::from("HOME"), OsString::from("/tmp/codex-home")),
                (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
                (
                    OsString::from("CODEX_HOME"),
                    OsString::from("/tmp/native-codex"),
                ),
                (
                    OsString::from("SSH_AUTH_SOCK"),
                    OsString::from("/tmp/ssh.sock"),
                ),
                (OsString::from("LC_ALL"), OsString::from("en_US.UTF-8")),
                (
                    OsString::from("OPENAI_API_KEY"),
                    OsString::from("sk-secret"),
                ),
                (
                    OsString::from("ANTHROPIC_API_KEY"),
                    OsString::from("secret"),
                ),
                (OsString::from("GH_TOKEN"), OsString::from("token")),
                (OsString::from("SESSION_COOKIE"), OsString::from("cookie")),
                (OsString::from("LC_SECRET"), OsString::from("must-not-pass")),
            ],
        )
        .unwrap();
        let output = command.output().await.unwrap();
        assert!(output.status.success());
        let environment = String::from_utf8(output.stdout).unwrap();
        assert!(environment.contains("HOME=/tmp/codex-home"));
        assert!(environment.contains("CODEX_HOME=/tmp/native-codex"));
        assert!(environment.contains("SSH_AUTH_SOCK=/tmp/ssh.sock"));
        assert!(environment.contains("LC_ALL=en_US.UTF-8"));
        for blocked in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GH_TOKEN",
            "SESSION_COOKIE",
            "LC_SECRET",
            "sk-secret",
            "must-not-pass",
        ] {
            assert!(!environment.contains(blocked));
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn skill_home_isolated_from_cli_owned_codex_home() {
        let mut command = Command::new("/usr/bin/env");
        configure_codex_process_env_with_home(
            &mut command,
            [
                (OsString::from("HOME"), OsString::from("/tmp/user-home")),
                (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
            ],
            Some(Path::new("/tmp/offisim-skill-home")),
        )
        .unwrap();
        let output = command.output().await.unwrap();
        assert!(output.status.success());
        let environment = String::from_utf8(output.stdout).unwrap();
        assert!(environment.contains("HOME=/tmp/offisim-skill-home"));
        assert!(environment.contains("CODEX_HOME=/tmp/user-home/.codex"));
    }

    #[test]
    fn absolute_paths_are_only_project_relative() {
        let root = Path::new("/tmp/project");
        assert_eq!(
            safe_workspace_path("/tmp/project/src/main.rs", Some(root), None).as_deref(),
            Some("./src/main.rs")
        );
        assert_eq!(
            safe_workspace_path("/Users/me/.codex/auth.json", Some(root), None),
            None
        );
    }

    #[test]
    fn token_usage_requires_exact_breakdown() {
        let valid = json!({
            "last": {"inputTokens":1,"cachedInputTokens":0,"outputTokens":2,"reasoningOutputTokens":1,"totalTokens":3},
            "total": {"inputTokens":4,"cachedInputTokens":1,"outputTokens":5,"reasoningOutputTokens":2,"totalTokens":9}
        });
        assert!(validate_token_usage(&valid).is_ok());
        let projected = project_token_usage(&valid).unwrap();
        assert_eq!(projected["scope"]["kind"], "subscription-run-diagnostic");
        assert_eq!(projected["scope"]["modelId"], "engine-managed");
        assert_eq!(projected["input"], 1);
        assert_eq!(projected["output"], 2);
        assert_eq!(projected["cacheRead"], 0);
        assert_eq!(projected["reasoning"], 1);
        assert_eq!(projected["usageSource"]["kind"], "adapter");
        assert_eq!(projected["cost"]["kind"], "unavailable");
        assert!(validate_token_usage(&json!({"last": {}, "total": {}})).is_err());
        assert!(validate_token_usage(&json!({
            "last": {"inputTokens":-1,"cachedInputTokens":0,"outputTokens":2,"reasoningOutputTokens":1,"totalTokens":1},
            "total": {"inputTokens":4,"cachedInputTokens":1,"outputTokens":5,"reasoningOutputTokens":2,"totalTokens":9}
        })).is_err());
    }

    #[test]
    fn approval_ids_keep_same_item_callbacks_distinct() {
        let one = sha256_hex(b"run\0rpc-1\0item-1\0approval-1\0command");
        let two = sha256_hex(b"run\0rpc-1\0item-1\0approval-2\0command");
        assert_ne!(one, two);
    }

    #[test]
    fn request_user_input_projection_is_bounded_and_redacts_prompt_secrets() {
        let params = json!({
            "questions": [
                {
                    "id": "engine",
                    "header": "Choose engine",
                    "question": "Use sk-1234567890abcdef or Bearer abcdefghijklmnop?",
                    "isOther": false,
                    "isSecret": true,
                    "options": [
                        {"label": "Codex", "description": "token=abcdefghijk"},
                        {"label": "Claude", "description": "No credential"}
                    ]
                },
                {
                    "id": "scope",
                    "header": "Scope",
                    "question": "Project or global?",
                    "isOther": true,
                    "isSecret": false
                }
            ],
            "autoResolutionMs": 60000
        });
        let projection = project_user_input_request(params.as_object().unwrap(), None).unwrap();
        assert_eq!(projection.pending_questions.len(), 2);
        assert_eq!(projection.questions.len(), 2);
        assert_eq!(projection.auto_resolution_ms, Some(60_000));
        assert_eq!(projection.questions[0]["isSecret"], true);
        let rendered = serde_json::to_string(&projection.questions).unwrap();
        assert!(!rendered.contains("sk-1234567890abcdef"));
        assert!(!rendered.contains("abcdefghijklmnop"));
        assert!(rendered.contains("secret-redacted") || rendered.contains("credentials"));

        let too_many = json!({
            "questions": [
                {"id":"1","header":"1","question":"1"},
                {"id":"2","header":"2","question":"2"},
                {"id":"3","header":"3","question":"3"},
                {"id":"4","header":"4","question":"4"}
            ]
        });
        assert!(project_user_input_request(too_many.as_object().unwrap(), None).is_err());
        assert_eq!(
            inactive_server_request_response("item/tool/requestUserInput"),
            json!({"answers": {}})
        );
    }

    #[test]
    fn mcp_elicitation_is_always_a_bounded_native_cancel() {
        assert_eq!(
            mcp_elicitation_cancel_response(),
            json!({"action": "cancel", "content": null})
        );
        assert_eq!(
            inactive_server_request_response("mcpServer/elicitation/request"),
            json!({"action": "cancel", "content": null})
        );
    }

    #[test]
    fn current_time_read_uses_os_unix_seconds_and_active_thread_scope() {
        let stream = RunStream::new("request".into(), tauri::ipc::Channel::new(|_body| Ok(())));
        stream.prime_native_thread("thread-1").unwrap();
        stream.prime_native_turn("turn-1").unwrap();
        assert!(validate_native_thread_scope(
            json!({"threadId":"thread-1"}).as_object().unwrap(),
            &stream
        )
        .is_ok());
        assert!(validate_native_thread_scope(
            json!({"threadId":"wrong-thread"}).as_object().unwrap(),
            &stream
        )
        .is_err());

        let before = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let response = current_time_response().unwrap();
        let after = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let current = response["currentTimeAt"].as_u64().unwrap();
        assert!((before..=after).contains(&current));
        assert_eq!(response.as_object().unwrap().len(), 1);
    }

    #[test]
    fn tool_status_projection_uses_only_renderer_supported_lifecycle_values() {
        assert_eq!(normalize_tool_status("inProgress", false), "started");
        assert_eq!(normalize_tool_status("completed", true), "completed");
        assert_eq!(normalize_tool_status("declined", true), "failed");
        assert_eq!(normalize_tool_status("cancelled", true), "failed");
        assert_eq!(normalize_tool_status("unknown", true), "completed");
    }

    #[test]
    fn approval_reason_redacts_credentials_before_ui_projection() {
        let params = json!({
            "reason": "Use sk-abcdefghijklmnop for this approval",
            "command": "curl https://alice:hunter2@example.com/private"
        });
        let (_, message) = approval_copy(
            "item/commandExecution/requestApproval",
            params.as_object().unwrap(),
            Some(Path::new("/tmp/project")),
            None,
        );
        let message = message.unwrap();
        assert!(message.contains("[secret-redacted]"));
        assert!(message.contains("https://[credentials-redacted]@example.com/private"));
        assert!(!message.contains("sk-abcdefghijklmnop"));
        assert!(!message.contains("alice"));
        assert!(!message.contains("hunter2"));
    }

    #[test]
    fn safe_projection_redacts_secret_literals_without_keyword_hints() {
        let projected = safe_command_detail(
            "send sk-1234567890abcdef to https://person:passphrase@example.test/path",
            None,
        );
        assert!(!projected.contains("sk-1234567890abcdef"));
        assert!(!projected.contains("person"));
        assert!(!projected.contains("passphrase"));
        assert!(projected.contains("[secret-redacted]"));
        assert!(projected.contains("[credentials-redacted]"));
    }

    #[test]
    fn projection_redacts_jwt_bearer_and_structured_credential_values() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123";
        for fixture in [
            format!("JWT {jwt}"),
            "Authorization: Bearer abcdefghijklmnop".into(),
            r#"{"api_key":"abcdefghijk","password":"correct-horse-battery"}"#.into(),
            "cookie=session-cookie-value".into(),
        ] {
            let redacted = redact_sensitive_literals_with_home(&fixture, None);
            assert!(!redacted.contains(jwt));
            assert!(!redacted.contains("abcdefghijklmnop"));
            assert!(!redacted.contains("abcdefghijk"));
            assert!(!redacted.contains("correct-horse-battery"));
            assert!(!redacted.contains("session-cookie-value"));
        }
    }

    #[test]
    fn model_projection_redacts_secrets_and_native_agent_home_paths() {
        let projected = safe_model_text(
            "Plan: use Bearer abcdefghijklmnop then inspect /Users/person/.codex/sessions/raw.jsonl",
            None,
        );
        assert!(!projected.contains("abcdefghijklmnop"));
        assert!(!projected.contains("/Users/person/.codex"));
        assert!(projected.contains("[secret-redacted]"));
        assert!(projected.contains("[native-agent-home-redacted]"));

        let assigned = safe_model_text("CODEX_HOME=/private/tmp/native-home", None);
        assert!(!assigned.contains("/private/tmp/native-home"));
        assert!(assigned.contains("[native-agent-home-redacted]"));
    }

    #[test]
    fn normal_token_budget_diagnostic_is_not_misreported_as_login_failure() {
        assert_eq!(
            safe_message("The context token budget was exceeded.", None),
            "The context token budget was exceeded."
        );
    }

    #[test]
    fn tool_deltas_redact_literals_before_truncation() {
        let projected = safe_tool_delta(
            "progress sk-1234567890abcdef via https://person:passphrase@example.test/path",
            None,
        );
        assert!(!projected.contains("sk-1234567890abcdef"));
        assert!(!projected.contains("person"));
        assert!(!projected.contains("passphrase"));
        assert!(projected.contains("[secret-redacted]"));
        assert!(projected.contains("[credentials-redacted]"));
    }

    #[test]
    fn command_file_and_mcp_delta_credential_values_are_redacted_in_place() {
        for delta in [
            "OPENAI_API_KEY=value",
            "Authorization: Bearer abcdefghijkl",
            "SESSION_COOKIE=value",
        ] {
            let projected = safe_tool_delta(delta, None);
            assert!(!projected.ends_with("=value"));
            assert!(!projected.ends_with("Bearer abcdefghijkl"));
            assert!(projected.contains("[secret-redacted]"));
        }
    }

    fn project_stream_chunks(chunks: &[&str], codex_home: Option<&str>) -> String {
        let mut redactor = StreamTokenRedactor::default();
        let mut projected = String::new();
        for chunk in chunks {
            projected.push_str(&redactor.push(chunk, codex_home));
        }
        projected.push_str(&redactor.finish(codex_home));
        projected
    }

    #[test]
    fn streaming_projection_redacts_sensitive_values_split_across_native_chunks() {
        let bearer = project_stream_chunks(&["Bearer abc", "defghijklmnop"], None);
        assert_eq!(bearer, "Bearer [secret-redacted]");
        assert!(!bearer.contains("abcdefghijklmnop"));

        let jwt = project_stream_chunks(
            &[
                "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI",
                "xMjM0NTY3ODkwIn0.signature123",
            ],
            None,
        );
        assert_eq!(jwt, "[secret-redacted]");
        assert!(!jwt.contains("signature123"));

        let assignment = project_stream_chunks(&["api_key ", "= tiny", "-secret"], None);
        assert_eq!(assignment, "api_key = [secret-redacted]");
        assert!(!assignment.contains("tiny-secret"));
    }

    #[test]
    fn streaming_projection_is_chunk_boundary_invariant_for_secret_fixtures() {
        let fixtures = [
            (
                "Bearer abcdefghijklmnop",
                None,
                "Bearer [secret-redacted]",
                "abcdefghijklmnop",
            ),
            (
                "Authorization: Bearer abcdefghijklmnop",
                None,
                "Authorization: Bearer [secret-redacted]",
                "abcdefghijklmnop",
            ),
            (
                "api_key = tiny-secret",
                None,
                "api_key = [secret-redacted]",
                "tiny-secret",
            ),
            (
                "Inspect /private/tmp/native-home/sessions/raw.jsonl",
                Some("/private/tmp/native-home"),
                "Inspect [native-agent-home-redacted]/sessions/raw.jsonl",
                "/private/tmp/native-home",
            ),
        ];

        for (raw, codex_home, expected, forbidden) in fixtures {
            for split in 0..=raw.len() {
                let projected = project_stream_chunks(&[&raw[..split], &raw[split..]], codex_home);
                assert_eq!(projected, expected, "split={split}, fixture={raw}");
                assert!(!projected.contains(forbidden));
            }
            let chunks = raw
                .as_bytes()
                .iter()
                .map(|byte| std::str::from_utf8(std::slice::from_ref(byte)).unwrap())
                .collect::<Vec<_>>();
            let projected = project_stream_chunks(&chunks, codex_home);
            assert_eq!(projected, expected, "single-byte chunks, fixture={raw}");
            assert!(!projected.contains(forbidden));
        }
    }

    #[test]
    fn streaming_projection_uses_connection_only_codex_home_for_exact_path_redaction() {
        let codex_home = "/private/tmp/native-home";
        let projected = project_stream_chunks(
            &["Inspect /private/tmp/na", "tive-home/sessions/raw.jsonl"],
            Some(codex_home),
        );
        assert_eq!(
            projected,
            "Inspect [native-agent-home-redacted]/sessions/raw.jsonl"
        );
        assert!(!projected.contains(codex_home));
    }

    #[test]
    fn streaming_projection_preserves_normal_token_budget_copy() {
        assert_eq!(
            project_stream_chunks(&["The context token ", "budget was exceeded."], None),
            "The context token budget was exceeded."
        );
    }

    #[test]
    fn web_search_event_never_projects_query_credentials() {
        let delivered = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let delivered_for_channel = Arc::clone(&delivered);
        let channel = tauri::ipc::Channel::new(move |body| {
            delivered_for_channel
                .lock()
                .unwrap()
                .push(body.deserialize().unwrap());
            Ok(())
        });
        let stream = RunStream::new("request".into(), channel);
        let item = json!({
            "type": "webSearch",
            "id": "search-1",
            "query": "find sk-1234567890abcdef at https://person:passphrase@example.test/path"
        });
        project_item(&stream, item.as_object().unwrap(), false, None, None).unwrap();

        let events = delivered.lock().unwrap();
        let event = events
            .iter()
            .find(|event| event["kind"] == "tool")
            .expect("tool event");
        let projection = event.to_string();
        assert!(!projection.contains("sk-1234567890abcdef"));
        assert!(!projection.contains("person"));
        assert!(!projection.contains("passphrase"));
        assert!(projection.contains("[secret-redacted]"));
        assert!(projection.contains("[credentials-redacted]"));
    }
}
