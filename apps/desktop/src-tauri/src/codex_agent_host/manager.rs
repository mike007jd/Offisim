use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::sync::{Mutex as AsyncMutex, Notify};

use crate::agent_host_runtime::{codex_binary_path, inspect_codex_cli, AgentHostLane, HostError};
use crate::browser_agent_gateway::{BrowserAgentGateway, BrowserAgentRunScope};
use crate::engine_skill_overlay::{
    materialize_engine_context_overlay, resolve_engine_skill_paths, EngineSkillOverlayKind,
};
use crate::git::{
    create_competitive_draft_workspace_lease, verify_competitive_draft_attempt,
    CompetitiveDraftContext,
};
use crate::task_workspace_binding::{
    persist_conversation_native_session_reset,
    resolve_conversation_opaque_native_session_for_execute, resolve_task_workspace_for_turn,
    revoke_task_workspace_binding, workspace_bound_event, AuthorizedProcessCwd,
    IssueTaskWorkspaceBinding, NativeSessionReference, OpaqueNativeSessionExpectation,
    TaskWorkspaceAccess, TaskWorkspaceBinding, TaskWorkspaceResolution,
    TaskWorkspaceTerminalStatus,
};
use crate::time_util::{rfc3339_from_unix, stable_hex};

use super::protocol::{
    CodexConnection, CodexHostError, StartupCancellation, CODEX_ADAPTER_ID, CODEX_ADAPTER_VERSION,
};
use super::run_options::{
    codex_run_option_model, validate_codex_run_selection, ValidatedCodexRunSelection,
};
use super::stream::{
    opaque_session_id, PendingInteractionKind, PendingUserInputQuestion, RunMetadata, RunOutcome,
    RunStream,
};
use super::types::{
    CodexAdapterIdentity, CodexAgentEnhanceRequest, CodexAgentExecuteRequest, CodexAgentHostEvent,
    CodexAgentHostResponse, CodexAgentStatusResponse, CodexExecutionProvenance,
    CodexExecutionTarget, CodexImageInput, CodexModelSummary, CodexNativeSessionMode,
    CodexNativeThreadRef, CodexRunStreamSnapshot,
};
use super::CODEX_HOST_PROTOCOL_VERSION;

const ENGINE_ID: &str = "codex";
const ACCOUNT_ID: &str = "codex:local";
const BILLING_MODE: &str = "subscription";
const MODEL_ID: &str = "engine-managed";
const NATIVE_THREAD_PROTOCOL: &str = "codex-app-server";
const TERMINAL_STREAM_TTL: Duration = Duration::from_secs(30 * 60);
const INTERRUPT_ACK_TIMEOUT: Duration = Duration::from_secs(3);
const INTERRUPT_TERMINAL_TIMEOUT: Duration = Duration::from_secs(6);
const CODEX_LANE: AgentHostLane = AgentHostLane {
    name: "Codex CLI app-server",
    execution_lane: ENGINE_ID,
    // AgentHostLane keeps script-path fields for the Pi sidecar resolver. The
    // Codex adapter never resolves either path; it launches the PATH CLI.
    resource_path: "codex",
    dev_script_name: "codex",
    aborted_message: "The Codex request was aborted.",
};

#[derive(Default)]
struct ManagerInner {
    runs: HashMap<String, Arc<ManagedRun>>,
    starting: HashSet<String>,
    cancelled_starting: HashSet<String>,
    startup_cancellations: HashMap<String, Arc<StartupCancellation>>,
}

pub(crate) struct CodexAgentHostState {
    inner: Mutex<ManagerInner>,
}

impl Default for CodexAgentHostState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(ManagerInner::default()),
        }
    }
}

impl CodexAgentHostState {
    fn guard(&self) -> std::sync::MutexGuard<'_, ManagerInner> {
        self.inner
            .lock()
            .unwrap_or_else(|_| panic!("codex agent manager mutex poisoned"))
    }

    fn claim_request(&self, request_id: &str) -> Result<(), String> {
        validate_required(request_id, "requestId")?;
        let mut inner = self.guard();
        if inner.runs.contains_key(request_id) || !inner.starting.insert(request_id.to_string()) {
            return Err("A Codex request with this id is already active.".into());
        }
        inner.cancelled_starting.remove(request_id);
        inner
            .startup_cancellations
            .insert(request_id.to_string(), Arc::new(StartupCancellation::new()));
        Ok(())
    }

    fn release_claim(&self, request_id: &str) {
        let mut inner = self.guard();
        inner.starting.remove(request_id);
        inner.cancelled_starting.remove(request_id);
        inner.startup_cancellations.remove(request_id);
    }

    fn starting_was_cancelled(&self, request_id: &str) -> bool {
        self.guard().cancelled_starting.contains(request_id)
    }

    fn startup_cancellation(&self, request_id: &str) -> Option<Arc<StartupCancellation>> {
        self.guard().startup_cancellations.get(request_id).cloned()
    }

    fn cancel_starting(&self, request_id: &str) -> bool {
        let mut inner = self.guard();
        if !inner.starting.contains(request_id) {
            return false;
        }
        inner.cancelled_starting.insert(request_id.to_string());
        if let Some(cancellation) = inner.startup_cancellations.get(request_id) {
            cancellation.cancel();
        }
        true
    }

    fn register_run(&self, request_id: &str, run: Arc<ManagedRun>) -> Result<(), String> {
        let mut inner = self.guard();
        if inner.cancelled_starting.remove(request_id) {
            inner.starting.remove(request_id);
            inner.startup_cancellations.remove(request_id);
            return Err("Codex request was stopped before native work started.".into());
        }
        if !inner.starting.remove(request_id) || inner.runs.contains_key(request_id) {
            inner.startup_cancellations.remove(request_id);
            return Err("Codex request registration lost its startup authority.".into());
        }
        inner.startup_cancellations.remove(request_id);
        inner.runs.insert(request_id.to_string(), run);
        Ok(())
    }

    fn run(&self, request_id: &str) -> Option<Arc<ManagedRun>> {
        self.guard().runs.get(request_id).cloned()
    }

    fn remove_terminal_run(&self, request_id: &str) -> Result<Option<Arc<ManagedRun>>, String> {
        let mut inner = self.guard();
        let Some(run) = inner.runs.get(request_id) else {
            return Ok(None);
        };
        if run.stream.terminal_outcome().is_none() {
            return Err("A running Codex stream cannot be released.".into());
        }
        Ok(inner.runs.remove(request_id))
    }

    fn remove_if_same(&self, request_id: &str, run: &Arc<ManagedRun>) {
        let mut inner = self.guard();
        if inner
            .runs
            .get(request_id)
            .is_some_and(|current| Arc::ptr_eq(current, run))
        {
            inner.runs.remove(request_id);
        }
    }
}

struct ManagedRun {
    connection: Arc<CodexConnection>,
    stream: Arc<RunStream>,
    binding_ref: Option<String>,
    workspace_root: Option<PathBuf>,
    workspace_binding: Option<TaskWorkspaceBinding>,
    competitive_draft: Option<CompetitiveDraftContext>,
    cleanup_error: Mutex<Option<String>>,
    cleanup_done: AtomicBool,
    cleanup_notify: Notify,
    control_gate: AsyncMutex<()>,
}

impl ManagedRun {
    fn new(
        connection: Arc<CodexConnection>,
        stream: Arc<RunStream>,
        binding_ref: Option<String>,
        workspace_root: Option<PathBuf>,
        workspace_binding: Option<TaskWorkspaceBinding>,
        competitive_draft: Option<CompetitiveDraftContext>,
    ) -> Arc<Self> {
        Arc::new(Self {
            connection,
            stream,
            binding_ref,
            workspace_root,
            workspace_binding,
            competitive_draft,
            cleanup_error: Mutex::new(None),
            cleanup_done: AtomicBool::new(false),
            cleanup_notify: Notify::new(),
            control_gate: AsyncMutex::new(()),
        })
    }

    async fn wait_cleanup(&self) {
        loop {
            if self.cleanup_done.load(Ordering::Acquire) {
                return;
            }
            let notified = self.cleanup_notify.notified();
            if self.cleanup_done.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }

    fn mark_cleanup_done(&self) {
        self.cleanup_done.store(true, Ordering::Release);
        self.cleanup_notify.notify_waiters();
    }

    fn set_cleanup_error(&self, error: String) {
        *self
            .cleanup_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(error);
    }

    fn cleanup_error(&self) -> Option<String> {
        self.cleanup_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

struct WorkspaceRunContext {
    process_cwd: Option<AuthorizedProcessCwd>,
    cwd: PathBuf,
    binding_ref: Option<String>,
    binding: Option<TaskWorkspaceBinding>,
    resume_session: Option<NativeSessionReference>,
}

struct NativeThreadSetup {
    native_thread_ref: CodexNativeThreadRef,
    actual_model_id: Option<String>,
}

struct NativeThreadStart<'a> {
    cwd: &'a Path,
    continuation: Option<&'a CodexNativeThreadRef>,
    requested_model: Option<&'a str>,
    ephemeral: bool,
    policy: &'a PermissionPolicy,
    developer_instructions: Option<&'a str>,
}

struct NativeTurnStart<'a> {
    cwd: &'a Path,
    thread_id: &'a str,
    actual_model: &'a str,
    requested_model: Option<&'a str>,
    effort: Option<&'a str>,
    service_tier: Option<&'a str>,
    policy: &'a PermissionPolicy,
    client_user_message_id: &'a str,
    text: &'a str,
    images: &'a [CodexImageInput],
}

struct PermissionPolicy {
    thread_sandbox: &'static str,
    approval_policy: Value,
    turn_sandbox: Value,
    native_collaboration_mode: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExecuteMode {
    Execute,
    Resume,
}

impl ExecuteMode {
    fn from_resume(require_resume: bool) -> Self {
        if require_resume {
            Self::Resume
        } else {
            Self::Execute
        }
    }

    fn is_resume(self) -> bool {
        self == Self::Resume
    }
}

pub(super) async fn execute_impl(
    app: AppHandle,
    req: CodexAgentExecuteRequest,
    on_event: Channel<CodexAgentHostEvent>,
    require_resume: bool,
) -> Result<CodexAgentHostResponse, String> {
    validate_execute_request(&req)?;
    validate_execution_target(&req.expected_target)?;
    let run_selection = validate_codex_run_selection(
        &req.expected_target.model_id,
        req.effort.as_deref(),
        req.speed_mode.as_deref(),
    )?;
    let mode = ExecuteMode::from_resume(require_resume);
    validate_execute_mode(&req, mode)?;
    let state = app.state::<CodexAgentHostState>();
    state.claim_request(&req.request_id)?;

    let result = execute_claimed(app.clone(), &state, &req, on_event, mode, run_selection).await;
    if state.run(&req.request_id).is_none() {
        state.release_claim(&req.request_id);
    }
    result
}

async fn execute_claimed(
    app: AppHandle,
    state: &CodexAgentHostState,
    req: &CodexAgentExecuteRequest,
    on_event: Channel<CodexAgentHostEvent>,
    mode: ExecuteMode,
    run_selection: ValidatedCodexRunSelection,
) -> Result<CodexAgentHostResponse, String> {
    let startup_cancellation = state
        .startup_cancellation(&req.request_id)
        .ok_or_else(|| "Codex request startup authority is unavailable.".to_string())?;
    let requested_continuation = resolve_requested_continuation(req, mode)?;
    let execute_continuation = if mode.is_resume() {
        None
    } else {
        resolve_execute_continuation(&app, req, requested_continuation.as_ref()).await?
    };

    if state.starting_was_cancelled(&req.request_id) {
        return Err("Codex request was stopped before native work started.".into());
    }

    let stream = RunStream::new(req.request_id.clone(), on_event);
    let workspace = prepare_workspace(&app, req, &stream, mode).await?;
    let continuation = if mode.is_resume() {
        resolve_resume_continuation(
            workspace.resume_session.as_ref(),
            &req.expected_target,
            requested_continuation.as_ref(),
        )?
    } else {
        execute_continuation
    };
    let policy = match permission_policy(
        req.permission_mode.as_deref(),
        &workspace.cwd,
        workspace.process_cwd.is_some(),
    ) {
        Ok(policy) => policy,
        Err(error) => {
            revoke_prestart_binding(&app, workspace.binding_ref.as_deref(), false).await;
            return Err(error);
        }
    };
    let run_id = req
        .root_run_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(req.request_id.as_str())
        .to_string();
    let provenance =
        execution_provenance(&req.expected_target, &run_id, run_selection.requested_model);
    publish_prepared(
        &stream,
        &req.request_id,
        &run_id,
        &req.expected_target,
        &provenance,
    )?;

    if state.starting_was_cancelled(&req.request_id) {
        revoke_prestart_binding(&app, workspace.binding_ref.as_deref(), true).await;
        stream.finish_interrupted("Codex request was stopped before native work started.");
        return Err("Codex request was stopped before native work started.".into());
    }

    let binary = codex_binary_path()?;
    let neutral = neutral_cwd(&app)?;
    let skill_overlay = if workspace.process_cwd.is_some() {
        match resolve_engine_skill_paths(
            &workspace.cwd,
            req.skill_paths.as_deref(),
            req.project_skill_paths.as_deref(),
        )
        .and_then(|paths| {
            materialize_engine_context_overlay(
                &paths,
                EngineSkillOverlayKind::CodexHome,
                req.project_experience.as_deref(),
            )
        }) {
            Ok(overlay) => overlay,
            Err(message) => {
                revoke_prestart_binding(&app, workspace.binding_ref.as_deref(), false).await;
                stream.finish_failed("codex_skill_export_failed", message.clone());
                return Err(message);
            }
        }
    } else {
        None
    };
    let browser_scope = BrowserAgentRunScope::new(
        req.company_id.clone(),
        req.project_id
            .clone()
            .ok_or_else(|| "projectId is required for the browser gateway".to_string())?,
        req.thread_id.clone(),
        req.permission_mode.as_deref(),
    )?;
    let browser_gateway = match BrowserAgentGateway::start(app.clone(), browser_scope).await {
        Ok(gateway) => gateway,
        Err(error) => {
            revoke_prestart_binding(&app, workspace.binding_ref.as_deref(), false).await;
            stream.finish_failed("browser_gateway_unavailable", error.clone());
            return Err(error);
        }
    };
    let connection = match CodexConnection::spawn_trusted(
        &binary,
        workspace.process_cwd.as_ref(),
        &neutral,
        Some(Arc::clone(&stream)),
        Some(&startup_cancellation),
        skill_overlay.as_ref().map(|overlay| overlay.load_path()),
        Some(browser_gateway),
    )
    .await
    {
        Ok(connection) => connection,
        Err(error) => {
            if startup_cancellation.is_cancelled() {
                revoke_prestart_binding(&app, workspace.binding_ref.as_deref(), true).await;
                stream.finish_interrupted("Codex request was stopped before native work started.");
                return Err("Codex request was stopped before native work started.".into());
            }
            revoke_prestart_binding(&app, workspace.binding_ref.as_deref(), false).await;
            stream.finish_failed("codex_unavailable", error.to_string());
            return Err(error.to_string());
        }
    };
    if state.starting_was_cancelled(&req.request_id) {
        connection.terminate().await;
        revoke_prestart_binding(&app, workspace.binding_ref.as_deref(), true).await;
        stream.finish_interrupted("Codex request was stopped before native work started.");
        return Err("Codex request was stopped before native work started.".into());
    }

    let run = ManagedRun::new(
        connection,
        Arc::clone(&stream),
        workspace.binding_ref.clone(),
        workspace
            .process_cwd
            .as_ref()
            .map(|scope| scope.cwd().to_path_buf()),
        workspace.binding.clone(),
        req.competitive_draft.clone(),
    );
    if let Err(error) = state.register_run(&req.request_id, Arc::clone(&run)) {
        run.stream.finish_interrupted(error.clone());
        run.connection.terminate().await;
        revoke_prestart_binding(&app, run.binding_ref.as_deref(), true).await;
        return Err(error);
    }
    spawn_terminal_cleanup(app, req.request_id.clone(), Arc::clone(&run));

    let developer_instructions = skill_overlay
        .as_ref()
        .and_then(|overlay| {
            overlay.system_prompt_with_project_experience(req.system_prompt_append.as_deref())
        })
        .or_else(|| req.system_prompt_append.clone());
    let setup = start_native_thread(
        &run.connection,
        NativeThreadStart {
            cwd: &workspace.cwd,
            continuation: continuation.as_ref(),
            requested_model: run_selection.requested_model,
            ephemeral: false,
            policy: &policy,
            developer_instructions: developer_instructions.as_deref(),
        },
    )
    .await;

    match setup {
        Ok(setup) => {
            let Some(actual_model_id) = setup.actual_model_id.as_deref() else {
                run.stream.finish_failed(
                    "codex_model_missing",
                    "Codex did not report the exact model selected for this thread.",
                );
                return finish_invoke(&run).await;
            };
            let actual_model_id = actual_model_id.to_string();
            let model = model_summary(&actual_model_id);
            let mut provenance = provenance;
            provenance.actual_model_id = Some(actual_model_id.clone());
            let opaque = match opaque_session_id(&setup.native_thread_ref) {
                Ok(opaque) => opaque,
                Err(error) => {
                    run.stream.finish_failed("codex_session_invalid", error);
                    return finish_invoke(&run).await;
                }
            };
            run.stream.set_metadata(RunMetadata {
                model: model.clone(),
                provenance,
                native_thread_ref: setup.native_thread_ref.clone(),
                expose_session: true,
            });
            run.stream.publish(CodexAgentHostEvent::Started {
                session_id: Some(opaque),
                session_file: None,
                model: Some(model),
                model_fallback_message: None,
                native_runtime_version: run.connection.runtime_user_agent(),
            });
            if let Err(error) = start_native_turn(
                &run.connection,
                NativeTurnStart {
                    cwd: &workspace.cwd,
                    thread_id: &setup.native_thread_ref.thread_id,
                    actual_model: &actual_model_id,
                    requested_model: run_selection.requested_model,
                    effort: run_selection.effort,
                    service_tier: run_selection.service_tier,
                    policy: &policy,
                    client_user_message_id: req
                        .client_user_message_id
                        .as_deref()
                        .unwrap_or(req.request_id.as_str()),
                    text: &req.text,
                    images: &req.images,
                },
            )
            .await
            {
                if run.stream.terminal_outcome().is_none() {
                    run.stream
                        .finish_failed("codex_turn_start_failed", error.to_string());
                }
            }
        }
        Err(error) => {
            if run.stream.terminal_outcome().is_none() {
                let message = trusted_tracked_thread_resume_error(
                    mode,
                    req.native_session_mode,
                    continuation.as_ref(),
                    &error,
                )
                .unwrap_or_else(|| error.to_string());
                run.stream.finish_failed("codex_start_failed", message);
            }
        }
    }

    finish_invoke(&run).await
}

pub(super) async fn enhance_impl(
    app: AppHandle,
    req: CodexAgentEnhanceRequest,
    on_event: Channel<CodexAgentHostEvent>,
) -> Result<CodexAgentHostResponse, String> {
    validate_required(&req.request_id, "requestId")?;
    validate_required(&req.text, "text")?;
    validate_required(&req.system_prompt, "systemPrompt")?;
    validate_execution_target(&req.expected_target)?;
    let run_selection = validate_codex_run_selection(&req.expected_target.model_id, None, None)?;
    if req
        .source_provenance
        .as_ref()
        .is_some_and(|provenance| !provenance.is_object())
    {
        return Err("sourceProvenance must be an execution provenance object.".into());
    }
    let state = app.state::<CodexAgentHostState>();
    state.claim_request(&req.request_id)?;

    let result = enhance_claimed(
        app.clone(),
        &state,
        &req,
        on_event,
        run_selection.requested_model,
    )
    .await;
    if state.run(&req.request_id).is_none() {
        state.release_claim(&req.request_id);
    }
    result
}

async fn enhance_claimed(
    app: AppHandle,
    state: &CodexAgentHostState,
    req: &CodexAgentEnhanceRequest,
    on_event: Channel<CodexAgentHostEvent>,
    requested_model: Option<&'static str>,
) -> Result<CodexAgentHostResponse, String> {
    let startup_cancellation = state
        .startup_cancellation(&req.request_id)
        .ok_or_else(|| "Codex request startup authority is unavailable.".to_string())?;
    let stream = RunStream::new(req.request_id.clone(), on_event);
    let provenance = execution_provenance(&req.expected_target, &req.request_id, requested_model);
    publish_prepared(
        &stream,
        &req.request_id,
        &req.request_id,
        &req.expected_target,
        &provenance,
    )?;
    if state.starting_was_cancelled(&req.request_id) {
        stream.finish_interrupted("Codex request was stopped before native work started.");
        return Err("Codex request was stopped before native work started.".into());
    }

    let neutral = neutral_cwd(&app)?;
    // Prompt Enhance is read-only because it has no Project workspace, but it
    // is not a planning Turn. Keep Codex in its native default collaboration
    // mode so Enhance cannot inherit a sticky Plan mode from native state.
    let policy = permission_policy(Some("auto"), &neutral, false)?;
    let binary = codex_binary_path()?;
    let connection = match CodexConnection::spawn_trusted(
        &binary,
        None,
        &neutral,
        Some(Arc::clone(&stream)),
        Some(&startup_cancellation),
        None,
        None,
    )
    .await
    {
        Ok(connection) => connection,
        Err(error) => {
            if startup_cancellation.is_cancelled() {
                stream.finish_interrupted("Codex request was stopped before native work started.");
                return Err("Codex request was stopped before native work started.".into());
            }
            stream.finish_failed("codex_unavailable", error.to_string());
            return Err(error.to_string());
        }
    };
    if state.starting_was_cancelled(&req.request_id) {
        connection.terminate().await;
        stream.finish_interrupted("Codex request was stopped before native work started.");
        return Err("Codex request was stopped before native work started.".into());
    }
    let run = ManagedRun::new(connection, Arc::clone(&stream), None, None, None, None);
    if let Err(error) = state.register_run(&req.request_id, Arc::clone(&run)) {
        run.stream.finish_interrupted(error.clone());
        run.connection.terminate().await;
        return Err(error);
    }
    spawn_terminal_cleanup(app, req.request_id.clone(), Arc::clone(&run));

    match start_native_thread(
        &run.connection,
        NativeThreadStart {
            cwd: &neutral,
            continuation: None,
            requested_model,
            ephemeral: true,
            policy: &policy,
            developer_instructions: Some(&req.system_prompt),
        },
    )
    .await
    {
        Ok(setup) => {
            let Some(actual_model_id) = setup.actual_model_id.as_deref() else {
                run.stream.finish_failed(
                    "codex_model_missing",
                    "Codex did not report the exact model selected for this thread.",
                );
                return finish_invoke(&run).await;
            };
            let actual_model_id = actual_model_id.to_string();
            let model = model_summary(&actual_model_id);
            let mut provenance = provenance;
            provenance.actual_model_id = Some(actual_model_id.clone());
            run.stream.set_metadata(RunMetadata {
                model: model.clone(),
                provenance,
                native_thread_ref: setup.native_thread_ref.clone(),
                expose_session: false,
            });
            run.stream.publish(CodexAgentHostEvent::Started {
                session_id: None,
                session_file: None,
                model: Some(model),
                model_fallback_message: None,
                native_runtime_version: run.connection.runtime_user_agent(),
            });
            if let Err(error) = start_native_turn(
                &run.connection,
                NativeTurnStart {
                    cwd: &neutral,
                    thread_id: &setup.native_thread_ref.thread_id,
                    actual_model: &actual_model_id,
                    requested_model,
                    effort: None,
                    service_tier: None,
                    policy: &policy,
                    client_user_message_id: &req.request_id,
                    text: &req.text,
                    images: &[],
                },
            )
            .await
            {
                if run.stream.terminal_outcome().is_none() {
                    run.stream
                        .finish_failed("codex_turn_start_failed", error.to_string());
                }
            }
        }
        Err(error) => {
            if run.stream.terminal_outcome().is_none() {
                run.stream
                    .finish_failed("codex_enhance_failed", error.to_string());
            }
        }
    }
    finish_invoke(&run).await
}

async fn finish_invoke(run: &Arc<ManagedRun>) -> Result<CodexAgentHostResponse, String> {
    let outcome = run.stream.wait_outcome().await;
    run.wait_cleanup().await;
    if let Some(error) = run.cleanup_error() {
        return Err(error);
    }
    match outcome {
        RunOutcome::Completed(response) => Ok(*response),
        RunOutcome::Interrupted(message) | RunOutcome::Failed(message) => Err(message),
    }
}

fn spawn_terminal_cleanup(app: AppHandle, request_id: String, run: Arc<ManagedRun>) {
    tauri::async_runtime::spawn(async move {
        let outcome = run.stream.wait_outcome().await;
        {
            // Stop owns this gate while it claims the terminal stream and sends
            // the native interrupt. Natural completion takes it only for reap.
            let _gate = run.control_gate.lock().await;
            run.connection.terminate().await;
        }
        if let Some(binding_ref) = run.binding_ref.as_deref() {
            if matches!(&outcome, RunOutcome::Completed(_)) {
                if let (Some(binding), Some(context), Some(cwd)) = (
                    run.workspace_binding.as_ref(),
                    run.competitive_draft.as_ref(),
                    run.workspace_root.as_deref(),
                ) {
                    if let Err(error) =
                        verify_competitive_draft_attempt(&app, binding, context, cwd).await
                    {
                        run.set_cleanup_error(error);
                    }
                }
            }
            let (status, reason) = match &outcome {
                RunOutcome::Completed(_) => {
                    (TaskWorkspaceTerminalStatus::Completed, "run_completed")
                }
                RunOutcome::Interrupted(_) => (TaskWorkspaceTerminalStatus::Aborted, "run_aborted"),
                RunOutcome::Failed(_) => (TaskWorkspaceTerminalStatus::Failed, "run_failed"),
            };
            let _ = revoke_task_workspace_binding(&app, binding_ref, status, reason).await;
        }
        run.mark_cleanup_done();
        tokio::time::sleep(TERMINAL_STREAM_TTL).await;
        app.state::<CodexAgentHostState>()
            .remove_if_same(&request_id, &run);
    });
}

async fn prepare_workspace(
    app: &AppHandle,
    req: &CodexAgentExecuteRequest,
    stream: &Arc<RunStream>,
    mode: ExecuteMode,
) -> Result<WorkspaceRunContext, String> {
    let company_id = validate_required(&req.company_id, "companyId")?;
    let project_id = validate_required(req.project_id.as_deref().unwrap_or_default(), "projectId")?;
    let thread_id = validate_required(&req.thread_id, "threadId")?;
    let turn_id = validate_required(req.root_run_id.as_deref().unwrap_or_default(), "rootRunId")?;
    let scope = IssueTaskWorkspaceBinding {
        company_id,
        project_id,
        thread_id,
        turn_id,
        request_id: &req.request_id,
        access: TaskWorkspaceAccess::from_permission_mode(req.permission_mode.as_deref()),
    };
    let resume_history_id = mode
        .is_resume()
        .then(|| {
            req.workspace_binding_history_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .flatten();
    let resolution = resolve_task_workspace_for_turn(app, scope, resume_history_id)
        .await
        .map_err(host_error_message)?;
    match resolution {
        TaskWorkspaceResolution::Bound {
            binding,
            resume_session,
        } => {
            let event = workspace_bound_event(&binding).map_err(|_| {
                "The Project workspace declaration could not be created.".to_string()
            })?;
            let event = serde_json::from_value::<CodexAgentHostEvent>(
                serde_json::to_value(event).map_err(|_| {
                    "The Project workspace declaration could not be encoded.".to_string()
                })?,
            )
            .map_err(|_| "The Project workspace declaration could not be decoded.".to_string())?;
            stream.set_workspace_declaration(event);
            let authority = binding.authorized_root();
            let cwd = match req.competitive_draft.as_ref() {
                Some(context) => {
                    create_competitive_draft_workspace_lease(app, &binding, context)
                        .await?
                        .cwd
                }
                None => binding.canonical_root.clone(),
            };
            let process_cwd = AuthorizedProcessCwd::from_authority(&authority, &cwd)
                .map_err(|_| "The Project folder changed while Codex was starting.".to_string())?;
            Ok(WorkspaceRunContext {
                cwd,
                process_cwd: Some(process_cwd),
                binding_ref: Some(binding.binding_ref.clone()),
                binding: Some((*binding).clone()),
                resume_session,
            })
        }
        TaskWorkspaceResolution::Unavailable(unavailable) => {
            stream.set_workspace_declaration(CodexAgentHostEvent::WorkspaceUnavailable {
                project_id: project_id.to_string(),
                thread_id: thread_id.to_string(),
                turn_id: turn_id.to_string(),
                request_id: req.request_id.clone(),
                source: unavailable.source.as_str().into(),
                reason_code: unavailable.reason_code.as_str().into(),
            });
            if !req.workspace_requirement.is_optional() {
                stream.finish_failed(
                    "workspace_unavailable",
                    "The Project folder is unavailable for this task.",
                );
                return Err("The Project folder is unavailable for this task.".into());
            }
            let cwd = neutral_cwd(app)?;
            Ok(WorkspaceRunContext {
                process_cwd: None,
                cwd,
                binding_ref: None,
                binding: None,
                resume_session: None,
            })
        }
    }
}

async fn revoke_prestart_binding(app: &AppHandle, binding_ref: Option<&str>, aborted: bool) {
    let Some(binding_ref) = binding_ref else {
        return;
    };
    let (status, reason) = if aborted {
        (TaskWorkspaceTerminalStatus::Aborted, "run_aborted")
    } else {
        (TaskWorkspaceTerminalStatus::Failed, "run_failed")
    };
    let _ = revoke_task_workspace_binding(app, binding_ref, status, reason).await;
}

async fn start_native_thread(
    connection: &Arc<CodexConnection>,
    request: NativeThreadStart<'_>,
) -> Result<NativeThreadSetup, CodexHostError> {
    let NativeThreadStart {
        cwd,
        continuation,
        requested_model,
        ephemeral,
        policy,
        developer_instructions,
    } = request;
    let cwd_text = cwd.to_str().ok_or_else(|| {
        CodexHostError::Request("The Project folder name is not supported by Codex.".into())
    })?;
    let developer_instructions = developer_instructions
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let thread_result = if let Some(native) = continuation {
        connection
            .request(
                "thread/resume",
                json!({
                    "threadId": native.thread_id,
                    "cwd": cwd_text,
                    "model": requested_model,
                    "approvalPolicy": policy.approval_policy,
                    "sandbox": policy.thread_sandbox,
                    "serviceTier": null,
                    "developerInstructions": developer_instructions,
                }),
            )
            .await?
    } else {
        connection
            .request(
                "thread/start",
                json!({
                    "cwd": cwd_text,
                    "model": requested_model,
                    "approvalPolicy": policy.approval_policy,
                    "sandbox": policy.thread_sandbox,
                    "serviceTier": null,
                    "developerInstructions": developer_instructions,
                    "serviceName": "offisim",
                    "ephemeral": ephemeral,
                }),
            )
            .await?
    };
    let thread = parse_thread_result(&thread_result, cwd, continuation)?;
    let actual_model_id = thread_result
        .as_object()
        .and_then(|result| result.get("model"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Ok(NativeThreadSetup {
        native_thread_ref: thread,
        actual_model_id,
    })
}

async fn start_native_turn(
    connection: &Arc<CodexConnection>,
    request: NativeTurnStart<'_>,
) -> Result<String, CodexHostError> {
    let NativeTurnStart {
        cwd,
        thread_id,
        actual_model,
        requested_model,
        effort,
        service_tier,
        policy,
        client_user_message_id,
        text,
        images,
    } = request;
    let cwd_text = cwd.to_str().ok_or_else(|| {
        CodexHostError::Request("The Project folder name is not supported by Codex.".into())
    })?;
    // Codex collaboration mode is sticky on a native thread. Send an explicit
    // mode on every Turn so Auto -> Plan, Plan -> Auto, and resumed tasks all
    // preserve the Offisim composer selection instead of inheriting old state.
    let collaboration_mode = turn_collaboration_mode(policy, actual_model);

    let mut input = vec![json!({"type": "text", "text": text})];
    input.extend(images.iter().map(|image| {
        json!({
            "type": "image",
            "url": format!("data:{};base64,{}", image.mime_type, image.data),
        })
    }));
    let turn_result = connection
        .request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": input,
                "cwd": cwd_text,
                "clientUserMessageId": client_user_message_id,
                "model": requested_model,
                "effort": effort,
                "serviceTier": service_tier,
                "approvalPolicy": policy.approval_policy,
                "sandboxPolicy": policy.turn_sandbox,
                "collaborationMode": collaboration_mode,
            }),
        )
        .await?;
    let turn = turn_result
        .as_object()
        .and_then(|result| result.get("turn"))
        .and_then(Value::as_object)
        .ok_or(CodexHostError::Protocol)?;
    let turn_id = required_json_string(turn, "id")?.to_string();
    if required_json_string(turn, "status")? != "inProgress" {
        return Err(CodexHostError::Protocol);
    }
    Ok(turn_id)
}

fn turn_collaboration_mode(policy: &PermissionPolicy, model: &str) -> Value {
    json!({
        "mode": policy.native_collaboration_mode,
        "settings": { "model": model },
    })
}

fn parse_thread_result(
    result: &Value,
    expected_cwd: &Path,
    continuation: Option<&CodexNativeThreadRef>,
) -> Result<CodexNativeThreadRef, CodexHostError> {
    let result = result.as_object().ok_or(CodexHostError::Protocol)?;
    let thread = result
        .get("thread")
        .and_then(Value::as_object)
        .ok_or(CodexHostError::Protocol)?;
    let thread_id = required_json_string(thread, "id")?.to_string();
    let session_id = required_json_string(thread, "sessionId")?.to_string();
    let returned_cwd = Path::new(required_json_string(result, "cwd")?);
    if returned_cwd != expected_cwd {
        return Err(CodexHostError::Protocol);
    }
    let native = CodexNativeThreadRef {
        protocol: NATIVE_THREAD_PROTOCOL.into(),
        thread_id,
        session_id,
    };
    if continuation.is_some_and(|expected| expected != &native) {
        return Err(CodexHostError::Request(
            "Codex could not reopen the exact native session for this task.".into(),
        ));
    }
    Ok(native)
}

fn resolve_continuation(
    req: &CodexAgentExecuteRequest,
) -> Result<Option<CodexNativeThreadRef>, String> {
    req.native_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(parse_continuation)
        .transpose()
}

fn resolve_requested_continuation(
    req: &CodexAgentExecuteRequest,
    mode: ExecuteMode,
) -> Result<Option<CodexNativeThreadRef>, String> {
    if mode.is_resume() || req.native_session_mode.is_fresh() {
        return resolve_continuation(req);
    }
    req.native_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(parse_tracked_execute_continuation)
        .transpose()
}

fn parse_tracked_execute_continuation(value: &str) -> Result<CodexNativeThreadRef, String> {
    parse_continuation(value).map_err(|message| {
        let code = if message == "The native session belongs to another runtime engine." {
            "native-session-runtime-incompatible"
        } else {
            "native-session-invalid"
        };
        host_error_message(HostError::NativeSessionPrestart { code, message })
    })
}

fn trusted_tracked_thread_resume_error(
    mode: ExecuteMode,
    native_session_mode: CodexNativeSessionMode,
    continuation: Option<&CodexNativeThreadRef>,
    error: &CodexHostError,
) -> Option<String> {
    if mode.is_resume() || native_session_mode.is_fresh() {
        return None;
    }
    let continuation = continuation?;
    let CodexHostError::Upstream(message) = error else {
        return None;
    };
    // App-server/provider text is untrusted. Recognize only Codex's exact local
    // missing-rollout response for the exact opaque thread we asked it to resume;
    // a reserved prefix or another thread id can never mint reset authority.
    let expected = format!(
        "-32600: no rollout found for thread id {}",
        continuation.thread_id
    );
    if message != &expected {
        return None;
    }
    Some(host_error_message(HostError::NativeSessionPrestart {
        code: "native-session-missing",
        message: "The saved Codex native thread is unavailable.".into(),
    }))
}

fn parse_continuation(value: &str) -> Result<CodexNativeThreadRef, String> {
    let native = serde_json::from_str::<CodexNativeThreadRef>(value)
        .map_err(|_| "The Codex native session reference is invalid.".to_string())?;
    if native.protocol.ne(NATIVE_THREAD_PROTOCOL) {
        return Err("The native session belongs to another runtime engine.".into());
    }
    if native.thread_id.trim().is_empty() || native.session_id.trim().is_empty() {
        return Err("The Codex native session reference is incomplete.".into());
    }
    Ok(native)
}

async fn resolve_execute_continuation(
    app: &AppHandle,
    req: &CodexAgentExecuteRequest,
    requested: Option<&CodexNativeThreadRef>,
) -> Result<Option<CodexNativeThreadRef>, String> {
    let company_id = validate_required(&req.company_id, "companyId")?;
    let thread_id = validate_required(&req.thread_id, "threadId")?;
    let root_run_id =
        validate_required(req.root_run_id.as_deref().unwrap_or_default(), "rootRunId")?;
    if req.native_session_mode.is_fresh() {
        let source_run_id = validate_required(
            req.native_session_reset_source_run_id
                .as_deref()
                .unwrap_or_default(),
            "nativeSessionResetSourceRunId",
        )?;
        persist_conversation_native_session_reset(
            app,
            company_id,
            thread_id,
            source_run_id,
            root_run_id,
        )
        .await
        .map_err(host_error_message)?;
        let after_reset = resolve_conversation_opaque_native_session_for_execute(
            app,
            company_id,
            thread_id,
            root_run_id,
            OpaqueNativeSessionExpectation {
                engine_id: ENGINE_ID,
                account_id: &req.expected_target.account_id,
                billing_mode: &req.expected_target.billing_mode,
                protocol_version: CODEX_HOST_PROTOCOL_VERSION,
            },
        )
        .await
        .map_err(host_error_message)?;
        if after_reset.is_some() {
            return Err(
                "The fresh-session reset did not become the Conversation's durable authority."
                    .into(),
            );
        }
        return Ok(None);
    }
    let durable = resolve_conversation_opaque_native_session_for_execute(
        app,
        company_id,
        thread_id,
        root_run_id,
        OpaqueNativeSessionExpectation {
            engine_id: ENGINE_ID,
            account_id: &req.expected_target.account_id,
            billing_mode: &req.expected_target.billing_mode,
            protocol_version: CODEX_HOST_PROTOCOL_VERSION,
        },
    )
    .await
    .map_err(host_error_message)?
    .as_deref()
    .map(parse_tracked_execute_continuation)
    .transpose()?;

    if let Some(requested) = requested {
        match durable.as_ref() {
            Some(authoritative) if authoritative == requested => {}
            Some(_) => {
                return Err(
                    "The requested Codex session does not match the durable Conversation session."
                        .into(),
                )
            }
            None => {
                return Err(
                    "This Conversation does not authorize the requested Codex session.".into(),
                )
            }
        }
    }
    Ok(durable)
}

fn resolve_resume_continuation(
    resume_session: Option<&NativeSessionReference>,
    target: &CodexExecutionTarget,
    requested: Option<&CodexNativeThreadRef>,
) -> Result<Option<CodexNativeThreadRef>, String> {
    let opaque = match resume_session {
        Some(NativeSessionReference::Opaque {
            engine_id,
            account_id,
            billing_mode,
            id,
        }) if engine_id == ENGINE_ID
            && account_id == &target.account_id
            && billing_mode == &target.billing_mode
            && billing_mode == BILLING_MODE =>
        {
            parse_continuation(id)?
        }
        Some(NativeSessionReference::Opaque { engine_id, .. }) if engine_id != ENGINE_ID => {
            return Err(format!(
                "Cannot resume a {engine_id} native session through the Codex engine."
            ));
        }
        Some(NativeSessionReference::Opaque { .. }) => {
            return Err(
                "The interrupted Codex session belongs to another Codex CLI instance.".into(),
            );
        }
        Some(NativeSessionReference::FileBacked { .. }) => {
            return Err(
                "Codex resume requires an opaque native session, not a session file.".into(),
            )
        }
        None => {
            return Err(
                "The interrupted task has no durable Codex session available to resume.".into(),
            )
        }
    };
    if requested.is_some_and(|requested| requested != &opaque) {
        return Err(
            "The requested Codex session does not match the interrupted task authority.".into(),
        );
    }
    Ok(Some(opaque))
}

fn permission_policy(
    mode: Option<&str>,
    cwd: &Path,
    has_workspace: bool,
) -> Result<PermissionPolicy, String> {
    let mode = mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("auto");
    if !has_workspace {
        return Ok(PermissionPolicy {
            thread_sandbox: "read-only",
            approval_policy: json!("never"),
            turn_sandbox: json!({"type": "readOnly", "networkAccess": false}),
            native_collaboration_mode: if mode == "plan" { "plan" } else { "default" },
        });
    }
    let cwd = cwd
        .to_str()
        .ok_or_else(|| "The Project folder name is not supported by Codex.".to_string())?;
    match mode {
        "plan" => Ok(PermissionPolicy {
            thread_sandbox: "read-only",
            approval_policy: json!("never"),
            turn_sandbox: json!({"type": "readOnly", "networkAccess": false}),
            native_collaboration_mode: "plan",
        }),
        "ask" => Ok(PermissionPolicy {
            thread_sandbox: "read-only",
            approval_policy: json!("on-request"),
            turn_sandbox: json!({"type": "readOnly", "networkAccess": false}),
            native_collaboration_mode: "default",
        }),
        "auto" => Ok(PermissionPolicy {
            thread_sandbox: "workspace-write",
            approval_policy: json!("on-request"),
            turn_sandbox: json!({
                "type": "workspaceWrite",
                "writableRoots": [cwd],
                "networkAccess": false,
                "excludeTmpdirEnvVar": true,
                "excludeSlashTmp": true,
            }),
            native_collaboration_mode: "default",
        }),
        "full" => Ok(PermissionPolicy {
            thread_sandbox: "danger-full-access",
            approval_policy: json!("never"),
            turn_sandbox: json!({"type": "dangerFullAccess"}),
            native_collaboration_mode: "default",
        }),
        _ => Err("The selected Codex permission mode is invalid.".into()),
    }
}

pub(super) async fn abort_impl(app: AppHandle, request_id: String) -> Result<(), String> {
    validate_required(&request_id, "requestId")?;
    let state = app.state::<CodexAgentHostState>();
    if state.cancel_starting(&request_id) {
        return Ok(());
    }
    let run = state.run(&request_id);
    let Some(run) = run else {
        return Ok(());
    };
    if run.stream.terminal_outcome().is_some() {
        return Ok(());
    }
    {
        let _gate = run.control_gate.lock().await;
        if run.stream.terminal_outcome().is_some() {
            return Ok(());
        }
        let native_terminal = if let Some((thread_id, turn_id)) = run.stream.active_native_scope() {
            let _ = tokio::time::timeout(
                INTERRUPT_ACK_TIMEOUT,
                run.connection.request(
                    "turn/interrupt",
                    json!({"threadId": thread_id, "turnId": turn_id}),
                ),
            )
            .await;
            let background_terminals_cleaned =
                clean_native_background_terminals(&run.connection, &thread_id).await;
            let native_terminal =
                tokio::time::timeout(INTERRUPT_TERMINAL_TIMEOUT, run.stream.wait_outcome())
                    .await
                    .ok();
            background_terminals_cleaned
                .then_some(native_terminal)
                .flatten()
        } else {
            None
        };
        if native_terminal.is_none() {
            // Native Codex owns the terminal state while it is responsive. Only
            // after the bounded interrupt window expires do we reap the process
            // and publish the local interrupted fallback. `terminate` disables
            // protocol dispatch first, so no native output can land afterward.
            run.connection.terminate().await;
            run.stream
                .finish_interrupted("Codex request was stopped by the user.");
        }
    }
    if tokio::time::timeout(INTERRUPT_TERMINAL_TIMEOUT, run.wait_cleanup())
        .await
        .is_err()
    {
        run.connection.terminate().await;
    }
    Ok(())
}

async fn clean_native_background_terminals(connection: &CodexConnection, thread_id: &str) -> bool {
    matches!(
        tokio::time::timeout(
            INTERRUPT_ACK_TIMEOUT,
            connection.request(
                "thread/backgroundTerminals/clean",
                json!({"threadId": thread_id}),
            ),
        )
        .await,
        Ok(Ok(_))
    )
}

pub(super) async fn answer_impl(
    app: AppHandle,
    request_id: String,
    id: String,
    confirmed: Option<bool>,
    value: Option<String>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    validate_required(&request_id, "requestId")?;
    validate_required(&id, "id")?;
    let state = app.state::<CodexAgentHostState>();
    let run = state
        .run(&request_id)
        .ok_or_else(|| "No live Codex request is awaiting this answer.".to_string())?;
    let _gate = run.control_gate.lock().await;
    let interaction = run
        .stream
        .pending_interaction(&id)
        .ok_or_else(|| "This Codex interaction is no longer pending.".to_string())?;
    if run.stream.active_native_scope().as_ref()
        != Some(&(interaction.thread_id.clone(), interaction.turn_id.clone()))
    {
        return Err("This Codex interaction belongs to another turn.".into());
    }

    let cancel = cancelled.unwrap_or(false);
    let accept = confirmed.unwrap_or(false) && !cancel;
    let (response, resolution, interrupt_turn) = match &interaction.kind {
        PendingInteractionKind::Command => (
            json!({"decision": approval_decision(cancel, accept)}),
            if cancel { "cancelled" } else { "answered" },
            cancel,
        ),
        PendingInteractionKind::FileChange { grant_root } => (
            json!({
                "decision": file_change_approval_decision(
                    cancel,
                    accept,
                    grant_root.as_deref(),
                    run.workspace_root.as_deref(),
                )
            }),
            if cancel { "cancelled" } else { "answered" },
            cancel,
        ),
        PendingInteractionKind::Permissions {
            requested_permissions,
        } => (
            json!({
                "permissions": if accept {
                    allowed_permission_subset(requested_permissions, run.workspace_root.as_deref())
                } else {
                    json!({})
                },
                "scope": "turn",
            }),
            if cancel { "cancelled" } else { "answered" },
            cancel,
        ),
        PendingInteractionKind::UserInput { questions } => {
            let response = user_input_response(value.as_deref(), questions, cancel)?;
            (
                response,
                if cancel { "cancelled" } else { "answered" },
                false,
            )
        }
    };
    let interaction = run
        .stream
        .take_pending_interaction(&id)
        .ok_or_else(|| "This Codex interaction is no longer pending.".to_string())?;
    run.connection
        .respond(&interaction.native_request_id, response)
        .await
        .map_err(|error| {
            run.stream.finish_failed(
                "codex_interaction_response_failed",
                "Offisim could not return the user interaction to Codex.",
            );
            error.to_string()
        })?;
    run.stream.publish(CodexAgentHostEvent::UiRequestResolved {
        id,
        resolution: resolution.into(),
    });
    if interrupt_turn {
        let _ = run
            .connection
            .request(
                "turn/interrupt",
                json!({"threadId": interaction.thread_id, "turnId": interaction.turn_id}),
            )
            .await;
    }
    Ok(())
}

fn user_input_response(
    raw_value: Option<&str>,
    questions: &[PendingUserInputQuestion],
    cancelled: bool,
) -> Result<Value, String> {
    if cancelled {
        return Ok(json!({"answers": {}}));
    }
    let raw_value = raw_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Codex user input requires structured answers.".to_string())?;
    let value: Value = serde_json::from_str(raw_value)
        .map_err(|_| "Codex user input answers are invalid.".to_string())?;
    let root = value
        .as_object()
        .filter(|root| root.len() == 1)
        .ok_or_else(|| "Codex user input answers are invalid.".to_string())?;
    let answers = root
        .get("answers")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex user input answers are invalid.".to_string())?;
    let expected = questions
        .iter()
        .map(|question| question.id.as_str())
        .collect::<HashSet<_>>();
    if answers.len() != expected.len() || answers.keys().any(|id| !expected.contains(id.as_str())) {
        return Err("Codex user input answers do not match the pending questions.".into());
    }
    let mut projected = Map::new();
    let mut total_chars = 0_usize;
    for question in questions {
        let answer = answers
            .get(&question.id)
            .and_then(Value::as_object)
            .filter(|answer| answer.len() == 1)
            .and_then(|answer| answer.get("answers"))
            .and_then(Value::as_array)
            .ok_or_else(|| "Codex user input answers are invalid.".to_string())?;
        if answer.len() > 16 {
            return Err("Codex user input answers are too large.".into());
        }
        let mut values = Vec::with_capacity(answer.len());
        for value in answer {
            let value = value
                .as_str()
                .ok_or_else(|| "Codex user input answers are invalid.".to_string())?;
            let chars = value.chars().count();
            if chars > 16_384 {
                return Err("Codex user input answers are too large.".into());
            }
            total_chars = total_chars.saturating_add(chars);
            if total_chars > 32_768 {
                return Err("Codex user input answers are too large.".into());
            }
            values.push(Value::String(value.to_string()));
        }
        projected.insert(question.id.clone(), json!({"answers": values}));
    }
    Ok(json!({"answers": projected}))
}

fn approval_decision(cancel: bool, accept: bool) -> &'static str {
    if cancel {
        "cancel"
    } else if accept {
        "accept"
    } else {
        "decline"
    }
}

fn file_change_approval_decision(
    cancel: bool,
    accept: bool,
    grant_root: Option<&str>,
    workspace_root: Option<&Path>,
) -> &'static str {
    let grant_is_authorized = grant_root.is_none_or(|grant_root| {
        workspace_root.is_some_and(|root| path_is_authorized_in_workspace(grant_root, root, true))
    });
    approval_decision(cancel, accept && grant_is_authorized)
}

fn allowed_permission_subset(requested: &Value, workspace_root: Option<&Path>) -> Value {
    let Some(requested) = requested.as_object() else {
        return json!({});
    };
    let mut granted = Map::new();
    if let Some(network) = requested.get("network").and_then(Value::as_object) {
        if let Some(enabled) = network.get("enabled").and_then(Value::as_bool) {
            granted.insert("network".into(), json!({"enabled": enabled}));
        }
    }
    if let (Some(root), Some(file_system)) = (
        workspace_root,
        requested.get("fileSystem").and_then(Value::as_object),
    ) {
        let mut allowed = Map::new();
        for field in ["read", "write"] {
            let allow_missing = field == "write";
            let paths = file_system
                .get(field)
                .and_then(Value::as_array)
                .map(|paths| {
                    paths
                        .iter()
                        .filter_map(Value::as_str)
                        .filter(|path| path_is_authorized_in_workspace(path, root, allow_missing))
                        .map(|path| Value::String(path.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if !paths.is_empty() {
                allowed.insert(field.into(), Value::Array(paths));
            }
        }
        let entries = file_system
            .get("entries")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|entry| permission_entry_is_within_workspace(entry, root))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if !entries.is_empty() {
            allowed.insert("entries".into(), Value::Array(entries));
        }
        if !allowed.is_empty() {
            if let Some(depth) = file_system.get("globScanMaxDepth").and_then(Value::as_u64) {
                allowed.insert("globScanMaxDepth".into(), Value::from(depth));
            }
            granted.insert("fileSystem".into(), Value::Object(allowed));
        }
    }
    Value::Object(granted)
}

fn permission_entry_is_within_workspace(entry: &Value, root: &Path) -> bool {
    let Some(entry) = entry.as_object() else {
        return false;
    };
    let Some(path) = entry.get("path").and_then(Value::as_object) else {
        return false;
    };
    match path.get("type").and_then(Value::as_str) {
        Some("path") => path
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|path| path_is_authorized_in_workspace(path, root, false)),
        Some("special") => {
            let Some(value) = path.get("value").and_then(Value::as_object) else {
                return false;
            };
            value.get("kind").and_then(Value::as_str) == Some("project_roots")
                && value
                    .get("subpath")
                    .and_then(Value::as_str)
                    .is_none_or(|path| path_is_authorized_in_workspace(path, root, false))
        }
        _ => false,
    }
}

pub(super) fn path_is_authorized_in_workspace(raw: &str, root: &Path, allow_missing: bool) -> bool {
    let Ok(canonical_root) = root.canonicalize() else {
        return false;
    };
    let path = Path::new(raw);
    let relative = if path.is_absolute() {
        let Ok(relative) = path
            .strip_prefix(root)
            .or_else(|_| path.strip_prefix(&canonical_root))
        else {
            return false;
        };
        relative
    } else {
        path
    };
    if relative.components().any(|component| {
        !matches!(
            component,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    }) {
        return false;
    }
    let mut current = canonical_root.clone();
    for component in relative.components() {
        if let std::path::Component::Normal(value) = component {
            current.push(value);
            match std::fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => return false,
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return allow_missing;
                }
                Err(_) => return false,
            }
        }
    }
    current
        .canonicalize()
        .is_ok_and(|canonical| canonical.starts_with(&canonical_root))
}

pub(super) fn stream_snapshot_impl(
    app: AppHandle,
    request_id: String,
) -> Result<Option<CodexRunStreamSnapshot>, String> {
    validate_required(&request_id, "requestId")?;
    Ok(app
        .state::<CodexAgentHostState>()
        .run(&request_id)
        .map(|run| run.stream.snapshot()))
}

pub(super) fn reattach_impl(
    app: AppHandle,
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<CodexAgentHostEvent>,
) -> Result<CodexRunStreamSnapshot, String> {
    validate_required(&request_id, "requestId")?;
    let run = app
        .state::<CodexAgentHostState>()
        .run(&request_id)
        .ok_or_else(|| "No buffered Codex stream exists for this request.".to_string())?;
    run.stream.reattach(after_cursor, on_event)
}

pub(super) fn release_stream_impl(app: AppHandle, request_id: String) -> Result<(), String> {
    validate_required(&request_id, "requestId")?;
    app.state::<CodexAgentHostState>()
        .remove_terminal_run(&request_id)?;
    Ok(())
}

pub(crate) async fn status_impl(
    _app: AppHandle,
    _include_usage: bool,
) -> Result<CodexAgentStatusResponse, String> {
    let checked_at = rfc3339_now()?;
    Ok(inspect_codex_cli(checked_at, orchestration_capabilities()).await)
}

fn orchestration_capabilities() -> Value {
    json!({
        "stop": true,
        "steer": false,
        "resume": true,
        "attachmentInput": { "textFiles": true, "images": "supported" },
        "permissionModes": ["plan", "ask", "auto", "full"],
        "interactions": {
            "approval": true,
            "userInput": true,
        },
        "processEvents": {
            "reasoning": true,
            "toolCalls": true,
            "fileChanges": true,
        },
        "pace": { "speedReport": "unreported" },
        "interactionRoutes": {
            "browser": [{
                "id": "offisim-browser",
                "source": "offisim-local",
                "label": "Offisim Browser",
                "availability": "available",
            }],
            "computer": [
                {
                    "id": "codex-native-computer",
                    "source": "engine-native",
                    "label": "Codex Computer Use",
                    "availability": "unsupported",
                    "reason": "The current Codex app-server contract does not expose a negotiated Computer Use route.",
                },
                {
                    "id": "offisim-computer",
                    "source": "offisim-local",
                    "label": "Offisim local driver",
                    "availability": "runtime-determined",
                },
            ],
        },
    })
}

fn validate_execution_target(target: &CodexExecutionTarget) -> Result<(), String> {
    if target.engine_id != ENGINE_ID
        || target.account_id != ACCOUNT_ID
        || target.billing_mode != BILLING_MODE
    {
        return Err("The Codex execution target must use the local orchestration engine.".into());
    }
    if target.model_id != MODEL_ID && codex_run_option_model(&target.model_id).is_none() {
        return Err(format!(
            "The saved Codex model \"{}\" is no longer available.",
            target.model_id
        ));
    }
    if target.model_source.kind != "native"
        || target.model_source.source_url.is_some()
        || target.model_source.checked_at.is_some()
    {
        return Err(
            "The Codex orchestration target must use native engine provenance without a catalog URL."
                .into(),
        );
    }
    Ok(())
}

fn execution_provenance(
    target: &CodexExecutionTarget,
    run_id: &str,
    requested_model: Option<&str>,
) -> CodexExecutionProvenance {
    CodexExecutionProvenance {
        engine_id: target.engine_id.clone(),
        account_id: target.account_id.clone(),
        billing_mode: target.billing_mode.clone(),
        model_id: target.model_id.clone(),
        model_source: target.model_source.clone(),
        run_id: run_id.to_string(),
        adapter: adapter_identity(),
        requested_model_id: requested_model.map(str::to_string),
        actual_model_id: None,
    }
}

fn publish_prepared(
    stream: &Arc<RunStream>,
    request_id: &str,
    run_id: &str,
    target: &CodexExecutionTarget,
    provenance: &CodexExecutionProvenance,
) -> Result<(), String> {
    let encoded = serde_json::to_vec(target)
        .map_err(|_| "Encode Codex execution target failed.".to_string())?;
    let target_digest = hex::encode(Sha256::digest(encoded));
    let prepare_id = stable_hex(&format!("prepare\0{request_id}\0{target_digest}"));
    stream.publish(CodexAgentHostEvent::ExecutionPrepared {
        prepare_id,
        run_id: run_id.to_string(),
        identity: provenance.clone(),
        target_digest,
        adapter: adapter_identity(),
    });
    Ok(())
}

fn model_summary(actual_model: &str) -> CodexModelSummary {
    CodexModelSummary {
        provider: Some("openai".into()),
        id: Some(actual_model.to_string()),
        name: Some(actual_model.to_string()),
        api: Some(NATIVE_THREAD_PROTOCOL.into()),
        reasoning: None,
        context_window: None,
        max_tokens: None,
        input: Vec::new(),
        catalog_id: None,
    }
}

fn adapter_identity() -> CodexAdapterIdentity {
    CodexAdapterIdentity {
        id: CODEX_ADAPTER_ID.into(),
        version: CODEX_ADAPTER_VERSION.into(),
    }
}

fn validate_execute_request(req: &CodexAgentExecuteRequest) -> Result<(), String> {
    validate_required(&req.request_id, "requestId")?;
    validate_required(&req.text, "text")?;
    validate_required(&req.company_id, "companyId")?;
    validate_required(&req.thread_id, "threadId")?;
    validate_required(req.project_id.as_deref().unwrap_or_default(), "projectId")?;
    validate_required(req.root_run_id.as_deref().unwrap_or_default(), "rootRunId")?;
    if let Some(employee_id) = req.employee_id.as_deref() {
        validate_required(employee_id, "employeeId")?;
    }
    validate_image_inputs(&req.images)?;
    Ok(())
}

fn validate_image_inputs(images: &[CodexImageInput]) -> Result<(), String> {
    const MAX_IMAGES: usize = 6;
    const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
    const MAX_BASE64_CHARS: usize = ((MAX_IMAGE_BYTES + 2) / 3) * 4;
    if images.len() > MAX_IMAGES {
        return Err("Codex accepts up to 6 images per turn.".into());
    }
    for image in images {
        if !matches!(
            image.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        ) {
            return Err("Codex image attachments must be PNG, JPEG, GIF, or WebP.".into());
        }
        if image.data.is_empty() || image.data.len() > MAX_BASE64_CHARS {
            return Err("Codex image attachment exceeds the 8 MB limit.".into());
        }
        let decoded = BASE64_STANDARD
            .decode(&image.data)
            .map_err(|_| "Codex image attachment is not valid base64.".to_string())?;
        if decoded.len() > MAX_IMAGE_BYTES {
            return Err("Codex image attachment exceeds the 8 MB limit.".into());
        }
    }
    Ok(())
}

fn validate_execute_mode(req: &CodexAgentExecuteRequest, mode: ExecuteMode) -> Result<(), String> {
    if mode.is_resume() && req.competitive_draft.is_some() {
        return Err("Competitive draft attempts cannot use durable resume.".into());
    }
    let history_id = req
        .workspace_binding_history_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match req.native_session_mode {
        CodexNativeSessionMode::Fresh => {
            if mode.is_resume() {
                return Err(
                    "Durable Resume must open its exact Codex session and cannot start fresh."
                        .into(),
                );
            }
            if req.native_session_id.is_some() {
                return Err(
                    "nativeSessionId must be absent for an explicit fresh-session retry.".into(),
                );
            }
            validate_required(
                req.native_session_reset_source_run_id
                    .as_deref()
                    .unwrap_or_default(),
                "nativeSessionResetSourceRunId",
            )?;
        }
        CodexNativeSessionMode::Tracked => {
            if req.native_session_reset_source_run_id.is_some() {
                return Err(
                    "nativeSessionResetSourceRunId is accepted only by an explicit fresh-session retry."
                        .into(),
                );
            }
        }
    }
    if mode.is_resume() {
        if req.workspace_requirement.is_optional() {
            return Err("workspaceRequirement must be required for durable resume.".into());
        }
        if history_id.is_none() {
            return Err("workspaceBindingHistoryId is required for codex_agent_resume.".into());
        }
        return Ok(());
    }
    if req.workspace_binding_history_id.is_some() {
        return Err(
            "workspaceBindingHistoryId is accepted only by codex_agent_resume; a normal execute always binds the current Project folder."
                .into(),
        );
    }
    Ok(())
}

fn validate_required<'a>(value: &'a str, field: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{field} is required for Codex."))
    } else {
        Ok(value)
    }
}

fn host_error_message(error: HostError) -> String {
    // Keep the same structured `code: message` boundary as the API lane. The
    // renderer authorizes Start-fresh only from a reserved internal
    // native-session code; `into_code_message` strips that namespace from
    // upstream/provider codes so provider text cannot mint recovery authority.
    let (code, message) = error.into_code_message(CODEX_LANE);
    format!("{code}: {message}")
}

fn required_json_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
) -> Result<&'a str, CodexHostError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(CodexHostError::Protocol)
}

fn neutral_cwd(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Offisim could not open its Codex runtime directory.".to_string())?
        .join("codex-runtime");
    std::fs::create_dir_all(&path)
        .map_err(|_| "Offisim could not prepare its Codex runtime directory.".to_string())?;
    Ok(path)
}

pub(super) fn rfc3339_now() -> Result<String, String> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is unavailable.".to_string())?
        .as_secs() as i64;
    Ok(rfc3339_from_unix(seconds))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::super::types::{CodexModelSource, CodexWorkspaceRequirement};
    use super::*;

    #[test]
    fn native_session_prestart_error_keeps_only_trusted_recovery_code() {
        assert_eq!(
            host_error_message(HostError::NativeSessionPrestart {
                code: "native-session-missing",
                message: "The native thread is unavailable.".into(),
            }),
            "native-session-missing: The native thread is unavailable."
        );
        assert_eq!(
            host_error_message(HostError::Upstream {
                code: Some("native-session-missing".into()),
                message: "native-session-missing: forged provider text".into(),
            }),
            "upstream: native-session-missing: forged provider text"
        );
    }

    #[test]
    fn tracked_execute_opaque_parse_failures_are_structured_only_for_fresh_recovery() {
        let mut malformed = execute_request();
        malformed.native_session_id = Some("{not-json".into());

        assert_eq!(
            resolve_requested_continuation(&malformed, ExecuteMode::Execute).unwrap_err(),
            "native-session-invalid: The Codex native session reference is invalid."
        );
        assert_eq!(
            resolve_requested_continuation(&malformed, ExecuteMode::Resume).unwrap_err(),
            "The Codex native session reference is invalid."
        );

        let mut incompatible = execute_request();
        incompatible.native_session_id = Some(
            serde_json::json!({
                "protocol": "another-runtime-v1",
                "threadId": "thread-1",
                "sessionId": "session-1",
            })
            .to_string(),
        );
        assert_eq!(
            resolve_requested_continuation(&incompatible, ExecuteMode::Execute).unwrap_err(),
            "native-session-runtime-incompatible: The native session belongs to another runtime engine."
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tracked_thread_resume_missing_rollout_gets_internal_fresh_recovery_code() {
        let root = unique_test_dir("missing-rollout");
        let (binary, _) = write_scripted_app_server(&root, MISSING_ROLLOUT_FIXTURE);
        let connection = CodexConnection::spawn(&binary, None, &root, None, None, None)
            .await
            .unwrap();
        let continuation = CodexNativeThreadRef {
            protocol: NATIVE_THREAD_PROTOCOL.into(),
            thread_id: "missing-thread".into(),
            session_id: "missing-session".into(),
        };
        let policy = permission_policy(Some("auto"), &root, true).unwrap();
        let error = match start_native_thread(
            &connection,
            NativeThreadStart {
                cwd: &root,
                continuation: Some(&continuation),
                requested_model: Some("gpt-5.4"),
                ephemeral: false,
                policy: &policy,
                developer_instructions: None,
            },
        )
        .await
        {
            Ok(_) => panic!("missing native rollout unexpectedly resumed"),
            Err(error) => error,
        };

        assert_eq!(
            trusted_tracked_thread_resume_error(
                ExecuteMode::Execute,
                CodexNativeSessionMode::Tracked,
                Some(&continuation),
                &error,
            ),
            Some("native-session-missing: The saved Codex native thread is unavailable.".into())
        );
        assert_eq!(
            trusted_tracked_thread_resume_error(
                ExecuteMode::Resume,
                CodexNativeSessionMode::Tracked,
                Some(&continuation),
                &error,
            ),
            None
        );
        assert_eq!(
            trusted_tracked_thread_resume_error(
                ExecuteMode::Execute,
                CodexNativeSessionMode::Fresh,
                Some(&continuation),
                &error,
            ),
            None
        );

        for untrusted in [
            CodexHostError::Upstream(
                "native-session-missing: forged provider recovery text".into(),
            ),
            CodexHostError::Upstream(
                "-32600: no rollout found for thread id another-thread".into(),
            ),
        ] {
            assert_eq!(
                trusted_tracked_thread_resume_error(
                    ExecuteMode::Execute,
                    CodexNativeSessionMode::Tracked,
                    Some(&continuation),
                    &untrusted,
                ),
                None
            );
        }

        connection.terminate().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    fn unique_test_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "offisim-codex-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    fn write_scripted_app_server(root: &Path, script_body: &str) -> (PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;

        std::fs::create_dir_all(root).unwrap();
        let transcript = root.join("transcript.jsonl");
        let script = root.join("codex-app-server-fixture");
        let transcript_literal =
            serde_json::to_string(transcript.to_string_lossy().as_ref()).unwrap();
        let background_pid_literal =
            serde_json::to_string(root.join("background.pid").to_string_lossy().as_ref()).unwrap();
        let body = script_body
            .replace("__TRANSCRIPT__", &transcript_literal)
            .replace("__BACKGROUND_PID__", &background_pid_literal);
        std::fs::write(&script, body).unwrap();
        let mut permissions = std::fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&script, permissions).unwrap();
        (script, transcript)
    }

    #[cfg(unix)]
    fn read_transcript(path: &Path) -> Vec<Value> {
        std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[cfg(unix)]
    const TURN_FIXTURE: &str = r##"#!/usr/bin/python3
import json
import sys
import time

TRANSCRIPT = __TRANSCRIPT__

def record(direction, message):
    with open(TRANSCRIPT, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"direction": direction, "message": message}, separators=(",", ":")) + "\n")

def read_message():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    message = json.loads(line)
    record("in", message)
    return message

def send(message):
    record("out", message)
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()

def respond(request, result):
    send({"id": request["id"], "result": result})

request = read_message()
assert request["method"] == "initialize"
assert request["params"]["capabilities"] == {"experimentalApi": True, "requestAttestation": False, "mcpServerOpenaiFormElicitation": False}
respond(request, {"userAgent": "codex-cli/0.144.4", "codexHome": "/native/codex-home", "platformFamily": "unix", "platformOs": "macos"})

notification = read_message()
assert notification["method"] == "initialized" and "id" not in notification

request = read_message()
assert request["method"] == "thread/start"
assert request["params"]["model"] == "gpt-5.4"
assert request["params"]["serviceTier"] is None
cwd = request["params"]["cwd"]
respond(request, {"thread": {"id": "thread-1", "sessionId": "session-1"}, "cwd": cwd, "model": "gpt-5.4-high"})

request = read_message()
assert request["method"] == "turn/start"
assert request["params"]["input"] == [
    {"type": "text", "text": "Run the conformance fixture"},
    {"type": "image", "url": "data:image/png;base64,iVBORw0KGgo="},
]
assert request["params"]["approvalPolicy"] == "never"
assert request["params"]["sandboxPolicy"] == {"type": "readOnly", "networkAccess": False}
assert request["params"]["collaborationMode"] == {"mode": "plan", "settings": {"model": "gpt-5.4-high"}}
assert request["params"]["model"] == "gpt-5.4"
assert request["params"]["effort"] == "high"
assert request["params"]["serviceTier"] == "fast"
respond(request, {"turn": {"id": "turn-1", "status": "inProgress"}})

send({"method": "attestation/read", "id": "unsupported-1", "params": None})
unsupported = read_message()
assert unsupported["id"] == "unsupported-1" and unsupported["error"]["code"] == -32601

send({"method": "currentTime/read", "id": "clock-1", "params": {"threadId": "thread-1"}})
clock = read_message()
assert clock["id"] == "clock-1" and isinstance(clock["result"]["currentTimeAt"], int)

send({"method": "mcpServer/elicitation/request", "id": "mcp-1", "params": {"threadId": "thread-1", "turnId": "turn-1"}})
mcp = read_message()
assert mcp == {"id": "mcp-1", "result": {"action": "cancel", "content": None}}

send({"method": "item/tool/requestUserInput", "id": "input-1", "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "question-1", "questions": [{"id": "scope", "header": "Scope", "question": "Which scope?", "isOther": False, "isSecret": False, "options": [{"label": "Project", "description": "Current Project"}]}], "autoResolutionMs": 60000}})
answer = read_message()
assert answer == {"id": "input-1", "result": {"answers": {"scope": {"answers": ["Project"]}}}}
send({"method": "serverRequest/resolved", "params": {"threadId": "thread-1", "requestId": "input-1"}})

send({"method": "item/started", "params": {"threadId": "thread-1", "turnId": "turn-1", "startedAtMs": 1, "item": {"type": "plan", "id": "plan-1", "text": ""}}})
send({"method": "item/plan/delta", "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "plan-1", "delta": "# Draft plan\n\n- Inspect\n"}})
send({"method": "item/started", "params": {"threadId": "thread-1", "turnId": "turn-1", "startedAtMs": 2, "item": {"type": "agentMessage", "id": "message-1", "phase": "final_answer"}}})
send({"method": "item/agentMessage/delta", "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "message-1", "delta": "I prepared a plan."}})
send({"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1", "completedAtMs": 3, "item": {"type": "agentMessage", "id": "message-1", "phase": "final_answer", "text": "I prepared a plan."}}})
send({"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1", "completedAtMs": 4, "item": {"type": "plan", "id": "plan-1", "text": "# Plan\n\n1. Inspect\n2. Report"}}})
send({"method": "thread/tokenUsage/updated", "params": {"threadId": "thread-1", "turnId": "turn-1", "tokenUsage": {"last": {"inputTokens": 10, "cachedInputTokens": 1, "outputTokens": 2, "reasoningOutputTokens": 0, "totalTokens": 12}, "total": {"inputTokens": 10, "cachedInputTokens": 1, "outputTokens": 2, "reasoningOutputTokens": 0, "totalTokens": 12}}}})
send({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"}}})
time.sleep(30)
"##;

    #[cfg(unix)]
    const BACKGROUND_TERMINAL_CLEAN_FIXTURE: &str = r#"#!/usr/bin/python3
import json
import subprocess
import sys
import time

TRANSCRIPT = __TRANSCRIPT__
BACKGROUND_PID = __BACKGROUND_PID__

background = subprocess.Popen(
    ["sleep", "30"],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)
with open(BACKGROUND_PID, "w", encoding="utf-8") as handle:
    handle.write(str(background.pid))

def record(direction, message):
    with open(TRANSCRIPT, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"direction": direction, "message": message}, separators=(",", ":")) + "\n")

def read_message():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    message = json.loads(line)
    record("in", message)
    return message

def respond(request, result):
    message = {"id": request["id"], "result": result}
    record("out", message)
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()

request = read_message()
assert request["method"] == "initialize"
respond(request, {"userAgent": "codex-cli/0.144.5", "codexHome": "/native/codex-home", "platformFamily": "unix", "platformOs": "macos"})

notification = read_message()
assert notification["method"] == "initialized" and "id" not in notification

request = read_message()
assert request["method"] == "thread/backgroundTerminals/clean"
assert request["params"] == {"threadId": "thread-clean"}
respond(request, {})
time.sleep(30)
"#;

    #[cfg(unix)]
    const ASK_POLICY_FIXTURE: &str = r#"#!/usr/bin/python3
import json
import sys
import time

TRANSCRIPT = __TRANSCRIPT__

def record(direction, message):
    with open(TRANSCRIPT, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"direction": direction, "message": message}, separators=(",", ":")) + "\n")

def read_message():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    message = json.loads(line)
    record("in", message)
    return message

def respond(request, result):
    message = {"id": request["id"], "result": result}
    record("out", message)
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()

request = read_message()
assert request["method"] == "initialize"
respond(request, {"userAgent": "codex-cli/0.144.4", "codexHome": "/native/codex-home", "platformFamily": "unix", "platformOs": "macos"})

notification = read_message()
assert notification["method"] == "initialized" and "id" not in notification

request = read_message()
assert request["method"] == "thread/start"
assert request["params"]["approvalPolicy"] == "on-request"
assert request["params"]["sandbox"] == "read-only"
assert request["params"]["model"] is None
assert request["params"]["serviceTier"] is None
cwd = request["params"]["cwd"]
respond(request, {"thread": {"id": "thread-ask", "sessionId": "session-ask"}, "cwd": cwd, "model": "gpt-5.4-high"})

request = read_message()
assert request["method"] == "turn/start"
assert request["params"]["approvalPolicy"] == "on-request"
assert request["params"]["sandboxPolicy"] == {"type": "readOnly", "networkAccess": False}
assert request["params"]["model"] is None
assert request["params"]["effort"] is None
assert request["params"]["serviceTier"] is None
respond(request, {"turn": {"id": "turn-ask", "status": "inProgress"}})
time.sleep(30)
"#;

    #[cfg(unix)]
    #[cfg(unix)]
    #[cfg(unix)]
    const MISSING_ROLLOUT_FIXTURE: &str = r#"#!/usr/bin/python3
import json
import sys
import time

TRANSCRIPT = __TRANSCRIPT__

def record(direction, message):
    with open(TRANSCRIPT, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"direction": direction, "message": message}, separators=(",", ":")) + "\n")

def read_message():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    message = json.loads(line)
    record("in", message)
    return message

def send(message):
    record("out", message)
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()

request = read_message()
assert request["method"] == "initialize"
send({"id": request["id"], "result": {"userAgent": "codex-cli/0.144.4", "codexHome": "/native/codex-home", "platformFamily": "unix", "platformOs": "macos"}})

notification = read_message()
assert notification["method"] == "initialized" and "id" not in notification

request = read_message()
assert request["method"] == "thread/resume"
assert request["params"]["model"] == "gpt-5.4"
assert request["params"]["serviceTier"] is None
thread_id = request["params"]["threadId"]
send({"id": request["id"], "error": {"code": -32600, "message": "no rollout found for thread id " + thread_id}})
time.sleep(30)
"#;

    fn execute_request() -> CodexAgentExecuteRequest {
        CodexAgentExecuteRequest {
            request_id: "request".into(),
            text: "hello".into(),
            images: Vec::new(),
            expected_target: CodexExecutionTarget {
                engine_id: ENGINE_ID.into(),
                account_id: ACCOUNT_ID.into(),
                billing_mode: BILLING_MODE.into(),
                model_id: MODEL_ID.into(),
                model_source: CodexModelSource {
                    kind: "native".into(),
                    source_url: None,
                    checked_at: None,
                },
            },
            company_id: "company".into(),
            thread_id: "conversation".into(),
            project_id: Some("project".into()),
            employee_id: None,
            root_run_id: Some("run".into()),
            workspace_binding_history_id: None,
            native_session_mode: CodexNativeSessionMode::Tracked,
            native_session_reset_source_run_id: None,
            permission_mode: Some("auto".into()),
            effort: None,
            speed_mode: None,
            system_prompt_append: None,
            project_experience: None,
            skill_paths: None,
            project_skill_paths: None,
            client_user_message_id: None,
            workspace_requirement: CodexWorkspaceRequirement::Required,
            native_session_id: None,
            competitive_draft: None,
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stop_cleans_codex_background_terminals_before_reaping_the_app_server() {
        let root = unique_test_dir("background-terminal-clean");
        let (binary, transcript_path) =
            write_scripted_app_server(&root, BACKGROUND_TERMINAL_CLEAN_FIXTURE);
        let connection = CodexConnection::spawn(&binary, None, &root, None, None, None)
            .await
            .unwrap();

        assert!(clean_native_background_terminals(&connection, "thread-clean").await);
        let background_pid = std::fs::read_to_string(root.join("background.pid"))
            .unwrap()
            .parse::<i32>()
            .unwrap();
        assert_eq!(unsafe { libc::kill(background_pid, 0) }, 0);
        connection.terminate().await;
        let disappeared = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if unsafe { libc::kill(background_pid, 0) } != 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
        assert!(
            disappeared.is_ok(),
            "detached Codex descendant {background_pid} survived connection termination"
        );

        let transcript = read_transcript(&transcript_path);
        assert!(transcript.iter().any(|entry| {
            entry["direction"] == "in"
                && entry["message"]["method"] == "thread/backgroundTerminals/clean"
                && entry["message"]["params"] == json!({"threadId": "thread-clean"})
        }));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn startup_cancellation_notifies_waiters_and_remains_idempotent() {
        let state = CodexAgentHostState::default();
        state.claim_request("starting-request").unwrap();
        let cancellation = state.startup_cancellation("starting-request").unwrap();
        let waiter = {
            let cancellation = Arc::clone(&cancellation);
            tokio::spawn(async move { cancellation.cancelled().await })
        };

        assert!(state.cancel_starting("starting-request"));
        tokio::time::timeout(Duration::from_millis(250), waiter)
            .await
            .expect("startup cancellation must wake immediately")
            .unwrap();
        assert!(cancellation.is_cancelled());
        assert!(state.cancel_starting("starting-request"));
        state.release_claim("starting-request");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_runtime_conformance_scripted_app_server_turn_and_user_input() {
        let root = unique_test_dir("runtime-conformance");
        let (binary, transcript_path) = write_scripted_app_server(&root, TURN_FIXTURE);
        let delivered = Arc::new(Mutex::new(Vec::<Value>::new()));
        let delivered_for_channel = Arc::clone(&delivered);
        let stream = RunStream::new(
            "conformance-run".into(),
            Channel::new(move |body| {
                delivered_for_channel
                    .lock()
                    .unwrap()
                    .push(body.deserialize().unwrap());
                Ok(())
            }),
        );
        let before_clock = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let connection =
            CodexConnection::spawn(&binary, None, &root, Some(Arc::clone(&stream)), None, None)
                .await
                .unwrap();
        assert_eq!(
            connection.runtime_user_agent().as_deref(),
            Some("codex-cli/0.144.4"),
            "initialize userAgent must remain available as native runtime provenance"
        );
        let target = CodexExecutionTarget {
            engine_id: ENGINE_ID.into(),
            account_id: ACCOUNT_ID.into(),
            billing_mode: BILLING_MODE.into(),
            model_id: "gpt-5.4".into(),
            model_source: CodexModelSource {
                kind: "native".into(),
                source_url: None,
                checked_at: None,
            },
        };
        validate_execution_target(&target).unwrap();
        let selection =
            validate_codex_run_selection(&target.model_id, Some("high"), Some("fast")).unwrap();
        let policy = permission_policy(Some("plan"), &root, true).unwrap();
        let setup = start_native_thread(
            &connection,
            NativeThreadStart {
                cwd: &root,
                continuation: None,
                requested_model: selection.requested_model,
                ephemeral: false,
                policy: &policy,
                developer_instructions: None,
            },
        )
        .await
        .unwrap();
        let mut provenance =
            execution_provenance(&target, "conformance-run", selection.requested_model);
        provenance.actual_model_id = setup.actual_model_id.clone();
        stream.set_metadata(RunMetadata {
            model: model_summary(setup.actual_model_id.as_deref().unwrap()),
            provenance,
            native_thread_ref: setup.native_thread_ref.clone(),
            expose_session: true,
        });
        let images = vec![CodexImageInput {
            data: "iVBORw0KGgo=".into(),
            mime_type: "image/png".into(),
        }];
        start_native_turn(
            &connection,
            NativeTurnStart {
                cwd: &root,
                thread_id: &setup.native_thread_ref.thread_id,
                actual_model: setup.actual_model_id.as_deref().unwrap(),
                requested_model: selection.requested_model,
                effort: selection.effort,
                service_tier: selection.service_tier,
                policy: &policy,
                client_user_message_id: "user-message-1",
                text: "Run the conformance fixture",
                images: &images,
            },
        )
        .await
        .unwrap();

        let interaction_id = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(id) = delivered
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|event| {
                        event["kind"] == "uiRequest" && event["method"] == "requestUserInput"
                    })
                    .and_then(|event| event["id"].as_str())
                    .map(str::to_string)
                {
                    break id;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("user-input request arrives");
        let interaction = stream.pending_interaction(&interaction_id).unwrap();
        let questions = match &interaction.kind {
            PendingInteractionKind::UserInput { questions } => questions.clone(),
            _ => panic!("expected user-input interaction"),
        };
        let response = user_input_response(
            Some(r#"{"answers":{"scope":{"answers":["Project"]}}}"#),
            &questions,
            false,
        )
        .unwrap();
        let interaction = stream.take_pending_interaction(&interaction_id).unwrap();
        connection
            .respond(&interaction.native_request_id, response)
            .await
            .unwrap();
        stream.publish(CodexAgentHostEvent::UiRequestResolved {
            id: interaction_id,
            resolution: "answered".into(),
        });

        let outcome = tokio::time::timeout(Duration::from_secs(5), stream.wait_outcome())
            .await
            .expect("scripted turn reaches a native terminal state");
        let response = match outcome {
            RunOutcome::Completed(response) => *response,
            _ => panic!("scripted turn did not complete"),
        };
        assert_eq!(response.text, "# Plan\n\n1. Inspect\n2. Report");
        assert_eq!(response.model.unwrap().id.as_deref(), Some("gpt-5.4-high"));
        let provenance = response.provenance.unwrap();
        assert_eq!(provenance.requested_model_id.as_deref(), Some("gpt-5.4"));
        assert_eq!(provenance.actual_model_id.as_deref(), Some("gpt-5.4-high"));
        let usage = response.usage.unwrap();
        assert_eq!(usage["scope"]["kind"], "subscription-run-diagnostic");
        assert_eq!(usage["input"], 9);
        assert_eq!(usage["output"], 2);
        assert_eq!(usage["cacheRead"], 1);
        assert_eq!(usage["usageSource"]["kind"], "adapter");
        assert_eq!(usage["cost"]["kind"], "unavailable");
        assert!(usage.get("executionSpeed").is_none());
        let after_clock = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        connection.terminate().await;

        let transcript = read_transcript(&transcript_path);
        let inbound_methods = transcript
            .iter()
            .filter(|entry| entry["direction"] == "in")
            .filter_map(|entry| entry["message"]["method"].as_str())
            .collect::<Vec<_>>();
        for expected in ["initialize", "initialized", "thread/start", "turn/start"] {
            assert!(
                inbound_methods.contains(&expected),
                "missing outbound {expected}"
            );
        }
        let inbound_response = |id: &str| {
            transcript
                .iter()
                .find(|entry| {
                    entry["direction"] == "in" && entry["message"]["id"] == Value::String(id.into())
                })
                .map(|entry| &entry["message"])
                .unwrap()
        };
        assert_eq!(inbound_response("unsupported-1")["error"]["code"], -32601);
        let current_time_at = inbound_response("clock-1")["result"]["currentTimeAt"]
            .as_u64()
            .unwrap();
        assert!((before_clock..=after_clock).contains(&current_time_at));
        assert_eq!(
            inbound_response("mcp-1")["result"],
            json!({"action":"cancel","content":null})
        );
        assert_eq!(
            inbound_response("input-1")["result"],
            json!({"answers":{"scope":{"answers":["Project"]}}})
        );

        let events = delivered.lock().unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| event["kind"] == "uiRequest")
                .count(),
            1,
            "clock, MCP and unsupported requests must never create UI"
        );
        let event_projection = serde_json::to_string(&*events).unwrap();
        assert!(!event_projection.contains("proposed_plan"));
        assert!(events.iter().any(|event| {
            event["kind"] == "messageDelta"
                && event["channel"] == "plan"
                && event["delta"]
                    .as_str()
                    .is_some_and(|delta| delta.contains("Draft plan"))
        }));
        assert!(events.iter().any(|event| event["kind"] == "messageEnd"));
        assert!(events.iter().any(|event| event["kind"] == "result"));
        drop(events);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ask_mode_uses_the_native_read_only_approval_preset() {
        let root = unique_test_dir("ask-policy");
        let (binary, transcript_path) = write_scripted_app_server(&root, ASK_POLICY_FIXTURE);
        let connection = CodexConnection::spawn(&binary, None, &root, None, None, None)
            .await
            .unwrap();
        let policy = permission_policy(Some("ask"), &root, true).unwrap();
        let setup = start_native_thread(
            &connection,
            NativeThreadStart {
                cwd: &root,
                continuation: None,
                requested_model: None,
                ephemeral: false,
                policy: &policy,
                developer_instructions: None,
            },
        )
        .await
        .unwrap();
        start_native_turn(
            &connection,
            NativeTurnStart {
                cwd: &root,
                thread_id: &setup.native_thread_ref.thread_id,
                actual_model: setup.actual_model_id.as_deref().unwrap(),
                requested_model: None,
                effort: None,
                service_tier: None,
                policy: &policy,
                client_user_message_id: "ask-user-message",
                text: "Attempt a write only after approval",
                images: &[],
            },
        )
        .await
        .unwrap();

        let transcript = read_transcript(&transcript_path);
        assert!(transcript.iter().any(|entry| {
            entry["message"]["method"] == "turn/start"
                && entry["message"]["params"]["sandboxPolicy"]
                    == json!({"type": "readOnly", "networkAccess": false})
        }));
        connection.terminate().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn opaque_native_session_is_strict_and_path_free() {
        let mut req = execute_request();
        req.native_session_id = Some(
            r#"{"protocol":"codex-app-server","threadId":"thread","sessionId":"session"}"#.into(),
        );
        let native = resolve_continuation(&req).unwrap().unwrap();
        assert_eq!(native.thread_id, "thread");
        assert!(!opaque_session_id(&native).unwrap().contains('/'));
        assert!(parse_continuation(
            r#"{"protocol":"codex-app-server","threadId":"thread","sessionId":"session","path":"/tmp/leak"}"#
        )
        .is_err());
    }

    #[test]
    fn execute_and_resume_require_distinct_workspace_authority() {
        let mut req = execute_request();
        assert!(validate_execute_mode(&req, ExecuteMode::Execute).is_ok());
        req.workspace_binding_history_id = Some("history".into());
        assert!(validate_execute_mode(&req, ExecuteMode::Execute).is_err());
        assert!(validate_execute_mode(&req, ExecuteMode::Resume).is_ok());
        req.workspace_requirement = CodexWorkspaceRequirement::Optional;
        assert!(validate_execute_mode(&req, ExecuteMode::Resume).is_err());
        req.workspace_binding_history_id = None;
        assert!(validate_execute_mode(&req, ExecuteMode::Resume).is_err());
    }

    #[test]
    fn native_session_mode_is_closed_and_rejects_unknown_request_fields() {
        let target = serde_json::to_value(execute_request().expected_target).unwrap();
        let request = json!({
            "requestId": "request",
            "text": "hello",
            "expectedTarget": target,
            "companyId": "company",
            "threadId": "thread",
            "projectId": "project",
            "rootRunId": "run",
            "nativeSessionMode": "futureMode"
        });
        assert!(serde_json::from_value::<CodexAgentExecuteRequest>(request.clone()).is_err());
        let mut valid = request.clone();
        valid["nativeSessionMode"] = json!("tracked");
        let decoded = serde_json::from_value::<CodexAgentExecuteRequest>(valid.clone()).unwrap();
        assert_eq!(decoded.effort, None);
        assert_eq!(decoded.speed_mode, None);

        valid["effort"] = json!("high");
        valid["speedMode"] = json!("fast");
        let decoded = serde_json::from_value::<CodexAgentExecuteRequest>(valid).unwrap();
        assert_eq!(decoded.effort.as_deref(), Some("high"));
        assert_eq!(decoded.speed_mode.as_deref(), Some("fast"));

        let mut unknown = request;
        unknown["nativeSessionMode"] = json!("tracked");
        unknown["silentFallback"] = json!(true);
        assert!(serde_json::from_value::<CodexAgentExecuteRequest>(unknown).is_err());
    }

    #[test]
    fn execution_target_and_run_selection_enforce_the_typed_catalog() {
        let mut target = execute_request().expected_target;
        validate_execution_target(&target).unwrap();
        let managed =
            validate_codex_run_selection(&target.model_id, None, Some("standard")).unwrap();
        assert_eq!(managed.requested_model, None);
        assert_eq!(managed.service_tier, None);

        target.model_id = "gpt-5.4".into();
        validate_execution_target(&target).unwrap();
        let explicit =
            validate_codex_run_selection(&target.model_id, Some("xhigh"), Some("fast")).unwrap();
        assert_eq!(explicit.requested_model, Some("gpt-5.4"));
        assert_eq!(explicit.effort, Some("xhigh"));
        assert_eq!(explicit.service_tier, Some("fast"));

        target.model_id = "retired-model".into();
        assert!(validate_execution_target(&target)
            .unwrap_err()
            .contains("no longer available"));
        assert!(validate_codex_run_selection(&target.model_id, None, None).is_err());
        assert!(validate_codex_run_selection("gpt-5.4", Some("extreme"), None).is_err());
        assert!(validate_codex_run_selection("gpt-5.4-mini", Some("xhigh"), None).is_err());
        assert!(validate_codex_run_selection("gpt-5.4", None, Some("turbo")).is_err());

        target.model_id = MODEL_ID.into();
        target.engine_id = "another-engine".into();
        assert!(validate_execution_target(&target).is_err());
        target.engine_id = ENGINE_ID.into();
        target.model_source.source_url = Some("https://example.invalid/catalog".into());
        assert!(validate_execution_target(&target).is_err());
    }

    #[test]
    fn provenance_records_only_an_explicit_requested_model() {
        let managed_target = execute_request().expected_target;
        let managed = execution_provenance(&managed_target, "managed-run", None);
        assert_eq!(managed.requested_model_id, None);
        assert_eq!(managed.actual_model_id, None);

        let mut explicit_target = managed_target;
        explicit_target.model_id = "gpt-5.4".into();
        let explicit = execution_provenance(&explicit_target, "explicit-run", Some("gpt-5.4"));
        assert_eq!(explicit.requested_model_id.as_deref(), Some("gpt-5.4"));
        assert_eq!(explicit.actual_model_id, None);
    }

    #[test]
    fn permission_modes_drive_explicit_native_collaboration_state() {
        let root = Path::new("/tmp/project");
        for (mode, expected_native_mode) in [
            ("plan", "plan"),
            ("ask", "default"),
            ("auto", "default"),
            ("full", "default"),
        ] {
            let policy = permission_policy(Some(mode), root, true).unwrap();
            assert_eq!(policy.native_collaboration_mode, expected_native_mode);
            let collaboration = turn_collaboration_mode(&policy, "gpt-5.4-high");
            assert_eq!(collaboration["mode"], expected_native_mode);
            assert_eq!(
                collaboration["settings"],
                json!({ "model": "gpt-5.4-high" })
            );
        }

        let plan = permission_policy(Some("plan"), root, true).unwrap();
        assert_eq!(
            turn_collaboration_mode(&plan, "gpt-5.4-high")["settings"],
            json!({ "model": "gpt-5.4-high" })
        );
        let auto = permission_policy(Some("auto"), root, true).unwrap();
        assert_eq!(
            turn_collaboration_mode(&auto, "gpt-5.4-high")["settings"],
            json!({ "model": "gpt-5.4-high" })
        );

        let ask = permission_policy(Some("ask"), root, true).unwrap();
        assert_eq!(ask.thread_sandbox, "read-only");
        assert_eq!(ask.approval_policy, "on-request");
        assert_eq!(
            ask.turn_sandbox,
            json!({"type": "readOnly", "networkAccess": false})
        );

        assert_eq!(auto.turn_sandbox["networkAccess"], false);
        assert_eq!(auto.turn_sandbox["excludeTmpdirEnvVar"], true);
        assert_eq!(auto.turn_sandbox["excludeSlashTmp"], true);

        let enhance = permission_policy(Some("auto"), root, false).unwrap();
        assert_eq!(enhance.native_collaboration_mode, "default");
        assert_eq!(enhance.thread_sandbox, "read-only");
        assert_eq!(enhance.turn_sandbox["type"], "readOnly");

        assert_eq!(
            orchestration_capabilities()["pace"]["speedReport"],
            "unreported"
        );
    }

    #[test]
    fn enhance_request_rejects_unknown_fields() {
        let request = json!({
            "requestId": "enhance",
            "text": "rewrite",
            "expectedTarget": serde_json::to_value(execute_request().expected_target).unwrap(),
            "systemPrompt": "Improve the text",
            "sourceProvenance": null
        });
        assert!(serde_json::from_value::<CodexAgentEnhanceRequest>(request.clone()).is_ok());
        let mut unknown = request;
        unknown["silentFallback"] = json!(true);
        assert!(serde_json::from_value::<CodexAgentEnhanceRequest>(unknown).is_err());
    }

    #[test]
    fn fresh_session_requires_exact_reset_authority_and_never_accepts_continuation() {
        let mut req = execute_request();
        req.native_session_mode = CodexNativeSessionMode::Fresh;
        assert!(validate_execute_mode(&req, ExecuteMode::Execute).is_err());

        req.native_session_reset_source_run_id = Some("failed-root".into());
        assert!(validate_execute_mode(&req, ExecuteMode::Execute).is_ok());
        assert!(validate_execute_mode(&req, ExecuteMode::Resume).is_err());

        req.native_session_id = Some(String::new());
        assert!(validate_execute_mode(&req, ExecuteMode::Execute).is_err());

        req.native_session_id = None;
        req.native_session_mode = CodexNativeSessionMode::Tracked;
        assert!(validate_execute_mode(&req, ExecuteMode::Execute).is_err());
        req.native_session_reset_source_run_id = None;
        assert!(validate_execute_mode(&req, ExecuteMode::Execute).is_ok());
    }

    #[test]
    fn resume_uses_only_matching_durable_engine_account_and_billing_authority() {
        let req = execute_request();
        let opaque_id =
            r#"{"protocol":"codex-app-server","threadId":"thread","sessionId":"session"}"#;
        let session = NativeSessionReference::Opaque {
            engine_id: ENGINE_ID.into(),
            account_id: req.expected_target.account_id.clone(),
            billing_mode: BILLING_MODE.into(),
            id: opaque_id.into(),
        };
        let resumed = resolve_resume_continuation(Some(&session), &req.expected_target, None)
            .unwrap()
            .unwrap();
        assert_eq!(resumed.thread_id, "thread");

        let wrong_account = NativeSessionReference::Opaque {
            engine_id: ENGINE_ID.into(),
            account_id: "another-account".into(),
            billing_mode: BILLING_MODE.into(),
            id: opaque_id.into(),
        };
        assert!(
            resolve_resume_continuation(Some(&wrong_account), &req.expected_target, None).is_err()
        );
        assert!(resolve_resume_continuation(
            Some(&NativeSessionReference::FileBacked {
                file: PathBuf::from("/tmp/session.jsonl"),
                id: "session".into(),
            }),
            &req.expected_target,
            None,
        )
        .is_err());
    }

    #[test]
    fn approvals_are_turn_scoped_and_never_create_persistent_policy() {
        assert_eq!(approval_decision(false, true), "accept");
        assert_eq!(approval_decision(false, false), "decline");
        assert_eq!(approval_decision(true, true), "cancel");
        assert!(!["accept", "decline", "cancel"].contains(&"acceptForSession"));

        let root = unique_test_dir("permission-subset");
        std::fs::create_dir_all(root.join("src")).unwrap();
        let source = root.join("src").to_string_lossy().into_owned();
        let granted = allowed_permission_subset(
            &json!({
                "network": {"enabled": true, "persistent": true},
                "fileSystem": {
                    "read": [source, "/tmp/outside", "../escape"],
                    "write": ["generated"],
                    "entries": [
                        {"path": {"type": "path", "path": root.join("src").to_string_lossy()}},
                        {"path": {"type": "path", "path": "/tmp/outside"}},
                        {"path": {"type": "special", "value": {"kind": "project_roots", "subpath": "src"}}},
                        {"path": {"type": "special", "value": {"kind": "home"}}}
                    ],
                    "globScanMaxDepth": 4,
                    "persistent": true
                },
                "unknown": true
            }),
            Some(&root),
        );
        assert_eq!(granted["network"], json!({"enabled": true}));
        assert_eq!(granted["fileSystem"]["read"], json!([source]));
        assert_eq!(granted["fileSystem"]["write"], json!(["generated"]));
        assert_eq!(
            granted["fileSystem"]["entries"].as_array().unwrap().len(),
            2
        );
        assert!(granted.get("unknown").is_none());
        assert!(granted["fileSystem"].get("persistent").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn file_change_grant_root_never_expands_the_project_workspace() {
        let root = unique_test_dir("file-change-grant-root");
        let outside = unique_test_dir("file-change-grant-outside");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        assert_eq!(
            file_change_approval_decision(false, true, None, Some(&root)),
            "accept"
        );
        assert_eq!(
            file_change_approval_decision(false, true, Some("src"), Some(&root)),
            "accept"
        );
        assert_eq!(
            file_change_approval_decision(
                false,
                true,
                Some(&root.join("generated/new").to_string_lossy()),
                Some(&root),
            ),
            "accept"
        );
        assert_eq!(
            file_change_approval_decision(
                false,
                true,
                Some(&outside.to_string_lossy()),
                Some(&root),
            ),
            "decline"
        );
        assert_eq!(
            file_change_approval_decision(false, true, Some("../escape"), Some(&root)),
            "decline"
        );
        assert_eq!(
            file_change_approval_decision(false, true, Some("src"), None),
            "decline"
        );
        assert_eq!(
            file_change_approval_decision(
                true,
                true,
                Some(&outside.to_string_lossy()),
                Some(&root),
            ),
            "cancel"
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn file_change_grant_root_rejects_a_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = unique_test_dir("file-change-grant-symlink-root");
        let outside = unique_test_dir("file-change-grant-symlink-outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("escape")).unwrap();

        assert_eq!(
            file_change_approval_decision(
                false,
                true,
                Some(&root.join("escape/new.txt").to_string_lossy()),
                Some(&root),
            ),
            "decline"
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn permission_subset_rejects_symlink_escapes_for_every_path_shape() {
        use std::os::unix::fs::symlink;

        let root = unique_test_dir("permission-symlink-root");
        let outside = unique_test_dir("permission-symlink-outside");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "private").unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        let escape_secret = root
            .join("escape/secret.txt")
            .to_string_lossy()
            .into_owned();
        let escape_write = root.join("escape/new.txt").to_string_lossy().into_owned();
        let safe_source = root.join("src").to_string_lossy().into_owned();

        let granted = allowed_permission_subset(
            &json!({
                "fileSystem": {
                    "read": [safe_source, escape_secret],
                    "write": ["generated/new.txt", escape_write],
                    "entries": [
                        {"path": {"type": "path", "path": root.join("src").to_string_lossy()}},
                        {"path": {"type": "path", "path": root.join("escape/secret.txt").to_string_lossy()}},
                        {"path": {"type": "special", "value": {"kind": "project_roots", "subpath": "src"}}},
                        {"path": {"type": "special", "value": {"kind": "project_roots", "subpath": "escape/secret.txt"}}}
                    ]
                }
            }),
            Some(&root),
        );
        assert_eq!(granted["fileSystem"]["read"], json!([safe_source]));
        assert_eq!(granted["fileSystem"]["write"], json!(["generated/new.txt"]));
        assert_eq!(
            granted["fileSystem"]["entries"].as_array().unwrap().len(),
            2
        );
        let projection = granted.to_string();
        assert!(!projection.contains("escape"));
        assert!(!projection.contains(&outside.to_string_lossy().into_owned()));

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn user_input_response_requires_the_exact_pending_question_shape() {
        let questions = vec![
            PendingUserInputQuestion {
                id: "engine".into(),
            },
            PendingUserInputQuestion { id: "scope".into() },
        ];
        let response = user_input_response(
            Some(r#"{"answers":{"engine":{"answers":["Codex"]},"scope":{"answers":["Project","Global"]}}}"#),
            &questions,
            false,
        )
        .unwrap();
        assert_eq!(response["answers"]["engine"]["answers"], json!(["Codex"]));
        assert_eq!(
            response["answers"]["scope"]["answers"],
            json!(["Project", "Global"])
        );

        for invalid in [
            r#"{"answers":{"engine":{"answers":["Codex"]}}}"#,
            r#"{"answers":{"engine":{"answers":["Codex"]},"scope":{"answers":[]},"extra":{"answers":[]}}}"#,
            r#"{"answers":{"engine":{"answers":["Codex"]},"scope":{"answers":[]}},"metadata":{}}"#,
            r#"{"answers":{"engine":{"answers":["Codex"],"secret":"leak"},"scope":{"answers":[]}}}"#,
        ] {
            assert!(user_input_response(Some(invalid), &questions, false).is_err());
        }
    }

    #[test]
    fn cancelled_user_input_never_parses_or_replays_secret_answers() {
        let questions = vec![PendingUserInputQuestion {
            id: "secret".into(),
        }];
        assert_eq!(
            user_input_response(Some("not-json and must not be persisted"), &questions, true)
                .unwrap(),
            json!({"answers": {}})
        );
    }

    #[test]
    fn unix_timestamps_use_rfc3339_utc() {
        assert_eq!(rfc3339_from_unix(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_from_unix(1_782_864_000), "2026-07-01T00:00:00Z");
    }
}
