use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Runtime;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::process_group::{configure_process_group, terminate_process_group, ProcessGroupGuard};
use crate::task_workspace_binding::{
    resolve_task_workspace_claim_authority, resolve_task_workspace_evaluation_claim_authority,
    AuthorizedProcessCwd, AuthorizedWorkspaceRoot, TaskWorkspaceAccess, TaskWorkspaceBinding,
    TaskWorkspaceBindingClaim, TaskWorkspaceEvaluationLeaseClaim,
};
use crate::time_util::civil_from_days;

mod allowlist;
mod checkpoint;
mod exec;
mod lease;
mod worktree;

use allowlist::*;
use checkpoint::*;
use exec::*;
use lease::*;
use worktree::*;

pub(crate) use checkpoint::{
    create_registered_workspace_checkpoint, list_registered_workspace_checkpoints,
};
pub use exec::GitResult;
pub(crate) use exec::{run_git_validated, GitRootAuthority};
#[allow(unused_imports)]
pub(crate) use lease::{
    authorize_direct_delegation, close_registered_workspace_lease,
    create_competitive_draft_workspace_lease, register_task_workspace_lease,
    registered_workspace_lease_changed, require_registered_workspace_lease,
    require_registered_workspace_lease_branch, resolve_registered_workspace_process_cwd_exact,
    verify_competitive_draft_attempt, CompetitiveDraftContext, CompetitiveDraftWorkspaceLease,
    RegisteredWorkspaceProcessClaim,
};
pub(crate) use worktree::{run_task_workspace_worktree_add, validate_new_workspace_lease_request};
#[tauri::command]
pub async fn git_exec<R: Runtime>(
    app: tauri::AppHandle<R>,
    args: Vec<String>,
    project_id: String,
    cwd: Option<String>,
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
) -> Result<GitResult, String> {
    if binding_claim.is_some() && evaluation_lease.is_some() {
        return Err("git_exec accepts bindingClaim or evaluationLease, never both".into());
    }
    if args.first().map(String::as_str) == Some("worktree") {
        return Err(
            "git worktree lifecycle requires a backend-registered workspace lease command".into(),
        );
    }
    if is_checkpoint_plumbing(&args) {
        return Err(
            "git checkpoint plumbing requires a backend-registered workspace lease command".into(),
        );
    }
    let root_authority = if binding_claim.is_some() || evaluation_lease.is_some() {
        validate_binding_git_args(&args)?;
        if cwd.as_deref().is_some_and(|value| !value.is_empty()) {
            return Err(
                "task-workspace git status derives cwd from backend authority; omit cwd".into(),
            );
        }
        if let Some(lease) = evaluation_lease.as_ref() {
            resolve_task_workspace_evaluation_claim_authority(
                &app,
                lease,
                Some(&project_id),
                TaskWorkspaceAccess::Read,
            )
            .await?
        } else {
            let claim = binding_claim
                .as_ref()
                .ok_or_else(|| "task workspace authority is required".to_string())?;
            resolve_task_workspace_claim_authority(
                &app,
                claim,
                Some(&project_id),
                TaskWorkspaceAccess::Read,
            )
            .await?
        }
    } else {
        project_workspace_root(&app, &project_id).await?
    };
    let root = root_authority.git_root();
    let cwd_path = match cwd.as_deref().filter(|value| !value.is_empty()) {
        Some(value) => resolve_git_cwd(root, value)?,
        None => root.to_path_buf(),
    };
    run_git_validated(args, &root_authority, Some(&cwd_path)).await
}

#[tauri::command]
pub async fn workspace_lease_list<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<Vec<WorkspaceLeaseLifecycleRow>, String> {
    if project_id.trim().is_empty() {
        return Err("workspace_lease_list requires a Project id".into());
    }
    let pool = crate::local_db::get_offisim_pool(&app)?;
    workspace_lease_list_from_pool(&pool, &project_id).await
}

#[tauri::command]
pub async fn workspace_lease_discard<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    lease_id: String,
    path: String,
) -> Result<(), String> {
    close_registered_workspace_lease_for_project(
        &app,
        &project_id,
        &lease_id,
        Path::new(&path),
        "discarded",
    )
    .await
}

#[tauri::command]
pub async fn workspace_lease_release<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    lease_id: String,
    path: String,
) -> Result<(), String> {
    close_registered_workspace_lease_for_project(
        &app,
        &project_id,
        &lease_id,
        Path::new(&path),
        "released",
    )
    .await
}

#[tauri::command]
pub async fn workspace_lease_changed<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    lease_id: String,
    path: String,
) -> Result<bool, String> {
    registered_workspace_lease_changed_for_project(&app, &project_id, &lease_id, Path::new(&path))
        .await
}

#[tauri::command]
pub async fn workspace_lease_apply_patch<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    lease_id: String,
    path: String,
    patch: String,
    reverse: bool,
) -> Result<(), String> {
    validate_workspace_lease_patch_input(&lease_id, &patch, reverse)?;
    let _mutation_guard = lock_workspace_lease_mutation().await;
    let root = match project_workspace_root(&app, &project_id).await {
        Ok(root) => root,
        Err(error) => {
            let pool = crate::local_db::get_offisim_pool(&app)?;
            return Err(invalidate_registered_workspace_lease(
                &pool,
                &project_id,
                &lease_id,
                format!("Resolve registered workspace lease Project: {error}"),
            )
            .await);
        }
    };
    let pool = crate::local_db::get_offisim_pool(&app)?;
    apply_workspace_lease_patch_from_pool(
        &pool,
        &project_id,
        root.git_root(),
        &lease_id,
        Path::new(&path),
        &patch,
        reverse,
    )
    .await
}

#[tauri::command]
pub async fn workspace_checkpoint_timeline<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<WorkspaceCheckpointTimeline, String> {
    if project_id.trim().is_empty() {
        return Err("workspace_checkpoint_timeline requires a Project id".into());
    }
    let pool = crate::local_db::get_offisim_pool(&app)?;
    workspace_checkpoint_timeline_from_pool(&pool, &project_id).await
}

#[tauri::command]
pub async fn workspace_checkpoint_rollback<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    lease_id: String,
    path: String,
    checkpoint_id: String,
    actor: String,
) -> Result<WorkspaceCheckpointRollbackRow, String> {
    rollback_registered_workspace_checkpoint_for_project(
        &app,
        &project_id,
        &lease_id,
        Path::new(&path),
        &checkpoint_id,
        &actor,
    )
    .await
}

async fn project_workspace_root<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
) -> Result<AuthorizedWorkspaceRoot, String> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err("projectId is required for git_exec".into());
    }
    crate::task_workspace_binding::resolve_authorized_project_workspace(app, project_id).await
}

fn resolve_git_cwd(root: &Path, cwd: &str) -> Result<PathBuf, String> {
    let input = PathBuf::from(cwd);
    if !input.is_absolute()
        && input
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("parent-directory cwd segments are not allowed".into());
    }
    let candidate = if input.is_absolute() {
        input
    } else {
        root.join(input)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|err| format!("Resolve git cwd: {err}"))?;
    if canonical.starts_with(root) {
        Ok(canonical)
    } else {
        Err("git cwd is outside the bound project workspace".into())
    }
}
