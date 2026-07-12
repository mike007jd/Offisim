use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;
use tokio::sync::Mutex as AsyncMutex;

use crate::agent_host_runtime::HostError;

/// Ask mode: live stdin writers for running Pi hosts, keyed by request id. While
/// a host pauses a tool awaiting the user's answer to a Pi extension-UI prompt,
/// `pi_agent_ui_response` looks the writer up here and writes a one-line response
/// back to the child's stdin. The entry is inserted when the run starts and
/// removed when it ends, which drops the last handle and closes the child's
/// stdin (EOF).
static PI_STDIN: Lazy<Mutex<HashMap<String, Arc<AsyncMutex<ChildStdin>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
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
        }
    }
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

pub(super) async fn handle_worktree_call(
    request_id: Option<&str>,
    workspace_root: Option<&Path>,
    id: String,
    op: String,
    args: Option<serde_json::Value>,
) -> Result<(), HostError> {
    let Some(request_id) = request_id else {
        eprintln!("[pi-agent-host] worktreeCall on a lane with no stdin channel; dropping id={id}");
        return Ok(());
    };
    let response = match workspace_root {
        Some(root) => {
            match run_worktree_op(root, &op, args.unwrap_or_else(|| serde_json::json!({}))).await {
                Ok(result) => PiWorktreeResult {
                    id,
                    ok: true,
                    result: Some(result),
                    error: None,
                },
                Err(error) => PiWorktreeResult {
                    id,
                    ok: false,
                    result: None,
                    error: Some(error),
                },
            }
        }
        None => PiWorktreeResult {
            id,
            ok: false,
            result: None,
            error: Some("workspace root is not available for worktree operations".into()),
        },
    };
    write_worktree_result(request_id, &response).await
}

pub(super) async fn handle_verify_call<R: tauri::Runtime>(
    app: &AppHandle<R>,
    request_id: Option<&str>,
    id: String,
    project_id: String,
    cwd: String,
    command: String,
) -> Result<(), HostError> {
    let Some(request_id) = request_id else {
        eprintln!("[pi-agent-host] verifyCall on a lane with no stdin channel; dropping id={id}");
        return Ok(());
    };
    let response = match crate::builtin_tools::bash_execute(
        app.clone(),
        cwd,
        command,
        5 * 60 * 1000,
        Some(1024 * 1024),
        Some(project_id),
        None,
        None,
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
    };
    write_verify_result(request_id, &response).await
}

async fn run_worktree_op(
    root: &Path,
    op: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match op {
        "isGitRepo" => {
            let result = crate::git::run_git_validated(
                vec!["rev-parse".into(), "--is-inside-work-tree".into()],
                root,
                Some(root),
            )
            .await?;
            Ok(serde_json::Value::Bool(
                result.ok && result.stdout.trim() == "true",
            ))
        }
        "addWorktree" => {
            let branch = worktree_arg(&args, "branch")?;
            let path = worktree_arg(&args, "path")?;
            let result = crate::git::run_git_validated(
                vec!["worktree".into(), "add".into(), "-b".into(), branch, path],
                root,
                Some(root),
            )
            .await?;
            if result.ok {
                Ok(serde_json::json!({ "ok": true }))
            } else {
                Err(nonzero_git_error(result))
            }
        }
        "removeWorktree" => {
            let path = worktree_arg(&args, "path")?;
            let result = crate::git::run_git_validated(
                vec!["worktree".into(), "remove".into(), path],
                root,
                Some(root),
            )
            .await?;
            if result.ok {
                Ok(serde_json::json!({ "ok": true }))
            } else {
                Err(nonzero_git_error(result))
            }
        }
        "discardWorktree" => {
            let path = worktree_arg(&args, "path")?;
            let lease_id = Path::new(&path)
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "discard worktree path has no lease id".to_string())?;
            crate::git::discard_workspace_lease_at(root, lease_id).await?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "worktreeChanged" => {
            let path = worktree_arg(&args, "path")?;
            let cwd = PathBuf::from(path);
            let result = crate::git::run_git_validated(
                vec!["status".into(), "--porcelain".into()],
                root,
                Some(&cwd),
            )
            .await?;
            if result.ok {
                Ok(serde_json::Value::Bool(!result.stdout.trim().is_empty()))
            } else {
                Err(nonzero_git_error(result))
            }
        }
        "commitAll" => {
            // Merge carries committed work only; deterministically commit a
            // child's uncommitted remainder. The git whitelist takes explicit
            // pathspecs (no `add -A`), so stage exactly what porcelain reports.
            let path = worktree_arg(&args, "path")?;
            let message = worktree_arg(&args, "message")?;
            let cwd = PathBuf::from(path);
            let status = crate::git::run_git_validated(
                vec!["status".into(), "--porcelain".into()],
                root,
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
            let add = crate::git::run_git_validated(add_args, root, Some(&cwd)).await?;
            if !add.ok {
                return Err(nonzero_git_error(add));
            }
            let commit = crate::git::run_git_validated(
                vec!["commit".into(), "-m".into(), message],
                root,
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
            let cwd = PathBuf::from(path);
            let root_head = crate::git::run_git_validated(
                vec!["rev-parse".into(), "HEAD".into()],
                root,
                Some(root),
            )
            .await?;
            if !root_head.ok {
                return Err(nonzero_git_error(root_head));
            }
            let base = root_head.stdout.trim().to_string();
            let result = crate::git::run_git_validated(
                vec!["diff".into(), "--name-only".into(), base, "HEAD".into()],
                root,
                Some(&cwd),
            )
            .await?;
            if result.ok {
                Ok(serde_json::json!(parse_line_paths(&result.stdout)))
            } else {
                Err(nonzero_git_error(result))
            }
        }
        "merge" => {
            let branch = worktree_arg(&args, "branch")?;
            let result = crate::git::run_git_validated(
                vec!["merge".into(), "--no-ff".into(), branch],
                root,
                Some(root),
            )
            .await?;
            Ok(serde_json::json!({
                "ok": result.ok,
                "conflicts": if result.ok { Vec::<String>::new() } else { parse_conflict_paths(&result.stdout, &result.stderr) },
            }))
        }
        "diffText" => {
            let path = worktree_arg(&args, "path")?;
            let changed_path = worktree_arg(&args, "changedPath")?;
            let cwd = PathBuf::from(path);
            let root_head = crate::git::run_git_validated(
                vec!["rev-parse".into(), "HEAD".into()],
                root,
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
                root,
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
    args.get(name)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("worktree operation requires string arg '{name}'"))
}

fn nonzero_git_error(result: crate::git::GitResult) -> String {
    let stderr = result.stderr.trim();
    if !stderr.is_empty() {
        stderr.to_string()
    } else {
        result.stdout.trim().to_string()
    }
}

fn parse_line_paths(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

/// Paths from `git status --porcelain` v1 output: strip the two status columns
/// and the separator; a rename entry (`R  old -> new`) yields the new side.
fn parse_porcelain_paths(stdout: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in stdout.lines() {
        if line.len() <= 3 || line.starts_with("##") {
            continue;
        }
        let entry = line[3..].trim();
        let path = match entry.split_once(" -> ") {
            Some((_, renamed)) => renamed,
            None => entry,
        };
        if !path.is_empty() {
            paths.push(path.to_string());
        }
    }
    paths
}

fn parse_conflict_paths(stdout: &str, stderr: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in stdout.lines().chain(stderr.lines()) {
        if let Some(path) = line
            .strip_prefix("CONFLICT")
            .and_then(|value| value.rsplit(": ").next())
        {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                paths.push(trimmed.to_string());
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
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
/// moot) — not an error. Both `pi_agent_ui_response` (back-compat) and
/// `agent_runtime_answer` (gateway) call this verbatim.
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
