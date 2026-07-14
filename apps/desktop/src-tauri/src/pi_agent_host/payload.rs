use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;

use crate::agent_host_runtime::{trusted_host_env, HostError};
use crate::task_workspace_binding::TaskWorkspaceBinding;

use super::types::{PiAgentCollaborateRequest, PiAgentEnhanceRequest, PiAgentExecuteRequest};

pub(super) fn pi_env(workspace_root: Option<&PathBuf>) -> HashMap<String, String> {
    trusted_host_env(workspace_root, &[], "OFFISIM_PI_AGENT_HOST")
}

pub(super) fn app_pi_session_dir<R: tauri::Runtime>(
    app: &AppHandle<R>,
    thread_id: &str,
) -> Result<PathBuf, HostError> {
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
    binding: &TaskWorkspaceBinding,
    session_dir: &Path,
    agent_dir: Option<&Path>,
    authorized_direct_delegation: Option<&serde_json::Value>,
) -> serde_json::Value {
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
        "sessionDir": session_dir.to_string_lossy().to_string(),
        "agentDir": agent_dir.map(|path| path.to_string_lossy().to_string()),
        "model": req.model,
        "permissionMode": req.permission_mode,
        "thinkingLevel": req.thinking_level,
        "systemPromptAppend": req.system_prompt_append,
        "skillPaths": req.skill_paths,
        // Delegation scope (Phase 1): the root run id + thread id let the host's
        // supervisor stamp child agentRun events, and the roster tells it which
        // employees the root agent may delegate to.
        "threadId": req.thread_id,
        // Project identity and delegated-write verification policy are derived
        // from the backend-issued binding. Renderer request fields cannot
        // override the canonical project configuration. The speaking employee
        // remains request-scoped so persona attribution survives delegation.
        "projectId": binding.project_id,
        "projectVerifyCommand": binding.project_verify_command,
        "projectVerifyMaxAttempts": binding.project_verify_max_attempts,
        "projectVerifyTokenBudget": binding.project_verify_token_budget,
        "employeeId": req.employee_id,
        "rootRunId": req.root_run_id,
        "roster": req.roster,
        // Verified Missions context (MS-005): forwarded verbatim. The host
        // registers the mission-bridge extension only when this is present.
        "missionContextJson": req.mission_context_json,
        "mcpTools": req.mcp_tools,
    });
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
