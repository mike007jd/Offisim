use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::HostError;
use crate::task_workspace_binding::{
    validate_task_workspace_binding_authority, IssueTaskWorkspaceBinding, TaskWorkspaceAccess,
    TaskWorkspaceBinding,
};

use super::workspace_files::{is_workspace_file_operation, run_workspace_file_operation};

/// Ask mode: live stdin writers for running Pi hosts, keyed by request id. While
/// a host pauses a tool awaiting the user's answer to a Pi extension-UI prompt,
/// `agent_runtime_answer` looks the writer up here and writes a one-line response
/// back to the child's stdin. The entry is inserted when the run starts and
/// removed when it ends, which drops the last handle and closes the child's
/// stdin (EOF).
static PI_STDIN: Lazy<Mutex<HashMap<String, Arc<AsyncMutex<ChildStdin>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
#[derive(Debug, Clone)]
struct ExecutionPreparationState {
    target_digest: String,
    acknowledged: bool,
    registered_at: Instant,
}

static EXECUTION_PREPARATIONS: Lazy<Mutex<HashMap<(String, String), ExecutionPreparationState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
const EXECUTION_PREPARATION_REPLAY_TTL: Duration = Duration::from_secs(30 * 60);
pub(super) const PI_MCP_CALL_TIMEOUT: Duration = Duration::from_secs(75);

pub(super) fn pi_stdin_guard(
) -> std::sync::MutexGuard<'static, HashMap<String, Arc<AsyncMutex<ChildStdin>>>> {
    PI_STDIN
        .lock()
        .unwrap_or_else(|_| panic!("pi_agent_host PI_STDIN poisoned"))
}

/// Removes a request's live stdin writer from `PI_STDIN` on any exit path
/// (normal end, abort, error, panic), dropping the last handle → child EOF.
pub(super) struct StdinGuard(pub(super) Option<String>);

impl Drop for StdinGuard {
    fn drop(&mut self) {
        if let Some(id) = self.0.take() {
            pi_stdin_guard().remove(&id);
            clear_execution_preparations(&id);
        }
    }
}

fn execution_preparations_guard(
) -> std::sync::MutexGuard<'static, HashMap<(String, String), ExecutionPreparationState>> {
    EXECUTION_PREPARATIONS
        .lock()
        .unwrap_or_else(|_| panic!("pi_agent_host EXECUTION_PREPARATIONS poisoned"))
}

fn clear_execution_preparations(request_id: &str) {
    let now = Instant::now();
    execution_preparations_guard().retain(|(request, _), state| {
        (request != request_id || state.acknowledged)
            && now.duration_since(state.registered_at) <= EXECUTION_PREPARATION_REPLAY_TTL
    });
}

/// Register the exact host preparation before it is forwarded to the renderer.
/// Replaying an identical frame is idempotent; reusing a prepare id with another
/// digest is a protocol violation and terminates the sidecar.
pub(super) fn register_execution_prepared(
    request_id: &str,
    prepare_id: &str,
    target_digest: &str,
) -> Result<(), HostError> {
    if request_id.trim().is_empty()
        || prepare_id.trim().is_empty()
        || target_digest.trim().is_empty()
    {
        return Err(HostError::Protocol(
            "Execution preparation is missing requestId, prepareId, or targetDigest".into(),
        ));
    }
    let key = (request_id.to_string(), prepare_id.to_string());
    let mut preparations = execution_preparations_guard();
    let now = Instant::now();
    preparations.retain(|_, state| {
        now.duration_since(state.registered_at) <= EXECUTION_PREPARATION_REPLAY_TTL
    });
    match preparations.get(&key) {
        Some(existing) if existing.target_digest == target_digest => Ok(()),
        Some(_) => Err(HostError::Protocol(format!(
            "Execution preparation id was reused with another digest: {prepare_id}"
        ))),
        None => {
            preparations.insert(
                key,
                ExecutionPreparationState {
                    target_digest: target_digest.to_string(),
                    acknowledged: false,
                    registered_at: now,
                },
            );
            Ok(())
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionTargetAck {
    r#type: &'static str,
    request_id: String,
    prepare_id: String,
    target_digest: String,
}

/// Renderer acknowledgement for a host-observed execution identity. The
/// renderer may only acknowledge an exact preparation frame Rust already saw.
/// Duplicate acknowledgements for a replayed event are idempotent.
pub(super) async fn confirm_execution_impl(
    request_id: String,
    prepare_id: String,
    target_digest: String,
) -> Result<(), String> {
    let key = (request_id.clone(), prepare_id.clone());
    {
        let mut preparations = execution_preparations_guard();
        let now = Instant::now();
        preparations.retain(|_, state| {
            now.duration_since(state.registered_at) <= EXECUTION_PREPARATION_REPLAY_TTL
        });
        let Some(state) = preparations.get_mut(&key) else {
            return Err("No matching execution preparation is pending".into());
        };
        if state.target_digest != target_digest {
            return Err("Execution target digest does not match the prepared identity".into());
        }
        if state.acknowledged {
            return Ok(());
        }
        state.acknowledged = true;
    }

    let writer = pi_stdin_guard().get(&request_id).cloned();
    let Some(writer) = writer else {
        if let Some(state) = execution_preparations_guard().get_mut(&key) {
            state.acknowledged = false;
        }
        return Err("Execution host stdin is no longer available".into());
    };
    let response = ExecutionTargetAck {
        r#type: "executionTargetAck",
        request_id,
        prepare_id,
        target_digest,
    };
    let mut line = serde_json::to_string(&response)
        .map_err(|err| format!("Serialize execution target acknowledgement: {err}"))?;
    line.push('\n');
    let write_result = async {
        let mut stdin = writer.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|err| format!("Write execution target acknowledgement: {err}"))?;
        stdin
            .flush()
            .await
            .map_err(|err| format!("Flush execution target acknowledgement: {err}"))
    }
    .await;
    if write_result.is_err() {
        if let Some(state) = execution_preparations_guard().get_mut(&key) {
            state.acknowledged = false;
        }
    }
    write_result
}

/// Inbound `mcpResult` line written back to the host's stdin after the Rust host
/// services an intercepted `mcpCall` (mirrors PiUiResponse / the uiResponse line).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PiMcpResult {
    pub(super) id: String,
    pub(super) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) is_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiWorktreeResult {
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiVerifyResult {
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Service an intercepted `mcpCall`: invoke the tool through mcp_bridge in-process
/// and write a matching `mcpResult` line back to the host's stdin. A missing
/// registry yields an error mcpResult; a missing stdin channel is a host error so
/// the run fails visibly instead of leaving the tool call parked forever.
pub(super) async fn handle_mcp_call<R: tauri::Runtime>(
    app: &AppHandle<R>,
    request_id: Option<&str>,
    id: String,
    server: String,
    tool: String,
    arguments: Option<serde_json::Value>,
) -> Result<(), HostError> {
    let Some(request_id) = request_id else {
        eprintln!("[pi-agent-host] mcpCall on a lane with no stdin channel; dropping id={id}");
        return Ok(());
    };
    let args = arguments.unwrap_or_else(|| serde_json::json!({}));
    let response = match app.try_state::<crate::mcp_bridge::commands::ProcessRegistry>() {
        Some(registry) => {
            match crate::mcp_bridge::commands::invoke_mcp_tool(
                registry.inner(),
                &server,
                &tool,
                args,
            )
            .await
            {
                Ok(call) => PiMcpResult {
                    id,
                    ok: true,
                    content: Some(call.content),
                    is_error: Some(call.is_error),
                    error: None,
                },
                Err(err) => PiMcpResult {
                    id,
                    ok: false,
                    content: None,
                    is_error: None,
                    error: Some(err.to_string()),
                },
            }
        }
        None => PiMcpResult {
            id,
            ok: false,
            content: None,
            is_error: None,
            error: Some("MCP bridge is not available".into()),
        },
    };
    write_mcp_result(request_id, &response).await
}

pub(super) async fn handle_worktree_call<R: tauri::Runtime>(
    app: &AppHandle<R>,
    request_id: Option<&str>,
    workspace_binding: Option<&TaskWorkspaceBinding>,
    id: String,
    op: String,
    args: Option<serde_json::Value>,
    cancellation: Option<&CancellationToken>,
) -> Result<(), HostError> {
    let Some(request_id) = request_id else {
        eprintln!("[pi-agent-host] worktreeCall on a lane with no stdin channel; dropping id={id}");
        return Ok(());
    };
    let binding = workspace_binding.ok_or_else(|| {
        HostError::Protocol("Pi worktreeCall is missing its backend workspace binding.".into())
    })?;
    if request_id != binding.request_id {
        return Err(HostError::Protocol(
            "Pi worktreeCall request does not match its backend workspace binding.".into(),
        ));
    }
    let requested_access = worktree_operation_access(&op).map_err(HostError::Request)?;
    let scope = IssueTaskWorkspaceBinding {
        company_id: &binding.company_id,
        project_id: &binding.project_id,
        thread_id: &binding.thread_id,
        turn_id: &binding.turn_id,
        request_id: &binding.request_id,
        access: requested_access,
    };
    validate_task_workspace_binding_authority(app, &binding.binding_ref, scope)
        .map_err(|error| error.into_host_error())?;
    let args = args.unwrap_or_else(|| serde_json::json!({}));
    let response = if is_workspace_file_operation(&op) {
        match run_workspace_file_operation(app, binding, &op, args, cancellation).await {
            Ok(result) => PiWorktreeResult {
                id,
                ok: true,
                result: Some(result),
                error: None,
                error_code: None,
            },
            Err(error) => PiWorktreeResult {
                id,
                ok: false,
                result: None,
                error: Some(error.message),
                error_code: Some(error.code.to_string()),
            },
        }
    } else {
        match run_worktree_op(app, binding, &op, args, cancellation).await {
            Ok(result) => PiWorktreeResult {
                id,
                ok: true,
                result: Some(result),
                error: None,
                error_code: None,
            },
            Err(error) => PiWorktreeResult {
                id,
                ok: false,
                result: None,
                error: Some(error),
                error_code: None,
            },
        }
    };
    write_worktree_result(request_id, &response).await
}

fn worktree_operation_access(op: &str) -> Result<TaskWorkspaceAccess, String> {
    match op {
        "isGitRepo" | "validateCwd" | "worktreeChanged" | "diff" | "diffText" | "fileRead"
        | "fileStat" | "fileList" | "fileFind" | "fileGrep" => Ok(TaskWorkspaceAccess::Read),
        "addWorktree" | "removeWorktree" | "discardWorktree" | "executeBash" | "commitAll"
        | "merge" | "fileWrite" => Ok(TaskWorkspaceAccess::Write),
        other => Err(format!("unknown worktree operation '{other}'")),
    }
}

pub(super) async fn handle_verify_call<R: tauri::Runtime>(
    app: &AppHandle<R>,
    request_id: Option<&str>,
    workspace_binding: Option<&TaskWorkspaceBinding>,
    id: String,
    project_id: String,
    cwd: String,
    command: String,
) -> Result<(), HostError> {
    let Some(request_id) = request_id else {
        eprintln!("[pi-agent-host] verifyCall on a lane with no stdin channel; dropping id={id}");
        return Ok(());
    };
    let binding = workspace_binding.ok_or_else(|| {
        HostError::Protocol("Pi verifyCall is missing its backend workspace binding.".into())
    })?;
    if request_id != binding.request_id {
        return Err(HostError::Protocol(
            "Pi verifyCall request does not match its backend workspace binding.".into(),
        ));
    }
    let verify_scope = IssueTaskWorkspaceBinding {
        company_id: &binding.company_id,
        project_id: &binding.project_id,
        thread_id: &binding.thread_id,
        turn_id: &binding.turn_id,
        request_id: &binding.request_id,
        access: TaskWorkspaceAccess::Verify,
    };
    validate_task_workspace_binding_authority(app, &binding.binding_ref, verify_scope)
        .map_err(|error| error.into_host_error())?;

    let binding_authority = binding.authorized_root();
    let requested_cwd = resolve_bound_verify_cwd(app, binding, &project_id, &cwd).await;
    let response = match requested_cwd {
        Ok(requested_cwd) => match crate::builtin_tools::execute_trusted_verification(
            app,
            &binding_authority,
            &requested_cwd,
            &command,
            5 * 60 * 1000,
            Some(1024 * 1024),
            &binding.project_id,
            None,
        )
        .await
        {
            Ok(result) => PiVerifyResult {
                id,
                ok: true,
                result: Some(serde_json::to_value(result).map_err(|err| {
                    HostError::Request(format!("Serialize verify command result: {err}"))
                })?),
                error: None,
            },
            Err(error) => PiVerifyResult {
                id,
                ok: false,
                result: None,
                error: Some(error),
            },
        },
        Err(error) => PiVerifyResult {
            id,
            ok: false,
            result: None,
            error: Some(error),
        },
    };
    write_verify_result(request_id, &response).await
}

async fn resolve_bound_verify_cwd<R: tauri::Runtime>(
    app: &AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    sidecar_project_id: &str,
    sidecar_cwd: &str,
) -> Result<PathBuf, String> {
    if sidecar_project_id.trim() != binding.project_id {
        return Err("verifyCall projectId does not match the backend workspace binding".into());
    }
    if sidecar_cwd.is_empty() {
        return Err("verifyCall cwd is required".into());
    }
    let requested = PathBuf::from(sidecar_cwd);
    let candidate = if requested.is_absolute() {
        requested
    } else {
        binding.canonical_root.join(requested)
    };
    let lease_root = binding.canonical_root.join(".offisim").join("worktrees");
    if candidate.starts_with(&lease_root) {
        return crate::git::require_registered_workspace_lease(app, binding, &candidate).await;
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Resolve verifyCall cwd: {error}"))?;
    crate::builtin_tools::ensure_inside_workspace(
        &canonical,
        std::slice::from_ref(&binding.canonical_root),
    )?;
    Ok(canonical)
}

async fn run_worktree_op<R: tauri::Runtime>(
    app: &AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    op: &str,
    args: serde_json::Value,
    cancellation: Option<&CancellationToken>,
) -> Result<serde_json::Value, String> {
    let root = &binding.canonical_root;
    match op {
        "isGitRepo" => {
            let result = crate::git::run_git_validated(
                vec!["rev-parse".into(), "--is-inside-work-tree".into()],
                binding,
                Some(root),
            )
            .await?;
            Ok(serde_json::Value::Bool(
                result.ok && result.stdout.trim() == "true",
            ))
        }
        "addWorktree" => {
            binding.verify_live_root()?;
            let branch = worktree_arg(&args, "branch")?;
            let path = worktree_arg(&args, "path")?;
            let lease_id = worktree_arg(&args, "leaseId")?;
            let child_run_id = worktree_arg(&args, "runId")?;
            let destination = crate::git::validate_new_workspace_lease_request(
                root,
                &lease_id,
                &child_run_id,
                &branch,
                &path,
            )?;
            let result =
                crate::git::run_task_workspace_worktree_add(binding, &branch, &destination).await?;
            if result.ok {
                binding.verify_live_root()?;
                crate::git::register_task_workspace_lease(
                    app,
                    binding,
                    &lease_id,
                    &child_run_id,
                    &branch,
                    &destination,
                )
                .await?;
                Ok(serde_json::json!({ "ok": true }))
            } else {
                Err(nonzero_git_error(result))
            }
        }
        "validateCwd" => {
            let claim = registered_workspace_process_claim(&args)?;
            let execution =
                crate::git::resolve_registered_workspace_process_cwd_exact(app, binding, &claim)
                    .await?;
            Ok(serde_json::json!({ "cwd": execution.cwd().to_string_lossy() }))
        }
        "executeBash" => {
            let cancellation = cancellation
                .ok_or_else(|| "Task Bash is missing its host cancellation scope".to_string())?;
            let requested_cwd = worktree_arg(&args, "cwd")?;
            let command = worktree_arg(&args, "command")?;
            let shell_path = worktree_arg(&args, "shellPath")?;
            let timeout_ms = args
                .get("timeoutMs")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(120_000)
                .clamp(1, 5 * 60 * 1_000) as u32;
            let execution = if requested_cwd == "." {
                if ["leaseId", "registeredRunId", "workspaceRoot", "branch"]
                    .iter()
                    .any(|field| args.get(field).is_some())
                {
                    return Err(
                        "Shared-root Bash must not carry an isolated workspace lease claim".into(),
                    );
                }
                binding.verify_live_root()?;
                crate::task_workspace_binding::AuthorizedProcessCwd::from_authority(
                    &binding.authorized_root(),
                    &binding.canonical_root,
                )?
            } else {
                let claim = registered_workspace_process_claim(&args)?;
                crate::git::resolve_registered_workspace_process_cwd_exact(app, binding, &claim)
                    .await?
            };
            let result = crate::builtin_tools::execute_trusted_task_bash(
                app,
                &binding.authorized_root(),
                execution,
                &command,
                &shell_path,
                timeout_ms,
                &binding.project_id,
                cancellation,
            )
            .await?;
            serde_json::to_value(result)
                .map_err(|error| format!("Serialize task Bash result: {error}"))
        }
        "removeWorktree" => {
            let path = worktree_arg(&args, "path")?;
            let cwd =
                crate::git::require_registered_workspace_lease(app, binding, Path::new(&path))
                    .await?;
            crate::git::close_registered_workspace_lease(app, binding, &cwd, "released").await?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "discardWorktree" => {
            let path = worktree_arg(&args, "path")?;
            let cwd =
                crate::git::require_registered_workspace_lease(app, binding, Path::new(&path))
                    .await?;
            crate::git::close_registered_workspace_lease(app, binding, &cwd, "discarded").await?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "worktreeChanged" => {
            let path = worktree_arg(&args, "path")?;
            let cwd =
                crate::git::require_registered_workspace_lease(app, binding, Path::new(&path))
                    .await?;
            Ok(serde_json::Value::Bool(
                crate::git::registered_workspace_lease_changed(app, binding, &cwd).await?,
            ))
        }
        "commitAll" => {
            // Merge carries committed work only; deterministically commit a
            // child's uncommitted remainder. The git whitelist takes explicit
            // pathspecs (no `add -A`), so stage exactly what porcelain reports.
            let path = worktree_arg(&args, "path")?;
            let message = worktree_arg(&args, "message")?;
            let cwd =
                crate::git::require_registered_workspace_lease(app, binding, Path::new(&path))
                    .await?;
            let status = crate::git::run_git_validated(
                vec!["status".into(), "--porcelain=v1".into(), "-z".into()],
                binding,
                Some(&cwd),
            )
            .await?;
            if !status.ok {
                return Err(nonzero_git_error(status));
            }
            let paths = parse_porcelain_paths(&status.stdout);
            if paths.is_empty() {
                return Ok(serde_json::json!({ "ok": true, "committed": false }));
            }
            let mut add_args: Vec<String> = vec!["add".into(), "--".into()];
            add_args.extend(paths);
            let add = crate::git::run_git_validated(add_args, binding, Some(&cwd)).await?;
            if !add.ok {
                return Err(nonzero_git_error(add));
            }
            let commit = crate::git::run_git_validated(
                vec!["commit".into(), "-m".into(), message],
                binding,
                Some(&cwd),
            )
            .await?;
            if !commit.ok {
                return Err(nonzero_git_error(commit));
            }
            Ok(serde_json::json!({ "ok": true, "committed": true }))
        }
        "diff" => {
            let path = worktree_arg(&args, "path")?;
            let cwd =
                crate::git::require_registered_workspace_lease(app, binding, Path::new(&path))
                    .await?;
            let root_head = crate::git::run_git_validated(
                vec!["rev-parse".into(), "HEAD".into()],
                binding,
                Some(root),
            )
            .await?;
            if !root_head.ok {
                return Err(nonzero_git_error(root_head));
            }
            let base = root_head.stdout.trim().to_string();
            let result = crate::git::run_git_validated(
                vec![
                    "diff".into(),
                    "--name-only".into(),
                    "-z".into(),
                    base,
                    "HEAD".into(),
                ],
                binding,
                Some(&cwd),
            )
            .await?;
            if result.ok {
                Ok(serde_json::json!(parse_nul_paths(&result.stdout)))
            } else {
                Err(nonzero_git_error(result))
            }
        }
        "merge" => {
            let branch = worktree_arg(&args, "branch")?;
            crate::git::require_registered_workspace_lease_branch(app, binding, &branch).await?;
            let result = crate::git::run_git_validated(
                vec!["merge".into(), "--no-ff".into(), branch],
                binding,
                Some(root),
            )
            .await?;
            if result.ok {
                return Ok(serde_json::json!({ "ok": true, "conflicts": Vec::<String>::new() }));
            }
            let merge_error = nonzero_git_error(result);
            let conflicts = crate::git::run_git_validated(
                vec![
                    "diff".into(),
                    "--name-only".into(),
                    "--diff-filter=U".into(),
                    "-z".into(),
                ],
                binding,
                Some(root),
            )
            .await?;
            if !conflicts.ok {
                return Err(format!(
                    "{merge_error}; inspect merge conflicts: {}",
                    nonzero_git_error(conflicts)
                ));
            }
            let conflicts = parse_nul_paths(&conflicts.stdout);
            if conflicts.is_empty() {
                return Err(merge_error);
            }
            Ok(serde_json::json!({ "ok": false, "conflicts": conflicts }))
        }
        "diffText" => {
            let path = worktree_arg(&args, "path")?;
            let changed_path = worktree_arg(&args, "changedPath")?;
            let cwd =
                crate::git::require_registered_workspace_lease(app, binding, Path::new(&path))
                    .await?;
            let root_head = crate::git::run_git_validated(
                vec!["rev-parse".into(), "HEAD".into()],
                binding,
                Some(root),
            )
            .await?;
            if !root_head.ok {
                return Err(nonzero_git_error(root_head));
            }
            let result = crate::git::run_git_validated(
                vec![
                    "diff".into(),
                    "--unified=3".into(),
                    root_head.stdout.trim().into(),
                    "HEAD".into(),
                    "--".into(),
                    changed_path,
                ],
                binding,
                Some(&cwd),
            )
            .await?;
            if result.ok {
                Ok(serde_json::Value::String(result.stdout))
            } else {
                Err(nonzero_git_error(result))
            }
        }
        other => Err(format!("unknown worktree operation '{other}'")),
    }
}

fn worktree_arg(args: &serde_json::Value, name: &str) -> Result<String, String> {
    let value = args
        .get(name)
        .and_then(|value| value.as_str())
        .ok_or_else(|| format!("worktree operation requires string arg '{name}'"))?;
    if matches!(name, "path" | "changedPath" | "cwd" | "command") {
        if value.is_empty() {
            Err(format!("worktree operation requires string arg '{name}'"))
        } else {
            Ok(value.to_string())
        }
    } else {
        let value = value.trim();
        if value.is_empty() {
            Err(format!("worktree operation requires string arg '{name}'"))
        } else {
            Ok(value.to_string())
        }
    }
}

fn registered_workspace_process_claim(
    args: &serde_json::Value,
) -> Result<crate::git::RegisteredWorkspaceProcessClaim, String> {
    Ok(crate::git::RegisteredWorkspaceProcessClaim {
        lease_id: worktree_arg(args, "leaseId")?,
        registered_run_id: worktree_arg(args, "registeredRunId")?,
        workspace_root: PathBuf::from(worktree_arg(args, "workspaceRoot")?),
        cwd: PathBuf::from(worktree_arg(args, "cwd")?),
        branch: worktree_arg(args, "branch")?,
    })
}

fn nonzero_git_error(result: crate::git::GitResult) -> String {
    let stderr = result.stderr.trim();
    if !stderr.is_empty() {
        stderr.to_string()
    } else {
        result.stdout.trim().to_string()
    }
}

fn parse_nul_paths(stdout: &str) -> Vec<String> {
    stdout
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

/// Paths from `git status --porcelain=v1 -z`. Rename/copy output is
/// `target\0source\0`; both sides are required by the explicit-pathspec add.
fn parse_porcelain_paths(stdout: &str) -> Vec<String> {
    let fields = stdout.split('\0').collect::<Vec<_>>();
    let mut paths = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let record = fields[index];
        index += 1;
        if record.len() < 4 {
            continue;
        }

        let status = &record[..2];
        let path = &record[3..];
        if !path.is_empty() {
            paths.push(path.to_string());
        }

        if status.contains('R') || status.contains('C') {
            if let Some(source_path) = fields.get(index).filter(|path| !path.is_empty()) {
                paths.push((*source_path).to_string());
            }
            index += 1;
        }
    }
    paths.dedup();
    paths
}

#[cfg(test)]
mod porcelain_tests {
    use super::{
        parse_nul_paths, parse_porcelain_paths, registered_workspace_process_claim, worktree_arg,
        worktree_operation_access, PiWorktreeResult,
    };
    use crate::task_workspace_binding::TaskWorkspaceAccess;

    #[test]
    fn nul_porcelain_preserves_exact_paths_and_both_rename_sides() {
        assert_eq!(
            parse_porcelain_paths(
                "?? docs/file with space.md\0 M 中文/\"quoted\".md\0R  new name.md\0old name.md\0"
            ),
            vec![
                "docs/file with space.md",
                "中文/\"quoted\".md",
                "new name.md",
                "old name.md",
            ]
        );
    }

    #[test]
    fn nul_path_list_preserves_spaces_newlines_and_secret_shaped_names() {
        assert_eq!(
            parse_nul_paths(
                "file with space.md\0line\nbreak.md\0offisim_secret_token_abcdefghijklmnopqrstuvwxyz.md\0"
            ),
            vec![
                "file with space.md",
                "line\nbreak.md",
                "offisim_secret_token_abcdefghijklmnopqrstuvwxyz.md",
            ]
        );
    }

    #[test]
    fn worktree_path_args_preserve_leading_and_trailing_whitespace() {
        let exact = " leading space/line\nbreak/trailing \n";
        let args = serde_json::json!({
            "changedPath": exact,
            "branch": "  feature/exact-path  "
        });
        assert_eq!(
            worktree_arg(&args, "changedPath").expect("exact changedPath"),
            exact
        );
        assert_eq!(
            worktree_arg(&args, "branch").expect("normalized branch"),
            "feature/exact-path"
        );
        let whitespace_only = serde_json::json!({ "changedPath": " " });
        assert_eq!(
            worktree_arg(&whitespace_only, "changedPath").expect("whitespace-only path"),
            " "
        );
    }

    #[test]
    fn registered_process_claim_requires_all_five_nonempty_string_fields() {
        let valid = serde_json::json!({
            "leaseId": "lease-1",
            "registeredRunId": "run-1",
            "workspaceRoot": "/fixture/project",
            "cwd": "/fixture/project/.offisim/worktrees/lease-1",
            "branch": "offisim/lease/run-1-lease-1"
        });
        let claim = registered_workspace_process_claim(&valid).expect("valid process claim");
        assert_eq!(claim.lease_id, "lease-1");
        assert_eq!(claim.registered_run_id, "run-1");

        for field in [
            "leaseId",
            "registeredRunId",
            "workspaceRoot",
            "cwd",
            "branch",
        ] {
            let mut missing = valid.clone();
            missing.as_object_mut().expect("claim object").remove(field);
            assert!(
                registered_workspace_process_claim(&missing).is_err(),
                "missing {field} must fail"
            );

            let mut empty = valid.clone();
            empty[field] = serde_json::Value::String(String::new());
            assert!(
                registered_workspace_process_claim(&empty).is_err(),
                "empty {field} must fail"
            );
        }
    }

    #[test]
    fn workspace_file_operations_have_exact_access_and_stable_error_code_wire() {
        for operation in ["fileRead", "fileStat", "fileList", "fileFind", "fileGrep"] {
            assert!(
                worktree_operation_access(operation).expect("known read operation")
                    == TaskWorkspaceAccess::Read
            );
        }
        assert!(
            worktree_operation_access("fileWrite").expect("known write operation")
                == TaskWorkspaceAccess::Write
        );

        let encoded = serde_json::to_value(PiWorktreeResult {
            id: "file-1".into(),
            ok: false,
            result: None,
            error: Some("outside".into()),
            error_code: Some("workspace-out-of-bounds".into()),
        })
        .expect("serialize worktree result");
        assert_eq!(encoded["errorCode"], "workspace-out-of-bounds");
        assert!(encoded.get("error_code").is_none());
    }
}

/// Write an mcpResult line back to a running host's stdin (mirrors ui_response_impl).
/// A missing writer means the run already ended — the result is moot, not an error.
pub(super) async fn write_mcp_result(
    request_id: &str,
    response: &PiMcpResult,
) -> Result<(), HostError> {
    let writer = pi_stdin_guard().get(request_id).cloned();
    let Some(writer) = writer else {
        return Err(HostError::Request(format!(
            "Pi Agent stdin channel missing while writing mcpResult id={}",
            response.id
        )));
    };
    let mut line = serde_json::to_string(response)
        .map_err(|err| HostError::Request(format!("Serialize mcpResult: {err}")))?;
    line.push('\n');
    let mut stdin = writer.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|err| HostError::Request(format!("Write mcpResult: {err}")))?;
    stdin
        .flush()
        .await
        .map_err(|err| HostError::Request(format!("Flush mcpResult: {err}")))?;
    Ok(())
}

async fn write_worktree_result(
    request_id: &str,
    response: &PiWorktreeResult,
) -> Result<(), HostError> {
    let writer = pi_stdin_guard().get(request_id).cloned();
    let Some(writer) = writer else {
        return Ok(());
    };
    let mut line = serde_json::to_string(response)
        .map_err(|err| HostError::Request(format!("Serialize worktreeResult: {err}")))?;
    line.push('\n');
    let mut stdin = writer.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|err| HostError::Request(format!("Write worktreeResult: {err}")))?;
    stdin
        .flush()
        .await
        .map_err(|err| HostError::Request(format!("Flush worktreeResult: {err}")))?;
    Ok(())
}

async fn write_verify_result(request_id: &str, response: &PiVerifyResult) -> Result<(), HostError> {
    let writer = pi_stdin_guard().get(request_id).cloned();
    let Some(writer) = writer else {
        return Ok(());
    };
    let mut line = serde_json::to_string(response)
        .map_err(|err| HostError::Request(format!("Serialize verifyResult: {err}")))?;
    line.push('\n');
    let mut stdin = writer.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|err| HostError::Request(format!("Write verifyResult: {err}")))?;
    stdin
        .flush()
        .await
        .map_err(|err| HostError::Request(format!("Flush verifyResult: {err}")))?;
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
pub(super) struct PiUiResponse {
    pub(super) id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) confirmed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) cancelled: Option<bool>,
}

/// Shared interaction-answer impl. Ask mode: deliver the user's answer to a
/// paused Pi extension-UI prompt back to the running host by writing a one-line
/// response to its stdin. `request_id` locates the run; `id` matches the host's
/// `uiRequest`. A missing request id means the run already ended (the answer is
/// moot) — not an error. `agent_runtime_answer` calls this verbatim.
pub(super) async fn ui_response_impl(
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

pub(super) async fn control_impl(
    request_id: String,
    action: String,
    run_id: String,
) -> Result<(), String> {
    let writer = pi_stdin_guard().get(&request_id).cloned();
    let Some(writer) = writer else {
        return Ok(());
    };
    if action != "stopChild" || run_id.trim().is_empty() {
        return Err("Unsupported agent runtime control request".into());
    }
    let mut line =
        serde_json::json!({ "type": "control", "action": action, "runId": run_id }).to_string();
    line.push('\n');
    let mut stdin = writer.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|err| format!("Write Pi control: {err}"))?;
    stdin
        .flush()
        .await
        .map_err(|err| format!("Flush Pi control: {err}"))?;
    Ok(())
}
