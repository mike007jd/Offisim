pub(crate) mod commands;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle};
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{
    append_sidecar_audit, dev_workspace_root, required_text, sidecar_script_path, trusted_host_env,
    AgentHostLane, HostError, SidecarAudit,
};
use crate::in_flight::InFlightRegistry;
use crate::pi_agent_host::run::{neutral_cwd, run_pi_sidecar_jsonl, PiSidecarRun};
use crate::pi_agent_host::stream::{
    begin_run_stream, finish_run_stream, publish_host_event, reattach_stream, release_stream,
    stream_snapshot,
};
use crate::pi_agent_host::{
    AiRuntimeStatusResponse, PiAgentHostEvent, PiAgentHostResponse, PiRunStreamSnapshot,
};
use crate::task_workspace_binding::{
    persist_conversation_native_session_reset,
    resolve_conversation_opaque_native_session_for_execute, resolve_task_workspace_for_turn,
    revoke_task_workspace_binding, validate_task_workspace_binding_authority,
    workspace_bound_event, IssueTaskWorkspaceBinding, NativeSessionReference,
    OpaqueNativeSessionExpectation, TaskWorkspaceAccess, TaskWorkspaceBinding,
    TaskWorkspaceResolution, TaskWorkspaceTerminalStatus,
};

pub(crate) const CLAUDE_HOST_PROTOCOL_VERSION: u64 = 1;
const ENGINE_ID: &str = "claude";
const AUTHORITY_RECHECK_INTERVAL: Duration = Duration::from_millis(250);

const CLAUDE_LANE: AgentHostLane = AgentHostLane {
    name: "Claude Code",
    execution_lane: "claude-agent",
    resource_path: "resources/claude-agent-host.mjs",
    dev_script_name: "scripts/tauri-claude-agent-host.entry.mjs",
    aborted_message: "Claude request stopped",
};

static IN_FLIGHT: InFlightRegistry = InFlightRegistry::new("claude_agent_host");
static SUBSCRIPTION_USAGE: OnceLock<Mutex<HashMap<String, serde_json::Value>>> = OnceLock::new();

fn usage_cache() -> &'static Mutex<HashMap<String, serde_json::Value>> {
    SUBSCRIPTION_USAGE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaudeModelSource {
    kind: String,
    source_url: String,
    checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaudeExecutionTarget {
    engine_id: String,
    account_id: String,
    billing_mode: String,
    model_id: String,
    model_source: ClaudeModelSource,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClaudeWorkspaceRequirement {
    #[default]
    Required,
    Optional,
}

impl ClaudeWorkspaceRequirement {
    fn is_optional(self) -> bool {
        self == Self::Optional
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClaudeNativeSessionMode {
    #[default]
    Tracked,
    Fresh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaudeAgentExecuteRequest {
    request_id: String,
    text: String,
    expected_target: ClaudeExecutionTarget,
    company_id: String,
    thread_id: String,
    project_id: Option<String>,
    employee_id: Option<String>,
    root_run_id: Option<String>,
    workspace_binding_history_id: Option<String>,
    #[serde(default)]
    native_session_mode: ClaudeNativeSessionMode,
    native_session_reset_source_run_id: Option<String>,
    model: Option<String>,
    runtime_model_ref: Option<String>,
    permission_mode: Option<String>,
    thinking_level: Option<String>,
    system_prompt_append: Option<String>,
    #[serde(default)]
    workspace_requirement: ClaudeWorkspaceRequirement,
    native_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaudeAgentEnhanceRequest {
    request_id: String,
    text: String,
    expected_target: ClaudeExecutionTarget,
    system_prompt: String,
    model: Option<String>,
    runtime_model_ref: Option<String>,
    thinking_level: Option<String>,
    source_provenance: Option<serde_json::Value>,
}

pub(crate) type ClaudeAgentStatusResponse = AiRuntimeStatusResponse;

fn empty_response() -> PiAgentHostResponse {
    PiAgentHostResponse {
        text: String::new(),
        reasoning: None,
        session_id: None,
        session_file: None,
        model: None,
        provenance: None,
        usage: None,
        budget_usage: None,
        subscription_usage: None,
    }
}

fn into_claude_code_message(error: HostError) -> (String, String) {
    let (code, message) = error.into_code_message(CLAUDE_LANE);
    (
        code,
        message
            .replace("Pi Agent", "Claude Code")
            .replace("Pi workspace", "Claude workspace"),
    )
}

fn validate_target(target: &ClaudeExecutionTarget) -> Result<(), HostError> {
    if target.engine_id != ENGINE_ID || target.billing_mode != "subscription" {
        return Err(HostError::Request(
            "The Claude request is bound to another engine or billing lane.".into(),
        ));
    }
    for (value, label) in [
        (&target.account_id, "expectedTarget.accountId"),
        (&target.model_id, "expectedTarget.modelId"),
        (&target.model_source.kind, "expectedTarget.modelSource.kind"),
        (
            &target.model_source.source_url,
            "expectedTarget.modelSource.sourceUrl",
        ),
        (
            &target.model_source.checked_at,
            "expectedTarget.modelSource.checkedAt",
        ),
    ] {
        required_text(Some(value), label, CLAUDE_LANE)?;
    }
    Ok(())
}

fn validate_history_mode(
    is_resume: bool,
    history_id: Option<&str>,
) -> Result<Option<&str>, HostError> {
    if is_resume {
        return history_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(Some)
            .ok_or_else(|| {
                HostError::Request(
                    "workspaceBindingHistoryId is required for claude_agent_resume.".into(),
                )
            });
    }
    if history_id.is_some() {
        return Err(HostError::Request(
            "workspaceBindingHistoryId is accepted only by claude_agent_resume.".into(),
        ));
    }
    Ok(None)
}

async fn resolve_native_session<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: &ClaudeAgentExecuteRequest,
    root_run_id: &str,
    resume_session: Option<&NativeSessionReference>,
    is_resume: bool,
) -> Result<Option<String>, HostError> {
    if req.native_session_mode == ClaudeNativeSessionMode::Fresh {
        if is_resume {
            return Err(HostError::Request(
                "A durable Claude resume cannot also start a fresh native session.".into(),
            ));
        }
        let source_run_id = required_text(
            req.native_session_reset_source_run_id.as_ref(),
            "nativeSessionResetSourceRunId",
            CLAUDE_LANE,
        )?;
        persist_conversation_native_session_reset(
            app,
            &req.company_id,
            &req.thread_id,
            source_run_id,
            root_run_id,
        )
        .await?;
    }

    let expectation = OpaqueNativeSessionExpectation {
        engine_id: ENGINE_ID,
        account_id: &req.expected_target.account_id,
        billing_mode: &req.expected_target.billing_mode,
        protocol_version: CLAUDE_HOST_PROTOCOL_VERSION,
    };

    let durable = if is_resume {
        match resume_session {
            Some(NativeSessionReference::Opaque {
                engine_id,
                account_id,
                billing_mode,
                id,
            }) if engine_id == ENGINE_ID
                && account_id == &req.expected_target.account_id
                && billing_mode == &req.expected_target.billing_mode
                && !id.trim().is_empty() =>
            {
                Some(id.clone())
            }
            _ => {
                return Err(HostError::NativeSessionPrestart {
                    code: "native-session-invalid",
                    message: "The interrupted Claude task has no compatible native session.".into(),
                })
            }
        }
    } else {
        resolve_conversation_opaque_native_session_for_execute(
            app,
            &req.company_id,
            &req.thread_id,
            root_run_id,
            expectation,
        )
        .await?
    };

    if req.native_session_mode == ClaudeNativeSessionMode::Fresh {
        if durable.is_some() {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-conflict",
                message: "The fresh Claude session reset did not become durable authority.".into(),
            });
        }
        return Ok(None);
    }

    if let Some(requested) = req
        .native_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if durable.as_deref() != Some(requested) {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-invalid",
                message:
                    "The requested Claude session does not match durable Conversation authority."
                        .into(),
            });
        }
    }
    Ok(durable)
}

fn claude_env(workspace_root: Option<&std::path::PathBuf>) -> HashMap<String, String> {
    trusted_host_env(workspace_root, &[], "OFFISIM_CLAUDE_EXECUTABLE")
}

fn cache_subscription_usage(account_id: &str, response: &PiAgentHostResponse) {
    let Some(usage) = response.subscription_usage.clone() else {
        return;
    };
    if let Ok(mut cache) = usage_cache().lock() {
        cache.insert(account_id.to_string(), usage);
    }
}

fn merge_cached_usage(status: &mut ClaudeAgentStatusResponse) {
    let Ok(cache) = usage_cache().lock() else {
        return;
    };
    for account in &mut status.accounts {
        let Some(account_id) = account.get("accountId").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(usage) = cache.get(account_id) else {
            continue;
        };
        account["usage"] = usage.clone();
        if let Some(capabilities) = account
            .get_mut("capabilities")
            .and_then(serde_json::Value::as_object_mut)
        {
            capabilities.insert("usage".into(), serde_json::json!({ "status": "available" }));
        }
    }
}

fn execute_payload(
    req: &ClaudeAgentExecuteRequest,
    cwd: &std::path::Path,
    workspace_availability: &str,
    native_session_id: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "mode": "execute",
        "requestId": req.request_id,
        "text": req.text,
        "cwd": cwd,
        "workspaceAvailability": workspace_availability,
        "nativeSessionId": native_session_id,
        "model": req.model,
        "permissionMode": req.permission_mode,
        "thinkingLevel": req.thinking_level,
        "systemPromptAppend": req.system_prompt_append,
        "rootRunId": req.root_run_id,
        "expectedTarget": req.expected_target,
        "runtimeModelRef": req.runtime_model_ref,
    })
}

async fn run_bound_sidecar<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: &ClaudeAgentExecuteRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
    scope: IssueTaskWorkspaceBinding<'_>,
    binding: &TaskWorkspaceBinding,
    script_path: &std::path::Path,
    payload: serde_json::Value,
    env: HashMap<String, String>,
) -> Result<serde_json::Value, HostError> {
    validate_task_workspace_binding_authority(app, &binding.binding_ref, scope)
        .map_err(|error| error.into_host_error())?;
    let run_token = token.clone();
    let run = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path,
            cwd: &binding.canonical_root,
            workspace_binding: Some(binding),
            env,
            payload,
            token: run_token,
            on_event: Some(on_event),
            register_stdin: Some(req.request_id.as_str()),
            stream_request_id: Some(req.request_id.as_str()),
        },
    );
    tokio::pin!(run);
    loop {
        tokio::select! {
            result = &mut run => {
                if result.is_ok() {
                    validate_task_workspace_binding_authority(app, &binding.binding_ref, scope)
                        .map_err(|error| error.into_host_error())?;
                }
                return result;
            }
            _ = tokio::time::sleep(AUTHORITY_RECHECK_INTERVAL) => {
                if let Err(error) = validate_task_workspace_binding_authority(
                    app,
                    &binding.binding_ref,
                    scope,
                ) {
                    token.cancel();
                    let _ = (&mut run).await;
                    return Err(error.into_host_error());
                }
            }
        }
    }
}

async fn do_execute<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: ClaudeAgentExecuteRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
    is_resume: bool,
) -> Result<PiAgentHostResponse, HostError> {
    required_text(Some(&req.request_id), "requestId", CLAUDE_LANE)?;
    required_text(Some(&req.text), "text", CLAUDE_LANE)?;
    required_text(Some(&req.company_id), "companyId", CLAUDE_LANE)?;
    required_text(Some(&req.thread_id), "threadId", CLAUDE_LANE)?;
    let project_id = required_text(req.project_id.as_ref(), "projectId", CLAUDE_LANE)?;
    let root_run_id = required_text(req.root_run_id.as_ref(), "rootRunId", CLAUDE_LANE)?;
    let runtime_model_ref = required_text(
        req.runtime_model_ref.as_ref(),
        "runtimeModelRef",
        CLAUDE_LANE,
    )?;
    if !runtime_model_ref.starts_with("claude:") {
        return Err(HostError::Request(
            "runtimeModelRef must be a native Claude selector.".into(),
        ));
    }
    validate_target(&req.expected_target)?;
    if is_resume && req.workspace_requirement.is_optional() {
        return Err(HostError::Request(
            "workspaceRequirement must be required for durable resume.".into(),
        ));
    }
    let resume_history_id =
        validate_history_mode(is_resume, req.workspace_binding_history_id.as_deref())?;
    let scope = IssueTaskWorkspaceBinding {
        company_id: &req.company_id,
        project_id,
        thread_id: &req.thread_id,
        turn_id: root_run_id,
        request_id: &req.request_id,
        access: TaskWorkspaceAccess::from_permission_mode(req.permission_mode.as_deref()),
    };
    let resolution = resolve_task_workspace_for_turn(app, scope, resume_history_id).await?;
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), CLAUDE_LANE)?;

    let (binding, unavailable, resume_session) = match resolution {
        TaskWorkspaceResolution::Bound {
            binding,
            resume_session,
        } => (Some(binding), None, resume_session),
        TaskWorkspaceResolution::Unavailable(unavailable)
            if req.workspace_requirement.is_optional() =>
        {
            (None, Some(unavailable), None)
        }
        TaskWorkspaceResolution::Unavailable(unavailable) => {
            publish_host_event(
                Some(&req.request_id),
                Some(on_event),
                PiAgentHostEvent::WorkspaceUnavailable {
                    project_id: project_id.to_string(),
                    thread_id: req.thread_id.clone(),
                    turn_id: root_run_id.to_string(),
                    request_id: req.request_id.clone(),
                    source: unavailable.source.as_str().into(),
                    reason_code: unavailable.reason_code.as_str().into(),
                },
                "Send Claude workspace unavailable event",
            )?;
            return Err(HostError::Request(
                "Restore or reselect the Project folder before this task accesses files.".into(),
            ));
        }
    };

    let native_session =
        resolve_native_session(app, &req, root_run_id, resume_session.as_ref(), is_resume).await?;

    let (cwd, availability) = if let Some(binding) = binding.as_deref() {
        publish_host_event(
            Some(&req.request_id),
            Some(on_event),
            workspace_bound_event(binding)?,
            "Send Claude workspace binding event",
        )?;
        (binding.canonical_root.clone(), "bound")
    } else {
        let unavailable = unavailable
            .as_ref()
            .expect("unavailable workspace projection");
        publish_host_event(
            Some(&req.request_id),
            Some(on_event),
            PiAgentHostEvent::WorkspaceUnavailable {
                project_id: project_id.to_string(),
                thread_id: req.thread_id.clone(),
                turn_id: root_run_id.to_string(),
                request_id: req.request_id.clone(),
                source: unavailable.source.as_str().into(),
                reason_code: unavailable.reason_code.as_str().into(),
            },
            "Send Claude workspace unavailable event",
        )?;
        (neutral_cwd(app)?, "unavailable")
    };

    append_sidecar_audit(
        app,
        CLAUDE_LANE,
        SidecarAudit {
            request_id: &req.request_id,
            project_id: Some(project_id),
            employee_id: req.employee_id.as_deref(),
            provider_profile_id: None,
            credential_recorded: false,
        },
        &cwd,
        "started",
    );

    let payload = execute_payload(&req, &cwd, availability, native_session.as_deref());
    let raw = if let Some(binding) = binding.as_deref() {
        run_bound_sidecar(
            app,
            &req,
            on_event,
            token.clone(),
            scope,
            binding,
            &script_path,
            payload,
            claude_env(dev_root.as_ref()),
        )
        .await
    } else {
        run_pi_sidecar_jsonl(
            app,
            PiSidecarRun {
                script_path: &script_path,
                cwd: &cwd,
                workspace_binding: None,
                env: claude_env(dev_root.as_ref()),
                payload,
                token: token.clone(),
                on_event: Some(on_event),
                register_stdin: Some(req.request_id.as_str()),
                stream_request_id: Some(req.request_id.as_str()),
            },
        )
        .await
    };

    let raw = if let Some(binding) = binding.as_deref() {
        let status = match &raw {
            Ok(_) => TaskWorkspaceTerminalStatus::Completed,
            Err(HostError::Aborted) => TaskWorkspaceTerminalStatus::Aborted,
            Err(_) => TaskWorkspaceTerminalStatus::Failed,
        };
        let revoke_result =
            revoke_task_workspace_binding(app, &binding.binding_ref, status, "claude_terminal")
                .await;
        match raw {
            Ok(value) => {
                revoke_result?;
                value
            }
            Err(error) => {
                if let Err(revoke_error) = revoke_result {
                    eprintln!(
                        "[claude-agent-host] failed to close task workspace binding for {}: {:?}",
                        req.request_id, revoke_error
                    );
                }
                return Err(error);
            }
        }
    } else {
        raw?
    };
    let response = crate::pi_agent_host::parse_response(raw)?;
    cache_subscription_usage(&req.expected_target.account_id, &response);
    publish_host_event(
        Some(&req.request_id),
        Some(on_event),
        PiAgentHostEvent::Result {
            response: Box::new(response.clone()),
        },
        "Send Claude result event",
    )?;
    append_sidecar_audit(
        app,
        CLAUDE_LANE,
        SidecarAudit {
            request_id: &req.request_id,
            project_id: Some(project_id),
            employee_id: req.employee_id.as_deref(),
            provider_profile_id: None,
            credential_recorded: false,
        },
        &cwd,
        "completed",
    );
    Ok(response)
}

pub(crate) async fn execute_impl(
    app: AppHandle,
    req: ClaudeAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
    is_resume: bool,
) -> Result<PiAgentHostResponse, String> {
    let request_id = req.request_id.clone();
    begin_run_stream(&request_id);
    let token = IN_FLIGHT.register(&request_id);
    let result = do_execute(&app, req, &on_event, token, is_resume).await;
    IN_FLIGHT.clear(&request_id);
    match result {
        Ok(response) => {
            finish_run_stream(&request_id, "completed", Some(response.text.clone()));
            Ok(response)
        }
        Err(HostError::Aborted) => {
            finish_run_stream(&request_id, "aborted", None);
            Ok(empty_response())
        }
        Err(error) => {
            let (code, message) = into_claude_code_message(error);
            let _ = publish_host_event(
                Some(&request_id),
                Some(&on_event),
                PiAgentHostEvent::Error {
                    code: code.clone(),
                    message: message.clone(),
                },
                "Send Claude error event",
            );
            finish_run_stream(&request_id, "failed", Some(message.clone()));
            Err(format!("{code}: {message}"))
        }
    }
}

async fn do_enhance<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: &ClaudeAgentEnhanceRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
) -> Result<PiAgentHostResponse, HostError> {
    required_text(Some(&req.request_id), "requestId", CLAUDE_LANE)?;
    required_text(Some(&req.text), "text", CLAUDE_LANE)?;
    required_text(Some(&req.system_prompt), "systemPrompt", CLAUDE_LANE)?;
    let runtime_model_ref = required_text(
        req.runtime_model_ref.as_ref(),
        "runtimeModelRef",
        CLAUDE_LANE,
    )?;
    if !runtime_model_ref.starts_with("claude:") {
        return Err(HostError::Request(
            "runtimeModelRef must be a native Claude selector.".into(),
        ));
    }
    validate_target(&req.expected_target)?;
    let cwd = neutral_cwd(app)?;
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), CLAUDE_LANE)?;
    let payload = serde_json::json!({
        "mode": "enhance",
        "requestId": req.request_id,
        "text": req.text,
        "cwd": cwd,
        "systemPrompt": req.system_prompt,
        "model": req.model,
        "thinkingLevel": req.thinking_level,
        "sourceProvenance": req.source_provenance,
        "expectedTarget": req.expected_target,
        "runtimeModelRef": req.runtime_model_ref,
    });
    let raw = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_binding: None,
            env: claude_env(dev_root.as_ref()),
            payload,
            token,
            on_event: Some(on_event),
            register_stdin: Some(req.request_id.as_str()),
            stream_request_id: None,
        },
    )
    .await?;
    let response = crate::pi_agent_host::parse_response(raw)?;
    cache_subscription_usage(&req.expected_target.account_id, &response);
    on_event
        .send(PiAgentHostEvent::Result {
            response: Box::new(response.clone()),
        })
        .map_err(|error| HostError::Request(format!("Send Claude enhance result: {error}")))?;
    Ok(response)
}

pub(crate) async fn enhance_impl(
    app: AppHandle,
    req: ClaudeAgentEnhanceRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    let request_id = req.request_id.clone();
    let token = IN_FLIGHT.register(&request_id);
    let result = do_enhance(&app, &req, &on_event, token).await;
    IN_FLIGHT.clear(&request_id);
    match result {
        Ok(response) => Ok(response),
        Err(HostError::Aborted) => Ok(empty_response()),
        Err(error) => {
            let (code, message) = into_claude_code_message(error);
            let _ = on_event.send(PiAgentHostEvent::Error {
                code: code.clone(),
                message: message.clone(),
            });
            Err(format!("{code}: {message}"))
        }
    }
}

pub(crate) fn abort_impl(request_id: String) -> Result<(), String> {
    if let Some(token) = IN_FLIGHT.pluck(&request_id) {
        token.cancel();
    }
    Ok(())
}

pub(crate) async fn status_impl<R: tauri::Runtime>(
    app: AppHandle<R>,
    _include_usage: bool,
) -> Result<ClaudeAgentStatusResponse, String> {
    let cwd = neutral_cwd(&app).map_err(|error| {
        let (_, message) = into_claude_code_message(error);
        message
    })?;
    let dev_root = dev_workspace_root();
    let script_path =
        sidecar_script_path(&app, dev_root.as_ref(), CLAUDE_LANE).map_err(|error| {
            let (_, message) = into_claude_code_message(error);
            message
        })?;
    let raw = run_pi_sidecar_jsonl(
        &app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_binding: None,
            env: claude_env(dev_root.as_ref()),
            payload: serde_json::json!({ "mode": "status" }),
            token: CancellationToken::new(),
            on_event: None,
            register_stdin: None,
            stream_request_id: None,
        },
    )
    .await
    .map_err(|error| {
        let (_, message) = into_claude_code_message(error);
        message
    })?;
    let mut status: ClaudeAgentStatusResponse =
        serde_json::from_value(raw).map_err(|error| format!("Decode Claude status: {error}"))?;
    merge_cached_usage(&mut status);
    Ok(status)
}

pub(crate) fn stream_snapshot_impl(
    request_id: String,
) -> Result<Option<PiRunStreamSnapshot>, String> {
    stream_snapshot(request_id)
}

pub(crate) fn release_stream_impl(request_id: String) -> Result<(), String> {
    release_stream(request_id)
}

pub(crate) fn reattach_impl(
    app: AppHandle,
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiRunStreamSnapshot, String> {
    if stream_snapshot(request_id.clone())?.is_none() {
        return Err(format!("No live Claude stream for request {request_id}"));
    }
    if let Ok(Some(event)) =
        crate::task_workspace_binding::replay_workspace_bound_for_request(&app, &request_id)
    {
        on_event
            .send(event)
            .map_err(|error| format!("Replay Claude workspace binding: {error}"))?;
    }
    reattach_stream(request_id, after_cursor, on_event)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> ClaudeExecutionTarget {
        ClaudeExecutionTarget {
            engine_id: "claude".into(),
            account_id: "claude:subscription:test".into(),
            billing_mode: "subscription".into(),
            model_id: "claude-sonnet-5".into(),
            model_source: ClaudeModelSource {
                kind: "native".into(),
                source_url: "https://code.claude.com/docs/en/agent-sdk/typescript".into(),
                checked_at: "2026-07-16T00:00:00Z".into(),
            },
        }
    }

    #[test]
    fn claude_target_is_subscription_only() {
        assert!(validate_target(&target()).is_ok());
        let mut invalid = target();
        invalid.billing_mode = "api".into();
        assert!(matches!(
            validate_target(&invalid),
            Err(HostError::Request(_))
        ));
    }

    #[test]
    fn claude_resume_history_is_explicit_and_fail_closed() {
        assert_eq!(
            validate_history_mode(true, Some("history")).unwrap(),
            Some("history")
        );
        assert!(validate_history_mode(true, None).is_err());
        assert!(validate_history_mode(false, Some("history")).is_err());
    }

    #[test]
    fn claude_execute_payload_never_contains_a_session_file() {
        let request = ClaudeAgentExecuteRequest {
            request_id: "request".into(),
            text: "work".into(),
            expected_target: target(),
            company_id: "company".into(),
            thread_id: "thread".into(),
            project_id: Some("project".into()),
            employee_id: None,
            root_run_id: Some("run".into()),
            workspace_binding_history_id: None,
            native_session_mode: ClaudeNativeSessionMode::Tracked,
            native_session_reset_source_run_id: None,
            model: Some("claude:sonnet".into()),
            runtime_model_ref: Some("claude:sonnet".into()),
            permission_mode: Some("auto".into()),
            thinking_level: None,
            system_prompt_append: None,
            workspace_requirement: ClaudeWorkspaceRequirement::Required,
            native_session_id: Some("opaque-session".into()),
        };
        let payload = execute_payload(
            &request,
            std::path::Path::new("/tmp/project"),
            "bound",
            request.native_session_id.as_deref(),
        );
        assert_eq!(payload["nativeSessionId"], "opaque-session");
        assert!(payload.get("sessionFile").is_none());
        assert_eq!(payload["expectedTarget"]["engineId"], "claude");
    }
}
