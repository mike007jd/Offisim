pub(crate) mod commands;

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle};
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{
    append_sidecar_audit, base_env, dev_workspace_root, required_text, sidecar_script_path,
    AgentHostCliStatusResponse, AgentHostLane, HostError, SidecarAudit, TRUSTED_HOST_ENV_WHITELIST,
};
use crate::browser_agent_gateway::{
    BrowserAgentGateway, BrowserAgentGatewayConfig, BrowserAgentRunScope, BROWSER_MCP_TOKEN_ENV,
    BROWSER_MCP_URL_ENV,
};
use crate::engine_skill_overlay::{
    materialize_engine_context_overlay, resolve_engine_skill_paths, EngineSkillOverlayKind,
};
use crate::git::{
    create_competitive_draft_workspace_lease, verify_competitive_draft_attempt,
    CompetitiveDraftContext,
};
use crate::in_flight::InFlightRegistry;
use crate::pi_agent_host::run::{neutral_cwd, run_pi_sidecar_jsonl, PiSidecarRun};
use crate::pi_agent_host::stream::{
    begin_run_stream, finish_run_stream, publish_host_event, reattach_stream, release_stream,
    stream_snapshot,
};
use crate::pi_agent_host::{PiAgentHostEvent, PiAgentHostResponse, PiRunStreamSnapshot};
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaudeModelSource {
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    checked_at: Option<String>,
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
    permission_mode: Option<String>,
    #[serde(default)]
    effort: Option<String>,
    #[serde(default)]
    speed_mode: Option<String>,
    system_prompt_append: Option<String>,
    #[serde(default)]
    project_experience: Option<String>,
    #[serde(default)]
    skill_paths: Option<Vec<String>>,
    #[serde(default)]
    project_skill_paths: Option<Vec<String>>,
    #[serde(default)]
    workspace_requirement: ClaudeWorkspaceRequirement,
    native_session_id: Option<String>,
    #[serde(default)]
    competitive_draft: Option<CompetitiveDraftContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaudeAgentEnhanceRequest {
    request_id: String,
    text: String,
    expected_target: ClaudeExecutionTarget,
    system_prompt: String,
    source_provenance: Option<serde_json::Value>,
}

pub(crate) type ClaudeAgentStatusResponse = AgentHostCliStatusResponse;

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

fn validate_target(
    target: &ClaudeExecutionTarget,
    speed_mode: Option<&str>,
) -> Result<(), HostError> {
    if target.engine_id != ENGINE_ID
        || target.account_id != "claude:local"
        || target.billing_mode != "subscription"
    {
        return Err(HostError::Request(
            "The Claude request must use the local orchestration engine.".into(),
        ));
    }
    if !matches!(
        target.model_id.as_str(),
        "engine-managed" | "sonnet" | "opus" | "haiku" | "fable"
    ) {
        return Err(HostError::Request(format!(
            "The saved Claude model \"{}\" is no longer available.",
            target.model_id
        )));
    }
    if speed_mode == Some("fast") && target.model_id != "opus" {
        return Err(HostError::Request(
            "Claude fast mode requires the explicit opus model; engine-managed and other models are not accepted."
                .into(),
        ));
    }
    if target.model_source.kind != "native"
        || target.model_source.source_url.is_some()
        || target.model_source.checked_at.is_some()
    {
        return Err(HostError::Request(
            "The Claude orchestration target must use native provenance without catalog metadata."
                .into(),
        ));
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
    base_env(TRUSTED_HOST_ENV_WHITELIST, workspace_root)
}

fn claude_run_env(
    workspace_root: Option<&std::path::PathBuf>,
    gateway: &BrowserAgentGatewayConfig,
) -> HashMap<String, String> {
    let mut env = claude_env(workspace_root);
    env.insert(BROWSER_MCP_URL_ENV.into(), gateway.url().into());
    env.insert(BROWSER_MCP_TOKEN_ENV.into(), gateway.token().into());
    env
}

fn execute_payload(
    req: &ClaudeAgentExecuteRequest,
    cwd: &std::path::Path,
    workspace_availability: &str,
    native_session_id: Option<&str>,
    skill_plugin_dir: Option<&std::path::Path>,
    system_prompt_append: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "mode": "execute",
        "requestId": req.request_id,
        "text": req.text,
        "cwd": cwd,
        "workspaceAvailability": workspace_availability,
        "nativeSessionId": native_session_id,
        "permissionMode": req.permission_mode,
        "model": (req.expected_target.model_id != "engine-managed")
            .then_some(req.expected_target.model_id.as_str()),
        "effort": req.effort,
        "speedMode": req.speed_mode,
        "systemPromptAppend": system_prompt_append,
        "skillPluginDir": skill_plugin_dir.map(|path| path.to_string_lossy().to_string()),
        "rootRunId": req.root_run_id,
        "expectedTarget": req.expected_target,
    })
}

async fn run_bound_sidecar<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: &ClaudeAgentExecuteRequest,
    on_event: &Channel<PiAgentHostEvent>,
    token: CancellationToken,
    scope: IssueTaskWorkspaceBinding<'_>,
    binding: &TaskWorkspaceBinding,
    cwd: &std::path::Path,
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
            cwd,
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
    validate_target(&req.expected_target, req.speed_mode.as_deref())?;
    if is_resume && req.workspace_requirement.is_optional() {
        return Err(HostError::Request(
            "workspaceRequirement must be required for durable resume.".into(),
        ));
    }
    let resume_history_id =
        validate_history_mode(is_resume, req.workspace_binding_history_id.as_deref())?;
    if is_resume && req.competitive_draft.is_some() {
        return Err(HostError::Request(
            "Competitive draft attempts cannot use durable resume.".into(),
        ));
    }
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
        let cwd = match req.competitive_draft.as_ref() {
            Some(context) => {
                create_competitive_draft_workspace_lease(app, binding, context)
                    .await
                    .map_err(HostError::Request)?
                    .cwd
            }
            None => binding.canonical_root.clone(),
        };
        (cwd, "bound")
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

    let skill_overlay = if binding.is_some() {
        let paths = resolve_engine_skill_paths(
            &cwd,
            req.skill_paths.as_deref(),
            req.project_skill_paths.as_deref(),
        )
        .map_err(HostError::Request)?;
        materialize_engine_context_overlay(
            &paths,
            EngineSkillOverlayKind::ClaudePlugin,
            req.project_experience.as_deref(),
        )
        .map_err(HostError::Request)?
    } else {
        None
    };
    let system_prompt_append = skill_overlay
        .as_ref()
        .and_then(|overlay| {
            overlay.system_prompt_with_project_experience(req.system_prompt_append.as_deref())
        })
        .or_else(|| req.system_prompt_append.clone());
    let browser_scope = BrowserAgentRunScope::new(
        req.company_id.clone(),
        project_id.to_string(),
        req.thread_id.clone(),
        req.permission_mode.as_deref(),
    )
    .map_err(HostError::Request)?;
    let mut browser_gateway = BrowserAgentGateway::start(app.clone(), browser_scope)
        .await
        .map_err(HostError::Request)?;
    let run_env = claude_run_env(binding.as_ref().map(|_| &cwd), browser_gateway.config());
    let payload = execute_payload(
        &req,
        &cwd,
        availability,
        native_session.as_deref(),
        skill_overlay.as_ref().map(|overlay| overlay.load_path()),
        system_prompt_append.as_deref(),
    );
    let raw = if let Some(binding) = binding.as_deref() {
        run_bound_sidecar(
            app,
            &req,
            on_event,
            token.clone(),
            scope,
            binding,
            &cwd,
            &script_path,
            payload,
            run_env,
        )
        .await
    } else {
        run_pi_sidecar_jsonl(
            app,
            PiSidecarRun {
                script_path: &script_path,
                cwd: &cwd,
                workspace_binding: None,
                env: run_env,
                payload,
                token: token.clone(),
                on_event: Some(on_event),
                register_stdin: Some(req.request_id.as_str()),
                stream_request_id: Some(req.request_id.as_str()),
            },
        )
        .await
    };
    browser_gateway.shutdown().await;

    let verification_error = if raw.is_ok() {
        match (binding.as_deref(), req.competitive_draft.as_ref()) {
            (Some(binding), Some(context)) => {
                verify_competitive_draft_attempt(app, binding, context, &cwd)
                    .await
                    .err()
            }
            _ => None,
        }
    } else {
        None
    };
    let raw = match verification_error {
        Some(error) => Err(HostError::Request(error)),
        None => raw,
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
    validate_target(&req.expected_target, None)?;
    let cwd = neutral_cwd(app)?;
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), CLAUDE_LANE)?;
    let payload = serde_json::json!({
        "mode": "enhance",
        "requestId": req.request_id,
        "text": req.text,
        "cwd": cwd,
        "systemPrompt": req.system_prompt,
        "sourceProvenance": req.source_provenance,
        "expectedTarget": req.expected_target,
    });
    let raw = run_pi_sidecar_jsonl(
        app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_binding: None,
            env: claude_env(None),
            payload,
            token,
            on_event: Some(on_event),
            register_stdin: Some(req.request_id.as_str()),
            stream_request_id: None,
        },
    )
    .await?;
    let response = crate::pi_agent_host::parse_response(raw)?;
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
            env: claude_env(None),
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
    let status: ClaudeAgentStatusResponse =
        serde_json::from_value(raw).map_err(|error| format!("Decode Claude status: {error}"))?;
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
            account_id: "claude:local".into(),
            billing_mode: "subscription".into(),
            model_id: "engine-managed".into(),
            model_source: ClaudeModelSource {
                kind: "native".into(),
                source_url: None,
                checked_at: None,
            },
        }
    }

    #[test]
    fn claude_target_is_canonical_orchestration_identity() {
        for model_id in ["engine-managed", "sonnet", "opus", "haiku", "fable"] {
            let mut valid = target();
            valid.model_id = model_id.into();
            assert!(validate_target(&valid, None).is_ok(), "{model_id}");
        }
        let mut invalid = target();
        invalid.billing_mode = "api".into();
        assert!(matches!(
            validate_target(&invalid, None),
            Err(HostError::Request(_))
        ));
        invalid = target();
        invalid.model_id = "retired-model".into();
        assert!(matches!(
            validate_target(&invalid, None),
            Err(HostError::Request(_))
        ));
    }

    #[test]
    fn claude_fast_mode_requires_explicit_opus() {
        let mut opus = target();
        opus.model_id = "opus".into();
        assert!(validate_target(&opus, Some("fast")).is_ok());
        for model_id in ["engine-managed", "sonnet", "haiku", "fable"] {
            let mut invalid = target();
            invalid.model_id = model_id.into();
            let error = validate_target(&invalid, Some("fast")).unwrap_err();
            assert!(
                matches!(error, HostError::Request(message) if message.contains("explicit opus")),
                "{model_id}"
            );
        }
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
    fn claude_release_host_never_forwards_an_executable_override() {
        assert!(!claude_env(None).contains_key("OFFISIM_CLAUDE_EXECUTABLE"));
    }

    #[test]
    fn claude_release_host_scopes_workspace_env_to_bound_execute_only() {
        let workspace = std::path::PathBuf::from("/tmp/offisim-authorized-workspace");
        assert_eq!(
            claude_env(Some(&workspace))
                .get("OFFISIM_WORKSPACE_ROOT")
                .map(String::as_str),
            Some("/tmp/offisim-authorized-workspace")
        );
        assert!(!claude_env(None).contains_key("OFFISIM_WORKSPACE_ROOT"));
    }

    #[test]
    fn claude_execute_payload_never_contains_a_session_file() {
        let mut explicit_target = target();
        explicit_target.model_id = "opus".into();
        let request = ClaudeAgentExecuteRequest {
            request_id: "request".into(),
            text: "work".into(),
            expected_target: explicit_target,
            company_id: "company".into(),
            thread_id: "thread".into(),
            project_id: Some("project".into()),
            employee_id: None,
            root_run_id: Some("run".into()),
            workspace_binding_history_id: None,
            native_session_mode: ClaudeNativeSessionMode::Tracked,
            native_session_reset_source_run_id: None,
            permission_mode: Some("auto".into()),
            effort: Some("xhigh".into()),
            speed_mode: Some("fast".into()),
            system_prompt_append: None,
            project_experience: None,
            skill_paths: None,
            project_skill_paths: None,
            workspace_requirement: ClaudeWorkspaceRequirement::Required,
            native_session_id: Some("opaque-session".into()),
            competitive_draft: None,
        };
        let payload = execute_payload(
            &request,
            std::path::Path::new("/tmp/project"),
            "bound",
            request.native_session_id.as_deref(),
            Some(std::path::Path::new("/tmp/offisim-skills-plugin")),
            None,
        );
        assert_eq!(payload["nativeSessionId"], "opaque-session");
        assert!(payload.get("sessionFile").is_none());
        assert_eq!(payload["expectedTarget"]["engineId"], "claude");
        assert_eq!(payload["model"], "opus");
        assert_eq!(payload["effort"], "xhigh");
        assert_eq!(payload["speedMode"], "fast");
        assert_eq!(payload["skillPluginDir"], "/tmp/offisim-skills-plugin");

        let encoded = serde_json::to_value(&request).unwrap();
        let decoded: ClaudeAgentExecuteRequest = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded.effort.as_deref(), Some("xhigh"));
        assert_eq!(decoded.speed_mode.as_deref(), Some("fast"));
    }
}
