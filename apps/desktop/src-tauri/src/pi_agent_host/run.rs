use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

#[cfg(test)]
use tauri::Manager;
use tauri::{ipc::Channel, AppHandle};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{
    append_sidecar_audit, dev_workspace_root, required_text, resolve_node_executable,
    sidecar_script_path, HostError, SidecarAudit,
};
use crate::in_flight::InFlightRegistry;
use crate::process_group::{
    configure_process_group, signal_process_group, terminate_process_group, ProcessGroupGuard,
};
use crate::sidecar_stderr::{
    read_capped_line, read_capped_to_end, sanitized_stderr, MAX_SIDECAR_OUTPUT_BYTES,
};
use crate::task_workspace_binding::{
    persist_conversation_native_session_reset, resolve_conversation_native_session_for_execute,
    resolve_task_workspace_for_turn, revoke_task_workspace_binding,
    validate_task_workspace_binding_authority, workspace_bound_event, AuthorizedProcessCwd,
    IssueTaskWorkspaceBinding, ResettableNativeSessionPrestartCode, TaskWorkspaceAccess,
    TaskWorkspaceAuthorityError, TaskWorkspaceAuthorityLossReason, TaskWorkspaceBinding,
    TaskWorkspaceResolution, TaskWorkspaceTerminalStatus, TaskWorkspaceUnavailable,
};
use crate::workspace_recovery::{WorkspaceRecoveryReason, WorkspaceRecoverySource};

use super::bridge::{
    handle_mcp_call, handle_verify_call, handle_worktree_call, pi_stdin_guard,
    register_execution_prepared, write_mcp_result, PiMcpResult, StdinGuard, PI_MCP_CALL_TIMEOUT,
};
use super::payload::{
    app_pi_agent_dir, app_pi_session_dir, collaborate_payload, enhance_payload, pi_env,
    sidecar_payload, write_payload, ExecuteWorkspacePayload,
};
use super::stream::{begin_run_stream, finish_run_stream, publish_host_event};
use super::types::{
    PiAgentCollaborateRequest, PiAgentEnhanceRequest, PiAgentExecuteRequest, PiAgentHostEvent,
    PiAgentHostResponse,
};
use super::wire::{
    consume_ready_handshake, decode_sidecar_line, parse_response, send_sidecar_event, PiSidecarLine,
};
use super::PI_LANE;

static IN_FLIGHT: InFlightRegistry = InFlightRegistry::new("pi_agent_host");
const WORKSPACE_AUTHORITY_RECHECK_INTERVAL: Duration = Duration::from_millis(250);
const SIDECAR_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

type WorkspaceCallJoinResult = (String, Result<(), HostError>);

fn is_cancellable_workspace_call(op: &str) -> bool {
    op == "executeBash" || super::workspace_files::is_workspace_file_operation(op)
}

async fn cancel_and_join_workspace_calls(
    cancellations: &mut HashMap<String, CancellationToken>,
    tasks: &mut JoinSet<WorkspaceCallJoinResult>,
) {
    for cancellation in cancellations.values() {
        cancellation.cancel();
    }
    let drain = async {
        while let Some(joined) = tasks.join_next().await {
            match joined {
                Ok((_, Ok(()))) => {}
                Ok((id, Err(error))) => {
                    eprintln!(
                        "[pi-agent-host] workspace call {id} ended during shutdown: {error:?}"
                    );
                }
                Err(error) => {
                    eprintln!("[pi-agent-host] join workspace call during shutdown: {error}");
                }
            }
        }
    };
    if tokio::time::timeout(SIDECAR_GRACEFUL_SHUTDOWN_TIMEOUT, drain)
        .await
        .is_err()
    {
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
    }
    cancellations.clear();
}

async fn wait_for_workspace_authority_loss<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_ref: &str,
    scope: IssueTaskWorkspaceBinding<'_>,
) -> TaskWorkspaceAuthorityError {
    loop {
        tokio::time::sleep(WORKSPACE_AUTHORITY_RECHECK_INTERVAL).await;
        if let Err(error) = validate_task_workspace_binding_authority(app, workspace_ref, scope) {
            return error;
        }
    }
}

enum ExecuteFailure {
    Host(HostError),
    Authority(TaskWorkspaceAuthorityError),
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum TerminalAuthorityGate<T, E> {
    Accept(T),
    UserAborted,
    AuthorityLost(E),
}

pub(super) fn gate_sidecar_terminal<T, E>(
    response: T,
    user_aborted: bool,
    authority: Result<(), E>,
) -> TerminalAuthorityGate<T, E> {
    if user_aborted {
        TerminalAuthorityGate::UserAborted
    } else {
        match authority {
            Ok(()) => TerminalAuthorityGate::Accept(response),
            Err(error) => TerminalAuthorityGate::AuthorityLost(error),
        }
    }
}

impl From<HostError> for ExecuteFailure {
    fn from(error: HostError) -> Self {
        Self::Host(error)
    }
}

impl ExecuteFailure {
    fn into_host_error(self) -> HostError {
        match self {
            Self::Host(error) => error,
            Self::Authority(error) => error.into_host_error(),
        }
    }
}

pub(crate) struct PiSidecarRun<'a> {
    pub script_path: &'a Path,
    pub cwd: &'a Path,
    pub workspace_binding: Option<&'a TaskWorkspaceBinding>,
    pub env: HashMap<String, String>,
    pub payload: serde_json::Value,
    pub token: CancellationToken,
    pub on_event: Option<&'a Channel<PiAgentHostEvent>>,
    pub register_stdin: Option<&'a str>,
    pub stream_request_id: Option<&'a str>,
}

#[cfg(test)]
pub(super) struct TestPiSidecarScript(pub(super) PathBuf);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum McpBridgeProfile {
    BoundWork,
    CollaborationRead,
    WorkspaceUnavailable,
    Enhance,
    Test,
    Restricted,
}

impl McpBridgeProfile {
    fn label(self) -> &'static str {
        match self {
            Self::BoundWork => "bound-work",
            Self::CollaborationRead => "collaboration-read",
            Self::WorkspaceUnavailable => "workspace-unavailable",
            Self::Enhance => "enhance",
            Self::Test => "test",
            Self::Restricted => "restricted",
        }
    }
}

pub(super) fn mcp_bridge_profile(
    workspace_binding: Option<&TaskWorkspaceBinding>,
    payload: &serde_json::Value,
) -> McpBridgeProfile {
    let mode = payload.get("mode").and_then(serde_json::Value::as_str);
    match mode {
        Some("execute") => match (
            workspace_binding.is_some(),
            payload
                .get("workspaceAvailability")
                .and_then(serde_json::Value::as_str),
        ) {
            (true, Some("bound")) => McpBridgeProfile::BoundWork,
            (false, Some("unavailable")) => McpBridgeProfile::WorkspaceUnavailable,
            _ => McpBridgeProfile::Restricted,
        },
        Some("collaborate")
            if workspace_binding.is_none()
                && payload
                    .get("collaborationProfile")
                    .and_then(serde_json::Value::as_str)
                    == Some("collaboration_read") =>
        {
            McpBridgeProfile::CollaborationRead
        }
        Some("enhance") => McpBridgeProfile::Enhance,
        Some("test") => McpBridgeProfile::Test,
        _ => McpBridgeProfile::Restricted,
    }
}

pub(super) fn authorize_mcp_frame(profile: McpBridgeProfile) -> Result<(), HostError> {
    if matches!(
        profile,
        McpBridgeProfile::BoundWork | McpBridgeProfile::CollaborationRead
    ) {
        return Ok(());
    }
    Err(HostError::Protocol(format!(
        "Pi Agent protocol workspace-isolation: mcpCall is forbidden for the {} profile",
        profile.label()
    )))
}

async fn finish_sidecar_process_group(child: &mut Child, process_group_id: Option<u32>) {
    // A successful group leader exit is not proof that same-group descendants
    // ended. Clear them before accepting the terminal response and reap the
    // leader again harmlessly if the main loop already waited it.
    #[cfg(unix)]
    signal_process_group(process_group_id, libc::SIGKILL);
    #[cfg(not(unix))]
    let _ = process_group_id;
    let _ = child.wait().await;
}

async fn read_stderr(mut stderr: tokio::process::ChildStderr) -> (Vec<u8>, bool) {
    read_capped_to_end(&mut stderr, MAX_SIDECAR_OUTPUT_BYTES)
        .await
        .unwrap_or_else(|error| {
            (
                format!("failed to read Pi Agent stderr: {error}").into_bytes(),
                true,
            )
        })
}

pub(crate) async fn run_pi_sidecar_jsonl<R: tauri::Runtime>(
    app: &AppHandle<R>,
    run: PiSidecarRun<'_>,
) -> Result<serde_json::Value, HostError> {
    run_pi_sidecar_jsonl_inner(Some(app), run).await
}

pub(super) async fn run_pi_sidecar_jsonl_inner<R: tauri::Runtime>(
    app: Option<&AppHandle<R>>,
    run: PiSidecarRun<'_>,
) -> Result<serde_json::Value, HostError> {
    let PiSidecarRun {
        script_path,
        cwd,
        workspace_binding,
        env,
        payload,
        token,
        on_event,
        register_stdin,
        stream_request_id,
    } = run;
    let mcp_profile = mcp_bridge_profile(workspace_binding, &payload);
    let authorized_process = workspace_binding
        .map(|binding| {
            AuthorizedProcessCwd::from_authority(&binding.authorized_root(), cwd)
                .map_err(HostError::Request)
        })
        .transpose()?;
    let node_executable = resolve_node_executable(script_path);
    let mut command = Command::new(&node_executable);
    command
        .arg(script_path)
        .env_clear()
        .envs(env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // The explicit error path below always kills and waits. Keep this as the
        // final guard for cancellation/panic while the future owns the child.
        .kill_on_drop(true);
    if authorized_process.is_none() {
        command.current_dir(cwd);
    }
    configure_process_group(&mut command);
    if let Some(execution) = authorized_process.as_ref() {
        execution
            .bind_command(&mut command)
            .map_err(HostError::Spawn)?;
    }

    let mut child = command.spawn().map_err(|err| {
        HostError::Spawn(format!(
            "Failed to spawn Pi Agent host via `{}`: {}",
            node_executable.display(),
            err
        ))
    })?;
    let process_group_id = child.id();
    let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
    let result = async {
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
        let mut stderr_task = tokio::spawn(read_stderr(stderr));
        let mut stderr_result = None;
        let mut stdout = BufReader::new(stdout);
        let mut final_response: Option<serde_json::Value> = None;
        let mut saw_ready = false;
        let mut workspace_call_cancellations = HashMap::<String, CancellationToken>::new();
        let mut workspace_call_tasks = JoinSet::<WorkspaceCallJoinResult>::new();

        loop {
            tokio::select! {
                _ = token.cancelled() => {
                    cancel_and_join_workspace_calls(
                        &mut workspace_call_cancellations,
                        &mut workspace_call_tasks,
                    ).await;
                    return Err(HostError::Aborted);
                }
                joined = workspace_call_tasks.join_next(), if !workspace_call_tasks.is_empty() => {
                    match joined {
                        Some(Ok((id, result))) => {
                            workspace_call_cancellations.remove(&id);
                            result?;
                        }
                        Some(Err(error)) => {
                            return Err(HostError::Request(format!(
                                "Join Pi workspace-call bridge: {error}"
                            )));
                        }
                        None => {}
                    }
                }
                result = &mut stderr_task, if stderr_result.is_none() => {
                    let result = result
                        .map_err(|err| HostError::Request(format!("Join Pi Agent stderr task: {err}")))?;
                    if result.1 {
                        return Err(HostError::Protocol(format!(
                            "Pi Agent stderr exceeded the {} byte limit; output was truncated and the sidecar was terminated.",
                            MAX_SIDECAR_OUTPUT_BYTES
                        )));
                    }
                    stderr_result = Some(result);
                }
                next_line = read_capped_line(&mut stdout, MAX_SIDECAR_OUTPUT_BYTES) => {
                    let Some(line) = next_line.map_err(|err| {
                        HostError::Protocol(format!("Pi Agent stdout frame limit exceeded: {err}"))
                    })? else {
                        break;
                    };
                let line = String::from_utf8_lossy(&line);
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
                if let PiSidecarLine::ExecutionPrepared {
                    prepare_id,
                    target_digest,
                    ..
                } = &parsed
                {
                    let request_id = register_stdin.ok_or_else(|| {
                        HostError::Protocol(
                            "Execution preparation is missing its stdin acknowledgement channel"
                                .into(),
                        )
                    })?;
                    register_execution_prepared(request_id, prepare_id, target_digest)?;
                }
                // Intercept mcpCall in-process: invoke the MCP tool and write the
                // result back to the host stdin, never forwarding it to the
                // renderer. Cancellation-aware so an abort during a slow tool call
                // still kills the run promptly (mirrors the outer select).
                if let PiSidecarLine::McpCall {
                    id,
                    server,
                    tool,
                    arguments,
                } = parsed
                {
                    authorize_mcp_frame(mcp_profile)?;
                    let app = app.ok_or_else(|| {
                        HostError::Protocol(
                            "Pi Agent test host emitted mcpCall without an app bridge".into(),
                        )
                    })?;
                    let timeout_id = id.clone();
                    let timeout_server = server.clone();
                    let timeout_tool = tool.clone();
                    tokio::select! {
                        _ = token.cancelled() => {
                            return Err(HostError::Aborted);
                        }
                        result = tokio::time::timeout(
                            PI_MCP_CALL_TIMEOUT,
                            handle_mcp_call(app, register_stdin, id, server, tool, arguments),
                        ) => {
                            match result {
                                Ok(result) => result?,
                                Err(_) => {
                                    let Some(request_id) = register_stdin else {
                                        eprintln!(
                                            "[pi-agent-host] timed out mcpCall with no stdin channel; dropping id={timeout_id}"
                                        );
                                        continue;
                                    };
                                    let response = PiMcpResult {
                                        id: timeout_id,
                                        ok: false,
                                        content: None,
                                        is_error: None,
                                        error: Some(format!(
                                            "MCP tool call timed out after {}s: {}.{}",
                                            PI_MCP_CALL_TIMEOUT.as_secs(),
                                            timeout_server,
                                            timeout_tool
                                        )),
                                    };
                                    write_mcp_result(request_id, &response).await?;
                                }
                            }
                        }
                    }
                    continue;
                }
                if let PiSidecarLine::WorktreeCall { id, op, args } = parsed {
                    if matches!(op.as_str(), "cancelBash" | "cancelWorkspaceFile") {
                        let call_id = args
                            .as_ref()
                            .and_then(|value| value.get("callId"))
                            .and_then(serde_json::Value::as_str)
                            .ok_or_else(|| {
                                HostError::Protocol(
                                    "Pi workspace cancellation is missing its callId".into(),
                                )
                            })?;
                        if let Some(cancellation) = workspace_call_cancellations.get(call_id) {
                            cancellation.cancel();
                        }
                        continue;
                    }
                    let app = app.ok_or_else(|| {
                        HostError::Protocol(
                            "Pi Agent test host emitted worktreeCall without an app bridge".into(),
                        )
                    })?;
                    if is_cancellable_workspace_call(&op) {
                        if workspace_call_cancellations.contains_key(&id) {
                            return Err(HostError::Protocol(format!(
                                "Pi workspace call id was reused: {id}"
                            )));
                        }
                        let binding = workspace_binding.cloned().ok_or_else(|| {
                            HostError::Protocol(
                                "Pi workspace call is missing its backend workspace binding".into(),
                            )
                        })?;
                        let request_id = register_stdin
                            .ok_or_else(|| {
                                HostError::Protocol(
                                    "Pi workspace call is missing its stdin response channel".into(),
                                )
                            })?
                            .to_string();
                        let app = app.clone();
                        let cancellation = CancellationToken::new();
                        workspace_call_cancellations.insert(id.clone(), cancellation.clone());
                        let task_id = id.clone();
                        workspace_call_tasks.spawn(async move {
                            let result = handle_worktree_call(
                                &app,
                                Some(&request_id),
                                Some(&binding),
                                id,
                                op,
                                args,
                                Some(&cancellation),
                            )
                            .await;
                            (task_id, result)
                        });
                        continue;
                    }
                    tokio::select! {
                        _ = token.cancelled() => {
                            return Err(HostError::Aborted);
                        }
                        result = handle_worktree_call(
                            app,
                            register_stdin,
                            workspace_binding,
                            id,
                            op,
                            args,
                            Some(&token),
                        ) => {
                            result?;
                        }
                    }
                    continue;
                }
                if let PiSidecarLine::VerifyCall { id, command, cwd, project_id } = parsed {
                    let app = app.ok_or_else(|| {
                        HostError::Protocol(
                            "Pi Agent test host emitted verifyCall without an app bridge".into(),
                        )
                    })?;
                    tokio::select! {
                        _ = token.cancelled() => {
                            return Err(HostError::Aborted);
                        }
                        result = handle_verify_call(
                            app,
                            register_stdin,
                            workspace_binding,
                            id,
                            project_id,
                            cwd,
                            command,
                        ) => {
                            result?;
                        }
                    }
                    continue;
                }
                if let Some(response) = send_sidecar_event(stream_request_id, on_event, parsed)? {
                    final_response = Some(response);
                }
                }
            }
        }

        cancel_and_join_workspace_calls(
            &mut workspace_call_cancellations,
            &mut workspace_call_tasks,
        )
        .await;

        let status = child
            .wait()
            .await
            .map_err(|err| HostError::Request(format!("Wait for Pi Agent host process: {err}")))?;
        let (stderr_bytes, stderr_truncated) = match stderr_result {
            Some(result) => result,
            None => stderr_task
                .await
                .map_err(|err| HostError::Request(format!("Join Pi Agent stderr task: {err}")))?,
        };
        if stderr_truncated {
            return Err(HostError::Protocol(format!(
                "Pi Agent stderr exceeded the {} byte limit; output was truncated and the run was rejected.",
                MAX_SIDECAR_OUTPUT_BYTES
            )));
        }
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
    .await;

    if result.is_err() {
        // Give Node a bounded SIGTERM window to abort host-tracked Bash calls,
        // then hard-kill any remaining same-group descendants.
        terminate_process_group(
            &mut child,
            process_group_id,
            SIDECAR_GRACEFUL_SHUTDOWN_TIMEOUT,
        )
        .await;
    } else {
        finish_sidecar_process_group(&mut child, process_group_id).await;
    }
    process_group_guard.disarm();
    result
}

pub(super) fn validate_execute_workspace_requirement(
    req: &PiAgentExecuteRequest,
    is_resume: bool,
) -> Result<(), HostError> {
    if !req.workspace_requirement.is_optional() {
        return Ok(());
    }
    let required_by = if is_resume {
        Some("durable resume")
    } else if req.competitive_draft.is_some() {
        Some("competitive draft execution")
    } else if req.direct_delegation.is_some() {
        Some("direct delegation")
    } else if req.mission_context_json.is_some() {
        Some("Mission execution")
    } else {
        None
    };
    match required_by {
        Some(required_by) => Err(HostError::Request(format!(
            "workspaceRequirement must be required for {required_by}."
        ))),
        None => Ok(()),
    }
}

fn workspace_unavailable_error(unavailable: &TaskWorkspaceUnavailable) -> HostError {
    HostError::Request(format!(
        "Project workspace is unavailable ({}; {} recovery candidates). Restore or reselect the Project folder before this task accesses files.",
        unavailable.reason_code.as_str(), unavailable.candidate_count
    ))
}

fn native_session_can_start_fresh(error: &HostError) -> bool {
    matches!(
        error,
        HostError::NativeSessionPrestart { code, .. }
            if ResettableNativeSessionPrestartCode::parse(code).is_some()
    )
}

#[derive(Clone, Copy)]
struct ExactNativeSession<'a> {
    file: &'a Path,
    id: &'a str,
}

async fn execute_with_bound_workspace<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: &PiAgentExecuteRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
    scope: IssueTaskWorkspaceBinding<'_>,
    binding: TaskWorkspaceBinding,
    native_session: Option<ExactNativeSession<'_>>,
) -> Result<PiAgentHostResponse, HostError> {
    let workspace_ref = binding.binding_ref.clone();
    let execution: Result<PiAgentHostResponse, ExecuteFailure> = async {
        publish_host_event(
            Some(&req.request_id),
            Some(on_event),
            workspace_bound_event(&binding)?,
            "Send Pi workspace binding event",
        )?;

        let default_session_dir = app_pi_session_dir(app, scope.thread_id)?;
        let session_dir = native_session
            .and_then(|session| session.file.parent())
            .unwrap_or(default_session_dir.as_path());
        #[cfg(test)]
        let test_script_path = app
            .try_state::<TestPiSidecarScript>()
            .map(|script| script.0.clone());
        #[cfg(not(test))]
        let test_script_path: Option<PathBuf> = None;
        if test_script_path.is_none() {
            append_sidecar_audit(
                app,
                PI_LANE,
                SidecarAudit {
                    request_id: &req.request_id,
                    project_id: Some(&binding.project_id),
                    employee_id: req.employee_id.as_deref(),
                    provider_profile_id: None,
                    credential_recorded: false,
                },
                &binding.canonical_root,
                "started",
            );
        }

        let script_path = match test_script_path {
            Some(script_path) => script_path,
            None => {
                let dev_root = dev_workspace_root();
                sidecar_script_path(app, dev_root.as_ref(), PI_LANE)?
            }
        };
        let agent_dir = app_pi_agent_dir(app);
        let competitive_lease = match req.competitive_draft.as_ref() {
            Some(context) => Some(
                crate::git::create_competitive_draft_workspace_lease(app, &binding, context)
                    .await
                    .map_err(HostError::Request)?,
            ),
            None => None,
        };
        let mut effective_direct_delegation = req.direct_delegation.clone();
        if let Some(lease) = competitive_lease.as_ref() {
            let delegation = effective_direct_delegation
                .as_mut()
                .and_then(serde_json::Value::as_object_mut)
                .ok_or_else(|| {
                    HostError::Request(
                        "Pi competitive draft requires a direct delegation packet.".into(),
                    )
                })?;
            if delegation
                .get("deferIntegration")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
            {
                return Err(HostError::Request(
                    "Pi competitive draft must defer automatic integration.".into(),
                )
                .into());
            }
            let employee_id = req
                .employee_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    HostError::Request("Pi competitive draft requires an employeeId.".into())
                })?;
            if delegation
                .get("employeeId")
                .and_then(serde_json::Value::as_str)
                != Some(employee_id)
            {
                return Err(HostError::Request(
                    "Pi competitive draft employee does not match its root run.".into(),
                )
                .into());
            }
            delegation.insert(
                "resumeLease".into(),
                serde_json::json!({
                    "leaseId": lease.lease_id,
                    "runId": lease.registered_run_id,
                    "workspaceRoot": lease.workspace_root,
                    "cwd": lease.cwd,
                    "branch": lease.branch,
                    "createdAt": lease.created_at,
                }),
            );
        }
        let authorized_direct_delegation = crate::git::authorize_direct_delegation(
            app,
            &binding,
            effective_direct_delegation.as_ref(),
        )
        .await
        .map_err(HostError::Request)?;
        // Direct-lease adoption performs filesystem/Git/DB work. Revalidate the
        // original binding immediately before the child payload is constructed;
        // an authority loss during adoption must not launch the sidecar.
        validate_task_workspace_binding_authority(app, &workspace_ref, scope)
            .map_err(ExecuteFailure::Authority)?;
        let payload = sidecar_payload(
            req,
            ExecuteWorkspacePayload::Bound(&binding),
            session_dir,
            agent_dir.as_deref(),
            authorized_direct_delegation.as_ref(),
            native_session.map(|session| session.file),
            native_session.map(|session| session.id),
        )?;
        // The renderer-facing abort token remains the parent. A watchdog may
        // cancel only this child token, allowing authority loss to terminate
        // and reap the host without being misreported as a user abort.
        let sidecar_token = token.child_token();
        let sidecar = run_pi_sidecar_jsonl(
            app,
            PiSidecarRun {
                script_path: &script_path,
                cwd: &binding.canonical_root,
                workspace_binding: Some(&binding),
                env: pi_env(Some(&binding.canonical_root)),
                payload,
                token: sidecar_token.clone(),
                on_event: Some(on_event),
                register_stdin: Some(&req.request_id),
                stream_request_id: Some(&req.request_id),
            },
        );
        tokio::pin!(sidecar);
        let authority_watchdog = wait_for_workspace_authority_loss(app, &workspace_ref, scope);
        tokio::pin!(authority_watchdog);

        let response = tokio::select! {
            biased;
            response = &mut sidecar => match response {
                Ok(response) => {
                    let user_aborted = token.is_cancelled();
                    let authority = if user_aborted {
                        Ok(())
                    } else {
                        validate_task_workspace_binding_authority(app, &workspace_ref, scope)
                    };
                    match gate_sidecar_terminal(response, user_aborted, authority) {
                        TerminalAuthorityGate::Accept(response) => Ok(response),
                        TerminalAuthorityGate::UserAborted => {
                            Err(ExecuteFailure::Host(HostError::Aborted))
                        }
                        TerminalAuthorityGate::AuthorityLost(error) => {
                            Err(ExecuteFailure::Authority(error))
                        }
                    }
                }
                Err(host_error) if !token.is_cancelled() => {
                    match validate_task_workspace_binding_authority(app, &workspace_ref, scope) {
                        Ok(()) => Err(ExecuteFailure::Host(host_error)),
                        Err(authority_error) => Err(ExecuteFailure::Authority(authority_error)),
                    }
                }
                Err(host_error) => Err(ExecuteFailure::Host(host_error)),
            },
            authority_error = &mut authority_watchdog => {
                sidecar_token.cancel();
                // Await the sidecar future so its error path kills and reaps
                // the child before authority loss leaves this scope.
                let _ = sidecar.await;
                if token.is_cancelled() {
                    Err(ExecuteFailure::Host(HostError::Aborted))
                } else {
                    Err(ExecuteFailure::Authority(authority_error))
                }
            }
        }?;
        parse_response(response).map_err(ExecuteFailure::from)
    }
    .await;

    let (terminal_status, release_reason) = match &execution {
        Ok(_) => (TaskWorkspaceTerminalStatus::Completed, "run_completed"),
        Err(ExecuteFailure::Host(HostError::Aborted)) => {
            (TaskWorkspaceTerminalStatus::Aborted, "run_aborted")
        }
        Err(ExecuteFailure::Authority(error)) => match error.reason() {
            TaskWorkspaceAuthorityLossReason::Expired => {
                (TaskWorkspaceTerminalStatus::Expired, "ttl_expired")
            }
            TaskWorkspaceAuthorityLossReason::RootIdentityChanged => {
                (TaskWorkspaceTerminalStatus::Failed, "root_identity_changed")
            }
            TaskWorkspaceAuthorityLossReason::ScopeMismatch => {
                (TaskWorkspaceTerminalStatus::Failed, "scope_mismatch")
            }
            TaskWorkspaceAuthorityLossReason::Revoked => {
                (TaskWorkspaceTerminalStatus::Failed, "authority_revoked")
            }
            TaskWorkspaceAuthorityLossReason::AccessDenied => {
                (TaskWorkspaceTerminalStatus::Failed, "access_denied")
            }
            TaskWorkspaceAuthorityLossReason::Invalid => {
                (TaskWorkspaceTerminalStatus::Failed, "binding_invalid")
            }
            TaskWorkspaceAuthorityLossReason::RegistryUnavailable => {
                (TaskWorkspaceTerminalStatus::Failed, "registry_unavailable")
            }
        },
        Err(ExecuteFailure::Host(_)) => (TaskWorkspaceTerminalStatus::Failed, "run_failed"),
    };
    let revoke_result =
        revoke_task_workspace_binding(app, &workspace_ref, terminal_status, release_reason).await;

    match execution {
        Ok(response) => {
            revoke_result?;
            Ok(response)
        }
        Err(error) => {
            if let Err(revoke_error) = revoke_result {
                eprintln!(
                    "[pi-agent-host] failed to close task workspace binding for {}: {:?}",
                    req.request_id, revoke_error
                );
            }
            Err(error.into_host_error())
        }
    }
}

async fn execute_without_workspace<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: &PiAgentExecuteRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
    scope: IssueTaskWorkspaceBinding<'_>,
    unavailable: TaskWorkspaceUnavailable,
    native_session: Option<ExactNativeSession<'_>>,
) -> Result<PiAgentHostResponse, HostError> {
    if unavailable.source != WorkspaceRecoverySource::WorkspaceRecovery
        || !matches!(
            unavailable.reason_code,
            WorkspaceRecoveryReason::None | WorkspaceRecoveryReason::Ambiguous
        )
    {
        return Err(HostError::Protocol(format!(
            "Workspace recovery returned an unsupported unavailable state: {}/{}",
            unavailable.source.as_str(),
            unavailable.reason_code.as_str()
        )));
    }
    publish_workspace_unavailable(req, on_event, scope, &unavailable)?;

    let cwd = neutral_cwd(app)?;
    let session_dir = app_pi_session_dir(app, scope.thread_id)?;
    append_sidecar_audit(
        app,
        PI_LANE,
        SidecarAudit {
            request_id: &req.request_id,
            project_id: Some(scope.project_id),
            employee_id: req.employee_id.as_deref(),
            provider_profile_id: None,
            credential_recorded: false,
        },
        &cwd,
        "started",
    );
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), PI_LANE)?;
    let agent_dir = app_pi_agent_dir(app);
    let payload = sidecar_payload(
        req,
        ExecuteWorkspacePayload::Unavailable {
            reason_code: unavailable.reason_code.as_str(),
        },
        &session_dir,
        agent_dir.as_deref(),
        None,
        native_session.map(|session| session.file),
        native_session.map(|session| session.id),
    )?;
    let response = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_binding: None,
            env: pi_env(None),
            payload,
            token,
            on_event: Some(on_event),
            register_stdin: Some(&req.request_id),
            stream_request_id: Some(&req.request_id),
        },
    )
    .await?;
    parse_response(response)
}

fn publish_workspace_unavailable(
    req: &PiAgentExecuteRequest,
    on_event: &Channel<PiAgentHostEvent>,
    scope: IssueTaskWorkspaceBinding<'_>,
    unavailable: &TaskWorkspaceUnavailable,
) -> Result<(), HostError> {
    publish_host_event(
        Some(&req.request_id),
        Some(on_event),
        PiAgentHostEvent::WorkspaceUnavailable {
            project_id: scope.project_id.to_string(),
            thread_id: scope.thread_id.to_string(),
            turn_id: scope.turn_id.to_string(),
            request_id: scope.request_id.to_string(),
            source: unavailable.source.as_str().into(),
            reason_code: unavailable.reason_code.as_str().into(),
        },
        "Send Pi workspace unavailable event",
    )
}

pub(super) async fn do_execute<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: PiAgentExecuteRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
    is_resume: bool,
) -> Result<PiAgentHostResponse, HostError> {
    let company_id = required_text(Some(&req.company_id), "companyId", PI_LANE)?;
    let thread_id = required_text(Some(&req.thread_id), "threadId", PI_LANE)?;
    let project_id = required_text(req.project_id.as_ref(), "projectId", PI_LANE)?;
    let turn_id = required_text(req.root_run_id.as_ref(), "rootRunId", PI_LANE)?;
    let access = TaskWorkspaceAccess::from_permission_mode(req.permission_mode.as_deref());
    let scope = IssueTaskWorkspaceBinding {
        company_id,
        project_id,
        thread_id,
        turn_id,
        request_id: &req.request_id,
        access,
    };
    validate_execute_workspace_requirement(&req, is_resume)?;
    let resume_history_id = validate_workspace_binding_history_mode(
        is_resume,
        req.workspace_binding_history_id.as_deref(),
    )?;
    if is_resume && req.competitive_draft.is_some() {
        return Err(HostError::Request(
            "Competitive draft attempts cannot use durable resume.".into(),
        ));
    }
    if is_resume && req.native_session_mode.is_fresh() {
        return Err(HostError::Request(
            "Durable Resume must open its exact native session and cannot start fresh.".into(),
        ));
    }
    if !req.native_session_mode.is_fresh()
        && req
            .native_session_reset_source_run_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(HostError::Request(
            "nativeSessionResetSourceRunId is accepted only by an explicit fresh-session retry."
                .into(),
        ));
    }
    let conversation_session = if is_resume {
        None
    } else {
        let resolved =
            resolve_conversation_native_session_for_execute(app, company_id, thread_id, turn_id)
                .await;
        if req.native_session_mode.is_fresh() {
            match resolved {
                Err(error) if native_session_can_start_fresh(&error) => {
                    let source_failed_root_run_id = required_text(
                        req.native_session_reset_source_run_id.as_ref(),
                        "nativeSessionResetSourceRunId",
                        PI_LANE,
                    )?;
                    persist_conversation_native_session_reset(
                        app,
                        company_id,
                        thread_id,
                        source_failed_root_run_id,
                        turn_id,
                    )
                    .await?;
                    match resolve_conversation_native_session_for_execute(
                        app, company_id, thread_id, turn_id,
                    )
                    .await?
                    {
                        None => None,
                        Some(_) => {
                            return Err(HostError::NativeSessionPrestart {
                                code: "native-session-reset-persistence",
                                message: "The fresh-session reset marker did not become the Conversation's durable session authority."
                                    .into(),
                            });
                        }
                    }
                }
                Err(error) => return Err(error),
                Ok(Some(_)) => {
                    return Err(HostError::Request(
                        "Start fresh session is allowed only after the tracked native session is missing or invalid."
                            .into(),
                    ));
                }
                Ok(None) => {
                    return Err(HostError::Request(
                        "This Conversation has no broken tracked native session to reset.".into(),
                    ));
                }
            }
        } else {
            resolved?
        }
    };
    let response = match resolve_task_workspace_for_turn(app, scope, resume_history_id).await? {
        TaskWorkspaceResolution::Bound {
            binding,
            resume_session,
        } => {
            let resumed_exact_session = match resume_session.as_ref() {
                Some(crate::task_workspace_binding::NativeSessionReference::FileBacked {
                    file,
                    id,
                }) => Some(ExactNativeSession {
                    file: file.as_path(),
                    id: id.as_str(),
                }),
                Some(crate::task_workspace_binding::NativeSessionReference::Opaque {
                    engine_id,
                    ..
                }) => {
                    return Err(HostError::Request(format!(
                        "Cannot resume a {engine_id} native session through the API engine."
                    )));
                }
                None => None,
            };
            let exact_session = resumed_exact_session.or_else(|| {
                conversation_session
                    .as_ref()
                    .map(|session| ExactNativeSession {
                        file: session.0.as_path(),
                        id: session.1.as_str(),
                    })
            });
            execute_with_bound_workspace(app, &req, on_event, token, scope, *binding, exact_session)
                .await?
        }
        TaskWorkspaceResolution::Unavailable(unavailable)
            if req.workspace_requirement.is_optional() =>
        {
            execute_without_workspace(
                app,
                &req,
                on_event,
                token,
                scope,
                unavailable,
                conversation_session
                    .as_ref()
                    .map(|session| ExactNativeSession {
                        file: session.0.as_path(),
                        id: session.1.as_str(),
                    }),
            )
            .await?
        }
        TaskWorkspaceResolution::Unavailable(unavailable) => {
            publish_workspace_unavailable(&req, on_event, scope, &unavailable)?;
            return Err(workspace_unavailable_error(&unavailable));
        }
    };
    publish_host_event(
        Some(&req.request_id),
        Some(on_event),
        PiAgentHostEvent::Result {
            response: Box::new(response.clone()),
        },
        "Send Pi result event",
    )?;
    Ok(response)
}

pub(super) fn validate_workspace_binding_history_mode(
    is_resume: bool,
    history_id: Option<&str>,
) -> Result<Option<&str>, HostError> {
    if is_resume {
        let history_id = history_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                HostError::Request(
                    "workspaceBindingHistoryId is required for agent_runtime_resume.".into(),
                )
            })?;
        return Ok(Some(history_id));
    }
    if history_id.is_some() {
        return Err(HostError::Request(
            "workspaceBindingHistoryId is accepted only by agent_runtime_resume; a normal execute always binds the current Project folder."
                .into(),
        ));
    }
    Ok(None)
}

/// Shared execute implementation used by the agent runtime gateway.
pub(super) async fn execute_impl(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_with_mode(app, req, on_event, false).await
}

pub(super) async fn resume_impl(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_with_mode(app, req, on_event, true).await
}

async fn execute_with_mode(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
    is_resume: bool,
) -> Result<PiAgentHostResponse, String> {
    let request_id = req.request_id.clone();
    begin_run_stream(&request_id);
    let token = IN_FLIGHT.register(&request_id);
    let result = do_execute(&app, req, &on_event, token.clone(), is_resume).await;
    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(response) => {
            // Keep the completed answer in the terminal snapshot as well as the
            // buffered Result event. If replay retention has advanced past the
            // Result, a reloaded renderer can still durably project the answer.
            finish_run_stream(&request_id, "completed", Some(response.text.clone()));
            Ok(response)
        }
        Err(HostError::Aborted) => {
            finish_run_stream(&request_id, "aborted", None);
            Ok(PiAgentHostResponse {
                text: String::new(),
                reasoning: None,
                session_id: None,
                session_file: None,
                model: None,
                provenance: None,
                usage: None,
                budget_usage: None,
            })
        }
        Err(error) => {
            let (code, message) = error.into_code_message(PI_LANE);
            let _ = publish_host_event(
                Some(&request_id),
                Some(&on_event),
                PiAgentHostEvent::Error {
                    code: code.clone(),
                    message: message.clone(),
                },
                "Send Pi error event",
            );
            finish_run_stream(&request_id, "failed", Some(message.clone()));
            Err(format!("{code}: {message}"))
        }
    }
}

/// Resolve a dedicated, non-project working directory for ephemeral model jobs.
/// Resource discovery is disabled in the host as a second boundary, but the cwd
/// itself must never point at the repository or the user's home directory.
pub(crate) fn neutral_cwd<R: tauri::Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, HostError> {
    let cwd = std::env::temp_dir()
        .join("offisim-agent-runtime")
        .join("isolated");
    std::fs::create_dir_all(&cwd)
        .map_err(|err| HostError::Request(format!("Create isolated agent cwd: {err}")))?;
    Ok(cwd)
}

async fn do_enhance<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: PiAgentEnhanceRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
) -> Result<PiAgentHostResponse, HostError> {
    let _ = required_text(Some(&req.request_id), "requestId", PI_LANE)?;
    let _ = required_text(Some(&req.text), "text", PI_LANE)?;
    let _ = required_text(Some(&req.system_prompt), "systemPrompt", PI_LANE)?;
    // No project workspace, no session dir, no audit row: enhance is ephemeral.
    let cwd = neutral_cwd(app)?;
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), PI_LANE)?;
    let agent_dir = app_pi_agent_dir(app);
    let payload = enhance_payload(&req, &cwd, agent_dir.as_deref());
    // No UI/MCP tools are enabled, but stdin stays open for the mandatory
    // execution-target acknowledgement before the one-shot prompt.
    let response = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_binding: None,
            env: pi_env(None),
            payload,
            token,
            on_event: Some(on_event),
            register_stdin: Some(req.request_id.as_str()),
            stream_request_id: None,
        },
    )
    .await?;
    let response = parse_response(response)?;
    on_event
        .send(PiAgentHostEvent::Result {
            response: Box::new(response.clone()),
        })
        .map_err(|err| HostError::Request(format!("Send Pi enhance result event: {err}")))?;
    Ok(response)
}

/// Shared enhance impl. The agent-agnostic `agent_runtime_enhance` gateway command
/// calls this. Same IN_FLIGHT registration as execute (so an enhance is cancelable
/// via `agent_runtime_abort` with the same request id), but routed to the isolated
/// `do_enhance` — no project bind, no tools, no persistence.
pub(super) async fn enhance_impl(
    app: AppHandle,
    req: PiAgentEnhanceRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    let request_id = req.request_id.clone();
    let token = IN_FLIGHT.register(&request_id);
    let result = do_enhance(&app, req, &on_event, token.clone()).await;
    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(response) => Ok(response),
        Err(HostError::Aborted) => Ok(PiAgentHostResponse {
            text: String::new(),
            reasoning: None,
            session_id: None,
            session_file: None,
            model: None,
            provenance: None,
            usage: None,
            budget_usage: None,
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

async fn do_collaborate<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: PiAgentCollaborateRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
) -> Result<PiAgentHostResponse, HostError> {
    let _ = required_text(Some(&req.request_id), "requestId", PI_LANE)?;
    let _ = required_text(Some(&req.text), "text", PI_LANE)?;
    let capability_profile = required_text(
        req.capability_profile.as_ref(),
        "capabilityProfile",
        PI_LANE,
    )?;
    if capability_profile != "collaboration" {
        return Err(HostError::Request(format!(
            "Pi Agent collaboration request requires capabilityProfile=collaboration, got {capability_profile}"
        )));
    }
    let _ = required_text(Some(&req.company_id), "companyId", PI_LANE)?;
    let _ = required_text(
        Some(&req.collaboration_thread_id),
        "collaborationThreadId",
        PI_LANE,
    )?;
    // No project workspace, no session dir, no audit row: collaboration is
    // ephemeral and company-scoped. Deliberately does NOT call
    // `project_workspace_root` / `resolved_request_cwd`.
    let cwd = neutral_cwd(app)?;
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), PI_LANE)?;
    let agent_dir = app_pi_agent_dir(app);
    let payload = collaborate_payload(&req, &cwd, agent_dir.as_deref());
    // Every collaboration profile needs stdin for the execution-target ACK.
    // Read-only collaboration additionally reuses it for MCP results.
    let register_stdin = Some(req.request_id.as_str());
    let response = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_binding: None,
            env: pi_env(None),
            payload,
            token,
            on_event: Some(on_event),
            register_stdin,
            stream_request_id: None,
        },
    )
    .await?;
    let response = parse_response(response)?;
    on_event
        .send(PiAgentHostEvent::Result {
            response: Box::new(response.clone()),
        })
        .map_err(|err| HostError::Request(format!("Send Pi collaboration result event: {err}")))?;
    Ok(response)
}

/// Shared collaboration impl. The agent-agnostic `agent_runtime_collaborate` gateway
/// command calls this. Same IN_FLIGHT registration as execute (so a collaboration
/// turn is cancelable via `agent_runtime_abort` with the same request id), but
/// routed to the isolated `do_collaborate` — no project bind, no tools, no
/// persistence, no delegation, no mission bridge.
pub(super) async fn collaborate_impl(
    app: AppHandle,
    req: PiAgentCollaborateRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    let request_id = req.request_id.clone();
    let token = IN_FLIGHT.register(&request_id);
    let result = do_collaborate(&app, req, &on_event, token.clone()).await;
    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(response) => Ok(response),
        Err(HostError::Aborted) => Ok(PiAgentHostResponse {
            text: String::new(),
            reasoning: None,
            session_id: None,
            session_file: None,
            model: None,
            provenance: None,
            usage: None,
            budget_usage: None,
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

/// Shared abort impl. Cancels the in-flight token for `request_id` (a missing id
/// means the run already ended — not an error). `agent_runtime_abort` calls this.
pub(super) fn abort_impl(request_id: String) -> Result<(), String> {
    if let Some(token) = IN_FLIGHT.pluck(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod workspace_call_dispatch_tests {
    use super::*;

    #[tokio::test]
    async fn workspace_call_joinset_keeps_calls_parallel_and_cancels_only_the_target_id() {
        for operation in [
            "executeBash",
            "fileRead",
            "fileWrite",
            "fileStat",
            "fileList",
            "fileFind",
            "fileGrep",
        ] {
            assert!(is_cancellable_workspace_call(operation));
        }
        assert!(!is_cancellable_workspace_call("diff"));

        let slow_cancellation = CancellationToken::new();
        let other_cancellation = CancellationToken::new();
        let mut cancellations = HashMap::from([
            ("slow".to_string(), slow_cancellation.clone()),
            ("other".to_string(), other_cancellation.clone()),
        ]);
        let mut tasks = JoinSet::<WorkspaceCallJoinResult>::new();
        let slow_wait = slow_cancellation.clone();
        tasks.spawn(async move {
            slow_wait.cancelled().await;
            ("slow".to_string(), Ok(()))
        });
        tasks.spawn(async { ("fast".to_string(), Ok(())) });

        let first = tokio::time::timeout(Duration::from_millis(100), tasks.join_next())
            .await
            .expect("a fast worktree call must not queue behind another workspace call")
            .expect("fast workspace call join")
            .expect("fast workspace call task");
        assert_eq!(first.0, "fast");
        assert!(!slow_cancellation.is_cancelled());
        assert!(!other_cancellation.is_cancelled());

        cancellations
            .get("slow")
            .expect("slow cancellation token")
            .cancel();
        let second = tokio::time::timeout(Duration::from_millis(100), tasks.join_next())
            .await
            .expect("targeted workspace-call cancellation must settle")
            .expect("slow workspace call join")
            .expect("slow workspace call task");
        cancellations.remove(&second.0);
        assert_eq!(second.0, "slow");
        assert!(!other_cancellation.is_cancelled());
    }
}
