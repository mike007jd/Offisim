use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{
    append_sidecar_audit, dev_workspace_root, project_workspace_root, required_text,
    resolve_node_executable, resolved_request_cwd, sidecar_script_path, HostError, SidecarAudit,
};
use crate::in_flight::InFlightRegistry;
use crate::sidecar_stderr::{
    read_capped_line, read_capped_to_end, sanitized_stderr, MAX_SIDECAR_OUTPUT_BYTES,
};

use super::bridge::{
    handle_mcp_call, handle_verify_call, handle_worktree_call, pi_stdin_guard, write_mcp_result,
    PiMcpResult, StdinGuard, PI_MCP_CALL_TIMEOUT,
};
use super::payload::{
    app_pi_agent_dir, app_pi_session_dir, collaborate_payload, enhance_payload, pi_env,
    sidecar_payload, write_payload,
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

pub(super) struct PiSidecarRun<'a> {
    pub script_path: &'a Path,
    pub cwd: &'a Path,
    pub workspace_root: Option<&'a Path>,
    pub env: HashMap<String, String>,
    pub payload: serde_json::Value,
    pub token: CancellationToken,
    pub on_event: Option<&'a Channel<PiAgentHostEvent>>,
    pub register_stdin: Option<&'a str>,
    pub stream_request_id: Option<&'a str>,
}

async fn kill_child(child: &mut Child) {
    let _ = child.kill().await;
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

pub(super) async fn run_pi_sidecar_jsonl<R: tauri::Runtime>(
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
        workspace_root,
        env,
        payload,
        token,
        on_event,
        register_stdin,
        stream_request_id,
    } = run;
    let node_executable = resolve_node_executable(script_path);
    let mut command = Command::new(&node_executable);
    command
        .arg(script_path)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // The explicit error path below always kills and waits. Keep this as the
        // final guard for cancellation/panic while the future owns the child.
        .kill_on_drop(true);

    let mut child = command.spawn().map_err(|err| {
        HostError::Spawn(format!(
            "Failed to spawn Pi Agent host via `{}`: {}",
            node_executable.display(),
            err
        ))
    })?;
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

        loop {
            tokio::select! {
                _ = token.cancelled() => {
                    return Err(HostError::Aborted);
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
                    tokio::select! {
                        _ = token.cancelled() => {
                            return Err(HostError::Aborted);
                        }
                        result = handle_worktree_call(register_stdin, workspace_root, id, op, args) => {
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
                        result = handle_verify_call(app, register_stdin, id, project_id, cwd, command) => {
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
        // Tokio's `Child::kill` sends SIGKILL/TerminateProcess and then waits,
        // so every failed protocol/request/abort path reaps the host before return.
        kill_child(&mut child).await;
    }
    result
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
    let agent_dir = app_pi_agent_dir(app);
    let payload = sidecar_payload(&req, &cwd, &session_dir, agent_dir.as_deref());
    let response = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_root: Some(&workspace_root),
            env: pi_env(Some(&workspace_root)),
            payload,
            token,
            on_event: Some(on_event),
            register_stdin: Some(&req.request_id),
            stream_request_id: Some(&req.request_id),
        },
    )
    .await?;
    let response = parse_response(response)?;
    publish_host_event(
        Some(&req.request_id),
        Some(on_event),
        PiAgentHostEvent::Result {
            response: response.clone(),
        },
        "Send Pi result event",
    )?;
    Ok(response)
}

/// Shared execute implementation used by the agent runtime gateway.
pub(super) async fn execute_impl(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    let request_id = req.request_id.clone();
    begin_run_stream(&request_id);
    let token = IN_FLIGHT.register(&request_id);
    let result = do_execute(&app, req, &on_event, token.clone()).await;
    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(response) => {
            finish_run_stream(&request_id, "completed", None);
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

/// Resolve a NEUTRAL working directory for the enhance path — a dir that is NOT a
/// project workspace. Mirrors `status_impl`'s cwd resolution (dev root, else home,
/// else cwd). Enhance must never run with a project bound, so it deliberately does
/// not call `project_workspace_root` / `resolved_request_cwd`.
fn neutral_cwd<R: tauri::Runtime>(app: &AppHandle<R>) -> PathBuf {
    dev_workspace_root()
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
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
    let cwd = neutral_cwd(app);
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), PI_LANE)?;
    let agent_dir = app_pi_agent_dir(app);
    let payload = enhance_payload(&req, &cwd, agent_dir.as_deref());
    // `register_stdin: None` — enhance has no extension-UI response channel, so
    // stdin is closed immediately after the single payload line (single-shot).
    let response = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_root: None,
            env: pi_env(None),
            payload,
            token,
            on_event: Some(on_event),
            register_stdin: None,
            stream_request_id: None,
        },
    )
    .await?;
    let response = parse_response(response)?;
    on_event
        .send(PiAgentHostEvent::Result {
            response: response.clone(),
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
    let cwd = neutral_cwd(app);
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), PI_LANE)?;
    let agent_dir = app_pi_agent_dir(app);
    let payload = collaborate_payload(&req, &cwd, agent_dir.as_deref());
    // Strict collaboration registers zero tools and closes stdin. Read-only
    // collaboration keeps stdin open so the host can receive MCP results through
    // the same JSONL response channel as work runs.
    let register_stdin = if req.collaboration_profile.as_deref() == Some("collaboration_read") {
        Some(req.request_id.as_str())
    } else {
        None
    };
    let response = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_root: None,
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
            response: response.clone(),
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
