use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;

use crate::agent_host_runtime::{trusted_host_env, HostError};
use crate::task_workspace_binding::TaskWorkspaceBinding;

use super::types::{PiAgentCollaborateRequest, PiAgentEnhanceRequest, PiAgentExecuteRequest};

pub(super) enum ExecuteWorkspacePayload<'a> {
    Bound(&'a TaskWorkspaceBinding),
    Unavailable { reason_code: &'a str },
}

pub(super) fn pi_env(workspace_root: Option<&PathBuf>) -> HashMap<String, String> {
    trusted_host_env(workspace_root, &[], "OFFISIM_PI_AGENT_HOST")
}

#[cfg(test)]
pub(crate) struct TestPiSessionDir(pub(crate) PathBuf);

pub(crate) fn app_pi_session_dir<R: tauri::Runtime>(
    app: &AppHandle<R>,
    thread_id: &str,
) -> Result<PathBuf, HostError> {
    #[cfg(test)]
    if let Some(session_dir) = app.try_state::<TestPiSessionDir>() {
        return Ok(session_dir.0.clone());
    }
    let _ = app;
    let base = crate::local_paths::offisim_storage_dir("pi-agent-sessions")
        .map_err(HostError::HostUnavailable)?;
    Ok(pi_session_dir_under(&base, thread_id))
}

pub(super) fn pi_session_dir_under(base: &Path, thread_id: &str) -> PathBuf {
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
    base.join(safe_thread_id)
}

pub(super) fn app_pi_agent_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .home_dir()
        .ok()
        .map(|home| home.join(".pi/agent"))
}

pub(super) fn sidecar_payload(
    req: &PiAgentExecuteRequest,
    workspace: ExecuteWorkspacePayload<'_>,
    session_dir: &Path,
    agent_dir: Option<&Path>,
    authorized_direct_delegation: Option<&serde_json::Value>,
    exact_session_file: Option<&Path>,
    exact_session_id: Option<&str>,
) -> serde_json::Value {
    let (binding, workspace_availability, workspace_unavailable_reason_code) = match workspace {
        ExecuteWorkspacePayload::Bound(binding) => (Some(binding), "bound", None),
        ExecuteWorkspacePayload::Unavailable { reason_code } => {
            (None, "unavailable", Some(reason_code))
        }
    };
    let has_workspace = binding.is_some();
    let project_id = binding
        .map(|binding| binding.project_id.as_str())
        .or(req.project_id.as_deref());
    let skill_paths = has_workspace.then_some(req.skill_paths.as_ref()).flatten();
    let roster = has_workspace.then_some(req.roster.as_ref()).flatten();
    let mission_context_json = has_workspace
        .then_some(req.mission_context_json.as_ref())
        .flatten();
    let mcp_tools = has_workspace.then_some(req.mcp_tools.as_ref()).flatten();
    let mut payload = serde_json::json!({
        // `mode` is the host dispatch discriminator (execute vs status); the
        // permission mode rides under a distinct key so it cannot collide.
        "mode": "execute",
        "text": req.text,
        // The Rust host fchdir(2)s the sidecar into the verified Project inode
        // immediately before exec. Every root-session file/tool operation must
        // stay relative to that inherited directory object; forwarding the
        // absolute catalog path would let Node resolve a same-path replacement.
        "cwd": ".",
        "workspaceRequirement": req.workspace_requirement.as_str(),
        "nativeSessionMode": req.native_session_mode.as_str(),
        "workspaceAvailability": workspace_availability,
        "workspaceUnavailableReasonCode": workspace_unavailable_reason_code,
        "sessionDir": session_dir.to_string_lossy().to_string(),
        "exactSessionFile": exact_session_file.map(|path| path.to_string_lossy().to_string()),
        "exactSessionId": exact_session_id,
        "agentDir": agent_dir.map(|path| path.to_string_lossy().to_string()),
        "model": req.model,
        "permissionMode": req.permission_mode,
        "thinkingLevel": req.thinking_level,
        "systemPromptAppend": req.system_prompt_append,
        "skillPaths": skill_paths,
        // Delegation scope (Phase 1): the root run id + thread id let the host's
        // supervisor stamp child agentRun events, and the roster tells it which
        // employees the root agent may delegate to.
        "threadId": req.thread_id,
        // Project identity and delegated-write verification policy are derived
        // from the backend-issued binding. Renderer request fields cannot
        // override the canonical project configuration. The speaking employee
        // remains request-scoped so persona attribution survives delegation.
        "projectId": project_id,
        "projectVerifyCommand": binding.and_then(|binding| binding.project_verify_command.as_ref()),
        "projectVerifyMaxAttempts": binding.map(|binding| binding.project_verify_max_attempts),
        "projectVerifyTokenBudget": binding.and_then(|binding| binding.project_verify_token_budget),
        "employeeId": req.employee_id,
        "rootRunId": req.root_run_id,
        "roster": roster,
        // Verified Missions context (MS-005): forwarded verbatim. The host
        // registers the mission-bridge extension only when this is present.
        "missionContextJson": mission_context_json,
        "mcpTools": mcp_tools,
    });
    if has_workspace {
        if let Some(direct_delegation) = authorized_direct_delegation {
            payload
                .as_object_mut()
                .expect("execute payload is an object")
                .insert("directDelegation".into(), direct_delegation.clone());
        }
        if let Some(delegation_limits) = &req.delegation_limits {
            payload
                .as_object_mut()
                .expect("execute payload is an object")
                .insert("delegationLimits".into(), delegation_limits.clone());
        }
    }
    payload
}

/// Build the Prompt Enhance sidecar payload (PR-06). `mode:'enhance'` routes the
/// host to its dedicated isolated path — no project workspace, no tools, no
/// persistence. The `cwd` is a NEUTRAL directory (never a project root), and
/// nothing scope-related is forwarded because enhance has no scope.
pub(super) fn enhance_payload(
    req: &PiAgentEnhanceRequest,
    cwd: &Path,
    agent_dir: Option<&Path>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "mode": "enhance",
        "requestId": req.request_id,
        "text": req.text,
        "systemPrompt": req.system_prompt,
        "cwd": cwd.to_string_lossy().to_string(),
        "agentDir": agent_dir.map(|path| path.to_string_lossy().to_string()),
        "model": req.model,
        "thinkingLevel": req.thinking_level,
    });
    if let Some(source_provenance) = &req.source_provenance {
        payload
            .as_object_mut()
            .expect("enhance payload is an object")
            .insert("sourceProvenance".into(), source_provenance.clone());
    }
    payload
}

/// Build the Collaboration sidecar payload (PR-03). `mode:'collaborate'` routes the
/// host to its STREAMING isolated path — no project workspace, no tools, no
/// persistence. The `cwd` is a NEUTRAL directory (never a project root). The scope
/// host correlation fields (collaboration thread / employee) identify the turn,
/// not a workspace; company scope is validated at the Tauri boundary but is not
/// consumed by the Node host. No `projectId`, `roster`, or `missionContextJson`
/// is forwarded.
pub(super) fn collaborate_payload(
    req: &PiAgentCollaborateRequest,
    cwd: &Path,
    agent_dir: Option<&Path>,
) -> serde_json::Value {
    serde_json::json!({
        "mode": "collaborate",
        "requestId": req.request_id,
        "text": req.text,
        "collaborationProfile": req.collaboration_profile,
        "mcpTools": req.mcp_tools,
        "cwd": cwd.to_string_lossy().to_string(),
        "agentDir": agent_dir.map(|path| path.to_string_lossy().to_string()),
        "collaborationThreadId": req.collaboration_thread_id,
        "employeeId": req.employee_id,
        "model": req.model,
        "thinkingLevel": req.thinking_level,
        "systemPromptAppend": req.system_prompt_append,
    })
}

/// Write the execute/status payload as the FIRST newline-delimited line on the
/// child's stdin. The host reads this first line as its request; in Ask mode any
/// later lines are uiResponse records. stdin is left OPEN — the caller decides
/// whether to keep it (execute, for extension UI responses) or close it (status,
/// single-shot).
pub(super) async fn write_payload(
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
